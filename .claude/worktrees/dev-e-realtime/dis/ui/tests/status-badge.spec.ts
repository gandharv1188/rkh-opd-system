import { test, expect } from '@playwright/test';
import { COLOUR_MAP, type ExtractionState } from '../src/components/StatusBadge';

test('renders each state with unique colour', () => {
  const states: ExtractionState[] = [
    'uploaded',
    'preprocessing',
    'ocr',
    'structuring',
    'ready_for_review',
    'promoted',
    'rejected',
    'failed',
  ];

  for (const s of states) {
    const spec = COLOUR_MAP[s];
    expect(spec).toBeDefined();
    expect(spec.bg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(spec.fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(spec.label.length).toBeGreaterThan(0);
  }

  // Terminal-error states share a palette; semantic groups must differ from each other.
  expect(COLOUR_MAP.rejected.bg).not.toBe(COLOUR_MAP.promoted.bg);
  expect(COLOUR_MAP.ready_for_review.bg).not.toBe(COLOUR_MAP.promoted.bg);
  expect(COLOUR_MAP.ready_for_review.bg).not.toBe(COLOUR_MAP.rejected.bg);
  expect(COLOUR_MAP.uploaded.bg).not.toBe(COLOUR_MAP.ready_for_review.bg);
  expect(COLOUR_MAP.uploaded.bg).not.toBe(COLOUR_MAP.promoted.bg);
  expect(COLOUR_MAP.uploaded.bg).not.toBe(COLOUR_MAP.rejected.bg);
});
