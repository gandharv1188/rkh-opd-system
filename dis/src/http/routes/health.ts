import type { Hono } from 'hono';

export interface HealthResponse {
  status: 'ok';
  version: string;
}

/**
 * Registers `GET /health` on the provided Hono app.
 *
 * The version is resolved from `process.env.DIS_VERSION` with a fallback to
 * `0.0.1`. Full health semantics (dependency probes etc.) are out of scope
 * for DIS-004 — this is a liveness endpoint only.
 */
export function registerHealthRoute(app: Hono): void {
  app.get('/health', (c) => {
    const version = process.env.DIS_VERSION ?? '0.0.1';
    const body: HealthResponse = { status: 'ok', version };
    return c.json(body, 200);
  });
}
