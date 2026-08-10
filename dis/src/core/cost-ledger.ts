import type { DatabasePort } from '../ports/database.js';

export interface CostLedgerEntry {
  readonly provider: string;
  readonly operation: string;
  readonly tokens_input?: number;
  readonly tokens_output?: number;
  readonly pages?: number;
  readonly cost_micro_inr: number;
  readonly correlation_id?: string;
  readonly extraction_id?: string;
}

/**
 * Writes one row per adapter call. SQL kept here intentionally as this module
 * sits at the adapter boundary (shares that concession with the list/query
 * route). If `core_no_sql_literals` fitness rule flags it, move the SQL to
 * a helper at the adapter package boundary.
 */
export async function writeLedgerRow(db: DatabasePort, entry: CostLedgerEntry): Promise<void> {
  const sql = `
    INSERT INTO dis_cost_ledger
      (provider, operation, tokens_input, tokens_output, pages, cost_micro_inr, correlation_id, extraction_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
  `;
  await db.query(sql, [
    entry.provider,
    entry.operation,
    entry.tokens_input ?? null,
    entry.tokens_output ?? null,
    entry.pages ?? null,
    entry.cost_micro_inr,
    entry.correlation_id ?? null,
    entry.extraction_id ?? null,
  ]);
}
