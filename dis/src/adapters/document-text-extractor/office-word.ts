/**
 * OfficeWordAdapter — `DocumentTextExtractorPort` implementation for `.docx`.
 *
 * Parses Office Open XML word-processing documents via `mammoth` and returns
 * raw text as markdown. `pageCount` is fixed to `1` — Word has no hard page
 * concept in the document body, and `extractRawText` yields a single stream of
 * paragraphs; `1` is the convention for this route.
 *
 * CS-2: `rawResponse` preserves mammoth's full return (value + messages) for
 * audit / reprocessing.
 *
 * @see ADR-008
 * @see DIS-060
 */

import mammoth from 'mammoth';
import type {
  DocumentTextExtractorPort,
  ExtractionInput,
  ExtractionResult,
} from '../../ports/document-text-extractor.js';

export class OfficeWordAdapter implements DocumentTextExtractorPort {
  async routeAndExtract(input: ExtractionInput): Promise<ExtractionResult> {
    const start = Date.now();
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(input.bytes),
    });
    return {
      route: 'office_word',
      markdown: result.value,
      pageCount: 1,
      rawResponse: result,
      latencyMs: Date.now() - start,
    };
  }
}
