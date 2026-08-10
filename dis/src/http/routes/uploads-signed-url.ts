import type { Hono } from 'hono';
import type { StoragePort } from '../../ports/storage.js';
import type { AppVariables } from '../server.js';
import { HttpError } from '../middleware/error-envelope.js';

export interface SignedUrlRouteDeps {
  readonly storage: StoragePort;
}

const DEFAULT_TTL_SECONDS = 900;
const DEFAULT_MAX_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * Registers `POST /uploads/signed-url` — returns a signed upload URL plus
 * target key so clients can upload directly to object storage.
 *
 * DIS-096 / TDD §3, §9.3. StoragePort field names diverge from the ticket
 * brief: the port exposes `getSignedUploadUrl` with `{key, expiresSec,
 * maxSizeBytes, contentType}` and returns `{kind, url, fields?}`. Neither
 * `key` nor `expiresAt` is echoed back, so we compute `target_path` and
 * `expires_at` locally.
 */
export function registerUploadsSignedUrlRoute(
  app: Hono<{ Variables: AppVariables }>,
  deps: SignedUrlRouteDeps,
): void {
  app.post('/uploads/signed-url', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      patient_id?: string;
      filename?: string;
      content_type?: string;
      ttl_seconds?: number;
      max_size_bytes?: number;
    } | null;

    if (!body || !body.patient_id || !body.filename || !body.content_type) {
      throw new HttpError(
        400,
        'MISSING_FIELDS',
        'patient_id, filename, content_type required',
      );
    }

    const ttlSeconds = body.ttl_seconds ?? DEFAULT_TTL_SECONDS;
    const key = `uploads/${body.patient_id}/${Date.now()}-${body.filename}`;

    const result = await deps.storage.getSignedUploadUrl({
      key,
      contentType: body.content_type,
      expiresSec: ttlSeconds,
      maxSizeBytes: body.max_size_bytes ?? DEFAULT_MAX_SIZE_BYTES,
    });

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    return c.json(
      {
        upload_url: result.url,
        target_path: key,
        expires_at: expiresAt,
        correlation_id: c.get('correlationId') ?? '',
      },
      201,
    );
  });
}
