/**
 * Unit tests — Idempotency key handler (DIS-025).
 *
 * Pure core store backed by `DatabasePort`. `recordAndResolve(key, payloadHash)`
 * resolves each POST to one of three outcomes:
 *   - 'new'       : unseen key; record is inserted.
 *   - 'replay'    : key seen with the SAME payload hash → safe to replay the
 *                   original response (idempotency semantics per RFC draft).
 *   - 'collision' : key seen with a DIFFERENT payload hash → client error.
 *
 * The production store reads/writes through `DatabasePort.query()` against an
 * `idempotency_keys` table (schema: key TEXT PK, payload_hash TEXT,
 * created_at TIMESTAMPTZ). Since Wave 4 owns the migration, these tests back
 * the port with an extended `FakeDatabaseAdapter` whose `query` method
 * simulates the `idempotency_keys` statements.
 */

import { describe, it, expect } from 'vitest';
import { FakeDatabaseAdapter } from '../helpers/fake-adapters.js';
import type { DatabasePort } from '../../src/ports/database.js';
import {
  createIdempotencyStore,
  type IdempotencyStore,
} from '../../src/core/idempotency-store.js';

/**
 * In-memory stand-in for the `idempotency_keys` table. Routes the specific
 * SELECT/INSERT statements used by the store; falls back to the generic
 * FakeDatabaseAdapter behaviour for everything else.
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

function makeStore(): { store: IdempotencyStore; db: IdempotencyFakeDb } {
  const db = new IdempotencyFakeDb();
  const store = createIdempotencyStore(db as DatabasePort);
  return { store, db };
}

describe('idempotency store (DIS-025)', () => {
  it('records a new key as action=new', async () => {
    const { store } = makeStore();
    const result = await store.recordAndResolve('key-1', 'hash-a');
    expect(result.action).toBe('new');
    if (result.action !== 'new') {
      throw new Error('expected new');
    }
  });

  it('returns replay when the same key + same payload hash is seen again', async () => {
    const { store } = makeStore();
    const first = await store.recordAndResolve('key-2', 'hash-a');
    expect(first.action).toBe('new');

    const replay = await store.recordAndResolve('key-2', 'hash-a');
    expect(replay.action).toBe('replay');
    if (replay.action !== 'replay') throw new Error('expected replay');
    expect(replay.existing.payloadHash).toBe('hash-a');
    expect(typeof replay.existing.createdAt).toBe('string');
  });

  it('returns collision when the same key has a different payload hash', async () => {
    const { store } = makeStore();
    await store.recordAndResolve('key-3', 'hash-a');

    const collision = await store.recordAndResolve('key-3', 'hash-b');
    expect(collision.action).toBe('collision');
    if (collision.action !== 'collision') throw new Error('expected collision');
    expect(collision.existing.payloadHash).toBe('hash-a');
  });

  it('different keys are isolated from each other', async () => {
    const { store } = makeStore();
    await store.recordAndResolve('key-A', 'hash-a');
    const other = await store.recordAndResolve('key-B', 'hash-b');
    expect(other.action).toBe('new');
  });

  it('uses a transaction on the DatabasePort for each resolve', async () => {
    const { store, db } = makeStore();
    await store.recordAndResolve('key-T', 'hash-T');
    const txCount = db.calls.filter((c) => c.op === 'transaction').length;
    expect(txCount).toBeGreaterThanOrEqual(1);
  });

  it('passes parameterised SQL to the DatabasePort (no string interpolation)', async () => {
    const { store, db } = makeStore();
    await store.recordAndResolve("k'; drop table idempotency_keys; --", 'hash');
    const queries = db.calls.filter((c) => c.op === 'query');
    expect(queries.length).toBeGreaterThanOrEqual(1);
    for (const q of queries) {
      const { sql, params } = q.args as { sql: string; params: readonly unknown[] };
      // SQL must use positional placeholders; no user input baked into the literal.
      expect(sql).not.toContain('drop table');
      expect(/\$\d+/.test(sql)).toBe(true);
      expect(params.length).toBeGreaterThanOrEqual(1);
    }
  });
});
