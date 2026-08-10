import { test, expect } from '@playwright/test';

test('app shell renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('topbar')).toBeVisible();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('main-content')).toBeVisible();
});
