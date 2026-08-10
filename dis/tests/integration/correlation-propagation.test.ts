/**
 * Integration tests — DIS-042 — Correlation propagation.
 *
 * Asserts that a single correlation id bound at the HTTP boundary via
 * `withCorrelation()` (DIS-028) flows to every observability surface
 * touched inside one `orchestrator.ingest()` call:
 *
 *   (a) `currentCorrelationId()` returns the bound id anywhere in the
 *       async continuation (AsyncLocalStorage semantics).
 *   (b) an emitted audit event (DIS-024 `AuditLogger.write`) carries
 *       correlation_id equal to the bound id.
 *   (c) a recorded metrics sample (DIS-009 `inc()` / `snapshot()`)
 *       carries correlation_id as a label AND the logger (DIS-008)
 *       emits a structured log line that includes the correlation id.
 *
 * The orchestrator itself does not (yet) emit audit/metrics/log lines
 * per-ingest — those sinks are wired at the HTTP + router layer. For
 * the purpose of verifying the CORRELATION utility surface, this suite
 * composes the utilities directly inside the `withCorrelation` scope,
 * which is the contract callers of DIS-028 rely on.
 *
 * Out of scope: real HTTP round-trip (DIS-043 covers end-to-end error
 * envelope); ocr_audit_log DB triggers.
 *
 * @see backlog DIS-042
 * @see dis/src/core/correlation.ts (DIS-028)
 * @see dis/src/core/audit-log.ts (DIS-024)
 * @see dis/src/core/metrics.ts (DIS-009)
 * @see dis/src/core/logger.ts (DIS-008)
 */

import { Writable } from 'node:stream';
import { describe, it, expect } from 'vitest';

import {
  withCorrelation,
  currentCorrelationId,
} from '../../src/core/correlation.js';
import { AuditLogger, type AuditEvent } from '../../src/core/audit-log.js';
import { createMetrics } from '../../src/core/metrics.js';
import { createLogger } from '../../src/core/logger.js';
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

const FIXED_CORRELATION_ID = 'abc-123';

