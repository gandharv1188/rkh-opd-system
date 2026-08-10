import { useEffect, useState } from 'react';

export interface SessionBannerProps {
  readonly tokenExpiresAt: number;
  readonly warnBeforeMs?: number;
  readonly onRefresh?: () => void;
  readonly now?: () => number;
}

const DEFAULT_WARN_WINDOW_MS = 2 * 60 * 1000;

export function shouldShowWarning(nowMs: number, expiresAtMs: number, warnMs: number): boolean {
  const remaining = expiresAtMs - nowMs;
  return remaining > 0 && remaining <= warnMs;
}

export function SessionBanner({
  tokenExpiresAt,
  warnBeforeMs = DEFAULT_WARN_WINDOW_MS,
  onRefresh,
  now = Date.now,
}: SessionBannerProps) {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const nowMs = now();
  if (!shouldShowWarning(nowMs, tokenExpiresAt, warnBeforeMs)) return null;

  const secondsLeft = Math.ceil((tokenExpiresAt - nowMs) / 1000);

  return (
    <div
      data-testid="session-banner"
      role="alert"
      style={{
        backgroundColor: '#fff3e0',
        color: '#e65100',
        padding: '0.5rem 1rem',
        borderBottom: '1px solid #ffb74d',
      }}
    >
      Your session expires in {secondsLeft}s.{' '}
      <button data-testid="session-refresh" onClick={onRefresh}>
        Refresh session
      </button>
    </div>
  );
}
