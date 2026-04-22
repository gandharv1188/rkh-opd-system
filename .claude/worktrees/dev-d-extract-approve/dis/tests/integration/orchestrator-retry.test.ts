/**
 * Integration test — DIS-035
 *
 * Orchestrator retry path after an OCR failure.
 *
 *   ingest            → uploaded (v1)
 *   process (ocr_scan fails) → failed  (v2, version incremented by
 *                                       transition('uploaded',
 *                                       {kind:'fail'}) persisted once)
 *   retry             → NEW row with parent_extraction_id = parent.id,
 *                        starting at version 1 (fresh attempt).
 *
 * Assertions:
 *   - original failed row is preserved (not mutated back to `uploaded`);
 *   - retried row references the parent;
 *   - two rows exist after retry;
 *   - parent's version bumped from 1 to 2 (incremented by the failure
 *     transition), child starts at version 1.
 */

import { describe, it, expect } from 'vitest';

import { IngestionOrchestrator } from '../../src/core/orchestrator.js';
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
  tokensUsed: { input: 1, output: 1 },
  costMicroINR: 1,
  latencyMs: 1,
};

function build() {
  const db = new FakeDatabaseAdapter();
  // OCR fake scripted to throw on the key the orchestrator produces for a
  // zero-length first page (see FakeOcrAdapter.keyOf fallback).
  const ocr = new FakeOcrAdapter({
    'pages:1/image/jpeg': { error: 'ocr-provider-down' },
  });
  const orch = new IngestionOrchestrator({
    db,
    storage: new FakeStorageAdapter(),
    queue: new FakeQueueAdapter(),
    secrets: new FakeSecretsAdapter({}),
    fileRouter: new FakeFileRouterAdapter({
      '': { success: { kind: 'ocr_scan', pageCount: 1 } },
    }),
    preprocessor: new FakePreprocessorAdapter(),
    ocr,
    structuring: new FakeStructuringAdapter({
      generic: { success: structResult },
    }),
  });
  return { orch, db, ocr };
}

const sampleUpload = {
  patientId: 'pat-retry',
  idempotencyKey: 'idem-retry',
  filename: 'scan.jpg',
  contentType: 'image/jpeg',
  body: Buffer.from('bytes'),
};

describe('DIS-035 — orchestrator retry after OCR failure', () => {
  it('retry preserves the failed parent row and creates a new row linked via parent_extraction_id', async () => {
    const { orch, db, ocr } = build();

    const parent = await orch.ingest(sampleUpload);
    expect(parent.status).toBe('uploaded');
    expect(parent.version).toBe(1);

    await expect(orch.process(parent.id)).rejects.toThrow(/ocr-provider-down/);
    expect(ocr.calls).toHaveLength(1);

    // Parent row's version is incremented from 1 → 2 by the failure
    // transition (uploaded → failed), persisted exactly once.
    const failedParent = db.rows.find((r) => r.id === parent.id);
    expect(failedParent?.status).toBe('failed');
    expect(failedParent?.version).toBe(2);

    const retried = await orch.retry({ id: parent.id, actor: 'system' });

    // Retry creates a NEW row, fresh at version 1, with parent pointer.
    expect(retried.id).not.toBe(parent.id);
    expect(retried.status).toBe('uploaded');
    expect(retried.version).toBe(1);
    expect(retried.parentExtractionId).toBe(parent.id);

    // Both rows exist; the original failed row is preserved exactly as it
    // was before retry (no silent mutation back to `uploaded`).
    expect(db.rows).toHaveLength(2);
    const stillFailed = db.rows.find((r) => r.id === parent.id);
    expect(stillFailed?.status).toBe('failed');
    expect(stillFailed?.version).toBe(2);
  });

  it('retry preserves the original idempotency-key record on the parent (no reuse on child)', async () => {
    const { orch, db } = build();

    const parent = await orch.ingest(sampleUpload);
    await expect(orch.process(parent.id)).rejects.toThrow();
    const retried = await orch.retry({ id: parent.id, actor: 'system' });

    const parentRow = db.rows.find((r) => r.id === parent.id);
    const childRow = db.rows.find((r) => r.id === retried.id);

    // preserve: parent keeps its original idempotency_key untouched.
    expect(parentRow?.idempotency_key).toBe(sampleUpload.idempotencyKey);
    // child uses a distinct retry-scoped key so it does not collide on
    // future ingest() lookups.
    expect(childRow?.idempotency_key).not.toBe(sampleUpload.idempotencyKey);
    expect(childRow?.idempotency_key).toContain('retry:');
  });
});
