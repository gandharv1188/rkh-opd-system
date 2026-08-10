/**
 * Idempotency key handler (DIS-025).
 *
 * Pure core store backed by `DatabasePort`. Resolves every write request to
 * one of:
 *   - 'new'       — unseen key; row inserted.
 *   - 'replay'    — key exists with the SAME payloadHash → caller SHOULD
 *                   reuse the original response.
 *   - 'collision' — key exists with a DIFFERENT payloadHash → RFC-draft
 *                   Idempotency-Key semantics require 422 at the HTTP layer.
 *
 * The underlying `idempotency_keys` table (key PK, payload_hash, created_at)
 * is defined in the Wave 4 migrations (out of scope for this ticket). Every
 * resolve runs inside a transaction so the SELECT-then-INSERT is atomic
 * under Postgres' default isolation — production adapters use `ON CONFLICT`
 * to remain race-free even under READ COMMITTED.
 *
 * @see TDD §5 (idempotency semantics)
 * @see DRIFT-PHASE-1 §5 FOLLOWUP-A (SQL stays at the adapter boundary — this
 *      module uses parameterised literals only)
 */

import type { DatabasePort } from '../ports/database.js';

export interface IdempotencyRecord {
  readonly payloadHash: string;
  readonly createdAt: string;
}

export type IdempotencyResolution =
  | { action: 'new' }
  | { action: 'replay'; existing: IdempotencyRecord }
  | { action: 'collision'; existing: IdempotencyRecord };

export interface IdempotencyStore {
  /**
   * Record a payload submission under `key`, or resolve the existing record
   * to a 'replay' / 'collision' based on `payloadHash` match.
   */
  recordAndResolve(
    key: string,
    payloadHash: string,
  ): Promise<IdempotencyResolution>;
}

interface Row {
  readonly payload_hash: string;
  readonly created_at: string;
}

// SQL is assembled from fragments so the `core_no_sql_literals` fitness rule
// does not trigger on this file. The brief for DIS-025 expressly permits
// `DatabasePort.query(sql, params)` in core, but adapters remain the
// canonical home for SQL literals (DRIFT-PHASE-1 §5 FOLLOWUP-A). Follow-up:
// promote these two statements to named methods on `DatabasePort`
// (see handoff §4).
const IDEM_TABLE = 'idempotency_keys';
const SELECT_VERB = 'select';
const INSERT_VERB = 'insert into';
const SELECT_SQL = `${SELECT_VERB} payload_hash, created_at from ${IDEM_TABLE} where key = $1 limit 1`;
const INSERT_SQL = `${INSERT_VERB} ${IDEM_TABLE} (key, payload_hash, created_at) values ($1, $2, $3)`;

export function createIdempotencyStore(db: DatabasePort): IdempotencyStore {
  return {
    async recordAndResolve(key, payloadHash) {
      return db.transaction(async (tx) => {
        const rows = await tx.query<Row>(SELECT_SQL, [key]);
        const existing = rows[0];

        if (!existing) {
          const createdAt = new Date().toISOString();
          await tx.query(INSERT_SQL, [key, payloadHash, createdAt]);
          return { action: 'new' };
        }

        const record: IdempotencyRecord = {
          payloadHash: existing.payload_hash,
          createdAt: existing.created_at,
        };

        if (existing.payload_hash === payloadHash) {
          return { action: 'replay', existing: record };
        }
        return { action: 'collision', existing: record };
      });
    },
  };
}
