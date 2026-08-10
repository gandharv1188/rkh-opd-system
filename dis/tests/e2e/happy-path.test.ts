/**
 * DIS-103 — E2E happy path.
 *
 * Walks an extraction through the full ingestion lifecycle using the Hono
 * app (fetch-style `app.request()`) plus script-driven fakes:
 *
 *   POST /ingest                    → uploaded (v1)
 *   orchestrator.process(id)        → ready_for_review (v2) via native_text
 *   GET  /extractions/:id           → read-back at ready_for_review
 *   POST /extractions/:id/approve   → verified (v3) via nurse_approve
 *   db.updateExtractionStatus(...)  → promoted (v4) via `promoted` event
 *   GET  /extractions/:id           → final read-back at promoted
 *
 * Notes on the final hop: the state machine's `promoted` event has no
 * dedicated HTTP route in Wave-5; the integration test for DIS-034 drives
 * it via `transition()` + direct DB write. We reuse that pattern here so
 * the E2E exercises the real server for every hop that has a route and
 * asserts CS-1 on the terminal hop through the pure state machine.
 */

import { describe, expect, it } from 'vitest';
import { createServer } from '../../src/http/server.js';
import { IngestionOrchestrator } from '../../src/core/orchestrator.js';
import { transition } from '../../src/core/state-machine.js';
import type { OcrResult } from '../../src/ports/ocr.js';
import type { StructuringResult } from '../../src/ports/structuring.js';
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

const ocrResult: OcrResult = {
  provider: 'datalab',
  providerVersion: 'e2e',
  rawResponse: {},
  markdown: '# fake',
  pageCount: 1,
  latencyMs: 1,
};

const structResult: StructuringResult = {
  provider: 'claude-haiku',
  providerVersion: 'e2e',
  rawResponse: {},
  structured: {
    document_category: 'generic',
    patient: { age_years: 4, sex: 'F' },
    findings: [],
  },
  tokensUsed: { input: 10, output: 10 },
  costMicroINR: 100,
  latencyMs: 5,
};

interface IngestBody {
  extraction_id: string;
  status: string;
  version: number;
  correlation_id: string;
}

interface GetBody {
  id: string;
  patient_id: string;
  status: string;
  version: number;
  parent_extraction_id: string | null;
}

interface ApproveBody {
  extraction_id: string;
  status: string;
  version: number;
  correlation_id: string;
  promotion: { inserted: number; skipped: number };
}

describe('DIS-103 — E2E happy path (ingest → process → approve → promoted)', () => {
  it('extraction reaches promoted state', async () => {
    const db = new FakeDatabaseAdapter();
    const storage = new FakeStorageAdapter();
    const queue = new FakeQueueAdapter();
    const secrets = new FakeSecretsAdapter({});
    // orchestrator.process() routes with filename='' (see orchestrator.ts).
    const fileRouter = new FakeFileRouterAdapter({
      '': { success: { kind: 'native_text', pageCount: 1 } },
    });
    const preprocessor = new FakePreprocessorAdapter();
    const structuring = new FakeStructuringAdapter({
      generic: { success: structResult },
    });
    const ocr = new FakeOcrAdapter({
      'pages:1/image/jpeg': { success: ocrResult },
    });

    const orchestrator = new IngestionOrchestrator({
      db,
      storage,
      queue,
      secrets,
      fileRouter,
      preprocessor,
      ocr,
      structuring,
    });

    const app = createServer({
      routes: {
        ingest: { orchestrator },
        extractionsGet: { db },
        extractionsApprove: { orchestrator },
      },
    });

    // --- Step 1: POST /ingest ----------------------------------------------
    const ingestRes = await app.request('/ingest', {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        'X-Patient-Id': 'pat-e2e-1',
        'Idempotency-Key': 'idem-e2e-1',
        'X-Filename': 'discharge.pdf',
      },
      body: Buffer.from('%PDF-1.4 fake'),
    });
    expect(ingestRes.status).toBe(201);
    const ingestBody = (await ingestRes.json()) as IngestBody;
    expect(ingestBody.status).toBe('uploaded');
    expect(ingestBody.version).toBe(1);
    const id = ingestBody.extraction_id;

    // Storage received the upload under the expected prefix.
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]?.key).toBe(`extractions/${id}/discharge.pdf`);

    // --- Step 2: process (no dedicated E2E route yet) ----------------------
    const processed = await orchestrator.process(id);
    expect(processed.status).toBe('ready_for_review');
    expect(processed.version).toBe(2);
    // native_text path must not touch preprocessor/OCR.
    expect(preprocessor.calls).toHaveLength(0);
    expect(ocr.calls).toHaveLength(0);
    expect(structuring.calls).toHaveLength(1);

    // --- Step 3: GET /extractions/:id --------------------------------------
    const getRes = await app.request(`/extractions/${id}`);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as GetBody;
    expect(getBody.id).toBe(id);
    expect(getBody.status).toBe('ready_for_review');
    expect(getBody.version).toBe(2);

    // --- Step 4: POST /extractions/:id/approve (nurse_approve) -------------
    const approveRes = await app.request(`/extractions/${id}/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Operator-Id': 'nurse-1',
      },
      body: JSON.stringify({ expected_version: 2, actor: 'nurse-1' }),
    });
    expect(approveRes.status).toBe(200);
    const approveBody = (await approveRes.json()) as ApproveBody;
    expect(approveBody.status).toBe('verified');
    expect(approveBody.version).toBe(3);

    // --- Step 5: terminal transition verified → promoted -------------------
    // The `promoted` event has no dedicated HTTP route in Wave-5 (DIS-037
    // wires the real promotion service). Drive it through the pure state
    // machine + DB to assert CS-1 end-to-end: the terminal state is only
    // reachable from `verified` or `auto_approved`.
    const finalState = transition('verified', { kind: 'promoted' });
    expect(finalState).toBe('promoted');
    const promotedRow = await db.updateExtractionStatus(id, 3, finalState);
    expect(promotedRow).not.toBeNull();
    expect(promotedRow?.status).toBe('promoted');
    expect(promotedRow?.version).toBe(4);

    // --- Step 6: final GET asserts persisted terminal state ----------------
    const finalRes = await app.request(`/extractions/${id}`);
    expect(finalRes.status).toBe(200);
    const finalBody = (await finalRes.json()) as GetBody;
    expect(finalBody.status).toBe('promoted');
    expect(finalBody.version).toBe(4);

    // --- Invariant: status transitions emitted in strict order -------------
    const statuses = db.calls
      .filter((c) => c.op === 'updateExtractionStatus')
      .map((c) => (c.args as { newStatus: string }).newStatus);
    expect(statuses).toEqual(['ready_for_review', 'verified', 'promoted']);
  });
});
