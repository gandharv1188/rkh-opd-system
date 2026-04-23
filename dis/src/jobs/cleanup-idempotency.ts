import type { DatabasePort } from '../ports/database.js';

export interface CleanupOptions {
  readonly maxAgeMs?: number;
  readonly now?: () => number;
  readonly logger?: { info: (obj: object, msg?: string) => void };
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface CleanupResult {
  readonly deleted: number;
  readonly thresholdIso: string;
}

export async function cleanupExpiredIdempotencyKeys(
  db: DatabasePort,
  opts: CleanupOptions = {},
): Promise<CleanupResult> {
  const maxAgeMs = opts.maxAgeMs ?? SEVEN_DAYS_MS;
  const now = (opts.now ?? Date.now)();
  const thresholdIso = new Date(now - maxAgeMs).toISOString();

  const result = await db.query<{ count: string }>(
    'DELETE FROM idempotency_keys WHERE created_at < $1 RETURNING 1',
    [thresholdIso],
  );
  const deleted = result.length;
  opts.logger?.info({ deleted, thresholdIso }, 'idempotency-cleanup');
  return { deleted, thresholdIso };
}
