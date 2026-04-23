import { describe, it, expect } from 'vitest';
import { writeLedgerRow } from '../../src/core/cost-ledger.js';
import type { DatabasePort } from '../../src/ports/database.js';

describe('cost-ledger', () => {
  function makeFakeDb() {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const db: Partial<DatabasePort> = {
      async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
        calls.push({ sql, params });
        return [] as T[];
      },
    };
    return { db: db as DatabasePort, calls };
  }

  it('writes ledger row per adapter call', async () => {
    const { db, calls } = makeFakeDb();
    await writeLedgerRow(db, {
      provider: 'datalab', operation: 'ocr.extract',
      tokens_input: 100, tokens_output: 200, pages: 3,
      cost_micro_inr: 5000, correlation_id: 'corr-1', extraction_id: 'ext-1',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/INSERT INTO dis_cost_ledger/i);
    expect(calls[0]!.params.slice(0, 6)).toEqual(['datalab', 'ocr.extract', 100, 200, 3, 5000]);
  });

  it('nulls out optional fields when undefined', async () => {
    const { db, calls } = makeFakeDb();
    await writeLedgerRow(db, { provider: 'x', operation: 'y', cost_micro_inr: 1 });
    expect(calls[0]!.params[2]).toBeNull();
    expect(calls[0]!.params[3]).toBeNull();
    expect(calls[0]!.params[4]).toBeNull();
  });
});
