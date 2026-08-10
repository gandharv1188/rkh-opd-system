/**
 * DIS-060 — OfficeWordAdapter tests (RED-first, mocked mammoth).
 *
 * Fixture strategy: `vi.mock('mammoth', ...)` stubs `extractRawText` with a
 * canned response. Fully exercises the adapter's transformation logic without
 * a real .docx binary — acceptable per DIS-060 brief (preferred path).
 */

import { describe, it, expect, vi } from 'vitest';

const mammothReturn = {
  value: 'Hello DIS-060',
  messages: [] as Array<{ type: string; message: string }>,
};

vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(async () => mammothReturn),
  },
}));

import { OfficeWordAdapter } from '../../../src/adapters/document-text-extractor/office-word.js';

describe('OfficeWordAdapter', () => {
  const adapter = new OfficeWordAdapter();
  const input = {
    bytes: new Uint8Array([0, 1, 2]),
    mediaType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };

  it('happy path — returns office_word route with extracted markdown', async () => {
    const result = await adapter.routeAndExtract(input);

    expect(result.route).toBe('office_word');
    expect(result.markdown).toBe('Hello DIS-060');
    expect(result.pageCount).toBe(1);
    expect(result.providerDetails).toBeUndefined();
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('CS-2 — preserves full mammoth response verbatim in rawResponse', async () => {
    const result = await adapter.routeAndExtract(input);

    // Reference-equality: rawResponse is the exact object mammoth returned.
    expect(result.rawResponse).toBe(mammothReturn);
    expect((result.rawResponse as typeof mammothReturn).value).toBe(
      'Hello DIS-060',
    );
    expect((result.rawResponse as typeof mammothReturn).messages).toEqual([]);
  });
});
