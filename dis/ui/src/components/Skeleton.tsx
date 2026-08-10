export interface SkeletonProps {
  readonly width?: string | number;
  readonly height?: string | number;
  readonly variant?: 'text' | 'rect' | 'circle';
}

export function Skeleton({ width = '100%', height = '1rem', variant = 'text' }: SkeletonProps) {
  const borderRadius = variant === 'circle' ? '50%' : variant === 'rect' ? '4px' : '4px';
  return (
    <div
      data-testid="skeleton"
      role="status"
      aria-label="Loading"
      style={{
        width,
        height,
        backgroundColor: '#e0e0e0',
        borderRadius,
        animation: 'skeleton-pulse 1.5s ease-in-out infinite',
      }}
    />
  );
}

if (typeof document !== 'undefined' && !document.querySelector('style[data-skeleton]')) {
  const style = document.createElement('style');
  style.setAttribute('data-skeleton', 'true');
  style.textContent = `@keyframes skeleton-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }`;
  document.head.appendChild(style);
}

export function QueueSkeleton() {
  return (
    <div data-testid="queue-skeleton" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} height="2rem" />
      ))}
    </div>
  );
}

export function VerifySkeleton() {
  return (
    <div data-testid="verify-skeleton" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
      <Skeleton variant="rect" height="80vh" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} height="2.5rem" />
        ))}
      </div>
    </div>
  );
}
