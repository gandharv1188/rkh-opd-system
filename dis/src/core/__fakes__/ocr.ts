import type { OcrPort, OcrInput, OcrResult } from '../../ports/ocr.js';

export class FakeOcr implements OcrPort {
  readonly calls: OcrInput[] = [];

  constructor(private readonly result: OcrResult | Error) {}

  async extract(input: OcrInput): Promise<OcrResult> {
    this.calls.push(input);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}
