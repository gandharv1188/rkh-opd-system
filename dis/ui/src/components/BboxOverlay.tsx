import { useEffect, useRef } from 'react';

export interface BoundingBox {
  readonly field: string;
  readonly page: number;
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
}

export interface BboxOverlayProps {
  readonly boxes: readonly BoundingBox[];
  readonly focusedField?: string;
  /** CSS width and height of the PDF page in pixels (for scaling). */
  readonly pageWidth: number;
  readonly pageHeight: number;
  /** Page number currently displayed; only boxes on this page are drawn. */
  readonly currentPage: number;
}

export function BboxOverlay({ boxes, focusedField, pageWidth, pageHeight, currentPage }: BboxOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pageBoxes = boxes.filter((b) => b.page === currentPage);

  useEffect(() => {
    if (!focusedField || !ref.current) return;
    const el = ref.current.querySelector<HTMLDivElement>(`[data-field="${focusedField}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusedField]);

  return (
    <div
      ref={ref}
      data-testid="bbox-overlay"
      style={{
        position: 'absolute', inset: 0,
        width: pageWidth, height: pageHeight,
        pointerEvents: 'none',
      }}
    >
      {pageBoxes.map((b) => {
        const focused = b.field === focusedField;
        return (
          <div
            key={`${b.field}-${b.page}`}
            data-field={b.field}
            data-focused={focused}
            style={{
              position: 'absolute',
              left: b.x, top: b.y, width: b.w, height: b.h,
              border: focused ? '2px solid #1a237e' : '1px solid rgba(26,35,126,0.5)',
              backgroundColor: focused ? 'rgba(26,35,126,0.2)' : 'transparent',
              transition: 'all 0.15s',
            }}
          />
        );
      })}
    </div>
  );
}
