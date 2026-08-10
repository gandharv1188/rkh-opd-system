/**
 * In-memory metrics port for the POC (TDD §14).
 *
 * Not Prometheus. Not OpenTelemetry. Intentionally the smallest thing that
 * lets the orchestrator record counts and the admin endpoint expose them as
 * JSON. Real exposition format + exporter land in DIS-148.
 */

export type MetricLabels = Readonly<Record<string, string>>;

export interface CounterSample {
  name: string;
  labels?: MetricLabels;
  value: number;
}

export interface MetricsSnapshot {
  counters: CounterSample[];
  /** Gauges reserved for future use; currently always empty. */
  gauges: CounterSample[];
}

export interface Metrics {
  /** Increment a counter by 1 (or `by` if provided). */
  inc(name: string, labels?: MetricLabels, by?: number): void;
  /** Returns a JSON-serialisable snapshot of all series. */
  snapshot(): MetricsSnapshot;
  /** Test helper — clears all state. */
  reset(): void;
}

function keyFor(name: string, labels?: MetricLabels): string {
  if (!labels) return name;
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
  return `${name}{${parts}}`;
}

export function createMetrics(): Metrics {
  const counters = new Map<string, { name: string; labels?: MetricLabels; value: number }>();

  return {
    inc(name, labels, by = 1) {
      const key = keyFor(name, labels);
      const row = counters.get(key);
      if (row) {
        row.value += by;
      } else {
        counters.set(key, { name, labels, value: by });
      }
    },
    snapshot() {
      return {
        counters: Array.from(counters.values()).map((c) => ({ ...c })),
        gauges: [],
      };
    },
    reset() {
      counters.clear();
    },
  };
}

let _default: Metrics | undefined;

/** Process-wide default metrics instance (shared across modules). */
export function getDefaultMetrics(): Metrics {
  if (!_default) _default = createMetrics();
  return _default;
}
