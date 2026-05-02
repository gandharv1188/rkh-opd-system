import { describe, it, expect } from 'vitest';
import {
  computeChainHash,
  computeRowHash,
  firstDivergenceIndex,
  type AuditRow,
} from '../../src/observability/audit-integrity.js';

function mkRow(
  id: string,
  actor: string,
  event: string,
  payload: Record<string, unknown> = {},
): AuditRow {
  return { id, timestamp: '2026-04-22T00:00:00Z', actor, event, payload };
}

function storedHashes(rows: readonly AuditRow[]): string[] {
  const out: string[] = [];
  let prev = 'GENESIS';
  for (const r of rows) {
    prev = computeRowHash(prev, r);
    out.push(prev);
  }
  return out;
}

describe('audit-integrity (CS-5)', () => {
  it('stable hash across identical inputs', () => {
    const rows = [mkRow('a1', 'op-1', 'approve'), mkRow('a2', 'op-2', 'reject')];
    expect(computeChainHash(rows)).toBe(computeChainHash(rows));
  });

  it('detects an altered row', () => {
    const rows = [mkRow('a1', 'op-1', 'approve'), mkRow('a2', 'op-2', 'reject')];
    const stored = storedHashes(rows);
    const tampered = [...rows];
    tampered[1] = { ...tampered[1]!, event: 'approve' };
    expect(firstDivergenceIndex(tampered, stored)).toBe(1);
  });

  it('chain intact when no tampering', () => {
    const rows = [mkRow('a1', 'op-1', 'approve')];
    const stored = [computeChainHash(rows)];
    expect(firstDivergenceIndex(rows, stored)).toBeNull();
  });
});
