import { createHash } from 'node:crypto';

export function sha256(bytes: Buffer | Uint8Array | string): string {
  const hash = createHash('sha256');
  if (typeof bytes === 'string') {
    hash.update(bytes, 'utf8');
  } else {
    hash.update(bytes);
  }
  return hash.digest('hex');
}
