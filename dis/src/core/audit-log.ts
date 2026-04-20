/**
 * DIS-024 — Audit log writer (append-only contract).
 *
 * TDD §14 (observability) and CS-2 rationale (raw responses preserved)
 * extended to state transitions. The DB-layer trigger in
 * `03_data/data_model.md` enforces immutability at rest; this module
 * enforces it at the type level by exposing only `write`/`writeMany` —
 * mutating methods are deliberately absent from the `AuditLogger` class.
 *
 * @see radhakishan_system/docs/feature_plans/document_ingestion_service/02_architecture/tdd.md §14
 * @see radhakishan_system/docs/feature_plans/document_ingestion_service/03_data/data_model.md (ocr_audit_log)
 */

import type { DatabasePort } from '../ports/database.js';

export type AuditActorType = 'user' | 'system';

export type AuditEventType =
  | 'state_transition'
  | 'field_edit'
  | 'approve'
  | 'reject'
  | 'retry'
  | 'override';

export interface AuditEvent {
  readonly extractionId: string;
  readonly eventType: AuditEventType;
  readonly actorType: AuditActorType;
  readonly actorId: string | null;
  readonly correlationId: string;
  readonly fromState?: string | null;
  readonly toState?: string | null;
  readonly fieldPath?: string | null;
  readonly beforeValue?: unknown;
  readonly afterValue?: unknown;
  readonly note?: string | null;
}

export class AuditLogImmutableError extends Error {
  public readonly code = 'AUDIT_LOG_IMMUTABLE';
  public readonly attemptedOperation: 'update' | 'delete';

  constructor(attemptedOperation: 'update' | 'delete') {
    super(`ocr_audit_log is append-only; ${attemptedOperation} is not permitted`);
    this.name = 'AuditLogImmutableError';
    this.attemptedOperation = attemptedOperation;
  }
}

const INSERT_SQL = `insert into ocr_audit_log (
  extraction_id, event_type, actor_type, actor_id,
  from_state, to_state, field_path, before_value, after_value,
  note, correlation_id
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;

function paramsFor(event: AuditEvent): readonly unknown[] {
  return [
    event.extractionId,
    event.eventType,
    event.actorType,
    event.actorId,
    event.fromState ?? null,
    event.toState ?? null,
    event.fieldPath ?? null,
    event.beforeValue === undefined ? null : JSON.stringify(event.beforeValue),
    event.afterValue === undefined ? null : JSON.stringify(event.afterValue),
    event.note ?? null,
    event.correlationId,
  ];
}

export class AuditLogger {
  readonly #db: DatabasePort;

  constructor(db: DatabasePort) {
    this.#db = db;
  }

  async write(event: AuditEvent): Promise<void> {
    await this.#db.transaction(async (tx) => {
      await tx.query(INSERT_SQL, paramsFor(event));
    });
  }

  async writeMany(events: readonly AuditEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.#db.transaction(async (tx) => {
      for (const event of events) {
        await tx.query(INSERT_SQL, paramsFor(event));
      }
    });
  }
}
