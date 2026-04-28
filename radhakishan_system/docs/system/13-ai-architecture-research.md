# 13 — AI Architecture Research: Best Practices for LLM-Based Clinical Prescription Generation

_Last updated: 2026-04-28_

**Evidence-based review of how to architect the LLM dose-validation and prescription pipeline**

This document captures the literature and industry-practice review of architectural patterns for "LLM proposes treatment / deterministic system validates" — specifically as applied to pediatric prescription generation. The strongest empirical evidence (Goodell et al. 2025) shows deterministic dose-calculation tools beat both raw LLM math (95.2% vs 36.1%) and code interpreters (95.2% vs 46%). The recommended architecture for our system is a six-stage pipeline where the LLM never emits free-form numeric values; the dose engine produces canonical numbers and the LLM only narrates around them.

## Section 1 — What the literature/industry actually does

### 1.1 Goodell et al. 2025 (npj Digital Medicine) — the strongest empirical signal
On the ten hardest clinical calculation tasks:
- Unaugmented GPT-4o: **36.1%** accuracy
- GPT-4o + code interpreter: **46.0%**
- GPT-4o + OpenMedCalc (deterministic task-specific tool): **95.2%**
- LLaMa-3.1-70b + OpenMedCalc: 84.0% (vs 11.4% baseline)

Key quote: *"OpenMedCalc had a more narrow range of errors than the other arms, likely due to the deterministic nature of the tool. In the OpenMedCalc arms, only interpretation errors were identified"* — calculation/formula errors were **completely eliminated** when arithmetic was bypassed. Code interpreter (PoT-style "let the LLM write code") was *"occasionally incorrect even in instances where the model presented a correct version of the formula prior to writing the script."* Decisive: PoT is not safe enough for dose math.

Source: npj Digital Medicine 2025; PMC mirror PMC11914283.

### 1.2 Rx Strategist (arXiv 2409.03440)
Multi-stage LLM pipeline with custom active-ingredient database and knowledge graphs, decomposing prescription verification into separate stages for indication, dose, and interactions. Architectural lesson: separate the stages and back each with structured retrieval rather than a monolithic prompt.

### 1.3 Adversarial-consensus / verifier-agent literature (arXiv 2512.03097, Dec 2025)
*"A verifier agent can be added as a practical defence mechanism, checking outputs against trusted guideline knowledge … Case studies demonstrate that a verifier can restore correct prescription when collusion attacks would otherwise succeed."* The field's prevailing view: *"What actually catches errors is asymmetric criticism: a different model, a different prompt scaffold, a verifier with a real signal. A 'same model, second pass' is the cheapest possible critic, and you get what you pay for."*

### 1.4 NHS real-world LLM medication-safety evaluation (arXiv 2512.21127)
*"The dominant failure mechanism is contextual reasoning rather than missing medication knowledge"* — five patterns: overconfidence, ignoring patient-specific context, healthcare-process blindness, factual errors, not adjusting standard guidelines. Implication: dose math is necessary but not sufficient.

### 1.5 Glass Health / OpenEvidence
RAG over physician-validated guidelines plus mandatory clinician review. No published "deterministic dose engine" pattern.

### 1.6 Anthropic platform primitives (Nov 2025+)
- **Strict tool use** (`strict: true`): constrained decoding compiles JSON Schema to grammar; tool inputs guaranteed to match. GA on Claude Sonnet 4.5+, Opus 4.5+, Haiku 4.5+. Limit: 20 strict tools/request. **Numeric `minimum`/`maximum` are NOT enforced** — must validate server-side.
- `tool_choice: {"type":"tool","name":"compute_doses"}` forces a specific tool call. **Caveat: extended thinking is incompatible with forced tool_choice.**
- `disable_parallel_tool_use: true` ensures exactly one tool call per turn.

## Section 2 — Pattern evaluation

