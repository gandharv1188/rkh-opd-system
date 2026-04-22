import * as XLSX from 'xlsx';
import type {
  DocumentTextExtractorPort,
  ExtractionInput,
  ExtractionResult,
} from '../../ports/document-text-extractor.js';

export class OfficeSheetAdapter implements DocumentTextExtractorPort {
  async routeAndExtract(input: ExtractionInput): Promise<ExtractionResult> {
    const start = Date.now();
    const isCsv =
      input.mediaType === 'text/csv' || input.mediaType.endsWith('+csv');
    const wb = isCsv
      ? XLSX.read(Buffer.from(input.bytes).toString('utf-8'), { type: 'string' })
      : XLSX.read(Buffer.from(input.bytes), { type: 'buffer' });

    const sections: string[] = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      sections.push(`## ${name}\n\n${sheetToMarkdownTable(ws)}`);
    }

    return {
      route: 'office_sheet',
      markdown: sections.join('\n\n'),
      pageCount: wb.SheetNames.length,
      rawResponse: wb,
      latencyMs: Date.now() - start,
    };
  }
}

function sheetToMarkdownTable(ws: XLSX.WorkSheet): string {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
  if (rows.length === 0) return '';
  const [header, ...body] = rows;
  const headerCells = (header as unknown[]).map((c) => String(c ?? ''));
  const lines = [
    `| ${headerCells.join(' | ')} |`,
    `| ${headerCells.map(() => '---').join(' | ')} |`,
    ...body.map(
      (r) =>
        `| ${headerCells
          .map((_, i) => String((r as unknown[])[i] ?? ''))
          .join(' | ')} |`,
    ),
  ];
  return lines.join('\n');
}
