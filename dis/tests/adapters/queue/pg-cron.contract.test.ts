import { describe, it, expect } from 'vitest';
import { PgCronAdapter } from '../../../src/adapters/queue/pg-cron.js';
import type { QueuePort } from '../../../src/ports/queue.js';
import type { DatabasePort, ExtractionRow, InsertExtractionInput } from '../../../src/ports/database.js';
import type { State } from '../../../src/core/state-machine.js';

type Call = { sql: string; params: readonly unknown[] };

/**
 * Minimal DatabasePort fake sufficient for PgCronAdapter tests — only `query`
 * is exercised; extraction-lifecycle methods throw to surface any accidental
 * use. Records every call so assertions can check emitted SQL and params.
 */
function fakeDb(
  queryResponder?: (sql: string, params: readonly unknown[]) => readonly unknown[],
): DatabasePort & { readonly calls: Call[] } {
  const calls: Call[] = [];
  const base: DatabasePort = {
    async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
      calls.push({ sql, params });
      const rows = queryResponder ? queryResponder(sql, params) : [];
      return rows as readonly T[];
    },
    async queryOne<T>(sql: string, params: readonly unknown[]): Promise<T | null> {
      calls.push({ sql, params });
      const rows = queryResponder ? queryResponder(sql, params) : [];
      return (rows[0] as T) ?? null;
    },
    async transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T> {
      return work(base);
    },
    async setSessionVars(): Promise<void> {
      /* no-op */
    },
    async findExtractionById(): Promise<ExtractionRow | null> {
      throw new Error('not used');
    },
    async findExtractionByIdempotencyKey(): Promise<ExtractionRow | null> {
      throw new Error('not used');
    },
    async updateExtractionStatus(
      _id: string,
      _expectedVersion: number,
      _newStatus: State,
    ): Promise<ExtractionRow | null> {
      throw new Error('not used');
    },
    async insertExtraction(_input: InsertExtractionInput): Promise<ExtractionRow> {
      throw new Error('not used');
    },
  };
  return Object.assign(base, { calls });
}

describe('PgCronAdapter — QueuePort contract', () => {
  it('binds to QueuePort (structural)', () => {
    const db = fakeDb();
    const adapter: QueuePort = new PgCronAdapter({ db });
    expect(typeof adapter.enqueue).toBe('function');
    expect(typeof adapter.startConsumer).toBe('function');
  });

  it('enqueue inserts into dis_jobs and returns the generated message id', async () => {
    const db = fakeDb((sql) => {
      if (sql.includes('INSERT INTO dis_jobs')) {
        return [{ id: '00000000-0000-0000-0000-000000000001' }];
      }
      return [];
    });
    const adapter = new PgCronAdapter({ db });

    const result = await adapter.enqueue('process-document', {
      extractionId: 'ext-1',
      attempt: 1,
    });

    expect(result.messageId).toBe('00000000-0000-0000-0000-000000000001');
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]!.sql).toMatch(/INSERT INTO dis_jobs/);
    const [topic, payload] = db.calls[0]!.params;
    expect(topic).toBe('process-document');
    const parsed = JSON.parse(payload as string) as Record<string, unknown>;
    expect(parsed).toEqual({ extractionId: 'ext-1', attempt: 1 });
  });

  it('honours delaySec via a computed visible_at timestamp parameter', async () => {
    const db = fakeDb(() => [{ id: 'mid-delay' }]);
    const adapter = new PgCronAdapter({ db, now: () => 1_700_000_000_000 });

    await adapter.enqueue('process-document', { k: 'v' }, { delaySec: 30 });

    expect(db.calls).toHaveLength(1);
    const params = db.calls[0]!.params;
    const visibleAt = params[params.length - 1];
    expect(visibleAt).toBeInstanceOf(Date);
    expect((visibleAt as Date).getTime()).toBe(1_700_000_000_000 + 30_000);
  });

  it('defaults visible_at to now() when delaySec is omitted', async () => {
    const db = fakeDb(() => [{ id: 'mid-nodelay' }]);
    const fixed = 1_700_000_000_000;
    const adapter = new PgCronAdapter({ db, now: () => fixed });

    await adapter.enqueue('process-document', { k: 'v' });

    const params = db.calls[0]!.params;
    const visibleAt = params[params.length - 1] as Date;
    expect(visibleAt.getTime()).toBe(fixed);
  });

  it('rejects non-JSON-serialisable payloads at the adapter boundary', async () => {
    const db = fakeDb(() => [{ id: 'mid-x' }]);
    const adapter = new PgCronAdapter({ db });

    const bad = { n: BigInt(1) } as unknown as Record<string, unknown>;
    await expect(adapter.enqueue('t', bad)).rejects.toThrow(/serialis|json/i);
  });

  it('throws when dis_jobs INSERT returns no id', async () => {
    const db = fakeDb(() => []);
    const adapter = new PgCronAdapter({ db });

    await expect(adapter.enqueue('t', { k: 'v' })).rejects.toThrow(/dis_jobs|id/i);
  });

  it('startConsumer is a no-op in POC (pg_cron + pg_net dispatch)', async () => {
    const db = fakeDb();
    const adapter = new PgCronAdapter({ db });

    await expect(
      adapter.startConsumer('process-document', async () => {
        /* noop */
      }),
    ).resolves.toBeUndefined();

    expect(db.calls).toHaveLength(0);
  });
});
