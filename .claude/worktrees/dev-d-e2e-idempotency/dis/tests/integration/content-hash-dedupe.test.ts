/**
 * Integration tests — DIS-041 — Content-hash + storage dedupe.
 *
 * Composes `sha256()` from DIS-027 with the orchestrator's idempotency path:
 * the caller derives a content hash over the bytes, passes that hash as the
 * `idempotencyKey` on both submissions, and asserts that the second call
 * resolves to the SAME extraction_id as the first and DOES NOT trigger a
 * second `storage.putObject`.
 *
 * Why this is a meaningful integration: the orchestrator's dedupe key is the
 * idempotency key; `sha256(bytes)` is the caller-facing content hash. Wiring
 * the two at the boundary is the actual dedupe behaviour real callers rely
 * on. If sha256 is not deterministic over identical inputs, the second
 * submission would miss the idempotency lookup and produce a duplicate
 * storage write.
 *
 * Out of scope: real Supabase Storage (DIS-053 integration).
 *
 * @see backlog DIS-041
 * @see dis/src/core/content-hash.ts (DIS-027)
 * @see dis/src/core/orchestrator.ts — `ingest()` idempotency branch
 */

import { describe, it, expect } from 'vitest';

import { IngestionOrchestrator } from '../../src/core/orchestrator.js';
import { sha256 } from '../../src/core/content-hash.js';
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
import type { OcrResult } from '../../src/ports/ocr.js';
import type { StructuringResult } from '../../src/ports/structuring.js';

const OCR_RESULT: OcrResult = {
  provider: 'datalab',
  providerVersion: 'test',
  rawResponse: {},
  markdown: '# doc',
  pageCount: 1,
  latencyMs: 10,
};

const STRUCT_RESULT: StructuringResult = {
  provider: 'claude-haiku',
  providerVersion: 'test',
  rawResponse: {},
  structured: { ok: true },
  tokensUsed: { input: 1, output: 1 },
  costMicroINR: 100,
  latencyMs: 10,
};

function buildOrchestrator() {
  const db = new FakeDatabaseAdapter();
  const storage = new FakeStorageAdapter();
  const queue = new FakeQueueAdapter();
  const secrets = new FakeSecretsAdapter({});
  const router = new FakeFileRouterAdapter({
    'note.pdf': { success: { kind: 'native_text', pageCount: 1 } },
  });
  const preprocessor = new FakePreprocessorAdapter();
  const ocr = new FakeOcrAdapter({ hello: { success: OCR_RESULT } });
  const structuring = new FakeStructuringAdapter({
    generic: { success: STRUCT_RESULT },
  });
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
  return { orch, db, storage };
}

describe('content-hash + storage dedupe integration (DIS-041)', () => {
  it('sha256 is deterministic: identical bytes produce identical digest', () => {
    const bytes = Buffer.from('the quick brown fox');
    const a = sha256(bytes);
    const b = sha256(Buffer.from('the quick brown fox'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different bytes produce different digests (sanity)', () => {
    expect(sha256(Buffer.from('a'))).not.toBe(sha256(Buffer.from('b')));
  });

  it('two ingest calls with byte-identical payload resolve to the same extraction_id and only ONE putObject', async () => {
    const { orch, storage, db } = buildOrchestrator();

    const body = Buffer.from('IDENTICAL-FILE-BYTES');
    const contentHash = sha256(body);

    // Caller wires content_hash → Idempotency-Key. Byte-identical payloads
    // therefore collide on the idempotency key.
    const first = await orch.ingest({
      patientId: 'pat-1',
      idempotencyKey: contentHash,
      filename: 'note.pdf',
      contentType: 'application/pdf',
      body,
    });

    const second = await orch.ingest({
      patientId: 'pat-1',
      idempotencyKey: contentHash,
      filename: 'note.pdf',
      contentType: 'application/pdf',
      body,
    });

    // Same extraction — dedupe succeeded.
    expect(second.id).toBe(first.id);
    expect(second.version).toBe(first.version);

    // Storage observed exactly ONE putObject — no duplicate write.
    expect(storage.puts.length).toBe(1);
    expect(storage.puts[0]?.body).toBe(body);

    // DB observed exactly one insertExtraction.
    const inserts = db.calls.filter((c) => c.op === 'insertExtraction');
    expect(inserts.length).toBe(1);
  });

  it('second call with the same contentHash but different bytes surfaces an idempotency collision (no dedupe)', async () => {
    const { orch, storage } = buildOrchestrator();

    const bodyA = Buffer.from('ORIGINAL');
    const bodyB = Buffer.from('TAMPERED');
    const keyA = sha256(bodyA);

    await orch.ingest({
      patientId: 'pat-1',
      idempotencyKey: keyA,
      filename: 'note.pdf',
      contentType: 'application/pdf',
      body: bodyA,
    });

    // Re-using the digest of A as the key for B simulates a caller that
    // lies about the content hash. Orchestrator's payload_hash guard
    // (derived from filename+size+…) differs, so it rejects.
    await expect(
      orch.ingest({
        patientId: 'pat-1',
        idempotencyKey: keyA,
        filename: 'different.pdf',
        contentType: 'application/pdf',
        body: bodyB,
      }),
    ).rejects.toThrow(/IDEMPOTENCY_KEY_CONFLICT|different payload/i);

    // No second putObject on the collision path.
    expect(storage.puts.length).toBe(1);
  });

  it('sha256 accepts Buffer and string inputs equivalently (utf8-encoded)', () => {
    const text = 'pediatric-opd-note';
    const fromString = sha256(text);
    const fromBuffer = sha256(Buffer.from(text, 'utf8'));
    // Equivalence matters because the HTTP layer may stage bytes as
    // either a streamed Buffer or a decoded string; content_hash MUST
    // be identical so dedupe works across both code paths.
    expect(fromString).toBe(fromBuffer);
  });
});
