/**
 * DIS-057 — DefaultFileRouter unit tests (TDD §7 decision tree).
 *
 * Gate: these tests are committed BEFORE the implementation and MUST fail to
 * resolve until DIS-057 impl lands.
 */
import { describe, expect, it } from 'vitest';
import { DefaultFileRouter } from '../../../src/adapters/file-router/default.js';
import type { RoutingDecision } from '../../../src/ports/file-router.js';

function fakePdfPages(pages: string[]): (buf: Buffer) => Promise<{ pages: string[] }> {
  return async (_buf: Buffer) => ({ pages });
}

const emptyBuf = Buffer.alloc(0);

describe('DefaultFileRouter — TDD §7 decision tree', () => {
  it('routes .pdf with ≥100 chars/page native text to native_text', async () => {
    const router = new DefaultFileRouter({
      pdfTextExtractor: fakePdfPages(['a'.repeat(200), 'b'.repeat(150)]),
    });
    const decision: RoutingDecision = await router.route({
      body: emptyBuf,
      contentType: 'application/pdf',
      filename: 'scan.pdf',
    });
    expect(decision.kind).toBe('native_text');
    if (decision.kind === 'native_text') {
      expect(decision.pageCount).toBe(2);
    }
  });

  it('routes .pdf with <100 chars/page to ocr_scan', async () => {
    const router = new DefaultFileRouter({
      pdfTextExtractor: fakePdfPages(['short', '', 'tiny']),
    });
    const decision = await router.route({
      body: emptyBuf,
      contentType: 'application/pdf',
      filename: 'scan.pdf',
    });
    expect(decision.kind).toBe('ocr_scan');
    if (decision.kind === 'ocr_scan') {
      expect(decision.pageCount).toBe(3);
    }
  });

  it.each([
    ['photo.jpg'],
    ['photo.jpeg'],
    ['photo.png'],
    ['photo.heic'],
    ['photo.webp'],
    ['photo.bmp'],
    ['photo.tiff'],
  ])('routes image file %s to ocr_image', async (filename) => {
    const router = new DefaultFileRouter({ pdfTextExtractor: fakePdfPages([]) });
    const decision = await router.route({
      body: emptyBuf,
      contentType: 'application/octet-stream',
      filename,
    });
    expect(decision.kind).toBe('ocr_image');
  });

  it('routes .docx to office_word', async () => {
    const router = new DefaultFileRouter({ pdfTextExtractor: fakePdfPages([]) });
    const decision = await router.route({
      body: emptyBuf,
      contentType: 'application/octet-stream',
      filename: 'note.docx',
    });
    expect(decision.kind).toBe('office_word');
  });

  it('routes .xlsx to office_sheet', async () => {
    const router = new DefaultFileRouter({ pdfTextExtractor: fakePdfPages([]) });
    const decision = await router.route({
      body: emptyBuf,
      contentType: 'application/octet-stream',
      filename: 'labs.xlsx',
    });
    expect(decision.kind).toBe('office_sheet');
  });

  it('routes .csv to office_sheet', async () => {
    const router = new DefaultFileRouter({ pdfTextExtractor: fakePdfPages([]) });
    const decision = await router.route({
      body: emptyBuf,
      contentType: 'text/csv',
      filename: 'labs.csv',
    });
    expect(decision.kind).toBe('office_sheet');
  });

  it('rejects .exe as unsupported with disallowed_extension reason', async () => {
    const router = new DefaultFileRouter({ pdfTextExtractor: fakePdfPages([]) });
    const decision = await router.route({
      body: emptyBuf,
      contentType: 'application/octet-stream',
      filename: 'malware.exe',
    });
    expect(decision.kind).toBe('unsupported');
    if (decision.kind === 'unsupported') {
      expect(decision.reason).toBe('disallowed_extension');
    }
  });

  it('honours configurable nativeTextMinCharsPerPage threshold via constructor', async () => {
    // With default 100, 60 chars/page → ocr_scan. With override 50, → native_text.
    const pages = ['x'.repeat(60), 'y'.repeat(60)];
    const defaultRouter = new DefaultFileRouter({ pdfTextExtractor: fakePdfPages(pages) });
    const loweredRouter = new DefaultFileRouter({
      nativeTextMinCharsPerPage: 50,
      pdfTextExtractor: fakePdfPages(pages),
    });
    const defaultDecision = await defaultRouter.route({
      body: emptyBuf,
      contentType: 'application/pdf',
      filename: 'scan.pdf',
    });
    const loweredDecision = await loweredRouter.route({
      body: emptyBuf,
      contentType: 'application/pdf',
      filename: 'scan.pdf',
    });
    expect(defaultDecision.kind).toBe('ocr_scan');
    expect(loweredDecision.kind).toBe('native_text');
  });
});
