export interface ConflictDialogProps {
  readonly open: boolean;
  readonly currentVersion: number;
  readonly currentStatus: string;
  readonly onReload: () => void;
  readonly onCancel: () => void;
}

export function ConflictDialog({ open, currentVersion, currentStatus, onReload, onCancel }: ConflictDialogProps) {
  if (!open) return null;
  return (
    <div
      data-testid="conflict-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
    >
      <h2 id="conflict-title">Another operator updated this extraction</h2>
      <p>
        The record is now at version <strong>{currentVersion}</strong> (status: <em>{currentStatus}</em>).
        Your view is stale. Reload to see the latest state before re-reviewing.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        <button data-testid="conflict-reload" onClick={onReload}>
          Reload & re-review
        </button>
        <button data-testid="conflict-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
