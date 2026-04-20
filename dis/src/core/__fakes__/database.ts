/**
 * In-memory fake DatabasePort for orchestrator unit tests.
 *
 * Exposes a simple `extractions` table with optimistic-lock semantics on
 * `version`. Queries are matched via a tiny pattern dispatcher so tests
 * can exercise the orchestrator's UPDATE ... WHERE version = ? path.
 */

import type { DatabasePort } from '../../ports/database.js';

export type FakeExtractionRow = {
  id: string;
  patient_id: string;
  status: string;
  version: number;
  idempotency_key: string;
  payload_hash: string;
  created_at: string;
  parent_extraction_id: string | null;
};

export class FakeDatabase implements DatabasePort {
  readonly rows: FakeExtractionRow[] = [];
  readonly calls: Array<{ sql: string; params: readonly unknown[] }> = [];

  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    this.calls.push({ sql, params });
    const s = sql.trim().toLowerCase();

    if (s.startsWith('insert into extractions')) {
      const [id, patient_id, status, idempotency_key, payload_hash, parent] = params as [
        string,
        string,
        string,
        string,
        string,
        string | null,
      ];
      const row: FakeExtractionRow = {
        id,
        patient_id,
        status,
        version: 1,
        idempotency_key,
        payload_hash,
        created_at: new Date().toISOString(),
        parent_extraction_id: parent ?? null,
      };
      this.rows.push(row);
      return [row as unknown as T];
    }

    if (s.startsWith('select') && s.includes('from extractions')) {
      const id = params[0] as string;
      const found = this.rows.find((r) => r.id === id);
      return (found ? [found as unknown as T] : []) as readonly T[];
    }

    if (s.startsWith('update extractions')) {
      const [newStatus, id, expectedVersion] = params as [string, string, number];
      const row = this.rows.find((r) => r.id === id);
      if (!row || row.version !== expectedVersion) return [];
      row.status = newStatus;
      row.version += 1;
      return [row as unknown as T];
    }

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
}
