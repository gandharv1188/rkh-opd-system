import { describe, it, expect } from 'vitest';
import { isApproveBlocked } from '../src/components/DuplicateBanner';

describe('DuplicateBanner (CS-4)', () => {
  it('approve blocked until override', () => {
    expect(isApproveBlocked('ext-1', false)).toBe(true);
    expect(isApproveBlocked('ext-1', true)).toBe(false);
    expect(isApproveBlocked(null, false)).toBe(false);
  });
});
