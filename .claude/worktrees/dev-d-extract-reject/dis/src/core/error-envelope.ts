import { currentCorrelationId } from './correlation.js';

/**
 * Canonical error envelope shape used by DIS error responses.
 *
 * This is the CORE-side builder output. The HTTP middleware in
 * `dis/src/http/middleware/error-envelope.ts` owns its own envelope
 * shape with additional fields (`retryable`, `request_id`); this
 * builder intentionally keeps the minimal contract defined in the
 * DIS-029 brief so non-HTTP call sites (queue workers, background
 * jobs, audit sinks) have a stable structural error representation.
 */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    correlation_id: string;
    details?: unknown;
  };
}

/** Explicit name → envelope-code overrides per DIS-029 brief + error_model.md. */
const EXPLICIT_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  OcrProviderTimeoutError: 'OCR_PROVIDER_TIMEOUT',
  OcrProviderRateLimitedError: 'RATE_LIMITED',
  VersionConflictError: 'VERSION_CONFLICT',
});

/**
 * Convert a PascalCase class-name suffix-stripped token to UPPER_SNAKE.
 * Examples: `InvalidStateTransition` → `INVALID_STATE_TRANSITION`,
 * `FooBarBaz` → `FOO_BAR_BAZ`.
 */
function toUpperSnake(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

/** Map an error instance (or any thrown value) to its envelope code. */
function codeFor(err: unknown): string {
  if (!(err instanceof Error)) return 'INTERNAL_ERROR';

  const name = err.name || err.constructor?.name || '';
  if (EXPLICIT_OVERRIDES[name]) return EXPLICIT_OVERRIDES[name]!;

  if (name.endsWith('Error') && name !== 'Error') {
    const bare = name.slice(0, -'Error'.length);
    if (bare.length === 0) return 'INTERNAL_ERROR';
    return toUpperSnake(bare);
  }

  return 'INTERNAL_ERROR';
}

function messageFor(err: unknown): string {
  if (err instanceof Error && typeof err.message === 'string' && err.message.length > 0) {
    return err.message;
  }
  return 'Internal server error.';
}

/**
 * Build a canonical {@link ErrorEnvelope} from any thrown value.
 *
 * The correlation ID resolution order is:
 *   1. `correlationId` argument (explicit pass-through).
 *   2. The current AsyncLocalStorage scope (DIS-028).
 *   3. The string `"unknown"` — stable sentinel so logs can still be
 *      filtered without NULL handling.
 */
export function toEnvelope(err: unknown, correlationId?: string): ErrorEnvelope {
  const resolvedId = correlationId ?? currentCorrelationId() ?? 'unknown';
  return {
    error: {
      code: codeFor(err),
      message: messageFor(err),
      correlation_id: resolvedId,
    },
  };
}
