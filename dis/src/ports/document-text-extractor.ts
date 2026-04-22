/**
 * Document Text Extractor port — the file-router's dispatch target.
 *
 * Provides a route-agnostic "take bytes + media type hints, return extracted
 * text + a preserved rawResponse" contract, shared across all four
 * file-router branches: native PDF text, OCR image, office word, office sheet.
 *
 * `OcrPort` (see ./ocr.ts) remains the narrower image-to-text contract; an
 * `OcrBridgeAdapter` implements this port by delegating to the wired
 * `OcrPort`. The other three branches (native PDF, DOCX, XLSX) implement this
 * port directly without going through `OcrPort`.
 *
 * CS-2: `rawResponse` preserves the provider's verbatim response for audit /
 * reprocessing, uniformly across all four routes.
 *
 * @see TDD §7 (file-router decision tree)
 * @see ADR-008 (DocumentTextExtractorPort as file-router's dispatch target)
 */

import type { OcrProvider } from './ocr.js';

/**
 * Discriminator of which file-router branch produced an {@link ExtractionResult}.
 *
 * - `native_text` — PDFs with an embedded text layer; no OCR.
 * - `ocr_image` — scans, photos, multi-page image files; OCR required.
 * - `office_word` — `.docx` / `.doc`, parsed by a DOCX library.
 * - `office_sheet` — `.xlsx` / `.xls` / `.csv`, parsed by a spreadsheet library.
 *
 * The union is open to extension by backlog ticket (e.g. future `dicom` or
 * `hl7`) without a new ADR — see ADR-008 §Future ADRs.
 *
 * @see ADR-008
 */
export type ExtractionRoute =
  | 'native_text'
  | 'ocr_image'
  | 'office_word'
  | 'office_sheet';

/**
 * Input payload for {@link DocumentTextExtractorPort.routeAndExtract}.
 *
 * @see ADR-008
 */
export interface ExtractionInput {
  /** Raw document bytes. */
  readonly bytes: Uint8Array;
  /** IANA media type of the source document (e.g. `application/pdf`). */
  readonly mediaType: string;
  /**
   * Optional caller hints — language codes, document category, router
   * decision annotations, etc. Adapter-specific; treat as free-form.
   */
  readonly hints?: Readonly<Record<string, unknown>>;
}

/**
 * Result returned by {@link DocumentTextExtractorPort.routeAndExtract}.
 *
 * `providerDetails` is populated only by the OCR-bridge adapter; native-PDF,
 * DOCX, and XLSX adapters leave it `undefined` because they do not talk to a
 * remote OCR provider.
 *
 * @see ADR-008
 */
export interface ExtractionResult {
  readonly route: ExtractionRoute;
  /** Unified text output — markdown rendering of the extracted content. */
  readonly markdown: string;
  readonly pageCount: number;
  /**
   * CS-2 byte-identical preservation. Stored verbatim for audit /
   * reprocessing. Shape varies per route/provider; callers must not
   * introspect it directly.
   */
  readonly rawResponse: unknown;
  /**
   * Populated only by the OCR-bridge adapter (route === 'ocr_image').
   * Native PDF, office-word, and office-sheet adapters leave this undefined.
   */
  readonly providerDetails?: {
    provider: OcrProvider;
    providerVersion: string;
    tokensUsed?: { input: number; output: number };
  };
  readonly latencyMs: number;
  readonly costMicroINR?: number;
}

/**
 * Route-agnostic document text extraction port.
 *
 * Exactly four concrete adapters implement this contract — one per
 * {@link ExtractionRoute}. The orchestrator, after obtaining a route decision
 * from `FileRouterPort`, invokes `routeAndExtract` on the adapter bound for
 * that route.
 *
 * @see ADR-008
 * @see TDD §7
 */
export interface DocumentTextExtractorPort {
  routeAndExtract(input: ExtractionInput): Promise<ExtractionResult>;
}
