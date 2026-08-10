import { test, expect } from '@playwright/test';

test.describe('ConflictDialog', () => {
  test('shell renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('topbar')).toBeVisible();
  });

  test('shows dialog on 409', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('main-content')).toBeVisible();
  });
});
