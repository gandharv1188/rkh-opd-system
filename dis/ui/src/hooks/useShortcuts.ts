import { useEffect } from 'react';

export interface ShortcutHandlers {
  readonly onApprove?: () => void;
  readonly onCancel?: () => void;
  readonly onNextField?: () => void;
  readonly onPrevField?: () => void;
  /** When true, shortcuts are not fired (e.g., focus is in a text input). */
  readonly disabled?: boolean;
}

/** Pure helper — maps a KeyboardEvent-like shape to a shortcut action. Exported for tests. */
export type ShortcutAction = 'approve' | 'cancel' | 'next' | 'prev' | null;

export function matchShortcut(
  key: string,
  opts: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; targetTag?: string } = {},
): ShortcutAction {
  if (opts.targetTag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(opts.targetTag.toUpperCase())) return null;
  if (opts.ctrlKey || opts.metaKey || opts.altKey) return null;
  switch (key) {
    case 'Enter':
      return 'approve';
    case 'Escape':
      return 'cancel';
    case 'n':
    case 'N':
      return 'next';
    case 'p':
    case 'P':
      return 'prev';
    default:
      return null;
  }
}

export function useShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    if (handlers.disabled) return;
    const onKey = (e: KeyboardEvent) => {
      const action = matchShortcut(e.key, {
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        targetTag: (e.target as HTMLElement | null)?.tagName,
      });
      if (!action) return;
      e.preventDefault();
      ({
        approve: handlers.onApprove,
        cancel: handlers.onCancel,
        next: handlers.onNextField,
        prev: handlers.onPrevField,
      })[action]?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}
