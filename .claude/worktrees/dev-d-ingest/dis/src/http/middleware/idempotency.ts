/**
 * Idempotency-Key middleware (DIS-014 — skeleton).
 *
 * Enforces the `Idempotency-Key` header on state-changing routes. Returns a
 * stub {@link IdempotencyResolution} today; the persistent de-duplication
 * store arrives in DIS-025.
 *
 * Design:
 *   - Method-based gating. GET/HEAD/OPTIONS pass through untouched. Other
 *     HTTP verbs (POST/PUT/PATCH/DELETE) require the `Idempotency-Key`
 *     header and reject with 400 + `code: 'IDEMPOTENCY_KEY_REQUIRED'` when
 *     absent.
 *   - The resolved key is published on the Hono context under the
 *     `idempotencyKey` variable so downstream handlers can reuse it.
 *   - `createIdempotencyMiddleware(logger?)` takes an optional logger so
 *     callers can wire DIS-008's pino logger post-merge. The logger is
 *     structural (matches `{info, warn}`) — no dep on pino here.
 *
 * @see TDD §3, §5
 * @see DIS-025 (persistent idempotency store — out of scope here)
 */

import type { MiddlewareHandler } from 'hono';

const HEADER = 'Idempotency-Key';
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Stub resolution returned until DIS-025 lands the persistent store.
 */
export type IdempotencyResolution = {
  readonly key: string;
  readonly cached: false;
};

/**
 * Minimal logger surface. Caller may pass the DIS-008 pino logger, a test
 * spy, or omit and fall back to a no-op.
 */
export interface IdempotencyLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

const noopLogger: IdempotencyLogger = {
  info: () => {},
  warn: () => {},
};

export interface IdempotencyVariables {
  idempotencyKey: IdempotencyResolution;
}

/**
 * Build a Hono middleware that enforces `Idempotency-Key` on state-changing
 * methods and returns 400 when the header is missing.
 */
export function createIdempotencyMiddleware(
  logger: IdempotencyLogger = noopLogger,
): MiddlewareHandler<{ Variables: IdempotencyVariables }> {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (!STATE_CHANGING_METHODS.has(method)) {
      await next();
      return;
    }

    const key = c.req.header(HEADER);
    if (!key || key.trim().length === 0) {
      logger.warn(
        { method, path: c.req.path },
        'idempotency: missing Idempotency-Key header',
      );
      return c.json(
        {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: `${HEADER} header is required for ${method} requests`,
        },
        400,
      );
    }

    const resolution: IdempotencyResolution = { key, cached: false };
    c.set('idempotencyKey', resolution);
    logger.info(
      { method, path: c.req.path, key },
      'idempotency: resolved stub (DIS-025 will persist)',
    );
    await next();
  };
}
