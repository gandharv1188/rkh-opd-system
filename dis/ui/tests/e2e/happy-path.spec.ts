import { test, expect } from '@playwright/test';

test.describe('E2E happy path', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/extractions*', async (route) => {
      await route.fulfill({ json: { items: [], next_cursor: null } });
    });
  });

  test('app loads with topbar, sidebar, main content', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('topbar')).toBeVisible();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('main-content')).toBeVisible();
  });
});
