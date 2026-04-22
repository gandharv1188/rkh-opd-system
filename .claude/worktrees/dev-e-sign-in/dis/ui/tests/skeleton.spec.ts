import { test, expect } from '@playwright/test';

// Fallback Playwright test — vitest/DOM harness not available in this workspace.
// Skeleton component is type-checked via `npm run typecheck` (VERIFY-2).
// This test confirms the app shell still renders so the bundle compiles.
test('app shell renders (skeleton bundle smoke)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('topbar')).toBeVisible();
  await expect(page.getByTestId('main-content')).toBeVisible();
});
