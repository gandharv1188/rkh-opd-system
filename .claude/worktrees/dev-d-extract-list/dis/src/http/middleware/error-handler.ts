import type { ErrorHandler } from 'hono';
import type { AppVariables } from '../server.js';
import {
  VersionConflictError,
  ExtractionNotFoundError,
  OrchestratorError,
} from '../../core/orchestrator.js';
import { HttpError } from './error-envelope.js';

/**
 * Structural logger the handler will write to. Shaped as a subset of the
 * project's pino logger so callers can inject either the real logger or a
 * test spy without dragging in the pino type surface.
 */
export interface ErrorHandlerLogger {
  error: (obj: object, msg?: string) => void;
}

export interface ErrorHandlerDeps {
  readonly logger?: ErrorHandlerLogger;
}

interface EnvelopeBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    correlation_id: string;
    details?: Record<string, unknown>;
  };
}

function envelope(
  code: string,
  message: string,
  retryable: boolean,
  correlation_id: string,
  details?: Record<string, unknown>,
): EnvelopeBody {
  return {
    error: {
      code,
      message,
      retryable,
      correlation_id,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/**
 * Hono `onError` handler that maps domain errors to the canonical error
 * envelope and logs unhandled exceptions with the correlation_id.
 *
 * Never leaks stack traces or raw error messages from unknown errors to
 * the client — only `HttpError` and `OrchestratorError` subclasses (which
 * carry caller-safe messages) pass their message through.
 *
 * Retryable semantics (per 04_api/error_model.md):
 *   - 5xx and 429          → retryable
 *   - Version conflict     → NOT retryable (client must reload first)
 *   - Unsupported media    → NOT retryable
 *   - Extraction not found → NOT retryable
 */
export function errorHandler(
  deps: ErrorHandlerDeps = {},
): ErrorHandler<{ Variables: AppVariables }> {
  return (err, c) => {
    const correlation_id = c.get('correlationId') ?? '';
    deps.logger?.error({ err, correlation_id }, 'unhandled-error');

    if (err instanceof HttpError) {
      return c.json(
        envelope(err.code, err.message, err.retryable, correlation_id, err.details),
        err.status as Parameters<typeof c.json>[1],
      );
    }

    if (err instanceof VersionConflictError) {
      return c.json(
        envelope('VERSION_CONFLICT', err.message, false, correlation_id, {
          current_version: err.currentVersion,
          current_status: err.currentStatus,
        }),
        409,
      );
    }

    if (err instanceof ExtractionNotFoundError) {
      return c.json(
        envelope('EXTRACTION_NOT_FOUND', err.message, false, correlation_id),
        404,
      );
    }

    if (err instanceof OrchestratorError) {
      const status: number =
        err.code === 'IDEMPOTENCY_KEY_CONFLICT'
          ? 409
          : err.code === 'UNSUPPORTED_MEDIA'
            ? 415
            : 500;
      const retryable = status >= 500 || status === 429;
      return c.json(
        envelope(err.code, err.message, retryable, correlation_id),
        status as Parameters<typeof c.json>[1],
      );
    }

    return c.json(
      envelope('INTERNAL', 'Internal server error.', true, correlation_id),
      500,
    );
  };
}
