# 05_ai — AI Layer: Prompt Assets, Tool Contracts, Clinical References & Golden Cases

> **What this is.** The index and constitution of the **`05_ai/` layer** — the owner of the *substance the AI carries*: the prompt assets (the cacheable system prefix and pre-embedded NABH block), the **exact tool contracts** the model exchanges with the clinical knowledge base, the governed **clinical reference files** the model fetches on demand, and the **worked examples / golden cases** that are simultaneously prompt exemplars and eval inputs. It is the **hub** for this layer; the four spoke files below are authored to conform to it, to [`00_overview/README.md`](../00_overview/README.md), and to [`00_overview/canonical_decisions.md`](../00_overview/canonical_decisions.md).
>
> **What it is NOT.** It is **not** the orchestration. *How* the tool-use loop runs — model policy (`ModelPolicyPort`), prompt caching mechanics, streaming, fallback ladders, the dose-engine separation *mechanism*, the off-edge worker, the generation state machine — lives in [`../02_architecture/ai_orchestration.md`](../02_architecture/ai_orchestration.md). `05_ai/` owns **what the loop says and the exact shapes it exchanges**; `ai_orchestration.md` owns **how the loop runs**. They are complementary, never overlapping (§3).
>
> **Status:** Normative target-state spec. Build to **this**, not to the live `web/` + Supabase Edge prototype (`supabase/functions/generate-prescription/index.ts`: hardcoded model, `extractJSON` regex, inline tool defs). Where this layer disagrees with `canonical_decisions.md`, that file wins until amended by an [ADR](../00_overview/README.md#9-change-management-adrs). Where it disagrees with a **verified Anthropic/Postgres fact** (model id, parameter, caching rule), the author **flags it** rather than silently following.
>
> **Authority for model/API facts:** the `claude-api` skill (verified 2026-06). **Non-negotiable safety invariant carried here:** the deterministic dose engine is the sole arithmetic authority; **the AI proposes drug + regimen + band and never a number** (`I2`); every draft is `pending_review` until a human `SignOff` (`I3`).

---

## Table of contents

1. [Why this layer exists](#1-why-this-layer-exists)
2. [Scope boundary — `05_ai/` vs `02_architecture/ai_orchestration.md`](#2-scope-boundary)
3. [Index of the four spoke files](#3-index-of-the-four-spoke-files)
4. [The six tool contracts (the canonical surface this layer freezes)](#4-the-six-tool-contracts)
5. [Invariants this layer enforces](#5-invariants-this-layer-enforces)
6. [How `05_ai/` relates to every other section](#6-how-05_ai-relates-to-every-other-section)
7. [The dual-`05` family — directory/number reconciliation](#7-the-dual-05-family)
8. [Reading order](#8-reading-order)
9. [Conformance ledger for this layer](#9-conformance-ledger)
10. [Change management — ADRs](#10-change-management--adrs)
11. [Provenance & key source references](#11-provenance--key-source-references)
12. [Glossary](#12-glossary)

---

## 1. Why this layer exists

`05_ai/` is referenced by **six+ files** (`04_api/api_contracts.md`, `03_data/schema_design.md`, `02_architecture/ai_orchestration.md`, `02_architecture/backend_services.md`, `04_api/error_model.md`, and the `00_overview` index) as the owner of **prompt/tool substance** — yet the directory did not exist. Those references are promises this layer keeps:

- `api_contracts.md §0` defers: *"`../05_ai/*` (when present) owns prompt/tool internals."*
- `ai_orchestration.md §4` describes the **5-tool progressive-disclosure design + `compute_doses`** at the orchestration level and explicitly leaves the **full input schemas and condensed output shapes** to be expanded elsewhere.
- `schema_design.md §3.4` authors the `catalog.clinical_reference` **registry table** but defers the **governance, versioning, and authoring** of the 11 reference files to this layer.

The founding flaw this layer closes: in the prototype, the tool definitions, the condensed-output stripping (`condenseDrugForAI`), the NABH block, the reference files, and the worked examples are **scattered across an Edge Function, Storage `.md` blobs, and inline JS**, with no single owner, no versioning, and no contract a CI gate can hold. A model swap or a reference edit could silently change clinical behavior with nothing to catch it. `05_ai/` makes the AI's *content and contracts* a **first-class, governed, gate-checked artifact set** — the substance half of the same discipline `ai_orchestration.md` applies to the mechanism.

---

## 2. Scope boundary

`05_ai/` and `02_architecture/ai_orchestration.md` partition the AI surface cleanly. The rule of thumb: **orchestration = the verbs; `05_ai` = the nouns the verbs operate on.**

```
   02_architecture/ai_orchestration.md            05_ai/  (THIS LAYER)
   "HOW the loop runs"                            "WHAT the loop says & exchanges"

   ┌──────────────────────────────┐               ┌──────────────────────────────┐
   │ ModelPolicyPort (model/effort │               │ The cacheable system PREFIX  │
   │   /thinking/maxTokens/tier)   │  carries ───▶ │   (core_prompt.md + NABH)    │
   │ Prompt-cache MECHANICS        │               │ The cacheable-prefix BYTE     │
   │   (breakpoint, prefix match)  │               │   CONTRACT it must satisfy    │
   │ Streaming + fallback ladder   │  invokes ───▶ │ The 6 TOOL CONTRACTS          │
   │ Dose-engine separation        │               │   (input_schema + condensed   │
   │   MECHANISM (§4.6)            │               │    output shape)              │
   │ Off-edge worker, state machine│  resolves ──▶ │ The 11 CLINICAL REFERENCES    │
   │ Generation observability       │               │   (registry, versioning)     │
   └──────────────────────────────┘               │ The WORKED EXAMPLES ↔ golden  │
                                                   │   case bijection              │
                                                   └──────────────────────────────┘
```

| Concern | Owner | Why there |
|---|---|---|
| Per-task model id, effort, thinking, `max_tokens`, tier-downgrade | `ai_orchestration.md §2` | A *policy* resolved at boot from env; not content. |
| `cache_control` placement, prefix-match rule, pre-warm, TTL | `ai_orchestration.md §5` | The *mechanism* of caching. |
| **The exact bytes of the cached prefix** (`core_prompt.md` structure + embedded NABH) and the **"no UUID/timestamp/unsorted-JSON in prefix" byte invariant** | **`05_ai/prompt_system_design.md`** | The *content* that must be byte-frozen for the mechanism to work. |
| Tool-loop control flow, `Promise.all` fan-out, loop-cap events, streaming | `ai_orchestration.md §4, §6` | The *control flow*. |
| **The exact `input_schema` each tool shows Claude + the condensed result shape returned** | **`05_ai/tool_contracts.md`** | The *contract* the control flow carries. |
| `get_reference` name→Storage resolution mechanism; `StoragePort` adapter | `ai_orchestration.md §3` / `03_data` | The *resolver*. |
| **The 11 reference files' target content, governance, six-eye review, version→cache-bust rule, registry authoring** | **`05_ai/clinical_references.md`** | The *governed content* the resolver serves. |
| The dose-engine *separation mechanism* and the JS↔TS parity *gate* | `ai_orchestration.md §4.6` + `canonical_decisions.md` Part C | The *boundary* and its *trust gate*. |
| **The `compute_doses` tool's input_schema and verbatim-output contract** | **`05_ai/tool_contracts.md`** (delegates to the TS `DoseEnginePort`) | The *tool surface* over the engine. |

> **The seam test.** If a change alters *when or how often* the model calls a tool, retries, or streams → `ai_orchestration.md`. If it alters *the shape, the words, the schema, or the clinical content* the model sees or returns → `05_ai/`. A change that touches both files a coordinated edit and an [ADR](#10-change-management--adrs).

---

## 3. Index of the four spoke files

`05_ai/` is the hub. Each spoke is a self-contained file authored to conform to this README, to `canonical_decisions.md` Part B, and to `ai_orchestration.md`. Files marked *(planned)* are scaffolded and filled as the rebuild matures; this index is the contract they implement.

| # | File | Owns | Key contracts it freezes | Primary invariants |
|---|---|---|---|---|
| **05a** | **`prompt_system_design.md`** *(planned)* | The rebuilt `core_prompt.md` structure; the **pre-embedded NABH block**; the **prompt-cache prefix layout** — the exact `tools → system → messages` byte-frozen prefix, breakpoint placement, the **4096-token Opus-4.8 minimum** cacheable prefix, and the *"no UUID / timestamp / unsorted-JSON / per-request id in the prefix"* invariant. The **search-first nudge** and the **prescriptive tool-description** copy that counter Opus 4.8's tool under-reach. | The cacheable-prefix **byte contract**; the `usage.cache_read_input_tokens != 0` audit assertion (CI-checked); the system-prompt copy as a versioned artifact. | I1 (TTFT), I5, I6 |
| **05b** | **`clinical_references.md`** *(planned)* | The **11 `references/*.md`** files' target content, governance, **versioning**, and the authoring of the **`catalog.clinical_reference` registry** (`ref_name → storage_key → content_hash → version`). **Six-eye clinical review** for any reference edit; the **reference-version-bump → cache-bust** rule. The `nabh_compliance` reference's relationship to the pre-embedded NABH block. | The `clinical_reference` registry rows; the `get_reference` **name → Storage object** resolution; the version-bump→cache-bust governance rule. | I6, NABH traceability |
| **05c** | **`tool_contracts.md`** *(planned)* | The **6 tools'** exact `input_schema` given to Claude **and** the **condensed output shape** returned to the model (PII-stripped, token-stripped). The `condenseDrugForAI()` output contract; the typed `PreviousRxView`; the de-identified patient context handed to tools (`'M'\|'F'` form, C2). `strict: true` on tools whose inputs must validate exactly; the final-turn `output_config.format = {type:"json_schema", schema: prescription.v1.json}`. | The frozen tool JSON-Schemas + the condensed result contracts (§4); the Ajv schemas for tool I/O (contract-tested by `09`). | **I2**, I5, I6 |
| **05d** | **`worked_examples_and_golden_cases.md`** *(planned)* | The **worked examples** (Arjun AOM, the neonatal/preterm renal edges) as **both** prompt exemplars **and** eval golden inputs; the mapping from each worked example to its `evals/golden/cases/*.case.json`. Which examples are `split:train` (prompt iteration) vs `split:test` (gate). | The **example ↔ golden-case bijection**; the train/test split discipline; the dosing facts each case asserts against the engine. | I2, A3 (answer from data) |

> **Composability rule.** No two spoke files may declare conflicting tool schemas, reference names, prefix bytes, or split assignments. The source of truth for those is **this README** and `canonical_decisions.md` Part B. A spoke needing a different value files an [ADR](#10-change-management--adrs) that amends this file first — it does not silently diverge.

---

## 4. The six tool contracts

The canonical surface `05_ai/tool_contracts.md` authors in full: the **5 progressive-disclosure tools + `compute_doses`**, all behind the `ClinicalKnowledgePort` (orchestration) / `DoseEnginePort` (the arithmetic boundary). For each tool: the `input_schema` Claude sees, and the **condensed** result shape (PII-stripped, token-stripped) the model receives back. These are **frozen here at contract level**; the spoke expands each with the full Ajv schema and the `__fake__` fixture peer.

| Tool | `input_schema` (to Claude) | Condensed output to the model |
|---|---|---|
| `get_standard_rx` | `{ icd10?: string, diagnosis_name?: string }` — **ICD-10-first**, `pg_trgm` name fallback. | One deterministic protocol: `{icd10, diagnosis_name, first_line_drugs[], investigations[], duration_days_default, warning_signs[], counselling[]}`. **No** internal ids, **no** audit columns. |
| `get_formulary` | `{ drug_names: string[] }` (batched — one round for all drugs). | Per drug, `condenseDrugForAI()`: identity + `dosing_bands` + safety arrays + promoted `max_single_*` / `max_daily_*`. **Strips** `brand_names`/`indian_brands` (~77% of tokens), SNOMED metadata, null fields, provenance/audit columns. |
| `get_previous_rx` | `{ patient_id: string }` (server-resolved from the visit; **opaque uuid**, never UHID). | Typed `PreviousRxView[]` — **no PII field exists on the type**: dates, drug generics, regimens only. **Compile-time un-leakable** (the boundary is a type, not a `.map()`). |
| `get_lab_history` | `{ patient_id: string }` (opaque uuid). | Recent `lab_results`: `{test_name, value, unit, flag, test_date, loinc?}`; **no identifiers**. |
| `get_reference` | `{ name: string }` — a registry **name** (e.g. `'neonatal_dosing'`), not a path. | The resolved `.md` body from `catalog.clinical_reference` (versioned, content-hashed Storage key). |
| **`compute_doses`** | `{ drugs: [{ generic, formulation, method, band, frequency, is_per_day }], patient: {weightKg, heightCm?, ageDays, correctedAgeDays?, gaWeeks?, egfr?} }` — **NO numeric mg/ml/drops fields from the model.** | The **TS `DoseEnginePort` output verbatim**: `{ vol, enD (R2 English), hiD (R3 Devanagari), calc, capped, warnings[], ingredientDoses[], pictogram }`. Copied into `medicines[]` **unchanged**. |

> **Canonical anchors (verbatim from `canonical_decisions.md`):**
> - **C2 (`sex`):** the patient context handed to tools uses the **de-identified `'M'\|'F'`** form (`'O'`/unknown → omission; no PII).
> - **C5 (dose engine):** `compute_doses` delegates to the **TS `DoseEnginePort`** (runtime authority). `web/dose-engine.js` is the **frozen parity oracle**, never invoked in the tool path.
> - **C3 (safety):** any safety value this layer surfaces uses `overall_status ∈ {'SAFE','REVIEW_REQUIRED'}` (UPPER_SNAKE, stored/wire) and `severity_final ∈ {'none','moderate','high'}`; the spaced `REVIEW REQUIRED` is **display only**.

---

## 5. Invariants this layer enforces

`05_ai/` does not *re-derive* the system invariants — it **enforces** them at the content/contract surface. Cross-referenced, not restated:

| Invariant | How `05_ai/` enforces it |
|---|---|
| **I2 — dose engine is the sole arithmetic authority; AI emits no numbers.** | The `compute_doses` `input_schema` **structurally omits** numeric mg/ml/drops fields; the model can only propose drug + regimen + band. The condensed `get_formulary` output carries `dosing_bands`, never a computed dose. `compute_doses` is **mandatory when `medicines[]` is non-empty** (server-asserted; the prototype already asserts `tools_called.includes("compute_doses")`). |
| **I6 — no PII reaches the model; every generation is auditable.** | Every tool output carries **uuids only** (C2 de-id form; `06_security` SEC-3). `get_previous_rx` returns the **typed `PreviousRxView`** with no PII field reachable. `patient_id` in tool args is the opaque uuid, never UHID; no name/UHID interpolated into the cached prefix. |
| **I5 — vendors behind ports; no model/secret in business code.** | Tool schemas live in `core/`, executed via `ClinicalKnowledgePort`; the model id never appears in a tool definition (resolved by `ModelPolicyPort`). The reference resolver goes through `StoragePort`. |
| **I1 — perceived wait ≈ 0; TTFT.** | The **byte-frozen cacheable prefix** (`05a`) is the cache-read win: a silent invalidator (UUID/timestamp/unsorted JSON in the prefix) regresses TTFT and cost; the `cache_read_input_tokens != 0` assertion is the canary. |
| **I3 — draft is `pending_review` until human `SignOff`.** | No tool, schema, or reference can produce a signed prescription. The final-turn structured output (`prescription.v1.json`) yields a *draft*; sign-off is a separate command on the bus (`02`). |

**Behavioral guardrails this layer additionally fixes (cross-referenced):**
- Tool results are returned in a **single `tool_result` user message** (parallel `Promise.all`), **never split** — splitting trains Opus 4.8 to stop making parallel calls (`ai_orchestration.md §4.3`).
- `strict: true` on tools whose inputs must validate exactly; the final-turn `output_config.format` + Ajv validation **retires `extractJSON`** (`ai_orchestration.md §4.4`).
- The **pre-embedded NABH block** (`05a`) saves a tool round and sits **inside the cached prefix**; `clinical_references.md` (`05b`) governs the source `nabh_compliance.md` and the bump→cache-bust rule when it changes.

---

## 6. How `05_ai/` relates to every other section

`05_ai/` sits at the centre of the generation path; nearly every other spoke either feeds it or consumes its contracts.

| Section | Relationship to `05_ai/` |
|---|---|
| **`02_architecture/ai_orchestration.md`** | **The closest sibling.** Owns the loop mechanism; *invokes* the tools and *carries* the prefix this layer authors. The §2 boundary table is the exact partition. |
| `02_architecture/backend_services.md` | The off-edge worker that executes the `ClinicalKnowledgePort` tools and the `DoseEnginePort` `compute_doses` call; cites this layer for the contracts it runs. |
| `03_data/schema_design.md` | Provides the backing tables: `catalog.formulary` (`get_formulary`), `catalog.standard_prescriptions` (`get_standard_rx`), `catalog.clinical_reference` (`get_reference` registry, §3.4), `clinical.lab_results` (`get_lab_history`), `clinical.guardian_consents` (the `ai_assisted_rx` consent gate, C6). |
| `04_api/api_contracts.md` | The wire contract that *triggers* generation (`POST …/generations → 202`) and streams `ToolInvoked`/`DraftDelta`; its `args_redacted` SSE payloads are the redacted view of these tools' inputs. |
| `04_api/error_model.md` | Carries the failure codes this layer's contracts can raise (e.g. `schema_invalid` on Ajv failure, `CONSENT_REQUIRED` when the `ai_assisted_rx` gate blocks generation — C6). |
| `06_security/security_auth_rbac_compliance.md` | The de-identification boundary (`DeidentifiedPatientContext`, SEC-3) and the **`ai_assisted_rx` guardian-consent gate** (C6) that **blocks generation at the `RequestGeneration` command boundary** before any tool runs. |
| `09_engineering_discipline/*` | **Gates this layer.** `evals_framework.md` consumes the worked-examples↔golden-cases bijection (`05d`); `tool_contracts.md` schemas are contract-tested (Ajv); the cache-read assertion and the `compute_doses`-mandatory check are CI gates; the **dose-engine golden-parity gate** (`canonical_decisions.md` Part C) is the trust precondition for the TS port `compute_doses` delegates to. |

---

## 7. The dual-`05` family

**Directory/number reconciliation (recorded so this is a *decision*, not a collision).** Two numbering schemes coexist on disk: the `00_overview` README's logical `01_frontend … 09_engineering_discipline`, and the as-built directory names (`02_architecture`, `03_data`, `04_api`, `05_integration`, `06_security`, `07_deployment`, `08_migration`).

- The on-disk integration directory is **`05_integration/`** (ABDM/FHIR substance). The AI layer is authored at the path the six+ referencing files already use — **`05_ai/`** — as a **sibling** of `05_integration/`. Both are **"05-class" content**: AI substance and ABDM/FHIR substance.
- This is the form `canonical_decisions.md` **Part B.0** pins. The `00_overview` index gains one row (`05_ai/`) and a note that `05_*` is a **family, not a single directory**.
- If a future ADR prefers strict single-number directories, the clean rename is `04_api → 04_api`, `05_ai`, `05b_integration` — **deferred**; not worth the cross-link churn now.

---

## 8. Reading order

Read **`00_overview/README.md` and `canonical_decisions.md` first**, then `ai_orchestration.md` (the mechanism), then this layer's spokes in build order.

```
   00_overview (vision, I1–I7) + canonical_decisions (C1–C7, Part B)
        │
        ▼
   02_architecture/ai_orchestration.md   ← the loop MECHANISM (read before the nouns)
        │
        ▼
   05_ai/README.md (this file)           ← the layer index + the 6 tool contracts
        │
   ┌────┴───────────────┬───────────────────┬───────────────────────┐
   ▼                    ▼                   ▼                       ▼
 05a prompt_system   05b clinical_       05c tool_              05d worked_examples_
   _design          references          contracts              and_golden_cases
 (the prefix &      (the 11 refs +      (the 6 schemas +       (examples ↔ golden
  NABH bytes)        registry +          condensed shapes)      cases; train/test)
                     governance)
```

**By role:**

| If you are… | Read, in order |
|---|---|
| **Touching a tool's schema or condensed output** | `00 §C2/C5` → this README §4 → `05c tool_contracts.md` → `09 evals` (contract test). |
| **Editing the system prompt or NABH block** | `ai_orchestration.md §5` (caching mechanism) → `05a prompt_system_design.md` → `09 evals` (cache-read + behavioral gate). |
| **Adding or editing a clinical reference** | `05b clinical_references.md` (six-eye review + version→cache-bust) → `03_data §3.4` (registry) → `09 eval-data-governance`. |
| **Adding a golden / worked example** | `05d worked_examples_and_golden_cases.md` → `09 evals_framework.md` (split discipline + PHI-scanner gate). |
| **Wiring the consent gate before generation** | `06_security` (SEC-7, C6) → `04_api/error_model.md` (`CONSENT_REQUIRED`) → `02 ai_orchestration §9`. |

---

## 9. Conformance ledger

This layer conforms to `canonical_decisions.md` Part B iff every box is true after the spokes are authored.

- [ ] **`05_ai/` exists** with the four spoke files (`prompt_system_design`, `clinical_references`, `tool_contracts`, `worked_examples_and_golden_cases`), authored as a **sibling** of `05_integration/` (§7).
- [ ] **The 6 tool contracts are frozen** at contract level — `input_schema` + condensed output for `get_standard_rx`, `get_formulary`, `get_previous_rx`, `get_lab_history`, `get_reference`, `compute_doses` (§4).
- [ ] **`compute_doses` delegates to the TS `DoseEnginePort`** (C5) and is **mandatory when `medicines[]` is non-empty** (server-asserted); the model proposes drug + regimen + band, **never a number** (I2).
- [ ] **No PII reaches the model:** tool outputs carry **uuids only**; `get_previous_rx` returns the typed `PreviousRxView`; the de-identified context is `'M'\|'F'` (C2).
- [ ] **The cacheable prefix is byte-frozen** (`05a`): no UUID/timestamp/unsorted-JSON/per-request id in the prefix; `cache_read_input_tokens != 0` is a CI assertion.
- [ ] **The 11 references are governed** (`05b`): registry rows in `catalog.clinical_reference`; six-eye review; version-bump → cache-bust.
- [ ] **Worked examples map 1:1 to golden cases** (`05d`) with explicit `split:train` / `split:test` discipline.
- [ ] **Safety vocabulary matches C3:** `overall_status ∈ {SAFE, REVIEW_REQUIRED}` stored/wire; spaces display-only.
- [ ] **`extractJSON` is retired:** final-turn `output_config.format` + Ajv against `prescription.v1.json`; `strict:true` where inputs must validate.

---

## 10. Change management — ADRs

The §2 scope boundary, the §4 tool contracts, the §3 file roster, and the §7 dual-`05` decision are **fixed until amended by an Architecture Decision Record**. To change one: open `docs/adr/NNNN-<slug>.md` that (a) states the decision and context, (b) names the replacement and shows it satisfies the same contract/invariant (especially I2/I6), (c) lists consequences and the rollback, and (d) updates this README **and** `canonical_decisions.md` Part B in the **same PR**. A change that alters a tool's *shape, words, schema, or clinical content* is a **High-risk** change under `09 §10` — full eval gate + named human approver. A spoke needing a value this file does not grant files the ADR **before** proceeding.

---

## 11. Provenance & key source references

Grounded in the canonical decisions and the sibling spokes (read to author this layer):

- **`00_overview/canonical_decisions.md`** — Part B (the `05_ai/` roster + the 6 tool contracts), Part B.0 (dual-`05`), Part C (dose-engine golden-parity gate), C2 (`sex` de-id), C3 (safety vocabulary), C5 (dose-engine authority/oracle), C6 (`ai_assisted_rx` consent gate).
- **`02_architecture/ai_orchestration.md`** — §2 model policy, §4 tools + dose separation (§4.6), §5 caching, §9 generation state machine (the mechanism this layer carries).
- **`04_api/api_contracts.md`** — §0 (defers prompt/tool internals to `05_ai/*`), §4 generation jobs, §5 SSE (`ToolInvoked`/`args_redacted`).
- **`03_data/schema_design.md`** — §3.1 `catalog.formulary`, §3.2 `catalog.standard_prescriptions`, §3.4 `catalog.clinical_reference` registry, §5.2 `clinical.guardian_consents`.
- **`06_security/security_auth_rbac_compliance.md`** — §3.2 `DeidentifiedPatientContext` (`'M'\|'F'`), SEC-3 (no PII to model), SEC-7 (guardian consent).
- **`09_engineering_discipline/`** — `evals_framework.md` (golden set, never-events, judge discipline), `quality_gates_ci.md` (contract + cache-read gates), `testing_strategy.md` (dose-parity runner).
- **Prototype (port-from, then retire):** `supabase/functions/generate-prescription/index.ts` (5-tool defs, `condenseDrugForAI`, `extractJSON`, `compute_doses` def, three-tier severity); `radhakishan_system/skill/core_prompt.md` (the cached prefix); `radhakishan_system/skill/references/*.md` (the 11 reference files); `radhakishan_system/skill/examples/worked_example.md` (Arjun AOM).
- **Authority for model/API facts:** the `claude-api` skill (Opus 4.8 `claude-opus-4-8`, adaptive-thinking-only, `effort` in `output_config`, streaming-mandatory > ~16K, prompt-cache prefix rules, 4096-token minimum, refusal guard) — verified 2026-06.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Progressive disclosure** | The design where Claude fetches only the clinical knowledge it needs, one tool at a time, rather than receiving the whole skill up front — the 5 read tools. |
| **`condenseDrugForAI()`** | The token-stripping boundary on `get_formulary` output: keeps identity + dosing bands + safety, strips brand names (~77% of tokens), SNOMED metadata, nulls, provenance. |
| **`PreviousRxView`** | The typed, PII-stripped boundary on `get_previous_rx` — dates, generics, regimens only; no PII field is reachable at compile time. |
| **`compute_doses`** | The arithmetic tool: the model passes drug + regimen + band (no numbers); the pure TS `DoseEnginePort` returns the verbatim dose output copied into `medicines[]`. |
| **Cacheable prefix** | The byte-frozen `tools → system → messages` prefix (skill `core_prompt.md` + pre-embedded NABH) before the cache breakpoint; any byte change invalidates the cache. |
| **Pre-embedded NABH block** | The NABH compliance block concatenated into the cached system prefix so Claude never spends a tool round fetching it. |
| **`catalog.clinical_reference`** | The registry mapping each of the 11 reference names → versioned, content-hashed Storage key, so `get_reference` resolves a name (not a path) and edits cache-bust. |
| **Example ↔ golden-case bijection** | The 1:1 mapping from each worked example (Arjun AOM, neonatal/preterm edges) to its `evals/golden/cases/*.case.json`, split `train` (prompt iteration) vs `test` (gate). |
| **`ai_assisted_rx` consent gate** | The C6 guardian-consent precondition: generation is blocked at the `RequestGeneration` command boundary unless an active `ai_assisted_rx` consent exists (→ `CONSENT_REQUIRED`). |

---

> **Bottom line.** `02_architecture/ai_orchestration.md` runs the loop; **`05_ai/` is everything the loop carries** — the byte-frozen prompt prefix, the six exact tool contracts, the eleven governed clinical references, and the worked examples that double as golden cases. The AI proposes drugs and regimens and narrates; it never computes a number and never sees PII; every word and schema here is versioned, governed, and gate-checked — the substance half of the same discipline the orchestration applies to the mechanism.
