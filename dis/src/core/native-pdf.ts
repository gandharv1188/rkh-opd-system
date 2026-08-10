// pdfjs-dist legacy build wrapper. Lazy import keeps cold load out of unit tests
// that don't need native PDF extraction.
import { NativePdfUnavailableError } from './errors.js';

export interface NativePdfPage {
  readonly page: number;
  readonly text: string;
}

export interface NativePdfResult {
  readonly pages: ReadonlyArray<NativePdfPage>;
}

const MIN_CHARS_PER_PAGE = 5;

export async function extractNativeText(bytes: Uint8Array): Promise<NativePdfResult> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Copy into a fresh Uint8Array: pdfjs transfers/detaches the underlying buffer,
  // which would break the caller's bytes and trip the OCR fallback path in odd ways.
  const data = new Uint8Array(bytes.byteLength);
  data.set(bytes);

  const task = pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false });
  const doc = await task.promise;
  try {
    const pages: NativePdfPage[] = [];
    let totalChars = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => ('str' in it && typeof it.str === 'string' ? it.str : ''))
        .join(' ')
        .trim();
      totalChars += text.length;
      pages.push({ page: i, text });
      page.cleanup();
    }
    if (doc.numPages === 0 || totalChars / Math.max(doc.numPages, 1) < MIN_CHARS_PER_PAGE) {
      throw new NativePdfUnavailableError(
        `native PDF has no usable text layer (${totalChars} chars / ${doc.numPages} page(s))`,
        doc.numPages,
        totalChars,
      );
    }
    return { pages };
  } finally {
    await doc.destroy();
  }
}
