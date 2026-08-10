#!/usr/bin/env node
/**
 * DIS-173 — Fixture generator CLI.
 * Produces N synthetic clinical-extraction JSON files into an output dir.
 *
 * Usage: node dis/scripts/gen-fixtures.mjs --count=10 --out=/tmp/dis-fixtures
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit } from 'node:process';

function parseArgs(args) {
  const opts = {};
  for (const arg of args) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) opts[m[1]] = m[2] ?? 'true';
  }
  return opts;
}

const opts = parseArgs(argv.slice(2));
const count = Number(opts.count ?? 10);
const outDir = opts.out ?? './gen-fixtures';

if (!Number.isFinite(count) || count <= 0) {
  console.error('ERROR: --count must be a positive integer');
  exit(1);
}
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const TESTS = ['Hb', 'Glucose', 'HbA1c', 'Creatinine', 'WBC'];
const UNITS = { Hb: 'g/dL', Glucose: 'mg/dL', HbA1c: '%', Creatinine: 'mg/dL', WBC: 'x10^3/uL' };
const RANGES = { Hb: [8, 16], Glucose: [70, 200], HbA1c: [4.5, 10], Creatinine: [0.5, 2.5], WBC: [4, 15] };

function seeded(i) { return ((i * 9301 + 49297) % 233280) / 233280; }

function makeFixture(i) {
  const patientId = `pt-gen-${String(i).padStart(4, '0')}`;
  const fields = TESTS.map((t, j) => {
    const [lo, hi] = RANGES[t];
    const v = Number((lo + (hi - lo) * seeded(i * 5 + j)).toFixed(2));
    return { name: t, value: v, unit: UNITS[t] };
  });
  return {
    schema_version: '1',
    kind: 'lab_report',
    patient_id: patientId,
    collected_at: new Date(Date.UTC(2026, 3, 22)).toISOString(),
    results: fields,
  };
}

for (let i = 0; i < count; i++) {
  const fixture = makeFixture(i);
  const path = join(outDir, `fixture-${String(i).padStart(4, '0')}.json`);
  writeFileSync(path, JSON.stringify(fixture, null, 2));
}

console.log(`Generated ${count} fixtures in ${outDir}`);
