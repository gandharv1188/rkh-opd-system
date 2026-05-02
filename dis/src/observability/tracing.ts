export interface SpanRecord {
  readonly name: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly status: 'ok' | 'error';
  readonly errorMessage?: string;
}

export interface Tracer {
  withSpan<T>(
    name: string,
    attrs: Record<string, string | number | boolean>,
    fn: () => Promise<T>,
  ): Promise<T>;
  getRecords(): readonly SpanRecord[];
  reset(): void;
}

class InMemoryTracer implements Tracer {
  private records: SpanRecord[] = [];

  async withSpan<T>(
    name: string,
    attrs: Record<string, string | number | boolean>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const startTime = Date.now();
    try {
      const result = await fn();
      this.records.push({
        name,
        startTime,
        endTime: Date.now(),
        attributes: { ...attrs },
        status: 'ok',
      });
      return result;
    } catch (err) {
      this.records.push({
        name,
        startTime,
        endTime: Date.now(),
        attributes: { ...attrs },
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  getRecords(): readonly SpanRecord[] {
    return this.records.slice();
  }

  reset(): void {
    this.records = [];
  }
}

let defaultTracer: Tracer = new InMemoryTracer();

export function getTracer(): Tracer {
  return defaultTracer;
}

export function setTracer(t: Tracer): void {
  defaultTracer = t;
}

export function createInMemoryTracer(): Tracer {
  return new InMemoryTracer();
}
