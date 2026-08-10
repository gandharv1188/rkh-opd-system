import { VersionConflictError } from './errors.js';

export function compareAndSet(currentVersion: number, expectedVersion: number): boolean {
  return currentVersion === expectedVersion;
}

export function bumpVersion(v: number): number {
  if (!Number.isInteger(v) || v < 1) {
    throw new RangeError(`bumpVersion: expected integer ≥ 1, got ${v}`);
  }
  if (v >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`bumpVersion: cannot exceed MAX_SAFE_INTEGER (got ${v})`);
  }
  return v + 1;
}

export { VersionConflictError };
