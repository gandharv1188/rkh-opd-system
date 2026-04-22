import { describe, it, expect } from 'vitest';
import { loadEnv, EnvValidationError } from '../../src/core/env.js';

function baseEnv(): Record<string, string> {
  return {
    DIS_STACK: 'supabase',
    DIS_OCR_PROVIDER: 'datalab',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srv-key',
    ANTHROPIC_API_KEY: 'ak-xxx',
    DATALAB_API_KEY: 'dl-xxx',
  };
}

describe('loadEnv', () => {
  it('returns a parsed Env object with defaults', () => {
    const env = loadEnv(baseEnv());
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.DIS_MAX_UPLOAD_MB).toBe(50);
    expect(env.DIS_MAX_PAGES).toBe(50);
    expect(env.DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE).toBe(100);
    expect(env.DIS_KILL_SWITCH).toBe(false);
    expect(env.DIS_STRUCTURING_PROVIDER).toBe('haiku');
  });

  it('coerces numeric strings', () => {
    const env = loadEnv({ ...baseEnv(), PORT: '8080', DIS_MAX_UPLOAD_MB: '25' });
    expect(env.PORT).toBe(8080);
    expect(env.DIS_MAX_UPLOAD_MB).toBe(25);
  });

  it('parses DIS_KILL_SWITCH "true" into boolean true', () => {
    const env = loadEnv({ ...baseEnv(), DIS_KILL_SWITCH: 'true' });
    expect(env.DIS_KILL_SWITCH).toBe(true);
  });

  it('parses DIS_KILL_SWITCH "1" into boolean true', () => {
    const env = loadEnv({ ...baseEnv(), DIS_KILL_SWITCH: '1' });
    expect(env.DIS_KILL_SWITCH).toBe(true);
  });

  it('throws EnvValidationError with readable message when ANTHROPIC_API_KEY missing', () => {
    const src = baseEnv();
    delete src.ANTHROPIC_API_KEY;
    expect(() => loadEnv(src)).toThrow(EnvValidationError);
    try {
      loadEnv(src);
    } catch (e) {
      expect(String(e)).toContain('ANTHROPIC_API_KEY');
    }
  });

  it('requires SUPABASE_URL when DIS_STACK=supabase', () => {
    const src = baseEnv();
    delete src.SUPABASE_URL;
    expect(() => loadEnv(src)).toThrow(EnvValidationError);
    try {
      loadEnv(src);
    } catch (e) {
      expect(String(e)).toContain('SUPABASE_URL');
    }
  });

  it('requires SUPABASE_SERVICE_ROLE_KEY when DIS_STACK=supabase', () => {
    const src = baseEnv();
    delete src.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => loadEnv(src)).toThrow(EnvValidationError);
  });

  it('does not require SUPABASE_* when DIS_STACK=aws', () => {
    const src = baseEnv();
    src.DIS_STACK = 'aws';
    delete src.SUPABASE_URL;
    delete src.SUPABASE_SERVICE_ROLE_KEY;
    const env = loadEnv(src);
    expect(env.DIS_STACK).toBe('aws');
  });

  it('requires DATALAB_API_KEY when DIS_OCR_PROVIDER=datalab', () => {
    const src = baseEnv();
    delete src.DATALAB_API_KEY;
    expect(() => loadEnv(src)).toThrow(EnvValidationError);
  });

  it('does not require DATALAB_API_KEY when DIS_OCR_PROVIDER=claude', () => {
    const src = baseEnv();
    src.DIS_OCR_PROVIDER = 'claude';
    delete src.DATALAB_API_KEY;
    const env = loadEnv(src);
    expect(env.DIS_OCR_PROVIDER).toBe('claude');
  });

  it('rejects invalid NODE_ENV', () => {
    const src = { ...baseEnv(), NODE_ENV: 'staging' };
    expect(() => loadEnv(src)).toThrow(EnvValidationError);
  });

  it('rejects invalid SUPABASE_URL (not a URL)', () => {
    const src = { ...baseEnv(), SUPABASE_URL: 'not-a-url' };
    expect(() => loadEnv(src)).toThrow(EnvValidationError);
  });

  it('rejects invalid DIS_STRUCTURING_PROVIDER', () => {
    const src = { ...baseEnv(), DIS_STRUCTURING_PROVIDER: 'opus' };
    expect(() => loadEnv(src)).toThrow(EnvValidationError);
  });
});
