import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NativePdfTextAdapter } from '../../../src/adapters/document-text-extractor/native-pdf-text.js';

const FIXTURE_PATH = join(
  process.cwd(),
  'tests',
  'fixtures',
  'native_text.pdf',
);

describe('NativePdfTextAdapter', () => {
  it('extracts text from a native-text PDF and surfaces expected result fields', async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE_PATH));
    const adapter = new NativePdfTextAdapter();

    const result = await adapter.routeAndExtract({
      bytes,
      mediaType: 'application/pdf',
    });

    expect(result.route).toBe('native_text');
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(result.rawResponse).toMatchObject({ pages: expect.any(Array) });
    expect(result.providerDetails).toBeUndefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.costMicroINR).toBeUndefined();
  });

  it('preserves rawResponse as the verbatim NativePdfResult (CS-2)', async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE_PATH));
    const adapter = new NativePdfTextAdapter();

    const result = await adapter.routeAndExtract({
      bytes,
      mediaType: 'application/pdf',
    });

    // rawResponse must carry the full NativePdfResult shape, and its pages
    // array must deep-equal the markdown reconstitution input.
    const raw = result.rawResponse as { pages: ReadonlyArray<{ page: number; text: string }> };
    expect(Array.isArray(raw.pages)).toBe(true);
    expect(raw.pages.length).toBe(result.pageCount);
    const reconstituted = raw.pages.map((p) => p.text).join('\n\n');
    expect(result.markdown).toBe(reconstituted);
  });
});
