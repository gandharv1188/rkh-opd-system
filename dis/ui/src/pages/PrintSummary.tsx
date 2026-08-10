export interface PrintSummaryField {
  readonly field: string;
  readonly value: string;
  readonly confidence?: number;
  readonly bbox?: { page: number; x: number; y: number; w: number; h: number };
}

export interface PrintSummaryProps {
  readonly extractionId: string;
  readonly patientId: string;
  readonly fields: readonly PrintSummaryField[];
  readonly verifiedBy?: string;
  readonly verifiedAt?: string;
}

export function PrintSummary({ extractionId, patientId, fields, verifiedBy, verifiedAt }: PrintSummaryProps) {
  return (
    <div data-testid="print-summary"
         style={{
           width: '210mm', minHeight: '297mm', padding: '15mm',
           fontFamily: 'Inter, system-ui, sans-serif', fontSize: '11pt', color: '#000',
         }}>
      <style>{`@media print { @page { size: A4; margin: 12mm 10mm; } }`}</style>
      <header data-testid="print-header"
              style={{ borderBottom: '2px solid #1a237e', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '18pt', color: '#1a237e' }}>Radhakishan Hospital — Verification Summary</h1>
        <p style={{ margin: '0.25rem 0' }}>
          Extraction: <strong>{extractionId}</strong> · Patient: <strong>{patientId}</strong>
        </p>
        {verifiedBy && <p style={{ margin: 0 }}>Verified by {verifiedBy}{verifiedAt ? ` at ${verifiedAt}` : ''}.</p>}
      </header>
      <table data-testid="print-fields" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr><th align="left">Field</th><th align="left">Value</th><th>Confidence</th><th>Page/BBox</th></tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.field} style={{ borderTop: '1px solid #e0e0e0' }}>
              <td>{f.field}</td>
              <td>{f.value}</td>
              <td align="center">{f.confidence !== undefined ? `${Math.round(f.confidence * 100)}%` : '—'}</td>
              <td align="center">
                {f.bbox ? `p${f.bbox.page} (${Math.round(f.bbox.x)},${Math.round(f.bbox.y)})` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer data-testid="print-footer"
              style={{ marginTop: '2rem', fontSize: '9pt', color: '#5f6368' }}>
        Generated via DIS verification UI. Retain with paper chart per NABH §5.2.
      </footer>
    </div>
  );
}
