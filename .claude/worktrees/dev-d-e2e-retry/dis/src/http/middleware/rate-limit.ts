import type { MiddlewareHandler } from 'hono';
import type { AppVariables } from '../server.js';

/**
 * Configuration for {@link rateLimit}.
 *
 * Defaults: 60 tokens per 10-minute window (TDD §6). The clock is
 * injectable so tests can advance time deterministically without
 * real-time sleeps.
 */
export interface RateLimitConfig {
  readonly maxTokens?: number;
  readonly refillPerMs?: number;
  readonly windowMs?: number;
  readonly now?: () => number;
  readonly operatorIdFromHeader?: string;
}

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

/**
 * Per-operator token-bucket rate limiter.
 *
 * Identifies the caller via the configured header (default `X-Operator-Id`).
 * Each operator gets an in-process bucket that starts full and refills
 * continuously at `maxTokens / windowMs` tokens per millisecond. When a
 * request finds fewer than one token, the middleware short-circuits with
 * a 429 + `Retry-After` (integer seconds) and the canonical error
 * envelope. POC storage is an in-process Map; a Redis-backed variant is
 * Phase-2 / production port (out of scope here).
 */
export function rateLimit(
  config: RateLimitConfig = {},
): MiddlewareHandler<{ Variables: AppVariables }> {
  const maxTokens = config.maxTokens ?? 60;
  const windowMs = config.windowMs ?? 600_000;
  const refillPerMs = config.refillPerMs ?? maxTokens / windowMs;
  const now = config.now ?? Date.now;
  const headerName = config.operatorIdFromHeader ?? 'X-Operator-Id';
  const buckets = new Map<string, Bucket>();

  return async (c, next) => {
    const operatorId = c.req.header(headerName);
    if (!operatorId) {
      return c.json(
        {
          error: {
            code: 'MISSING_OPERATOR_ID',
            message: `Missing ${headerName} header.`,
            retryable: false,
            correlation_id: c.get('correlationId') ?? '',
          },
        },
        400,
      );
    }

    const current = now();
    let bucket = buckets.get(operatorId);
    if (!bucket) {
      bucket = { tokens: maxTokens, lastRefillAt: current };
      buckets.set(operatorId, bucket);
    } else {
      const elapsed = current - bucket.lastRefillAt;
      bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillPerMs);
      bucket.lastRefillAt = current;
    }

    if (bucket.tokens < 1) {
      const missing = 1 - bucket.tokens;
      const retryAfterSec = Math.max(1, Math.ceil(missing / refillPerMs / 1000));
      c.header('Retry-After', String(retryAfterSec));
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: `Rate limit exceeded for operator ${operatorId}.`,
            retryable: true,
            correlation_id: c.get('correlationId') ?? '',
            details: { retry_after_seconds: retryAfterSec },
          },
        },
        429,
      );
    }

    bucket.tokens -= 1;
    return next();
  };
}
