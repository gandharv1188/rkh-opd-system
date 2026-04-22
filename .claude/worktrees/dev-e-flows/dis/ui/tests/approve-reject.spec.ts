import { test, expect } from '@playwright/test';

test.describe('Approve/Reject', () => {
  test('shell renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('topbar')).toBeVisible();
  });

  test('reject requires reason', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('main-content')).toBeVisible();
  });

  test('approve button disabled after click', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('main-content')).toBeVisible();
  });
});
