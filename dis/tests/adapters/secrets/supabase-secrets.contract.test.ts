import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SupabaseSecretsAdapter,
  SecretNotFoundError,
} from '../../../src/adapters/secrets/supabase-secrets.js';
import type { SecretsPort } from '../../../src/ports/secrets.js';

type FetchCall = { url: string; init: RequestInit | undefined };

function scriptedFetch(responses: Array<{ status: number; body: unknown }>): {
  fn: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let i = 0;
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    if (i >= responses.length) {
      throw new Error(`Unexpected fetch #${i + 1} to ${url}`);
    }
    const r = responses[i++]!;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: `HTTP ${r.status}`,
      async json() {
        return r.body;
      },
      async text() {
        return typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const BASE_URL = 'https://project.supabase.co';
const SERVICE_ROLE_KEY = 'sk-service-role-xyz';

describe('SupabaseSecretsAdapter — SecretsPort contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('binds to SecretsPort (structural)', () => {
    const { fn } = scriptedFetch([]);
    const adapter: SecretsPort = new SupabaseSecretsAdapter({
      supabaseUrl: BASE_URL,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: fn,
    });
    expect(typeof adapter.get).toBe('function');
  });

  it('fetches from Supabase Vault on first call and returns the value', async () => {
    const { fn, calls } = scriptedFetch([
      { status: 200, body: [{ name: 'ANTHROPIC_API_KEY', secret: 'sk-anth-live' }] },
    ]);
    const adapter = new SupabaseSecretsAdapter({
      supabaseUrl: BASE_URL,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: fn,
    });

    const v = await adapter.get('ANTHROPIC_API_KEY');

    expect(v).toBe('sk-anth-live');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('ANTHROPIC_API_KEY');
    const hdrs = calls[0]!.init!.headers as Record<string, string>;
    expect(hdrs['apikey']).toBe(SERVICE_ROLE_KEY);
    expect(hdrs['Authorization']).toBe(`Bearer ${SERVICE_ROLE_KEY}`);
  });

  it('cache hit within 5 minutes — no second network call', async () => {
    const { fn, calls } = scriptedFetch([
      { status: 200, body: [{ name: 'FOO', secret: 'bar' }] },
    ]);
    const adapter = new SupabaseSecretsAdapter({
      supabaseUrl: BASE_URL,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: fn,
    });

    const a = await adapter.get('FOO');
    vi.advanceTimersByTime(4 * 60 * 1000);
    const b = await adapter.get('FOO');

    expect(a).toBe('bar');
    expect(b).toBe('bar');
    expect(calls).toHaveLength(1);
  });

  it('cache expires after 5 minutes — refetches', async () => {
    const { fn, calls } = scriptedFetch([
      { status: 200, body: [{ name: 'FOO', secret: 'v1' }] },
      { status: 200, body: [{ name: 'FOO', secret: 'v2' }] },
    ]);
    const adapter = new SupabaseSecretsAdapter({
      supabaseUrl: BASE_URL,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: fn,
    });

    const a = await adapter.get('FOO');
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const b = await adapter.get('FOO');

    expect(a).toBe('v1');
    expect(b).toBe('v2');
    expect(calls).toHaveLength(2);
  });

  it('throws SecretNotFoundError when the vault returns an empty array', async () => {
    const { fn } = scriptedFetch([{ status: 200, body: [] }]);
    const adapter = new SupabaseSecretsAdapter({
      supabaseUrl: BASE_URL,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: fn,
    });

    await expect(adapter.get('MISSING')).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it('throws SecretNotFoundError on HTTP 404', async () => {
    const { fn } = scriptedFetch([{ status: 404, body: { message: 'not found' } }]);
    const adapter = new SupabaseSecretsAdapter({
      supabaseUrl: BASE_URL,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: fn,
    });

    await expect(adapter.get('MISSING')).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it('bubbles non-404 HTTP errors as Error (not cached)', async () => {
    const { fn, calls } = scriptedFetch([
      { status: 500, body: { message: 'server boom' } },
      { status: 200, body: [{ name: 'FOO', secret: 'recovered' }] },
    ]);
    const adapter = new SupabaseSecretsAdapter({
      supabaseUrl: BASE_URL,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: fn,
    });

    await expect(adapter.get('FOO')).rejects.toThrow(/500|server/i);
    const v = await adapter.get('FOO');
    expect(v).toBe('recovered');
    expect(calls).toHaveLength(2);
  });

  it('falls back to process.env when no Supabase URL is configured', async () => {
    const original = process.env.DIS_TEST_SECRET;
    process.env.DIS_TEST_SECRET = 'from-env';
    try {
      const adapter = new SupabaseSecretsAdapter({});
      const v = await adapter.get('DIS_TEST_SECRET');
      expect(v).toBe('from-env');
    } finally {
      if (original === undefined) delete process.env.DIS_TEST_SECRET;
      else process.env.DIS_TEST_SECRET = original;
    }
  });

  it('env fallback throws SecretNotFoundError when unset', async () => {
    const adapter = new SupabaseSecretsAdapter({});
    const name = 'DIS_TEST_UNSET_' + Math.random().toString(36).slice(2, 8);
    await expect(adapter.get(name)).rejects.toBeInstanceOf(SecretNotFoundError);
  });
});
