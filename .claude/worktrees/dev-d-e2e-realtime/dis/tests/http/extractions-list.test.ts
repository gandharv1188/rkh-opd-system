import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import { errorEnvelope } from '../../src/http/middleware/error-envelope.js';
import { registerExtractionsListRoute } from '../../src/http/routes/extractions-list.js';
import type { AppVariables } from '../../src/http/server.js';
import type { DatabasePort, ExtractionRow, InsertExtractionInput } from '../../src/ports/database.js';
import type { State } from '../../src/core/state-machine.js';

interface EnvelopeBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    correlation_id: string;
  };
}

interface ListBody {
  items: ExtractionRow[];
  next_cursor: string | null;
  correlation_id: string;
}

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

function makeDb(
  rowsFactory: () => readonly ExtractionRow[],
  calls: QueryCall[],
): DatabasePort {
  const notUsed = (): never => {
    throw new Error('not exercised by GET /extractions');
  };
  return {
    query: async <T,>(sql: string, params: readonly unknown[]): Promise<readonly T[]> => {
      calls.push({ sql, params });
      return rowsFactory() as unknown as readonly T[];
    },
    queryOne: notUsed,
    transaction: notUsed,
    setSessionVars: async () => {},
    findExtractionById: notUsed,
    findExtractionByIdempotencyKey: notUsed,
    updateExtractionStatus: notUsed,
    insertExtraction: (_input: InsertExtractionInput) => notUsed(),
  };
}

function makeApp(db: DatabasePort, maxLimit?: number) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  app.onError(errorEnvelope());
  registerExtractionsListRoute(app, { db, maxLimit });
  return app;
}

const READY: State = 'ready_for_review';

function row(id: string, patientId = 'pat-1'): ExtractionRow {
  return {
    id,
    patient_id: patientId,
    status: READY,
    version: 1,
    idempotency_key: `idem-${id}`,
    payload_hash: `hash-${id}`,
    parent_extraction_id: null,
  };
}

describe('GET /extractions (DIS-095)', () => {
  it('happy path: returns items and next_cursor is null when no more rows', async () => {
    const rows = [row('a'), row('b'), row('c')];
    const calls: QueryCall[] = [];
    const app = makeApp(makeDb(() => rows, calls));

    const res = await app.request('/extractions');
    expect(res.status).toBe(200);

    const body = (await res.json()) as ListBody;
    expect(body.items).toHaveLength(3);
    expect(body.next_cursor).toBeNull();
    expect(body.items.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns next_cursor when more rows exist', async () => {
    const limit = 2;
    // Fake returns limit+1 rows to signal "more exist".
    const rows = [row('a'), row('b'), row('c')];
    const calls: QueryCall[] = [];
    const app = makeApp(makeDb(() => rows, calls));

    const res = await app.request(`/extractions?limit=${limit}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as ListBody;
    expect(body.items).toHaveLength(limit);
    expect(body.items.map((r) => r.id)).toEqual(['a', 'b']);
    expect(body.next_cursor).toBe('b');
  });

  it('filter by status: passes status value to the query params', async () => {
    const calls: QueryCall[] = [];
    const app = makeApp(makeDb(() => [], calls));

    const res = await app.request('/extractions?status=ready_for_review');
    expect(res.status).toBe(200);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.params).toContain('ready_for_review');
    expect(call.sql).toMatch(/status\s*=\s*\$1/);
  });

  it('invalid limit → 400', async () => {
    const calls: QueryCall[] = [];
    const app = makeApp(makeDb(() => [], calls));

    const res = await app.request('/extractions?limit=0');
    expect(res.status).toBe(400);

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('INVALID_LIMIT');
    expect(calls).toHaveLength(0);
  });
});
