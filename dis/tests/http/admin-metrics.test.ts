import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createMetrics } from '../../src/core/metrics.js';
import { registerAdminMetricsRoute } from '../../src/http/routes/admin-metrics.js';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import type { AppVariables } from '../../src/http/server.js';

interface SnapshotBody {
  counters: Array<{ name: string; labels?: Record<string, string>; value: number }>;
  gauges: Array<{ name: string; labels?: Record<string, string>; value: number }>;
}

function makeApp(metrics = createMetrics()) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  registerAdminMetricsRoute(app as unknown as Hono, metrics);
  return { app, metrics };
}

describe('GET /admin/metrics (Wave-5 tests/http convention)', () => {
  it('returns a 200 JSON snapshot with counters + gauges arrays', async () => {
    const { app, metrics } = makeApp();
    metrics.inc('docs_ingested_total');
    metrics.inc('docs_ingested_total', { provider: 'chandra' });
    metrics.inc('docs_ingested_total', { provider: 'chandra' });

    const res = await app.request('/admin/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/);

    const body = (await res.json()) as SnapshotBody;
    expect(Array.isArray(body.counters)).toBe(true);
    expect(Array.isArray(body.gauges)).toBe(true);

    const unlabelled = body.counters.find(
      (c) => c.name === 'docs_ingested_total' && !c.labels,
    );
    expect(unlabelled?.value).toBe(1);

    const labelled = body.counters.find(
      (c) => c.name === 'docs_ingested_total' && c.labels?.provider === 'chandra',
    );
    expect(labelled?.value).toBe(2);
  });

  it('every counter value is a finite number (VERIFY-2 translation)', async () => {
    // Original backlog VERIFY-2 piped `curl | jq` to check queue_depth was numeric.
    // The real snapshot shape is `{ counters: CounterSample[], gauges: [] }` — no
    // top-level `queue_depth` field. Equivalent invariant for the actual shape:
    // every counter sample must carry a numeric, finite `value`.
    const { app, metrics } = makeApp();
    metrics.inc('ingest_requests_total');
    metrics.inc('extractions_approved_total', { reviewer: 'alice' }, 5);

    const res = await app.request('/admin/metrics');
    expect(res.status).toBe(200);

    const body = (await res.json()) as SnapshotBody;
    expect(body.counters.length).toBeGreaterThan(0);
    for (const c of body.counters) {
      expect(typeof c.value).toBe('number');
      expect(Number.isFinite(c.value)).toBe(true);
    }
  });

  it('empty metrics instance yields empty counters + gauges arrays', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/metrics');
    expect(res.status).toBe(200);

    const body = (await res.json()) as SnapshotBody;
    expect(body.counters).toEqual([]);
    expect(body.gauges).toEqual([]);
  });
});
