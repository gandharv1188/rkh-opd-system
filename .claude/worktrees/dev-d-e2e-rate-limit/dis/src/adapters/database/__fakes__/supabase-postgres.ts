/**
 * Test fake for SupabasePostgresAdapter consumers.
 *
 * Records every call so integration tests can assert on emitted SQL and
 * parameters without spinning up a real Postgres instance. Transactions are
 * flat: `transaction(work)` invokes `work(this)` so session-var scope is
 * trivially shared — enough for wiring and orchestrator tests.
 *
 * Also implements the named extraction-lifecycle methods on DatabasePort
 * (findExtractionById, findExtractionByIdempotencyKey, insertExtraction,
 * updateExtractionStatus) backed by an in-memory row store with
 * optimistic-lock semantics on `version`. Calls are recorded in the shared
 * `calls` array using a synthetic SQL marker so assertions can distinguish
 * generic queries from named-method invocations.
 */

import type {
  DatabasePort,
  ExtractionRow,
  InsertExtractionInput,
} from '../../../ports/database.js';
import type { State } from '../../../core/state-machine.js';

export type FakeSqlCall = {
  readonly sql: string;
  readonly params: readonly unknown[];
};

export class FakeSupabasePostgresAdapter implements DatabasePort {
  readonly calls: FakeSqlCall[] = [];
  readonly sessionVars: Record<string, string> = {};
  readonly rows: ExtractionRow[] = [];
  private nextRows: readonly unknown[] = [];

  setNextRows(rows: readonly unknown[]): void {
    this.nextRows = rows;
  }

  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    this.calls.push({ sql, params });
    const rows = this.nextRows as readonly T[];
    this.nextRows = [];
    return Object.freeze(rows.slice());
  }

  async queryOne<T>(sql: string, params: readonly unknown[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T> {
    this.calls.push({ sql: 'BEGIN', params: [] });
    try {
      const result = await work(this);
      this.calls.push({ sql: 'COMMIT', params: [] });
      return result;
    } catch (err) {
      this.calls.push({ sql: 'ROLLBACK', params: [] });
      throw err;
    }
  }

  async setSessionVars(vars: Readonly<Record<string, string>>): Promise<void> {
    for (const [key, value] of Object.entries(vars)) {
      this.sessionVars[key] = value;
      this.calls.push({ sql: `SET LOCAL ${key} = $1`, params: [value] });
    }
  }

  async findExtractionById(id: string): Promise<ExtractionRow | null> {
    this.calls.push({ sql: 'findExtractionById', params: [id] });
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findExtractionByIdempotencyKey(key: string): Promise<ExtractionRow | null> {
    this.calls.push({ sql: 'findExtractionByIdempotencyKey', params: [key] });
    return this.rows.find((r) => r.idempotency_key === key) ?? null;
  }

  async updateExtractionStatus(
    id: string,
    expectedVersion: number,
    newStatus: State,
  ): Promise<ExtractionRow | null> {
    this.calls.push({
      sql: 'updateExtractionStatus',
      params: [id, expectedVersion, newStatus],
    });
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.version !== expectedVersion) return null;
    row.status = newStatus;
    row.version += 1;
    return row;
  }

  async insertExtraction(input: InsertExtractionInput): Promise<ExtractionRow> {
    this.calls.push({
      sql: 'insertExtraction',
      params: [
        input.id,
        input.patientId,
        input.status,
        input.idempotencyKey,
        input.payloadHash,
        input.parentExtractionId,
      ],
    });
    const row: ExtractionRow = {
      id: input.id,
      patient_id: input.patientId,
      status: input.status,
      version: 1,
      idempotency_key: input.idempotencyKey,
      payload_hash: input.payloadHash,
      parent_extraction_id: input.parentExtractionId,
    };
    this.rows.push(row);
    return row;
  }
}
