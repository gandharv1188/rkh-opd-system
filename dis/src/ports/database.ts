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
 */

/**
 * Database port.
 *
 * Parameterised queries only — adapters MUST reject string-interpolated SQL.
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
}
