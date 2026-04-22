import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { correlationId } from './middleware/correlation-id.js';
import {
  errorHandler,
  type ErrorHandlerDeps,
} from './middleware/error-handler.js';
import {
  killSwitch,
  type KillSwitchDeps,
} from './middleware/kill-switch.js';
import {
  rateLimit,
  type RateLimitConfig,
} from './middleware/rate-limit.js';
import { registerHealthRoute } from './routes/health.js';

/**
 * Hono context variable map.
 * Kept local to this module so callers get typed `c.get('correlationId')`.
 */
export interface AppVariables {
  correlationId: string;
}

export type App = Hono<{ Variables: AppVariables }>;

export interface CreateServerOptions {
  /** Kill-switch config (DIS-100, CS-9). Omit to disable. */
  readonly killSwitch?: KillSwitchDeps;
  /** Per-operator rate-limit config (DIS-102). Omit to disable. */
  readonly rateLimit?: RateLimitConfig;
  /** Global error-handler deps (DIS-101). Defaults to no logger. */
  readonly errorHandler?: ErrorHandlerDeps;
}

/**
 * Builds a fresh Hono app with all middleware + routes registered.
 *
 * Middleware order:
 *   1. correlation-id  — tag every request (DIS-008).
 *   2. kill-switch     — 503 on writes when active (DIS-100, CS-9, opt-in).
 *   3. rate-limit      — 429 on per-operator burst (DIS-102, opt-in).
 *   4. routes          — handlers run after the guards.
 *   5. error-handler   — onError maps thrown errors to envelope (DIS-101).
 *
 * No singletons, no module-level state: every call returns a new instance,
 * which keeps tests isolated and lets us spin up ephemeral servers on
 * random ports.
 */
export function createServer(options: CreateServerOptions = {}): App {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  if (options.killSwitch) app.use('*', killSwitch(options.killSwitch));
  if (options.rateLimit) app.use('*', rateLimit(options.rateLimit));
  registerHealthRoute(app as unknown as Hono);
  app.onError(errorHandler(options.errorHandler ?? {}));
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
