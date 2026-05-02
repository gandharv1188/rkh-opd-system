import type {
  PreprocessorPort,
  PreprocessorInput,
  PreprocessedDocument,
} from '../../ports/preprocessor.js';

export class PreprocessorPageCapError extends Error {
  readonly code = 'PREPROCESSOR_PAGE_CAP_EXCEEDED' as const;
  constructor(
    readonly pageCount: number,
    readonly cap: number,
  ) {
    super(`Preprocessor page cap exceeded: ${pageCount} > ${cap}`);
    this.name = 'PreprocessorPageCapError';
  }
}

/**
 * DefaultPreprocessor — v1 stub.
 *
 * Currently a type-safe passthrough. Real pipeline (deskew, blank-page drop,
 * duplicate-page detection, resize, CLAHE, JPEG encode) is deferred to
 * DIS-058b once the OCR path proves correct end-to-end.
 *
 * @see TDD §8 for the eventual steps.
 */
// lint-allow: TODO — DIS-058b (real pipeline)
export class DefaultPreprocessor implements PreprocessorPort {
  constructor(private readonly opts: { pageCap?: number } = {}) {}

  async preprocess(input: PreprocessorInput): Promise<PreprocessedDocument> {
    const cap = this.opts.pageCap ?? 50;
    const pages = input.pages;
    if (pages.length > cap) {
      throw new PreprocessorPageCapError(pages.length, cap);
    }
    return {
      pages,
      dropped: { blank: 0, duplicate: 0 },
      originalPageCount: pages.length,
    };
  }
}
