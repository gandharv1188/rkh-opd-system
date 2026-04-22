import { test, expect } from '@playwright/test';

test.describe('E2E reject path', () => {
  test('app shell reachable', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('main-content')).toBeVisible();
  });
});
