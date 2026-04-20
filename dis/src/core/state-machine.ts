/**
 * State machine stub — minimal types for DIS-021 orchestrator wiring.
 *
 * This is an interim stub. DIS-020 owns the authoritative implementation
 * and will replace this file. The types defined here are intentionally
 * shaped so DIS-020's concrete transition table satisfies them without
 * surface-level change.
 *
 * COORDINATION_REQUIRED: merger must reconcile this stub with DIS-020.
 *
 * @see TDD §4
 */

export type ExtractionState =
  | 'uploaded'
  | 'preprocessing'
  | 'ocr'
  | 'structuring'
  | 'ready_for_review'
  | 'auto_approved'
  | 'verified'
  | 'rejected'
  | 'promoted'
  | 'failed';

export type ExtractionEvent =
  | { readonly kind: 'preprocess_started' }
  | { readonly kind: 'ocr_started' }
  | { readonly kind: 'structuring_started' }
  | { readonly kind: 'structuring_succeeded' }
  | { readonly kind: 'structuring_failed'; readonly reason: string }
  | { readonly kind: 'approved'; readonly actor: string }
  | { readonly kind: 'rejected'; readonly actor: string; readonly reasonCode: string }
  | { readonly kind: 'promoted' };

export class InvalidStateTransitionError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION' as const;
  constructor(
    readonly from: ExtractionState,
    readonly event: ExtractionEvent['kind'],
  ) {
    super(`Invalid transition: ${from} --(${event})--> ?`);
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * Pure transition function. Returns the next state or throws
 * {@link InvalidStateTransitionError} on an illegal transition.
 *
 * DIS-020 will expand this table; the orchestrator only depends on the
 * signature.
 */
export function transition(from: ExtractionState, event: ExtractionEvent): ExtractionState {
  switch (event.kind) {
    case 'preprocess_started':
      if (from === 'uploaded') return 'preprocessing';
      break;
    case 'ocr_started':
      if (from === 'preprocessing') return 'ocr';
      break;
    case 'structuring_started':
      if (from === 'uploaded' || from === 'ocr') return 'structuring';
      break;
    case 'structuring_succeeded':
      if (from === 'structuring') return 'ready_for_review';
      break;
    case 'structuring_failed':
      if (from === 'structuring') return 'failed';
      break;
    case 'approved':
      if (from === 'ready_for_review') return 'verified';
      break;
    case 'rejected':
      if (from === 'ready_for_review') return 'rejected';
      break;
    case 'promoted':
      if (from === 'verified') return 'promoted';
      break;
  }
  throw new InvalidStateTransitionError(from, event.kind);
}
