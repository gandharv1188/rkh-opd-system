import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('theme tokens', () => {
  it('defines royal blue and dis-accent', () => {
    const css = readFileSync(join(__dirname, '../src/theme/tokens.css'), 'utf-8');
    expect(css).toMatch(/--royal-blue:\s*#1a237e/);
    expect(css).toMatch(/--dis-accent:\s*var\(--royal-blue\)/);
  });

  it('defines spacing scale', () => {
    const css = readFileSync(join(__dirname, '../src/theme/tokens.css'), 'utf-8');
    expect(css).toMatch(/--dis-space-4:\s*1rem/);
  });
});
