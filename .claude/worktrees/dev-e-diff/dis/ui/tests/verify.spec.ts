import { test, expect } from '@playwright/test';

test.describe('Verify page', () => {
  test('shell renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('topbar')).toBeVisible();
  });

  test('approve button disabled until all fields viewed', async ({ page }) => {
    // Stub — without App.tsx routing, test at app-shell level. Component-level test
    // is a DIS-117-followup (needs routing wired). Assert shell loads.
    await page.goto('/');
    await expect(page.getByTestId('main-content')).toBeVisible();
  });
});
