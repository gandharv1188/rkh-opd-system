import { describe, it, expect } from 'vitest';
import { redact } from '../../src/observability/pii-redactor.js';

describe('PII redactor (CS-8)', () => {
  it('masks UHID in nested objects', () => {
    const input = {
      extraction_id: 'ext-1',
      patient: { uhid: 'RKH-2501-00042', name: 'Ravi', age: 7 },
      metadata: [{ uhid: 'RKH-2501-00043' }],
    };
    const out = redact(input) as typeof input;
    expect(out.patient.uhid).toBe('[REDACTED]');
    expect(out.patient.name).toBe('[REDACTED]');
    expect(out.patient.age).toBe(7);
    expect(out.metadata[0]!.uhid).toBe('[REDACTED]');
  });

  it('leaves non-PII fields intact', () => {
    const out = redact({ correlation_id: 'corr-1', extraction_id: 'ext-1' }) as Record<string, unknown>;
    expect(out.correlation_id).toBe('corr-1');
    expect(out.extraction_id).toBe('ext-1');
  });

  it('is case-insensitive', () => {
    const out = redact({ DOB: '1990-01-01', Phone: '98765' }) as Record<string, unknown>;
    expect(out.DOB).toBe('[REDACTED]');
    expect(out.Phone).toBe('[REDACTED]');
  });

  it('handles arrays and primitives safely', () => {
    expect(redact(['ok', 5, null, undefined])).toEqual(['ok', 5, null, undefined]);
    expect(redact('string')).toBe('string');
    expect(redact(42)).toBe(42);
  });
});
