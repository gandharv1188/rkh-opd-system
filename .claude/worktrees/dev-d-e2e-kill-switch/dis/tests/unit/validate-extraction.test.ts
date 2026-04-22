/**
 * Unit tests — ClinicalExtraction schema validator wrapper (DIS-030).
 *
 * Wraps `compileSchema('clinical_extraction.v1')` from DIS-006 and exposes a
 * discriminated result `{ ok: true, value } | { ok: false, errors: string[] }`
 * for structuring responses. Used by DIS-051 on every LLM structuring call.
 */

import { describe, it, expect } from 'vitest';
import {
  validateExtraction,
  type ClinicalExtraction,
} from '../../src/core/validate-extraction.js';

function validExtraction(): Record<string, unknown> {
  return {
    document_type: 'lab_report',
    summary: 'CBC normal',
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

describe('validateExtraction (DIS-030)', () => {
  it('returns ok=true with typed value for a valid fixture', () => {
    const result = validateExtraction(validExtraction());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value: ClinicalExtraction = result.value;
      expect(value.document_type).toBe('lab_report');
      expect(value.labs).toHaveLength(1);
    }
  });

  it('returns ok=false with errors[] when a required field is missing', () => {
    const bad = validExtraction();
    delete (bad as Record<string, unknown>).summary;
    const result = validateExtraction(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      // meaningful message mentions the missing field name
      expect(result.errors.join(' ')).toMatch(/summary/i);
    }
  });

  it('returns ok=false for an unknown document_type', () => {
    const bad = validExtraction();
    bad.document_type = 'pathology_slide';
    const result = validateExtraction(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('returns ok=false when top-level value is not an object', () => {
    const result = validateExtraction('not an extraction');
    expect(result.ok).toBe(false);
  });

  it('accepts a minimal extraction with empty arrays and null dates', () => {
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
    const result = validateExtraction(minimal);
    expect(result.ok).toBe(true);
  });
});
