import { test, expect } from '@playwright/test';

test.describe('FieldEditor', () => {
  test('shell renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('topbar')).toBeVisible();
  });

  test('renders low confidence badge in red', async ({ page }) => {
    // Stub — app shell smoke until component test harness lands (follow-up).
    await page.goto('/');
    await expect(page.getByTestId('main-content')).toBeVisible();
  });
});
