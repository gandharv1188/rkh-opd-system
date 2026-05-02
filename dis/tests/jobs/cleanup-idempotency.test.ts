import { describe, it, expect } from 'vitest';
import type { DatabasePort } from '../../src/ports/database.js';
import { cleanupExpiredIdempotencyKeys } from '../../src/jobs/cleanup-idempotency.js';

function makeFakeDb(rowsToDeleteCount: number) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const db: Partial<DatabasePort> = {
    async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
      calls.push({ sql, params });
      return Array.from({ length: rowsToDeleteCount }, () => ({}) as T);
    },
  };
  return { db: db as DatabasePort, calls };
}

describe('idempotency cleanup job', () => {
  it('evicts rows older than 7 days', async () => {
    const now = Date.parse('2026-04-22T00:00:00Z');
    const { db, calls } = makeFakeDb(5);
    const result = await cleanupExpiredIdempotencyKeys(db, { now: () => now });
    expect(result.deleted).toBe(5);
    expect(result.thresholdIso).toBe('2026-04-15T00:00:00.000Z');
    expect(calls[0]!.sql).toMatch(/DELETE FROM idempotency_keys/i);
    expect(calls[0]!.params).toEqual(['2026-04-15T00:00:00.000Z']);
  });

  it('keeps rows younger than 7 days', async () => {
    const now = Date.parse('2026-04-22T00:00:00Z');
    const { db } = makeFakeDb(0);
    const result = await cleanupExpiredIdempotencyKeys(db, { now: () => now });
    expect(result.deleted).toBe(0);
  });

  it('honors custom maxAgeMs', async () => {
    const now = Date.parse('2026-04-22T00:00:00Z');
    const { db, calls } = makeFakeDb(0);
    await cleanupExpiredIdempotencyKeys(db, { now: () => now, maxAgeMs: 24 * 60 * 60 * 1000 });
    expect(calls[0]!.params).toEqual(['2026-04-21T00:00:00.000Z']);
  });
});
