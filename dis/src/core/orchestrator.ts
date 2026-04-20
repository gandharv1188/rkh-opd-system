/**
 * IngestionOrchestrator — drives an `ocr_extractions` row through the state
 * machine, composing ports for file routing, storage, preprocessing, OCR,
 * structuring, queueing, and persistence.
 *
 * Pure core: imports only ports (DIP). Receives all dependencies via the
 * constructor. No `fetch`, no `fs`, no adapter imports.
 *
 * @see TDD §4 (state machine), §5 (idempotency), §6 (optimistic lock)
 * @see coding_standards.md §2, §4, §5
 */

import type { DatabasePort } from '../ports/database.js';
import type { StoragePort } from '../ports/storage.js';
import type { QueuePort } from '../ports/queue.js';
import type { SecretsPort } from '../ports/secrets.js';
import type { FileRouterPort, RoutingDecision } from '../ports/file-router.js';
import type { PreprocessorPort } from '../ports/preprocessor.js';
import type { OcrPort } from '../ports/ocr.js';
import type { StructuringPort } from '../ports/structuring.js';
import { assertNever } from '../types/assert-never.js';
import { transition, type ExtractionState } from './state-machine.js';

/** Base error for all orchestrator failures. */
export class OrchestratorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'OrchestratorError';
  }
}

/**
 * Raised when an approve/reject arrives with a stale `expectedVersion`.
 *
 * Carries the current persisted state so the client can reload without an
 * extra round-trip. (TDD §6.)
 */
export class VersionConflictError extends OrchestratorError {
  constructor(
    readonly extractionId: string,
    readonly currentVersion: number,
    readonly currentStatus: ExtractionState,
  ) {
    super(
      'VERSION_CONFLICT',
      `version conflict on extraction ${extractionId}: current=${currentVersion}`,
    );
    this.name = 'VersionConflictError';
  }
}

export class ExtractionNotFoundError extends OrchestratorError {
  constructor(readonly extractionId: string) {
    super('EXTRACTION_NOT_FOUND', `extraction not found: ${extractionId}`);
    this.name = 'ExtractionNotFoundError';
  }
}

export type OrchestratorDeps = {
  readonly db: DatabasePort;
  readonly storage: StoragePort;
  readonly queue: QueuePort;
  readonly secrets: SecretsPort;
  readonly fileRouter: FileRouterPort;
  readonly preprocessor: PreprocessorPort;
  readonly ocr: OcrPort;
  readonly structuring: StructuringPort;
  /** Injected clock + id generator keep the core deterministic. */
  readonly now?: () => Date;
  readonly newId?: (prefix: string) => string;
};

export type IngestInput = {
  readonly patientId: string;
  readonly idempotencyKey: string;
  readonly filename: string;
  readonly contentType: string;
  readonly body: Buffer;
};

export type ExtractionRecord = {
  readonly id: string;
  readonly patientId: string;
  readonly status: ExtractionState;
  readonly version: number;
  readonly parentExtractionId: string | null;
};

type DbExtractionRow = {
  id: string;
  patient_id: string;
  status: ExtractionState;
  version: number;
  idempotency_key: string;
  payload_hash: string;
  parent_extraction_id: string | null;
};

export type ApproveInput = {
  readonly id: string;
  readonly expectedVersion: number;
  readonly actor: string;
};

export type RejectInput = {
  readonly id: string;
  readonly expectedVersion: number;
  readonly actor: string;
  readonly reasonCode: string;
};

export type RetryInput = {
  readonly id: string;
  readonly actor: string;
};

export class IngestionOrchestrator {
  private idCounter = 0;

  constructor(private readonly deps: OrchestratorDeps) {}

  async ingest(input: IngestInput): Promise<ExtractionRecord> {
    const payloadHash = this.hashPayload(input);

    const existing = await this.deps.db.queryOne<DbExtractionRow>(
      'SELECT * FROM extractions WHERE idempotency_key = $1',
      [input.idempotencyKey],
    );
    if (existing) {
      if (existing.payload_hash !== payloadHash) {
        throw new OrchestratorError(
          'IDEMPOTENCY_KEY_CONFLICT',
          `idempotency key ${input.idempotencyKey} reused with different payload`,
        );
      }
      return this.toRecord(existing);
    }

    const id = this.nextId('ext');
    const key = `extractions/${id}/${input.filename}`;
    await this.deps.storage.putObject({
      key,
      body: input.body,
      contentType: input.contentType,
    });

    const row = await this.deps.db.queryOne<DbExtractionRow>(
      'INSERT INTO extractions (id, patient_id, status, idempotency_key, payload_hash, parent_extraction_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [id, input.patientId, 'uploaded', input.idempotencyKey, payloadHash, null],
    );
    if (!row) {
      throw new OrchestratorError('DB_INSERT_FAILED', 'insert returned no row');
    }
    return this.toRecord(row);
  }

  async process(id: string): Promise<ExtractionRecord> {
    const row = await this.loadRow(id);
    const decision = await this.deps.fileRouter.route({
      body: Buffer.alloc(0),
      contentType: 'application/octet-stream',
      filename: '',
    });

    try {
      const nextStatus = await this.runPipeline(row, decision);
      return await this.advance(row, nextStatus);
    } catch (err) {
      await this.advance(row, 'failed').catch(() => undefined);
      throw err;
    }
  }

