#!/usr/bin/env node
/**
 * check-pr-citations.mjs — Control 1 from drift_prevention.md §3.
 *
 * Scans PR body for TDD §X[.Y], CS-##, DIS-US-### citations and verifies
 * each resolves to an anchor in the corresponding source-of-truth file.
 *
 * Inputs:
 *   --body "<text>"         local dry-run (overrides GITHUB_EVENT_PATH)
 *   GITHUB_EVENT_PATH env   GitHub Actions PR event JSON path
 *   (fallback)              `gh pr view --json body -q .body`
 *
 * Exits 0 when every citation resolves; 1 otherwise.
 * Exits 0 with a warning if no citations are present — Control 1 as
 * written verifies *stated* citations, not their presence. (Gate 5
 * reviewers still reject uncited PRs.)
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// scripts live at <repo>/dis/scripts/; docs live at <repo>/dis/document_ingestion_service/
const DOCS = resolve(__dirname, '..', 'document_ingestion_service');
const SOURCES = {
  tdd: `${DOCS}/02_architecture/tdd.md`,
  cs: `${DOCS}/01_product/clinical_safety.md`,
  us: `${DOCS}/01_product/user_stories.md`,
  cstd: `${DOCS}/02_architecture/coding_standards.md`,
};

function argBody() {
  const i = process.argv.indexOf('--body');
  if (i !== -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  return null;
}

function readEventBody() {
  const p = process.env.GITHUB_EVENT_PATH;
  if (!p || !existsSync(p)) return null;
  try {
    const ev = JSON.parse(readFileSync(p, 'utf8'));
    return ev?.pull_request?.body ?? null;
  } catch {
    return null;
  }
}

function readGhBody() {
  try {
    return execFileSync('gh', ['pr', 'view', '--json', 'body', '-q', '.body'], {
      encoding: 'utf8',
    });
  } catch {
    return null;
  }
}

function getBody() {
  return argBody() ?? readEventBody() ?? readGhBody() ?? '';
}

function readSource(key) {
  const p = SOURCES[key];
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf8');
}

/**
 * Extract citations. Matches:
 *   TDD §4, TDD §4.2, TDD 4.2
 *   CS-1, CS-12
 *   DIS-US-001
 *   CS § (coding standards) §1, §2 — via "CS §" is ambiguous with CS-##;
 *     we only match "coding_standards.md §N" explicitly.
 */
function extractCitations(body) {
  const tdd = [...body.matchAll(/TDD\s*§?\s*(\d+(?:\.\d+)?)/g)].map((m) => m[1]);
  const cs = [...body.matchAll(/\bCS-(\d+)\b/g)].map((m) => m[1]);
  const us = [...body.matchAll(/\bDIS-US-(\d+)\b/g)].map((m) => m[1]);
  const cstd = [...body.matchAll(/coding_standards\.md\s*§?\s*(\d+(?:\.\d+)?)/gi)].map((m) => m[1]);
  return { tdd, cs, us, cstd };
}

function resolveTdd(section, src) {
  // Top-level: "## §N." — sub: "### N.M."
  if (!section.includes('.')) {
    const re = new RegExp(`^##\\s+§${section}\\.`, 'm');
    return re.test(src);
  }
  const esc = section.replace('.', '\\.');
  const re = new RegExp(`^###\\s+${esc}\\.`, 'm');
  return re.test(src);
}

function resolveCs(num, src) {
  const re = new RegExp(`^##\\s+CS-${num}:`, 'm');
  return re.test(src);
}

function resolveUs(num, src) {
  const re = new RegExp(`^###\\s+DIS-US-${num}\\b`, 'm');
  return re.test(src);
}

function resolveCstd(section, src) {
  if (!section.includes('.')) {
    const re = new RegExp(`^##\\s+§?${section}\\.`, 'm');
    return re.test(src);
  }
  const esc = section.replace('.', '\\.');
  const re = new RegExp(`^###\\s+§?${esc}\\.`, 'm');
  return re.test(src);
}

function main() {
  const body = getBody();
  const cites = extractCitations(body);
  const total = cites.tdd.length + cites.cs.length + cites.us.length + cites.cstd.length;
  if (total === 0) {
    process.stdout.write('check-pr-citations: no citations found in PR body (advisory).\n');
    process.exit(0);
  }
  const tddSrc = readSource('tdd');
  const csSrc = readSource('cs');
  const usSrc = readSource('us');
  const cstdSrc = readSource('cstd');
  const broken = [];
  for (const s of cites.tdd) if (!resolveTdd(s, tddSrc)) broken.push(`TDD §${s}`);
  for (const n of cites.cs) if (!resolveCs(n, csSrc)) broken.push(`CS-${n}`);
  for (const n of cites.us) if (!resolveUs(n, usSrc)) broken.push(`DIS-US-${n}`);
  for (const s of cites.cstd) if (!resolveCstd(s, cstdSrc)) broken.push(`coding_standards §${s}`);
  if (broken.length) {
    process.stderr.write(`check-pr-citations: broken citations:\n  - ${broken.join('\n  - ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`check-pr-citations: all ${total} citation(s) resolved.\n`);
  process.exit(0);
}

main();
