#!/usr/bin/env node
/**
 * check-forbidden-tokens.mjs — Control 7 from drift_prevention.md §3.
 *
 * Scans dis/src/**\/*.ts (excluding tests + fakes) for:
 *   TODO, FIXME, XXX, HACK, console.log, debugger, .only, .skip
 *
 * Inline escape hatch: `// lint-allow: <TOKEN> — DIS-###` on the same line
 * or the line immediately above (must include a DIS-### ticket reference).
 *
 * Flags:
 *   --root <dir>   scan a synthetic tree (used by self-tests)
 *
 * Exits 1 with a list of offenders; 0 if clean.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

const root = resolve(argValue('--root') ?? '.');
const scanRoot = join(root, 'dis', 'src');

const TOKENS = [
  { name: 'TODO', re: /\bTODO\b/ },
  { name: 'FIXME', re: /\bFIXME\b/ },
  { name: 'XXX', re: /\bXXX\b/ },
  { name: 'HACK', re: /\bHACK\b/ },
  { name: 'console.log', re: /console\.log\s*\(/ },
  { name: 'debugger', re: /\bdebugger\b/ },
  { name: '.only', re: /\.only\s*\(/ },
  { name: '.skip', re: /\.skip\s*\(/ },
];

const ALLOW_RE = /lint-allow:\s*([A-Za-z.]+)\s*[—-]\s*DIS-\d+/;

function toPosix(p) {
  return p.split('\\').join('/');
}

function walkTs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__fakes__' || entry === 'tests' || entry === '__tests__') continue;
      out.push(...walkTs(full));
    } else if (st.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function allowedByComment(tokenName, lineText, prevLineText) {
  for (const text of [lineText, prevLineText]) {
    if (!text) continue;
    const m = text.match(ALLOW_RE);
    if (m && m[1] === tokenName) return true;
  }
  return false;
}

function main() {
  const files = walkTs(scanRoot);
  const offenders = [];
  for (const abs of files) {
    const rel = toPosix(relative(root, abs));
    const text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const tok of TOKENS) {
        if (!tok.re.test(line)) continue;
        if (allowedByComment(tok.name, line, lines[i - 1])) continue;
        offenders.push(`${rel}:${i + 1}: [${tok.name}] ${line.trim()}`);
      }
    }
  }
  if (offenders.length) {
    process.stderr.write(offenders.join('\n') + '\n');
    process.stderr.write(`check-forbidden-tokens: ${offenders.length} offender(s).\n`);
    process.exit(1);
  }
  process.stdout.write(`check-forbidden-tokens: clean (${files.length} file(s) scanned).\n`);
  process.exit(0);
}

main();
