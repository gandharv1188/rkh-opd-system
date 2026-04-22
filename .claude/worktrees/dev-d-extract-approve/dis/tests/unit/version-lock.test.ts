import { describe, it, expect } from 'vitest';
import { compareAndSet, bumpVersion } from '../../src/core/version-lock.js';
import { VersionConflictError } from '../../src/core/errors.js';

describe('version-lock (DIS-026)', () => {
  describe('compareAndSet', () => {
    it('returns true when currentVersion === expectedVersion', () => {
      expect(compareAndSet(1, 1)).toBe(true);
      expect(compareAndSet(42, 42)).toBe(true);
    });

    it('returns false on version conflict', () => {
      expect(compareAndSet(2, 1)).toBe(false);
      expect(compareAndSet(1, 2)).toBe(false);
    });
  });

  describe('bumpVersion', () => {
    it('returns v + 1 on monotonic input', () => {
      expect(bumpVersion(1)).toBe(2);
      expect(bumpVersion(41)).toBe(42);
    });

    it('throws RangeError for versions below 1 (non-monotonic origin)', () => {
      expect(() => bumpVersion(0)).toThrow(RangeError);
      expect(() => bumpVersion(-1)).toThrow(RangeError);
    });

    it('throws RangeError at MAX_SAFE_INTEGER boundary', () => {
      expect(() => bumpVersion(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
      expect(() => bumpVersion(Number.MAX_SAFE_INTEGER + 10)).toThrow(RangeError);
    });

    it('rejects non-integer input', () => {
      expect(() => bumpVersion(1.5)).toThrow(RangeError);
      expect(() => bumpVersion(Number.NaN)).toThrow(RangeError);
    });
  });

  describe('VersionConflictError', () => {
    it('is a throwable Error carrying expected/actual', () => {
      const err = new VersionConflictError('extraction', 'ext-1', 2, 3);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('VersionConflictError');
      expect(err.resource).toBe('extraction');
      expect(err.resourceId).toBe('ext-1');
      expect(err.expectedVersion).toBe(2);
      expect(err.actualVersion).toBe(3);
    });
  });
});
