import { describe, expect, it } from 'vitest';
import { toEnvelope } from '../../src/core/error-envelope.js';
import { withCorrelation, newCorrelationId } from '../../src/core/correlation.js';
import { VersionConflictError } from '../../src/core/orchestrator.js';
import { InvalidStateTransitionError } from '../../src/core/state-machine.js';
import {
  OcrProviderTimeoutError,
  OcrProviderRateLimitedError,
} from '../../src/adapters/ocr/datalab-chandra.js';

describe('toEnvelope', () => {
  it('maps OcrProviderTimeoutError → OCR_PROVIDER_TIMEOUT (explicit override)', () => {
    const err = new OcrProviderTimeoutError('datalab timed out', {
      provider: 'datalab',
      waitedMs: 30000,
    });
    const env = toEnvelope(err, 'cid-1');
    expect(env.error.code).toBe('OCR_PROVIDER_TIMEOUT');
    expect(env.error.correlation_id).toBe('cid-1');
    expect(typeof env.error.message).toBe('string');
  });

  it('maps OcrProviderRateLimitedError → RATE_LIMITED (explicit override)', () => {
    const err = new OcrProviderRateLimitedError('429 from datalab', {
      provider: 'datalab',
      retryAfterSec: 5,
    });
    const env = toEnvelope(err, 'cid-2');
    expect(env.error.code).toBe('RATE_LIMITED');
  });

  it('maps VersionConflictError → VERSION_CONFLICT (explicit override)', () => {
    const err = new VersionConflictError('ext-1', 1, 'verified');
    const env = toEnvelope(err, 'cid-3');
    expect(env.error.code).toBe('VERSION_CONFLICT');
  });

  it('maps InvalidStateTransitionError → INVALID_STATE_TRANSITION via name-derivation', () => {
    const err = new InvalidStateTransitionError('promoted', { kind: 'policy_auto_approved' });
    const env = toEnvelope(err, 'cid-4');
    expect(env.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('maps unknown Error → INTERNAL_ERROR', () => {
    const env = toEnvelope(new Error('kaboom'), 'cid-5');
    expect(env.error.code).toBe('INTERNAL_ERROR');
  });

  it('maps non-Error throwables → INTERNAL_ERROR', () => {
    expect(toEnvelope('string thrown', 'cid-6').error.code).toBe('INTERNAL_ERROR');
    expect(toEnvelope(undefined, 'cid-7').error.code).toBe('INTERNAL_ERROR');
    expect(toEnvelope({ weird: true }, 'cid-8').error.code).toBe('INTERNAL_ERROR');
  });

  it('derives UPPER_SNAKE_CASE code from any *Error class name minus "Error"', () => {
    class FooBarBazError extends Error {
      constructor() {
        super('test');
        this.name = 'FooBarBazError';
      }
    }
    const env = toEnvelope(new FooBarBazError(), 'cid-9');
    expect(env.error.code).toBe('FOO_BAR_BAZ');
  });

  it('falls back to ALS correlation_id when caller omits it', () => {
    const id = newCorrelationId();
    const env = withCorrelation(id, () => toEnvelope(new Error('x')));
    expect(env.error.correlation_id).toBe(id);
  });

  it('uses "unknown" when no correlation_id is available', () => {
    const env = toEnvelope(new Error('x'));
    expect(env.error.correlation_id).toBe('unknown');
  });

  it('preserves the error message in the envelope', () => {
    const env = toEnvelope(new Error('something specific'), 'cid-10');
    expect(env.error.message).toBe('something specific');
  });
});
