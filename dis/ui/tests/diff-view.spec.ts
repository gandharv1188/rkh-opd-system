import { test, expect } from '@playwright/test';
import { classifyDiff } from '../src/components/DiffView';

test('renders diff with added + removed markers', () => {
  expect(classifyDiff('', 'new')).toBe('added');
  expect(classifyDiff('old', '')).toBe('removed');
  expect(classifyDiff('a', 'b')).toBe('changed');
  expect(classifyDiff('same', 'same')).toBe('unchanged');
});
