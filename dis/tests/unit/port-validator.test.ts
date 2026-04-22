import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// dis/tests/unit/port-validator.test.ts → dis root is two levels up.
const disRoot = resolve(__dirname, '..', '..');
const script = resolve(disRoot, 'scripts', 'port-validator.sh');

describe('port-validator.sh (DIS-011)', () => {
  it('script file exists and is tracked', () => {
    expect(existsSync(script)).toBe(true);
  });

  it('exits 0 on the current (clean) tree', () => {
    const r = spawnSync('bash', [script], {
      cwd: disRoot,
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      throw new Error(
        `port-validator.sh exited ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
      );
    }
    expect(r.status).toBe(0);
  });

  it('references the adapters/ directory in its rule', () => {
    const r = spawnSync('bash', ['-c', `grep -cE "adapters/" "${script}"`], {
      encoding: 'utf8',
    });
    const count = parseInt((r.stdout || '0').trim(), 10);
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
