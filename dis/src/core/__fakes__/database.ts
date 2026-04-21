/**
 * In-memory fake DatabasePort for orchestrator unit tests.
 *
 * Implements the named domain methods on {@link DatabasePort}
 * (findExtractionById, findExtractionByIdempotencyKey, insertExtraction,
 * updateExtractionStatus) with optimistic-lock semantics on `version`.
 *
 * The generic `query`/`queryOne` methods remain for arbitrary
 * parameterised SQL that is not covered by the named contract; they never
 * dispatch on extraction-shaped SQL — all extraction access flows through
 * the named methods (DRIFT-PHASE-1 §5 FOLLOWUP-A).
 */

import type { DatabasePort, ExtractionRow, InsertExtractionInput } from '../../ports/database.js';
import type { State } from '../state-machine.js';

export type FakeExtractionRow = ExtractionRow & { created_at: string };

export class FakeDatabase implements DatabasePort {
  readonly rows: FakeExtractionRow[] = [];
  readonly calls: Array<{ op: string; args: unknown }> = [];

  async query<T>(_sql: string, _params: readonly unknown[]): Promise<readonly T[]> {
    this.calls.push({ op: 'query', args: { sql: _sql, params: _params } });
    return [];
  }

  async queryOne<T>(sql: string, params: readonly unknown[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T> {
    return work(this);
  }

  async setSessionVars(_vars: Readonly<Record<string, string>>): Promise<void> {
    // no-op for fake
  }

  async findExtractionById(id: string): Promise<ExtractionRow | null> {
    this.calls.push({ op: 'findExtractionById', args: { id } });
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findExtractionByIdempotencyKey(key: string): Promise<ExtractionRow | null> {
    this.calls.push({ op: 'findExtractionByIdempotencyKey', args: { key } });
    return this.rows.find((r) => r.idempotency_key === key) ?? null;
  }

  async updateExtractionStatus(
    id: string,
    expectedVersion: number,
    newStatus: State,
  ): Promise<ExtractionRow | null> {
    this.calls.push({
      op: 'updateExtractionStatus',
      args: { id, expectedVersion, newStatus },
    });
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.version !== expectedVersion) return null;
    row.status = newStatus;
    row.version += 1;
    return row;
  }

  async insertExtraction(input: InsertExtractionInput): Promise<ExtractionRow> {
    this.calls.push({ op: 'insertExtraction', args: input });
    const row: FakeExtractionRow = {
      id: input.id,
      patient_id: input.patientId,
      status: input.status,
      version: 1,
      idempotency_key: input.idempotencyKey,
      payload_hash: input.payloadHash,
      created_at: new Date().toISOString(),
      parent_extraction_id: input.parentExtractionId,
    };
    this.rows.push(row);
    return row;
  }
}
