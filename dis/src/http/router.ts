import type { Hono } from 'hono';
import type { AppVariables } from './server.js';

/**
 * A RouteModule mounts one feature's routes onto the provided Hono app.
 *
 * Convention: each feature owns a file under `src/http/routes/<feature>.ts`
 * that exports a function matching this signature. `createServer()` composes
 * the app by calling each RouteModule in turn; tests can mount a subset.
 */
export type RouteModule = (app: Hono<{ Variables: AppVariables }>) => void;

/**
 * Registers an ordered list of route modules on the app. Thin helper so the
 * server factory reads as a single list of feature mounts instead of a
 * sequence of imperative calls.
 */
export function registerRoutes(
  app: Hono<{ Variables: AppVariables }>,
  modules: readonly RouteModule[],
): void {
  for (const mount of modules) {
    mount(app);
  }
}
