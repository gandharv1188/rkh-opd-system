import { createHash } from 'node:crypto';

export interface AuditRow {
  readonly id: string;
  readonly timestamp: string;
  readonly actor: string;
  readonly event: string;
  readonly payload: Record<string, unknown>;
}

function canon(row: AuditRow): string {
  return JSON.stringify({
    id: row.id,
    timestamp: row.timestamp,
    actor: row.actor,
    event: row.event,
    payload: row.payload,
  });
}

export function computeRowHash(prev: string, row: AuditRow): string {
  return createHash('sha256').update(prev).update('|').update(canon(row)).digest('hex');
}

export function computeChainHash(rows: readonly AuditRow[]): string {
  let prev = 'GENESIS';
  for (const row of rows) {
    prev = computeRowHash(prev, row);
  }
  return prev;
}

export function findTamperIndex(rows: readonly AuditRow[], expectedRoot: string): number | null {
  let prev = 'GENESIS';
  for (let i = 0; i < rows.length; i++) {
    prev = computeRowHash(prev, rows[i]!);
  }
  if (prev === expectedRoot) return null;
  return -1;
}

export function firstDivergenceIndex(
  rows: readonly AuditRow[],
  expectedHashesPerRow: readonly string[],
): number | null {
  let prev = 'GENESIS';
  for (let i = 0; i < rows.length; i++) {
    prev = computeRowHash(prev, rows[i]!);
    if (prev !== expectedHashesPerRow[i]) return i;
  }
  return null;
}
