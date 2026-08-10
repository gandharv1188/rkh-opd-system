import { useEffect, useSyncExternalStore } from 'react';

export interface FeatureFlags {
  realtime_enabled: boolean;
  i18n_hindi: boolean;
  experimental_bbox_overlay: boolean;
  print_summary: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  realtime_enabled: true,
  i18n_hindi: true,
  experimental_bbox_overlay: false,
  print_summary: true,
};

let currentFlags: FeatureFlags = { ...DEFAULT_FLAGS };
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notify(): void {
  for (const cb of listeners) cb();
}

/** Replace the current flag snapshot. Exposed for tests + explicit reload. */
export function setFlags(flags: Partial<FeatureFlags>): void {
  currentFlags = { ...currentFlags, ...flags };
  notify();
}

export function getFlags(): FeatureFlags {
  return currentFlags;
}

export async function loadFlags(endpoint = '/admin/flags'): Promise<void> {
  try {
    const res = await fetch(endpoint);
    if (!res.ok) return;
    const body = (await res.json()) as Partial<FeatureFlags>;
    setFlags(body);
  } catch {
    // Keep defaults — offline/staging shouldn't crash the UI.
  }
}

export function useFlags(): FeatureFlags {
  return useSyncExternalStore(
    subscribe,
    () => currentFlags,
    () => currentFlags,
  );
}

export function useFlag<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
  const flags = useFlags();
  return flags[key];
}

/** Convenience hook that auto-loads flags on mount. Fire-and-forget. */
export function useAutoLoadFlags(endpoint?: string): void {
  useEffect(() => {
    void loadFlags(endpoint);
  }, [endpoint]);
}
