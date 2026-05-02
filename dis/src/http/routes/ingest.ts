/**
 * POST /ingest — thin HTTP wrapper over `IngestionOrchestrator.ingest()`.
 *
 * Responsibilities kept narrow:
 *   - validate content-type against an allow-list (415 on miss)
 *   - require `X-Patient-Id` and `Idempotency-Key` headers (400 on miss)
 *   - enforce upload size ceiling (413 on breach)
 *   - pass through to the orchestrator; idempotency dedupe lives there
 *
 * Any thrown `HttpError` / `OrchestratorError` propagates to the DIS-101
 * global error handler — this route never constructs envelopes itself.
 *
 * @see TDD §3 (API), §5 (idempotency)
 * @see 04_api/error_model.md
 */

import type { Hono } from 'hono';
import type { IngestionOrchestrator } from '../../core/orchestrator.js';
import { HttpError } from '../middleware/error-envelope.js';

export interface IngestRouteDeps {
  readonly orchestrator: IngestionOrchestrator;
  /** Max upload size in bytes (default 20 MiB). */
  readonly maxBytes?: number;
  /** Allow-list of content-types. Default: PDF + common images + Office docs. */
  readonly allowedContentTypes?: ReadonlySet<string>;
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024; // 20 MiB
const DEFAULT_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);

/**
 * Registers `POST /ingest` on the provided Hono app.
 */
export function registerIngestRoute(app: Hono, deps: IngestRouteDeps): void {
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowedTypes = deps.allowedContentTypes ?? DEFAULT_CONTENT_TYPES;

  app.post('/ingest', async (c) => {
    const rawContentType = c.req.header('content-type') ?? '';
    const contentType = rawContentType.split(';')[0]?.trim() ?? '';
    if (!allowedTypes.has(contentType)) {
      throw new HttpError(
        415,
        'UNSUPPORTED_MEDIA',
        `Unsupported content-type: ${contentType || '(missing)'}`,
      );
    }

    const patientId = c.req.header('X-Patient-Id') ?? '';
    if (!patientId) {
      throw new HttpError(400, 'MISSING_PATIENT_ID', 'X-Patient-Id header is required');
    }

    const idempotencyKey = c.req.header('Idempotency-Key') ?? '';
    if (!idempotencyKey) {
      throw new HttpError(
        400,
        'MISSING_IDEMPOTENCY_KEY',
        'Idempotency-Key header is required',
      );
    }

    const filename = c.req.header('X-Filename') ?? 'upload.bin';

    const bodyArrayBuffer = await c.req.arrayBuffer();
    if (bodyArrayBuffer.byteLength > maxBytes) {
      throw new HttpError(
        413,
        'PAYLOAD_TOO_LARGE',
        `Upload exceeds ${maxBytes} bytes`,
      );
    }
    const body = Buffer.from(bodyArrayBuffer);

    const record = await deps.orchestrator.ingest({
      patientId,
      idempotencyKey,
      filename,
      contentType,
      body,
    });

    // Untyped Hono doesn't know about AppVariables — fetch via `never` cast
    // then coerce. error-handler middleware uses the same key.
    const correlation_id =
      (c.get('correlationId' as never) as string | undefined) ?? '';

    return c.json(
      {
        extraction_id: record.id,
        status: record.status,
        version: record.version,
        correlation_id,
      },
      201,
    );
  });
}
