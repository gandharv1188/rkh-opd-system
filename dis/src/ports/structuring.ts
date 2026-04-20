/**
 * Structuring port — converts OCR markdown/blocks into the validated
 * `ClinicalExtraction` JSON shape (see TDD §11).
 *
 * @see TDD §10
 */

import type { Block } from './ocr';

/**
 * Placeholder for the validated clinical extraction shape.
 *
 * The real type is defined by `clinical_extraction.v1.json` (see TDD §11) and
 * is enforced at runtime by the JSON Schema validator. We deliberately keep
 * this as `unknown` at the port boundary so the adapter layer owns validation
 * and the core does not couple to a compile-time representation that could
 * drift from the schema.
 *
 * `unknown` (not `any`) is used because callers must narrow via the schema
 * validator before accessing fields.
 *
 * @see TDD §11
 */
export type ClinicalExtractionShape = unknown;

/**
 * Optional patient context passed to the structuring model to improve
 * extraction accuracy (e.g. age-appropriate ranges, allergy cross-checks).
 *
 * @see TDD §10.1
 */
export type StructuringPatientContext = {
  readonly age_years?: number;
  readonly sex?: 'M' | 'F';
  readonly allergies?: readonly string[];
};

/**
 * Input payload for {@link StructuringPort.structure}.
 *
 * At least one of `markdown` or `blocks` must be provided; the adapter decides
 * which representation to feed the model.
 *
 * @see TDD §10.1
 */
export type StructuringInput = {
  readonly markdown?: string;
  readonly blocks?: readonly Block[];
  readonly documentCategory: string;
  readonly patientContext?: StructuringPatientContext;
};

/**
 * Identifier of the concrete structuring provider that produced a
 * {@link StructuringResult}.
 *
 * @see TDD §10.1
 */
export type StructuringProvider = 'claude-haiku' | 'claude-sonnet' | 'claude-opus' | 'onprem';

/**
 * Token usage reported by the structuring provider.
 *
 * @see TDD §10.1
 */
export type StructuringTokenUsage = {
  readonly input: number;
  readonly output: number;
};

/**
 * Result returned by {@link StructuringPort.structure}.
 *
 * @see TDD §10.1
 */
export type StructuringResult = {
  readonly provider: StructuringProvider;
  readonly providerVersion: string;
  /**
   * Verbatim provider response, persisted for audit.
   * Typed as `unknown` because the shape varies per provider.
   */
  readonly rawResponse: unknown;
  readonly structured: ClinicalExtractionShape;
  readonly tokensUsed: StructuringTokenUsage;
  readonly costMicroINR: number;
  readonly latencyMs: number;
};

/**
 * Provider-agnostic structuring port.
 *
 * @see TDD §10.1
 */
export interface StructuringPort {
  structure(input: StructuringInput): Promise<StructuringResult>;
}
