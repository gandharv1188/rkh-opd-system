const KEY_PREFIX = 'dis.ui.edit.';

export interface FieldEdits {
  readonly [fieldKey: string]: string;
}

/** In-memory fallback when localStorage is unavailable (SSR/private mode). */
const memoryStore = new Map<string, FieldEdits>();

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function saveEdits(extractionId: string, edits: FieldEdits): void {
  if (hasStorage()) {
    try {
      window.localStorage.setItem(KEY_PREFIX + extractionId, JSON.stringify(edits));
      return;
    } catch {
      // Quota exceeded or disabled — fall through to memory.
    }
  }
  memoryStore.set(extractionId, edits);
}

export function loadEdits(extractionId: string): FieldEdits | null {
  if (hasStorage()) {
    try {
      const raw = window.localStorage.getItem(KEY_PREFIX + extractionId);
      if (raw) return JSON.parse(raw) as FieldEdits;
    } catch {
      // JSON parse / storage error — fall through.
    }
  }
  return memoryStore.get(extractionId) ?? null;
}

export function clearEdits(extractionId: string): void {
  if (hasStorage()) {
    try { window.localStorage.removeItem(KEY_PREFIX + extractionId); } catch { /* noop */ }
  }
  memoryStore.delete(extractionId);
}

/** Test-only: wipe both layers so specs are deterministic. */
export function __resetForTests(): void {
  if (hasStorage()) {
    try {
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (k?.startsWith(KEY_PREFIX)) window.localStorage.removeItem(k);
      }
    } catch { /* noop */ }
  }
  memoryStore.clear();
}
