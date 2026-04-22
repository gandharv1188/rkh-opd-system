import type { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import type { IngestionOrchestrator } from '../../core/orchestrator.js';
import type { AppVariables } from '../server.js';
import { HttpError } from '../middleware/error-envelope.js';

export interface ProcessJobRouteDeps {
  readonly orchestrator: IngestionOrchestrator;
  /** Shared secret — callers present via X-Worker-Token. */
  readonly workerToken: string;
}

// Constant-time compare avoids leaking the worker token via response timing.
// Buffers of different length cannot be compared by timingSafeEqual, so the
// length check is handled first and itself returns false quickly — that is
// acceptable because the token length is not secret.
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Registers `POST /internal/process-job`.
 *
 * Invoked by the pg_cron worker (DIS tdd §5/§6). Runs
 * `orchestrator.process(extraction_id)` and returns the resulting record
 * summary. Orchestrator-thrown errors propagate to the DIS-101 handler.
 *
 * The worker token is injected via `deps.workerToken` rather than read from
 * `process.env` here — env wiring belongs in the composition root
 * (`createServer` caller), keeping this module test-pure.
 */
export function registerProcessJobRoute(
  app: Hono<{ Variables: AppVariables }>,
  deps: ProcessJobRouteDeps,
): void {
  app.post('/internal/process-job', async (c) => {
    const presented = c.req.header('X-Worker-Token') ?? '';
    if (!deps.workerToken || !constantTimeEquals(presented, deps.workerToken)) {
      throw new HttpError(403, 'FORBIDDEN', 'Worker token required');
    }

    const body = (await c.req.json().catch(() => null)) as
      | { extraction_id?: string }
      | null;
    if (!body?.extraction_id) {
      throw new HttpError(
        400,
        'MISSING_EXTRACTION_ID',
        'extraction_id required in body',
      );
    }

    const record = await deps.orchestrator.process(body.extraction_id);

    return c.json(
      {
        extraction_id: record.id,
        status: record.status,
        version: record.version,
        correlation_id: c.get('correlationId') ?? '',
      },
      200,
    );
  });
}
