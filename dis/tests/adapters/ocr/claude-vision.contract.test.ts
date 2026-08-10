import { describe, it, expect } from 'vitest';
import {
  ClaudeVisionAdapter,
  type AnthropicVisionLike,
  type AnthropicVisionClientFactory,
} from '../../../src/adapters/ocr/claude-vision.js';
import type { SecretsPort } from '../../../src/ports/secrets.js';
import type { OcrInput, OcrPort } from '../../../src/ports/ocr.js';

function fakeSecrets(
  map: Record<string, string> = { ANTHROPIC_API_KEY: 'sk-vision-test' },
): SecretsPort & { readonly calls: string[] } {
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

type RecordedCall = { params: unknown };

function scriptedClient(pageTexts: string[]): {
  factory: AnthropicVisionClientFactory;
  calls: RecordedCall[];
  keysSeen: string[];
} {
  const calls: RecordedCall[] = [];
  const keysSeen: string[] = [];
  let i = 0;
  const factory: AnthropicVisionClientFactory = (key: string): AnthropicVisionLike => {
    keysSeen.push(key);
    return {
      messages: {
        async create(params: unknown) {
          calls.push({ params });
          const text = pageTexts[i] ?? pageTexts[pageTexts.length - 1] ?? '';
          i += 1;
          return {
            content: [{ type: 'text' as const, text }],
            usage: { input_tokens: 500, output_tokens: 120 },
          };
        },
      },
    };
  };
  return { factory, calls, keysSeen };
}

function jpegInput(pages = 1): OcrInput {
  const pageBufs: Buffer[] = [];
  for (let i = 0; i < pages; i++) {
    pageBufs.push(Buffer.from([0xff, 0xd8, 0xff, 0xe0, i & 0xff]));
  }
  return {
    pages: pageBufs,
    mediaType: 'image/jpeg',
    outputFormats: ['markdown'],
  };
}

describe('ClaudeVisionAdapter — OcrPort contract', () => {
  it('matches OcrPort contract (structural binding)', () => {
    const secrets = fakeSecrets();
    const { factory } = scriptedClient(['# page']);
    const adapter: OcrPort = new ClaudeVisionAdapter({
      secretsPort: secrets,
      anthropicClientFactory: factory,
    });
    expect(typeof adapter.extract).toBe('function');
  });

  it('returns an OcrResult with provider=claude-vision and concatenated markdown', async () => {
    const secrets = fakeSecrets();
    const { factory } = scriptedClient(['# Page 1\nAlpha', '# Page 2\nBeta']);
    const adapter = new ClaudeVisionAdapter({
      secretsPort: secrets,
      anthropicClientFactory: factory,
    });

    const result = await adapter.extract(jpegInput(2));

    expect(result.provider).toBe('claude-vision');
    expect(result.providerVersion).toMatch(/\S+/);
    expect(result.pageCount).toBe(2);
    expect(result.markdown).toContain('# Page 1');
    expect(result.markdown).toContain('# Page 2');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('preserves rawResponse per-page for CS-2 audit', async () => {
    const secrets = fakeSecrets();
    const { factory } = scriptedClient(['hello']);
    const adapter = new ClaudeVisionAdapter({
      secretsPort: secrets,
      anthropicClientFactory: factory,
    });

    const result = await adapter.extract(jpegInput(1));

    expect(result.rawResponse).toBeDefined();
    const raw = result.rawResponse as { pages: Array<{ content: Array<{ text: string }> }> };
    expect(Array.isArray(raw.pages)).toBe(true);
    expect(raw.pages[0]!.content[0]!.text).toBe('hello');
  });

  it('fetches ANTHROPIC_API_KEY from SecretsPort and forwards it to the factory', async () => {
    const secrets = fakeSecrets({ ANTHROPIC_API_KEY: 'sk-live-vision' });
    const { factory, keysSeen } = scriptedClient(['x']);
    const adapter = new ClaudeVisionAdapter({
      secretsPort: secrets,
      anthropicClientFactory: factory,
    });

    await adapter.extract(jpegInput(1));

    expect(secrets.calls).toContain('ANTHROPIC_API_KEY');
    expect(keysSeen).toEqual(['sk-live-vision']);
  });

  it('sends each page as an image content block with base64 + media type', async () => {
    const secrets = fakeSecrets();
    const { factory, calls } = scriptedClient(['a', 'b']);
    const adapter = new ClaudeVisionAdapter({
      secretsPort: secrets,
      anthropicClientFactory: factory,
    });

    await adapter.extract(jpegInput(2));

    expect(calls).toHaveLength(2);
    const first = calls[0]!.params as {
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    };
    const imgBlock = first.messages[0]!.content.find((c) => c.type === 'image') as
      | { type: string; source: { type: string; media_type: string; data: string } }
      | undefined;
    expect(imgBlock).toBeDefined();
    expect(imgBlock!.source.type).toBe('base64');
    expect(imgBlock!.source.media_type).toBe('image/jpeg');
    expect(imgBlock!.source.data).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('aggregates token usage across pages', async () => {
    const secrets = fakeSecrets();
    const { factory } = scriptedClient(['a', 'b', 'c']);
    const adapter = new ClaudeVisionAdapter({
      secretsPort: secrets,
      anthropicClientFactory: factory,
    });

    const result = await adapter.extract(jpegInput(3));

    expect(result.tokensUsed).toEqual({ input: 1500, output: 360 });
  });

  it('strips markdown fences from per-page responses', async () => {
    const secrets = fakeSecrets();
    const { factory } = scriptedClient(['```markdown\n# Heading\nBody\n```']);
    const adapter = new ClaudeVisionAdapter({
      secretsPort: secrets,
      anthropicClientFactory: factory,
    });

    const result = await adapter.extract(jpegInput(1));

    expect(result.markdown).toBe('# Heading\nBody');
  });
});
