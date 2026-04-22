import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from '../../src/core/logger.js';

function capture(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { stream, lines };
}

describe('createLogger', () => {
  it('emits structured JSON lines with service + version base fields', () => {
    const { stream, lines } = capture();
    const log = createLogger({ service: 'dis', version: '1.2.3', destination: stream });

    log.info({ event: 'boot' }, 'service up');

    expect(lines.length).toBe(1);
    const row = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(row.service).toBe('dis');
    expect(row.version).toBe('1.2.3');
    expect(row.event).toBe('boot');
    expect(row.msg).toBe('service up');
    expect(typeof row.time).toBe('number');
    expect(typeof row.level).toBe('number');
  });

  it('binds a correlation_id via child() that is included on every emission', () => {
    const { stream, lines } = capture();
    const log = createLogger({ service: 'dis', version: '0.0.1', destination: stream });
    const child = log.child({ correlation_id: 'abc-123' });

    child.info('first');
    child.warn('second');

    expect(lines.length).toBe(2);
    for (const line of lines) {
      const row = JSON.parse(line) as Record<string, unknown>;
      expect(row.correlation_id).toBe('abc-123');
      expect(row.service).toBe('dis');
    }
  });

  it('respects the configured log level (info suppresses debug)', () => {
    const { stream, lines } = capture();
    const log = createLogger({ service: 'dis', version: '0.0.1', level: 'info', destination: stream });

    log.debug('hidden');
    log.info('shown');

    expect(lines.length).toBe(1);
    const row = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(row.msg).toBe('shown');
  });
});
