/**
 * NativePdfTextAdapter — implements {@link DocumentTextExtractorPort} for the
 * `native_text` file-router branch.
 *
 * Wraps the pure utility `extractNativeText` from `core/native-pdf.ts`
 * (DIS-033). This is the adapter the orchestrator dispatches to when the
 * file-router decides a PDF has a usable embedded text layer and OCR is
 * unnecessary.
 *
 * Failure mode: if `extractNativeText` throws (e.g.
 * `NativePdfUnavailableError` when the text layer is missing or too sparse),
 * the error is re-thrown unchanged. The orchestrator/bridge layer is
 * responsible for falling back to the OCR route.
 *
 * CS-2: the verbatim `NativePdfResult` is stored on `rawResponse` for audit
 * and reprocessing.
 *
 * @see ADR-008
 * @see dis/src/core/native-pdf.ts
 */

import { extractNativeText } from '../../core/native-pdf.js';
import type {
  DocumentTextExtractorPort,
  ExtractionInput,
  ExtractionResult,
} from '../../ports/document-text-extractor.js';

export interface NativePdfTextAdapterOptions {
  /** Injectable clock for deterministic latency in tests. */
  readonly now?: () => number;
}

export class NativePdfTextAdapter implements DocumentTextExtractorPort {
  private readonly now: () => number;

  constructor(options: NativePdfTextAdapterOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  async routeAndExtract(input: ExtractionInput): Promise<ExtractionResult> {
    const start = this.now();
    const result = await extractNativeText(input.bytes);
    const latencyMs = this.now() - start;

    const markdown = result.pages.map((p) => p.text).join('\n\n');
    const pageCount = result.pages.length;

    return {
      route: 'native_text',
      markdown,
      pageCount,
      rawResponse: result,
      latencyMs,
    };
  }
}
