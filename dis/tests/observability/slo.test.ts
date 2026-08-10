import { describe, it, expect } from 'vitest';
import { computeSlo } from '../../src/observability/slo.js';

describe('operator SLO', () => {
  it('reports p50 and p95 correctly', () => {
    const latencies = Array.from({ length: 100 }, (_, i) => i * 1000);
    const r = computeSlo(latencies, { targetMsP95: 200_000 });
    expect(r.p50).toBe(50_000);
    expect(r.p95).toBe(95_000);
    expect(r.breach).toBe(false);
  });

  it('reports SLO breach when p95 > target', () => {
    const latencies = [10_000, 20_000, 30_000, 40_000, 150_000];
    const r = computeSlo(latencies, { targetMsP95: 60_000 });
    expect(r.breach).toBe(true);
  });

  it('returns zeros on empty input', () => {
    const r = computeSlo([], { targetMsP95: 60_000 });
    expect(r.p50).toBe(0);
    expect(r.p95).toBe(0);
    expect(r.breach).toBe(false);
  });

  it('warns within margin without breaching', () => {
    const latencies = [55_000];
    const r = computeSlo(latencies, { targetMsP95: 60_000, warnMarginMs: 10_000 });
    expect(r.breach).toBe(false);
    expect(r.warn).toBe(true);
  });
});
