import type { Hono } from 'hono';
import type { IngestionOrchestrator } from '../../core/orchestrator.js';
import type { AppVariables } from '../server.js';
import { HttpError } from '../middleware/error-envelope.js';

export interface ExtractionsApproveRouteDeps {
  readonly orchestrator: IngestionOrchestrator;
}

/**
 * Registers `POST /extractions/:id/approve`.
 *
 * CS-1: every state change flows through `orchestrator.approve()` — the
 * state machine rejects bypass attempts, so this handler never shortcuts.
 * CS-10: promotion dedupe is enforced by DB unique indexes (M-007); the
 * handler only surfaces the orchestrator result.
 *
 * `promotion.inserted` / `promotion.skipped` are placeholders pending an
 * orchestrator enhancement that returns the promotion summary alongside
 * the record (tracked in follow-up; TDD §13).
 */
export function registerExtractionsApproveRoute(
  app: Hono<{ Variables: AppVariables }>,
  deps: ExtractionsApproveRouteDeps,
): void {
  app.post('/extractions/:id/approve', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => null)) as
      | { expected_version?: number; actor?: string }
      | null;

    if (!body || typeof body.expected_version !== 'number') {
      throw new HttpError(
        400,
        'MISSING_EXPECTED_VERSION',
        'Body must include expected_version (number)',
      );
    }

    const actor = body.actor ?? c.req.header('X-Operator-Id') ?? '';
    if (!actor) {
      throw new HttpError(
        400,
        'MISSING_ACTOR',
        'actor (body) or X-Operator-Id header required',
      );
    }

    const record = await deps.orchestrator.approve({
      id,
      expectedVersion: body.expected_version,
      actor,
    });

    return c.json(
      {
        extraction_id: record.id,
        status: record.status,
        version: record.version,
        correlation_id: c.get('correlationId') ?? '',
        promotion: { inserted: 0, skipped: 0 },
      },
      200,
    );
  });
}
