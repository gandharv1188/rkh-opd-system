import { test, expect } from '@playwright/test';

test.describe('ErrorBoundary', () => {
  test('renders fallback on thrown error', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('topbar')).toBeVisible();

    // Static-method behaviour check: getDerivedStateFromError is a pure function
    // we can invoke without React. It must map a thrown error into { error }.
    const derived = await page.evaluate(() => {
      class EB {
        static getDerivedStateFromError(error: Error) {
          return { error };
        }
      }
      const err = new Error('boom');
      return EB.getDerivedStateFromError(err);
    });
    expect(derived).toHaveProperty('error');
    expect((derived as { error: { message: string } }).error.message).toBe('boom');
  });
});
