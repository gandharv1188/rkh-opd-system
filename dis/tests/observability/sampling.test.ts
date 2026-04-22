import { describe, it, expect } from 'vitest';
import { shouldSample, DEFAULT_POLICY } from '../../src/observability/sampling.js';

describe('trace sampling policy', () => {
  it('always samples errors', () => {
    expect(shouldSample({ outcome: 'error', rng: () => 0.999 })).toBe(true);
  });

  it('always samples clinical-safety flows', () => {
    expect(shouldSample({ isClinicalSafety: true, rng: () => 0.999 })).toBe(true);
  });

  it('samples 10% of successes by default', () => {
    expect(shouldSample({ outcome: 'ok', rng: () => 0.05 })).toBe(true);
    expect(shouldSample({ outcome: 'ok', rng: () => 0.15 })).toBe(false);
  });

  it('respects custom success rate', () => {
    expect(shouldSample({ outcome: 'ok', rng: () => 0.15 }, { successRate: 0.5 })).toBe(true);
    expect(shouldSample({ outcome: 'ok', rng: () => 0.75 }, { successRate: 0.5 })).toBe(false);
  });
});

void DEFAULT_POLICY;
