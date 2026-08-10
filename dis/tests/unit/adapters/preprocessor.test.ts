/**
 * DIS-058 — DefaultPreprocessor unit tests (TDD §8).
 *
 * Contract-level tests for the v1 stub. Real image pipeline is deferred to
 * DIS-058b; these tests pin the port contract and the page-cap guard.
 */
import { describe, expect, it } from 'vitest';
import {
  DefaultPreprocessor,
  PreprocessorPageCapError,
} from '../../../src/adapters/preprocessor/default.js';
import type { PreprocessorInput } from '../../../src/ports/preprocessor.js';

const buf = (s: string): Buffer => Buffer.from(s, 'utf8');

describe('DefaultPreprocessor — contract (TDD §8)', () => {
  it('passthrough for single JPEG page with zero drops', async () => {
    const p = new DefaultPreprocessor();
    const b1 = buf('page-1');
    const input: PreprocessorInput = { pages: [b1], mediaType: 'image/jpeg' };
    const out = await p.preprocess(input);
    expect(out.pages).toEqual([b1]);
    expect(out.dropped).toEqual({ blank: 0, duplicate: 0 });
    expect(out.originalPageCount).toBe(1);
  });

  it('PDF media type passes through unchanged', async () => {
    const p = new DefaultPreprocessor();
    const b1 = buf('pdf-page-1');
    const b2 = buf('pdf-page-2');
    const out = await p.preprocess({ pages: [b1, b2], mediaType: 'application/pdf' });
    expect(out.pages).toEqual([b1, b2]);
    expect(out.dropped).toEqual({ blank: 0, duplicate: 0 });
    expect(out.originalPageCount).toBe(2);
  });

  it('empty pages array returns empty result', async () => {
    const p = new DefaultPreprocessor();
    const out = await p.preprocess({ pages: [], mediaType: 'image/jpeg' });
    expect(out.pages).toEqual([]);
    expect(out.dropped).toEqual({ blank: 0, duplicate: 0 });
    expect(out.originalPageCount).toBe(0);
  });

  it('throws PreprocessorPageCapError when pages exceed injected cap', async () => {
    const p = new DefaultPreprocessor({ pageCap: 3 });
    const pages = [buf('a'), buf('b'), buf('c'), buf('d')];
    await expect(p.preprocess({ pages, mediaType: 'image/jpeg' })).rejects.toMatchObject({
      code: 'PREPROCESSOR_PAGE_CAP_EXCEEDED',
    });
    await expect(p.preprocess({ pages, mediaType: 'image/jpeg' })).rejects.toBeInstanceOf(
      PreprocessorPageCapError,
    );
  });

  it('default page cap is 50', async () => {
    const p = new DefaultPreprocessor();
    const pages = Array.from({ length: 51 }, (_v, i) => buf(`p${i}`));
    await expect(p.preprocess({ pages, mediaType: 'image/jpeg' })).rejects.toBeInstanceOf(
      PreprocessorPageCapError,
    );
    const ok = Array.from({ length: 50 }, (_v, i) => buf(`p${i}`));
    const out = await p.preprocess({ pages: ok, mediaType: 'image/jpeg' });
    expect(out.pages.length).toBe(50);
    expect(out.originalPageCount).toBe(50);
  });

  it('passthrough preserves buffer identity for each page', async () => {
    const p = new DefaultPreprocessor();
    const b1 = buf('one');
    const b2 = buf('two');
    const b3 = buf('three');
    const out = await p.preprocess({ pages: [b1, b2, b3], mediaType: 'image/jpeg' });
    expect(out.pages[0]).toBe(b1);
    expect(out.pages[1]).toBe(b2);
    expect(out.pages[2]).toBe(b3);
  });
});
