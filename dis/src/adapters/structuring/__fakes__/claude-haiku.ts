/**
 * Test fake for the Anthropic client factory used by {@link ClaudeHaikuAdapter}.
 *
 * Produces a client that replays scripted text responses in order. Intended
 * for unit tests and wiring-layer smoke tests — never import from production
 * code (__fakes__ convention).
 */

import type { AnthropicClientFactory, AnthropicLike } from '../claude-haiku.js';

export function scriptedAnthropicFactory(responses: readonly string[]): {
  readonly factory: AnthropicClientFactory;
  readonly calls: Array<{ params: unknown }>;
  readonly keysSeen: string[];
} {
  const calls: Array<{ params: unknown }> = [];
  const keysSeen: string[] = [];
  let i = 0;
  const factory: AnthropicClientFactory = (apiKey: string): AnthropicLike => {
    keysSeen.push(apiKey);
    return {
      messages: {
        async create(params: unknown) {
          calls.push({ params });
          const text = responses[i] ?? responses[responses.length - 1] ?? '';
          i += 1;
          return {
            content: [{ type: 'text' as const, text }],
            usage: { input_tokens: 100, output_tokens: 50 },
          };
        },
      },
    };
  };
  return { factory, calls, keysSeen };
}
