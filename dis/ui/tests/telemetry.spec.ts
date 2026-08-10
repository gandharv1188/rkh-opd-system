import { test, expect } from '@playwright/test';
import {
  startVerifyTimer,
  stopVerifyTimer,
  __resetTimers,
} from '../src/state/telemetry';

test.describe('telemetry', () => {
  test.beforeEach(() => {
    __resetTimers();
  });

  test('measures duration between start and stop', () => {
    let clock = 1_000_000;
    const now = () => clock;
    startVerifyTimer('ext-1', now);
    clock += 5000;
    const d = stopVerifyTimer('ext-1', 'approved', now);
    expect(d).toBeTruthy();
    expect(d!.duration_ms).toBe(5000);
    expect(d!.outcome).toBe('approved');
    expect(d!.started_at).toBe(1_000_000);
    expect(d!.ended_at).toBe(1_005_000);
    expect(d!.extraction_id).toBe('ext-1');
  });

  test('returns null if no timer was started', () => {
    expect(stopVerifyTimer('unknown', 'approved')).toBeNull();
  });

  test('clears timer after stop so subsequent stop returns null', () => {
    startVerifyTimer('ext-2');
    stopVerifyTimer('ext-2', 'approved');
    expect(stopVerifyTimer('ext-2', 'approved')).toBeNull();
  });

  test('supports rejected and abandoned outcomes', () => {
    startVerifyTimer('ext-3');
    const r = stopVerifyTimer('ext-3', 'rejected');
    expect(r?.outcome).toBe('rejected');

    startVerifyTimer('ext-4');
    const a = stopVerifyTimer('ext-4', 'abandoned');
    expect(a?.outcome).toBe('abandoned');
  });
});
