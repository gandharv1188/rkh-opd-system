import { describe, it, expect } from 'vitest';
import { evaluateBudget, assertBudgetAvailable, BudgetExhaustedError } from '../../src/core/cost-guardrail.js';

describe('cost guardrail (CS-12)', () => {
  it('allows uploads under budget', () => {
    expect(() => assertBudgetAvailable(5_000_000, 10_000_000)).not.toThrow();
  });

  it('returns 503 when budget exceeded', () => {
    // "Returns 503" is semantic for this layer — the guardrail throws BudgetExhaustedError
    // which the HTTP layer maps to 503 via the DIS-101 error handler.
    expect(() => assertBudgetAvailable(15_000_000, 10_000_000)).toThrow(BudgetExhaustedError);
    const status = evaluateBudget(15_000_000, 10_000_000);
    expect(status.exhausted).toBe(true);
    expect(status.remainingMicroInr).toBe(0);
  });

  it('exact-budget case also blocks', () => {
    expect(() => assertBudgetAvailable(10_000_000, 10_000_000)).toThrow(BudgetExhaustedError);
  });
});
