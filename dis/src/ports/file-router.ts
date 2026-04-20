/**
 * File router port — inspects an uploaded file and decides which downstream
 * pipeline (native text extraction, OCR scan, OCR image, Office, …) should
 * process it.
 *
 * @see TDD §7
 */

/**
 * Routing decision returned by {@link FileRouterPort.route}.
 *
 * Discriminated union on `kind` — callers MUST pattern-match and handle the
 * `unsupported` variant explicitly.
 *
 * @see TDD §7
 */
export type RoutingDecision =
  | { readonly kind: 'native_text'; readonly pageCount: number }
  | { readonly kind: 'ocr_scan'; readonly pageCount: number }
  | { readonly kind: 'ocr_image' }
  | { readonly kind: 'office_word' }
  | { readonly kind: 'office_sheet' }
  | { readonly kind: 'unsupported'; readonly reason: string };

/**
 * Input payload for {@link FileRouterPort.route}.
 *
 * @see TDD §7
 */
export type FileRouterInput = {
  readonly body: Buffer;
  readonly contentType: string;
  readonly filename: string;
};

/**
 * Provider-agnostic file router port.
 *
 * @see TDD §7
 */
export interface FileRouterPort {
  route(input: FileRouterInput): Promise<RoutingDecision>;
}
