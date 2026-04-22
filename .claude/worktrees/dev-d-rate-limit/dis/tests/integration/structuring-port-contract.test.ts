/**
 * DIS-072 — Shared StructuringPort contract test suite.
 *
 * Every StructuringPort implementation (real + fake) MUST pass this suite.
 * Mirrors the OcrPort contract (DIS-071): a `factory` builds a fresh adapter
 * per test case; the suite pins the port-level invariants so that new
 * providers (claude-sonnet, claude-opus, onprem) get correctness checks for
 * free.
 *
 * Contract assertions (see TDD §10.1, §11, adapters.md §Ground rules,
 * DIS-051 retry-once-on-schema-invalid):
 *  - Returns `StructuringResult` with the documented shape (provider,
 *    providerVersion, tokensUsed, costMicroINR ≥ 0, latencyMs ≥ 0,
 *    structured, rawResponse).
 *  - `structured` passes the ClinicalExtraction v1 required-keys check
 *    (document_type, summary, labs, medications, diagnoses, vaccinations).
 *  - `rawResponse` is preserved on the result for audit (CS-2 spirit;
 *    structuring doesn't have an exact provider-byte contract but the raw
 *    SDK reply must be present and non-empty).
 *  - Retry-once-on-schema-invalid: when a provider's first reply is not
 *    schema-valid JSON, the adapter retries once and returns the valid
 *    second reply — observable as "two provider calls, one successful
 *    result" (DIS-051).
 */

import { describe, it, expect } from 'vitest';
import type {
  StructuringInput,
  StructuringPort,
  StructuringResult,
} from '../../src/ports/structuring.js';
import { FakeStructuring } from '../../src/core/__fakes__/structuring.js';
import type { SecretsPort } from '../../src/ports/secrets.js';
import type { AnthropicLike } from '../../src/adapters/structuring/claude-haiku.js';
import { ClaudeHaikuAdapter } from '../../src/adapters/structuring/claude-haiku.js';

// -------------------------------------------------------------------------
// Contract suite
// -------------------------------------------------------------------------

export interface StructuringContractFactory {
  /** Build an adapter that succeeds on the first call. */
  happy: () => StructuringPort;
  /**
   * Build an adapter whose first call fails schema validation and whose
   * second call succeeds. If the implementation does not support retry
   * (e.g. fake adapters), return `null` and the suite will skip this case.
   */
  retryOnce: () => StructuringPort | null;
  /**
   * Observe the provider-call count for the most recently built adapter's
   * retryOnce instance. Returns `null` if call-counting is not supported
   * by the factory.
   */
  retryOnceCallCount?: () => number | null;
  name: string;
}

const REQUIRED_TOP_LEVEL = [
  'document_type',
  'summary',
  'labs',
  'medications',
  'diagnoses',
  'vaccinations',
] as const;

const INPUT: StructuringInput = {
  markdown: '# CBC\nHb 12.0 g/dL',
  documentCategory: 'lab_report',
};

export function runStructuringPortContractSuite(factory: StructuringContractFactory): void {
  describe(`StructuringPort contract — ${factory.name}`, () => {
    it('returns a StructuringResult with the documented shape', async () => {
      const adapter = factory.happy();
      const result = await adapter.structure(INPUT);
      assertStructuringResultShape(result);
    });

    it('produces a ClinicalExtraction that satisfies the v1 required keys', async () => {
      const adapter = factory.happy();
      const result = await adapter.structure(INPUT);
      expect(result.structured).toBeTypeOf('object');
      expect(result.structured).not.toBeNull();
      const obj = result.structured as Record<string, unknown>;
      for (const key of REQUIRED_TOP_LEVEL) {
        expect(obj, `missing required top-level key ${key}`).toHaveProperty(key);
      }
    });

    it('preserves rawResponse on the result for audit', async () => {
      const adapter = factory.happy();
      const result = await adapter.structure(INPUT);
      expect(result).toHaveProperty('rawResponse');
      expect(result.rawResponse).toBeDefined();
      expect(result.rawResponse).not.toBeNull();
    });

    it('reports non-negative finite tokensUsed, costMicroINR, latencyMs', async () => {
      const adapter = factory.happy();
      const result = await adapter.structure(INPUT);
      expect(Number.isFinite(result.latencyMs)).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.costMicroINR)).toBe(true);
      expect(result.costMicroINR).toBeGreaterThanOrEqual(0);
      expect(result.tokensUsed.input).toBeGreaterThanOrEqual(0);
      expect(result.tokensUsed.output).toBeGreaterThanOrEqual(0);
    });

    it('retries once and succeeds when first reply is schema-invalid (DIS-051)', async () => {
      const adapter = factory.retryOnce();
      if (!adapter) return; // Not applicable (e.g. FakeStructuring is non-retrying)
      const result = await adapter.structure(INPUT);
      assertStructuringResultShape(result);
      if (factory.retryOnceCallCount) {
        const n = factory.retryOnceCallCount();
        if (n !== null) expect(n).toBe(2);
      }
    });
  });
}

