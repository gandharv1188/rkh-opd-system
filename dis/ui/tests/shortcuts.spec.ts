import { test, expect } from '@playwright/test';
import { matchShortcut } from '../src/hooks/useShortcuts';

test.describe('useShortcuts', () => {
  test('N advances focus to next field', () => {
    expect(matchShortcut('n')).toBe('next');
    expect(matchShortcut('N')).toBe('next');
  });

  test('suppressed while typing in input', () => {
    expect(matchShortcut('Enter', { targetTag: 'INPUT' })).toBeNull();
    expect(matchShortcut('Enter', { targetTag: 'DIV' })).toBe('approve');
  });

  test('ignores modifier combinations', () => {
    expect(matchShortcut('Enter', { ctrlKey: true })).toBeNull();
  });

  test('Enter=approve, Escape=cancel, P=prev', () => {
    expect(matchShortcut('Enter')).toBe('approve');
    expect(matchShortcut('Escape')).toBe('cancel');
    expect(matchShortcut('p')).toBe('prev');
    expect(matchShortcut('P')).toBe('prev');
  });
});
