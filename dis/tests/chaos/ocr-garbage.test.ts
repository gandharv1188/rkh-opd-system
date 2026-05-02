import { describe, it, expect } from 'vitest';
import type { State } from '../../src/core/state-machine.js';
import { transition, InvalidStateTransitionError } from '../../src/core/state-machine.js';

/**
 * Simulates structuring's fail-closed behaviour: if the structuring step can't
 * find a meaningful clinical shape in the OCR text, it throws, and the pipeline
 * transitions to `failed`.
 */
function structureOrFail(ocrMarkdown: string): { success: boolean; reason?: string } {
  const medicalRe = /(Hb|HbA1c|Glucose|mg\/dL|Dose|Drug|Diagnosis|ICD|BP|Temp)/i;
  if (!medicalRe.test(ocrMarkdown)) {
    return { success: false, reason: 'non-medical-content' };
  }
  return { success: true };
}

describe('Chaos: OCR garbage (CS-7)', () => {
  it('extraction ends in failed state', () => {
    const garbage = 'The quick brown fox jumps over the lazy dog. ZZZ random chatter.';
    const structure = structureOrFail(garbage);
    expect(structure.success).toBe(false);

    const failTarget = transition('structuring' as State, { kind: 'fail', reason: structure.reason ?? 'unknown' });
    expect(failTarget).toBe('failed');
  });

  it('real medical text proceeds past structuring', () => {
    const ok = structureOrFail('Lab Report\nHb: 12.5 g/dL\nGlucose: 95 mg/dL');
    expect(ok.success).toBe(true);
  });

  it('invalid transition throws rather than writing bad state', () => {
    expect(() => transition('uploaded' as State, { kind: 'structured' as never })).toThrow(InvalidStateTransitionError);
  });
});