function buildDeps() {
  const db = new FakeDatabaseAdapter();
  const storage = new FakeStorageAdapter();
  const queue = new FakeQueueAdapter();
  const secrets = new FakeSecretsAdapter({});
  const router = new FakeFileRouterAdapter({
    'note.pdf': { success: { kind: 'native_text', pageCount: 1 } },
  });
  const preprocessor = new FakePreprocessorAdapter();
  const ocr = new FakeOcrAdapter({});
  const structuring = new FakeStructuringAdapter({
    generic: {
      success: {
        provider: 'claude-haiku',
        providerVersion: 'test',
        rawResponse: {},
        structured: { ok: true },
        tokensUsed: { input: 1, output: 1 },
        costMicroINR: 100,
        latencyMs: 1,
      },
    },
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
  return { orch, db };
}

/**
 * Test sink that captures log lines as raw strings for substring assertion.
 * The DIS-008 logger accepts a Writable as `destination`.
 */
class CaptureSink extends Writable {
  readonly lines: string[] = [];
  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    this.lines.push(chunk.toString('utf8'));
    cb();
  }
}

describe('correlation propagation integration (DIS-042)', () => {
  it('propagates a bound correlation id through ingest, audit, metrics, and logger within withCorrelation scope', async () => {
    const { orch, db } = buildDeps();
    const auditLogger = new AuditLogger(db);
    const metrics = createMetrics();
    const sink = new CaptureSink();
    const logger = createLogger({
      service: 'dis',
      version: 'test',
      level: 'info',
      destination: sink,
    });

    // Outside the scope there is no correlation.
    expect(currentCorrelationId()).toBeUndefined();

    await withCorrelation(FIXED_CORRELATION_ID, async () => {
      // (a) currentCorrelationId visible at call time.
      const observedAtCall = currentCorrelationId();
      expect(observedAtCall).toBe(FIXED_CORRELATION_ID);

      // Drive the orchestrator through ingest so the full async
      // continuation is exercised. Awaiting across boundaries is the
      // whole point of DIS-028.
      const record = await orch.ingest({
        patientId: 'pat-1',
        idempotencyKey: 'idem-correlation-1',
        filename: 'note.pdf',
        contentType: 'application/pdf',
        body: Buffer.from('x'),
      });

      // (a.2) After awaiting the orchestrator, correlation is still bound.
      expect(currentCorrelationId()).toBe(FIXED_CORRELATION_ID);

      // (b) Audit event tagged with correlation_id.
      const event: AuditEvent = {
        extractionId: record.id,
        eventType: 'state_transition',
        actorType: 'system',
        actorId: null,
        correlationId: currentCorrelationId() ?? 'MISSING',
        fromState: null,
        toState: 'uploaded',
      };
      await auditLogger.write(event);

      // (c) Metrics sample labelled with correlation_id.
      metrics.inc('dis_ingest_total', {
        correlation_id: currentCorrelationId() ?? 'MISSING',
        outcome: 'new',
      });

      // (c.2) Structured log line with correlation_id.
      logger.info({ correlation_id: currentCorrelationId() }, 'ingest ok');
    });

    // Scope exited — correlation cleared.
    expect(currentCorrelationId()).toBeUndefined();

    // Audit write went through DB.transaction + an ocr_audit_log insert
    // whose params include the correlation_id at the known position (11th,
    // last, per audit-log.ts INSERT_SQL).
    const auditInserts = db.calls.filter(
      (c) =>
        c.op === 'query' &&
        typeof (c.args as { sql: string }).sql === 'string' &&
        (c.args as { sql: string }).sql.includes('ocr_audit_log'),
    );
    expect(auditInserts.length).toBe(1);
    const auditParams = (auditInserts[0]?.args as { params: readonly unknown[] }).params;
    expect(auditParams[auditParams.length - 1]).toBe(FIXED_CORRELATION_ID);

    // Metrics snapshot contains the labelled sample.
    const snap = metrics.snapshot();
    const sample = snap.counters.find(
      (c) => c.name === 'dis_ingest_total' && c.labels?.correlation_id === FIXED_CORRELATION_ID,
    );
    expect(sample).toBeDefined();
    expect(sample?.value).toBe(1);

    // Logger emitted a JSON line containing the correlation id.
    const found = sink.lines.some((l) => l.includes(`"correlation_id":"${FIXED_CORRELATION_ID}"`));
    expect(found).toBe(true);
  });

  it('correlation id survives Promise.all fan-out (AsyncLocalStorage semantics)', async () => {
    // All three awaited branches see the SAME bound id, because ALS
    // contexts are inherited by child async frames. Regressions where
    // a naive global variable is used instead of ALS would fail here
    // once concurrent requests land in practice.
    const seen: Array<string | undefined> = [];
    await withCorrelation(FIXED_CORRELATION_ID, async () => {
      await Promise.all([
        (async () => {
          await Promise.resolve();
          seen.push(currentCorrelationId());
        })(),
        (async () => {
          await new Promise((r) => setImmediate(r));
          seen.push(currentCorrelationId());
        })(),
        (async () => {
          seen.push(currentCorrelationId());
        })(),
      ]);
    });
    expect(seen).toEqual([
      FIXED_CORRELATION_ID,
      FIXED_CORRELATION_ID,
      FIXED_CORRELATION_ID,
    ]);
  });

  it('nested withCorrelation scopes override and restore correctly', async () => {
    const outer = 'outer-correlation-id';
    const inner = 'inner-correlation-id';

    await withCorrelation(outer, async () => {
      expect(currentCorrelationId()).toBe(outer);
      await withCorrelation(inner, async () => {
        expect(currentCorrelationId()).toBe(inner);
      });
      // Restored on exit.
      expect(currentCorrelationId()).toBe(outer);
    });

    expect(currentCorrelationId()).toBeUndefined();
  });
});
