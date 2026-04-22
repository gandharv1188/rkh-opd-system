# ADR-007 — Claude Haiku as default structuring LLM; Sonnet escalation on low confidence

- **Status:** Accepted
- **Date:** 2026-04-21
- **Deciders:** Architect, Product Owner
- **Supersedes:** none

## Context

Once OCR produces markdown / layout blocks, the structuring stage
turns free text into the validated
`ClinicalExtraction v1` schema (TDD §11). Source documents:

- `02_architecture/tdd.md §10` — StructuringPort + provider
  selection.
- `02_architecture/tdd.md §10.2` — ClaudeHaikuAdapter default;
  ClaudeSonnetAdapter as escalation; prompt versioned and content-
  hashed.
- `02_architecture/tdd.md §11` — ClinicalExtraction v1 schema
  contract.
- `06_rollout/feature_flags.md §6` — `DIS_STRUCTURING_PROVIDER`
  flag: enum `haiku | sonnet`, default `haiku`.
- `dis/handoffs/sessions/document_ocr_flow.md §12.4 + 12.5` — Claude pricing
  (Sonnet 4 ~$3 in / $15 out per 1M tokens; Haiku 4.5 roughly 1/5
  the cost).
- `dis/handoffs/DIS-051.md` — ClaudeHaikuAdapter implementation,
  retry-once on schema-invalid, `StructuringSchemaInvalidError` on
  second failure.
- `dis/src/adapters/structuring/claude-haiku.ts` — current default.

The structuring step converts "Hb 10.2 g/dL (11.5-15.5) LOW" into
`{test_name_normalized: "hemoglobin", value_numeric: 10.2,
flag: "low", ...}`. Quality matters (wrong value = CS-1 risk
even with nurse verification, because a nurse reading the fields
"in the same order as the AI" can rubber-stamp). Cost matters too:
POC ~20 docs/day × ~500 output tokens × Sonnet rate = small today,
but at 1000 docs/day default rollout the multiplier is 5× in
Haiku's favour.

## Decision

**Use `claude-haiku-4-5` as the default structuring provider. Reserve
`claude-sonnet-4-N` for per-extraction escalation on low-confidence
output.** Specifically:

1. **Default path:** `DIS_STRUCTURING_PROVIDER=haiku`, adapter class
   `ClaudeHaikuAdapter`. Schema validation retries once with a
   stricter cue on invalid JSON; second failure →
   `StructuringSchemaInvalidError` (terminal failure → extraction
   ends in `failed` state → `retry()` creates a new extraction).
2. **Escalation path (not yet built):** a future
   `ClaudeSonnetAdapter` is the declared successor when a
   per-extraction confidence signal (Haiku's own `confidence`
   output field, aggregated, compared against a threshold) falls
   below a configurable line. The orchestrator will re-submit the
   same OCR markdown to Sonnet and take the higher-confidence
   result. **This escalation is deferred to a later ticket;** for
   now the system uses Haiku exclusively and relies on the
   confidence policy (CS-7, default OFF) + nurse verification to
   catch low-confidence cases.
3. **No automatic escalation at launch.** The feature flag
   `DIS_STRUCTURING_PROVIDER=sonnet` lets an operator globally flip
   to Sonnet for a specific investigation or a provider-outage
   workaround (see `09_runbooks/provider_outage.md §Schema drift`).

## Consequences

**Enforced by:**

- DIS-051 — ClaudeHaikuAdapter with retry-once-on-schema-drift,
  typed error, prompt version stamped from frontmatter, cost
  accounting at Haiku price points (83 / 416 µINR per token —
  placeholder pending the DIS-032 cost-calculator cleanup).
- `DIS_STRUCTURING_PROVIDER` flag with default `haiku` per
  `feature_flags.md §6`.
- Future DIS-???-sonnet-escalation ticket (not yet in backlog) —
  will add `ClaudeSonnetAdapter` + the orchestrator escalation
  step.

**Becomes easier:**

- **Cost.** Per-document cost sits at the target of ≤ ₹0.40
  (TDD §18) with room to spare. Budget guardrail (DIS-165) has
  headroom.
- **Latency.** Haiku is consistently faster than Sonnet; a
  Haiku-first pipeline keeps the P95 end-to-end under the 60s
  target (TDD §18) comfortably.
