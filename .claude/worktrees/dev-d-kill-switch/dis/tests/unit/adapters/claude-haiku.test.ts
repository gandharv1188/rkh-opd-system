import { describe, it, expect } from 'vitest';
import {
  ClaudeHaikuAdapter,
  StructuringSchemaInvalidError,
  type AnthropicLike,
} from '../../../src/adapters/structuring/claude-haiku.js';
import type { SecretsPort } from '../../../src/ports/secrets.js';
import type { StructuringInput } from '../../../src/ports/structuring.js';

function fakeSecrets(
  map: Record<string, string> = { ANTHROPIC_API_KEY: 'test-key' },
): SecretsPort & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async get(name: string): Promise<string> {
      calls.push(name);
      const v = map[name];
      if (v === undefined) throw new Error(`missing secret ${name}`);
      return v;
    },
  };
}

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

function makeReply(text: string, usage = { input_tokens: 100, output_tokens: 50 }) {
  return { content: [{ type: 'text' as const, text }], usage };
}

type Call = { params: unknown };

function scriptedClient(responses: string[]): {
  factory: (key: string) => AnthropicLike;
  calls: Call[];
  keysSeen: string[];
} {
  const calls: Call[] = [];
  const keysSeen: string[] = [];
  let i = 0;
  const factory = (key: string): AnthropicLike => {
    keysSeen.push(key);
    return {
      messages: {
        async create(params: unknown) {
          calls.push({ params });
          const text = responses[i] ?? responses[responses.length - 1] ?? '';
          i += 1;
          return makeReply(text);
        },
      },
    };
  };
  return { factory, calls, keysSeen };
}

const baseInput: StructuringInput = {
  markdown: '# CBC\nHb 12.0 g/dL',
  documentCategory: 'lab_report',
};

describe('ClaudeHaikuAdapter', () => {
  it('returns validated ClinicalExtraction JSON on a valid first response', async () => {
    const secrets = fakeSecrets();
    const { factory, calls } = scriptedClient([validExtractionJson()]);
    const adapter = new ClaudeHaikuAdapter({
      secretsPort: secrets,
      anthropicClientFactory: factory,
    });

    const result = await adapter.structure(baseInput);

    expect(result.provider).toBe('claude-haiku');
    expect(result.structured).toMatchObject({
      document_type: 'lab_report',
      summary: expect.any(String),
    });
    expect(calls).toHaveLength(1);
  });

  it('retries once with a stricter cue when the first response is invalid JSON', async () => {
    const secrets = fakeSecrets();
    const { factory, calls } = scriptedClient(['not json at all', validExtractionJson()]);
    const adapter = new ClaudeHaikuAdapter({
      secretsPort: secrets,
      anthropicClientFactory: factory,
    });

    const result = await adapter.structure(baseInput);

    expect(calls).toHaveLength(2);
    expect(result.structured).toBeDefined();
    const second = calls[1]!.params as { messages: Array<{ role: string; content: string }> };
    const joined = second.messages.map((m) => m.content).join('\n');
    expect(joined.toLowerCase()).toMatch(/json|strict|schema/);
  });

  it('throws StructuringSchemaInvalidError when the second response also fails validation', async () => {
    const secrets = fakeSecrets();
    const { factory } = scriptedClient(['still not json', '{ "nope": true }']);
    const adapter = new ClaudeHaikuAdapter({
      secretsPort: secrets,
      anthropicClientFactory: factory,
    });

    await expect(adapter.structure(baseInput)).rejects.toBeInstanceOf(
      StructuringSchemaInvalidError,
    );
  });

  it('fetches ANTHROPIC_API_KEY from SecretsPort and passes it to the factory', async () => {
    const secrets = fakeSecrets({ ANTHROPIC_API_KEY: 'sk-live-abc' });
    const { factory, keysSeen } = scriptedClient([validExtractionJson()]);
    const adapter = new ClaudeHaikuAdapter({
      secretsPort: secrets,
      anthropicClientFactory: factory,
    });

    await adapter.structure(baseInput);

    expect(secrets.calls).toContain('ANTHROPIC_API_KEY');
    expect(keysSeen).toEqual(['sk-live-abc']);
  });

  it('preserves rawResponse on the result', async () => {
    const secrets = fakeSecrets();
    const { factory } = scriptedClient([validExtractionJson()]);
    const adapter = new ClaudeHaikuAdapter({
      secretsPort: secrets,
      anthropicClientFactory: factory,
    });

    const result = await adapter.structure(baseInput);

    expect(result.rawResponse).toBeDefined();
    const raw = result.rawResponse as { content: Array<{ text: string }> };
    expect(raw.content[0]!.text).toContain('document_type');
  });

  it('stamps promptVersion from the prompt file frontmatter', async () => {
    const secrets = fakeSecrets();
    const { factory } = scriptedClient([validExtractionJson()]);
    const adapter = new ClaudeHaikuAdapter({
      secretsPort: secrets,
      anthropicClientFactory: factory,
    });

    const result = await adapter.structure(baseInput);

    expect((result as unknown as { promptVersion: string }).promptVersion).toBeDefined();
    expect((result as unknown as { promptVersion: string }).promptVersion).toMatch(/\S+/);
  });
});
