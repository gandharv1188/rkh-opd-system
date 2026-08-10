import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerProcessJobRoute } from '../../src/http/routes/process-job.js';
import { errorHandler } from '../../src/http/middleware/error-handler.js';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import type { AppVariables } from '../../src/http/server.js';
import type {
  ExtractionRecord,
  IngestionOrchestrator,
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

type FakeProcess = (id: string) => Promise<ExtractionRecord>;

function fakeOrchestrator(process: FakeProcess): IngestionOrchestrator {
  return { process } as unknown as IngestionOrchestrator;
}

const TOKEN = 'worker-secret-abc123';

function makeApp(process: FakeProcess, workerToken: string = TOKEN) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  registerProcessJobRoute(app, {
    orchestrator: fakeOrchestrator(process),
    workerToken,
  });
  app.onError(errorHandler());
  return app;
}

describe('POST /internal/process-job (DIS-097)', () => {
  it('marks job complete on success', async () => {
    const calls: string[] = [];
    const app = makeApp(async (id) => {
      calls.push(id);
      return {
        id,
        patientId: 'p1',
        status: 'promoted',
        version: 4,
        parentExtractionId: null,
      };
    });

    const res = await app.request('/internal/process-job', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-token': TOKEN,
      },
      body: JSON.stringify({ extraction_id: 'ext-1' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as SuccessBody;
    expect(body.extraction_id).toBe('ext-1');
    expect(body.status).toBe('promoted');
    expect(body.version).toBe(4);
    expect(typeof body.correlation_id).toBe('string');
    expect(body.correlation_id.length).toBeGreaterThan(0);
    expect(calls).toEqual(['ext-1']);
  });

  it('refuses external callers without worker token', async () => {
    const app = makeApp(async () => {
      throw new Error('should not be called');
    });

    const res = await app.request('/internal/process-job', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extraction_id: 'ext-1' }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('wrong token → 403', async () => {
    const app = makeApp(async () => {
      throw new Error('should not be called');
    });

    const res = await app.request('/internal/process-job', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-token': 'not-the-right-token',
      },
      body: JSON.stringify({ extraction_id: 'ext-1' }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('missing extraction_id → 400 MISSING_EXTRACTION_ID', async () => {
    const app = makeApp(async () => {
      throw new Error('should not be called');
    });

    const res = await app.request('/internal/process-job', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-token': TOKEN,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('MISSING_EXTRACTION_ID');
  });

  it('orchestrator throws → 5xx via handler', async () => {
    const app = makeApp(async () => {
      throw new Error('boom');
    });

    const res = await app.request('/internal/process-job', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-token': TOKEN,
      },
      body: JSON.stringify({ extraction_id: 'ext-1' }),
    });

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBeLessThan(600);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('INTERNAL');
    expect(typeof body.error.correlation_id).toBe('string');
  });
});
