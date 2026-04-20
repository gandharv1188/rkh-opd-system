/**
 * Test fake for SupabasePostgresAdapter consumers.
 *
 * Records every call so integration tests can assert on emitted SQL and
 * parameters without spinning up a real Postgres instance. Transactions are
 * flat: `transaction(work)` invokes `work(this)` so session-var scope is
 * trivially shared — enough for wiring and orchestrator tests.
 */

import type { DatabasePort } from '../../../ports/database.js';

export type FakeSqlCall = {
  readonly sql: string;
  readonly params: readonly unknown[];
};

export class FakeSupabasePostgresAdapter implements DatabasePort {
  readonly calls: FakeSqlCall[] = [];
  readonly sessionVars: Record<string, string> = {};
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
}
