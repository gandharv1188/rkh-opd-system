import { describe, expect, it } from 'vitest';
import {
  newCorrelationId,
  withCorrelation,
  currentCorrelationId,
} from '../../src/core/correlation.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('correlation', () => {
  describe('newCorrelationId', () => {
    it('returns a well-formed UUID', () => {
      const id = newCorrelationId();
      expect(id).toMatch(UUID_RE);
    });

    it('produces distinct IDs on repeated calls', () => {
      const a = newCorrelationId();
      const b = newCorrelationId();
      const c = newCorrelationId();
      expect(new Set([a, b, c]).size).toBe(3);
    });
  });

  describe('currentCorrelationId', () => {
    it('returns undefined outside any withCorrelation scope', () => {
      expect(currentCorrelationId()).toBeUndefined();
    });
  });

  describe('withCorrelation', () => {
    it('establishes a scope readable by currentCorrelationId', () => {
      const id = newCorrelationId();
      const observed = withCorrelation(id, () => currentCorrelationId());
      expect(observed).toBe(id);
    });

    it('restores the outer value after the scope exits', () => {
      const outer = newCorrelationId();
      withCorrelation(outer, () => {
        expect(currentCorrelationId()).toBe(outer);
      });
      expect(currentCorrelationId()).toBeUndefined();
    });

    it('nested scopes override then restore correctly', () => {
      const outer = newCorrelationId();
      const inner = newCorrelationId();
      withCorrelation(outer, () => {
        expect(currentCorrelationId()).toBe(outer);
        withCorrelation(inner, () => {
          expect(currentCorrelationId()).toBe(inner);
        });
        expect(currentCorrelationId()).toBe(outer);
      });
      expect(currentCorrelationId()).toBeUndefined();
    });

    it('propagates across awaited async boundaries', async () => {
      const id = newCorrelationId();
      const observed = await withCorrelation(id, async () => {
        await Promise.resolve();
        return currentCorrelationId();
      });
      expect(observed).toBe(id);
    });

    it('passes through the return value of the callback', () => {
      const result = withCorrelation(newCorrelationId(), () => 42);
      expect(result).toBe(42);
    });
  });
});
