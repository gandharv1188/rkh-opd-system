/**
 * Unit tests — IngestionOrchestrator (DIS-021 / DIS-021b).
 *
 * TDD §4 (state machine), §5 (idempotency), §6 (optimistic lock).
 * CS-1: invalid state transitions MUST throw and MUST NOT be persisted.
 * All ports are fakes; no network I/O.
 */

import { describe, it, expect } from 'vitest';

import { IngestionOrchestrator, VersionConflictError } from '../../src/core/orchestrator.js';
import {
  FakeDatabase,
  FakeStorage,
  FakeQueue,
  FakeSecrets,
  FakeFileRouter,
  FakePreprocessor,
  FakeOcr,
  FakeStructuring,
} from '../../src/core/__fakes__/index.js';
import { InvalidStateTransitionError } from '../../src/core/state-machine.js';
import type { OcrResult } from '../../src/ports/ocr.js';
import type { StructuringResult } from '../../src/ports/structuring.js';

const ocrResult: OcrResult = {
  provider: 'datalab',
  providerVersion: 'test',
  rawResponse: {},
  markdown: '# doc',
  pageCount: 1,
  latencyMs: 10,
};

const structResult: StructuringResult = {
  provider: 'claude-haiku',
  providerVersion: 'test',
  rawResponse: {},
  structured: { ok: true },
  tokensUsed: { input: 1, output: 1 },
  costMicroINR: 100,
  latencyMs: 10,
};

function makeOrchestrator(opts?: {
  routing?: 'native_text' | 'ocr_scan';
  ocr?: OcrResult | Error;
  struct?: StructuringResult | Error;
}) {
  const db = new FakeDatabase();
  const storage = new FakeStorage();
  const queue = new FakeQueue();
  const secrets = new FakeSecrets();
  const router = new FakeFileRouter(
    opts?.routing === 'ocr_scan'
      ? { kind: 'ocr_scan', pageCount: 1 }
      : { kind: 'native_text', pageCount: 1 },
  );
  const preprocessor = new FakePreprocessor();
  const ocr = new FakeOcr(opts?.ocr ?? ocrResult);
  const structuring = new FakeStructuring(opts?.struct ?? structResult);
  const orch = new IngestionOrchestrator({
    db,
    storage,
    queue,
    secrets,
    fileRouter: router,
    preprocessor,
    ocr,
    structuring,
  });
  return { orch, db, storage, queue, preprocessor, ocr, structuring };
}

const sampleIngest = {
  patientId: 'pat-1',
  idempotencyKey: 'idem-1',
  filename: 'note.pdf',
  contentType: 'application/pdf',
  body: Buffer.from('hello'),
};

describe('IngestionOrchestrator.ingest', () => {
  it("creates a new extraction in status='uploaded' with version=1", async () => {
    const { orch, db } = makeOrchestrator();
    const res = await orch.ingest(sampleIngest);
    expect(res.status).toBe('uploaded');
    expect(res.version).toBe(1);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.status).toBe('uploaded');
  });

  it('returns existing extraction on duplicate idempotency key with same payload', async () => {
    const { orch, db } = makeOrchestrator();
    const a = await orch.ingest(sampleIngest);
    const b = await orch.ingest(sampleIngest);
    expect(b.id).toBe(a.id);
    expect(db.rows).toHaveLength(1);
  });

  it('stores the body via StoragePort', async () => {
    const { orch, storage } = makeOrchestrator();
    await orch.ingest(sampleIngest);
    expect(storage.objects.size).toBe(1);
  });
});

