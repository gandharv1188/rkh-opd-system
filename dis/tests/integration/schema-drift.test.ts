/**
 * DIS-044 — ClinicalExtraction schema integration (drift detection).
 *
 * A scripted Anthropic client drives the ClaudeHaikuAdapter to return a
 * malformed `ClinicalExtraction` (missing required `document_type`).
 * The DIS-051 retry-once contract lives inside the adapter itself: on
 * first failure, the adapter re-prompts with a stricter cue; on a
 * second failure, it surfaces `StructuringSchemaInvalidError`.
 *
 * ADAPTATION (per Wave-2b brief §3): the retry-once loop is owned by
 * the structuring adapter (see `dis/src/adapters/structuring/claude-haiku.ts`
 * lines 99-129), not the orchestrator. Our `FakeStructuringAdapter`
 * resolves a single scripted result per call and therefore cannot model
 * retry on its own — so we drive the real adapter with a scripted
 * AnthropicLike client. This still validates the full drift-detection
 * path (prompt → model → validator → retry → final error) without any
 * live Claude call.
 *
 * This test also directly exercises `validateExtraction` (DIS-030) on
 * the malformed payload to pin the behavior of the schema-drift
 * detector that the adapter relies on.
 */

import { describe, expect, it } from 'vitest';
import {
  ClaudeHaikuAdapter,
  StructuringSchemaInvalidError,
  type AnthropicLike,
} from '../../src/adapters/structuring/claude-haiku.js';
import type { SecretsPort } from '../../src/ports/secrets.js';
import type { StructuringInput } from '../../src/ports/structuring.js';
import { validateExtraction } from '../../src/core/validate-extraction.js';

function fakeSecrets(): SecretsPort {
  return {
    async get(name: string): Promise<string> {
      if (name !== 'ANTHROPIC_API_KEY') throw new Error(`missing ${name}`);
      return 'test-key';
    },
  };
}

/** ClinicalExtraction with `document_type` removed — valid shape otherwise. */
function malformedExtractionMissingDocumentType(): string {
  return JSON.stringify({
    summary: 'labs within range',
    document_date: '2026-02-14',
    lab_name: null,
    labs: [],
    medications: [],
    diagnoses: [],
    vaccinations: [],
    clinical_notes: null,
  });
}

/** Script an AnthropicLike client and record every call. */
function scriptedClient(responses: readonly string[]): {
  factory: (key: string) => AnthropicLike;
  calls: Array<{ messages: Array<{ role: string; content: string }> }>;
} {
  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  let i = 0;
  const factory = (_key: string): AnthropicLike => ({
    messages: {
      async create(params: unknown) {
        const p = params as { messages: Array<{ role: string; content: string }> };
        calls.push({ messages: p.messages });
        const text = responses[i] ?? responses[responses.length - 1] ?? '';
        i += 1;
        return {
          content: [{ type: 'text' as const, text }],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    },
  });
  return { factory, calls };
}

const baseInput: StructuringInput = {
  markdown: '# CBC\nHb 12.0 g/dL',
  documentCategory: 'lab_report',
};

describe('schema drift (integration)', () => {
  it('validateExtraction catches the drift on the malformed payload', () => {
    const obj = JSON.parse(malformedExtractionMissingDocumentType()) as unknown;
    const res = validateExtraction(obj);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.join(' ')).toMatch(/document_type/i);
    }
  });

  it('retries exactly once on drift, then throws StructuringSchemaInvalidError', async () => {
    const drift = malformedExtractionMissingDocumentType();
    const { factory, calls } = scriptedClient([drift, drift]);
    const adapter = new ClaudeHaikuAdapter({
      secretsPort: fakeSecrets(),
      anthropicClientFactory: factory,
    });

    let thrown: unknown;
    try {
      await adapter.structure(baseInput);
    } catch (err) {
      thrown = err;
    }

    // Retry-once contract: exactly 2 adapter calls to the upstream model.
    expect(calls).toHaveLength(2);

    // Second call carries the stricter re-prompt cue.
    const secondJoined = calls[1]!.messages.map((m) => m.content).join('\n').toLowerCase();
    expect(secondJoined).toMatch(/json|schema|strict/);

    // Final error is StructuringSchemaInvalidError with attempts=2.
    expect(thrown).toBeInstanceOf(StructuringSchemaInvalidError);
    const err = thrown as StructuringSchemaInvalidError;
    expect(err.attempts).toBe(2);
    expect(err.name).toBe('StructuringSchemaInvalidError');
  });

  it('recovers on retry when the second response is valid (drift → corrected)', async () => {
    const valid = JSON.stringify({
      document_type: 'lab_report',
      summary: 'ok',
      document_date: null,
      lab_name: null,
      labs: [],
      medications: [],
      diagnoses: [],
      vaccinations: [],
      clinical_notes: null,
    });
    const { factory, calls } = scriptedClient([
      malformedExtractionMissingDocumentType(),
      valid,
    ]);
    const adapter = new ClaudeHaikuAdapter({
      secretsPort: fakeSecrets(),
      anthropicClientFactory: factory,
    });

    const result = await adapter.structure(baseInput);
    expect(calls).toHaveLength(2);
    expect(result.structured).toMatchObject({ document_type: 'lab_report' });
  });
});
