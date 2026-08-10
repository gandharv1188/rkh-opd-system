/**
 * E2E — DIS-106 — Idempotency replay.
 *
 * Submits the same `Idempotency-Key` (and same body) five times through the
 * full HTTP stack (createServer → ingest route → IngestionOrchestrator →
 * DatabasePort) and asserts:
 *   - every response is 201
 *   - exactly one `extraction_id` is observed across all five replies
 *   - the database fake contains exactly one extraction row
 *
 * Depends on DIS-090 (POST /ingest) and DIS-025 (idempotency store). The
 * orchestrator's `ingest()` calls `findExtractionByIdempotencyKey` first and
 * short-circuits to the existing row on replay.
 *
 * @see backlog DIS-106
 * @see dis/src/core/orchestrator.ts — `ingest()` idempotency branch
 */

import { describe, it, expect } from 'vitest';

import { createServer } from '../../src/http/server.js';
import { IngestionOrchestrator } from '../../src/core/orchestrator.js';
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

interface SuccessBody {
  extraction_id: string;
  status: string;
  version: number;
  correlation_id: string;
}

describe('E2E idempotency replay', () => {
  it('replay yields a single extraction_id', async () => {
    const db = new FakeDatabaseAdapter();
    const storage = new FakeStorageAdapter();
    const queue = new FakeQueueAdapter();
    const secrets = new FakeSecretsAdapter({});
    const fileRouter = new FakeFileRouterAdapter({});
    const preprocessor = new FakePreprocessorAdapter();
    const ocr = new FakeOcrAdapter({});
    const structuring = new FakeStructuringAdapter({});

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

    const app = createServer({ routes: { ingest: { orchestrator } } });

    const headers = {
      'content-type': 'application/pdf',
      'X-Patient-Id': 'pt-1',
      'Idempotency-Key': 'idem-replay',
      'X-Filename': 'report.pdf',
    };
    const body = Buffer.from('%PDF-1.4\nidempotency replay body\n');

    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/ingest', { method: 'POST', headers, body });
      expect(res.status).toBe(201);
      const parsed = (await res.json()) as SuccessBody;
      ids.add(parsed.extraction_id);
    }

    expect(ids.size).toBe(1);
    expect(db.rows).toHaveLength(1);
    expect(storage.puts).toHaveLength(1);
  });
});
