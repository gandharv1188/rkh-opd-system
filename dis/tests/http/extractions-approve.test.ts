import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerExtractionsApproveRoute } from '../../src/http/routes/extractions-approve.js';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import { errorHandler } from '../../src/http/middleware/error-handler.js';
import type { AppVariables } from '../../src/http/server.js';
import {
  VersionConflictError,
  type ApproveInput,
  type ExtractionRecord,
  type IngestionOrchestrator,
} from '../../src/core/orchestrator.js';

class FakeOrchestrator {
  public calls: ApproveInput[] = [];
  constructor(private readonly result: ExtractionRecord | Error) {}
  async approve(input: ApproveInput): Promise<ExtractionRecord> {
    this.calls.push(input);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

function asOrchestrator(f: FakeOrchestrator): IngestionOrchestrator {
  return f as unknown as IngestionOrchestrator;
}

function makeApp(fake: FakeOrchestrator) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  app.onError(errorHandler());
  registerExtractionsApproveRoute(app, { orchestrator: asOrchestrator(fake) });
  return app;
}

interface EnvelopeBody {
  error: { code: string; message: string; retryable: boolean; correlation_id: string; details?: Record<string, unknown> };
}

interface SuccessBody {
  extraction_id: string;
  status: string;
  version: number;
  correlation_id: string;
  promotion: { inserted: number; skipped: number };
}

describe('POST /extractions/:id/approve (DIS-092)', () => {
  it('returns promotion summary with inserted + skipped counts', async () => {
    const record: ExtractionRecord = {
      id: 'ext-1',
      patientId: 'p-1',
      status: 'verified',
      version: 3,
      parentExtractionId: null,
    };
    const fake = new FakeOrchestrator(record);
    const app = makeApp(fake);

    const res = await app.request('/extractions/ext-1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operator-id': 'nurse-1' },
      body: JSON.stringify({ expected_version: 2 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as SuccessBody;
    expect(body.extraction_id).toBe('ext-1');
    expect(body.status).toBe('verified');
    expect(body.version).toBe(3);
    expect(body.promotion.inserted).toBe(0);
    expect(body.promotion.skipped).toBe(0);
    expect(typeof body.correlation_id).toBe('string');
    expect(body.correlation_id.length).toBeGreaterThan(0);

    expect(fake.calls).toEqual([{ id: 'ext-1', expectedVersion: 2, actor: 'nurse-1' }]);
  });

  it('version mismatch returns 409 VersionConflictError', async () => {
    const fake = new FakeOrchestrator(new VersionConflictError('ext-1', 2, 'ready_for_review'));
    const app = makeApp(fake);

    const res = await app.request('/extractions/ext-1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operator-id': 'nurse-1' },
      body: JSON.stringify({ expected_version: 1 }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('VERSION_CONFLICT');
    expect(body.error.retryable).toBe(false);
    expect(body.error.details).toEqual({ current_version: 2, current_status: 'ready_for_review' });
  });

  it('missing expected_version returns 400', async () => {
    const fake = new FakeOrchestrator(
      { id: 'x', patientId: 'p', status: 'verified', version: 1, parentExtractionId: null },
    );
    const app = makeApp(fake);

    const res = await app.request('/extractions/ext-1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operator-id': 'nurse-1' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('MISSING_EXPECTED_VERSION');
    expect(fake.calls).toHaveLength(0);
  });

  it('missing actor returns 400', async () => {
    const fake = new FakeOrchestrator(
      { id: 'x', patientId: 'p', status: 'verified', version: 1, parentExtractionId: null },
    );
    const app = makeApp(fake);

    const res = await app.request('/extractions/ext-1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expected_version: 2 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('MISSING_ACTOR');
    expect(fake.calls).toHaveLength(0);
  });
});
