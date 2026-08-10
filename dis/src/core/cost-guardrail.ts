export interface BudgetStatus {
  readonly dailyBudgetMicroInr: number;
  readonly consumedMicroInr: number;
  readonly remainingMicroInr: number;
  readonly exhausted: boolean;
}

export class BudgetExhaustedError extends Error {
  readonly code = 'BUDGET_EXHAUSTED';
  readonly retryable = true;
  constructor(readonly status: BudgetStatus) {
    super(`Daily cost budget exhausted: ${status.consumedMicroInr}/${status.dailyBudgetMicroInr} μINR`);
    this.name = 'BudgetExhaustedError';
  }
}

export function evaluateBudget(consumedMicroInr: number, dailyBudgetMicroInr: number): BudgetStatus {
  const remaining = Math.max(0, dailyBudgetMicroInr - consumedMicroInr);
  return {
    dailyBudgetMicroInr,
    consumedMicroInr,
    remainingMicroInr: remaining,
    exhausted: consumedMicroInr >= dailyBudgetMicroInr,
  };
}

/** Throws BudgetExhaustedError if the budget is spent. Callers translate to HTTP 503 at the boundary. */
export function assertBudgetAvailable(consumedMicroInr: number, dailyBudgetMicroInr: number): void {
  const status = evaluateBudget(consumedMicroInr, dailyBudgetMicroInr);
  if (status.exhausted) throw new BudgetExhaustedError(status);
}
