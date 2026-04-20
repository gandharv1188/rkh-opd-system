import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { correlationId } from './middleware/correlation-id.ts';
import { registerHealthRoute } from './routes/health.ts';

/**
 * Hono context variable map.
 * Kept local to this module so callers get typed `c.get('correlationId')`.
 */
export interface AppVariables {
  correlationId: string;
}

export type App = Hono<{ Variables: AppVariables }>;

/**
 * Builds a fresh Hono app with all middleware + routes registered.
 *
 * No singletons, no module-level state: every call returns a new instance,
 * which keeps tests isolated and lets us spin up ephemeral servers on
 * random ports.
 */
export function createServer(): App {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  registerHealthRoute(app);
  return app;
}

export interface StartedServer {
  /** Actual bound port (resolved from OS when `port === 0`). */
  port: number;
  /** Gracefully stops the server. */
  close: () => Promise<void>;
}

/**
 * Starts a Node HTTP server bound to `port` (use `0` for an OS-assigned
 * random free port — required for parallel integration tests).
 *
 * Returns the bound port and a `close()` function. Real logging + signal
 * handling are wired up later (DIS-008); this is a skeleton.
 */
export async function start(port: number): Promise<StartedServer> {
  const app = createServer();

  return await new Promise<StartedServer>((resolve, reject) => {
    try {
      const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
        resolve({
          port: info.port,
          close: () =>
            new Promise<void>((res, rej) => {
              server.close((err) => (err ? rej(err) : res()));
            }),
        });
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
