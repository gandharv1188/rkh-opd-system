/**
 * Database port — Postgres access abstraction used by both the Supabase POC
 * (via PostgREST / `pg`) and the AWS production deployment (RDS via `pg`).
 *
 * Session variables (`app.role`, `app.patient_id`, …) are the contract
 * surface for Row-Level Security; any adapter MUST scope them to the current
 * transaction/connection and reset them on release.
 *
 * @see coding_standards.md §6
 * @see portability.md §Database portability
 * @see ADR-006 (postgres driver over pg or drizzle)
 * @see DRIFT-PHASE-1 §5 FOLLOWUP-A (SQL literals belong at the adapter boundary)
 */
import type { State } from '../core/state-machine.js';

/**
 * Persisted shape of an `extractions` row. Lives on the port so that both
 * the core (which only sees this as opaque data through the named methods
 * below) and adapters (which translate it to/from SQL) agree on the schema.
 */
export type ExtractionRow = {
  id: string;
  patient_id: string;
  status: State;
  version: number;
  idempotency_key: string;
  payload_hash: string;
  parent_extraction_id: string | null;
};

/** Parameters for inserting a brand-new extraction row. */
export type InsertExtractionInput = {
  id: string;
  patientId: string;
  status: State;
  idempotencyKey: string;
  payloadHash: string;
  parentExtractionId: string | null;
};

/**
 * Database port.
 *
 * Parameterised queries only — adapters MUST reject string-interpolated SQL.
 * Named domain methods (findExtraction*, updateExtractionStatus, …)
 * encapsulate SQL so that core code does not embed SQL literals — per
 * ADR-006 and DRIFT-PHASE-1 §5 FOLLOWUP-A.
 *
 * @see coding_standards.md §6
 */
export interface DatabasePort {
  /**
   * Execute a parameterised SQL statement and return all rows.
   *
   * `T` is the row shape the caller expects; adapters do not validate it —
   * callers are responsible for schema validation when row shape matters.
   */
  query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]>;

  /**
   * Execute a parameterised SQL statement and return the first row, or
   * `null` if the result set is empty.
   */
  queryOne<T>(sql: string, params: readonly unknown[]): Promise<T | null>;

  /**
   * Run `work` inside a database transaction. The transactional
   * {@link DatabasePort} handle passed to `work` MUST route all queries
   * through the same connection so that session variables and locks are
   * scoped correctly.
   */
  transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T>;

  /**
   * Set Postgres session-level variables used by RLS policies
   * (e.g. `app.role`, `app.patient_id`). Values are applied via
   * `SET LOCAL` inside a transaction, or the equivalent connection-scoped
   * mechanism outside of one.
   *
   * @see coding_standards.md §6
   * @see portability.md §Database portability
   */
  setSessionVars(vars: Readonly<Record<string, string>>): Promise<void>;

  /** Fetch an extraction row by id. Returns `null` when absent. */
  findExtractionById(id: string): Promise<ExtractionRow | null>;

  /**
   * Fetch an extraction row by idempotency key. Returns `null` when absent.
   * Used by the ingest path to detect duplicate submissions.
   */
  findExtractionByIdempotencyKey(key: string): Promise<ExtractionRow | null>;

  /**
   * Optimistic-lock status update. Updates `status` to `newStatus` iff the
   * stored version matches `expectedVersion`, bumping version on success.
   * Returns the updated row, or `null` when no row matched — caller must
   * distinguish "not found" vs "version conflict" via a follow-up read.
   */
  updateExtractionStatus(
    id: string,
    expectedVersion: number,
    newStatus: State,
  ): Promise<ExtractionRow | null>;

  /** Insert a new extraction row, returning the persisted form (version=1). */
  insertExtraction(input: InsertExtractionInput): Promise<ExtractionRow>;
}
