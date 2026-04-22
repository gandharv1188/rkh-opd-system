/**
 * E2E — DIS-104. Retry recovery after a first-attempt OCR failure.
 *
 * Flow driven through the HTTP surface (app.fetch, no bound socket):
 *   1. POST /ingest               → id1 created, status=uploaded.
 *   2. POST /internal/process-job → id1 fails (OCR throws on first call).
 *   3. POST /extractions/id1/retry → id2 created, parent_extraction_id=id1.
 *   4. POST /internal/process-job → id2 succeeds (OCR second call returns
 *      a result; downstream structuring completes).
 *   5. GET /extractions/id1        → still readable, status advanced past
 *      'uploaded' (transitioned to 'failed' by the failure path).
 *   6. GET /extractions/id2        → status advanced past 'uploaded'.
 *
 * The original extraction row is preserved for audit — not mutated back
 * to 'uploaded' by retry, and still queryable after id2 is inserted.
 */

import { describe, expect, it } from 'vitest';

import { createServer } from '../../src/http/server.js';
import { IngestionOrchestrator } from '../../src/core/orchestrator.js';
import {
  FakeDatabaseAdapter,
  FakeFileRouterAdapter,
  FakePreprocessorAdapter,
  FakeQueueAdapter,
  FakeSecretsAdapter,
  FakeStorageAdapter,
  FakeStructuringAdapter,
} from '../helpers/index.js';
import type { OcrInput, OcrPort, OcrResult } from '../../src/ports/ocr.js';
import type { StructuringResult } from '../../src/ports/structuring.js';

const WORKER_TOKEN = 'e2e-retry-worker-token';

const structResult: StructuringResult = {
  provider: 'claude-haiku',
  providerVersion: 'e2e',
  rawResponse: {},
  structured: { ok: true },
  tokensUsed: { input: 1, output: 1 },
  costMicroINR: 1,
  latencyMs: 1,
};

/**
 * OCR fake that throws on the first call and succeeds on the second.
 * Simulates a transient provider outage that a retry can recover from.
 */
class FlakyOcrAdapter implements OcrPort {
  readonly calls: OcrInput[] = [];
  private attempts = 0;

  async extract(input: OcrInput): Promise<OcrResult> {
    this.calls.push(input);
    this.attempts += 1;
    if (this.attempts === 1) {
      throw new Error('ocr-provider-down');
    }
    return {
      provider: 'datalab',
      providerVersion: 'e2e',
      rawResponse: {},
      markdown: '# recovered',
      blocks: [],
      pageCount: 1,
      tokensUsed: { input: 1, output: 1 },
      costMicroINR: 1,
      latencyMs: 1,
    };
  }
}

function buildApp() {
  const db = new FakeDatabaseAdapter();
  const ocr = new FlakyOcrAdapter();
  const orchestrator = new IngestionOrchestrator({
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

  const app = createServer({
    routes: {
      ingest: { orchestrator },
      extractionsGet: { db },
      extractionsRetry: { orchestrator },
      processJob: { orchestrator, workerToken: WORKER_TOKEN },
    },
  });
  return { app, db, ocr };
}

interface IngestBody {
  extraction_id: string;
  status: string;
  version: number;
}
interface RetryBody {
  extraction_id: string;
  parent_extraction_id: string | null;
  status: string;
  version: number;
}
interface GetBody {
  id: string;
  patient_id: string;
  status: string;
  version: number;
  parent_extraction_id: string | null;
}
interface ProcessBody {
  extraction_id: string;
  status: string;
  version: number;
}

describe('DIS-104 — E2E retry recovery', () => {
  it('original extraction preserved', async () => {
    const { app, ocr } = buildApp();

    // 1. Ingest.
    const ingestRes = await app.fetch(
      new Request('http://local/ingest', {
        method: 'POST',
        headers: {
          'content-type': 'image/jpeg',
          'x-patient-id': 'pat-104',
          'idempotency-key': 'idem-104',
          'x-filename': 'scan.jpg',
        },
        body: Buffer.from('bytes'),
      }),
    );
    expect(ingestRes.status).toBe(201);
    const ingestBody = (await ingestRes.json()) as IngestBody;
    const id1 = ingestBody.extraction_id;
    expect(ingestBody.status).toBe('uploaded');

    // 2. First process attempt — OCR throws, orchestrator fails the row.
    const firstProcess = await app.fetch(
      new Request('http://local/internal/process-job', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-worker-token': WORKER_TOKEN,
        },
        body: JSON.stringify({ extraction_id: id1 }),
      }),
    );
    // Orchestrator rethrows after persisting the fail transition — the
    // generic error handler maps to 500.
    expect(firstProcess.status).toBe(500);
    expect(ocr.calls).toHaveLength(1);

    // 3. Retry — new row with parent pointer.
    const retryRes = await app.fetch(
      new Request(`http://local/extractions/${id1}/retry`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-operator-id': 'op-e2e',
        },
        body: JSON.stringify({}),
      }),
    );
    expect(retryRes.status).toBe(201);
    const retryBody = (await retryRes.json()) as RetryBody;
    const id2 = retryBody.extraction_id;
    expect(id2).not.toBe(id1);
    expect(retryBody.parent_extraction_id).toBe(id1);
    expect(retryBody.status).toBe('uploaded');
    expect(retryBody.version).toBe(1);

    // 4. Second process attempt — OCR succeeds, row advances.
    const secondProcess = await app.fetch(
      new Request('http://local/internal/process-job', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-worker-token': WORKER_TOKEN,
        },
        body: JSON.stringify({ extraction_id: id2 }),
      }),
    );
    expect(secondProcess.status).toBe(200);
    const secondBody = (await secondProcess.json()) as ProcessBody;
    expect(secondBody.extraction_id).toBe(id2);
    expect(secondBody.status).not.toBe('uploaded');
    expect(ocr.calls).toHaveLength(2);

    // 5. id1 still readable — preserved for audit, not mutated back.
    const getParent = await app.fetch(
      new Request(`http://local/extractions/${id1}`, { method: 'GET' }),
    );
    expect(getParent.status).toBe(200);
    const parentRow = (await getParent.json()) as GetBody;
    expect(parentRow.id).toBe(id1);
    expect(parentRow.status).not.toBe('uploaded');
    expect(parentRow.parent_extraction_id).toBeNull();

    // 6. id2 advanced past uploaded.
    const getChild = await app.fetch(
      new Request(`http://local/extractions/${id2}`, { method: 'GET' }),
    );
    expect(getChild.status).toBe(200);
    const childRow = (await getChild.json()) as GetBody;
    expect(childRow.id).toBe(id2);
    expect(childRow.parent_extraction_id).toBe(id1);
    expect(childRow.status).not.toBe('uploaded');
  });
});
