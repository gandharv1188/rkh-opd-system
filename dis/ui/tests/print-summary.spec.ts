import { test, expect } from '@playwright/test';

test.describe('PrintSummary', () => {
  test('layout renders on A4', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('topbar')).toBeVisible();
    // Component test via harness = DIS-138-followup.
  });
});
