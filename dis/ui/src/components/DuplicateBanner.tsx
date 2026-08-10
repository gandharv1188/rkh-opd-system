import { useState } from 'react';

export interface DuplicateBannerProps {
  readonly duplicateOfId: string | null;
  readonly onOverride?: (reason: string) => void;
  readonly onCancel?: () => void;
}

/** Helper (exported for tests): approve is blocked iff duplicateOfId is set AND operator hasn't overridden. */
export function isApproveBlocked(duplicateOfId: string | null, overridden: boolean): boolean {
  return duplicateOfId !== null && !overridden;
}

export function DuplicateBanner({ duplicateOfId, onOverride, onCancel }: DuplicateBannerProps) {
  const [overridden, setOverridden] = useState(false);
  const [reason, setReason] = useState('');

  if (!duplicateOfId) return null;

  if (overridden) {
    return (
      <div data-testid="duplicate-banner-overridden" role="status"
           style={{ backgroundColor: '#fff3e0', color: '#e65100', padding: '0.5rem 1rem' }}>
        Duplicate warning acknowledged — reason recorded: "{reason}". Approve now enabled.
      </div>
    );
  }

  return (
    <div data-testid="duplicate-banner" role="alert"
         style={{ backgroundColor: '#ffebee', color: '#b71c1c', padding: '0.5rem 1rem' }}>
      <strong>Possible duplicate.</strong> This document's hash matches a previously promoted extraction ({duplicateOfId}).
      Approve is blocked until an operator overrides.
      <div style={{ marginTop: '0.5rem' }}>
        <label htmlFor="dup-reason">Override reason (required):</label>
        <input
          id="dup-reason"
          data-testid="dup-reason-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          data-testid="dup-override-btn"
          disabled={reason.trim().length === 0}
          onClick={() => { setOverridden(true); onOverride?.(reason.trim()); }}
        >
          Override
        </button>
        <button data-testid="dup-cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
