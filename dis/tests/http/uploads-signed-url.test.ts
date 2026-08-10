import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerUploadsSignedUrlRoute } from '../../src/http/routes/uploads-signed-url.js';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import { errorHandler } from '../../src/http/middleware/error-handler.js';
import type { AppVariables } from '../../src/http/server.js';
import type {
  SignedUploadUrlInput,
  SignedUploadUrlResult,
  StoragePort,
} from '../../src/ports/storage.js';

class FakeStorage {
  public calls: SignedUploadUrlInput[] = [];
  constructor(
    private readonly result: SignedUploadUrlResult = {
      kind: 'signed-upload',
      url: 'https://storage.example.test/signed?token=abc',
    },
  ) {}
  async getSignedUploadUrl(
    input: SignedUploadUrlInput,
  ): Promise<SignedUploadUrlResult> {
    this.calls.push(input);
    return this.result;
  }
  async putObject(): Promise<never> { throw new Error('unused'); }
  async getObject(): Promise<never> { throw new Error('unused'); }
  async getSignedDownloadUrl(): Promise<never> { throw new Error('unused'); }
  async deleteObject(): Promise<never> { throw new Error('unused'); }
}

function asStorage(f: FakeStorage): StoragePort {
  return f as unknown as StoragePort;
}

function makeApp(fake: FakeStorage) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  app.onError(errorHandler());
  registerUploadsSignedUrlRoute(app, { storage: asStorage(fake) });
  return app;
}

interface SuccessBody {
  upload_url: string;
  target_path: string;
  expires_at: string;
  correlation_id: string;
}

interface EnvelopeBody {
  error: { code: string; message: string; retryable: boolean; correlation_id: string };
}

describe('POST /uploads/signed-url (DIS-096)', () => {
  it('happy path returns 201 with upload_url, target_path, expires_at, correlation_id', async () => {
    const fake = new FakeStorage();
    const app = makeApp(fake);

    const res = await app.request('/uploads/signed-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patient_id: 'p-1',
        filename: 'lab.pdf',
        content_type: 'application/pdf',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as SuccessBody;
    expect(body.upload_url).toBe('https://storage.example.test/signed?token=abc');
    expect(body.target_path).toMatch(/^uploads\/p-1\/\d+-lab\.pdf$/);
    expect(typeof body.expires_at).toBe('string');
    expect(Number.isNaN(Date.parse(body.expires_at))).toBe(false);
    expect(typeof body.correlation_id).toBe('string');
    expect(body.correlation_id.length).toBeGreaterThan(0);
  });

  it('URL expires at configured TTL', async () => {
    const fake = new FakeStorage();
    const app = makeApp(fake);

    const res = await app.request('/uploads/signed-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patient_id: 'p-1',
        filename: 'scan.jpg',
        content_type: 'image/jpeg',
        ttl_seconds: 1800,
      }),
    });

    expect(res.status).toBe(201);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.expiresSec).toBe(1800);
  });

  it('missing fields returns 400', async () => {
    const fake = new FakeStorage();
    const app = makeApp(fake);

    const res = await app.request('/uploads/signed-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patient_id: 'p-1' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody;
    expect(body.error.code).toBe('MISSING_FIELDS');
    expect(fake.calls).toHaveLength(0);
  });

  it('default TTL when ttl_seconds omitted', async () => {
    const fake = new FakeStorage();
    const app = makeApp(fake);

    const res = await app.request('/uploads/signed-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patient_id: 'p-2',
        filename: 'note.txt',
        content_type: 'text/plain',
      }),
    });

    expect(res.status).toBe(201);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.expiresSec).toBe(900);
  });
});
