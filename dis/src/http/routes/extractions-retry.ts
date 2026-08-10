/**
 * POST /extractions/:id/retry — create a new extraction from the same
 * upload. The original extraction is preserved (audit trail). The new
 * row carries `parent_extraction_id` back to the original id.
 *
 * Idempotency: orchestrator.retry() uses `retry:${newId}` internally, so
 * callers do NOT supply an Idempotency-Key header.
 *
 * Errors:
 *   - 400 MISSING_ACTOR         — neither body.actor nor X-Operator-Id header.
 *   - 404 EXTRACTION_NOT_FOUND  — ExtractionNotFoundError (via error-handler).
 *   - 500 INTERNAL              — unhandled.
 *
 * @see backlog line 2122 (DIS-094)
 * @see TDD §4
 */

import type { Hono } from 'hono';
import type { IngestionOrchestrator } from '../../core/orchestrator.js';
import { HttpError } from '../middleware/error-envelope.js';

export interface ExtractionsRetryRouteDeps {
  readonly orchestrator: IngestionOrchestrator;
}

export function registerExtractionsRetryRoute(
  app: Hono,
  deps: ExtractionsRetryRouteDeps,
): void {
  app.post('/extractions/:id/retry', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { actor?: string };
    const actor = body.actor ?? c.req.header('X-Operator-Id') ?? '';
    if (!actor) {
      throw new HttpError(
        400,
        'MISSING_ACTOR',
        'actor (body) or X-Operator-Id header required',
      );
    }

    const record = await deps.orchestrator.retry({ id, actor });

    return c.json(
      {
        extraction_id: record.id,
        parent_extraction_id: record.parentExtractionId,
        status: record.status,
        version: record.version,
        correlation_id:
          ((c as unknown as { get: (k: string) => string | undefined }).get('correlationId')) ?? '',
      },
      201,
    );
  });
}
