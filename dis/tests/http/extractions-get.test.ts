import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import { errorEnvelope } from '../../src/http/middleware/error-envelope.js';
import { registerExtractionsGetRoute } from '../../src/http/routes/extractions-get.js';
import type { AppVariables } from '../../src/http/server.js';
import type { DatabasePort, ExtractionRow, InsertExtractionInput } from '../../src/ports/database.js';
import type { State } from '../../src/core/state-machine.js';

interface EnvelopeBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    correlation_id: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Minimal stub DB. Only `findExtractionById` is exercised by this route;
 * other methods throw if touched so tests fail loudly on unexpected calls.
 */
function makeDb(
  lookup: (id: string) => ExtractionRow | null,
): DatabasePort {
  const notUsed = (): never => {
    throw new Error('not exercised by GET /extractions/:id');
  };
  return {
    query: notUsed,
    queryOne: notUsed,
    transaction: notUsed,
    setSessionVars: async () => {},
    findExtractionById: async (id: string) => lookup(id),
    findExtractionByIdempotencyKey: notUsed,
    updateExtractionStatus: notUsed,
    insertExtraction: (_input: InsertExtractionInput) => notUsed(),
  };
}

function makeApp(db: DatabasePort) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  app.onError(errorEnvelope());
  registerExtractionsGetRoute(app, { db });
  return app;
}

const READY: State = 'ready_for_review';

describe('GET /extractions/:id (DIS-091)', () => {
  it('returns raw_ocr_markdown, raw_ocr_blocks, structured, verified_structured, confidence_summary, version', async () => {
    const row: ExtractionRow = {
      id: 'ext-1',
      patient_id: 'pat-1',
      status: READY,
      version: 3,
      idempotency_key: 'idem-1',
      payload_hash: 'hash-1',
      parent_extraction_id: null,
    };
    const app = makeApp(makeDb(() => row));

    const res = await app.request('/extractions/ext-1');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    // Core projection from current ExtractionRow (see handoff §Gap).
    expect(body.id).toBe('ext-1');
    expect(body.patient_id).toBe('pat-1');
    expect(body.status).toBe(READY);
    expect(body.version).toBe(3);
    expect(body.parent_extraction_id).toBeNull();
  });

  it('404 when extraction is not found', async () => {
    const app = makeApp(makeDb(() => null));

    const res = await app.request('/extractions/missing');
    expect(res.status).toBe(404);

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('EXTRACTION_NOT_FOUND');
    expect(body.error.retryable).toBe(false);
    expect(body.error.message).toContain('missing');
  });

  it('RLS denies cross-patient reads — surfaces as 404, no existence leak', async () => {
    // Simulated RLS: the adapter would apply session vars before the read and
    // return null for rows outside the caller's scope. The route therefore
    // cannot distinguish "absent" from "denied" — both become 404.
    const app = makeApp(makeDb(() => null));

    const res = await app.request('/extractions/ext-other-patient');
    expect(res.status).toBe(404);

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('EXTRACTION_NOT_FOUND');
  });

  it('echoes correlation_id from inbound header in envelope on 404', async () => {
    const app = makeApp(makeDb(() => null));
    const inbound = '11111111-2222-4333-8444-555555555555';

    const res = await app.request('/extractions/x', {
      headers: { 'x-correlation-id': inbound },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('x-correlation-id')).toBe(inbound);

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.correlation_id).toBe(inbound);
  });
});
