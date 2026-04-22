/**
 * DIS-020 — Ingestion state machine (pure).
 *
 * Enforces the transition diagram from TDD §4 and the clinical-safety
 * invariant CS-1 (no promotion without verification or auto-approval).
 * All transitions are total: valid ones return the next state; invalid
 * ones throw `InvalidStateTransitionError` so the orchestrator (DIS-021)
 * can reject the event and surface a 409 to the caller.
 *
 * Design notes:
 * - Pure function: no I/O, no clock, no mutation. Side-effects (audit
 *   log, DB writes) belong to the orchestrator.
 * - Discriminated unions on both `State` (string literals) and `Event`
 *   (tagged by `kind`), per coding_standards §1.
 * - Exhaustiveness enforced in the event switch via `assertNever`.
 */
import { assertNever } from '../types/assert-never.js';

export type State =
  | 'uploaded'
  | 'preprocessing'
  | 'ocr'
  | 'structuring'
  | 'ready_for_review'
  | 'auto_approved'
  | 'verified'
  | 'promoted'
  | 'rejected'
  | 'failed';

export type Event =
  | { kind: 'upload' }
  | { kind: 'routed_native' }
  | { kind: 'routed_scan' }
  | { kind: 'preprocessed' }
  | { kind: 'ocr_complete' }
  | { kind: 'structured' }
  | { kind: 'policy_auto_approved' }
  | { kind: 'nurse_approve'; actor: string }
  | { kind: 'nurse_reject'; actor: string; reason: string }
  | { kind: 'promoted' }
  | { kind: 'fail'; reason: string };

export class InvalidStateTransitionError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION' as const;
  constructor(
    readonly from: State,
    readonly event: Event,
  ) {
    super(`Invalid transition from '${from}' on event '${event.kind}'`);
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * Pure transition function. Throws `InvalidStateTransitionError` for any
 * (state, event) pair not explicitly listed in TDD §4.
 */
export function transition(state: State, event: Event): State {
  switch (event.kind) {
    case 'upload':
      // `upload` is the synthetic event for extraction creation. The
      // only valid "prior" state is the implicit void; we model that as
      // always-invalid here because the orchestrator creates the row in
      // `uploaded` directly.
      throw new InvalidStateTransitionError(state, event);

    case 'routed_native':
      if (state === 'uploaded') return 'structuring';
      throw new InvalidStateTransitionError(state, event);

    case 'routed_scan':
      if (state === 'uploaded') return 'preprocessing';
      throw new InvalidStateTransitionError(state, event);

    case 'preprocessed':
      if (state === 'preprocessing') return 'ocr';
      throw new InvalidStateTransitionError(state, event);

    case 'ocr_complete':
      if (state === 'ocr') return 'structuring';
      throw new InvalidStateTransitionError(state, event);

    case 'structured':
      if (state === 'structuring') return 'ready_for_review';
      throw new InvalidStateTransitionError(state, event);

    case 'policy_auto_approved':
      if (state === 'ready_for_review') return 'auto_approved';
      throw new InvalidStateTransitionError(state, event);

    case 'nurse_approve':
      if (state === 'ready_for_review') return 'verified';
      throw new InvalidStateTransitionError(state, event);

    case 'nurse_reject':
      if (state === 'ready_for_review') return 'rejected';
      throw new InvalidStateTransitionError(state, event);

    case 'promoted':
      if (state === 'verified' || state === 'auto_approved') return 'promoted';
      throw new InvalidStateTransitionError(state, event);

    case 'fail':
      if (
        state === 'preprocessing' ||
        state === 'ocr' ||
        state === 'structuring' ||
        state === 'uploaded'
      ) {
        return 'failed';
      }
      throw new InvalidStateTransitionError(state, event);

    default:
      return assertNever(event);
  }
}
