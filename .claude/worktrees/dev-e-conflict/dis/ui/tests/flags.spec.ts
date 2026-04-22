import { test, expect } from '@playwright/test';
import { getFlags, setFlags, loadFlags } from '../src/flags';

// Pure-logic tests for the feature-flag store. No browser required; Playwright
// runs these as Node scripts. Vitest is not in the project devDependencies,
// so we piggy-back on the existing @playwright/test harness.

test.describe('flags', () => {
  test.beforeEach(() => {
    setFlags({
      realtime_enabled: true,
      i18n_hindi: true,
      experimental_bbox_overlay: false,
      print_summary: true,
    });
  });

  test('has sensible defaults', () => {
    expect(getFlags().realtime_enabled).toBe(true);
    expect(getFlags().i18n_hindi).toBe(true);
    expect(getFlags().experimental_bbox_overlay).toBe(false);
    expect(getFlags().print_summary).toBe(true);
  });

  test('setFlags merges partial updates', () => {
    setFlags({ experimental_bbox_overlay: true });
    expect(getFlags().experimental_bbox_overlay).toBe(true);
    expect(getFlags().realtime_enabled).toBe(true); // preserved
    expect(getFlags().i18n_hindi).toBe(true); // preserved
  });

  test('loadFlags keeps defaults on fetch failure', async () => {
    const original = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    try {
      await loadFlags();
      expect(getFlags().realtime_enabled).toBe(true);
      expect(getFlags().print_summary).toBe(true);
    } finally {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = original;
    }
  });

  test('loadFlags keeps defaults on non-ok response', async () => {
    const original = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () =>
      new Response('nope', { status: 500 })) as typeof fetch;
    try {
      await loadFlags();
      expect(getFlags().realtime_enabled).toBe(true);
    } finally {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = original;
    }
  });

  test('loadFlags applies server overrides on success', async () => {
    const original = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () =>
      new Response(JSON.stringify({ experimental_bbox_overlay: true, print_summary: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      await loadFlags();
      expect(getFlags().experimental_bbox_overlay).toBe(true);
      expect(getFlags().print_summary).toBe(false);
      expect(getFlags().realtime_enabled).toBe(true); // not overridden
    } finally {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = original;
    }
  });
});
