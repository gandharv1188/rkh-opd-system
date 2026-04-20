import { describe, it, expect } from 'vitest';
import {
  evaluatePolicy,
  type ConfidencePolicy,
  type StructuredExtraction,
  type ExtractionBlock,
} from '../../src/core/confidence-policy.js';

const baseRules = [
  { field: 'labs', threshold: 0.95, block_type: 'table' as const },
  { field: 'vaccinations', threshold: 0.9 },
  { field: 'medications', threshold: 0.9 },
  { field: 'diagnoses', threshold: 0.9 },
  { field: 'summary', threshold: 0.5 },
];

function policy(enabled: boolean, version = 1): ConfidencePolicy {
  return {
    version,
    enabled,
    rules: baseRules,
  };
}

function allFieldsAt(confidence: number): StructuredExtraction {
  return {
    fields: {
      labs: { confidence },
      vaccinations: { confidence },
      medications: { confidence },
      diagnoses: { confidence },
      summary: { confidence },
    },
  };
}

const tableBlocks: ReadonlyArray<ExtractionBlock> = [{ field: 'labs', block_type: 'table' }];

describe('evaluatePolicy — CS-7 fail-closed default (enabled=false)', () => {
  for (let step = 0; step <= 10; step++) {
    const confidence = Number((step / 10).toFixed(1));
    it(`enabled=false with confidence ${confidence} → auto_approved=false`, () => {
      const result = evaluatePolicy(allFieldsAt(confidence), policy(false), tableBlocks);
      expect(result.auto_approved).toBe(false);
      expect(result.policy_version).toBe(1);
    });
  }
});

describe('evaluatePolicy — enabled=true one-fail-all rule', () => {
  it('all fields above threshold → auto_approved=true', () => {
    const structured: StructuredExtraction = {
      fields: {
        labs: { confidence: 0.99 },
        vaccinations: { confidence: 0.95 },
        medications: { confidence: 1.0 },
        diagnoses: { confidence: 1.0 },
        summary: { confidence: 0.5 },
      },
    };
    const result = evaluatePolicy(structured, policy(true), tableBlocks);
    expect(result.auto_approved).toBe(true);
    expect(result.rule_results.every((r) => r.passed)).toBe(true);
    expect(result.policy_version).toBe(1);
  });

  it('one field below threshold → auto_approved=false', () => {
    const structured: StructuredExtraction = {
      fields: {
        labs: { confidence: 0.99 },
        vaccinations: { confidence: 0.5 },
        medications: { confidence: 1.0 },
        diagnoses: { confidence: 1.0 },
        summary: { confidence: 1.0 },
      },
    };
    const result = evaluatePolicy(structured, policy(true), tableBlocks);
    expect(result.auto_approved).toBe(false);
    const vacc = result.rule_results.find((r) => r.field === 'vaccinations');
    expect(vacc?.passed).toBe(false);
  });

  it('labs pass requires block_type=table when policy names it', () => {
    const structured = allFieldsAt(0.99);
    const nonTable: ReadonlyArray<ExtractionBlock> = [{ field: 'labs', block_type: 'paragraph' }];
    const result = evaluatePolicy(structured, policy(true), nonTable);
    expect(result.auto_approved).toBe(false);
  });

  it('missing field confidence treated as 0 (fail-closed)', () => {
    const structured: StructuredExtraction = {
      fields: {
        labs: { confidence: 0.99 },
        vaccinations: { confidence: 0.99 },
        medications: { confidence: 1.0 },
        diagnoses: { confidence: 1.0 },
      },
    };
    const result = evaluatePolicy(structured, policy(true), tableBlocks);
    expect(result.auto_approved).toBe(false);
    const summary = result.rule_results.find((r) => r.field === 'summary');
    expect(summary?.actual).toBe(0);
    expect(summary?.passed).toBe(false);
  });
});

describe('evaluatePolicy — policy version stamping', () => {
  it('stamps version=1 on decision', () => {
    const result = evaluatePolicy(allFieldsAt(0.0), policy(false, 1), tableBlocks);
    expect(result.policy_version).toBe(1);
  });

  it('stamps version=7 on decision', () => {
    const result = evaluatePolicy(allFieldsAt(1.0), policy(true, 7), tableBlocks);
    expect(result.policy_version).toBe(7);
  });
});
