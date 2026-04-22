/**
 * SupabaseStorageAdapter — StoragePort implementation over Supabase Storage REST.
 *
 * Uses Node fetch against the REST surface (no @supabase/supabase-js) so the
 * adapter remains a thin, portable shim — easily swappable for S3 by replacing
 * just this file. Credentials come from a SecretsPort: `SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY`.
 *
 * @see portability.md §Storage portability
 * @see tdd.md §9 StoragePort
 */

import type { SecretsPort } from '../../ports/secrets.js';
import type {
  StoragePort,
  PutObjectInput,
  PutObjectResult,
  GetObjectResult,
  SignedUploadUrlInput,
  SignedUploadUrlResult,
  SignedDownloadUrlResult,
} from '../../ports/storage.js';

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`object not found: ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}

export class StorageProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageProviderError';
  }
}

export interface SupabaseStorageAdapterConfig {
  readonly secretsPort: SecretsPort;
  readonly bucket: string;
  readonly fetchImpl?: typeof fetch;
}

interface ResolvedCreds {
  readonly baseUrl: string;
  readonly token: string;
}

export class SupabaseStorageAdapter implements StoragePort {
  private readonly secretsPort: SecretsPort;
  private readonly bucket: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: SupabaseStorageAdapterConfig) {
    this.secretsPort = config.secretsPort;
    this.bucket = config.bucket;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const { baseUrl, token } = await this.resolveCreds();
    const url = `${baseUrl}/storage/v1/object/${this.bucket}/${encodeKey(input.key)}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'content-type': input.contentType,
      'x-upsert': 'true',
    };
    if (input.metadata) {
      for (const [k, v] of Object.entries(input.metadata)) {
        headers[`x-metadata-${k.toLowerCase()}`] = v;
      }
    }
    const body = new Uint8Array(
      input.body.buffer,
      input.body.byteOffset,
      input.body.byteLength,
    ) as unknown as BodyInit;
    const response = await this.fetchImpl(url, { method: 'POST', headers, body });
    await ensureOk(response, input.key);
    const etag = stripQuotes(response.headers.get('etag') ?? '');
    return { kind: 'put', etag };
  }

  async getObject(key: string): Promise<GetObjectResult> {
    const { baseUrl, token } = await this.resolveCreds();
    const url = `${baseUrl}/storage/v1/object/${this.bucket}/${encodeKey(key)}`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });
    await ensureOk(response, key);
    const body = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    return { kind: 'get', body, contentType };
  }

  async getSignedUploadUrl(input: SignedUploadUrlInput): Promise<SignedUploadUrlResult> {
    const { baseUrl, token } = await this.resolveCreds();
    const url = `${baseUrl}/storage/v1/object/upload/sign/${this.bucket}/${encodeKey(input.key)}`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        expiresIn: input.expiresSec,
        maxSizeBytes: input.maxSizeBytes,
        contentType: input.contentType,
      }),
    });
    await ensureOk(response, input.key);
    const json = (await response.json()) as { url?: string; signedURL?: string; token?: string };
    const raw = json.url ?? json.signedURL ?? '';
    const absolute = absolutize(raw, baseUrl);
    const fields = json.token ? { token: json.token } : undefined;
    return fields
      ? { kind: 'signed-upload', url: absolute, fields }
      : { kind: 'signed-upload', url: absolute };
  }

  async getSignedDownloadUrl(key: string, expiresSec: number): Promise<SignedDownloadUrlResult> {
    const { baseUrl, token } = await this.resolveCreds();
    const url = `${baseUrl}/storage/v1/object/sign/${this.bucket}/${encodeKey(key)}`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: expiresSec }),
    });
    await ensureOk(response, key);
    const json = (await response.json()) as { signedURL?: string; url?: string };
    const raw = json.signedURL ?? json.url ?? '';
    return { kind: 'signed-download', url: absolutize(raw, baseUrl) };
  }

  async deleteObject(key: string): Promise<void> {
    const { baseUrl, token } = await this.resolveCreds();
    const url = `${baseUrl}/storage/v1/object/${this.bucket}/${encodeKey(key)}`;
    const response = await this.fetchImpl(url, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    await ensureOk(response, key);
  }

  private async resolveCreds(): Promise<ResolvedCreds> {
    const [rawBase, token] = await Promise.all([
      this.secretsPort.get('SUPABASE_URL'),
      this.secretsPort.get('SUPABASE_SERVICE_ROLE_KEY'),
    ]);
    return { baseUrl: rawBase.replace(/\/+$/, ''), token };
  }
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function stripQuotes(s: string): string {
  return s.replace(/^"|"$/g, '');
}

function absolutize(raw: string, baseUrl: string): string {
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${baseUrl}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

async function ensureOk(response: Response, key: string): Promise<void> {
  if (response.ok) return;
  if (response.status === 404) {
    throw new ObjectNotFoundError(key);
  }
  const detail = await safeReadText(response);
  throw new StorageProviderError(
    `Supabase storage ${response.status}${detail ? `: ${detail}` : ''}`,
  );
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
