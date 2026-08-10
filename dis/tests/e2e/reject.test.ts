/**
 * DIS-105 — E2E reject path (no-side-effect assertion).
 *
 * Drives an extraction through POST /ingest → orchestrator.process() →
 * POST /extractions/:id/reject and asserts the reject has zero side-effects
 * on the target system (`lab_results`).
 *
 * "No row inserted into lab_results" is expressed through the observability
 * surface the core exposes today:
 *
 *   1. `FakeDatabaseAdapter.query()` is wrapped to capture any call whose
 *      SQL contains `insert into lab_results`. The captured list stays
 *      empty — the brief's preferred assertion.
 *   2. The extraction never enters `promoted`. The state machine only
 *      admits `promoted` from `verified` or `auto_approved`; rejection is
 *      a terminal fork.
 *
 * This expresses the spirit of the ticket — reject has zero side-effects on
 * downstream clinical tables. Promotion is not yet wired into the
 * orchestrator (see `extractions-approve.ts:18` — the `promotion.inserted`
 * response field is a placeholder pending a follow-up), so today the
 * lab-insert assertion is vacuously satisfied; the wrapped spy stays in
 * place so that once promotion lands, this test will correctly fail if
 * reject ever starts emitting lab_results writes.
 */

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import { IngestionOrchestrator } from '../../src/core/orchestrator.js';
import { registerIngestRoute } from '../../src/http/routes/ingest.js';
import { registerExtractionsRejectRoute } from '../../src/http/routes/extractions-reject.js';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import { errorHandler } from '../../src/http/middleware/error-handler.js';
import type { AppVariables } from '../../src/http/server.js';

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
  providerVersion: 'e2e-reject',
  rawResponse: {},
  structured: { ok: true },
  tokensUsed: { input: 1, output: 1 },
  costMicroINR: 1,
  latencyMs: 1,
};

type LabInsertCall = { sql: string; params: readonly unknown[] };

function build(): {
  app: Hono<{ Variables: AppVariables }>;
  db: FakeDatabaseAdapter;
  orchestrator: IngestionOrchestrator;
  labInsertCalls: LabInsertCall[];
} {
  const db = new FakeDatabaseAdapter();

  const labInsertCalls: LabInsertCall[] = [];
  const originalQuery = db.query.bind(db);
  db.query = (async <T,>(sql: string, params: readonly unknown[]) => {
    if (String(sql).toLowerCase().includes('insert into lab_results')) {
      labInsertCalls.push({ sql, params });
    }
    return originalQuery<T>(sql, params);
  }) as typeof db.query;

  const orchestrator = new IngestionOrchestrator({
    db,
    storage: new FakeStorageAdapter(),
    queue: new FakeQueueAdapter(),
    secrets: new FakeSecretsAdapter({}),
    fileRouter: new FakeFileRouterAdapter({
      '': { success: { kind: 'native_text', pageCount: 1 } },
    }),
    preprocessor: new FakePreprocessorAdapter(),
    ocr: new FakeOcrAdapter({}),
    structuring: new FakeStructuringAdapter({ generic: { success: structResult } }),
  });

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  registerIngestRoute(app as unknown as Hono, { orchestrator });
  registerExtractionsRejectRoute(app as unknown as Hono, { orchestrator });
  app.onError(errorHandler());

  return { app, db, orchestrator, labInsertCalls };
}

interface IngestResponse {
  extraction_id: string;
  status: string;
  version: number;
}

interface RejectResponse {
  extraction_id: string;
  status: string;
  version: number;
}

describe('E2E reject path (DIS-105)', () => {
  it('no row inserted into lab_results', async () => {
    const { app, db, orchestrator, labInsertCalls } = build();

    // 1. POST /ingest — creates extraction in `uploaded`.
    const ingestRes = await app.request('/ingest', {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        'x-patient-id': 'pat-reject',
        'idempotency-key': 'idem-reject-1',
        'x-filename': 'labs.pdf',
      },
      body: Buffer.from('%PDF-1.4\nfake\n'),
    });
    expect(ingestRes.status).toBe(201);
    const ingestBody = (await ingestRes.json()) as IngestResponse;
    const extractionId = ingestBody.extraction_id;
    expect(ingestBody.status).toBe('uploaded');

    // 2. process() — advances through the native-text pipeline to
    //    ready_for_review (uploaded → structuring → ready_for_review).
    //    process() has no HTTP surface; it's worker-driven.
    const processed = await orchestrator.process(extractionId);
    expect(processed.status).toBe('ready_for_review');

    // 3. POST /extractions/:id/reject — operator rejection.
    const rejectRes = await app.request(`/extractions/${extractionId}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expected_version: processed.version,
        reason_code: 'illegible',
        actor: 'nurse-reject',
      }),
    });

    expect(rejectRes.status).toBe(200);
    const rejectBody = (await rejectRes.json()) as RejectResponse;
    expect(rejectBody.status).toBe('rejected');

    // Assertion A — wrapped db.query() never saw an insert-into-lab_results
    // SQL. This is the brief's preferred assertion; stays in place so a
    // future promotion wire-up that leaks through reject would fail here.
    expect(labInsertCalls.length).toBe(0);

    // Assertion B — the extraction never entered `promoted`. Reject is
    // terminal: the only paths into `promoted` are from `verified` or
    // `auto_approved`. Confirm via both the final row and the full
    // updateExtractionStatus call log.
    const finalRow = db.rows.find((r) => r.id === extractionId);
    expect(finalRow?.status).toBe('rejected');
    const statusesSeen = db.calls
      .filter((c) => c.op === 'updateExtractionStatus')
      .map((c) => (c.args as { newStatus: string }).newStatus);
    expect(statusesSeen).not.toContain('promoted');
  });
});
