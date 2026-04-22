#!/usr/bin/env node
/**
 * drift-controls.test.mjs — smoke tests for Phase 1 drift controls.
 *
 * Pure Node, no external test runner. Runs each script via spawnSync
 * against fixture trees under dis/scripts/__tests__/fixtures/ and asserts
 * exit codes + expected substrings in stderr/stdout.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const scriptsDir = resolve(here, '..');
const fixtures = resolve(here, 'fixtures');

const results = [];

function run(label, cmd, args, { expectExit, expectStderrIncludes } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  const pass =
    (expectExit === undefined || r.status === expectExit) &&
    (!expectStderrIncludes ||
      (r.stderr ?? '').includes(expectStderrIncludes) ||
      (r.stdout ?? '').includes(expectStderrIncludes));
  results.push({ label, pass, status: r.status, stderr: r.stderr, stdout: r.stdout });
  return pass;
}

// 1. fitness.mjs against violating fixture → exit 1 + mentions core_no_adapter_imports
run(
  'fitness.mjs flags violating fixture',
  process.execPath,
  [
    resolve(scriptsDir, 'fitness.mjs'),
    '--root',
    resolve(fixtures, 'violating'),
    '--rules',
    resolve(fixtures, 'violating/dis/scripts/fitness-rules.json'),
  ],
  { expectExit: 1, expectStderrIncludes: 'core_no_adapter_imports' },
);

// 2. check-forbidden-tokens.mjs against raw TODO → exit 1
run(
  'check-forbidden-tokens flags raw TODO',
  process.execPath,
  [resolve(scriptsDir, 'check-forbidden-tokens.mjs'), '--root', resolve(fixtures, 'tokens_raw')],
  { expectExit: 1, expectStderrIncludes: 'TODO' },
);

// 3. check-forbidden-tokens.mjs against allowed TODO → exit 0
run(
  'check-forbidden-tokens honors lint-allow',
  process.execPath,
  [
    resolve(scriptsDir, 'check-forbidden-tokens.mjs'),
    '--root',
    resolve(fixtures, 'tokens_allowed'),
  ],
  { expectExit: 0 },
);

// 4. check-pr-citations.mjs broken → exit 1
run(
  'check-pr-citations rejects non-existent TDD §99.99',
  process.execPath,
  [resolve(scriptsDir, 'check-pr-citations.mjs'), '--body', 'Implements TDD §99.99'],
  { expectExit: 1 },
);

// 5. check-pr-citations.mjs real → exit 0
run(
  'check-pr-citations accepts real TDD §4',
  process.execPath,
  [resolve(scriptsDir, 'check-pr-citations.mjs'), '--body', 'Implements TDD §4'],
  { expectExit: 0 },
);

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  process.stdout.write(`${r.pass ? 'PASS' : 'FAIL'}: ${r.label} (exit=${r.status})\n`);
  if (!r.pass) {
    process.stdout.write(`  stderr: ${(r.stderr ?? '').trim()}\n`);
    process.stdout.write(`  stdout: ${(r.stdout ?? '').trim()}\n`);
  }
}
process.stdout.write(`\n${results.length - failed.length}/${results.length} tests passed.\n`);
process.exit(failed.length ? 1 : 0);
