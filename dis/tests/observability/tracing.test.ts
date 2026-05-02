import { describe, it, expect, beforeEach } from 'vitest';
import { createInMemoryTracer } from '../../src/observability/tracing.js';

describe('tracing', () => {
  let tracer: ReturnType<typeof createInMemoryTracer>;
  beforeEach(() => {
    tracer = createInMemoryTracer();
  });

  it('emits span per adapter call', async () => {
    await tracer.withSpan('adapter.ocr.extract', { provider: 'datalab' }, async () => {});
    const records = tracer.getRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.name).toBe('adapter.ocr.extract');
    expect(records[0]!.attributes.provider).toBe('datalab');
    expect(records[0]!.status).toBe('ok');
  });

  it('records error status on thrown span', async () => {
    await expect(
      tracer.withSpan('adapter.ocr.extract', {}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(tracer.getRecords()[0]!.status).toBe('error');
  });
});
