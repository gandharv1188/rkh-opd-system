export interface SamplingContext {
  readonly outcome?: 'ok' | 'error';
  readonly isClinicalSafety?: boolean;
  /** 0..1 deterministic sample for tests. */
  readonly rng?: () => number;
}

export interface SamplingPolicy {
  readonly successRate: number;
}

export const DEFAULT_POLICY: SamplingPolicy = { successRate: 0.1 };

export function shouldSample(ctx: SamplingContext, policy: SamplingPolicy = DEFAULT_POLICY): boolean {
  if (ctx.outcome === 'error') return true;
  if (ctx.isClinicalSafety) return true;
  const rng = ctx.rng ?? Math.random;
  return rng() < policy.successRate;
}
