import { describe, it, expect } from 'vitest';
import {
  SupabaseStorageAdapter,
  ObjectNotFoundError,
  StorageProviderError,
} from '../../../src/adapters/storage/supabase-storage.js';
import {
  FakeSecrets,
  createFetchMock,
  type ScriptedResponse,
} from '../../../src/adapters/storage/__fakes__/supabase-storage.js';

const URL_BASE = 'https://project.supabase.co';
const KEY = 'service-role-key-xxx';
const BUCKET = 'documents';

function secrets(): FakeSecrets {
  return new FakeSecrets({
    SUPABASE_URL: URL_BASE,
    SUPABASE_SERVICE_ROLE_KEY: KEY,
  });
}

function script(entries: [string, ScriptedResponse][]): Map<string, ScriptedResponse> {
  return new Map(entries);
}

describe('SupabaseStorageAdapter', () => {
  it('putObject POSTs to /storage/v1/object/{bucket}/{key} and returns etag', async () => {
    const { fetchImpl, calls } = createFetchMock(
      script([
        [
          `POST ${URL_BASE}/storage/v1/object/${BUCKET}/path/to/doc.pdf`,
          {
            status: 200,
            body: JSON.stringify({ Key: 'documents/path/to/doc.pdf' }),
            headers: { etag: '"abc123"' },
          },
        ],
      ]),
    );
    const adapter = new SupabaseStorageAdapter({
      secretsPort: secrets(),
      bucket: BUCKET,
      fetchImpl,
    });
    const result = await adapter.putObject({
      key: 'path/to/doc.pdf',
      body: Buffer.from('hello'),
      contentType: 'application/pdf',
    });
    expect(result).toEqual({ kind: 'put', etag: 'abc123' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.headers['content-type']).toBe('application/pdf');
    expect(calls[0]!.body).toEqual(Buffer.from('hello'));
  });

  it('getObject GETs and returns body + contentType', async () => {
    const { fetchImpl } = createFetchMock(
      script([
        [
          `GET ${URL_BASE}/storage/v1/object/${BUCKET}/a/b.txt`,
          { status: 200, body: Buffer.from('payload'), headers: { 'content-type': 'text/plain' } },
        ],
      ]),
    );
    const adapter = new SupabaseStorageAdapter({
      secretsPort: secrets(),
      bucket: BUCKET,
      fetchImpl,
    });
    const result = await adapter.getObject('a/b.txt');
    expect(result.kind).toBe('get');
    expect(result.body).toEqual(Buffer.from('payload'));
    expect(result.contentType).toBe('text/plain');
  });

  it('getObject throws ObjectNotFoundError on 404', async () => {
    const { fetchImpl } = createFetchMock(
      script([
        [
          `GET ${URL_BASE}/storage/v1/object/${BUCKET}/missing.txt`,
          { status: 404, body: 'not found' },
        ],
      ]),
    );
    const adapter = new SupabaseStorageAdapter({
      secretsPort: secrets(),
      bucket: BUCKET,
      fetchImpl,
    });
    await expect(adapter.getObject('missing.txt')).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('getObject throws StorageProviderError on 5xx', async () => {
    const { fetchImpl } = createFetchMock(
      script([
        [
          `GET ${URL_BASE}/storage/v1/object/${BUCKET}/boom.txt`,
          { status: 503, body: 'unavailable' },
        ],
      ]),
    );
    const adapter = new SupabaseStorageAdapter({
      secretsPort: secrets(),
      bucket: BUCKET,
      fetchImpl,
    });
    await expect(adapter.getObject('boom.txt')).rejects.toBeInstanceOf(StorageProviderError);
  });

  it('getSignedUploadUrl POSTs to /storage/v1/object/upload/sign/{bucket}/{key}', async () => {
    const { fetchImpl, calls } = createFetchMock(
      script([
        [
          `POST ${URL_BASE}/storage/v1/object/upload/sign/${BUCKET}/incoming/f.pdf`,
          {
            status: 200,
            body: JSON.stringify({ url: '/storage/v1/upload/sign?token=t', token: 't' }),
            headers: { 'content-type': 'application/json' },
          },
        ],
      ]),
    );
    const adapter = new SupabaseStorageAdapter({
      secretsPort: secrets(),
      bucket: BUCKET,
      fetchImpl,
    });
    const result = await adapter.getSignedUploadUrl({
      key: 'incoming/f.pdf',
      expiresSec: 300,
      maxSizeBytes: 10_000_000,
      contentType: 'application/pdf',
    });
    expect(result.kind).toBe('signed-upload');
    expect(result.url).toContain('token=t');
    expect(calls[0]!.headers['authorization']).toBe(`Bearer ${KEY}`);
  });

  it('getSignedDownloadUrl POSTs to /storage/v1/object/sign/{bucket}/{key} and returns url', async () => {
    const { fetchImpl } = createFetchMock(
      script([
        [
          `POST ${URL_BASE}/storage/v1/object/sign/${BUCKET}/path/report.pdf`,
          {
            status: 200,
            body: JSON.stringify({ signedURL: '/object/sign/documents/path/report.pdf?token=xyz' }),
            headers: { 'content-type': 'application/json' },
          },
        ],
      ]),
    );
    const adapter = new SupabaseStorageAdapter({
      secretsPort: secrets(),
      bucket: BUCKET,
      fetchImpl,
    });
    const result = await adapter.getSignedDownloadUrl('path/report.pdf', 600);
    expect(result.kind).toBe('signed-download');
    expect(result.url).toContain('token=xyz');
  });

  it('deleteObject DELETEs the object', async () => {
    const { fetchImpl, calls } = createFetchMock(
      script([
        [`DELETE ${URL_BASE}/storage/v1/object/${BUCKET}/gone.txt`, { status: 200, body: '{}' }],
      ]),
    );
    const adapter = new SupabaseStorageAdapter({
      secretsPort: secrets(),
      bucket: BUCKET,
      fetchImpl,
    });
    await adapter.deleteObject('gone.txt');
    expect(calls[0]!.method).toBe('DELETE');
  });

  it('URL-encodes keys with slashes preserved and spaces encoded', async () => {
    const encodedKey = 'folder/my%20file.pdf';
    const { fetchImpl, calls } = createFetchMock(
      script([
        [
          `GET ${URL_BASE}/storage/v1/object/${BUCKET}/${encodedKey}`,
          { status: 200, body: Buffer.from('x'), headers: { 'content-type': 'application/pdf' } },
        ],
      ]),
    );
    const adapter = new SupabaseStorageAdapter({
      secretsPort: secrets(),
      bucket: BUCKET,
      fetchImpl,
    });
    await adapter.getObject('folder/my file.pdf');
    expect(calls[0]!.url).toContain('folder/my%20file.pdf');
  });

  it('reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from SecretsPort', async () => {
    const secretsPort = new FakeSecrets({
      SUPABASE_URL: 'https://custom.example.com',
      SUPABASE_SERVICE_ROLE_KEY: 'custom-key',
    });
    const { fetchImpl, calls } = createFetchMock(
      script([
        [
          `DELETE https://custom.example.com/storage/v1/object/${BUCKET}/k.txt`,
          { status: 200, body: '{}' },
        ],
      ]),
    );
    const adapter = new SupabaseStorageAdapter({ secretsPort, bucket: BUCKET, fetchImpl });
    await adapter.deleteObject('k.txt');
    expect(calls[0]!.headers['authorization']).toBe('Bearer custom-key');
  });
});
