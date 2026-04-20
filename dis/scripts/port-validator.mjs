#!/usr/bin/env node
/**
 * port-validator.mjs
 *
 * Enforces the Dependency Inversion Principle (DIP) described in
 * radhakishan_system/docs/feature_plans/document_ingestion_service/02_architecture/coding_standards.md §2.
 *
 * Rule: files under `dis/src/core/` and `dis/src/ports/` MUST NOT import from
 * any `adapters/` path. Core and ports define abstractions; adapters implement
 * them. A core/port importing an adapter inverts the intended dependency flow.
 *
 * Behaviour:
 *   - Recursively scans every `.ts` file under `dis/src/core/` and `dis/src/ports/`.
 *   - For each matching file, looks for `from '...'` / `from "..."` import
 *     specifiers that contain the segment `/adapters/`.
 *   - Prints offending `file:line` lines to stdout.
 *   - Exits 1 if any offender is found; exits 0 otherwise.
 *   - Uses only Node's built-in `node:fs` / `node:path` — no external deps.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const repoRoot = resolve(process.cwd());
const scanRoots = [
  join(repoRoot, "dis", "src", "core"),
  join(repoRoot, "dis", "src", "ports"),
];

// Matches: from '....../adapters/....'  OR  from "....../adapters/...."
const IMPORT_ADAPTER_RE = /(from\s+['"])(.*\/adapters\/)/;

/** @param {string} dir @returns {string[]} */
function walkTs(dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTs(full));
    } else if (st.isFile() && full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

let violations = 0;
for (const root of scanRoots) {
  const files = walkTs(root);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (IMPORT_ADAPTER_RE.test(lines[i])) {
        const rel = relative(repoRoot, file).split("\\").join("/");
        process.stdout.write(`${rel}:${i + 1}: ${lines[i].trim()}\n`);
        violations++;
      }
    }
  }
}

process.exit(violations > 0 ? 1 : 0);
