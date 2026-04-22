/**
 * Fake adapter factory for core unit tests (DIS-012).
 *
 * These fakes are "script-driven": each constructor accepts a record keyed by
 * an input identifier (filename, storage key, secret name, topic, …), mapping
 * to either a `success` payload or an `error` code. They live at the test
 * boundary (composed into core tests), distinct from the lightweight
 * orchestrator fakes under `dis/src/core/__fakes__/`.
 *
 * Design invariants:
 *   - Imports only from `dis/src/ports/*` — never from `dis/src/adapters/*`.
 *     Enforced by fitness rule + VERIFY-5 on DIS-012.
 *   - No I/O, no timers, no randomness. All behaviour comes from the script.
 *   - Every call is recorded on `.calls` for test assertions.
 */

import type {
  DatabasePort,
  DocumentTextExtractorPort,
  ExtractionInput,
  ExtractionResult,
  FileRouterInput,
  FileRouterPort,
  GetObjectResult,
  OcrInput,
  OcrPort,
  OcrResult,
  PreprocessedDocument,
  PreprocessorInput,
  PreprocessorPort,
  PutObjectInput,
  PutObjectResult,
  QueueHandler,
  QueuePayload,
  QueuePort,
  RoutingDecision,
  SecretsPort,
  SignedUploadUrlInput,
  SignedUploadUrlResult,
  SignedDownloadUrlResult,
  StoragePort,
  StructuringInput,
  StructuringPort,
  StructuringResult,
  EnqueueOptions,
  EnqueueResult,
} from '../../src/ports/index.js';
import type { ExtractionRow, InsertExtractionInput } from '../../src/ports/database.js';
import type { State } from '../../src/core/state-machine.js';

/**
 * Script entry: either a success payload of type `T` or an error code that
 * the fake will translate to `new Error(code)`.
 */
export type Scripted<T> = { success: T } | { error: string };

function resolve<T>(entry: Scripted<T> | undefined, missingMsg: string): T {
  if (!entry) throw new Error(missingMsg);
  if ('error' in entry) throw new Error(entry.error);
  return entry.success;
}

// --------------------------------------------------------------------------
// OCR
// --------------------------------------------------------------------------

export type OcrScript = Record<string, Scripted<OcrResult>>;

export class FakeOcrAdapter implements OcrPort {
  readonly calls: Array<{ key: string; input: OcrInput }> = [];

  constructor(private readonly script: OcrScript) {}

  async extract(input: OcrInput): Promise<OcrResult> {
    const key = this.keyOf(input);
    this.calls.push({ key, input });
    return resolve(this.script[key], `FakeOcrAdapter: no script entry for ${key}`);
  }

  /** Lets tests use any deterministic string as the script key (e.g. filename). */
  private keyOf(input: OcrInput): string {
    const first = input.pages[0];
    if (first && first.length > 0 && first.length < 128) return first.toString('utf8');
    return `pages:${input.pages.length}/${input.mediaType}`;
  }
}

// --------------------------------------------------------------------------
// Structuring
// --------------------------------------------------------------------------

export type StructuringScript = Record<string, Scripted<StructuringResult>>;

export class FakeStructuringAdapter implements StructuringPort {
  readonly calls: Array<{ key: string; input: StructuringInput }> = [];

  constructor(private readonly script: StructuringScript) {}

  async structure(input: StructuringInput): Promise<StructuringResult> {
    const key = input.documentCategory;
    this.calls.push({ key, input });
    return resolve(this.script[key], `FakeStructuringAdapter: no script entry for ${key}`);
  }
}

// --------------------------------------------------------------------------
// Storage
// --------------------------------------------------------------------------

export type StorageScript = Record<string, Scripted<GetObjectResult>>;

export class FakeStorageAdapter implements StoragePort {
  readonly puts: PutObjectInput[] = [];
  readonly deletes: string[] = [];
  readonly gets: string[] = [];
  private readonly store = new Map<string, GetObjectResult>();

