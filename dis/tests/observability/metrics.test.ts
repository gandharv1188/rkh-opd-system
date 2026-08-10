import { describe, it, expect } from 'vitest';
import { createMetrics } from '../../src/core/metrics.js';
import {
  METRICS,
  setGauge,
  incCounter,
  observeLatency,
  snapshotNamedMetrics,
} from '../../src/observability/metrics.js';

describe('observability metrics', () => {
  it('all 5 canonical metrics present in snapshot', () => {
    const m = createMetrics();
    setGauge(METRICS.QUEUE_DEPTH, 7, m);
    incCounter(METRICS.EXTRACTIONS_APPROVED_TOTAL, 1, m);
    incCounter(METRICS.EXTRACTIONS_REJECTED_TOTAL, 1, m);
    observeLatency(METRICS.OCR_LATENCY_MS_P95, 420, m);
    incCounter(METRICS.COST_MICRO_INR_TOTAL, 5000, m);

    const snap = snapshotNamedMetrics(m);
    expect(Object.keys(snap).sort()).toEqual([
      'cost_micro_inr_total',
      'extractions_approved_total',
      'extractions_rejected_total',
      'ocr_latency_ms_p95',
      'queue_depth',
    ]);
    expect(snap.queue_depth).toBe(7);
    expect(snap.extractions_approved_total).toBe(1);
    expect(snap.extractions_rejected_total).toBe(1);
    expect(snap.ocr_latency_ms_p95).toBe(420);
    expect(snap.cost_micro_inr_total).toBe(5000);
  });

  it('defaults missing series to 0', () => {
    const m = createMetrics();
    const snap = snapshotNamedMetrics(m);
    expect(snap.queue_depth).toBe(0);
    expect(snap.extractions_approved_total).toBe(0);
    expect(snap.ocr_latency_ms_p95).toBe(0);
  });

  it('setGauge replaces prior value; incCounter accumulates', () => {
    const m = createMetrics();
    setGauge(METRICS.QUEUE_DEPTH, 3, m);
    setGauge(METRICS.QUEUE_DEPTH, 9, m);
    incCounter(METRICS.EXTRACTIONS_APPROVED_TOTAL, 2, m);
    incCounter(METRICS.EXTRACTIONS_APPROVED_TOTAL, 3, m);

    const snap = snapshotNamedMetrics(m);
    expect(snap.queue_depth).toBe(9);
    expect(snap.extractions_approved_total).toBe(5);
  });
});
