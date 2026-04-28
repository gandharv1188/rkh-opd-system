# 14 — Prompting & Instruction-Following Research

_Last updated: 2026-04-28_

**Evidence-based answers to four production questions: medication omission, formulary fallback message, overall_status, and temperature**

This document captures the second research pass focused on solving the customer-reported failure where the AI silently drops or adds medications that the doctor did not request. The customer's complaint was confirmed by a real Supabase audit (5 of 8 recent prescriptions had silent additions; 3 of 8 had drops). The research concludes that this is fixable with prompting and schema changes — NOT an architectural rewrite. Key recommendations: add a required `requested_medicines[]` echo field with deterministic post-validation, set temperature to 0, remove `overall_status` from LLM output (server-computes it), replace the dangerous "use clinical training knowledge" fallback with a structured error, and enable Anthropic prompt caching.

## Section A — Question 1: Medication Omission (highest priority)

### Root cause analysis

The customer-reported failure ("Cefixime silently dropped") is **almost certainly not a model-capability problem** that requires architectural overhaul. It's the textbook symptom of three well-documented failure modes interacting:

1. **No explicit echo / enumeration step.** Claude is asked, in one shot, to parse free-text dictation, fetch formulary data, do dose math, and emit JSON. There is no step that says "first, list every medication mentioned." Anthropic's structured-outputs documentation explicitly warns that completeness depends on `required` field declarations and `max_tokens` headroom. If the schema doesn't make `requested_medicines` a required pre-enumerated array, the model is free to compress.

2. **`tool_choice: "auto"` plus serial tool-calling.** With `auto`, the model decides which tools to call. If it calls `get_formulary` once with a partial drug list (because the parser missed one, or because it batched and lost it), the rest of the loop has no recovery path.

3. **Context compaction / list compression in long tool loops.** Anthropic's compaction docs note: *"while Claude is good at identifying key points, some details will be compressed or omitted"* in long tool loops. With 5 tools, multiple reference fetches, and a long system prompt, list items in the original user message can degrade in salience by the final generation.

There is an even simpler cause worth checking before any architecture change: **`max_tokens` truncation**. Anthropic states: *"If Claude's response is cut off due to hitting the max_tokens limit … the truncated response contains an incomplete tool use block."* **Before doing anything else, log `stop_reason` on every Edge Function invocation for a week.** If even 5% are `max_tokens`, the fix is one line.

### Top 3 mitigations, ranked

**#1 — Required `requested_medicines` echo field with deterministic post-validation (HIGH IMPACT, LOW EFFORT).**

Add to the JSON schema a required, non-empty array `requested_medicines: string[]` that must be populated **before** the model emits the prescription body. In the system prompt:

> *"Step 1 (mandatory): Extract every drug name the doctor mentioned in the clinical note into `requested_medicines`. Step 2: For each entry in that array, you MUST emit one element in `medicines[]`, OR an entry in `omitted_medicines[]` with a reason. The lengths must match."*

Then in the Edge Function, **deterministically verify** that `len(medicines) + len(omitted_medicines) == len(requested_medicines)` and the names align. If not, retry once with the diff appended; else fail closed to "REVIEW REQUIRED".

This combines three Anthropic-recommended techniques: be clear/direct/detailed, XML-tagged instructions, and required-fields-by-default in structured outputs. The deterministic count check removes reliance on model self-policing.

**#2 — Extended thinking ("interleaved thinking") on the planning turn (MEDIUM IMPACT, LOW EFFORT).**

Sonnet 4 / 4.5 / 4.6 support extended thinking with tool use. Anthropic describes "Think-Act-Think-Act" interleaved thinking and notes Claude 4 models are "65% less likely to engage in shortcuts/loopholes" than 3.7. The thinking block is the natural place for the model to enumerate every drug before calling tools. **Caveat:** extended thinking is incompatible with `tool_choice: any` or `tool_choice: tool` — only `auto` and `none` work. Pick one.

**#3 — Audit/verifier LLM second pass (HIGH IMPACT, MEDIUM EFFORT).**

