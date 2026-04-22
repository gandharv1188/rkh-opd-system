/**
 * Unit tests — Idempotency-Key middleware (DIS-014).
 *
 * Uses Hono's app.fetch(request) to drive the middleware directly, no HTTP
 * socket. Covers: pass-through for GET, 400 for missing header on POST,
 * success path on POST with header, logger injection.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

import {
  createIdempotencyMiddleware,
  type IdempotencyLogger,
  type IdempotencyResolution,
  type IdempotencyVariables,
} from '../../src/http/middleware/idempotency.js';

function buildApp(logger?: IdempotencyLogger) {
  const app = new Hono<{ Variables: IdempotencyVariables }>();
  app.use('*', createIdempotencyMiddleware(logger));
  app.get('/health', (c) => c.json({ ok: true }));
  app.post('/ingest', (c) => {
    const res = c.get('idempotencyKey');
    return c.json({ received: res });
  });
  app.delete('/thing/:id', (c) => c.json({ deleted: true }));
  return app;
}

function spyLogger(): IdempotencyLogger & { infos: unknown[]; warns: unknown[] } {
  const infos: unknown[] = [];
  const warns: unknown[] = [];
  return {
    info: (obj, msg) => infos.push({ obj, msg }),
    warn: (obj, msg) => warns.push({ obj, msg }),
    infos,
    warns,
  };
}

describe('idempotency middleware', () => {
  it('passes GET requests through without requiring the header', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('http://x/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects POST without Idempotency-Key with 400 and error code', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('http://x/ingest', { method: 'POST', body: '{}' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('rejects POST with empty Idempotency-Key with 400', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('http://x/ingest', {
        method: 'POST',
        body: '{}',
        headers: { 'Idempotency-Key': '   ' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('passes POST with Idempotency-Key and exposes resolution to handler', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('http://x/ingest', {
        method: 'POST',
        body: '{}',
        headers: { 'Idempotency-Key': 'abc-123' },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: IdempotencyResolution };
    expect(body.received.key).toBe('abc-123');
    expect(body.received.cached).toBe(false);
  });

  it('also guards other state-changing methods (DELETE)', async () => {
    const app = buildApp();
    const missing = await app.fetch(new Request('http://x/thing/1', { method: 'DELETE' }));
    expect(missing.status).toBe(400);
    const present = await app.fetch(
      new Request('http://x/thing/1', {
        method: 'DELETE',
        headers: { 'Idempotency-Key': 'k' },
      }),
    );
    expect(present.status).toBe(200);
  });

  it('injects a logger and records warn on missing key, info on success', async () => {
    const spy = spyLogger();
    const app = buildApp(spy);

    await app.fetch(new Request('http://x/ingest', { method: 'POST', body: '{}' }));
    expect(spy.warns.length).toBe(1);

    await app.fetch(
      new Request('http://x/ingest', {
        method: 'POST',
        body: '{}',
        headers: { 'Idempotency-Key': 'k' },
      }),
    );
    expect(spy.infos.length).toBe(1);
  });
});
