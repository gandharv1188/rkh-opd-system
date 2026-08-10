import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import type { AppVariables } from '../../src/http/server.js';
import { registerHealthDeepRoute } from '../../src/http/routes/health-deep.js';
import type { DatabasePort } from '../../src/ports/database.js';

function makeApp(deps: Parameters<typeof registerHealthDeepRoute>[1]) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  registerHealthDeepRoute(app, deps);
  return app;
}

describe('GET /health/deep', () => {
  it('reports ok when all components healthy', async () => {
    const db: Partial<DatabasePort> = { async query() { return []; } };
    const app = makeApp({ db: db as DatabasePort });
    const res = await app.request('/health/deep');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; components: { component: string; status: string }[] };
    expect(body.status).toBe('ok');
    expect(body.components.find((c) => c.component === 'db')?.status).toBe('ok');
  });

  it('reports secrets degraded when cache miss', async () => {
    const app = makeApp({
      secrets: { get: async () => '' } as unknown as Parameters<typeof registerHealthDeepRoute>[1]['secrets'],
      secretsCacheMiss: true,
    });
    const res = await app.request('/health/deep');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; components: { component: string; status: string }[] };
    expect(body.components.find((c) => c.component === 'secrets')?.status).toBe('degraded');
  });

  it('returns 503 when any component down', async () => {
    const db: Partial<DatabasePort> = { async query() { throw new Error('offline'); } };
    const app = makeApp({ db: db as DatabasePort });
    const res = await app.request('/health/deep');
    expect(res.status).toBe(503);
  });
});
