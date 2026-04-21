import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { AppVariables } from '../server.js';

const HEADER = 'x-correlation-id';
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Correlation-ID middleware.
 *
 * Reads the inbound `x-correlation-id` header if present and well-formed
 * (UUIDv4), otherwise generates a new UUIDv4 via `node:crypto.randomUUID()`.
 * The value is stored on the Hono context under the `correlationId` key and
 * echoed on the response as `x-correlation-id`.
 */
export function correlationId(): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const inbound = c.req.header(HEADER);
    const id: string = inbound && UUID_V4_RE.test(inbound) ? inbound : randomUUID();
    c.set('correlationId', id);
    c.header(HEADER, id);
    await next();
  };
}
