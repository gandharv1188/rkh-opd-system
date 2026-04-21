#!/usr/bin/env node
/**
 * check-files-touched.mjs — Control 2 from drift_prevention.md §3.
 *
 * Reads ticket ID from the current branch (feat/dis-NNN-...) or TICKET_ID env,
 * fetches the ticket section from 07_tickets/backlog.md or integration_hold.md,
 * parses the `files_allowed:` YAML list, and compares against the PR diff.
 *
 * Fails (exit 1) if any changed file is not listed in files_allowed.
 *
 * Flags:
 *   --verbose                print the full diff summary
 *   --base <ref>             override base (default: merge-base with
 *                            origin/feat/dis-plan; falls back to feat/dis-plan, main)
 *   --ticket-file <path>     look for the ticket in this file instead of the
 *                            default backlog + integration_hold search
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const DOCS = resolve('dis/document_ingestion_service');
const TICKET_SOURCES = [
  `${DOCS}/07_tickets/backlog.md`,
  `${DOCS}/07_tickets/integration_hold.md`,
  `${DOCS}/07_tickets/in_progress.md`,
  `${DOCS}/07_tickets/done.md`,
];

function hasFlag(name) {
  return process.argv.includes(name);
}

function flagValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function currentBranch() {
  try {
    return git('rev-parse', '--abbrev-ref', 'HEAD');
  } catch {
    return '';
  }
}

function extractTicketId() {
  if (process.env.TICKET_ID) return process.env.TICKET_ID.replace(/^DIS-?/, '');
  const branch = currentBranch();
  const m = branch.match(/feat\/dis-(\d+)/i);
  return m ? m[1] : null;
}

function findTicketBlock(ticketId, overridePath) {
  const files = overridePath ? [overridePath] : TICKET_SOURCES;
  const header = new RegExp(`^###\\s+DIS-${ticketId}\\b`, 'm');
  for (const f of files) {
    if (!existsSync(f)) continue;
    const src = readFileSync(f, 'utf8');
    const start = src.search(header);
    if (start === -1) continue;
    const rest = src.slice(start + 1);
    const nextIdx = rest.search(/^###\s+DIS-\d+\b/m);
    const end = nextIdx === -1 ? src.length : start + 1 + nextIdx;
    return { source: f, block: src.slice(start, end) };
  }
  return null;
}

/**
 * Parse a minimal YAML subset from a fenced `yaml` block inside the ticket.
 * We only need `files_allowed:` as a list of string items.
 */
function parseFilesAllowed(block) {
  const yamlFence = block.match(/```ya?ml\s*([\s\S]*?)```/i);
  if (!yamlFence) return null;
  const yaml = yamlFence[1];
  const lines = yaml.split(/\r?\n/);
  let inList = false;
  const out = [];
  for (const line of lines) {
    if (/^\s*files_allowed\s*:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (inList) {
      const m = line.match(/^\s*-\s+(.+?)\s*$/);
      if (m) {
        out.push(m[1].replace(/^['"]|['"]$/g, ''));
        continue;
      }
      if (/^\s*[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(line)) {
        inList = false;
      }
    }
  }
  return out;
}

function resolveBase() {
  const override = flagValue('--base');
  if (override) return override;
  const candidates = ['origin/feat/dis-plan', 'feat/dis-plan', 'origin/main', 'main'];
  for (const c of candidates) {
    try {
      return git('merge-base', 'HEAD', c);
    } catch {
      /* try next */
    }
  }
  return 'HEAD~1';
}

function changedFiles(base) {
  try {
    const out = git('diff', '--name-only', `${base}...HEAD`);
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

/** Match a path against an allowlist entry. Supports simple `*` globs. */
function matchesEntry(file, entry) {
  if (file === entry) return true;
  if (!entry.includes('*')) return false;
  const re = new RegExp(
    '^' +
      entry
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$',
  );
  return re.test(file);
}

function main() {
  const verbose = hasFlag('--verbose');
  const ticketFile = flagValue('--ticket-file');
  const ticketId = extractTicketId();
  if (!ticketId) {
    process.stderr.write(
      'check-files-touched: could not determine ticket ID from branch or TICKET_ID env.\n',
    );
    process.exit(1);
  }
  const found = findTicketBlock(ticketId, ticketFile);
  if (!found) {
    process.stderr.write(
      `check-files-touched: ticket DIS-${ticketId} not found in backlog/integration_hold/in_progress/done.\n`,
    );
    process.exit(1);
  }
  const allowed = parseFilesAllowed(found.block);
  if (!allowed || allowed.length === 0) {
    process.stderr.write(
      `check-files-touched: DIS-${ticketId} has no files_allowed: YAML list in ${found.source}.\n`,
    );
    process.exit(1);
  }
  const base = resolveBase();
  const files = changedFiles(base);
  if (verbose) {
    process.stdout.write(
      `base=${base}\nallowed(${allowed.length}):\n  - ${allowed.join(
        '\n  - ',
      )}\nchanged(${files.length}):\n  - ${files.join('\n  - ')}\n`,
    );
  }
  const offenders = files.filter((f) => !allowed.some((a) => matchesEntry(f, a)));
  if (offenders.length) {
    process.stderr.write(
      `check-files-touched: DIS-${ticketId} touched files outside files_allowed:\n  - ${offenders.join(
        '\n  - ',
      )}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `check-files-touched: DIS-${ticketId} OK (${files.length} changed, all within files_allowed).\n`,
  );
  process.exit(0);
}

main();
