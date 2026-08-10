/**
 * Integration test — DIS-040
 *
 * Version-lock race: two concurrent `approve()` calls on the same
 * extraction at the same expected version. Exactly one resolves; the
 * other throws `VersionConflictError` carrying the current version.
 *
 * Exercises DIS-026's optimistic-lock semantics through the orchestrator's
 * approve path. The `FakeDatabaseAdapter` implements compare-and-set on
 * `version` — the second writer observes the bumped version and returns
 * null from `updateExtractionStatus`, which the orchestrator translates
 * to `VersionConflictError`.
 */

import { describe, it, expect } from 'vitest';

import {
  IngestionOrchestrator,
  VersionConflictError,
} from '../../src/core/orchestrator.js';
import {
  FakeDatabaseAdapter,
  FakeFileRouterAdapter,
  FakeOcrAdapter,
  FakePreprocessorAdapter,
  FakeQueueAdapter,
  FakeSecretsAdapter,
  FakeStorageAdapter,
  FakeStructuringAdapter,
} from '../helpers/index.js';
import type { StructuringResult } from '../../src/ports/structuring.js';

const structResult: StructuringResult = {
  provider: 'claude-haiku',
  providerVersion: 'int-test',
  rawResponse: {},
  structured: { ok: true },
  tokensUsed: { input: 10, output: 10 },
  costMicroINR: 100,
  latencyMs: 5,
};

function build() {
  const db = new FakeDatabaseAdapter();
  const orch = new IngestionOrchestrator({
    db,
    storage: new FakeStorageAdapter(),
    queue: new FakeQueueAdapter(),
    secrets: new FakeSecretsAdapter({}),
    fileRouter: new FakeFileRouterAdapter({
      '': { success: { kind: 'native_text', pageCount: 1 } },
    }),
    preprocessor: new FakePreprocessorAdapter(),
    ocr: new FakeOcrAdapter({}),
    structuring: new FakeStructuringAdapter({
      generic: { success: structResult },
    }),
  });
  return { orch, db };
}

async function driveToReadyForReview(orch: IngestionOrchestrator) {
  const r = await orch.ingest({
    patientId: 'pat-race',
    idempotencyKey: 'idem-race',
    filename: 'note.pdf',
    contentType: 'application/pdf',
    body: Buffer.from('x'),
  });
  await orch.process(r.id);
  return r.id;
}

describe('DIS-040 — approve race / optimistic lock', () => {
  it('two concurrent approve() on the same version: exactly one wins, other throws VersionConflictError', async () => {
    const { orch, db } = build();
    const id = await driveToReadyForReview(orch);

    const [resA, resB] = await Promise.allSettled([
      orch.approve({ id, expectedVersion: 2, actor: 'nurse-a' }),
      orch.approve({ id, expectedVersion: 2, actor: 'nurse-b' }),
    ]);

    const fulfilled = [resA, resB].filter((r) => r.status === 'fulfilled');
    const rejected = [resA, resB].filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rej = rejected[0] as PromiseRejectedResult;
    expect(rej.reason).toBeInstanceOf(VersionConflictError);
    const err = rej.reason as VersionConflictError;
    expect(err.code).toBe('VERSION_CONFLICT');
    // The winner bumped version 2 → 3, so the loser sees currentVersion=3.
    expect(err.currentVersion).toBe(3);
    expect(err.currentStatus).toBe('verified');

    // DB row reflects exactly one verify — version bumped once, not twice.
    expect(db.rows[0]?.version).toBe(3);
    expect(db.rows[0]?.status).toBe('verified');
  });

  it('stale expectedVersion after winner commits: loser still throws VersionConflictError', async () => {
    const { orch } = build();
    const id = await driveToReadyForReview(orch);

    // Sequential: first approve succeeds (winner), second uses the stale
    // expectedVersion=2 (loser). The post-hoc call must still raise
    // VersionConflictError — this is the non-concurrent expression of the
    // same invariant the race test asserts.
    await orch.approve({ id, expectedVersion: 2, actor: 'nurse-a' });
    await expect(
      orch.approve({ id, expectedVersion: 2, actor: 'nurse-b' }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });
});