A small, cheap second LLM call: input = original dictation + generated prescription JSON. Single question: "List any drug name in the dictation that does not appear in the prescription." If non-empty → server flips `overall_status` to REVIEW REQUIRED and surfaces the gap to the doctor. Mirrors Hippocratic AI's "constellation" pattern (22 support models cross-checking the primary).

### What to ship now vs defer

**Ship this sprint:** #1 (echo + deterministic validation). 50-line schema/prompt change plus one server-side assertion. **Also instrument `stop_reason` and `usage.output_tokens` immediately.**

**Ship next sprint:** #3 (audit verifier) once #1 is stable.

**Defer:** #2 extended thinking. Useful but interacts badly with `tool_choice: any`, adds latency, dominated by #1 + #3 for this specific failure.

**Do NOT do:** Architectural rewrite. The customer's complaint is fixable with prompting + a 5-line server check.

## Section B — Question 2: Formulary Not-Found Message

### Best practice for tool-failure responses

LLM tool-error literature is consistent: return a **structured, machine-readable error** that tells the model what went wrong and what action is permissible — not free-form natural language inviting improvisation. LangChain/LangGraph's `handleToolErrors` pattern returns typed errors so the agent can self-correct.

The current message — *"Use your clinical training knowledge for dosing"* — is exactly the **anti-pattern** the literature warns against: it explicitly invites the LLM to leave the grounded-knowledge boundary. This is the historical failure documented in the project's own audit.

### Recommended replacement (three layers)

**1. Auto-retry server-side with broadened search before returning "not found."**
If `get_formulary(["cefixime"])` misses, try fuzzy/brand-name alias lookup against the formulary table (most miss-cases are brand-name vs generic, e.g., "Taxim-O" vs "cefixime"). Only return "not found" if both strategies fail.

**2. Structured error payload, not prose:**
```json
{
  "status": "not_found",
  "drug_query": "cefixime",
  "tried": ["generic_name_exact", "brand_alias", "fuzzy"],
  "instruction_to_model": "Add this drug to omitted_medicines[] with reason='not_in_formulary'. Do NOT emit dosing. The server will set overall_status=REVIEW_REQUIRED."
}
```

The `instruction_to_model` field is read-only guidance; **enforcement is server-side**.

**3. Surface the gap as a structured field**, not as prose in the prescription. The doctor's UI gets a banner: *"Cefixime not found in formulary — please verify and dose manually."* Keeps the human in the loop instead of hiding the gap inside an AI-generated narrative.

## Section C — Question 3: `overall_status`

### LLM-emitted vs server-computed: server wins, decisively

`overall_status` should be **removed from the LLM-output schema entirely**. There is no scenario where having the LLM emit a safety verdict beats computing it deterministically from structured signals (`max_dose_check`, `allergy_note`, `interactions`, `omitted_medicines`, `formulary_misses`). Letting the LLM emit the field gives it the option — even unintentionally — to overwrite a server-detected REVIEW with SAFE.

The Goodell 2025 architectural principle (deterministic engine + LLM tool calls beats LLM math) applies one level up: the verdict should also be deterministic.

### FHIR / HL7 alignment

FHIR R4 `MedicationRequest.status` is a closed value set: `active | on-hold | cancelled | completed | entered-in-error | stopped | draft | unknown`. It is a **lifecycle** status, not a safety verdict — there is no FHIR "REVIEW REQUIRED" enum.

Right FHIR mapping for the safety concept:
- `MedicationRequest.status` = `draft` while review pending, `active` once doctor signs.
- Safety findings go on **`detectedIssue`** (FHIR R4 resource) with severity `high | moderate | low`, referenced from the MedicationRequest. This is the HL7-blessed place for interaction/dose/allergy alerts.

### Recommended schema

```json
// LLM emits (no overall_status):
{
  "requested_medicines": ["azithromycin","cefixime","ors"],
  "medicines": [...],
  "omitted_medicines": [{"name":"cefixime","reason":"not_in_formulary"}],
  "max_dose_check": [...],
  "allergy_note": "...",
  "interactions": [...]
}

// Server computes and appends:
{
  "overall_status": "REVIEW_REQUIRED",  // SAFE | REVIEW_REQUIRED
  "detected_issues": [
    {"severity":"high","code":"formulary_miss","detail":"cefixime"},
    {"severity":"moderate","code":"interaction","detail":"..."}
  ],
  "fhir_status": "draft"
}
```

