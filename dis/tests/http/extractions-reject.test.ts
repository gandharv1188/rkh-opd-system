import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerExtractionsRejectRoute } from '../../src/http/routes/extractions-reject.js';
import { errorHandler } from '../../src/http/middleware/error-handler.js';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import type { AppVariables } from '../../src/http/server.js';
import {
  VersionConflictError,
  type ExtractionRecord,
  type RejectInput,
  type IngestionOrchestrator,
} from '../../src/core/orchestrator.js';

interface EnvelopeBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    correlation_id: string;
    details?: Record<string, unknown>;
  };
}

interface SuccessBody {
  extraction_id: string;
  status: string;
  version: number;
  correlation_id: string;
}

type FakeReject = (input: RejectInput) => Promise<ExtractionRecord>;

function fakeOrchestrator(reject: FakeReject): IngestionOrchestrator {
  return { reject } as unknown as IngestionOrchestrator;
}

function makeApp(reject: FakeReject) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  registerExtractionsRejectRoute(app as unknown as Hono, {
    orchestrator: fakeOrchestrator(reject),
  });
  app.onError(errorHandler());
  return app;
}

describe('POST /extractions/:id/reject (DIS-093)', () => {
  it('happy path: 200 with body shape', async () => {
    const calls: RejectInput[] = [];
    const app = makeApp(async (input) => {
      calls.push(input);
      return {
        id: input.id,
        patientId: 'p1',
        status: 'rejected',
        version: input.expectedVersion + 1,
        parentExtractionId: null,
      };
    });

    const res = await app.request('/extractions/ext-1/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expected_version: 2,
        reason_code: 'illegible',
        actor: 'nurse-42',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as SuccessBody;
    expect(body.extraction_id).toBe('ext-1');
    expect(body.status).toBe('rejected');
    expect(body.version).toBe(3);
    expect(typeof body.correlation_id).toBe('string');
    expect(body.correlation_id.length).toBeGreaterThan(0);
    expect(calls).toEqual([
      { id: 'ext-1', expectedVersion: 2, actor: 'nurse-42', reasonCode: 'illegible' },
    ]);
  });

  it('requires non-empty reason', async () => {
    const app = makeApp(async () => {
      throw new Error('should not be called');
    });

    const resEmpty = await app.request('/extractions/ext-1/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expected_version: 2, reason_code: '', actor: 'nurse-42' }),
    });
    expect(resEmpty.status).toBe(400);
    const bodyEmpty = (await resEmpty.json()) as EnvelopeBody;
    expect(bodyEmpty.error.code).toBe('MISSING_REASON');

    const resMissing = await app.request('/extractions/ext-1/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expected_version: 2, actor: 'nurse-42' }),
    });
    expect(resMissing.status).toBe(400);
    const bodyMissing = (await resMissing.json()) as EnvelopeBody;
    expect(bodyMissing.error.code).toBe('MISSING_REASON');

    const resWhitespace = await app.request('/extractions/ext-1/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expected_version: 2,
        reason_code: '   ',
        actor: 'nurse-42',
      }),
    });
    expect(resWhitespace.status).toBe(400);
    const bodyWs = (await resWhitespace.json()) as EnvelopeBody;
    expect(bodyWs.error.code).toBe('MISSING_REASON');
  });

  it('version conflict propagates → 409 via DIS-101 handler', async () => {
    const app = makeApp(async () => {
      throw new VersionConflictError('ext-1', 5, 'ready_for_review');
    });

    const res = await app.request('/extractions/ext-1/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expected_version: 2,
        reason_code: 'illegible',
        actor: 'nurse-42',
      }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('VERSION_CONFLICT');
    expect(body.error.retryable).toBe(false);
    expect(body.error.details).toEqual({
      current_version: 5,
      current_status: 'ready_for_review',
    });
  });

  it('missing expected_version → 400', async () => {
    const app = makeApp(async () => {
      throw new Error('should not be called');
    });

    const res = await app.request('/extractions/ext-1/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason_code: 'illegible', actor: 'nurse-42' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('MISSING_EXPECTED_VERSION');
  });

  it('missing actor → 400', async () => {
    const app = makeApp(async () => {
      throw new Error('should not be called');
    });

    const res = await app.request('/extractions/ext-1/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expected_version: 2, reason_code: 'illegible' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('MISSING_ACTOR');
  });

  it('actor can come from X-Operator-Id header', async () => {
    const calls: RejectInput[] = [];
    const app = makeApp(async (input) => {
      calls.push(input);
      return {
        id: input.id,
        patientId: 'p1',
        status: 'rejected',
        version: input.expectedVersion + 1,
        parentExtractionId: null,
      };
    });

    const res = await app.request('/extractions/ext-1/reject', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-operator-id': 'nurse-header',
      },
      body: JSON.stringify({ expected_version: 2, reason_code: 'illegible' }),
    });

    expect(res.status).toBe(200);
    expect(calls[0]?.actor).toBe('nurse-header');
  });
});
