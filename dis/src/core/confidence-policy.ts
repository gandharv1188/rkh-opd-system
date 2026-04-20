export interface ConfidenceRule {
  readonly field: string;
  readonly threshold: number;
  readonly block_type?: 'table' | 'paragraph' | 'list';
}

export interface ConfidencePolicy {
  readonly version: number;
  readonly enabled: boolean;
  readonly rules: ReadonlyArray<ConfidenceRule>;
}

export interface FieldExtraction {
  readonly confidence: number;
}

export interface StructuredExtraction {
  readonly fields: Readonly<Record<string, FieldExtraction>>;
}

export interface ExtractionBlock {
  readonly field: string;
  readonly block_type: 'table' | 'paragraph' | 'list';
}

export interface RuleResult {
  readonly field: string;
  readonly threshold: number;
  readonly actual: number;
  readonly passed: boolean;
}

export interface PolicyDecision {
  readonly auto_approved: boolean;
  readonly rule_results: ReadonlyArray<RuleResult>;
  readonly policy_version: number;
}

export function evaluatePolicy(
  structured: StructuredExtraction,
  policy: ConfidencePolicy,
  blocks: ReadonlyArray<ExtractionBlock>,
): PolicyDecision {
  const rule_results: ReadonlyArray<RuleResult> = policy.rules.map((rule) => {
    const field = structured.fields[rule.field];
    const actual = field?.confidence ?? 0;
    const confidenceOk = actual >= rule.threshold;
    const blockOk =
      rule.block_type === undefined
        ? true
        : blocks.some((b) => b.field === rule.field && b.block_type === rule.block_type);
    return {
      field: rule.field,
      threshold: rule.threshold,
      actual,
      passed: confidenceOk && blockOk,
    };
  });

  // CS-7 fail-closed: when disabled, never auto-approve regardless of confidence.
  if (!policy.enabled) {
    return {
      auto_approved: false,
      rule_results,
      policy_version: policy.version,
    };
  }

  const auto_approved = rule_results.length > 0 && rule_results.every((r) => r.passed);

  return {
    auto_approved,
    rule_results,
    policy_version: policy.version,
  };
}
