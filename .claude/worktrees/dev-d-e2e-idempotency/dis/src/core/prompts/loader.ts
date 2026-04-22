import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface StructuringPrompt {
  /** Full prompt text as loaded from structuring.md (frontmatter + body). */
  text: string;
  /** Version declared in the frontmatter `version:` field. */
  version: string;
  /** sha256 hex digest of `text`, stamped onto every structuring call. */
  contentHash: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = resolve(here, 'structuring.md');

function parseVersion(raw: string): string {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm || !fm[1]) {
    throw new Error('structuring.md: missing YAML frontmatter block');
  }
  const line = fm[1].split(/\r?\n/).find((l) => /^\s*version\s*:/.test(l));
  if (!line) {
    throw new Error('structuring.md: frontmatter missing `version:` field');
  }
  const value = line.split(':').slice(1).join(':').trim();
  if (!value) {
    throw new Error('structuring.md: frontmatter `version:` is empty');
  }
  return value;
}

const TEXT = readFileSync(PROMPT_PATH, 'utf8');
const VERSION = parseVersion(TEXT);
const CONTENT_HASH = createHash('sha256').update(TEXT, 'utf8').digest('hex');

const PROMPT: StructuringPrompt = Object.freeze({
  text: TEXT,
  version: VERSION,
  contentHash: CONTENT_HASH,
});

export function getStructuringPrompt(): StructuringPrompt {
  return PROMPT;
}
