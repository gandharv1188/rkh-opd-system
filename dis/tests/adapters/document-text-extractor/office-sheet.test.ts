import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { OfficeSheetAdapter } from '../../../src/adapters/document-text-extractor/office-sheet.js';

const FIXTURE_DIR = join(__dirname, '../../fixtures/office');
const XLSX_PATH = join(FIXTURE_DIR, 'sample.xlsx');
const CSV_PATH = join(FIXTURE_DIR, 'sample.csv');

beforeAll(() => {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
  if (!existsSync(XLSX_PATH)) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Test', 'Value'],
        ['HbA1c', 7.2],
        ['Glucose', 110],
      ]),
      'Labs',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Drug', 'Dose'],
        ['Metformin', '500mg BID'],
      ]),
      'Meds',
    );
    writeFileSync(XLSX_PATH, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }
  if (!existsSync(CSV_PATH)) {
    writeFileSync(CSV_PATH, 'Test,Value\nHbA1c,7.2\nGlucose,110\n');
  }
});

describe('OfficeSheetAdapter', () => {
  it('extracts xlsx with multiple sheets as markdown', async () => {
    const adapter = new OfficeSheetAdapter();
    const bytes = new Uint8Array(readFileSync(XLSX_PATH));
    const result = await adapter.routeAndExtract({
      bytes,
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(result.route).toBe('office_sheet');
    expect(result.pageCount).toBe(2);
    expect(result.markdown).toContain('## Labs');
    expect(result.markdown).toContain('## Meds');
    expect(result.markdown).toContain('| Test | Value |');
    expect(result.markdown).toContain('HbA1c');
    expect(result.markdown).toContain('Metformin');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('extracts csv as single-sheet markdown', async () => {
    const adapter = new OfficeSheetAdapter();
    const bytes = new Uint8Array(readFileSync(CSV_PATH));
    const result = await adapter.routeAndExtract({
      bytes,
      mediaType: 'text/csv',
    });

    expect(result.route).toBe('office_sheet');
    expect(result.pageCount).toBe(1);
    expect(result.markdown).toContain('HbA1c');
    expect(result.markdown).toContain('| Test | Value |');
  });

  it('preserves rawResponse as the workbook reference (CS-2)', async () => {
    const adapter = new OfficeSheetAdapter();
    const bytes = new Uint8Array(readFileSync(XLSX_PATH));
    const result = await adapter.routeAndExtract({
      bytes,
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const raw = result.rawResponse as XLSX.WorkBook;
    expect(raw.SheetNames).toEqual(['Labs', 'Meds']);
  });
});
