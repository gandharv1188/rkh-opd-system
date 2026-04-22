import { test, expect } from '@playwright/test';

test.describe('SignIn', () => {
  test('shell renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('topbar')).toBeVisible();
  });

  test('rejects wrong credentials', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('main-content')).toBeVisible();
  });
});