- **Fallback via the existing flag.** Operators can flip the
  whole deployment to Sonnet without a code change during an
  incident (e.g. suspected Haiku-specific schema regression).
- **Schema validation is the contract.** Provider choice doesn't
  affect the downstream promotion code; both Haiku and Sonnet
  output the same `ClinicalExtraction v1` and are validated the
  same way (DIS-030 Ajv validator — DIS-051-followup).

**Becomes harder:**

- **Haiku on handwritten-and-noisy inputs can miss fields** that
  Sonnet would catch. Mitigation: the structuring layer never
  sees pixels — Chandra (OCR) does the hard vision work first.
  Haiku structures Chandra's markdown, which is typically clean.
  The adversarial cases left over are caught by the confidence-
  policy gate (CS-7 default OFF → every extraction nurse-reviewed)
  - red-team fixtures (DIS-152).
- **Normalisation mistakes carry clinical risk.** If Haiku maps
  "Hb" → "Hemoglobin" correctly 99% of the time, the 1% that
  becomes "Hemoglobin A1c" is a CS-9 audit concern. Mitigation:
  CS-9 requires `test_name_raw` preserved alongside
  `test_name_normalized` so a miscategorisation is reviewable —
  `prompts/structuring.md` rules 2 and 4 enforce this.
- **Prompt brittleness.** Haiku's cheaper inference is partly
  because it's smaller and more sensitive to prompt phrasing.
  Mitigation: `prompts/structuring.md` is versioned (frontmatter
  `version: 1`), stamped on every structuring call, and content-
  hashed per Phase-2 drift Control 8 (when implemented).

**What this does NOT change:**

- Ports & adapters contract (ADR-001): `StructuringPort` is the
  abstraction, `ClaudeHaikuAdapter` / `ClaudeSonnetAdapter` are
  interchangeable implementations.
- Raw-response preservation (CS-2): `StructuringResult.rawResponse`
  stores the full Claude response byte-identically, irrespective of
  provider.
- Schema version: both providers are asked for
  `ClinicalExtraction v1` and validated the same way.

## Alternatives considered

### Sonnet as default

**Rejected because:** 5× cost at equivalent correctness-after-
validation, given that Chandra already handles the hard vision
work and structuring is a text-in → JSON-out task that Haiku
handles well. The Haiku → Sonnet escalation path keeps Sonnet
available for the edge cases without paying for it on every call.

### Opus as default or escalation

**Rejected because:** 15× cost vs Haiku for no meaningful gain on
the narrow task of "turn this OCR markdown into the
`ClinicalExtraction v1` schema." Reserved for tasks that need
deep reasoning — structuring is not one of them. Opus is worth
revisiting only if the schema grows to include clinical reasoning
fields (e.g. diagnosis plausibility scoring), which is explicitly
out of scope (`non_goals.md`).

### GPT-4o / Gemini as provider

**Rejected because:** adds a third cloud dependency (OpenAI or
Google). No evidence in the benchmarks we've reviewed
(`document_ocr_flow.md §12.2`) that either outperforms Haiku on
the specific "structure pre-OCR'd medical markdown to JSON
schema" task enough to offset the integration cost. Our
StructuringPort contract keeps the option open; no current
pressure.

### Local fine-tuned model (on-prem)

**Rejected because:** we have no ground-truth corpus of structured
clinical extractions to fine-tune on. The Wave-F red-team fixtures
(DIS-152) + the clinician weekly audit would generate a small
corpus over time, but that's a multi-month accumulation before
fine-tuning is worth attempting. Keep as a future direction,
revisit at the 1000 docs/day inflection point (see ADR-002).

## Follow-up tickets

- **DIS-051-followup** — replace hand-rolled required-keys check
  with Ajv full JSON-Schema validation.
- **Future ticket (not yet in backlog) — Sonnet escalation:** add
  `ClaudeSonnetAdapter`, orchestrator step to invoke it on
  below-threshold Haiku confidence, comparison logic to pick the
  higher-confidence result, cost-ledger accounting for the dual
  call.
- **DIS-166 (Epic F chaos test)** — already in backlog; asserts
  structuring fails closed on garbage input, which implicitly
  validates the Haiku-default contract.
