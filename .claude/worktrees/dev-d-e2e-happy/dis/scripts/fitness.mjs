#!/usr/bin/env node
/**
 * fitness.mjs — Control 3 from drift_prevention.md §3.
 *
 * Declarative architectural fitness functions. Loads
 * dis/scripts/fitness-rules.json and scans the repo. Each rule:
 *   - name                  short identifier
 *   - description           human summary
 *   - glob                  path matcher (supports **, *, simple braces)
 *   - glob_exclude          optional list of path matchers to exclude
 *   - forbidden_pattern     regex source (JS)
 *   - flags                 optional regex flags
 *   - message               error text
 *
 * Exits 1 with a list of violations; 0 if clean.
 *
 * Supports `--root <dir>` to scan a synthetic tree (used by self-tests).
 * Supports `--rules <file>` to override the rules file.
 * Supports `--only <name,...>` to filter by rule name (used by the legacy
 * port-validator wrapper).
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

const root = resolve(argValue('--root') ?? '.');
const rulesPath = resolve(
  argValue('--rules') ?? join(root, 'dis', 'scripts', 'fitness-rules.json'),
);
const onlyArg = argValue('--only');
const onlyNames = onlyArg ? onlyArg.split(',').map((s) => s.trim()) : null;

function toPosix(p) {
  return p.split('\\').join('/');
}

/**
 * Convert a glob with **, *, ? into a RegExp. We deliberately keep this
 * small; rules should be simple path prefixes + wildcards.
 */
function globToRegExp(glob) {
  const g = toPosix(glob);
  let out = '^';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        out += '.*';
        i++;
        if (g[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  out += '$';
  return new RegExp(out);
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (st.isFile()) out.push(full);
  }
  return out;
}

function loadRules() {
  if (!existsSync(rulesPath)) {
    process.stderr.write(`fitness: rules file not found: ${rulesPath}\n`);
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(rulesPath, 'utf8'));
  return onlyNames ? raw.filter((r) => onlyNames.includes(r.name)) : raw;
}

function matchesAny(rel, globs) {
  return globs.some((g) => globToRegExp(g).test(rel));
}

function main() {
  const rules = loadRules();
  const scanRoot = join(root, 'dis', 'src');
  const files = walk(scanRoot).map((f) => toPosix(relative(root, f)));
  const violations = [];
  for (const rule of rules) {
    const includeRe = globToRegExp(rule.glob);
    const excludes = rule.glob_exclude ?? [];
    const re = new RegExp(rule.forbidden_pattern, rule.flags ?? '');
    for (const rel of files) {
      if (!includeRe.test(rel)) continue;
      if (excludes.length && matchesAny(rel, excludes)) continue;
      const abs = join(root, rel);
      const text = readFileSync(abs, 'utf8');
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          violations.push(
            `${rel}:${i + 1}: [${rule.name}] ${rule.message} — "${lines[i].trim().slice(0, 120)}"`,
          );
        }
      }
    }
  }
  if (violations.length) {
    process.stderr.write(violations.join('\n') + '\n');
    process.stderr.write(
      `fitness: ${violations.length} violation(s) across ${rules.length} rule(s).\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `fitness: no violations (${rules.length} rule(s), ${files.length} file(s) scanned).\n`,
  );
  process.exit(0);
}

main();
