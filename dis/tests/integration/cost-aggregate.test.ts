/**
 * DIS-045 — Cost calculator integration (per-run aggregate).
 *
 * Drives a single orchestrator run through the OCR-scan pipeline with
 * scripted fake adapters that report deterministic `pageCount` and
 * `tokensUsed` values. After the run we aggregate the fake adapters'
 * recorded invocations through `calculateCost(...)` and assert:
 *   - one `CostBreakdown` is produced with both OCR and LLM line items,
 *   - `total_micro_inr == input_cost + output_cost + ocr_cost`.
 *
 * Persistence of cost (DIS-149 — cost ledger) is explicitly out of
 * scope; here we only verify the sum invariant.
 */

import { describe, expect, it } from 'vitest';
import {
  FakeDatabaseAdapter,
  FakeFileRouterAdapter,
  FakeOcrAdapter,
  FakePreprocessorAdapter,
  FakeQueueAdapter,
  FakeSecretsAdapter,
  FakeStorageAdapter,
  FakeStructuringAdapter,
} from '../helpers/fake-adapters.js';
import { IngestionOrchestrator } from '../../src/core/orchestrator.js';
import { calculateCost, type CostBreakdown, type RateTable } from '../../src/core/cost-calculator.js';
import type { OcrResult } from '../../src/ports/ocr.js';
import type { StructuringResult } from '../../src/ports/structuring.js';

const RATES: RateTable = {
  haiku: { inputPerToken: 83, outputPerToken: 416 },
  sonnet: { inputPerToken: 415, outputPerToken: 2080 },
  datalab: { perPage: 3000 },
  'datalab+haiku': { inputPerToken: 83, outputPerToken: 416, perPage: 3000 },
};

const OCR_PAGES = 3;
const OCR_INPUT_TOKENS = 200;
const OCR_OUTPUT_TOKENS = 50;
const LLM_INPUT_TOKENS = 1200;
const LLM_OUTPUT_TOKENS = 350;

function buildOcrResult(): OcrResult {
  return {
    provider: 'datalab',
    providerVersion: 'chandra-v1',
    rawResponse: { ok: true },
    markdown: '# doc',
    pageCount: OCR_PAGES,
    tokensUsed: { input: OCR_INPUT_TOKENS, output: OCR_OUTPUT_TOKENS },
    latencyMs: 10,
  };
}

function buildStructuringResult(): StructuringResult {
  return {
    provider: 'claude-haiku',
    providerVersion: 'haiku-4.5',
    rawResponse: { ok: true },
    structured: { document_type: 'lab_report' },
    tokensUsed: { input: LLM_INPUT_TOKENS, output: LLM_OUTPUT_TOKENS },
    costMicroINR: 0,
    latencyMs: 20,
  };
}

describe('cost aggregate (integration)', () => {
  it('produces one CostBreakdown with OCR + LLM line items; sum matches micro-INR total', async () => {
    const ocrResult = buildOcrResult();
    const structuringResult = buildStructuringResult();

    const ocr = new FakeOcrAdapter({
      [`pages:1/image/jpeg`]: { success: ocrResult },
    });
    const structuring = new FakeStructuringAdapter({
      generic: { success: structuringResult },
    });
    const fileRouter = new FakeFileRouterAdapter({
      // orchestrator.process() calls route({ filename: '' }) — script it by that key.
      '': { success: { kind: 'ocr_scan', pageCount: OCR_PAGES } },
    });
    const storage = new FakeStorageAdapter();
    const db = new FakeDatabaseAdapter();
    const queue = new FakeQueueAdapter();
    const secrets = new FakeSecretsAdapter({ ANTHROPIC_API_KEY: { success: 'test-key' } });
    const preprocessor = new FakePreprocessorAdapter();

    const orch = new IngestionOrchestrator({
      db,
      storage,
      queue,
      secrets,
      fileRouter,
      preprocessor,
      ocr,
      structuring,
    });

    const ingested = await orch.ingest({
      patientId: 'pat-1',
      idempotencyKey: 'idem-1',
      filename: 'scan.jpg',
      contentType: 'image/jpeg',
      body: Buffer.from('raw'),
    });

    await orch.process(ingested.id);

    // Exactly one OCR invocation and one structuring invocation.
    expect(ocr.calls).toHaveLength(1);
    expect(structuring.calls).toHaveLength(1);

    // Aggregate cost across OCR + LLM using the scripted result records.
    const ocrCost = calculateCost(
      {
        input_tokens: 0,
        output_tokens: 0,
        pages: ocrResult.pageCount,
        provider: 'datalab',
      },
      RATES,
    );
    const llmCost = calculateCost(
      {
        input_tokens: structuringResult.tokensUsed.input,
        output_tokens: structuringResult.tokensUsed.output,
        pages: 0,
        provider: 'haiku',
      },
      RATES,
    );

    const aggregate: CostBreakdown = {
      input_tokens: ocrCost.input_tokens + llmCost.input_tokens,
      output_tokens: ocrCost.output_tokens + llmCost.output_tokens,
      pages: ocrCost.pages + llmCost.pages,
      input_cost_micro_inr: ocrCost.input_cost_micro_inr + llmCost.input_cost_micro_inr,
      output_cost_micro_inr: ocrCost.output_cost_micro_inr + llmCost.output_cost_micro_inr,
      ocr_cost_micro_inr: ocrCost.ocr_cost_micro_inr + llmCost.ocr_cost_micro_inr,
      total_micro_inr: ocrCost.total_micro_inr + llmCost.total_micro_inr,
    };

    // OCR + LLM line items are both present (non-zero).
    expect(aggregate.ocr_cost_micro_inr).toBeGreaterThan(0);
    expect(aggregate.input_cost_micro_inr).toBeGreaterThan(0);
    expect(aggregate.output_cost_micro_inr).toBeGreaterThan(0);

    // Sum invariant: total == input + output + OCR.
    expect(aggregate.total_micro_inr).toBe(
      aggregate.input_cost_micro_inr +
        aggregate.output_cost_micro_inr +
        aggregate.ocr_cost_micro_inr,
    );

    // Matches hand-computed expected total from the fixed rates.
    const expected =
      OCR_PAGES * RATES.datalab.perPage +
      LLM_INPUT_TOKENS * RATES.haiku.inputPerToken +
      LLM_OUTPUT_TOKENS * RATES.haiku.outputPerToken;
    expect(aggregate.total_micro_inr).toBe(expected);
  });

  it('CostBreakdown line items are additive across providers', () => {
    const a = calculateCost(
      { input_tokens: 100, output_tokens: 50, pages: 0, provider: 'haiku' },
      RATES,
    );
    const b = calculateCost(
      { input_tokens: 0, output_tokens: 0, pages: 2, provider: 'datalab' },
      RATES,
    );
    expect(a.total_micro_inr).toBe(100 * 83 + 50 * 416);
    expect(b.total_micro_inr).toBe(2 * 3000);
    expect(a.total_micro_inr + b.total_micro_inr).toBe(100 * 83 + 50 * 416 + 2 * 3000);
  });
});
