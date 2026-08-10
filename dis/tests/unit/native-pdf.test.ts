import { describe, it, expect, beforeAll } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractNativeText } from '../../src/core/native-pdf.js';
import { NativePdfUnavailableError } from '../../src/core/errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '../fixtures/native_text.pdf');

function buildMinimalTextPdf(text: string): Buffer {
  // Hand-crafted, PDF 1.4, 1 page, Helvetica, selectable text.
  // Object offsets are computed after assembly so we don't have to count bytes by hand.
  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const body: string[] = [];
  const offsets: number[] = [];

  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  ];

  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  objects.push(
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  );
  objects.push(
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  );

  let cursor = Buffer.byteLength(header, 'latin1');
  const chunks: Buffer[] = [Buffer.from(header, 'latin1')];
  for (const obj of objects) {
    offsets.push(cursor);
    const buf = Buffer.from(obj, 'latin1');
    chunks.push(buf);
    cursor += buf.length;
  }

  const xrefStart = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer, 'latin1'));
  return Buffer.concat(chunks);
}

describe('native-pdf (DIS-033)', () => {
  beforeAll(async () => {
    if (!existsSync(FIXTURE_PATH)) {
      await mkdir(dirname(FIXTURE_PATH), { recursive: true });
      await writeFile(FIXTURE_PATH, buildMinimalTextPdf('hello from DIS'));
    }
  });

  it('extracts text from a native-text PDF', async () => {
    const bytes = await readFile(FIXTURE_PATH);
    const out = await extractNativeText(new Uint8Array(bytes));
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0]!.page).toBe(1);
    expect(out.pages[0]!.text).toMatch(/hello from DIS/);
  });

  it('throws NativePdfUnavailableError for a PDF with no usable text layer', async () => {
    // Minimal PDF structurally valid but with an empty/trivial content stream (no Tj).
    const emptyContent = buildMinimalTextPdf('');
    await expect(extractNativeText(new Uint8Array(emptyContent))).rejects.toBeInstanceOf(
      NativePdfUnavailableError,
    );
  });
});
