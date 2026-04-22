import type {
  StructuringPort,
  StructuringInput,
  StructuringResult,
} from '../../ports/structuring.js';

export class FakeStructuring implements StructuringPort {
  readonly calls: StructuringInput[] = [];

  constructor(private readonly result: StructuringResult | Error) {}

  async structure(input: StructuringInput): Promise<StructuringResult> {
    this.calls.push(input);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}
