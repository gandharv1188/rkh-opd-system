import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../src/http/middleware/error-handler.js';
import { HttpError } from '../../src/http/middleware/error-envelope.js';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import type { AppVariables } from '../../src/http/server.js';
import {
  VersionConflictError,
  ExtractionNotFoundError,
  OrchestratorError,
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

function makeApp(logger?: { error: (obj: object, msg?: string) => void }) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  app.onError(errorHandler(logger ? { logger } : {}));
  return app;
}

describe('errorHandler middleware (DIS-101)', () => {
  it('unhandled exception becomes 500 with envelope', async () => {
    const app = makeApp();
    app.get('/boom', () => {
      throw new Error('boom');
    });

    const res = await app.request('/boom');
    expect(res.status).toBe(500);

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.retryable).toBe(true);
    expect(body.error.message).not.toBe('boom'); // never leak
    expect(body.error.message).toBe('Internal server error.');
    expect(typeof body.error.correlation_id).toBe('string');
    expect(body.error.correlation_id.length).toBeGreaterThan(0);
  });

  it('VersionConflictError becomes 409 VERSION_CONFLICT, non-retryable, carrying details', async () => {
    const app = makeApp();
    app.get('/vc', () => {
      throw new VersionConflictError('ext-1', 2, 'ready_for_review');
    });

    const res = await app.request('/vc');
    expect(res.status).toBe(409);

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('VERSION_CONFLICT');
    expect(body.error.retryable).toBe(false);
    expect(body.error.details).toEqual({
      current_version: 2,
      current_status: 'ready_for_review',
    });
  });

  it('ExtractionNotFoundError becomes 404 EXTRACTION_NOT_FOUND', async () => {
    const app = makeApp();
    app.get('/nf', () => {
      throw new ExtractionNotFoundError('ext-missing');
    });

    const res = await app.request('/nf');
    expect(res.status).toBe(404);

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('EXTRACTION_NOT_FOUND');
    expect(body.error.retryable).toBe(false);
  });

  it('OrchestratorError IDEMPOTENCY_KEY_CONFLICT becomes 409, non-retryable', async () => {
    const app = makeApp();
    app.get('/ik', () => {
      throw new OrchestratorError('IDEMPOTENCY_KEY_CONFLICT', 'key reuse');
    });

    const res = await app.request('/ik');
    expect(res.status).toBe(409);

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(body.error.retryable).toBe(false);
  });

  it('OrchestratorError UNSUPPORTED_MEDIA becomes 415, non-retryable', async () => {
    const app = makeApp();
    app.get('/um', () => {
      throw new OrchestratorError('UNSUPPORTED_MEDIA', 'cannot ingest');
    });

    const res = await app.request('/um');
    expect(res.status).toBe(415);

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA');
    expect(body.error.retryable).toBe(false);
  });

  it('OrchestratorError with other code becomes 500, retryable', async () => {
    const app = makeApp();
    app.get('/oe', () => {
      throw new OrchestratorError('SOMETHING_WEIRD', 'internal failure');
    });

    const res = await app.request('/oe');
    expect(res.status).toBe(500);

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('SOMETHING_WEIRD');
    expect(body.error.retryable).toBe(true);
  });

  it('HttpError passthrough preserves status, code, and retryable flag', async () => {
    const app = makeApp();
    app.get('/he', () => {
      throw new HttpError(400, 'BAD_REQUEST', 'missing field');
    });

    const res = await app.request('/he');
    expect(res.status).toBe(400);

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('missing field');
    expect(body.error.retryable).toBe(false);
  });

  it('HttpError with details is echoed through', async () => {
    const app = makeApp();
    app.get('/hed', () => {
      throw new HttpError(502, 'OCR_PROVIDER_UNAVAILABLE', 'upstream down', {
        provider: 'chandra',
      });
    });

    const res = await app.request('/hed');
    expect(res.status).toBe(502);

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('OCR_PROVIDER_UNAVAILABLE');
    expect(body.error.retryable).toBe(true);
    expect(body.error.details).toEqual({ provider: 'chandra' });
  });

  it('logger.error is called with { err, correlation_id } when injected', async () => {
    const spy = vi.fn();
    const app = makeApp({ error: spy });
    app.get('/boom', () => {
      throw new Error('boom');
    });

    await app.request('/boom');

    expect(spy).toHaveBeenCalledTimes(1);
    const [arg1, arg2] = spy.mock.calls[0]!;
    expect(arg1).toMatchObject({ err: expect.any(Error) });
    expect((arg1 as { correlation_id: string }).correlation_id).toEqual(expect.any(String));
    expect((arg1 as { correlation_id: string }).correlation_id.length).toBeGreaterThan(0);
    expect(arg2).toBe('unhandled-error');
  });

  it('correlation_id in envelope matches the inbound header via correlation middleware', async () => {
    const app = makeApp();
    app.get('/boom', () => {
      throw new Error('boom');
    });

    const inbound = '11111111-2222-4333-8444-555555555555';
    const res = await app.request('/boom', { headers: { 'x-correlation-id': inbound } });
    expect(res.headers.get('x-correlation-id')).toBe(inbound);

    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.correlation_id).toBe(inbound);
  });
});
