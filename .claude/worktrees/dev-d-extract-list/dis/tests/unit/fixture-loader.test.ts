/**
 * Unit tests — fixture loader (DIS-013).
 *
 * Asserts that loadFixture resolves to dis/tests/fixtures/<name>.json, returns
 * a typed object, and throws on missing fixtures. Also cross-checks that
 * sample_extraction.v1 is valid against clinical-extraction.v1.json via Ajv.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Ajv ships as a CJS module whose default export is the class; ESM interop
// surfaces it under `.default` at runtime but TypeScript can't resolve that
// cleanly in NodeNext. Use createRequire for an unambiguous CJS load.
const require = createRequire(import.meta.url);
type AjvValidate = ((data: unknown) => boolean) & { errors?: unknown[] | null };
type AjvCtor = new (opts?: { strict?: boolean }) => {
  compile: (schema: object) => AjvValidate;
};
const Ajv = require('ajv') as AjvCtor;

import { loadFixture, FixtureNotFoundError } from '../fixtures/index.js';

type ClinicalExtraction = {
  document_type: string;
  summary: string | null;
  labs: Array<Record<string, unknown>>;
  medications: Array<Record<string, unknown>>;
  diagnoses: Array<Record<string, unknown>>;
  vaccinations: Array<Record<string, unknown>>;
};

describe('loadFixture', () => {
  it('returns a parsed object for an existing fixture', () => {
    const fx = loadFixture<ClinicalExtraction>('sample_extraction.v1');
    expect(fx.document_type).toBe('discharge_summary');
    expect(Array.isArray(fx.labs)).toBe(true);
  });

  it('exercises every required array (lab, medication, diagnosis, vaccination)', () => {
    const fx = loadFixture<ClinicalExtraction>('sample_extraction.v1');
    expect(fx.labs.length).toBeGreaterThanOrEqual(1);
    expect(fx.medications.length).toBeGreaterThanOrEqual(1);
    expect(fx.diagnoses.length).toBeGreaterThanOrEqual(1);
    expect(fx.vaccinations.length).toBeGreaterThanOrEqual(1);
  });

  it('throws FixtureNotFoundError when the fixture file is missing', () => {
    expect(() => loadFixture('does_not_exist')).toThrow(FixtureNotFoundError);
  });

  it('sample_extraction.v1 validates against clinical-extraction.v1.json', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const schemaPath = join(here, '..', '..', 'src', 'schemas', 'clinical-extraction.v1.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(schema);
    const fx = loadFixture('sample_extraction.v1');
    const ok = validate(fx);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
});
