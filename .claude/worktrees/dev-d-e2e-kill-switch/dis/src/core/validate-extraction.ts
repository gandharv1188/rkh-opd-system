/**
 * ClinicalExtraction schema validator (DIS-030).
 *
 * Thin wrapper over the DIS-006 Ajv compile of `clinical_extraction.v1.json`
 * that returns a discriminated `{ ok: true, value } | { ok: false, errors }`
 * result. Used by the structuring adapter (DIS-051) on every LLM response
 * before the extraction is persisted.
 *
 * @see dis/src/core/schema/clinical_extraction.v1.json
 * @see TDD §10.2
 */

import type { ErrorObject } from 'ajv';
import { compileSchema } from './schema/ajv.js';

const SCHEMA_ID = 'clinical_extraction.v1';

// ---------------------------------------------------------------------------
// Domain type — mirrors clinical_extraction.v1.json shape.
// Kept minimal and hand-authored per TDD §11 (schema is the runtime contract;
// this interface is an ergonomic narrow for callers).
// ---------------------------------------------------------------------------

export type DocumentType =
  | 'lab_report'
  | 'prescription'
  | 'discharge_summary'
  | 'radiology'
  | 'vaccination_card'
  | 'other';

export type LabFlag = 'normal' | 'low' | 'high' | 'critical' | 'unknown';
export type LabCategory =
  | 'Hematology'
  | 'Biochemistry'
  | 'Microbiology'
  | 'Imaging'
  | 'Other';

export interface LabEntry {
  test_name_raw: string;
  test_name_normalized: string;
  value_text: string;
  value_numeric: number | null;
  unit: string | null;
  reference_range: string | null;
  flag: LabFlag;
  test_category: LabCategory;
  test_date: string | null;
  confidence: number;
}

export interface MedicationEntry {
  drug: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  confidence: number;
}

export interface DiagnosisEntry {
  text: string;
  icd10: string | null;
  confidence: number;
}

export interface VaccinationEntry {
  vaccine_name_raw: string;
  vaccine_name_normalized: string;
  dose_number: number | null;
  date_given: string | null;
  site: string | null;
  batch_no: string | null;
  confidence: number;
}

export interface ClinicalExtraction {
  document_type: DocumentType;
  summary: string;
  document_date: string | null;
  lab_name: string | null;
  labs: LabEntry[];
  medications: MedicationEntry[];
  diagnoses: DiagnosisEntry[];
  vaccinations: VaccinationEntry[];
  clinical_notes: string | null;
}

export type ValidateExtractionResult =
  | { ok: true; value: ClinicalExtraction }
  | { ok: false; errors: string[] };

function formatError(e: ErrorObject): string {
  const path = e.instancePath || '(root)';
  return `${path} ${e.message ?? 'invalid'}`;
}

export function validateExtraction(obj: unknown): ValidateExtractionResult {
  const validator = compileSchema(SCHEMA_ID);
  if (validator(obj)) {
    return { ok: true, value: obj as ClinicalExtraction };
  }
  const errors = (validator.errors ?? []).map(formatError);
  return { ok: false, errors: errors.length > 0 ? errors : ['invalid ClinicalExtraction'] };
}
