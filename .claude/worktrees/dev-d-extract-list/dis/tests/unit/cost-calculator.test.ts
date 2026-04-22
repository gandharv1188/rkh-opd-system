/**
 * Unit tests — Cost calculator (DIS-032).
 *
 * Pure function mapping (input_tokens, output_tokens, pages, provider) to a
 * `CostBreakdown` in micro-INR. Default rates come from env (DIS-010 loadEnv)
 * when no `rates` override is passed. Placeholder numerics are per ADR-007;
 * the real authoritative values land with DIS-149 (cost ledger writer).
 */

import { describe, it, expect } from 'vitest';
import {
  calculateCost,
  type RateTable,
  type CostBreakdown,
} from '../../src/core/cost-calculator.js';

const OVERRIDE: RateTable = {
  haiku: { inputPerToken: 100, outputPerToken: 500 },
  sonnet: { inputPerToken: 500, outputPerToken: 2500 },
  datalab: { perPage: 3000 },
  'datalab+haiku': {
    inputPerToken: 100,
    outputPerToken: 500,
    perPage: 3000,
  },
};

describe('calculateCost (DIS-032)', () => {
  it('calculates haiku cost: input + output only, no pages', () => {
    const r = calculateCost(
      { input_tokens: 10, output_tokens: 20, pages: 0, provider: 'haiku' },
      OVERRIDE,
    );
    expect(r.input_cost_micro_inr).toBe(10 * 100);
    expect(r.output_cost_micro_inr).toBe(20 * 500);
    expect(r.ocr_cost_micro_inr).toBe(0);
    expect(r.total_micro_inr).toBe(1000 + 10_000);
    expect(r.input_tokens).toBe(10);
    expect(r.output_tokens).toBe(20);
    expect(r.pages).toBe(0);
  });

  it('calculates sonnet cost: ~5x haiku per token', () => {
    const r = calculateCost(
      { input_tokens: 10, output_tokens: 20, pages: 0, provider: 'sonnet' },
      OVERRIDE,
    );
    expect(r.input_cost_micro_inr).toBe(10 * 500);
    expect(r.output_cost_micro_inr).toBe(20 * 2500);
    expect(r.total_micro_inr).toBe(5000 + 50_000);
  });

  it('calculates datalab cost: pages only, no tokens', () => {
    const r = calculateCost(
      { input_tokens: 0, output_tokens: 0, pages: 4, provider: 'datalab' },
      OVERRIDE,
    );
    expect(r.input_cost_micro_inr).toBe(0);
    expect(r.output_cost_micro_inr).toBe(0);
    expect(r.ocr_cost_micro_inr).toBe(4 * 3000);
    expect(r.total_micro_inr).toBe(12_000);
  });

  it('calculates datalab+haiku cost: pages + tokens combined', () => {
    const r = calculateCost(
      { input_tokens: 10, output_tokens: 20, pages: 4, provider: 'datalab+haiku' },
      OVERRIDE,
    );
    expect(r.input_cost_micro_inr).toBe(10 * 100);
    expect(r.output_cost_micro_inr).toBe(20 * 500);
    expect(r.ocr_cost_micro_inr).toBe(4 * 3000);
    expect(r.total_micro_inr).toBe(1000 + 10_000 + 12_000);
  });

  it('handles zero-input edge case (all zeros → zero cost)', () => {
    const r = calculateCost(
      { input_tokens: 0, output_tokens: 0, pages: 0, provider: 'haiku' },
      OVERRIDE,
    );
    expect(r.total_micro_inr).toBe(0);
    expect(r.input_cost_micro_inr).toBe(0);
    expect(r.output_cost_micro_inr).toBe(0);
    expect(r.ocr_cost_micro_inr).toBe(0);
  });

  it('falls back to default env-derived rates when no override passed', () => {
    // Default rates from ADR-007 placeholder: Haiku 83 / 416 micro-INR per token.
    const r: CostBreakdown = calculateCost({
      input_tokens: 1,
      output_tokens: 1,
      pages: 0,
      provider: 'haiku',
    });
    expect(r.input_cost_micro_inr).toBeGreaterThan(0);
    expect(r.output_cost_micro_inr).toBeGreaterThan(r.input_cost_micro_inr);
    // sum invariant still holds
    expect(r.total_micro_inr).toBe(
      r.input_cost_micro_inr + r.output_cost_micro_inr + r.ocr_cost_micro_inr,
    );
  });

  it('rate override supersedes env defaults', () => {
    const defaults = calculateCost({
      input_tokens: 100,
      output_tokens: 0,
      pages: 0,
      provider: 'haiku',
    });
    const overridden = calculateCost(
      { input_tokens: 100, output_tokens: 0, pages: 0, provider: 'haiku' },
      OVERRIDE,
    );
    expect(overridden.input_cost_micro_inr).toBe(100 * 100);
    expect(overridden.input_cost_micro_inr).not.toBe(defaults.input_cost_micro_inr);
  });
});
