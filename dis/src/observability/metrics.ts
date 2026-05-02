/**
 * Named observability metrics (TDD §14).
 *
 * Thin typed facade over the in-memory `Metrics` port in `../core/metrics.ts`.
 * Exposes the 5 canonical series the /admin/metrics endpoint publishes.
 *
 * The underlying port only supports counters. Gauges and latency observations
 * are tracked in a side-table keyed by metric name, so repeated `setGauge`
 * calls replace the prior value and `observeLatency` retains the last sample
 * (P95 aggregation lives upstream — we simply record whatever value the caller
 * computes). Both are merged into `snapshotNamedMetrics` alongside counters.
 */

import { getDefaultMetrics, type Metrics } from '../core/metrics.js';

export const METRICS = {
  QUEUE_DEPTH: 'queue_depth',
  EXTRACTIONS_APPROVED_TOTAL: 'extractions_approved_total',
  EXTRACTIONS_REJECTED_TOTAL: 'extractions_rejected_total',
  OCR_LATENCY_MS_P95: 'ocr_latency_ms_p95',
  COST_MICRO_INR_TOTAL: 'cost_micro_inr_total',
} as const;

export type MetricName = (typeof METRICS)[keyof typeof METRICS];

const gauges = new WeakMap<Metrics, Map<string, number>>();
const latencies = new WeakMap<Metrics, Map<string, number>>();

function gaugeStore(m: Metrics): Map<string, number> {
  let s = gauges.get(m);
  if (!s) {
    s = new Map();
    gauges.set(m, s);
  }
  return s;
}

function latencyStore(m: Metrics): Map<string, number> {
  let s = latencies.get(m);
  if (!s) {
    s = new Map();
    latencies.set(m, s);
  }
  return s;
}

export function setGauge(
  name: MetricName,
  value: number,
  m: Metrics = getDefaultMetrics(),
): void {
  gaugeStore(m).set(name, value);
}

export function incCounter(
  name: MetricName,
  delta = 1,
  m: Metrics = getDefaultMetrics(),
): void {
  m.inc(name, undefined, delta);
}

export function observeLatency(
  name: MetricName,
  ms: number,
  m: Metrics = getDefaultMetrics(),
): void {
  latencyStore(m).set(name, ms);
}

function sumCounter(m: Metrics, name: string): number {
  let total = 0;
  for (const c of m.snapshot().counters) {
    if (c.name === name) total += c.value;
  }
  return total;
}

export function snapshotNamedMetrics(
  m: Metrics = getDefaultMetrics(),
): Record<MetricName, number> {
  const g = gaugeStore(m);
  const l = latencyStore(m);
  return {
    [METRICS.QUEUE_DEPTH]: g.get(METRICS.QUEUE_DEPTH) ?? 0,
    [METRICS.EXTRACTIONS_APPROVED_TOTAL]: sumCounter(m, METRICS.EXTRACTIONS_APPROVED_TOTAL),
    [METRICS.EXTRACTIONS_REJECTED_TOTAL]: sumCounter(m, METRICS.EXTRACTIONS_REJECTED_TOTAL),
    [METRICS.OCR_LATENCY_MS_P95]: l.get(METRICS.OCR_LATENCY_MS_P95) ?? 0,
    [METRICS.COST_MICRO_INR_TOTAL]: sumCounter(m, METRICS.COST_MICRO_INR_TOTAL),
  };
}
