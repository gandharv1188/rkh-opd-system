import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getRootLogger, type Logger } from '../../core/logger.js';
import type { AppVariables } from '../server.js';

const HEADER = 'x-correlation-id';
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CorrelationIdOptions {
  /** Base logger to bind per-request context onto. Defaults to getRootLogger(). */
  logger?: Logger;
}

/**
 * Correlation-ID middleware.
 *
 * Reads the inbound `X-Correlation-Id` header if present and well-formed
 * (UUIDv4), otherwise generates a new UUIDv4 via `node:crypto.randomUUID()`.
 * The value is stored on the Hono context under `correlationId`, echoed on
 * the response as `x-correlation-id`, and bound as a child of the logger
 * stored under `logger` so downstream handlers emit structured log lines
 * that carry the correlation_id automatically (TDD §14).
 */
export function correlationId(
  opts: CorrelationIdOptions = {},
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const inbound = c.req.header(HEADER);
    const correlation_id: string = inbound && UUID_V4_RE.test(inbound) ? inbound : randomUUID();
    c.set('correlationId', correlation_id);
    c.header(HEADER, correlation_id);

    const base = opts.logger ?? getRootLogger();
    const requestLogger = base.child({ correlation_id });
    // Key intentionally stored on the Hono context under the reserved
    // `logger` slot; type coverage of this variable is added in a later
    // ticket that widens AppVariables (out of DIS-008 file scope).
    (c.set as (k: string, v: unknown) => void)('logger', requestLogger);

    await next();
  };
}
