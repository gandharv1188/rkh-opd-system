import { describe, it, expect } from 'vitest';
import type { DatabasePort } from '../../src/ports/database.js';

class ConnectionDroppedError extends Error {
  constructor() {
    super('connection reset by peer');
    this.name = 'ConnectionDroppedError';
  }
}

/** Fake DB that drops after N queries inside a transaction. */
function makeFlakyDb(dropAfterQueries: number): DatabasePort {
  const inMemoryRows: Array<{ table: string; values: unknown[] }> = [];
  let committed = false;
  let queriesInTxn = 0;
  const insideTxn = { flag: false };

  const db: Partial<DatabasePort> = {
    async query<T>(_sql: string, _params: readonly unknown[]): Promise<readonly T[]> {
      if (insideTxn.flag) {
        queriesInTxn += 1;
        if (queriesInTxn >= dropAfterQueries) throw new ConnectionDroppedError();
      }
      return [] as T[];
    },
    async transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T> {
      insideTxn.flag = true;
      queriesInTxn = 0;
      const scratch: Array<{ table: string; values: unknown[] }> = [];
      const txDb: Partial<DatabasePort> = {
        query: async (_sql, _params) => {
          queriesInTxn += 1;
          if (queriesInTxn >= dropAfterQueries) throw new ConnectionDroppedError();
          // Scratch: buffered writes. Only committed if work() completes.
          scratch.push({ table: 'lab_results', values: ['fake'] });
          return [] as never;
        },
      };
      try {
        const result = await work(txDb as DatabasePort);
        // Commit scratch to in-memory store.
        inMemoryRows.push(...scratch);
        committed = true;
        return result;
      } finally {
        insideTxn.flag = false;
      }
    },
  };
  return Object.assign(db as DatabasePort, {
    __rows: () => inMemoryRows,
    __committed: () => committed,
  });
}

describe('Chaos: DB drop mid-txn', () => {
  it('no partial write persists', async () => {
    const db = makeFlakyDb(3); // drops after 3 queries
    let caught: unknown = null;
    try {
      await db.transaction(async (tx) => {
        await tx.query('INSERT INTO lab_results ...', []);
        await tx.query('INSERT INTO lab_results ...', []);
        await tx.query('INSERT INTO lab_results ...', []); // <-- drops here
        await tx.query('INSERT INTO lab_results ...', []); // never reached
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    // The in-memory store was never committed — no partial state.
    expect((db as unknown as { __rows: () => unknown[] }).__rows().length).toBe(0);
    expect((db as unknown as { __committed: () => boolean }).__committed()).toBe(false);
  });
});
