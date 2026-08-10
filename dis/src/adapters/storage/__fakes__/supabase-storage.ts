/**
 * Test helpers for SupabaseStorageAdapter.
 *
 * Provides an in-memory SecretsPort and a fetch-mock builder that records
 * every call and returns scripted responses keyed by `${method} ${url}`.
 */

import type { SecretsPort } from '../../../ports/secrets.js';

export class FakeSecrets implements SecretsPort {
  private readonly values: Map<string, string>;

  constructor(values: Record<string, string>) {
    this.values = new Map(Object.entries(values));
  }

  async get(name: string): Promise<string> {
    const v = this.values.get(name);
    if (v === undefined) {
      throw new Error(`secret not set: ${name}`);
    }
    return v;
  }
}

export interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Buffer | undefined;
}

export interface ScriptedResponse {
  readonly status: number;
  readonly body?: string | Buffer;
  readonly headers?: Readonly<Record<string, string>>;
}

export function createFetchMock(script: ReadonlyMap<string, ScriptedResponse>): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    const hdrInit = init?.headers;
    if (hdrInit) {
      if (hdrInit instanceof Headers) {
        hdrInit.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(hdrInit)) {
        for (const [k, v] of hdrInit) {
          headers[k] = v;
        }
      } else {
        for (const [k, v] of Object.entries(hdrInit as Record<string, string>)) {
          headers[k] = v;
        }
      }
    }
    const bodyInit = init?.body;
    let body: string | Buffer | undefined;
    if (typeof bodyInit === 'string') body = bodyInit;
    else if (bodyInit instanceof Uint8Array) body = Buffer.from(bodyInit);
    else body = undefined;

    calls.push({ method, url, headers, body });

    const key = `${method} ${url}`;
    const scripted = script.get(key);
    if (!scripted) {
      throw new Error(`no scripted response for ${key}`);
    }
    const respBody = scripted.body ?? '';
    const buf = typeof respBody === 'string' ? Buffer.from(respBody) : respBody;
    const bodyView = new Uint8Array(
      buf.buffer,
      buf.byteOffset,
      buf.byteLength,
    ) as unknown as BodyInit;
    return new Response(bodyView, {
      status: scripted.status,
      headers: scripted.headers,
    });
  };
  return { fetchImpl, calls };
}
