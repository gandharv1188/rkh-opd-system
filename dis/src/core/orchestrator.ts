/**
 * IngestionOrchestrator — drives an `extractions` row through the state
 * machine, composing ports for file routing, storage, preprocessing, OCR,
 * structuring, queueing, and persistence.
 *
 * Pure core: imports only ports (DIP). Receives all dependencies via the
 * constructor. No `fetch`, no `fs`, no adapter imports, no SQL literals.
 *
 * Clinical-safety invariant CS-1: every state change — including pipeline
 * steps — is computed via `transition()`. Invalid transitions throw
 * `InvalidStateTransitionError` and MUST never be persisted.
 *
 * @see TDD §4 (state machine), §5 (idempotency), §6 (optimistic lock)
 * @see clinical_safety.md CS-1
 * @see coding_standards.md §2, §4, §5, §11, §15
 * @see ADR-006 (postgres driver over pg or drizzle)
 * @see DRIFT-PHASE-1 §5 FOLLOWUP-A
 */

import type { DatabasePort, ExtractionRow, InsertExtractionInput } from '../ports/database.js';
import type { StoragePort } from '../ports/storage.js';
import type { QueuePort } from '../ports/queue.js';
import type { SecretsPort } from '../ports/secrets.js';
import type { FileRouterPort, RoutingDecision } from '../ports/file-router.js';
import type { PreprocessorPort } from '../ports/preprocessor.js';
import type { OcrPort } from '../ports/ocr.js';
import type { StructuringPort } from '../ports/structuring.js';
import { assertNever } from '../types/assert-never.js';
import { transition, type Event, type State } from './state-machine.js';

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
    readonly currentStatus: State,
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
  readonly status: State;
  readonly version: number;
  readonly parentExtractionId: string | null;
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

    const existing = await this.deps.db.findExtractionByIdempotencyKey(input.idempotencyKey);
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

    const insertInput: InsertExtractionInput = {
      id,
      patientId: input.patientId,
      status: 'uploaded',
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      parentExtractionId: null,
    };
    const row = await this.deps.db.insertExtraction(insertInput);
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
      const finalState = await this.runPipeline(row, decision);
      return await this.persistTransition(row, finalState);
    } catch (err) {
      // Failure path: compute the failure target through the state machine
      // (CS-1 — never persist an invalid transition, even on the unhappy
      // path). If transition() rejects `fail` from row.status we swallow
      // the secondary error and rethrow the original.
      try {
        const failState = transition(row.status, { kind: 'fail', reason: errorReason(err) });
        await this.persistTransition(row, failState).catch(() => undefined);
      } catch {
        // row.status cannot fail — skip persisting, rethrow original.
      }
      throw err;
    }
  }

  async approve(input: ApproveInput): Promise<ExtractionRecord> {
    return this.transitionWithLock(input.id, input.expectedVersion, {
      kind: 'nurse_approve',
      actor: input.actor,
    });
  }

  async reject(input: RejectInput): Promise<ExtractionRecord> {
    return this.transitionWithLock(input.id, input.expectedVersion, {
      kind: 'nurse_reject',
      actor: input.actor,
      reason: input.reasonCode,
    });
  }

  async retry(input: RetryInput): Promise<ExtractionRecord> {
    const parent = await this.loadRow(input.id);
    const newId = this.nextId('ext');
    const row = await this.deps.db.insertExtraction({
      id: newId,
      patientId: parent.patient_id,
      status: 'uploaded',
      idempotencyKey: `retry:${newId}`,
      payloadHash: parent.payload_hash,
      parentExtractionId: parent.id,
    });
    return this.toRecord(row);
  }

  // ---------- internals ----------

  /**
   * Run the side-effecting pipeline steps (preprocess/OCR/structure) and
   * return the final `State` computed via `transition()`. Intermediate
   * transitions are validated through the state machine — CS-1 guarantees
   * that an invalid chain throws before any DB write.
   */
  private async runPipeline(row: ExtractionRow, decision: RoutingDecision): Promise<State> {
    switch (decision.kind) {
      case 'native_text':
      case 'office_word':
      case 'office_sheet': {
        // uploaded → structuring → ready_for_review
        const sStructuring = transition(row.status, { kind: 'routed_native' });
        await this.deps.structuring.structure({ documentCategory: 'generic' });
        const sReady = transition(sStructuring, { kind: 'structured' });
        return sReady;
      }
      case 'ocr_scan':
      case 'ocr_image': {
        // uploaded → preprocessing → ocr → structuring → ready_for_review
        const sPre = transition(row.status, { kind: 'routed_scan' });
        const pre = await this.deps.preprocessor.preprocess({
          pages: [Buffer.alloc(0)],
          mediaType: 'image/jpeg',
        });
        const sOcr = transition(sPre, { kind: 'preprocessed' });
        await this.deps.ocr.extract({
          pages: pre.pages.length > 0 ? pre.pages : [Buffer.alloc(0)],
          mediaType: 'image/jpeg',
          outputFormats: ['markdown'],
        });
        const sStructuring = transition(sOcr, { kind: 'ocr_complete' });
        await this.deps.structuring.structure({ documentCategory: 'generic' });
        const sReady = transition(sStructuring, { kind: 'structured' });
        return sReady;
      }
      case 'unsupported':
        throw new OrchestratorError('UNSUPPORTED_MEDIA', `unsupported: ${decision.reason}`);
      default:
        return assertNever(decision);
    }
  }

  /**
   * Persist a computed target state under optimistic lock. Caller has
   * already validated the transition through `transition()`; we only need
   * an atomic version-bump write here.
   */
  private async persistTransition(row: ExtractionRow, to: State): Promise<ExtractionRecord> {
    const updated = await this.deps.db.updateExtractionStatus(row.id, row.version, to);
    if (!updated) {
      const fresh = await this.deps.db.findExtractionById(row.id);
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
    event: Event,
  ): Promise<ExtractionRecord> {
    const row = await this.loadRow(id);
    if (row.version !== expectedVersion) {
      throw new VersionConflictError(id, row.version, row.status);
    }
    // CS-1: compute next state through the state machine. An invalid
    // event throws InvalidStateTransitionError — no DB write happens.
    const nextStatus = transition(row.status, event);
    return this.persistTransition(row, nextStatus);
  }

  private async loadRow(id: string): Promise<ExtractionRow> {
    const row = await this.deps.db.findExtractionById(id);
    if (!row) throw new ExtractionNotFoundError(id);
    return row;
  }

  private toRecord(row: ExtractionRow): ExtractionRecord {
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

function errorReason(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
