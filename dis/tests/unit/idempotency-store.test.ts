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
 * Uses `FakeDatabaseAdapter` (DIS-012) with scripted `query` responses so we
 * exercise the SQL-level contract without a real database. DB schema for the
 * `idempotency_keys` table lives in Wave 4 (migrations) — out of scope here.
 */

import { describe, it, expect } from 'vitest';
import { FakeDatabaseAdapter } from '../helpers/fake-adapters.js';
import {
  createIdempotencyStore,
  type IdempotencyStore,
} from '../../src/core/idempotency-store.js';

function makeStore(): IdempotencyStore {
  const db = new FakeDatabaseAdapter();
  return createIdempotencyStore(db);
}

describe('idempotency store (DIS-025)', () => {
  it('records a new key as action=new', async () => {
    const store = makeStore();
    const result = await store.recordAndResolve('key-1', 'hash-a');
    expect(result.action).toBe('new');
    expect(result.existing).toBeUndefined();
  });

  it('returns replay when the same key + same payload hash is seen again', async () => {
    const store = makeStore();
    const first = await store.recordAndResolve('key-2', 'hash-a');
    expect(first.action).toBe('new');

    const replay = await store.recordAndResolve('key-2', 'hash-a');
    expect(replay.action).toBe('replay');
    expect(replay.existing).toBeDefined();
    expect(replay.existing?.payloadHash).toBe('hash-a');
    expect(typeof replay.existing?.createdAt).toBe('string');
  });

  it('returns collision when the same key has a different payload hash', async () => {
    const store = makeStore();
    await store.recordAndResolve('key-3', 'hash-a');

    const collision = await store.recordAndResolve('key-3', 'hash-b');
    expect(collision.action).toBe('collision');
    expect(collision.existing?.payloadHash).toBe('hash-a');
  });

  it('different keys are isolated from each other', async () => {
    const store = makeStore();
    await store.recordAndResolve('key-A', 'hash-a');
    const other = await store.recordAndResolve('key-B', 'hash-b');
    expect(other.action).toBe('new');
  });

  it('uses a transaction on the DatabasePort for each resolve', async () => {
    const db = new FakeDatabaseAdapter();
    const store = createIdempotencyStore(db);
    await store.recordAndResolve('key-T', 'hash-T');
    const txCount = db.calls.filter((c) => c.op === 'transaction').length;
    expect(txCount).toBeGreaterThanOrEqual(1);
  });
});
