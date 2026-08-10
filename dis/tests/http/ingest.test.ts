import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerIngestRoute } from '../../src/http/routes/ingest.js';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import { errorHandler } from '../../src/http/middleware/error-handler.js';
import type { AppVariables } from '../../src/http/server.js';
import type {
  IngestInput,
  ExtractionRecord,
  IngestionOrchestrator,
} from '../../src/core/orchestrator.js';
import { OrchestratorError } from '../../src/core/orchestrator.js';

interface SuccessBody {
  extraction_id: string;
  status: string;
  version: number;
  correlation_id: string;
}

interface EnvelopeBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    correlation_id: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Minimal fake orchestrator implementing only the `ingest()` surface used
 * by the route. Cast to IngestionOrchestrator via `unknown` — keeps the
 * fake free of unused port deps.
 */
class FakeOrchestrator {
  public calls: IngestInput[] = [];
  private result: ExtractionRecord | Error;

  constructor(result: ExtractionRecord | Error) {
    this.result = result;
  }

  async ingest(input: IngestInput): Promise<ExtractionRecord> {
    this.calls.push(input);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

function asOrchestrator(fake: FakeOrchestrator): IngestionOrchestrator {
  return fake as unknown as IngestionOrchestrator;
}

function makeApp(
  fake: FakeOrchestrator,
  opts?: { maxBytes?: number; allowedContentTypes?: ReadonlySet<string> },
): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  registerIngestRoute(app as unknown as Hono, {
    orchestrator: asOrchestrator(fake),
    maxBytes: opts?.maxBytes,
    allowedContentTypes: opts?.allowedContentTypes,
  });
  app.onError(errorHandler());
  return app;
}

const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake pdf body\n');

function record(overrides: Partial<ExtractionRecord> = {}): ExtractionRecord {
  return {
    id: 'ext-1',
    patientId: 'pat-1',
    status: 'uploaded',
    version: 1,
    parentExtractionId: null,
    ...overrides,
  };
}

describe('POST /ingest (DIS-090)', () => {
  it('returns 201 with extraction_id + correlation_id', async () => {
    const fake = new FakeOrchestrator(record({ id: 'ext-42', status: 'uploaded', version: 1 }));
    const app = makeApp(fake);

    const res = await app.request('/ingest', {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        'X-Patient-Id': 'pat-1',
        'Idempotency-Key': 'key-1',
        'X-Filename': 'report.pdf',
      },
      body: PDF_BYTES,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as SuccessBody;
    expect(body.extraction_id).toBe('ext-42');
    expect(body.status).toBe('uploaded');
    expect(body.version).toBe(1);
    expect(typeof body.correlation_id).toBe('string');
    expect(body.correlation_id.length).toBeGreaterThan(0);

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.patientId).toBe('pat-1');
    expect(call.idempotencyKey).toBe('key-1');
    expect(call.filename).toBe('report.pdf');
    expect(call.contentType).toBe('application/pdf');
    expect(Buffer.isBuffer(call.body)).toBe(true);
    expect(call.body.length).toBe(PDF_BYTES.length);
  });

  it('same Idempotency-Key returns same extraction_id', async () => {
    // Orchestrator-level dedupe is mocked: return the same record both times.
    const fake = new FakeOrchestrator(record({ id: 'ext-dedupe', version: 1 }));
    const app = makeApp(fake);

    const headers = {
      'content-type': 'application/pdf',
      'X-Patient-Id': 'pat-1',
      'Idempotency-Key': 'key-same',
      'X-Filename': 'a.pdf',
    };

    const res1 = await app.request('/ingest', { method: 'POST', headers, body: PDF_BYTES });
    const res2 = await app.request('/ingest', { method: 'POST', headers, body: PDF_BYTES });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const b1 = (await res1.json()) as SuccessBody;
    const b2 = (await res2.json()) as SuccessBody;
    expect(b1.extraction_id).toBe('ext-dedupe');
    expect(b2.extraction_id).toBe('ext-dedupe');
    expect(b1.extraction_id).toBe(b2.extraction_id);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]!.idempotencyKey).toBe('key-same');
    expect(fake.calls[1]!.idempotencyKey).toBe('key-same');
  });

  it('rejects unsupported content-type with 415', async () => {
    const fake = new FakeOrchestrator(record());
    const app = makeApp(fake);

    const res = await app.request('/ingest', {
      method: 'POST',
      headers: {
        'content-type': 'application/zip',
        'X-Patient-Id': 'pat-1',
        'Idempotency-Key': 'key-zip',
      },
      body: Buffer.from('PK\x03\x04fake zip'),
    });

    expect(res.status).toBe(415);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA');
    expect(body.error.retryable).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects file over DIS_MAX_UPLOAD_MB with 413', async () => {
    const fake = new FakeOrchestrator(record());
    const app = makeApp(fake, { maxBytes: 100 });

    const oversized = Buffer.alloc(200, 0x41);
    const res = await app.request('/ingest', {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        'X-Patient-Id': 'pat-1',
        'Idempotency-Key': 'key-big',
      },
      body: oversized,
    });

    expect(res.status).toBe(413);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.retryable).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it('missing X-Patient-Id returns 400 MISSING_PATIENT_ID', async () => {
    const fake = new FakeOrchestrator(record());
    const app = makeApp(fake);

    const res = await app.request('/ingest', {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        'Idempotency-Key': 'key-nopid',
      },
      body: PDF_BYTES,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('MISSING_PATIENT_ID');
    expect(fake.calls).toHaveLength(0);
  });

  it('missing Idempotency-Key returns 400 MISSING_IDEMPOTENCY_KEY', async () => {
    const fake = new FakeOrchestrator(record());
    const app = makeApp(fake);

    const res = await app.request('/ingest', {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        'X-Patient-Id': 'pat-1',
      },
      body: PDF_BYTES,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
    expect(fake.calls).toHaveLength(0);
  });

  it('orchestrator error propagates through onError envelope', async () => {
    const fake = new FakeOrchestrator(
      new OrchestratorError('IDEMPOTENCY_KEY_CONFLICT', 'key reused with different payload'),
    );
    const app = makeApp(fake);

    const res = await app.request('/ingest', {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        'X-Patient-Id': 'pat-1',
        'Idempotency-Key': 'key-conflict',
      },
      body: PDF_BYTES,
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(body.error.retryable).toBe(false);
    expect(typeof body.error.correlation_id).toBe('string');
    expect(body.error.correlation_id.length).toBeGreaterThan(0);
  });

  it('defaults filename to upload.bin when X-Filename header missing', async () => {
    const fake = new FakeOrchestrator(record({ id: 'ext-default-name' }));
    const app = makeApp(fake);

    const res = await app.request('/ingest', {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        'X-Patient-Id': 'pat-1',
        'Idempotency-Key': 'key-nf',
      },
      body: PDF_BYTES,
    });

    expect(res.status).toBe(201);
    expect(fake.calls[0]!.filename).toBe('upload.bin');
  });

  it('strips content-type parameters before allow-list lookup', async () => {
    const fake = new FakeOrchestrator(record({ id: 'ext-ct' }));
    const app = makeApp(fake);

    const res = await app.request('/ingest', {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf; charset=binary',
        'X-Patient-Id': 'pat-1',
        'Idempotency-Key': 'key-ct',
      },
      body: PDF_BYTES,
    });

    expect(res.status).toBe(201);
    expect(fake.calls[0]!.contentType).toBe('application/pdf');
  });
});
