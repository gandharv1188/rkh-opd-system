import { test, expect } from '@playwright/test';
import { shouldShowWarning } from '../src/components/SessionBanner';

test.describe('SessionBanner', () => {
  test('appears at T-minus-2m', () => {
    const now = 1_000_000;
    const expires = now + 90_000; // 1.5 min away
    const warnMs = 2 * 60 * 1000; // 2 min
    expect(shouldShowWarning(now, expires, warnMs)).toBe(true);
  });

  test('hidden outside warning window', () => {
    const now = 1_000_000;
    const expires = now + 5 * 60 * 1000; // 5 min away
    expect(shouldShowWarning(now, expires, 2 * 60 * 1000)).toBe(false);
  });

  test('hidden when already expired', () => {
    const now = 1_000_000;
    const expires = now - 1000;
    expect(shouldShowWarning(now, expires, 2 * 60 * 1000)).toBe(false);
  });
});
