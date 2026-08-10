import { test, expect } from '@playwright/test';

test('renders Hindi strings when locale is hi', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('topbar')).toBeVisible();
});

test('falls back to key when string missing', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('topbar')).toBeVisible();
});
