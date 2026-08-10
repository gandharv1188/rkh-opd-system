import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compileSchema,
  SchemaValidationError,
  validate,
} from '../../src/core/schema/ajv.js';

const CLINICAL_SCHEMA_ID = 'clinical_extraction.v1';

function loadSchemaJson(): unknown {
  const p = join(process.cwd(), 'src/core/schema/clinical_extraction.v1.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

function validExtraction(): Record<string, unknown> {
  return {
    document_type: 'lab_report',
    summary: 'CBC, normal',
    document_date: '2026-04-01',
    lab_name: 'Dr Lal PathLabs',
    labs: [
      {
        test_name_raw: 'Hb',
        test_name_normalized: 'hemoglobin',
        value_text: '12.0 g/dL',
        value_numeric: 12.0,
        unit: 'g/dL',
        reference_range: '11-14',
        flag: 'normal',
        test_category: 'Hematology',
        test_date: '2026-04-01',
        confidence: 0.98,
      },
    ],
    medications: [],
    diagnoses: [],
    vaccinations: [],
    clinical_notes: null,
  };
}

describe('clinical_extraction.v1 schema', () => {
  it('loads as valid JSON', () => {
    const schema = loadSchemaJson();
    expect(typeof schema).toBe('object');
    expect(schema).not.toBeNull();
  });

  it('compiles and caches a validator', () => {
    const v1 = compileSchema(CLINICAL_SCHEMA_ID);
    const v2 = compileSchema(CLINICAL_SCHEMA_ID);
    expect(v1).toBe(v2);
  });

  it('accepts a valid extraction', () => {
    const result = validate(CLINICAL_SCHEMA_ID, validExtraction());
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('rejects unknown document_type', () => {
    const bad = validExtraction();
    bad.document_type = 'random';
    const result = validate(CLINICAL_SCHEMA_ID, bad);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('rejects lab entry with missing required confidence', () => {
    const bad = validExtraction();
    const labs = bad.labs as Array<Record<string, unknown>>;
    delete labs[0]!.confidence;
    const result = validate(CLINICAL_SCHEMA_ID, bad);
    expect(result.valid).toBe(false);
  });

  it('rejects lab flag outside enum', () => {
    const bad = validExtraction();
    const labs = bad.labs as Array<Record<string, unknown>>;
    labs[0]!.flag = 'elevated';
    const result = validate(CLINICAL_SCHEMA_ID, bad);
    expect(result.valid).toBe(false);
  });

  it('rejects confidence > 1', () => {
    const bad = validExtraction();
    const labs = bad.labs as Array<Record<string, unknown>>;
    labs[0]!.confidence = 1.5;
    const result = validate(CLINICAL_SCHEMA_ID, bad);
    expect(result.valid).toBe(false);
  });

  it('rejects date in wrong format', () => {
    const bad = validExtraction();
    bad.document_date = '01-04-2026';
    const result = validate(CLINICAL_SCHEMA_ID, bad);
    expect(result.valid).toBe(false);
  });

  it('accepts minimal extraction with empty arrays and nulls', () => {
    const minimal = {
      document_type: 'other',
      summary: '',
      document_date: null,
      lab_name: null,
      labs: [],
      medications: [],
      diagnoses: [],
      vaccinations: [],
      clinical_notes: null,
    };
    const result = validate(CLINICAL_SCHEMA_ID, minimal);
    expect(result.valid).toBe(true);
  });

  it('throws SchemaValidationError for unknown schema id', () => {
    expect(() => compileSchema('does_not_exist.v1')).toThrow(SchemaValidationError);
  });
});
