/**
 * DIS-071 — Shared OcrPort contract test suite.
 *
 * Every OcrPort implementation (real + fake) MUST pass this suite. The suite
 * is parameterized by a `factory` that returns a pre-wired adapter for each
 * test case: a new factory call per test keeps adapters stateless under the
 * suite and lets implementers inject the seams they need (fake fetch, fake
 * SDK client, fake secrets).
 *
 * Contract assertions (see TDD §9.1, adapters.md §Ground rules):
 *  - Returns OcrResult with the documented shape (provider, providerVersion,
 *    pageCount, latencyMs, rawResponse).
 *  - Preserves `rawResponse` byte-identically for the happy path (CS-2 —
 *    audit/reprocessing requires a verbatim provider response).
 *  - Populates `latencyMs` as a non-negative finite number.
 *  - Surfaces typed errors on provider failure (adapter-specific error classes
 *    are tested at the adapter's own unit-test layer; the contract just
 *    requires "throws a distinguishable Error subclass, not a plain string").
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { OcrInput, OcrPort, OcrResult } from '../../src/ports/ocr.js';
import { FakeOcr } from '../../src/core/__fakes__/ocr.js';
import type { SecretsPort } from '../../src/ports/secrets.js';
import {
  DatalabChandraAdapter,
  OcrProviderError,
} from '../../src/adapters/ocr/datalab-chandra.js';

// -------------------------------------------------------------------------
// Contract suite
// -------------------------------------------------------------------------

export interface OcrContractFactory {
  /** Build a fresh adapter configured to succeed for the happy-path test. */
  happy: () => OcrPort;
  /** Build a fresh adapter configured to fail during extract(). */
  failing: () => OcrPort;
  /** Name used in the describe() block. */
  name: string;
  /**
   * The body that `happy()` is expected to echo into `rawResponse`.
   * Used for the byte-identity check.
   */
  expectedRawResponse: unknown;
}

const PDF_INPUT: OcrInput = {
  pages: [Buffer.from('%PDF-1.4 test', 'utf8')],
  mediaType: 'application/pdf',
  outputFormats: ['markdown', 'json'],
};

export function runOcrPortContractSuite(factory: OcrContractFactory): void {
  describe(`OcrPort contract — ${factory.name}`, () => {
    it('returns an OcrResult with the documented shape', async () => {
      const adapter = factory.happy();
      const result = await adapter.extract(PDF_INPUT);
      assertOcrResultShape(result);
    });

    it('preserves rawResponse byte-identically (CS-2)', async () => {
      const adapter = factory.happy();
      const result = await adapter.extract(PDF_INPUT);
      expect(result.rawResponse).toEqual(factory.expectedRawResponse);
    });

    it('populates latencyMs as a non-negative finite number', async () => {
      const adapter = factory.happy();
      const result = await adapter.extract(PDF_INPUT);
      expect(Number.isFinite(result.latencyMs)).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('throws a typed Error subclass on provider failure', async () => {
      const adapter = factory.failing();
      let caught: unknown;
      try {
        await adapter.extract(PDF_INPUT);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      // Named error classes (not a bare Error / string) — callers branch on
      // `err.name` or `instanceof`.
      expect((caught as Error).name).not.toBe('Error');
      expect((caught as Error).name.length).toBeGreaterThan(0);
    });
  });
}

function assertOcrResultShape(r: OcrResult): void {
  expect(typeof r.provider).toBe('string');
  expect(r.provider.length).toBeGreaterThan(0);
  expect(typeof r.providerVersion).toBe('string');
  expect(typeof r.pageCount).toBe('number');
  expect(r.pageCount).toBeGreaterThanOrEqual(0);
  expect(typeof r.latencyMs).toBe('number');
  // `rawResponse` is deliberately `unknown`; the suite only asserts presence.
  expect(r).toHaveProperty('rawResponse');
}

// -------------------------------------------------------------------------
// Registered implementations — every OcrPort impl we ship re-runs the suite.
// -------------------------------------------------------------------------

// 1. FakeOcr adapter (DIS-012) — canned result.
const FAKE_RESULT: OcrResult = {
  provider: 'datalab',
  providerVersion: 'fake-1',
  rawResponse: { status: 'complete', markdown: '# fake' },
  markdown: '# fake',
  pageCount: 1,
  latencyMs: 5,
};

runOcrPortContractSuite({
  name: 'FakeOcr',
  happy: () => new FakeOcr(FAKE_RESULT),
  failing: () => new FakeOcr(new OcrProviderError('fake provider boom', { provider: 'datalab' })),
  expectedRawResponse: FAKE_RESULT.rawResponse,
});

// 2. DatalabChandraAdapter — injected fetch + fake secrets (no network).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONVERT_RESPONSE = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/datalab/convert-response.json'), 'utf8'),
) as Record<string, unknown>;

class InlineFakeSecrets implements SecretsPort {
  constructor(private readonly token: string = 'sk-contract-test') {}
  async get(_name: string): Promise<string> {
    return this.token;
  }
}

function scriptedFetch(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let i = 0;
  return (async () => {
    if (i >= responses.length) throw new Error('unexpected fetch');
    const r = responses[i++]!;
    const hdrs: Record<string, string> = {};
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: `HTTP ${r.status}`,
      headers: {
        get(name: string) {
          const key = Object.keys(hdrs).find((k) => k.toLowerCase() === name.toLowerCase());
          return key ? hdrs[key]! : null;
        },
      },
      async json() {
        return r.body;
      },
      async text() {
        return JSON.stringify(r.body);
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const happyBody = { status: 'complete', ...CONVERT_RESPONSE };

runOcrPortContractSuite({
  name: 'DatalabChandraAdapter',
  happy: () =>
    new DatalabChandraAdapter({
      secretsPort: new InlineFakeSecrets(),
      fetchImpl: scriptedFetch([{ status: 200, body: happyBody }]),
      sleep: async () => {},
    }),
  failing: () =>
    new DatalabChandraAdapter({
      secretsPort: new InlineFakeSecrets(),
      fetchImpl: scriptedFetch([{ status: 500, body: { error: 'boom' } }]),
      sleep: async () => {},
    }),
  expectedRawResponse: happyBody,
});
