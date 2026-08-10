/**
 * DIS-020 — State machine unit tests (TDD §4, CS-1).
 *
 * Pure transition table. No ports. Gate 2: this file is committed BEFORE
 * the implementation and MUST fail to resolve until DIS-020 impl lands.
 */
import { describe, expect, it } from 'vitest';
import {
  InvalidStateTransitionError,
  transition,
  type Event,
  type State,
} from '../../src/core/state-machine.js';

describe('state-machine — valid native-text path (TDD §4)', () => {
  it('uploaded → structuring via routed_native', () => {
    const next: State = transition('uploaded', { kind: 'routed_native' });
    expect(next).toBe('structuring');
  });

  it('structuring → ready_for_review via structured', () => {
    expect(transition('structuring', { kind: 'structured' })).toBe('ready_for_review');
  });

  it('ready_for_review → verified via nurse_approve (DIS-US-012)', () => {
    expect(transition('ready_for_review', { kind: 'nurse_approve', actor: 'nurse-1' })).toBe(
      'verified',
    );
  });

  it('ready_for_review → rejected via nurse_reject (DIS-US-014)', () => {
    expect(
      transition('ready_for_review', {
        kind: 'nurse_reject',
        actor: 'nurse-1',
        reason: 'illegible',
      }),
    ).toBe('rejected');
  });

  it('verified → promoted via promoted event', () => {
    expect(transition('verified', { kind: 'promoted' })).toBe('promoted');
  });

  it('auto_approved → promoted via promoted event (CS-7)', () => {
    expect(transition('auto_approved', { kind: 'promoted' })).toBe('promoted');
  });

  it('ready_for_review → auto_approved via policy_auto_approved (CS-7)', () => {
    expect(transition('ready_for_review', { kind: 'policy_auto_approved' })).toBe('auto_approved');
  });
});

describe('state-machine — valid ocr-scan path (TDD §4, §7, §8)', () => {
  it('uploaded → preprocessing via routed_scan', () => {
    expect(transition('uploaded', { kind: 'routed_scan' })).toBe('preprocessing');
  });

  it('preprocessing → ocr via preprocessed', () => {
    expect(transition('preprocessing', { kind: 'preprocessed' })).toBe('ocr');
  });

  it('ocr → structuring via ocr_complete', () => {
    expect(transition('ocr', { kind: 'ocr_complete' })).toBe('structuring');
  });
});

describe('state-machine — fail transitions (TDD §4)', () => {
  it('preprocessing → failed via fail', () => {
    expect(transition('preprocessing', { kind: 'fail', reason: 'timeout' })).toBe('failed');
  });

  it('ocr → failed via fail', () => {
    expect(transition('ocr', { kind: 'fail', reason: 'provider_down' })).toBe('failed');
  });

  it('structuring → failed via fail', () => {
    expect(transition('structuring', { kind: 'fail', reason: 'schema_invalid' })).toBe('failed');
  });
});

describe('state-machine — invalid transitions (CS-1, CS-5)', () => {
  it('uploaded → ocr (without preprocessing) throws InvalidStateTransitionError', () => {
    expect(() => transition('uploaded', { kind: 'ocr_complete' })).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('rejected → verified throws (CS-5 terminal)', () => {
    expect(() => transition('rejected', { kind: 'nurse_approve', actor: 'nurse-1' })).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('promoted → rejected throws (CS-5 terminal)', () => {
    expect(() =>
      transition('promoted', { kind: 'nurse_reject', actor: 'nurse-1', reason: 'r' }),
    ).toThrow(InvalidStateTransitionError);
  });

  it('failed → uploaded throws (retry creates a new extraction, DIS-US-003)', () => {
    expect(() => transition('failed', { kind: 'upload' })).toThrow(InvalidStateTransitionError);
  });

  it('ready_for_review → promoted (bypass verification) throws — CS-1 guard', () => {
    expect(() => transition('ready_for_review', { kind: 'promoted' })).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('structuring → verified throws (must route through ready_for_review)', () => {
    expect(() => transition('structuring', { kind: 'nurse_approve', actor: 'nurse-1' })).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('terminal states have no outbound edges (verified/promoted/rejected/failed)', () => {
    const terminals: State[] = ['promoted', 'rejected', 'failed'];
    for (const t of terminals) {
      expect(() => transition(t, { kind: 'promoted' })).toThrow(InvalidStateTransitionError);
    }
    expect(() => transition('verified', { kind: 'nurse_reject', actor: 'n', reason: 'r' })).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('InvalidStateTransitionError carries from, event, and code', () => {
    try {
      transition('uploaded', { kind: 'ocr_complete' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidStateTransitionError);
      const err = e as InvalidStateTransitionError;
      expect(err.from).toBe('uploaded');
      expect(err.event.kind).toBe('ocr_complete');
      expect(err.code).toBe('INVALID_STATE_TRANSITION');
    }
  });
});

describe('state-machine — purity', () => {
  it('is pure: same input yields same output across repeated calls', () => {
    const e: Event = { kind: 'routed_native' };
    expect(transition('uploaded', e)).toBe(transition('uploaded', e));
  });
});
