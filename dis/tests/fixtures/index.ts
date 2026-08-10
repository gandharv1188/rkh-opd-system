/**
 * Fixture loader for DIS unit/integration tests.
 *
 * Resolves `<name>` to `dis/tests/fixtures/<name>.json` (relative to this
 * file), parses it as JSON, and returns it typed as the caller-supplied `T`.
 *
 * The loader does not validate shape — callers that need schema validation
 * should run their own Ajv validator. This mirrors the core/adapter split:
 * loading is a mechanical concern, validation belongs to the consumer.
 *
 * @see DIS-013
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

export class FixtureNotFoundError extends Error {
  constructor(name: string, path: string, cause: unknown) {
    super(`fixture not found: ${name} (looked at ${path})`);
    this.name = 'FixtureNotFoundError';
    this.cause = cause;
  }
}

export function loadFixture<T = unknown>(name: string): T {
  const path = join(FIXTURE_DIR, `${name}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new FixtureNotFoundError(name, path, err);
  }
  return JSON.parse(raw) as T;
}
