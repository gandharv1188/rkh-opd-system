import { useState, useEffect, useCallback } from 'react';

export type ExtractionRow = {
  id: string;
  patient_id: string;
  status: string;
  version: number;
};

export type QueueResponse = {
  items: ExtractionRow[];
  next_cursor: string | null;
};

export function buildExtractionsUrl(
  base: string,
  statusFilter: string,
  cursor: string | null,
): string {
  const url = new URL('/extractions', base);
  if (statusFilter) url.searchParams.set('status', statusFilter);
  if (cursor) url.searchParams.set('cursor', cursor);
  return url.toString();
}

export function QueuePage() {
  const [items, setItems] = useState<ExtractionRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (append: boolean, currentCursor: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const url = buildExtractionsUrl(
          window.location.origin,
          statusFilter,
          append ? currentCursor : null,
        );
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: QueueResponse = await res.json();
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setCursor(data.next_cursor ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [statusFilter],
  );

  useEffect(() => {
    load(false, null);
  }, [load]);

  return (
    <div data-testid="queue-page">
      <div data-testid="queue-filters">
        <label htmlFor="queue-status-filter">Status</label>
        <select
          id="queue-status-filter"
          data-testid="status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All</option>
          <option value="ready_for_review">Ready</option>
          <option value="promoted">Promoted</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>
      {error && (
        <div data-testid="queue-error" role="alert">
          {error}
        </div>
      )}
      <ul data-testid="queue-list">
        {items.map((row) => (
          <li key={row.id} data-testid={`queue-item-${row.id}`}>
            {row.id} — {row.status} (v{row.version})
          </li>
        ))}
      </ul>
      {items.length === 0 && !loading && !error && (
        <div data-testid="queue-empty">No extractions.</div>
      )}
      {cursor && (
        <button
          data-testid="load-more"
          onClick={() => load(true, cursor)}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

export default QueuePage;
