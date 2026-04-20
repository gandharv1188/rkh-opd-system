#!/usr/bin/env node
/**
 * port-validator.mjs — backward-compat wrapper.
 *
 * Control 3 generalizes the original port validator into fitness.mjs. This
 * wrapper delegates to fitness.mjs with --only filtering the two rules that
 * reproduce the legacy behaviour (core + ports may not import adapters).
 *
 * Kept so existing CI jobs / docs that reference `port-validator.mjs` keep
 * working. New rules live in dis/scripts/fitness-rules.json.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, 'fitness.mjs');
const r = spawnSync(
  process.execPath,
  [target, '--only', 'core_no_adapter_imports,ports_no_adapter_imports'],
  { stdio: 'inherit' },
);
process.exit(r.status ?? 1);
