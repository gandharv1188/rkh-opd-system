import type { ErrorHandler } from 'hono';
import type { AppVariables } from '../server.js';

/**
 * Canonical error envelope body — see 04_api/error_model.md.
 */
export interface ErrorEnvelopeBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable: boolean;
    request_id?: string;
    correlation_id: string;
  };
}

/**
 * Thrown by handlers to produce a well-formed error response.
 *
 * `status` drives the HTTP status; `code` is the stable machine-readable
 * identifier from 04_api/error_model.md.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    retryable?: boolean,
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = retryable ?? defaultRetryable(status);
  }
}

function defaultRetryable(status: number): boolean {
  // Per error_model.md: 5xx, 429, 502, 504 are retryable by default.
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

/**
 * Hono `onError` handler that converts thrown errors into the canonical
 * JSON envelope. Binds `error.correlation_id` from the request context so
 * clients can cross-reference logs.
 */
export function errorEnvelope(): ErrorHandler<{ Variables: AppVariables }> {
  return (err, c) => {
    const correlation_id = c.get('correlationId') ?? '';

    if (err instanceof HttpError) {
      const body: ErrorEnvelopeBody = {
        error: {
          code: err.code,
          message: err.message,
          retryable: err.retryable,
          correlation_id,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      };
      return c.json(body, err.status as Parameters<typeof c.json>[1]);
    }

    const body: ErrorEnvelopeBody = {
      error: {
        code: 'INTERNAL',
        message: 'Internal server error.',
        retryable: true,
        correlation_id,
      },
    };
    return c.json(body, 500);
  };
}
