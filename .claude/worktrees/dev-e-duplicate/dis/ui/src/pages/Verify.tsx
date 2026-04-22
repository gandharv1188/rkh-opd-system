import { useEffect, useState } from 'react';

type ExtractionDetail = {
  id: string;
  patient_id: string;
  status: string;
  version: number;
  structured?: Record<string, unknown>;
  pdf_url?: string;
};

export interface VerifyPageProps {
  readonly extractionId: string;
}

export function VerifyPage({ extractionId }: VerifyPageProps) {
  const [detail, setDetail] = useState<ExtractionDetail | null>(null);
  const [viewedFields, setViewedFields] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/extractions/${extractionId}`)
      .then((r) => r.json())
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [extractionId]);

  if (!detail) {
    return <div data-testid="verify-loading">Loading…</div>;
  }

  const fields = Object.entries(detail.structured ?? {});
  const allViewed = fields.length === 0 || fields.every(([k]) => viewedFields.has(k));

  return (
    <div data-testid="verify-page" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
      <div data-testid="verify-pdf-pane">
        {detail.pdf_url ? (
          <iframe src={detail.pdf_url} title="Source document" style={{ width: '100%', height: '80vh', border: 0 }} />
        ) : (
          <div>No PDF URL</div>
        )}
      </div>
      <div data-testid="verify-fields-pane">
        <h2>Extraction {detail.id}</h2>
        <p>Status: <strong>{detail.status}</strong> (v{detail.version})</p>
        {fields.map(([key, value]) => (
          <div
            key={key}
            data-testid={`field-${key}`}
            onFocus={() => setViewedFields((prev) => new Set(prev).add(key))}
            tabIndex={0}
          >
            <label>{key}: </label>
            <span>{String(value)}</span>
          </div>
        ))}
        <button
          data-testid="approve-button"
          disabled={!allViewed}
          aria-disabled={!allViewed}
        >
          Approve
        </button>
        {!allViewed && (
          <p data-testid="approve-blocked-reason" role="status">
            Review every field before approving.
          </p>
        )}
      </div>
    </div>
  );
}
