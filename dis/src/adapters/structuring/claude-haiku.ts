/**
 * ClaudeHaikuAdapter — implements StructuringPort via Claude Haiku.
 *
 * Responsibilities:
 *  - Load the structuring prompt (src/prompts/structuring.md) at construction.
 *  - Call Anthropic Messages API, parse JSON reply, validate against
 *    clinical-extraction.v1.json required top-level fields.
 *  - On first validation failure, retry once with a stricter user cue.
 *  - On second failure, throw StructuringSchemaInvalidError.
 *
 * The Anthropic client is injected via a factory so tests can run without SDK
 * or network. Prompt + schema are read synchronously at construction — this is
 * deliberate: adapter init is a cold path, and avoiding async init keeps the
 * wiring layer simple.
 *
 * NOTE: Validation uses a lean hand-rolled required-keys check. A future
 * ticket (DIS-051-followup) should replace this with Ajv for full JSON Schema
 * coverage (type narrowing, array item shapes, enum checks).
 *
 * @see TDD §10, §11
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SecretsPort } from '../../ports/secrets.js';
import type {
  StructuringInput,
  StructuringPort,
  StructuringResult,
} from '../../ports/structuring.js';

/**
 * Minimal duck-typed interface over the Anthropic SDK client so tests can
 * inject a fake without depending on @anthropic-ai/sdk.
 */
export interface AnthropicLike {
  readonly messages: {
    create(params: unknown): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    }>;
  };
}

export type AnthropicClientFactory = (apiKey: string) => AnthropicLike;

export class StructuringSchemaInvalidError extends Error {
  public override readonly name = 'StructuringSchemaInvalidError';
  public constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastRaw: string,
  ) {
    super(message);
  }
}

type LoadedPrompt = {
  readonly body: string;
  readonly version: string;
};

type LoadedSchema = {
  readonly required: readonly string[];
};

const HAIKU_MODEL = 'claude-haiku-4-5';
const PROVIDER_VERSION = 'haiku-4.5';
const MAX_TOKENS = 4096;

const COST_PER_INPUT_TOKEN_MICRO_INR = 83;
const COST_PER_OUTPUT_TOKEN_MICRO_INR = 416;

export interface ClaudeHaikuAdapterOptions {
  readonly secretsPort: SecretsPort;
  readonly anthropicClientFactory?: AnthropicClientFactory;
  readonly promptPath?: string;
  readonly schemaPath?: string;
}

export class ClaudeHaikuAdapter implements StructuringPort {
  private readonly secretsPort: SecretsPort;
  private readonly factory: AnthropicClientFactory;
  private readonly prompt: LoadedPrompt;
  private readonly schema: LoadedSchema;

  public constructor(opts: ClaudeHaikuAdapterOptions) {
    this.secretsPort = opts.secretsPort;
    this.factory = opts.anthropicClientFactory ?? defaultFactory;
    const here = dirname(fileURLToPath(import.meta.url));
    const promptPath = opts.promptPath ?? resolve(here, '../../prompts/structuring.md');
    const schemaPath =
      opts.schemaPath ?? resolve(here, '../../schemas/clinical-extraction.v1.json');
    this.prompt = loadPrompt(promptPath);
    this.schema = loadSchema(schemaPath);
  }

  public async structure(input: StructuringInput): Promise<StructuringResult> {
    const apiKey = await this.secretsPort.get('ANTHROPIC_API_KEY');
    const client = this.factory(apiKey);
    const started = Date.now();

    const userBody = buildUserMessage(input);
    const firstReply = await callHaiku(client, this.prompt.body, userBody);
    const firstText = extractText(firstReply);
    const firstParsed = tryParseAndValidate(firstText, this.schema.required);

    let finalReply = firstReply;
    let finalParsed = firstParsed;

    if (!firstParsed.ok) {
      const stricter = `${userBody}\n\nYour previous reply was not valid. Respond with a SINGLE valid JSON object that strictly matches the ClinicalExtraction v1 schema — no prose, no markdown fences.`;
      const retryReply = await callHaiku(client, this.prompt.body, stricter);
      const retryText = extractText(retryReply);
      const retryParsed = tryParseAndValidate(retryText, this.schema.required);
      finalReply = retryReply;
      finalParsed = retryParsed;

      if (!retryParsed.ok) {
        throw new StructuringSchemaInvalidError(
          `ClaudeHaikuAdapter: response failed schema validation after 2 attempts: ${retryParsed.reason}`,
          2,
          retryText,
        );
      }
    }

    const latencyMs = Date.now() - started;
    const usage = finalReply.usage ?? { input_tokens: 0, output_tokens: 0 };
    const costMicroINR =
      usage.input_tokens * COST_PER_INPUT_TOKEN_MICRO_INR +
      usage.output_tokens * COST_PER_OUTPUT_TOKEN_MICRO_INR;

    const result = {
      provider: 'claude-haiku' as const,
      providerVersion: PROVIDER_VERSION,
      rawResponse: finalReply,
      structured: finalParsed.ok ? finalParsed.value : null,
      tokensUsed: { input: usage.input_tokens, output: usage.output_tokens },
      costMicroINR,
      latencyMs,
      promptVersion: this.prompt.version,
    };
    return result;
  }
}

function defaultFactory(_apiKey: string): AnthropicLike {
  throw new Error(
    'ClaudeHaikuAdapter: no anthropicClientFactory supplied. Wiring layer must inject one (see DIS-051-followup for SDK integration).',
  );
}

function buildUserMessage(input: StructuringInput): string {
  const md = input.markdown ?? '';
  const ctx = input.patientContext
    ? `\n\nPatient context: ${JSON.stringify(input.patientContext)}`
    : '';
  return `Document category: ${input.documentCategory}${ctx}\n\n---\n${md}`;
}

async function callHaiku(
  client: AnthropicLike,
  system: string,
  userContent: string,
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}> {
  return client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: userContent }],
  });
}

function extractText(reply: { content: Array<{ type: 'text'; text: string }> }): string {
  const first = reply.content[0];
  return first?.text ?? '';
}

type ParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

function tryParseAndValidate(text: string, required: readonly string[]): ParseResult {
  const stripped = stripFences(text).trim();
  if (stripped.length === 0) return { ok: false, reason: 'empty response' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return { ok: false, reason: `JSON.parse failed: ${(err as Error).message}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'top-level value is not a JSON object' };
  }
  const obj = parsed as Record<string, unknown>;
  for (const key of required) {
    if (!(key in obj)) {
      return { ok: false, reason: `missing required key "${key}"` };
    }
  }
  return { ok: true, value: parsed };
}

function stripFences(text: string): string {
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i;
  const m = text.trim().match(fence);
  return m && m[1] !== undefined ? m[1] : text;
}

function loadPrompt(path: string): LoadedPrompt {
  const body = readFileSync(path, 'utf8');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  let version = '1';
  if (fm && fm[1] !== undefined) {
    const vm = /(^|\n)\s*version\s*:\s*([^\n]+)/.exec(fm[1]);
    if (vm && vm[2] !== undefined) version = vm[2].trim();
  }
  return { body, version };
}

function loadSchema(path: string): LoadedSchema {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as { required?: unknown };
  const req = Array.isArray(parsed.required)
    ? parsed.required.filter((x): x is string => typeof x === 'string')
    : [];
  return { required: req };
}
