import { describe, it, expect } from 'vitest';

function scoreOcrPlausibility(text: string): { confidence: number } {
  // A token is suspicious when a letter OCR-confusable with a digit appears mixed
  // with digits (or vice versa) inside the same token — e.g. "l0.0", "O0O00",
  // "l1". Pure-digit tokens like "11.5" are NOT suspicious.
  const tokens = text.split(/[\s,]+/);
  const suspicious = tokens.filter((t) => {
    const hasDigit = /\d/.test(t);
    const hasConfusable = /[OIl]/.test(t);
    if (hasDigit && hasConfusable) return true;
    // All-confusable token with length >= 3 (e.g. "O0O00" has digits so covered
    // above; pure "OOO" rare in real text).
    return /^[OIl]{3,}$/.test(t);
  }).length;
  return { confidence: Math.max(0, 1 - suspicious * 0.3) };
}

describe('Red-team: mis-OCR (CS-7)', () => {
  it('flags low confidence on suspicious tokens', () => {
    const bad = scoreOcrPlausibility('Patient: O0O00 Age: l1 Hb: l0.0');
    expect(bad.confidence).toBeLessThan(0.5);
  });
  it('passes clean text at high confidence', () => {
    const good = scoreOcrPlausibility('Patient Jane Age 34 Hb 11.5');
    expect(good.confidence).toBeGreaterThan(0.7);
  });
});
