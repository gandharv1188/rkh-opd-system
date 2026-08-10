import { useState } from 'react';

export interface PdfViewerProps {
  pdfUrl: string;
  totalPages?: number;
}

export function PdfViewer({ pdfUrl, totalPages = 1 }: PdfViewerProps) {
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);

  const next = () => setPage((p) => Math.min(totalPages, p + 1));
  const prev = () => setPage((p) => Math.max(1, p - 1));
  const zoomIn = () => setZoom((z) => Math.min(3, z + 0.25));
  const zoomOut = () => setZoom((z) => Math.max(0.5, z - 0.25));

  const srcWithPage = `${pdfUrl}#page=${page}&zoom=${zoom * 100}`;

  return (
    <div data-testid="pdf-viewer">
      <div data-testid="pdf-controls" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button data-testid="pdf-prev" onClick={prev} disabled={page === 1}>Previous</button>
        <span data-testid="pdf-page-indicator">Page {page} of {totalPages}</span>
        <button data-testid="pdf-next" onClick={next} disabled={page === totalPages}>Next</button>
        <button data-testid="pdf-zoom-out" onClick={zoomOut}>−</button>
        <span data-testid="pdf-zoom-indicator">{Math.round(zoom * 100)}%</span>
        <button data-testid="pdf-zoom-in" onClick={zoomIn}>+</button>
      </div>
      <iframe
        data-testid="pdf-frame"
        src={srcWithPage}
        title="Document"
        style={{ width: '100%', height: '80vh', border: 0 }}
      />
    </div>
  );
}
