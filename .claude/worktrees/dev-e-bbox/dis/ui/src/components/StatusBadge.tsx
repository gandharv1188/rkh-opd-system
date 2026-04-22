export type ExtractionState =
  | 'uploaded'
  | 'preprocessing'
  | 'ocr'
  | 'structuring'
  | 'ready_for_review'
  | 'promoted'
  | 'rejected'
  | 'failed';

export const COLOUR_MAP: Record<ExtractionState, { bg: string; fg: string; label: string }> = {
  uploaded:         { bg: '#e3f2fd', fg: '#0d47a1', label: 'Uploaded' },
  preprocessing:    { bg: '#e3f2fd', fg: '#0d47a1', label: 'Preprocessing' },
  ocr:              { bg: '#e3f2fd', fg: '#0d47a1', label: 'OCR' },
  structuring:      { bg: '#e3f2fd', fg: '#0d47a1', label: 'Structuring' },
  ready_for_review: { bg: '#fff3e0', fg: '#e65100', label: 'Ready for Review' },
  promoted:         { bg: '#e8f5e9', fg: '#1b5e20', label: 'Promoted' },
  rejected:         { bg: '#ffebee', fg: '#b71c1c', label: 'Rejected' },
  failed:           { bg: '#ffebee', fg: '#b71c1c', label: 'Failed' },
};

export function StatusBadge({ state }: { state: ExtractionState }) {
  const spec = COLOUR_MAP[state];
  return (
    <span
      data-testid={`status-badge-${state}`}
      style={{
        backgroundColor: spec.bg,
        color: spec.fg,
        padding: '0.125rem 0.5rem',
        borderRadius: '0.25rem',
        fontSize: '0.75rem',
        fontWeight: 500,
        display: 'inline-block',
      }}
    >
      {spec.label}
    </span>
  );
}