Severity model: **three-tier (`high | moderate | low`)** mirroring FHIR `DetectedIssue.severity`, plus a binary `overall_status` derived as `any(severity == "high") → REVIEW_REQUIRED`. More useful than binary alone (the doctor wants to know *why*) and aligns with FHIR for the eventual ABDM bundle.

## Section D — Question 4: Temperature

### Evidence

- Anthropic's documented position: *"closer to 0.0 for analytical/multiple choice"* and *"even with temperature of 0.0, the results will not be fully deterministic."*
- Structured outputs use **constrained sampling with compiled grammar artifacts**. Schema compliance is enforced by the decoder; temperature affects token selection within the schema-valid set.
- General LLM JSON literature: 0.0–0.2 is standard for structured output. Above 0.3 is "rarely justified" for structured tasks.
- **No peer-reviewed clinical-LLM study identifies an optimal temperature.** Medication-safety papers do not report temperature ablations as a primary variable.

### Skeptical take on "drop to 0.2"

The instinct is correct but possibly overstated as a fix for the omission problem. Temperature 1.0 → 0.2 will reduce variance and make outputs more reproducible — good for clinical work and QA. But **it will not, on its own, solve omission**. Omission at temp=1.0 is a salience/enumeration problem, not a sampling-noise problem.

### Recommendation

**Set `temperature: 0` (not 0.2).** Reasoning:

1. With Anthropic's strict tool use / structured outputs, the schema constraint dominates. No creative-variation benefit at 0.2 vs 0.
2. Reproducibility for clinical audit / regulatory review is more valuable than the marginal diversity 0.2 provides. QA can re-run a case and get identical (or near-identical) JSON.
3. Anthropic's glossary points to ~0.0 for analytical work.
4. Caveat: temperature=0 is **not** fully deterministic on Anthropic's API, but it's as close as you get.

If extended thinking is later added, keep temperature at 0.

## Section E — Integrated Plan

### This sprint (1 week)

1. **Instrument first.** Log `stop_reason`, `usage.input_tokens`, `usage.output_tokens` on every `generate-prescription` call. Confirm whether truncation is contributing.
2. **Set `temperature: 0`** in `generate-prescription`. One-line change, immediate reproducibility win.
3. **Schema + prompt change:** add required `requested_medicines: string[]` and `omitted_medicines: [{name, reason}]`. System prompt gets XML-tagged "Step 1: enumerate every drug from the note" instruction. Server-side assertion: counts must reconcile, else retry once, else fail to REVIEW_REQUIRED.
4. **Remove `overall_status` from LLM output.** Compute server-side from `detected_issues` (severity-tiered). Update `prescriptions` schema to store both LLM payload and server-derived verdict separately.
5. **Replace formulary-not-found message** with structured payload from Section B. Add brand-alias retry inside `get_formulary` tool before returning not-found.
6. **Prompt caching** on system prompt + skill `core_prompt.md` (5-min cache). Saves ~50–70% on input tokens. Free win.

### Next sprint (2 weeks out)

7. **Audit-verifier second pass.** Cheap Haiku call: "Are any drugs from the note missing from the prescription?" Server escalates to REVIEW_REQUIRED on disagreement.
8. **FHIR alignment:** map `detected_issues[]` → FHIR `DetectedIssue`; `MedicationRequest.status` = `draft` until doctor signs. Update `generate-fhir-bundle`.

### Defer / do not do

- Don't adopt extended thinking yet. Conflicts with future `tool_choice: any` direction; schema-echo fix should suffice.
- Don't move to parallel-per-medicine tool calls. Cost/latency not justified once #3 is in place.
- Don't multiply LLM agents (Hippocratic-style 22-model constellation). Overkill for OPD scope.

### Honest things worth saying