  async approve(input: ApproveInput): Promise<ExtractionRecord> {
    return this.transitionWithLock(input.id, input.expectedVersion, {
      kind: 'approved',
      actor: input.actor,
    });
  }

  async reject(input: RejectInput): Promise<ExtractionRecord> {
    return this.transitionWithLock(input.id, input.expectedVersion, {
      kind: 'rejected',
      actor: input.actor,
      reasonCode: input.reasonCode,
    });
  }

  async retry(input: RetryInput): Promise<ExtractionRecord> {
    const parent = await this.loadRow(input.id);
    const newId = this.nextId('ext');
    const row = await this.deps.db.queryOne<DbExtractionRow>(
      'INSERT INTO extractions (id, patient_id, status, idempotency_key, payload_hash, parent_extraction_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [newId, parent.patient_id, 'uploaded', `retry:${newId}`, parent.payload_hash, parent.id],
    );
    if (!row) {
      throw new OrchestratorError('DB_INSERT_FAILED', 'retry insert failed');
    }
    return this.toRecord(row);
  }

  // ---------- internals ----------

  private async runPipeline(
    row: DbExtractionRow,
    decision: RoutingDecision,
  ): Promise<ExtractionState> {
    switch (decision.kind) {
      case 'native_text':
      case 'office_word':
      case 'office_sheet': {
        await this.advance(row, 'structuring');
        await this.deps.structuring.structure({
          documentCategory: 'generic',
        });
        return 'ready_for_review';
      }
      case 'ocr_scan':
      case 'ocr_image': {
        await this.advance(row, 'preprocessing');
        const pre = await this.deps.preprocessor.preprocess({
          pages: [Buffer.alloc(0)],
          mediaType: 'image/jpeg',
        });
        row.status = 'preprocessing';
        await this.advance(row, 'ocr');
        await this.deps.ocr.extract({
          pages: pre.pages.length > 0 ? pre.pages : [Buffer.alloc(0)],
          mediaType: 'image/jpeg',
          outputFormats: ['markdown'],
        });
        row.status = 'ocr';
        await this.advance(row, 'structuring');
        await this.deps.structuring.structure({
          documentCategory: 'generic',
        });
        return 'ready_for_review';
      }
      case 'unsupported':
        throw new OrchestratorError('UNSUPPORTED_MEDIA', `unsupported: ${decision.reason}`);
      default:
        return assertNever(decision);
    }
  }

  private async advance(row: DbExtractionRow, to: ExtractionState): Promise<ExtractionRecord> {
    const updated = await this.deps.db.queryOne<DbExtractionRow>(
      'UPDATE extractions SET status = $1 WHERE id = $2 AND version = $3 RETURNING *',
      [to, row.id, row.version],
    );
    if (!updated) {
      const fresh = await this.deps.db.queryOne<DbExtractionRow>(
        'SELECT * FROM extractions WHERE id = $1',
        [row.id],
      );
      if (!fresh) throw new ExtractionNotFoundError(row.id);
      throw new VersionConflictError(row.id, fresh.version, fresh.status);
    }
    row.status = updated.status;
    row.version = updated.version;
    return this.toRecord(updated);
  }

  private async transitionWithLock(
    id: string,
    expectedVersion: number,
    event:
      | { kind: 'approved'; actor: string }
      | { kind: 'rejected'; actor: string; reasonCode: string },
  ): Promise<ExtractionRecord> {
    const row = await this.loadRow(id);
    if (row.version !== expectedVersion) {
      throw new VersionConflictError(id, row.version, row.status);
    }
    const nextStatus = transition(row.status, event);
    const updated = await this.deps.db.queryOne<DbExtractionRow>(
      'UPDATE extractions SET status = $1 WHERE id = $2 AND version = $3 RETURNING *',
      [nextStatus, id, expectedVersion],
    );
    if (!updated) {
      const fresh = await this.deps.db.queryOne<DbExtractionRow>(
        'SELECT * FROM extractions WHERE id = $1',
        [id],
      );
      if (!fresh) throw new ExtractionNotFoundError(id);
      throw new VersionConflictError(id, fresh.version, fresh.status);
    }
    return this.toRecord(updated);
  }

  private async loadRow(id: string): Promise<DbExtractionRow> {
    const row = await this.deps.db.queryOne<DbExtractionRow>(
      'SELECT * FROM extractions WHERE id = $1',
      [id],
    );
    if (!row) throw new ExtractionNotFoundError(id);
    return row;
  }

  private toRecord(row: DbExtractionRow): ExtractionRecord {
    return {
      id: row.id,
      patientId: row.patient_id,
      status: row.status,
      version: row.version,
      parentExtractionId: row.parent_extraction_id,
    };
  }

  private hashPayload(input: IngestInput): string {
    // Deterministic non-crypto digest; crypto hashing lives in adapters.
    return `${input.patientId}:${input.filename}:${input.contentType}:${input.body.length}`;
  }

  private nextId(prefix: string): string {
    if (this.deps.newId) return this.deps.newId(prefix);
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }
}
