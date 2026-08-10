import { describe, it, expect } from 'vitest';
import { sha256 } from '../../src/core/content-hash.js';

describe('content-hash (DIS-027)', () => {
  const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

  it('hashes empty input to the canonical empty-sha256 digest', () => {
    expect(sha256('')).toBe(EMPTY_SHA256);
    expect(sha256(Buffer.alloc(0))).toBe(EMPTY_SHA256);
    expect(sha256(new Uint8Array(0))).toBe(EMPTY_SHA256);
  });

  it('hashes the canonical "abc" test vector', () => {
    expect(sha256('abc')).toBe(ABC_SHA256);
  });

  it('accepts Buffer input', () => {
    expect(sha256(Buffer.from('abc', 'utf8'))).toBe(ABC_SHA256);
  });

  it('accepts Uint8Array input', () => {
    const u8 = new Uint8Array([0x61, 0x62, 0x63]);
    expect(sha256(u8)).toBe(ABC_SHA256);
  });

  it('hashes UTF-8 strings identically to their byte representation', () => {
    const s = 'hello from DIS';
    const asBuf = Buffer.from(s, 'utf8');
    expect(sha256(s)).toBe(sha256(asBuf));
  });

  it('returns a 64-char lowercase hex digest', () => {
    const out = sha256('anything');
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });
});
