import type {
  PreprocessorPort,
  PreprocessorInput,
  PreprocessedDocument,
} from '../../ports/preprocessor.js';

export class FakePreprocessor implements PreprocessorPort {
  readonly calls: PreprocessorInput[] = [];

  async preprocess(input: PreprocessorInput): Promise<PreprocessedDocument> {
    this.calls.push(input);
    return {
      pages: input.pages,
      dropped: { blank: 0, duplicate: 0 },
      originalPageCount: input.pages.length,
    };
  }
}