| # | Pattern | Pros | Cons | Industry exemplar |
|---|---------|------|------|--------------------|
| A | Function calling with strict schema (`compute_doses` tool) | Deterministic math; schema-guaranteed inputs; auditable; matches OpenMedCalc evidence | LLM still chooses inputs (weight, age) — can be wrong; relies on LLM to copy result verbatim | OpenMedCalc / Goodell 2025 — 95.2% |
| B | Post-hoc validation only | Simple; no LLM-flow change | LLM math wrong ~54-64% on hard pediatric tasks; "override" rewrites doctor-visible output — bad UX/trust | Not used by any published clinical system |
| C | Programs of Thought / sandboxed eval | Flexible | Goodell shows code-interpreter only got 46% — LLM writes wrong code even when knowing formula. Unsafe. | Generic CoT/PoT papers, not clinical |
| D | Two-pass: LLM picks meds (no doses) → engine fills doses → LLM narrates | Cleanly separates planning from arithmetic | Two API round-trips; narrative pass might re-hallucinate numbers | Closest to Rx Strategist |
| E | LLM never touches numbers; engine calculates, LLM only templates text | Strongest safety guarantee on dose math | Requires structured slots; less flexible for free-text guidance | Hippocratic AI's published stance |
| F | Constrained decoding / grammar enforcement | Guarantees schema; available now via Anthropic strict mode | Doesn't constrain values, only structure (min/max not enforced) | Anthropic structured outputs |
| G | Verifier-LLM second pass | Catches qualitative errors deterministic engine misses | Same-model second pass low-signal; needs different model/scaffold | Many-to-One Adversarial Consensus paper |
| H | Forced `tool_choice` + cached schema | Guarantees engine called; cache reduces cost | Loses extended thinking; brittle if model wants clarification | Anthropic cookbook |

The strongest empirical winner is **A+E hybrid** — `compute_doses` tool + LLM never composes a numeric value itself; copies engine's output into structured slots.

## Section 3 — Verdict on the original 3-layer design

The original proposal was: (1) `compute_doses` tool, (2) server-side enforcement, (3) client re-validation with >20% tolerance override.

**Verdict: directionally correct, but Layer 3 is wrong, and Layers 1–2 should be tightened.**

### What's right
- Putting the dose engine behind a tool the LLM must call is supported by the strongest empirical evidence (95% vs 36-46%).
- Server-side enforcement (refuse if `compute_doses` not called) is correct and standard.

### What's wrong with Layer 3 (client tolerance override)
1. **Silent overrides are non-auditable.** A clinician sees one number on screen, the engine returns another, system reconciles silently. NABH and any medico-legal review will ask: which number was approved? **Never silently rewrite a dose post-approval.**
2. **A 20% tolerance is clinically arbitrary.** For paracetamol it's tolerable; for digoxin, gentamicin, or any narrow-therapeutic-index drug, 20% is toxic. Tolerance should be per-drug, sourced from formulary, not a single global number.
3. **Re-running the engine on the client duplicates source of truth.** Engine should run once, server-side, be canonical. Client should display, not recompute.
4. **It papers over the real failure mode.** If client and server compute different doses, that's a *bug*, not a tolerance band.

### Also weak in Layers 1-2 as originally stated
"LLM writes the numbers verbatim" is still LLM-mediated transcription — model can paraphrase, round, drop a decimal. **Don't have the LLM emit numeric strings at all.** Have it emit a `medicine_id` and `dosing_band_id`; the engine emits volumes; the rendering layer (deterministic templating) joins them.

## Section 4 — Recommended architecture (six-stage pipeline)

**Stage 1 — Planning (LLM, with strict tool use):**
- Tool `propose_medicines` with `strict: true` returning `{ med_id, indication_icd10, route, frequency_band_id, duration_days, rationale_text }[]`. **No numeric dose fields exist in the schema.** The LLM cannot emit a dose because there is nowhere to put one.
- Tool `get_formulary`, `get_standard_rx`, `get_lab_history` as today (read-only context).

