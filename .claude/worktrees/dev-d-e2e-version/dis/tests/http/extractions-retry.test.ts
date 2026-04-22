import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerExtractionsRetryRoute } from '../../src/http/routes/extractions-retry.js';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import { errorHandler } from '../../src/http/middleware/error-handler.js';
import type { AppVariables } from '../../src/http/server.js';
import type {
  ExtractionRecord,
  IngestionOrchestrator,
  RetryInput,
} from '../../src/core/orchestrator.js';
import { ExtractionNotFoundError } from '../../src/core/orchestrator.js';

type RetryFn = (input: RetryInput) => Promise<ExtractionRecord>;

function makeOrchestrator(retry: RetryFn): IngestionOrchestrator {
  return { retry } as unknown as IngestionOrchestrator;
}

function makeApp(orch: IngestionOrchestrator) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  registerExtractionsRetryRoute(app as unknown as Hono, { orchestrator: orch });
  app.onError(errorHandler({}));
  return app;
}

interface RetryResponse {
  extraction_id: string;
  parent_extraction_id: string | null;
  status: string;
  version: number;
  correlation_id: string;
}

describe('POST /extractions/:id/retry (DIS-094)', () => {
  it('happy path — returns 201 with new extraction_id and parent_extraction_id set to original id', async () => {
    const app = makeApp(
      makeOrchestrator(async (input) => ({
        id: 'ext-new-1',
        patientId: 'pat-1',
        status: 'uploaded',
        version: 1,
        parentExtractionId: input.id,
      })),
    );

    const res = await app.request('/extractions/ext-old-1/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operator-id': 'op-42' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as RetryResponse;
    expect(body.extraction_id).toBe('ext-new-1');
    expect(body.parent_extraction_id).toBe('ext-old-1');
    expect(body.status).toBe('uploaded');
    expect(body.version).toBe(1);
    expect(typeof body.correlation_id).toBe('string');
    expect(body.correlation_id.length).toBeGreaterThan(0);
  });

  it('old extraction remains readable after retry', async () => {
    // VERIFY-2 interpretation: the response preserves a reference
    // (parent_extraction_id === original path-param id) so the parent row
    // is not mutated away — full E2E readability is covered by DIS-104.
    const originalId = 'ext-old-2';
    const app = makeApp(
      makeOrchestrator(async (input) => ({
        id: 'ext-new-2',
        patientId: 'pat-2',
        status: 'uploaded',
        version: 1,
        parentExtractionId: input.id,
      })),
    );

    const res = await app.request(`/extractions/${originalId}/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actor: 'nurse-7' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as RetryResponse;
    expect(body.parent_extraction_id).toBe(originalId);
    expect(body.extraction_id).not.toBe(originalId);
  });

  it('missing actor (no body field, no X-Operator-Id header) → 400 MISSING_ACTOR', async () => {
    const app = makeApp(
      makeOrchestrator(async () => {
        throw new Error('orchestrator must not be called when actor missing');
      }),
    );

    const res = await app.request('/extractions/ext-x/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MISSING_ACTOR');
  });

  it('ExtractionNotFoundError propagates → 404 EXTRACTION_NOT_FOUND', async () => {
    const app = makeApp(
      makeOrchestrator(async (input) => {
        throw new ExtractionNotFoundError(input.id);
      }),
    );

    const res = await app.request('/extractions/ext-missing/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operator-id': 'op-1' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('EXTRACTION_NOT_FOUND');
  });
});
