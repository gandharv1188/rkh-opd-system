/**
 * Cost calculator (DIS-032).
 *
 * Pure function mapping OCR page count + LLM token counts to a
 * `CostBreakdown` in micro-INR. Consumed by the cost ledger writer
 * (DIS-149) — we only compute, we do not persist.
 *
 * Rates: default values are the ADR-007 placeholders. The authoritative
 * per-token / per-page rates are finalised as part of DIS-149; this module
 * stays placeholder-tolerant so the orchestrator can wire costs now. Callers
 * MAY pass an explicit `rates` table to override — used by tests and by
 * future env-driven configuration.
 *
 * Rates may also be supplied via environment variables:
 *   DIS_RATE_HAIKU_INPUT_MICRO_INR / DIS_RATE_HAIKU_OUTPUT_MICRO_INR
 *   DIS_RATE_SONNET_INPUT_MICRO_INR / DIS_RATE_SONNET_OUTPUT_MICRO_INR
 *   DIS_RATE_DATALAB_PAGE_MICRO_INR
 * Missing vars fall back to the ADR-007 placeholder constants below.
 *
 * @see TDD §14 (cost/observability)
 * @see ADR-007 (cost model)
 * @see DIS-149 (cost ledger writer)
 */

export type Provider = 'haiku' | 'sonnet' | 'datalab' | 'datalab+haiku';

export interface TokenRate {
  readonly inputPerToken: number;
  readonly outputPerToken: number;
}
export interface PageRate {
  readonly perPage: number;
}
export interface HybridRate extends TokenRate, PageRate {}

export interface RateTable {
  readonly haiku: TokenRate;
  readonly sonnet: TokenRate;
  readonly datalab: PageRate;
  readonly 'datalab+haiku': HybridRate;
}

export interface UsageInput {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly pages: number;
  readonly provider: Provider;
}

export interface CostBreakdown {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly pages: number;
  readonly input_cost_micro_inr: number;
  readonly output_cost_micro_inr: number;
  readonly ocr_cost_micro_inr: number;
  readonly total_micro_inr: number;
}

// ADR-007 placeholder rates (micro-INR). Overridable via env or `rates` param.
const PLACEHOLDER = {
  HAIKU_INPUT: 83,
  HAIKU_OUTPUT: 416,
  SONNET_INPUT: 415,
  SONNET_OUTPUT: 2080,
  DATALAB_PAGE: 3000,
} as const;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function defaultRates(): RateTable {
  const haikuIn = envNumber('DIS_RATE_HAIKU_INPUT_MICRO_INR', PLACEHOLDER.HAIKU_INPUT);
  const haikuOut = envNumber('DIS_RATE_HAIKU_OUTPUT_MICRO_INR', PLACEHOLDER.HAIKU_OUTPUT);
  const sonnetIn = envNumber('DIS_RATE_SONNET_INPUT_MICRO_INR', PLACEHOLDER.SONNET_INPUT);
  const sonnetOut = envNumber('DIS_RATE_SONNET_OUTPUT_MICRO_INR', PLACEHOLDER.SONNET_OUTPUT);
  const datalabPage = envNumber('DIS_RATE_DATALAB_PAGE_MICRO_INR', PLACEHOLDER.DATALAB_PAGE);
  return {
    haiku: { inputPerToken: haikuIn, outputPerToken: haikuOut },
    sonnet: { inputPerToken: sonnetIn, outputPerToken: sonnetOut },
    datalab: { perPage: datalabPage },
    'datalab+haiku': {
      inputPerToken: haikuIn,
      outputPerToken: haikuOut,
      perPage: datalabPage,
    },
  };
}

export function calculateCost(usage: UsageInput, rates?: RateTable): CostBreakdown {
  const table = rates ?? defaultRates();

  let input_cost_micro_inr = 0;
  let output_cost_micro_inr = 0;
  let ocr_cost_micro_inr = 0;

  switch (usage.provider) {
    case 'haiku':
    case 'sonnet': {
      const r = table[usage.provider];
      input_cost_micro_inr = usage.input_tokens * r.inputPerToken;
      output_cost_micro_inr = usage.output_tokens * r.outputPerToken;
      break;
    }
    case 'datalab': {
      ocr_cost_micro_inr = usage.pages * table.datalab.perPage;
      break;
    }
    case 'datalab+haiku': {
      const r = table['datalab+haiku'];
      input_cost_micro_inr = usage.input_tokens * r.inputPerToken;
      output_cost_micro_inr = usage.output_tokens * r.outputPerToken;
      ocr_cost_micro_inr = usage.pages * r.perPage;
      break;
    }
  }

  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    pages: usage.pages,
    input_cost_micro_inr,
    output_cost_micro_inr,
    ocr_cost_micro_inr,
    total_micro_inr: input_cost_micro_inr + output_cost_micro_inr + ocr_cost_micro_inr,
  };
}
