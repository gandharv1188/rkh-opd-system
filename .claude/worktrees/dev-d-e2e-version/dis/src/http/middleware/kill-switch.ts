/**
 * DIS-100 — Kill-switch middleware (CS-9 emergency stop).
 *
 * When the kill-switch is enabled, every write request (POST/PUT/PATCH/DELETE)
 * short-circuits with HTTP 503 and a `Retry-After` header; read requests pass
 * through untouched so that clinicians retain read-only access to the record.
 *
 * The enabled check is dependency-injected:
 *   1. `isEnabled` — explicit async/sync predicate (preferred for tests).
 *   2. `db` — a `DatabasePort`; a SELECT against `dis_kill_switch` returns
 *      the single-row flag. The table is scheduled for a future migration;
 *      until it exists this path is used only when a fake DB is injected.
 *   3. No deps → default off (safe for dev/test boot).
 *
 * The response body matches the canonical error envelope from
 * `error-envelope.ts` so clients get a uniform shape across all errors.
 */

import type { MiddlewareHandler } from 'hono';
import type { DatabasePort } from '../../ports/database.js';
import type { AppVariables } from '../server.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_RETRY_AFTER_SECONDS = 300;

export interface KillSwitchDeps {
  /** Injectable predicate — takes precedence over `db` when both are given. */
  readonly isEnabled?: () => boolean | Promise<boolean>;
  /** DB-backed check against `dis_kill_switch.enabled`. */
  readonly db?: DatabasePort;
  /** `Retry-After` header value in seconds. Defaults to 300 (5 minutes). */
  readonly retryAfterSeconds?: number;
}

export function killSwitch(
  deps: KillSwitchDeps = {},
): MiddlewareHandler<{ Variables: AppVariables }> {
  const retryAfter = deps.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
  const check = deps.isEnabled ?? makeDbCheck(deps.db);

  return async (c, next) => {
    if (!WRITE_METHODS.has(c.req.method)) return next();
    const enabled = await check();
    if (!enabled) return next();

    c.header('Retry-After', String(retryAfter));
    return c.json(
      {
        error: {
          code: 'KILL_SWITCH_ACTIVE',
          message: 'Document ingestion is temporarily disabled. Use the legacy flow.',
          retryable: true,
          correlation_id: c.get('correlationId') ?? '',
        },
      },
      503,
    );
  };
}

function makeDbCheck(db: DatabasePort | undefined): () => Promise<boolean> {
  if (!db) return async () => false;
  return async () => {
    const row = await db.queryOne<{ enabled: boolean }>(
      'SELECT enabled FROM dis_kill_switch LIMIT 1',
      [],
    );
    return row?.enabled === true;
  };
}
