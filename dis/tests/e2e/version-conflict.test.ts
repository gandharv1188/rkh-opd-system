/**
 * E2E — DIS-107
 *
 * Two operators approve the same extraction concurrently. The first request
 * wins (bumps version 1 → 2); the second arrives with a now-stale
 * expected_version=1 and must receive `409 VERSION_CONFLICT` via the
 * DIS-101 error envelope.
 *
 * Covers the full HTTP seam — route parsing, orchestrator version-lock,
 * VersionConflictError mapping — through `createServer(...)`.
 */

import { describe, it, expect } from 'vitest';

import { createServer } from '../../src/http/server.js';
import { IngestionOrchestrator } from '../../src/core/orchestrator.js';
import type {
  DatabasePort,
  ExtractionRow,
  InsertExtractionInput,
} from '../../src/ports/database.js';
import type { State } from '../../src/core/state-machine.js';
import type { StoragePort } from '../../src/ports/storage.js';
import type { QueuePort } from '../../src/ports/queue.js';
import type { SecretsPort } from '../../src/ports/secrets.js';
import type { FileRouterPort } from '../../src/ports/file-router.js';
import type { PreprocessorPort } from '../../src/ports/preprocessor.js';
import type { OcrPort } from '../../src/ports/ocr.js';
import type { StructuringPort } from '../../src/ports/structuring.js';

function makeFakeDb(seed: ExtractionRow): DatabasePort & { row: ExtractionRow } {
  const row = { ...seed };
  const unused = (): never => {
    throw new Error('unused in this test');
  };
  return {
    row,
    async findExtractionById(id: string): Promise<ExtractionRow | null> {
      return id === row.id ? { ...row } : null;
    },
    async findExtractionByIdempotencyKey(): Promise<ExtractionRow | null> {
      return null;
    },
    async updateExtractionStatus(
      id: string,
      expectedVersion: number,
      newStatus: State,
    ): Promise<ExtractionRow | null> {
      if (id !== row.id || row.version !== expectedVersion) return null;
      row.status = newStatus;
      row.version += 1;
      return { ...row };
    },
    async insertExtraction(_input: InsertExtractionInput): Promise<ExtractionRow> {
      return unused();
    },
    async query<T>(): Promise<readonly T[]> {
      return unused();
    },
    async queryOne<T>(): Promise<T | null> {
      return unused();
    },
    async transaction<T>(): Promise<T> {
      return unused();
    },
    async setSessionVars(): Promise<void> {
      return unused();
    },
  };
}

// Tight stubs for ports the approve path never touches. Throwing on call
// would flag any unintended coupling introduced in future refactors.
const throwingStub = <T extends object>(name: string): T =>
  new Proxy({} as T, {
    get(_t, prop) {
      return () => {
        throw new Error(`${name}.${String(prop)} should not be called in approve path`);
      };
    },
  });

describe('E2E version conflict on approve', () => {
  it('second approve returns 409', async () => {
    const seed: ExtractionRow = {
      id: 'ext-1',
      patient_id: 'pt-1',
      status: 'ready_for_review',
      version: 1,
      idempotency_key: 'idem',
      payload_hash: 'h',
      parent_extraction_id: null,
    };
    const fakeDb = makeFakeDb(seed);

    const orchestrator = new IngestionOrchestrator({
      db: fakeDb,
      storage: throwingStub<StoragePort>('storage'),
      queue: throwingStub<QueuePort>('queue'),
      secrets: throwingStub<SecretsPort>('secrets'),
      fileRouter: throwingStub<FileRouterPort>('fileRouter'),
      preprocessor: throwingStub<PreprocessorPort>('preprocessor'),
      ocr: throwingStub<OcrPort>('ocr'),
      structuring: throwingStub<StructuringPort>('structuring'),
    });

    const app = createServer({
      routes: { extractionsApprove: { orchestrator } },
    });

    const r1 = await app.request('/extractions/ext-1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expected_version: 1, actor: 'op-A' }),
    });
    expect(r1.status).toBeLessThan(400);
    expect(fakeDb.row.version).toBe(2);
    expect(fakeDb.row.status).toBe('verified');

    const r2 = await app.request('/extractions/ext-1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expected_version: 1, actor: 'op-B' }),
    });
    expect(r2.status).toBe(409);
    const body = (await r2.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VERSION_CONFLICT');
  });
});