describe('IngestionOrchestrator.process (pipeline goes through transition() — CS-1)', () => {
  it('native_text path ends in ready_for_review with a single persisted version bump', async () => {
    const { orch, db } = makeOrchestrator({ routing: 'native_text' });
    const r = await orch.ingest(sampleIngest);
    const after = await orch.process(r.id);
    expect(after.status).toBe('ready_for_review');
    expect(after.version).toBe(2);
    expect(db.rows[0]?.status).toBe('ready_for_review');
  });

  it('ocr_scan path calls preprocessor and OCR before structuring', async () => {
    const { orch, preprocessor, ocr } = makeOrchestrator({ routing: 'ocr_scan' });
    const r = await orch.ingest(sampleIngest);
    await orch.process(r.id);
    expect(preprocessor.calls).toHaveLength(1);
    expect(ocr.calls).toHaveLength(1);
  });

  it('CS-1: invalid pipeline transition throws InvalidStateTransitionError without persisting', async () => {
    // Drive the row into a terminal state (rejected) and then attempt to
    // re-run the pipeline. transition() must refuse `routed_native` from
    // `rejected` — and the status must remain `rejected` (never silently
    // overwritten).
    const { orch, db } = makeOrchestrator({ routing: 'native_text' });
    const r = await orch.ingest(sampleIngest);
    await orch.process(r.id);
    await orch.reject({
      id: r.id,
      expectedVersion: 2,
      actor: 'nurse-1',
      reasonCode: 'illegible',
    });
    const rowBefore = db.rows[0];
    const versionBefore = rowBefore?.version;
    const statusBefore = rowBefore?.status;
    expect(statusBefore).toBe('rejected');

    await expect(orch.process(r.id)).rejects.toBeInstanceOf(InvalidStateTransitionError);

    // CS-1 invariant: status is unchanged; version is unchanged.
    expect(db.rows[0]?.status).toBe(statusBefore);
    expect(db.rows[0]?.version).toBe(versionBefore);
  });

  it('every pipeline state change is routed through the state machine (uses updateExtractionStatus exactly once per process call, native_text)', async () => {
    const { orch, db } = makeOrchestrator({ routing: 'native_text' });
    const r = await orch.ingest(sampleIngest);
    const updatesBefore = db.calls.filter((c) => c.op === 'updateExtractionStatus').length;
    await orch.process(r.id);
    const updatesAfter = db.calls.filter((c) => c.op === 'updateExtractionStatus').length;
    // Pipeline transitions are computed pure-functionally via transition();
    // only the final state is persisted — one version bump for the whole run.
    expect(updatesAfter - updatesBefore).toBe(1);
  });
});

describe('IngestionOrchestrator.approve', () => {
  it("with correct version transitions to 'verified' and bumps version", async () => {
    const { orch } = makeOrchestrator();
    const r = await orch.ingest(sampleIngest);
    await orch.process(r.id);
    const approved = await orch.approve({
      id: r.id,
      expectedVersion: 2,
      actor: 'nurse-1',
    });
    expect(approved.status).toBe('verified');
    expect(approved.version).toBe(3);
  });

  it('with wrong version throws VersionConflictError (TDD §6)', async () => {
    const { orch } = makeOrchestrator();
    const r = await orch.ingest(sampleIngest);
    await orch.process(r.id);
    await expect(
      orch.approve({ id: r.id, expectedVersion: 999, actor: 'nurse-1' }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('VersionConflictError carries current state fields', async () => {
    const { orch } = makeOrchestrator();
    const r = await orch.ingest(sampleIngest);
    await orch.process(r.id);
    try {
      await orch.approve({ id: r.id, expectedVersion: 1, actor: 'nurse-1' });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(VersionConflictError);
      const err = e as VersionConflictError;
      expect(err.code).toBe('VERSION_CONFLICT');
      expect(err.currentVersion).toBe(2);
      expect(err.currentStatus).toBe('ready_for_review');
    }
  });
});

describe('IngestionOrchestrator.reject', () => {
  it('transitions ready_for_review → rejected', async () => {
    const { orch } = makeOrchestrator();
    const r = await orch.ingest(sampleIngest);
    await orch.process(r.id);
    const out = await orch.reject({
      id: r.id,
      expectedVersion: 2,
      actor: 'nurse-1',
      reasonCode: 'illegible',
    });
    expect(out.status).toBe('rejected');
  });

  it('wrong version on reject throws VersionConflictError', async () => {
    const { orch } = makeOrchestrator();
    const r = await orch.ingest(sampleIngest);
    await orch.process(r.id);
    await expect(
      orch.reject({
        id: r.id,
        expectedVersion: 999,
        actor: 'nurse-1',
        reasonCode: 'illegible',
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });
});

describe('IngestionOrchestrator.retry', () => {
  it('creates a NEW extraction that references the failed parent (DIS-US-003)', async () => {
    const { orch, db } = makeOrchestrator({
      routing: 'ocr_scan',
      ocr: new Error('provider down'),
    });
    const r = await orch.ingest(sampleIngest);
    await expect(orch.process(r.id)).rejects.toThrow();
    const retried = await orch.retry({ id: r.id, actor: 'system' });
    expect(retried.id).not.toBe(r.id);
    expect(retried.parentExtractionId).toBe(r.id);
    expect(db.rows).toHaveLength(2);
  });

  it('retry preserves the original failed row (does not mutate it back to uploaded)', async () => {
    const { orch, db } = makeOrchestrator({
      routing: 'ocr_scan',
      ocr: new Error('provider down'),
    });
    const r = await orch.ingest(sampleIngest);
    await expect(orch.process(r.id)).rejects.toThrow();
    await orch.retry({ id: r.id, actor: 'system' });
    const original = db.rows.find((row) => row.id === r.id);
    expect(original?.status).toBe('failed');
  });
});
