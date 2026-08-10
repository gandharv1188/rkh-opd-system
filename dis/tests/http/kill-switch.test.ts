/**
 * DIS-100 — Kill-switch middleware (CS-9 emergency stop).
 *
 * Asserts:
 *   - writes (POST/PUT/PATCH/DELETE) return 503 + Retry-After when enabled,
 *   - reads (GET/HEAD/OPTIONS) pass through even when enabled,
 *   - writes pass through when disabled,
 *   - Retry-After is configurable,
 *   - `correlation_id` from upstream middleware is surfaced in the envelope,
 *   - a DB-backed `isEnabled` path works via an injected DatabasePort fake.
 *
 * Uses Hono's hermetic `app.request()` — no bound socket, parallel-safe.
 */

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { killSwitch } from '../../src/http/middleware/kill-switch.js';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import type { AppVariables } from '../../src/http/server.js';
import type { DatabasePort } from '../../src/ports/database.js';

function buildApp(opts: Parameters<typeof killSwitch>[0] = {}) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  app.use('*', killSwitch(opts));
  app.get('/thing', (c) => c.json({ ok: true }));
  app.post('/thing', (c) => c.json({ ok: true }));
  app.put('/thing', (c) => c.json({ ok: true }));
  app.patch('/thing', (c) => c.json({ ok: true }));
  app.delete('/thing', (c) => c.json({ ok: true }));
  return app;
}

describe('DIS-100 killSwitch middleware', () => {
  it('returns 503 on writes when enabled', async () => {
    const app = buildApp({ isEnabled: () => true });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await app.request('/thing', { method });
      expect(res.status, `${method} should be blocked`).toBe(503);
      expect(res.headers.get('retry-after')).toBe('300');
      const body = (await res.json()) as {
        error: { code: string; retryable: boolean; correlation_id: string };
      };
      expect(body.error.code).toBe('KILL_SWITCH_ACTIVE');
      expect(body.error.retryable).toBe(true);
      expect(body.error.correlation_id).toMatch(/[0-9a-f-]{36}/);
    }
  });

  it('GETs still succeed when enabled', async () => {
    const app = buildApp({ isEnabled: () => true });
    const res = await app.request('/thing', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('lets HEAD and OPTIONS through when enabled', async () => {
    const app = buildApp({ isEnabled: () => true });
    const head = await app.request('/thing', { method: 'HEAD' });
    expect(head.status).not.toBe(503);
    const opts = await app.request('/thing', { method: 'OPTIONS' });
    expect(opts.status).not.toBe(503);
  });

  it('writes pass through when disabled', async () => {
    const app = buildApp({ isEnabled: () => false });
    const res = await app.request('/thing', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('retry-after')).toBeNull();
  });

  it('supports async isEnabled and a configurable retryAfterSeconds', async () => {
    const app = buildApp({
      isEnabled: async () => true,
      retryAfterSeconds: 60,
    });
    const res = await app.request('/thing', { method: 'POST' });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('60');
  });

  it('propagates the upstream correlationId into the error envelope', async () => {
    const app = buildApp({ isEnabled: () => true });
    const uuid = '11111111-1111-4111-8111-111111111111';
    const res = await app.request('/thing', {
      method: 'POST',
      headers: { 'x-correlation-id': uuid },
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('x-correlation-id')).toBe(uuid);
    const body = (await res.json()) as { error: { correlation_id: string } };
    expect(body.error.correlation_id).toBe(uuid);
  });

  it('uses the DatabasePort when an isEnabled override is not provided', async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const dbFake: Pick<DatabasePort, 'queryOne'> = {
      async queryOne<T>(sql: string, params: readonly unknown[]): Promise<T | null> {
        calls.push({ sql, params });
        return { enabled: true } as unknown as T;
      },
    };
    const app = buildApp({ db: dbFake as DatabasePort });
    const res = await app.request('/thing', { method: 'POST' });
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql.toLowerCase()).toContain('dis_kill_switch');
  });

  it('defaults to off when neither a DB nor an isEnabled check is provided', async () => {
    const app = buildApp();
    const res = await app.request('/thing', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
