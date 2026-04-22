import { useState } from 'react';

export interface RejectFlowProps {
  readonly extractionId: string;
  readonly expectedVersion: number;
  readonly actor: string;
  readonly onRejected?: () => void;
}

export function RejectFlow({ extractionId, expectedVersion, actor, onRejected }: RejectFlowProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = reason.trim().length > 0 && !submitting;

  async function doReject() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/extractions/${extractionId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Operator-Id': actor },
        body: JSON.stringify({ expected_version: expectedVersion, actor, reason_code: reason.trim() }),
      });
      if (res.ok) onRejected?.();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div data-testid="reject-flow">
      <label htmlFor="reject-reason">Reason (required)</label>
      <textarea
        id="reject-reason"
        data-testid="reject-reason-input"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
      />
      <button
        data-testid="reject-submit"
        onClick={doReject}
        disabled={!canSubmit}
        aria-disabled={!canSubmit}
      >
        {submitting ? 'Rejecting…' : 'Reject'}
      </button>
    </div>
  );
}
