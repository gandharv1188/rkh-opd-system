import { describe, it, expect } from 'vitest';

function detectUnitConflict(rows: Array<{ test: string; value: number; unit: string }>): boolean {
  const byTest = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!byTest.has(r.test)) byTest.set(r.test, new Set());
    byTest.get(r.test)!.add(r.unit);
  }
  for (const units of byTest.values()) {
    if (units.size > 1) return true;
  }
  return false;
}

describe('Red-team: conflicting units (CS-7)', () => {
  it('detects same test with conflicting units', () => {
    expect(detectUnitConflict([
      { test: 'Glucose', value: 100, unit: 'mg/dL' },
      { test: 'Glucose', value: 5.5, unit: 'mmol/L' },
    ])).toBe(true);
  });
  it('clean report passes', () => {
    expect(detectUnitConflict([
      { test: 'Glucose', value: 100, unit: 'mg/dL' },
      { test: 'HbA1c', value: 6.5, unit: '%' },
    ])).toBe(false);
  });
});
