/**
 * DIS-057 — DefaultFileRouter: implements TDD §7 decision tree.
 *
 * Routes uploaded files to the correct downstream pipeline based on
 * filename extension, and for PDFs on native-text density.
 */
import type { FileRouterInput, FileRouterPort, RoutingDecision } from '../../ports/file-router.js';

export type PdfTextExtractor = (buf: Buffer) => Promise<{ pages: string[] }>;

export type DefaultFileRouterOptions = {
  readonly nativeTextMinCharsPerPage?: number;
  readonly pdfTextExtractor?: PdfTextExtractor;
};

const DEFAULT_NATIVE_TEXT_MIN_CHARS_PER_PAGE = 100;

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'heic', 'webp', 'bmp', 'tiff']);
const WORD_EXTS = new Set(['docx', 'doc']);
const SHEET_EXTS = new Set(['xlsx', 'xls', 'csv']);

function extOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

async function defaultPdfExtractor(_buf: Buffer): Promise<{ pages: string[] }> {
  // Runtime uses pdfjs-dist (see DEPS_REQUIRED.md). Kept as a lazy import so
  // the dependency does not need to resolve during unit tests that inject
  // their own extractor.
  const mod = (await import('pdfjs-dist')) as unknown as {
    getDocument: (src: { data: Uint8Array }) => { promise: Promise<PdfDoc> };
  };
  const doc = await mod.getDocument({ data: new Uint8Array(_buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str ?? '').join(' ');
    pages.push(text);
  }
  return { pages };
}

type PdfDoc = {
  readonly numPages: number;
  getPage(n: number): Promise<PdfPage>;
};

type PdfPage = {
  getTextContent(): Promise<{ items: ReadonlyArray<{ str?: string }> }>;
};

export class DefaultFileRouter implements FileRouterPort {
  private readonly minCharsPerPage: number;
  private readonly pdfExtractor: PdfTextExtractor;

  constructor(options: DefaultFileRouterOptions = {}) {
    this.minCharsPerPage =
      options.nativeTextMinCharsPerPage ?? DEFAULT_NATIVE_TEXT_MIN_CHARS_PER_PAGE;
    this.pdfExtractor = options.pdfTextExtractor ?? defaultPdfExtractor;
  }

  async route(input: FileRouterInput): Promise<RoutingDecision> {
    const ext = extOf(input.filename);

    if (ext === 'pdf') {
      const { pages } = await this.pdfExtractor(input.body);
      const pageCount = pages.length;
      if (pageCount === 0) {
        return { kind: 'ocr_scan', pageCount: 0 };
      }
      const totalChars = pages.reduce((acc, p) => acc + p.length, 0);
      const avg = totalChars / pageCount;
      if (avg >= this.minCharsPerPage) {
        return { kind: 'native_text', pageCount };
      }
      return { kind: 'ocr_scan', pageCount };
    }

    if (IMAGE_EXTS.has(ext)) {
      return { kind: 'ocr_image' };
    }
    if (WORD_EXTS.has(ext)) {
      return { kind: 'office_word' };
    }
    if (SHEET_EXTS.has(ext)) {
      return { kind: 'office_sheet' };
    }

    return { kind: 'unsupported', reason: 'disallowed_extension' };
  }
}
