import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getStructuringPrompt } from '../../src/core/prompts/loader.js';

describe('getStructuringPrompt', () => {
  it('loads the prompt text without error and returns a non-empty string', () => {
    const p = getStructuringPrompt();
    expect(typeof p.text).toBe('string');
    expect(p.text.length).toBeGreaterThan(0);
  });

  it('exposes a version string derived from frontmatter', () => {
    const p = getStructuringPrompt();
    expect(p.version).toBe('1');
  });

  it('exposes a stable sha256 contentHash across repeated reads', () => {
    const a = getStructuringPrompt();
    const b = getStructuringPrompt();
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('contentHash matches sha256 of the returned text body', () => {
    const p = getStructuringPrompt();
    const expected = createHash('sha256').update(p.text, 'utf8').digest('hex');
    expect(p.contentHash).toBe(expected);
  });

  it('the underlying structuring.md file is at least 5 lines (VERIFY-2)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const promptPath = resolve(here, '..', '..', 'src', 'core', 'prompts', 'structuring.md');
    const raw = readFileSync(promptPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});
