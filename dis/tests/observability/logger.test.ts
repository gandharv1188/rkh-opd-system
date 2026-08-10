import { describe, it, expect } from 'vitest';
import { createLogger, withContext } from '../../src/observability/logger.js';
import { Writable } from 'node:stream';

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); },
  });
  const logger = createLogger({ destination: stream as unknown as import('pino').DestinationStream });
  return { logger, lines };
}

describe('observability logger', () => {
  it('emits JSON lines with correlation_id', () => {
    const { logger, lines } = captureLogger();
    withContext(logger, { correlation_id: 'corr-1' }).info({ msg: 'hello' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.correlation_id).toBe('corr-1');
    expect(parsed.msg).toBe('hello');
    expect(parsed.time).toMatch(/T\d/);
  });

  it('redacts known PII fields', () => {
    const { logger, lines } = captureLogger();
    logger.info({ patient_name: 'Ravi', uhid: 'RKH-1', phone: '98765', msg: 'audit' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.patient_name).toBe('[REDACTED]');
    expect(parsed.uhid).toBe('[REDACTED]');
    expect(parsed.phone).toBe('[REDACTED]');
    expect(parsed.msg).toBe('audit');
  });
});
