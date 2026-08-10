import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  HttpError,
  errorEnvelope,
  type ErrorEnvelopeBody,
} from '../../src/http/middleware/error-envelope.js';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import type { AppVariables } from '../../src/http/server.js';

function makeApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  app.onError(errorEnvelope());
  return app;
}

describe('errorEnvelope middleware', () => {
  it('maps a thrown HttpError to the canonical envelope with status + correlation_id', async () => {
    const app = makeApp();
    app.get('/boom', () => {
      throw new HttpError(404, 'NOT_FOUND', 'extraction not found');
    });

    const res = await app.request('/boom');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/);

    const body = (await res.json()) as ErrorEnvelopeBody;
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('extraction not found');
    expect(body.error.retryable).toBe(false);
    expect(typeof body.error.correlation_id).toBe('string');
    expect(body.error.correlation_id.length).toBeGreaterThan(0);
    expect(body.error.correlation_id).toBe(res.headers.get('x-correlation-id'));
  });

  it('maps an unknown thrown Error to 500 INTERNAL with retryable=true', async () => {
    const app = makeApp();
    app.get('/crash', () => {
      throw new Error('kaboom');
    });

    const res = await app.request('/crash');
    expect(res.status).toBe(500);

    const body = (await res.json()) as ErrorEnvelopeBody;
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.retryable).toBe(true);
    expect(body.error.correlation_id).toBe(res.headers.get('x-correlation-id'));
    // Internal errors must never leak the raw message to the client.
    expect(body.error.message).not.toBe('kaboom');
  });

  it('preserves retryable=true for configured 5xx codes and carries details', async () => {
    const app = makeApp();
    app.get('/upstream', () => {
      throw new HttpError(
        502,
        'OCR_PROVIDER_UNAVAILABLE',
        'chandra is down',
        { provider: 'chandra', retry_after_sec: 30 },
      );
    });

    const res = await app.request('/upstream');
    expect(res.status).toBe(502);

    const body = (await res.json()) as ErrorEnvelopeBody;
    expect(body.error.code).toBe('OCR_PROVIDER_UNAVAILABLE');
    expect(body.error.retryable).toBe(true);
    expect(body.error.details).toEqual({ provider: 'chandra', retry_after_sec: 30 });
  });

  it('echoes the inbound correlation-id into the envelope when provided', async () => {
    const app = makeApp();
    app.get('/err', () => {
      throw new HttpError(400, 'INVALID_ARGUMENT', 'bad');
    });

    const inbound = '11111111-2222-4333-8444-555555555555';
    const res = await app.request('/err', { headers: { 'x-correlation-id': inbound } });
    const body = (await res.json()) as ErrorEnvelopeBody;
    expect(body.error.correlation_id).toBe(inbound);
    expect(res.headers.get('x-correlation-id')).toBe(inbound);
  });
});
