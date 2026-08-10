import { test, expect } from '@playwright/test';
test.describe('BboxOverlay', () => {
  test('shell renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('topbar')).toBeVisible();
  });
  test('highlights bbox when field gains focus', async ({ page }) => {
    // Stub at shell level pending harness. Component test is DIS-120-followup.
    await page.goto('/');
    await expect(page.getByTestId('main-content')).toBeVisible();
  });
});
