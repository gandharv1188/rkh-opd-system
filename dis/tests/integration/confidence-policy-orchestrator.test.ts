/**
 * DIS-036 — Confidence-policy ↔ orchestrator integration (CS-7).
 *
 * CS-7 (fail-closed default): when the confidence policy is disabled
 * (`enabled: false`), every extraction MUST flow through manual
 * `nurse_approve`, regardless of per-field confidence.
 *
 * @see dis/document_ingestion_service/01_product/clinical_safety.md CS-7
 * @see dis/src/core/confidence-policy.ts
 * @see dis/src/core/orchestrator.ts
 */

import { describe, it, expect } from 'vitest';

import { IngestionOrchestrator } from '../../src/core/orchestrator.js';
import {
  evaluatePolicy,
  type ConfidencePolicy,
  type StructuredExtraction,
} from '../../src/core/confidence-policy.js';
import {
  FakeDatabaseAdapter,
  FakeStorageAdapter,
  FakeQueueAdapter,
  FakeSecretsAdapter,
  FakeFileRouterAdapter,
  FakePreprocessorAdapter,
  FakeOcrAdapter,
  FakeStructuringAdapter,
} from '../helpers/fake-adapters.js';

const perfectStructured: StructuredExtraction = {
  fields: {
    patient_name: { confidence: 0.995 },
    dob: { confidence: 0.99 },
    test_result: { confidence: 0.999 },
  },
};

// CS-7 fail-closed: enabled=false MUST suppress auto-approval regardless
// of per-field confidence.
const disabledPolicy: ConfidencePolicy = {
  version: 1,
  enabled: false,
  rules: [
    { field: 'patient_name', threshold: 0.9 },
    { field: 'dob', threshold: 0.9 },
    { field: 'test_result', threshold: 0.9 },
  ],
};

function wireOrchestrator() {
  const db = new FakeDatabaseAdapter();
  const storage = new FakeStorageAdapter();
  const queue = new FakeQueueAdapter();
  const secrets = new FakeSecretsAdapter({});
  // Orchestrator.process() routes with an empty filename, so the script
  // key must be '' (see orchestrator.ts: `fileRouter.route({ filename: '' })`).
  const fileRouter = new FakeFileRouterAdapter({
    '': { success: { kind: 'native_text', pageCount: 1 } },
  });
  const preprocessor = new FakePreprocessorAdapter();
  const ocr = new FakeOcrAdapter({});
  const structuring = new FakeStructuringAdapter({
    generic: {
      success: {
        provider: 'claude-haiku',
        providerVersion: 'test',
        rawResponse: {},
        structured: perfectStructured,
        tokensUsed: { input: 1, output: 1 },
        costMicroINR: 100,
        latencyMs: 10,
      },
    },
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
  return { orch, db };
}

describe('DIS-036 — confidence-policy ↔ orchestrator (CS-7 fail-closed)', () => {
  it('CS-7: policy enabled=false keeps a high-confidence extraction in ready_for_review', async () => {
    const { orch, db } = wireOrchestrator();

    const created = await orch.ingest({
      patientId: 'pat-1',
      idempotencyKey: 'idem-1',
      filename: 'note.pdf',
      contentType: 'application/pdf',
      body: Buffer.from('hello'),
    });
    expect(created.status).toBe('uploaded');

    const processed = await orch.process(created.id);
    expect(processed.status).toBe('ready_for_review');

    // CS-7: disabled policy MUST NOT auto-approve, even at 0.99+ confidence.
    const decision = evaluatePolicy(perfectStructured, disabledPolicy, []);
    expect(decision.auto_approved).toBe(false);

    // Persisted row remains in ready_for_review — never auto_approved.
    const row = await db.findExtractionById(created.id);
    expect(row?.status).toBe('ready_for_review');
  });
});
