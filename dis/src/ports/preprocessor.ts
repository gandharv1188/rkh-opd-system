/**
 * Preprocessor port — normalises scanned pages before OCR (deskew, blank-page
 * drop, near-duplicate drop).
 *
 * @see TDD §8
 */

/**
 * Media types accepted by the preprocessor.
 *
 * @see TDD §8
 */
export type PreprocessorMediaType = 'image/jpeg' | 'application/pdf';

/**
 * Input payload for {@link PreprocessorPort.preprocess}.
 *
 * @see TDD §8
 */
export type PreprocessorInput = {
  readonly pages: readonly Buffer[];
  readonly mediaType: PreprocessorMediaType;
};

/**
 * Counts of pages dropped during preprocessing, by reason.
 *
 * @see TDD §8
 */
export type PreprocessorDropCounts = {
  readonly blank: number;
  readonly duplicate: number;
};

/**
 * Output produced by {@link PreprocessorPort.preprocess}. `pages` contains
 * only the pages that survived filtering; `originalPageCount` records the
 * pre-filter count so downstream audit logs can reconcile.
 *
 * @see TDD §8
 */
export type PreprocessedDocument = {
  readonly pages: readonly Buffer[];
  readonly dropped: PreprocessorDropCounts;
  readonly originalPageCount: number;
};

/**
 * Provider-agnostic preprocessor port.
 *
 * @see TDD §8
 */
export interface PreprocessorPort {
  preprocess(input: PreprocessorInput): Promise<PreprocessedDocument>;
}
