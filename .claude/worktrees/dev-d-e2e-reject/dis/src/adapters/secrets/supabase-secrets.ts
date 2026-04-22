/**
 * SupabaseSecretsAdapter — implements {@link SecretsPort} with a 5-minute
 * in-memory cache. Resolves secrets from Supabase Vault via the service-role
 * REST surface, falling back to `process.env` when Supabase is not configured
 * (tests, local dev, Edge-Function contexts where secrets arrive as env).
 *
 * Caching bounds blast radius on rotation (portability.md §Secrets): a rotated
 * secret takes ≤ 5 minutes to propagate without per-call round-trips.
 *
 * @see TDD §16 (Secrets)
 * @see portability.md §Secrets portability
 */

import type { SecretsPort } from '../../ports/secrets.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const VAULT_TABLE = 'decrypted_secrets';

/**
 * Thrown when a named secret is not configured in either the vault or env.
 * Callers treat this as terminal — misconfiguration, not a transient fault.
 */
export class SecretNotFoundError extends Error {
  public override readonly name = 'SecretNotFoundError';
  public constructor(public readonly secretName: string) {
    super(`secret not found: ${secretName}`);
  }
}

type NowFn = () => number;

export interface SupabaseSecretsAdapterOptions {
  /** Supabase project URL, e.g. https://<ref>.supabase.co. Omit for env-only. */
  readonly supabaseUrl?: string;
  /** Service-role key with vault read access. Omit for env-only. */
  readonly serviceRoleKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: NowFn;
  /** Cache TTL in ms. Default 5 minutes per portability.md §Secrets. */
  readonly ttlMs?: number;
  /** Env lookup seam for tests. Default: `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

type CacheEntry = { readonly value: string; readonly expiresAt: number };

export class SupabaseSecretsAdapter implements SecretsPort {
  private readonly supabaseUrl: string | undefined;
  private readonly serviceRoleKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: NowFn;
  private readonly ttlMs: number;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly cache = new Map<string, CacheEntry>();

  public constructor(opts: SupabaseSecretsAdapterOptions) {
    this.supabaseUrl = opts.supabaseUrl;
    this.serviceRoleKey = opts.serviceRoleKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.env = opts.env ?? process.env;
  }

  public async get(name: string): Promise<string> {
    const hit = this.cache.get(name);
    if (hit && hit.expiresAt > this.now()) {
      return hit.value;
    }

    const value = await this.resolve(name);
    this.cache.set(name, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }

  private async resolve(name: string): Promise<string> {
    if (this.supabaseUrl && this.serviceRoleKey) {
      return this.fetchFromVault(name);
    }
    const envValue = this.env[name];
    if (envValue === undefined || envValue === '') {
      throw new SecretNotFoundError(name);
    }
    return envValue;
  }

  private async fetchFromVault(name: string): Promise<string> {
    // PostgREST view query: select the secret by name. Using Vault's
    // `decrypted_secrets` view keeps the call parameterised via query string
    // with PostgREST's eq.<value> syntax — no SQL injection surface because
    // PostgREST URL-decodes and binds the value.
    const encoded = encodeURIComponent(name);
    const url = `${this.supabaseUrl}/rest/v1/${VAULT_TABLE}?name=eq.${encoded}&select=name,secret`;
    const resp = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        apikey: this.serviceRoleKey!,
        Authorization: `Bearer ${this.serviceRoleKey!}`,
        Accept: 'application/json',
      },
    });

    if (resp.status === 404) {
      throw new SecretNotFoundError(name);
    }
    if (!resp.ok) {
      const body = await safeText(resp);
      throw new Error(`SupabaseSecretsAdapter: vault fetch for "${name}" failed with HTTP ${resp.status}${body ? ` — ${body}` : ''}`);
    }

    const rows = (await resp.json()) as Array<{ name?: string; secret?: string }>;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row || typeof row.secret !== 'string' || row.secret.length === 0) {
      throw new SecretNotFoundError(name);
    }
    return row.secret;
  }
}

async function safeText(resp: Response): Promise<string | undefined> {
  try {
    return await resp.text();
  } catch {
    return undefined;
  }
}