  constructor(private readonly script: StorageScript = {}) {
    for (const [key, entry] of Object.entries(script)) {
      if ('success' in entry) this.store.set(key, entry.success);
    }
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    this.puts.push(input);
    this.store.set(input.key, {
      kind: 'get',
      body: input.body,
      contentType: input.contentType,
      metadata: input.metadata,
    });
    return { kind: 'put', etag: `etag-${input.key}` };
  }

  async getObject(key: string): Promise<GetObjectResult> {
    this.gets.push(key);
    const scripted = this.script[key];
    if (scripted && 'error' in scripted) throw new Error(scripted.error);
    const obj = this.store.get(key);
    if (!obj) throw new Error(`FakeStorageAdapter: no object for key ${key}`);
    return obj;
  }

  async getSignedUploadUrl(input: SignedUploadUrlInput): Promise<SignedUploadUrlResult> {
    return { kind: 'signed-upload', url: `https://fake-storage.invalid/${input.key}` };
  }

  async getSignedDownloadUrl(key: string, _expiresSec: number): Promise<SignedDownloadUrlResult> {
    return { kind: 'signed-download', url: `https://fake-storage.invalid/${key}` };
  }

  async deleteObject(key: string): Promise<void> {
    this.deletes.push(key);
    this.store.delete(key);
  }
}

// --------------------------------------------------------------------------
// Database
// --------------------------------------------------------------------------

type QueryScriptEntry = Scripted<readonly unknown[]>;
export type DatabaseScript = {
  queries?: Record<string, QueryScriptEntry>;
};

/**
 * In-memory DatabasePort fake covering the full port surface:
 * named extraction methods (with optimistic lock on `version`), generic
 * query/queryOne, transaction wrapping, and session-var bookkeeping.
 */
export class FakeDatabaseAdapter implements DatabasePort {
  readonly rows: ExtractionRow[] = [];
  readonly calls: Array<{ op: string; args: unknown }> = [];
  readonly sessionVars: Array<Readonly<Record<string, string>>> = [];

