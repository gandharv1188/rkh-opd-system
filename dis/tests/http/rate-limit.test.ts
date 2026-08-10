import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { rateLimit } from '../../src/http/middleware/rate-limit.js';
import type { AppVariables } from '../../src/http/server.js';

function buildApp(config: Parameters<typeof rateLimit>[0] = {}) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('correlationId', 'test-correlation-id');
    await next();
  });
  app.use('*', rateLimit(config));
  app.get('/protected', (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimit middleware', () => {
  it('passes request through when under the limit', async () => {
    let clock = 1_000_000;
    const app = buildApp({ maxTokens: 5, windowMs: 600_000, now: () => clock });

    const res = await app.request('/protected', {
      headers: { 'X-Operator-Id': 'op-1' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns 429 after burst exhausted', async () => {
    let clock = 2_000_000;
    const app = buildApp({ maxTokens: 3, windowMs: 600_000, now: () => clock });

    for (let i = 0; i < 3; i++) {
      const ok = await app.request('/protected', {
        headers: { 'X-Operator-Id': 'op-burst' },
      });
      expect(ok.status).toBe(200);
    }

    const blocked = await app.request('/protected', {
      headers: { 'X-Operator-Id': 'op-burst' },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();

    const body = (await blocked.json()) as {
      error: { code: string; retryable: boolean; correlation_id: string };
    };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.retryable).toBe(true);
    expect(body.error.correlation_id).toBe('test-correlation-id');
  });

  it('Retry-After header is a positive integer (seconds)', async () => {
    let clock = 3_000_000;
    const app = buildApp({ maxTokens: 1, windowMs: 600_000, now: () => clock });

    await app.request('/protected', { headers: { 'X-Operator-Id': 'op-ra' } });
    const res = await app.request('/protected', {
      headers: { 'X-Operator-Id': 'op-ra' },
    });

    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).toBeTruthy();
    const parsed = Number(retryAfter);
    expect(Number.isInteger(parsed)).toBe(true);
    expect(parsed).toBeGreaterThanOrEqual(1);
  });

  it('refills the bucket over time so requests pass after the window elapses', async () => {
    let clock = 4_000_000;
    const app = buildApp({ maxTokens: 3, windowMs: 600_000, now: () => clock });

    for (let i = 0; i < 3; i++) {
      const ok = await app.request('/protected', {
        headers: { 'X-Operator-Id': 'op-refill' },
      });
      expect(ok.status).toBe(200);
    }

    const blocked = await app.request('/protected', {
      headers: { 'X-Operator-Id': 'op-refill' },
    });
    expect(blocked.status).toBe(429);

    clock += 600_000;

    const res = await app.request('/protected', {
      headers: { 'X-Operator-Id': 'op-refill' },
    });
    expect(res.status).toBe(200);
  });

  it('tracks separate buckets per operator_id', async () => {
    let clock = 5_000_000;
    const app = buildApp({ maxTokens: 2, windowMs: 600_000, now: () => clock });

    for (let i = 0; i < 2; i++) {
      const ok = await app.request('/protected', {
        headers: { 'X-Operator-Id': 'operator-A' },
      });
      expect(ok.status).toBe(200);
    }
    const blockedA = await app.request('/protected', {
      headers: { 'X-Operator-Id': 'operator-A' },
    });
    expect(blockedA.status).toBe(429);

    const firstB = await app.request('/protected', {
      headers: { 'X-Operator-Id': 'operator-B' },
    });
    expect(firstB.status).toBe(200);
  });

  it('returns 400 MISSING_OPERATOR_ID when the header is absent', async () => {
    const app = buildApp();

    const res = await app.request('/protected');

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; retryable: boolean; correlation_id: string };
    };
    expect(body.error.code).toBe('MISSING_OPERATOR_ID');
    expect(body.error.retryable).toBe(false);
    expect(body.error.correlation_id).toBe('test-correlation-id');
  });

  it('uses the configured header name when overridden', async () => {
    let clock = 6_000_000;
    const app = buildApp({
      maxTokens: 1,
      windowMs: 600_000,
      now: () => clock,
      operatorIdFromHeader: 'X-Custom-Operator',
    });

    const ok = await app.request('/protected', {
      headers: { 'X-Custom-Operator': 'custom-op' },
    });
    expect(ok.status).toBe(200);

    const blocked = await app.request('/protected', {
      headers: { 'X-Custom-Operator': 'custom-op' },
    });
    expect(blocked.status).toBe(429);
  });
});
