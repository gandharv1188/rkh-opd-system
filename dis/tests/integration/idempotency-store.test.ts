/**
 * Integration tests — DIS-039 — Idempotency store integration.
 *
 * Composes the DIS-025 `createIdempotencyStore(db)` factory with the DIS-012
 * `FakeDatabaseAdapter` (via a small extension that simulates the
 * `idempotency_keys` table in-memory) and exercises the three
 * `recordAndResolve()` outcomes end-to-end:
 *
 *   - new       : unseen key is inserted.
 *   - replay    : same key + same payload hash → existing record returned.
 *   - collision : same key + different payload hash → existing record returned.
 *
 * Unlike the unit tests (which narrowly drive the store's SQL path), this
 * suite treats the store + fake DB as a composed unit and asserts observable
 * ordering: insert happens once, subsequent calls do not insert again, and
 * every call flows through a transaction.
 *
 * Out of scope: real database (Wave 4 migration); the fake is sufficient.
 *
 * @see backlog DIS-039
 * @see dis/src/core/idempotency-store.ts (DIS-025)
 */

import { describe, it, expect } from 'vitest';
import { FakeDatabaseAdapter } from '../helpers/fake-adapters.js';
import type { DatabasePort } from '../../src/ports/database.js';
import {
  createIdempotencyStore,
  type IdempotencyStore,
} from '../../src/core/idempotency-store.js';

/**
 * In-memory stand-in for `idempotency_keys`. Same shape as the unit-test
 * variant — kept local here so the two suites stay independently
 * modifiable (the integration suite may later grow additional tables).
 */
class IdempotencyFakeDb extends FakeDatabaseAdapter {
  readonly table = new Map<string, { payload_hash: string; created_at: string }>();

  override async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    this.calls.push({ op: 'query', args: { sql, params } });
    if (/from\s+idempotency_keys/i.test(sql)) {
      const [key] = params as [string];
      const row = this.table.get(key);
      return (row ? [row] : []) as unknown as readonly T[];
    }
    if (/insert\s+into\s+idempotency_keys/i.test(sql)) {
      const [key, payloadHash, createdAt] = params as [string, string, string];
      this.table.set(key, { payload_hash: payloadHash, created_at: createdAt });
      return [] as readonly T[];
    }
    return super.query<T>(sql, params);
  }
}

function compose(): { store: IdempotencyStore; db: IdempotencyFakeDb } {
  const db = new IdempotencyFakeDb();
  const store = createIdempotencyStore(db as DatabasePort);
  return { store, db };
}

describe('idempotency store integration (DIS-039)', () => {
  it('first submission for an unseen key resolves to action=new and inserts one row', async () => {
    const { store, db } = compose();

    const result = await store.recordAndResolve('INT-KEY-1', 'payload-hash-A');

    expect(result.action).toBe('new');
    expect(db.table.size).toBe(1);
    expect(db.table.get('INT-KEY-1')?.payload_hash).toBe('payload-hash-A');
    // One transaction + one SELECT + one INSERT for the new path.
    const txCount = db.calls.filter((c) => c.op === 'transaction').length;
    const queryCount = db.calls.filter((c) => c.op === 'query').length;
    expect(txCount).toBe(1);
    expect(queryCount).toBe(2);
  });

  it('replay: same key + same payload hash returns existing record and does not re-insert', async () => {
    const { store, db } = compose();

    const first = await store.recordAndResolve('INT-KEY-2', 'payload-hash-A');
    expect(first.action).toBe('new');

    const replay = await store.recordAndResolve('INT-KEY-2', 'payload-hash-A');
    expect(replay.action).toBe('replay');
    if (replay.action !== 'replay') throw new Error('expected replay');
    expect(replay.existing.payloadHash).toBe('payload-hash-A');
    expect(typeof replay.existing.createdAt).toBe('string');

    // Still only one row — replay must not have inserted a second one.
    expect(db.table.size).toBe(1);
    // Second call does SELECT only (no INSERT) — total queries: 1+1 new path, 1 replay path = 3.
    const queryCount = db.calls.filter((c) => c.op === 'query').length;
    expect(queryCount).toBe(3);
  });

  it('collision: same key + different payload hash returns the ORIGINAL record and does not overwrite', async () => {
    const { store, db } = compose();

    await store.recordAndResolve('INT-KEY-3', 'payload-hash-ORIGINAL');
    const collision = await store.recordAndResolve('INT-KEY-3', 'payload-hash-DIFFERENT');

    expect(collision.action).toBe('collision');
    if (collision.action !== 'collision') throw new Error('expected collision');
    // Collision reports the *existing* hash, not the incoming one. This is
    // the contract the HTTP layer relies on to return 422 with the stored
    // response metadata.
    expect(collision.existing.payloadHash).toBe('payload-hash-ORIGINAL');

    // Row must not have been mutated by the collision attempt.
    expect(db.table.get('INT-KEY-3')?.payload_hash).toBe('payload-hash-ORIGINAL');
    expect(db.table.size).toBe(1);
  });

  it('across independent keys, each submission is isolated (two news, no replay/collision bleed)', async () => {
    const { store, db } = compose();

    const a = await store.recordAndResolve('INT-KEY-A', 'hash-A');
    const b = await store.recordAndResolve('INT-KEY-B', 'hash-B');
    expect(a.action).toBe('new');
    expect(b.action).toBe('new');
    expect(db.table.size).toBe(2);
  });
});
