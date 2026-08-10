export interface ConfidenceBadgeProps { readonly confidence: number; }

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const level = confidence >= 0.9 ? 'high' : confidence >= 0.7 ? 'medium' : 'low';
  const colours = {
    high: { bg: '#e8f5e9', fg: '#1b5e20' },
    medium: { bg: '#fff3e0', fg: '#e65100' },
    low: { bg: '#ffebee', fg: '#b71c1c' },
  }[level];

  return (
    <span
      data-testid={`confidence-${level}`}
      style={{
        backgroundColor: colours.bg,
        color: colours.fg,
        padding: '0.125rem 0.5rem',
        borderRadius: '0.25rem',
        fontSize: '0.75rem',
        fontWeight: 500,
      }}
    >
      {level} {Math.round(confidence * 100)}%
    </span>
  );
}
