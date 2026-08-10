import { useState } from 'react';

export interface ApproveFlowProps {
  readonly extractionId: string;
  readonly expectedVersion: number;
  readonly actor: string;
  readonly onApproved?: () => void;
}

export function ApproveFlow({ extractionId, expectedVersion, actor, onApproved }: ApproveFlowProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function doApprove() {
    setSubmitting(true);
    try {
      const res = await fetch(`/extractions/${extractionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Operator-Id': actor },
        body: JSON.stringify({ expected_version: expectedVersion, actor }),
      });
      if (res.ok) onApproved?.();
    } finally {
      setSubmitting(false);
      setShowConfirm(false);
    }
  }

  return (
    <>
      <button
        data-testid="approve-trigger"
        onClick={() => setShowConfirm(true)}
        disabled={submitting}
      >
        Approve
      </button>
      {showConfirm && (
        <div data-testid="approve-confirm" role="dialog" aria-modal="true">
          <p>Approve extraction {extractionId}?</p>
          <button
            data-testid="approve-confirm-yes"
            onClick={doApprove}
            disabled={submitting}
          >
            {submitting ? 'Approving…' : 'Yes, approve'}
          </button>
          <button data-testid="approve-confirm-cancel" onClick={() => setShowConfirm(false)}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
