import type { Hono } from 'hono';
import type { DatabasePort } from '../../ports/database.js';
import { HttpError } from '../middleware/error-envelope.js';
import type { AppVariables } from '../server.js';

/**
 * Dependencies for `GET /extractions/:id`.
 *
 * Only the `db` port is required — RLS enforcement is pushed down to the
 * adapter, which applies `app.role` / `app.patient_id` session vars before
 * the query. Cross-scope reads surface here as `null` rows and therefore
 * as 404s to the caller (deliberate: do not leak existence).
 */
export interface ExtractionsGetRouteDeps {
  readonly db: DatabasePort;
}

/**
 * Registers `GET /extractions/:id` on the provided Hono app.
 *
 * Returns a projection of the persisted extraction row for the verification
 * UI. The backlog (VERIFY-2) references additional fields
 * (raw_ocr_markdown, raw_ocr_blocks, structured, verified_structured,
 * confidence_summary) which are not yet exposed on `ExtractionRow`;
 * follow-up ticket will extend `DatabasePort` with a dedicated
 * verification view. See handoff §Gap.
 */
export function registerExtractionsGetRoute(
  app: Hono<{ Variables: AppVariables }>,
  deps: ExtractionsGetRouteDeps,
): void {
  app.get('/extractions/:id', async (c) => {
    const id = c.req.param('id');
    const row = await deps.db.findExtractionById(id);
    if (!row) {
      throw new HttpError(
        404,
        'EXTRACTION_NOT_FOUND',
        `extraction ${id} not found`,
      );
    }
    return c.json(
      {
        id: row.id,
        patient_id: row.patient_id,
        status: row.status,
        version: row.version,
        parent_extraction_id: row.parent_extraction_id,
      },
      200,
    );
  });
}
