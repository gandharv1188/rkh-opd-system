import { describe, it, expect } from 'vitest';

interface AuditRow {
  extraction_id: string;
  operator_id: string;
  event: 'approve' | 'reject' | 'retry';
  signed_at: string;
  patient_id: string;
  confidence_summary?: { high: number; medium: number; low: number };
}

function generateWeeklyBatch(): readonly AuditRow[] {
  const rows: AuditRow[] = [];
  for (let i = 0; i < 20; i++) {
    rows.push({
      extraction_id: `ext-week-${i.toString().padStart(3, '0')}`,
      operator_id: `op-${(i % 3) + 1}`,
      event: i % 7 === 0 ? 'reject' : 'approve',
      signed_at: new Date(Date.UTC(2026, 3, 22 - (i % 7), 10, 0, 0)).toISOString(),
      patient_id: `pt-${i.toString().padStart(3, '0')}`,
      confidence_summary: { high: 8 + (i % 3), medium: 2, low: i % 2 },
    });
  }
  return rows;
}

describe('Weekly audit dry-run (CS-6)', () => {
  const batch = generateWeeklyBatch();

  it('produces 20 rows', () => {
    expect(batch.length).toBe(20);
  });

  it('every approval has operator_id + signed_at', () => {
    const approvals = batch.filter((r) => r.event === 'approve');
    expect(approvals.length).toBeGreaterThan(0);
    for (const r of approvals) {
      expect(r.operator_id).toBeTruthy();
      expect(r.signed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('rejects carry an operator_id too', () => {
    const rejects = batch.filter((r) => r.event === 'reject');
    for (const r of rejects) {
      expect(r.operator_id).toBeTruthy();
    }
  });

  it('spans at least 3 distinct operators (coverage)', () => {
    const ops = new Set(batch.map((r) => r.operator_id));
    expect(ops.size).toBeGreaterThanOrEqual(3);
  });

  it('confidence_summary present on every extraction', () => {
    for (const r of batch) {
      expect(r.confidence_summary).toBeTruthy();
      expect(r.confidence_summary!.high + r.confidence_summary!.medium + r.confidence_summary!.low).toBeGreaterThan(0);
    }
  });
});
