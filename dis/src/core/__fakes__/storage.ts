import type {
  StoragePort,
  PutObjectInput,
  PutObjectResult,
  GetObjectResult,
  SignedUploadUrlInput,
  SignedUploadUrlResult,
  SignedDownloadUrlResult,
} from '../../ports/storage.js';

export class FakeStorage implements StoragePort {
  readonly objects = new Map<string, GetObjectResult>();

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    this.objects.set(input.key, {
      kind: 'get',
      body: input.body,
      contentType: input.contentType,
      metadata: input.metadata,
    });
    return { kind: 'put', etag: `etag-${input.key}` };
  }

  async getObject(key: string): Promise<GetObjectResult> {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`not found: ${key}`);
    return obj;
  }

  async getSignedUploadUrl(input: SignedUploadUrlInput): Promise<SignedUploadUrlResult> {
    return { kind: 'signed-upload', url: `https://fake/${input.key}` };
  }

  async getSignedDownloadUrl(key: string, _expiresSec: number): Promise<SignedDownloadUrlResult> {
    return { kind: 'signed-download', url: `https://fake/${key}` };
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
