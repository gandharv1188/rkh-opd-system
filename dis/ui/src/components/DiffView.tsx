export interface FieldDiff {
  readonly field: string;
  readonly raw: string;
  readonly edited: string;
}

export interface DiffViewProps {
  readonly diffs: readonly FieldDiff[];
}

export type DiffMarker = 'added' | 'removed' | 'changed' | 'unchanged';

export function classifyDiff(raw: string, edited: string): DiffMarker {
  if (raw === edited) return 'unchanged';
  if (raw === '' && edited !== '') return 'added';
  if (raw !== '' && edited === '') return 'removed';
  return 'changed';
}

export function DiffView({ diffs }: DiffViewProps) {
  const changes = diffs.filter((d) => d.raw !== d.edited);
  if (changes.length === 0) {
    return <p data-testid="diff-empty">No changes — approve will save AI values as-is.</p>;
  }
  return (
    <table data-testid="diff-view">
      <thead><tr><th>Field</th><th>Change</th><th>AI value</th><th>Your value</th></tr></thead>
      <tbody>
        {changes.map((d) => {
          const kind = classifyDiff(d.raw, d.edited);
          return (
            <tr key={d.field} data-testid={`diff-row-${d.field}`} data-kind={kind}>
              <td>{d.field}</td>
              <td data-testid={`diff-marker-${d.field}`}>
                {kind === 'added' ? '+' : kind === 'removed' ? '−' : '~'}
              </td>
              <td style={{ textDecoration: kind === 'removed' ? 'line-through' : undefined }}>{d.raw || '—'}</td>
              <td style={{ fontWeight: kind === 'added' ? 600 : undefined }}>{d.edited || '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
