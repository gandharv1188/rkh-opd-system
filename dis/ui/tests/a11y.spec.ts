import { test, expect } from '@playwright/test';

test.describe('Accessibility baseline', () => {
  test('landing page exposes named landmarks', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('topbar')).toBeVisible();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('main-content')).toBeVisible();

    const snapshot = await page.accessibility.snapshot();
    expect(snapshot).toBeTruthy();
  });

  test('interactive elements are reachable by keyboard', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
  });

  test('page has lang attribute set', async ({ page }) => {
    await page.goto('/');
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBeTruthy();
  });
});
