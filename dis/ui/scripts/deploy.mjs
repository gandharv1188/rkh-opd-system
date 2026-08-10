#!/usr/bin/env node
/* DIS-140 — deploy stub. Real upload wired post-INTEGRATION APPROVED. */
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
if (!existsSync(dist)) {
  console.error('deploy.mjs: dis/ui/dist missing — run `npm run build` first.');
  process.exit(1);
}
const files = readdirSync(dist, { recursive: true });
console.log(`[DIS-140 deploy stub] dist has ${files.length} entries.`);
console.log('Deployment target not yet wired; gated by INTEGRATION APPROVED per 06_rollout/rollout.md §6b.');
