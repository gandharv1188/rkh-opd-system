import type { Hono } from 'hono';
import type { DatabasePort, ExtractionRow } from '../../ports/database.js';
import type { AppVariables } from '../server.js';
import { HttpError } from '../middleware/error-envelope.js';

/**
 * Dependencies for `GET /extractions` (DIS-095).
 *
 * Cursor-paginated queue listing filtered by status / patient_id.
 * RLS is enforced in the adapter via session vars; this route is a thin
 * parameterised SQL shim. SQL literal lives here (adapter-side of the
 * port) per DRIFT-PHASE-1 §5 FOLLOWUP-A — fitness rule
 * `core_no_sql_literals` only scans `dis/src/core/**`.
 *
 * Note: base migration M-001 (`ocr_extractions`) has no `operator_id`
 * column. The listing surface therefore supports `status` and
 * `patient_id` filters; the backlog's `operator_id` filter is documented
 * as a limitation until a schema migration adds the column.
 */
export interface ExtractionsListRouteDeps {
  readonly db: DatabasePort;
  /** Max/default page size; hard cap 200. */
  readonly maxLimit?: number;
}

const DEFAULT_LIMIT = 50;
const HARD_CAP = 200;

export function registerExtractionsListRoute(
  app: Hono<{ Variables: AppVariables }>,
  deps: ExtractionsListRouteDeps,
): void {
  const defaultLimit = deps.maxLimit ?? DEFAULT_LIMIT;

  app.get('/extractions', async (c) => {
    const status = c.req.query('status');
    const patientId = c.req.query('patient_id');
    const cursor = c.req.query('cursor');
    const limitStr = c.req.query('limit');

    const parsedLimit = limitStr ? Number.parseInt(limitStr, 10) : defaultLimit;
    if (!Number.isFinite(parsedLimit) || Number.isNaN(parsedLimit) || parsedLimit < 1) {
      throw new HttpError(400, 'INVALID_LIMIT', 'limit must be a positive integer');
    }
    const limit = Math.min(parsedLimit, HARD_CAP);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (patientId) {
      params.push(patientId);
      conditions.push(`patient_id = $${params.length}`);
    }
    if (cursor) {
      params.push(cursor);
      conditions.push(`id > $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Fetch limit+1 to detect "more rows exist".
    params.push(limit + 1);
    const sql = `SELECT * FROM ocr_extractions ${where} ORDER BY id ASC LIMIT $${params.length}`;

    const rows = await deps.db.query<ExtractionRow>(sql, params);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = page[page.length - 1];
    const nextCursor = hasMore && lastRow ? lastRow.id : null;

    return c.json(
      {
        items: page,
        next_cursor: nextCursor,
        correlation_id: c.get('correlationId') ?? '',
      },
      200,
    );
  });
}