function assertStructuringResultShape(r: StructuringResult): void {
  expect(typeof r.provider).toBe('string');
  expect(r.provider.length).toBeGreaterThan(0);
  expect(typeof r.providerVersion).toBe('string');
  expect(typeof r.costMicroINR).toBe('number');
  expect(typeof r.latencyMs).toBe('number');
  expect(r.tokensUsed).toBeDefined();
  expect(typeof r.tokensUsed.input).toBe('number');
  expect(typeof r.tokensUsed.output).toBe('number');
  expect(r).toHaveProperty('structured');
  expect(r).toHaveProperty('rawResponse');
}

// -------------------------------------------------------------------------
// Registered implementations
// -------------------------------------------------------------------------

function validExtractionJson(): string {
  return JSON.stringify({
    document_type: 'lab_report',
    summary: 'CBC within normal limits',
    document_date: '2026-02-14',
    lab_name: null,
    labs: [
      {
        test_name_raw: 'Hemoglobin',
        test_name_normalized: 'hemoglobin',
        value_text: '12.0',
        value_numeric: 12.0,
        unit: 'g/dL',
        reference_range: '11.5-15.5',
        flag: 'normal',
        test_category: 'Hematology',
        test_date: '2026-02-14',
        confidence: 0.95,
      },
    ],
    medications: [],
    diagnoses: [],
    vaccinations: [],
    clinical_notes: null,
  });
}

// 1. FakeStructuring — canned StructuringResult; no retry seam.
const FAKE_RESULT: StructuringResult = {
  provider: 'claude-haiku',
  providerVersion: 'fake-1',
  rawResponse: { content: [{ type: 'text' as const, text: validExtractionJson() }] },
  structured: JSON.parse(validExtractionJson()) as unknown,
  tokensUsed: { input: 100, output: 50 },
  costMicroINR: 100 * 83 + 50 * 416,
  latencyMs: 42,
};

runStructuringPortContractSuite({
  name: 'FakeStructuring',
  happy: () => new FakeStructuring(FAKE_RESULT),
  retryOnce: () => null, // fake is single-shot; contract test is skipped
});

// 2. ClaudeHaikuAdapter — scripted AnthropicLike client, no network/SDK.
class InlineFakeSecrets implements SecretsPort {
  constructor(private readonly token: string = 'sk-contract-structuring') {}
  async get(_name: string): Promise<string> {
    return this.token;
  }
}

function scriptedFactory(replies: string[]): {
  factory: (apiKey: string) => AnthropicLike;
  callCount: () => number;
} {
  let i = 0;
  const factory = (_apiKey: string): AnthropicLike => ({
    messages: {
      async create(_params: unknown) {
        const text = replies[i] ?? replies[replies.length - 1] ?? '';
        i += 1;
        return {
          content: [{ type: 'text' as const, text }],
          usage: { input_tokens: 120, output_tokens: 60 },
        };
      },
    },
  });
  return { factory, callCount: () => i };
}

let haikuRetryCallCount: () => number = () => 0;

runStructuringPortContractSuite({
  name: 'ClaudeHaikuAdapter',
  happy: () => {
    const { factory } = scriptedFactory([validExtractionJson()]);
    return new ClaudeHaikuAdapter({
      secretsPort: new InlineFakeSecrets(),
      anthropicClientFactory: factory,
    });
  },
  retryOnce: () => {
    const { factory, callCount } = scriptedFactory(['not valid json', validExtractionJson()]);
    haikuRetryCallCount = callCount;
    return new ClaudeHaikuAdapter({
      secretsPort: new InlineFakeSecrets(),
      anthropicClientFactory: factory,
    });
  },
  retryOnceCallCount: () => haikuRetryCallCount(),
});
