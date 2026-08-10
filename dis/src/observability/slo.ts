export interface SloConfig {
  readonly targetMsP95: number;
  readonly warnMarginMs?: number;
}

export interface SloReport {
  readonly observationCount: number;
  readonly p50: number;
  readonly p95: number;
  readonly breach: boolean;
  readonly warn: boolean;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

export function computeSlo(latencies: readonly number[], config: SloConfig): SloReport {
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const breach = p95 > config.targetMsP95;
  const warn = !breach && config.warnMarginMs !== undefined && p95 > config.targetMsP95 - config.warnMarginMs;
  return { observationCount: sorted.length, p50, p95, breach, warn };
}
