/**
 * OCR port — abstracts PDF/image text extraction behind a provider-agnostic
 * interface. Implementations include Datalab Chandra, Claude Vision, and a
 * future on-prem Chandra adapter.
 *
 * @see TDD §9.1
 */

/**
 * Discriminator of structural block types emitted by OCR engines.
 *
 * @see TDD §9.1
 */
export type BlockType =
  | "text"
  | "section-header"
  | "caption"
  | "table"
  | "form"
  | "list-group"
  | "image"
  | "figure"
  | "equation-block"
  | "code-block"
  | "page-header"
  | "page-footer"
  | "complex-block";

/**
 * Bounding box for a single OCR block, in page-local coordinates.
 *
 * @see TDD §9.1
 */
export type BlockBoundingBox = {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/**
 * A single structural block produced by an OCR engine's JSON output.
 *
 * @see TDD §9.1
 */
export type Block = {
  readonly id: string;
  readonly blockType: BlockType;
  readonly bbox: BlockBoundingBox;
  readonly content: string;
  /** Engine-reported confidence in the range 0..1, where available. */
  readonly confidence?: number;
};

/**
 * Output formats requested from the OCR engine.
 *
 * @see TDD §9.1
 */
export type OcrOutputFormat = "markdown" | "json" | "html";

/**
 * Media types accepted by the OCR port.
 *
 * @see TDD §9.1
 */
export type OcrMediaType = "image/jpeg" | "application/pdf";

/**
 * Optional hints supplied to the OCR engine (language, domain category).
 *
 * @see TDD §9.1
 */
export type OcrHints = {
  readonly languageCodes?: readonly string[];
  readonly documentCategory?: string;
};

/**
 * Input payload for {@link OcrPort.extract}.
 *
 * @see TDD §9.1
 */
export type OcrInput = {
  /** One Buffer per page (typically JPEG) or a single PDF blob. */
  readonly pages: readonly Buffer[];
  readonly mediaType: OcrMediaType;
  readonly outputFormats: readonly OcrOutputFormat[];
  readonly hints?: OcrHints;
};

/**
 * Identifier of the concrete OCR provider that produced an {@link OcrResult}.
 *
 * @see TDD §9.1
 */
export type OcrProvider = "datalab" | "claude-vision" | "onprem-chandra";

/**
 * Token usage reported by the provider, when available.
 *
 * @see TDD §9.1
 */
export type OcrTokenUsage = {
  readonly input: number;
  readonly output: number;
};

/**
 * Result returned by {@link OcrPort.extract}.
 *
 * `rawResponse` is stored verbatim for audit; callers should not depend on its
 * shape — use the structured fields (`markdown`, `blocks`, `html`) instead.
 *
 * @see TDD §9.1
 */
export type OcrResult = {
  readonly provider: OcrProvider;
  readonly providerVersion: string;
  /**
   * Verbatim provider response, persisted for audit/reprocessing.
   * Typed as `unknown` because the shape varies per provider and callers must
   * not introspect it directly.
   */
  readonly rawResponse: unknown;
  readonly markdown?: string;
  readonly blocks?: readonly Block[];
  readonly html?: string;
  readonly pageCount: number;
  readonly tokensUsed?: OcrTokenUsage;
  readonly costMicroINR?: number;
  readonly latencyMs: number;
};

/**
 * Provider-agnostic OCR port.
 *
 * @see TDD §9.1
 */
export interface OcrPort {
  extract(input: OcrInput): Promise<OcrResult>;
}
