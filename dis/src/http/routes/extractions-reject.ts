import type { Hono } from 'hono';
import type { IngestionOrchestrator } from '../../core/orchestrator.js';
import type { AppVariables } from '../server.js';
import { HttpError } from '../middleware/error-envelope.js';

export interface ExtractionsRejectRouteDeps {
  readonly orchestrator: IngestionOrchestrator;
}

/**
 * Registers `POST /extractions/:id/reject` on the provided Hono app.
 *
 * Thin HTTP wrapper over `orchestrator.reject()`. Domain errors
 * (VersionConflictError, ExtractionNotFoundError) propagate to the
 * DIS-101 error handler for envelope mapping.
 */
export function registerExtractionsRejectRoute(
  app: Hono,
  deps: ExtractionsRejectRouteDeps,
): void {
  const typed = app as unknown as Hono<{ Variables: AppVariables }>;
  typed.post('/extractions/:id/reject', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => null)) as {
      expected_version?: number;
      actor?: string;
      reason_code?: string;
    } | null;

    if (!body || typeof body.expected_version !== 'number') {
      throw new HttpError(
        400,
        'MISSING_EXPECTED_VERSION',
        'Body must include expected_version (number)',
      );
    }
    const reasonCode = (body.reason_code ?? '').trim();
    if (!reasonCode) {
      throw new HttpError(400, 'MISSING_REASON', 'reason_code is required and non-empty');
    }
    const actor = body.actor ?? c.req.header('X-Operator-Id') ?? '';
    if (!actor) {
      throw new HttpError(400, 'MISSING_ACTOR', 'actor or X-Operator-Id required');
    }

    const record = await deps.orchestrator.reject({
      id,
      expectedVersion: body.expected_version,
      actor,
      reasonCode,
    });

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