- The customer-reported omission is **not** evidence that you need to upgrade Sonnet versions or rewrite the architecture. The schema lacks a required enumeration field and the server isn't validating completeness. Fix the schema first; if omissions persist after that AND `stop_reason` is never `max_tokens`, then escalate.
- "Drop temperature to 0.2" is half-right. Go to 0, and don't expect it to fix omission on its own.
- The "use your clinical training knowledge" fallback is the most dangerous string in the codebase. Replacing it is higher priority than the temperature change.

## Section F — Real-data audit confirming the problem (2026-04-27)

Before this research, a Supabase query against the live `prescriptions` and `visits` tables showed the following pattern across 8 recent visits:

| Visit | Patient | Doctor asked for | AI emitted | Pattern |
|---|---|---|---|---|
| RX-260427-021 | VAIDIKA | Fexofenadine + Metronidazole (2) | Fexofenadine + Metronidazole + Cefixime (3) | Added unrequested antibiotic |
| RX-260427-020 | BHAVYANSH | Cetirizine + Combiflam + Carvol + nasal drops (4) | Paracetamol + Combiflam + Cetirizine (3) | Dropped 2, added 1 |
| RX-260427-019 | NAYRA | 6 brand-named items | 6 generics with substitutions | Brand-to-generic guesswork |
| RX-260427-018 | HETANSHI | Flomist + Levolin MDI (2) | 6 meds (added 4 nebulizations + Budesonide + Fexofenadine) | **Standard-protocol contamination** |
| RX-260427-017 | PAVNI | (no meds requested) | Ondansetron + Neogadine (2) | Added meds with no request |
| RX-260427-016 | YUVRAJ | Coligram + Enterogermina + ORS (3) | Coligram + Enterogermina + Allegra (3) | ORS dropped, Allegra added |
| RX-260427-015 | KRITIKA | Vitafol + 5 others (6) | Folic Acid + 5 others (6) | Wrong substitution (Vitafol ≠ Folic) |
| RX-260427-014 | TASHVI | 5 meds | All 5 emitted but numbering bug | Schema bug |

**Summary across 8 visits:**

| Pattern | Frequency | Severity |
|---|---|---|
| AI adds medicines doctor didn't request | 5/8 | Critical |
| AI drops medicines doctor explicitly named | 3/8 | Critical |
| AI substitutes brands with wrong generics | 3/8 | Critical |
| Internal inconsistency (calc vs row2_en) | 2/8 | Critical |
| Numbering / schema bugs | 1/8 | Medium |

This audit confirmed the customer's complaint and was the primary driver for the recommendations above. The HETANSHI case (added 4 unrequested protocol drugs) was the smoking gun for standard-protocol contamination.

## Section G — Sources

- Anthropic Be clear, direct, and detailed: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/be-clear-and-direct
- Anthropic Use XML tags: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/use-xml-tags
- Anthropic Structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Anthropic Extended thinking: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- Anthropic Implement tool use: https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use
- Anthropic Tool choice cookbook: https://github.com/anthropics/anthropic-cookbook/blob/main/tool_use/tool_choice.ipynb
- Anthropic Compaction: https://platform.claude.com/docs/en/build-with-claude/compaction
- Anthropic Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Anthropic Glossary (temperature): https://platform.claude.com/docs/en/about-claude/glossary
- Introducing Claude Sonnet 4.6: https://www.anthropic.com/news/claude-sonnet-4-6
- FHIR R4 MedicationRequest: https://www.hl7.org/fhir/R4/medicationrequest.html
- ABDM India MedicationRequest profile: https://nrces.in/ndhm/fhir/r4/StructureDefinition-MedicationRequest.html
- Hippocratic AI safety-focused LLM patent: https://hippocraticai.com/safety-focused-llm-patent/
- Rx Strategist (arXiv 2409.03440): https://arxiv.org/pdf/2409.03440
- LLM as CDSS for medication safety (PMC): https://pmc.ncbi.nlm.nih.gov/articles/PMC12629785/
- NHS Real-World LLM Medication Safety Reviews (arXiv 2512.21127): https://arxiv.org/abs/2512.21127