  constructor(private readonly script: DatabaseScript = {}) {}

  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    this.calls.push({ op: 'query', args: { sql, params } });
    const entry = this.script.queries?.[sql];
    if (!entry) return [];
    if ('error' in entry) throw new Error(entry.error);
    return entry.success as readonly T[];
  }

  async queryOne<T>(sql: string, params: readonly unknown[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T> {
    this.calls.push({ op: 'transaction', args: null });
    return work(this);
  }

  async setSessionVars(vars: Readonly<Record<string, string>>): Promise<void> {
    this.calls.push({ op: 'setSessionVars', args: vars });
    this.sessionVars.push(vars);
  }

  async findExtractionById(id: string): Promise<ExtractionRow | null> {
    this.calls.push({ op: 'findExtractionById', args: { id } });
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findExtractionByIdempotencyKey(key: string): Promise<ExtractionRow | null> {
    this.calls.push({ op: 'findExtractionByIdempotencyKey', args: { key } });
    return this.rows.find((r) => r.idempotency_key === key) ?? null;
  }

  async updateExtractionStatus(
    id: string,
    expectedVersion: number,
    newStatus: State,
  ): Promise<ExtractionRow | null> {
    this.calls.push({ op: 'updateExtractionStatus', args: { id, expectedVersion, newStatus } });
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const current = this.rows[idx];
    if (!current || current.version !== expectedVersion) return null;
    const updated: ExtractionRow = {
      ...current,
      status: newStatus,
      version: current.version + 1,
    };
    this.rows[idx] = updated;
    return updated;
  }

  async insertExtraction(input: InsertExtractionInput): Promise<ExtractionRow> {
    this.calls.push({ op: 'insertExtraction', args: input });
    const row: ExtractionRow = {
      id: input.id,
      patient_id: input.patientId,
      status: input.status,
      version: 1,
      idempotency_key: input.idempotencyKey,
      payload_hash: input.payloadHash,
      parent_extraction_id: input.parentExtractionId,
    };
    this.rows.push(row);
    return row;
  }
}

// --------------------------------------------------------------------------
// Queue
// --------------------------------------------------------------------------

export type QueueScript = {
  enqueue?: Record<string, Scripted<EnqueueResult>>;
};

export class FakeQueueAdapter implements QueuePort {
  readonly enqueued: Array<{ topic: string; payload: QueuePayload; opts?: EnqueueOptions }> = [];
  readonly consumers = new Map<string, QueueHandler>();
  private seq = 0;

  constructor(private readonly script: QueueScript = {}) {}

  async enqueue(
    topic: string,
    payload: QueuePayload,
    opts?: EnqueueOptions,
  ): Promise<EnqueueResult> {
    this.enqueued.push({ topic, payload, opts });
    const scripted = this.script.enqueue?.[topic];
    if (scripted) {
      if ('error' in scripted) throw new Error(scripted.error);
      return scripted.success;
    }
    this.seq += 1;
    return { messageId: `fake-msg-${this.seq}` };
  }

  async startConsumer(topic: string, handler: QueueHandler): Promise<void> {
    this.consumers.set(topic, handler);
  }
}

// --------------------------------------------------------------------------
// Secrets
// --------------------------------------------------------------------------

export type SecretsScript = Record<string, Scripted<string>>;

export class FakeSecretsAdapter implements SecretsPort {
  readonly calls: string[] = [];

  constructor(private readonly script: SecretsScript) {}

  async get(name: string): Promise<string> {
    this.calls.push(name);
    return resolve(this.script[name], `FakeSecretsAdapter: secret not set: ${name}`);
  }
}

// --------------------------------------------------------------------------
// File router
// --------------------------------------------------------------------------

export type FileRouterScript = Record<string, Scripted<RoutingDecision>>;

export class FakeFileRouterAdapter implements FileRouterPort {
  readonly calls: FileRouterInput[] = [];

  constructor(private readonly script: FileRouterScript) {}

  async route(input: FileRouterInput): Promise<RoutingDecision> {
    this.calls.push(input);
    return resolve(
      this.script[input.filename],
      `FakeFileRouterAdapter: no script entry for ${input.filename}`,
    );
  }
}

// --------------------------------------------------------------------------
// Document text extractor (ADR-008)
// --------------------------------------------------------------------------

export type DocumentTextExtractorScript = Record<string, Scripted<ExtractionResult>>;

/**
 * Script-driven fake for {@link DocumentTextExtractorPort}.
 *
 * Key resolution order:
 *   1. `input.hints?.scriptKey` if it is a string — preferred, explicit.
 *   2. `input.mediaType` — fallback for tests that only care about MIME.
 */
export class FakeDocumentTextExtractorAdapter implements DocumentTextExtractorPort {
  readonly calls: Array<{ key: string; input: ExtractionInput }> = [];

  constructor(private readonly script: DocumentTextExtractorScript) {}

  async routeAndExtract(input: ExtractionInput): Promise<ExtractionResult> {
    const key = this.keyOf(input);
    this.calls.push({ key, input });
    return resolve(
      this.script[key],
      `FakeDocumentTextExtractorAdapter: no script entry for ${key}`,
    );
  }

  private keyOf(input: ExtractionInput): string {
    const hint = input.hints?.['scriptKey'];
    if (typeof hint === 'string') return hint;
    return input.mediaType;
  }
}

// --------------------------------------------------------------------------
// Preprocessor
// --------------------------------------------------------------------------

export type PreprocessorScript = Record<string, Scripted<PreprocessedDocument>>;

export class FakePreprocessorAdapter implements PreprocessorPort {
  readonly calls: PreprocessorInput[] = [];

  constructor(private readonly script: PreprocessorScript = {}) {}

  async preprocess(input: PreprocessorInput): Promise<PreprocessedDocument> {
    this.calls.push(input);
    const key = input.mediaType;
    const scripted = this.script[key];
    if (scripted) {
      if ('error' in scripted) throw new Error(scripted.error);
      return scripted.success;
    }
    return {
      pages: input.pages,
      dropped: { blank: 0, duplicate: 0 },
      originalPageCount: input.pages.length,
    };
  }
}