**Stage 2 — Computation (deterministic, no LLM):**
- Edge Function takes proposed meds + patient vitals, runs the same `dose-engine.js` (shared module imported into Deno function), returns canonical `{ med_id, mg, volume_ml, drops, tablets_fraction, max_dose_check, allergy_flag, interaction_flags }`.
- Validate with JSON Schema + Zod including numeric `minimum`/`maximum` (Anthropic strict mode does NOT enforce these).

**Stage 3 — Narrative (LLM, second turn):**
- Tool `finalize_prescription` with `strict: true`. Input includes computed doses **as opaque pre-formatted strings**: `"5 ml"`, `"½ tab"`. The LLM's only job: produce Hindi translation, pictogram-friendly instruction text, warning block. It receives strings to copy, not numbers to format.
- Force this with `tool_choice: {"type":"tool","name":"finalize_prescription"}`, `disable_parallel_tool_use: true`. Extended thinking off for this turn.

**Stage 4 — Server-side hard checks (no LLM):**
- Re-run engine deterministically on finalized payload. If any returned numeric string doesn't match canonical computation **byte-for-byte**, fail the request. No tolerance, no silent override.

**Stage 5 — Asymmetric verifier (optional, high-value):**
- A separate, smaller Claude Haiku call with a different prompt scaffold reviews the prescription against `get_standard_rx` and `get_lab_history`, flagging qualitative issues (wrong drug for indication, missed renal adjustment, allergy clash, age-inappropriate). Outputs `{status: SAFE|REVIEW, flags[]}`.

**Stage 6 — Client:**
- Render only. No re-computation, no override. Doctor edits → flagged as `manually_overridden: true`, original engine value retained for audit.

## Section 5 — Concrete tactical improvements (adopt regardless)

1. **Use `strict: true` on every tool definition.** Free win.
2. **Use `tool_choice: {"type":"tool","name":"compute_doses"}` ONLY on the final compute/finalize turn**, not the whole loop. Disables extended thinking.
3. **Use `disable_parallel_tool_use: true` on the compute turn**.
4. **Enforce numeric ranges in code, not in schema.** Anthropic strict mode does not enforce `minimum`/`maximum`.
5. **Prompt-cache the formulary tool definitions and `core_prompt.md`** (5-min TTL) — ~80% cost reduction on repeated system prompt + tool schemas.
6. **Share `dose-engine.js` between client and Edge Function** as a single module. Today there's drift risk.
7. **Drop the 20% client-side override.** Replace with: client renders server-canonical doses; any divergence is a hard fail; doctor edits stored as flagged manual override with original engine value retained.
8. **Add an asymmetric verifier (Haiku, different prompt scaffold)** as a second call doing only safety review. Sub-second, catches indication/allergy/renal issues the engine doesn't model.
9. **Persist the full tool-use trace** in a `prescription_audit` table — required for NABH and post-incident review.
10. **Don't use code-interpreter / Programs of Thought for dose math.**
11. **Eventually: per-drug tolerance bands** stored in `formulary.dosing_bands`, used by verifier (not as silent override threshold).

## Section 6 — Sources

- Goodell et al., "Large language model agents can use tools to perform clinical calculations," npj Digital Medicine 2025: https://www.nature.com/articles/s41746-025-01475-8
- PMC mirror: https://pmc.ncbi.nlm.nih.gov/articles/PMC11914283/
- Rx Strategist (arXiv 2409.03440): https://arxiv.org/abs/2409.03440
- Many-to-One Adversarial Consensus (arXiv 2512.03097): https://www.arxiv.org/pdf/2512.03097
- NHS LLM Medication Safety Reviews (arXiv 2512.21127): https://arxiv.org/abs/2512.21127
- Anthropic Structured Outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Anthropic Tool Use overview: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- Anthropic Implement tool use: https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use
- Glass Health features: https://glass.health/features
