import { describe, it, expect, beforeEach } from 'vitest';
import { QueueDepthAlerter } from '../../src/observability/alerts.js';

describe('QueueDepthAlerter', () => {
  let clock = 1_000_000;
  const now = () => clock;
  const fetchCalls: Array<{ url: string; body: string }> = [];
  const fetchFn: typeof fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), body: String((init as RequestInit).body) });
    return new Response('', { status: 200 });
  };

  beforeEach(() => { clock = 1_000_000; fetchCalls.length = 0; });

  function makeAlerter() {
    return new QueueDepthAlerter({
      threshold: 20, sustainedMs: 5 * 60 * 1000, cooldownMs: 10 * 60 * 1000,
      webhookUrl: 'https://hook.test/a', now, fetchFn,
    });
  }

  it('fires only after sustained breach', async () => {
    const a = makeAlerter();
    expect(await a.observe(25)).toBe('armed');
    clock += 3 * 60 * 1000;
    expect(await a.observe(25)).toBe('armed');
    clock += 3 * 60 * 1000;
    expect(await a.observe(25)).toBe('fired');
    expect(fetchCalls).toHaveLength(1);
  });

  it('does not re-alert within cooldown', async () => {
    const a = makeAlerter();
    await a.observe(25);
    clock += 6 * 60 * 1000;
    await a.observe(25);
    clock += 1000;
    expect(await a.observe(25)).toBe('noop');
  });

  it('resets on dip below threshold', async () => {
    const a = makeAlerter();
    await a.observe(25);  clock += 60_000;
    expect(await a.observe(15)).toBe('noop');
  });
});
