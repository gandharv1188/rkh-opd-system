/**
 * ClaudeVisionAdapter — implements {@link OcrPort} against Anthropic's Vision
 * Messages API as a fallback OCR provider. Activated when
 * `DIS_OCR_PROVIDER=claude` at the wiring layer (DIS-079 owns selection).
 *
 * Submits each page as a single image/jpeg content block to a Claude model
 * with a prompt that asks for markdown extraction, then concatenates the
 * per-page replies into a single markdown body. Each page's raw reply is
 * retained on {@link OcrResult.rawResponse} so CS-2 audit can replay or diff
 * provider output byte-for-byte.
 *
 * The Anthropic client is injected via {@link AnthropicVisionClientFactory}
 * so tests can run without SDK or network — mirrors the seam established by
 * `ClaudeHaikuAdapter` (DIS-051).
 *
 * @see TDD §9.2 (Claude Vision adapter)
 * @see clinical_safety.md CS-2 (raw provider response preserved per-page)
 */

import type { OcrInput, OcrPort, OcrProvider, OcrResult } from '../../ports/ocr.js';
import type { SecretsPort } from '../../ports/secrets.js';

const PROVIDER: OcrProvider = 'claude-vision';
const API_KEY_NAME = 'ANTHROPIC_API_KEY';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const PROVIDER_VERSION = 'sonnet-4.6';
const MAX_TOKENS = 4096;

const EXTRACTION_PROMPT = [
  'You are an OCR engine. Transcribe the attached document page into GitHub-flavoured markdown.',
  'Preserve headings, tables, and list structure. Do not paraphrase or summarise.',
  'Return ONLY the markdown body — no prose commentary, no code fences around the whole reply.',
].join('\n');

/**
 * Minimal duck-typed interface over the Anthropic SDK client for Vision
 * calls. Matches the shape used by ClaudeHaikuAdapter so a single factory can
 * serve both adapters if the wiring layer chooses.
 */
export interface AnthropicVisionLike {
  readonly messages: {
    create(params: unknown): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    }>;
  };
}

export type AnthropicVisionClientFactory = (apiKey: string) => AnthropicVisionLike;

export interface ClaudeVisionAdapterOptions {
  readonly secretsPort: SecretsPort;
  readonly anthropicClientFactory?: AnthropicVisionClientFactory;
  readonly model?: string;
  readonly providerVersion?: string;
}

export class ClaudeVisionAdapter implements OcrPort {
  private readonly secretsPort: SecretsPort;
  private readonly factory: AnthropicVisionClientFactory;
  private readonly model: string;
  private readonly providerVersion: string;

  public constructor(opts: ClaudeVisionAdapterOptions) {
    this.secretsPort = opts.secretsPort;
    this.factory = opts.anthropicClientFactory ?? defaultFactory;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.providerVersion = opts.providerVersion ?? PROVIDER_VERSION;
  }

  public async extract(input: OcrInput): Promise<OcrResult> {
    const apiKey = await this.secretsPort.get(API_KEY_NAME);
    const client = this.factory(apiKey);
    const startedAt = Date.now();

    const rawPages: Array<{
      content: Array<{ type: 'text'; text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    }> = [];
    const markdownParts: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    for (const pageBuf of input.pages) {
      const base64 = toBase64(pageBuf);
      const reply = await client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: base64,
                },
              },
              { type: 'text', text: EXTRACTION_PROMPT },
            ],
          },
        ],
      });

      rawPages.push(reply);
      markdownParts.push(stripFences(extractText(reply)));
      if (reply.usage) {
        inputTokens += reply.usage.input_tokens;
        outputTokens += reply.usage.output_tokens;
      }
    }

    const latencyMs = Date.now() - startedAt;

    return {
      provider: PROVIDER,
      providerVersion: this.providerVersion,
      rawResponse: { pages: rawPages },
      markdown: markdownParts.join('\n\n'),
      pageCount: input.pages.length,
      tokensUsed: { input: inputTokens, output: outputTokens },
      latencyMs,
    };
  }
}

function defaultFactory(_apiKey: string): AnthropicVisionLike {
  throw new Error(
    'ClaudeVisionAdapter: no anthropicClientFactory supplied. Wiring (DIS-079) must inject one.',
  );
}

function extractText(reply: { content: Array<{ type: 'text'; text: string }> }): string {
  return reply.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:markdown|md)?\s*\n?([\s\S]*?)\n?```\s*$/i;
  const m = trimmed.match(fence);
  return m && m[1] !== undefined ? m[1].trim() : trimmed;
}

function toBase64(buf: Buffer): string {
  return Buffer.from(buf).toString('base64');
}
