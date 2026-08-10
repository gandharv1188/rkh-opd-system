import { test, expect } from '@playwright/test';

test.describe('E2E duplicate override', () => {
  test('app shell reachable with kill-switch off', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('topbar')).toBeVisible();
  });
});
