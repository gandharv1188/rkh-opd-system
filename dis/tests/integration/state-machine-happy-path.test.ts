/**
 * Integration test — DIS-034
 *
 * End-to-end drive of the ingestion state machine through the
 * IngestionOrchestrator using DIS-012 script-driven fakes (no real I/O):
 *
 *   uploaded → (routed_native) → structuring → (structured) → ready_for_review
 *            → (nurse_approve) → verified → (promoted) → promoted
 *
 * CS-1: every state change is computed via `transition()` — attempting an
 * out-of-order transition (e.g. nurse_approve while still in `uploaded`)
 * MUST throw `InvalidStateTransitionError` and MUST NOT mutate the row.
 */

import { describe, it, expect } from 'vitest';

import { IngestionOrchestrator } from '../../src/core/orchestrator.js';
import {
  InvalidStateTransitionError,
  transition,
  type State,
} from '../../src/core/state-machine.js';
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
import type { OcrResult } from '../../src/ports/ocr.js';
import type { StructuringResult } from '../../src/ports/structuring.js';

const ocrResult: OcrResult = {
  provider: 'datalab',
  providerVersion: 'int-test',
  rawResponse: {},
  markdown: '# discharge summary\n\npatient stable',
  pageCount: 1,
  latencyMs: 12,
};

const structResult: StructuringResult = {
  provider: 'claude-haiku',
  providerVersion: 'int-test',
  rawResponse: {},
  structured: {
    document_category: 'generic',
    patient: { age_years: 3, sex: 'M' },
    findings: [],
  },
  tokensUsed: { input: 120, output: 80 },
  costMicroINR: 450,
  latencyMs: 35,
};

function build() {
  const db = new FakeDatabaseAdapter();
  const storage = new FakeStorageAdapter();
  const queue = new FakeQueueAdapter();
  const secrets = new FakeSecretsAdapter({});
  // orchestrator.process() routes with filename='' (see orchestrator.ts).
  const fileRouter = new FakeFileRouterAdapter({
    '': { success: { kind: 'native_text', pageCount: 1 } },
  });
  const preprocessor = new FakePreprocessorAdapter();
  // orchestrator.structure() uses documentCategory='generic' as fake key.
  const structuring = new FakeStructuringAdapter({
    generic: { success: structResult },
  });
  // OCR script entry not needed on native_text path but scripted for safety.
  const ocr = new FakeOcrAdapter({
    'pages:1/image/jpeg': { success: ocrResult },
  });
  const orch = new IngestionOrchestrator({
    db,
    storage,
    queue,
    secrets,
    fileRouter,
    preprocessor,
    ocr,
    structuring,
  });
  return { orch, db, storage, queue, structuring, ocr };
}

const sampleUpload = {
  patientId: 'pat-int-001',
  idempotencyKey: 'idem-int-001',
  filename: 'note.pdf',
  contentType: 'application/pdf',
  body: Buffer.from('bytes'),
};

describe('DIS-034 — state-machine integration (happy path, CS-1)', () => {
  it('drives uploaded → ready_for_review → verified → promoted in order', async () => {
    const { orch, db, structuring } = build();

    // Step 1: ingest — creates row at status='uploaded' version=1.
    const ingested = await orch.ingest(sampleUpload);
    expect(ingested.status).toBe('uploaded');
    expect(ingested.version).toBe(1);

    // Step 2: process — routed_native path → structuring via fake →
    // transition() lands the row in ready_for_review; one persisted
    // version bump for the whole pipeline.
    const processed = await orch.process(ingested.id);
    expect(processed.status).toBe('ready_for_review');
    expect(processed.version).toBe(2);
    expect(structuring.calls).toHaveLength(1);

    // Step 3: nurse_approve — ready_for_review → verified.
    const approved = await orch.approve({
      id: ingested.id,
      expectedVersion: 2,
      actor: 'nurse-1',
    });
    expect(approved.status).toBe('verified');
    expect(approved.version).toBe(3);

    // Step 4: final hop to `promoted` is computed through the pure state
    // machine (DIS-037 wires the real promotion service; here we assert
    // CS-1 end-to-end — the final state is reachable only from `verified`
    // or `auto_approved`).
    const finalState: State = transition(approved.status, { kind: 'promoted' });
    expect(finalState).toBe('promoted');

    // Order-of-status invariant across the whole run.
    const updates = db.calls
      .filter((c) => c.op === 'updateExtractionStatus')
      .map((c) => (c.args as { newStatus: State }).newStatus);
    expect(updates).toEqual(['ready_for_review', 'verified']);
  });

  it('CS-1: nurse_approve before ready_for_review throws InvalidStateTransitionError and does not mutate row', async () => {
    const { orch, db } = build();

    const ingested = await orch.ingest(sampleUpload);
    expect(ingested.status).toBe('uploaded');
    const rowBefore = db.rows[0];
    const versionBefore = rowBefore?.version;
    const statusBefore = rowBefore?.status;

    await expect(
      orch.approve({ id: ingested.id, expectedVersion: 1, actor: 'nurse-1' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);

    // CS-1: row is untouched — status and version preserved.
    expect(db.rows[0]?.status).toBe(statusBefore);
    expect(db.rows[0]?.version).toBe(versionBefore);
  });

  it('CS-1: promoted cannot be reached from uploaded (no promote-before-approve)', () => {
    expect(() => transition('uploaded', { kind: 'promoted' })).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => transition('ready_for_review', { kind: 'promoted' })).toThrow(
      InvalidStateTransitionError,
    );
  });
});
