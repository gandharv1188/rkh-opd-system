# 05 · AI — Tool Contracts (the six tools' wire surface)

> **Status:** Authoritative TARGET-STATE rebuild specification. Build to **this**, not to the live
> `supabase/functions/generate-prescription/index.ts` prototype (anon-key `fetch()` inside the tool
> executors, ad-hoc `.map()` PII strip, free-text `tool_result` strings). Where this document and an
> upstream study report disagree, this document wins; where it disagrees with a **verified
> Postgres / Anthropic / ABDM fact**, the file author flags it.
>
> **Scope of this file.** The single deepest treatment of the **wire contract between the Claude
> tool-use loop and the system** for the rebuilt Generation bounded context. For each of the six
> tools behind `ClinicalKnowledgePort` — `get_standard_rx`, `get_formulary`, `get_previous_rx`,
> `get_lab_history`, `get_reference`, and `compute_doses` — it freezes (1) the exact JSON
> `input_schema` Claude is given, (2) the **condensed / token-stripped output shape** returned to the
> model, (3) the **error semantics** (what the model sees when a tool cannot answer), and (4) the
> **PII-handling rule per tool**. It is the contract `02_architecture/ai_orchestration.md §4` *invokes*
> (the orchestration owns "how the loop runs"; this file owns "what the loop says and the exact shapes
> it exchanges").
>
> **Authority & subordination.** This file is a spoke of `00_overview/README.md §7` and is **bound by
> `00_overview/canonical_decisions.md`** (Part B.2 freezes this surface at contract level — C2 sex
> form, C5 dose-engine authority, C6 consent gate, B.2 condensed-output invariants). Where this file
> and `canonical_decisions.md` disagree, `canonical_decisions.md` wins until amended by an ADR. Its
> siblings: `02_architecture/ai_orchestration.md` owns the tool-loop mechanics, parallelism, caching,
> and the dose-separation *mechanism*; `03_data/schema_design.md` owns the `catalog.*` / `clinical.*` /
> `prescribing.*` tables these tools read; `04_api/error_model.md` owns the canonical error envelope
> and the C6 clinical-safety codes; `06_security/security_auth_rbac_compliance.md §3.2` owns the
> de-identification boundary (`DeidentifiedPatientContext`, SEC-3); `05_ai/clinical_references.md` owns
> the `catalog.clinical_reference` registry that `get_reference` resolves against;
> `05_ai/prompt_system_design.md` owns the cacheable prefix the tool definitions sit inside.
>
> **Provenance.** Verified this session against `supabase/functions/generate-prescription/index.ts`
> (the five tool defs lines 56–151, `condenseDrugForAI` 176–241, executors 243+), the `compute_doses`
> tool def + `ComputeDoseParams`/`ComputeDoseResult`/`IngredientDoseDetail` exports on
> `origin/sprint-2-saved:supabase/functions/_shared/dose-engine.ts`, and `web/dose-engine.js` (the
> frozen parity oracle, C5). The `claude-api` skill is the authority for tool-use API facts.

---

## 0. The contract in one paragraph

The model never reaches the database, Storage, or the dose engine directly. It reaches them only
through **six named tools** behind the pure `ClinicalKnowledgePort` (interface only, no adapter
imports). Each tool has a **frozen `input_schema`** (a JSON Schema given to Claude in the cached
`tools` prefix) and returns a **condensed, token-stripped, PII-free result** to the model. The five
**progressive-disclosure** tools (`get_standard_rx`, `get_formulary`, `get_previous_rx`,
`get_lab_history`, `get_reference`) let Claude fetch only the clinical knowledge a given note needs;
the sixth, **`compute_doses`**, is the **arithmetic firewall** — the model proposes drug + regimen +
band selection with **zero numeric mg/ml/drop fields**, the pure TS `DoseEnginePort` (C5) computes
every number, and the model copies the engine output **verbatim**. Three invariants bind every tool:
(I-AI-1) **no PII to the model** — every result is a typed DTO whose type *has no PII fields*, so a
leak is a compile error, not a review miss (SEC-3, C2); (I-AI-2) **`compute_doses` is mandatory when
`medicines[]` is non-empty**, server-asserted, and the model never emits a number the engine did not
produce (C5, I2); (I-AI-3) **a tool that cannot answer returns a typed, non-fatal `tool_error`
result** that the model can reason about — it never throws an exception into the loop and never
silently returns an empty success. Tool inputs carry **opaque UUIDs only** (never UHID/PII);
identifiers in tool args are resolved server-side from the `visit_id` that opened the job.

---

## 1. Design principles (the rules every tool obeys)

| # | Principle | Why | Realization |
|---|-----------|-----|-------------|
| **T1** | **Frozen `input_schema`, versioned with the prefix.** Each tool's JSON Schema is byte-stable and lives in the cached `tools` block (render order `tools → system → messages`). | A byte change to any tool def invalidates the whole prompt-cache prefix (`05_ai/prompt_system_design.md §cache`). Schemas change only via an ADR + a deliberate cache-bust. | Schemas are static module constants; `tools` array is sorted, deterministic. |
| **T2** | **Condensed output, not raw rows.** Every result is a token-minimized DTO — the model gets clinical substance, never DB columns, audit fields, provenance, or null fields. | The prototype's `condenseDrugForAI()` strips ~83 % of formulary tokens (`brand_names`/`indian_brands`, SNOMED metadata, nulls); the same discipline applies to every tool. | Per-tool `condense*()` pure functions (§3–§8). |
| **T3** | **No PII in any tool input or output** (SEC-3, C2). | DPDP child-data + NABH; the model selects drugs and narrates — it never needs a name, UHID, phone, DOB, or ABHA. | Typed de-identified DTOs (`PreviousRxView`, `LabResultView`, `DeidentifiedPatientContext`); UUID-only args. |
| **T4** | **Typed, non-fatal errors.** A tool that misses, fails upstream, or is handed bad input returns a `{ tool_error: {...} }` result the model can act on — never an uncaught throw, never a bare empty array masquerading as "no protocol exists". | Fail-soft on infra so the loop continues; the model can fall back (e.g. `get_standard_rx` miss → compose from `get_formulary`). The hard clinical-safety gate lives at the **server re-check** (`compute_doses` + the safety re-run), not in a tool's error path. | §2.4 error envelope; `04_api/error_model.md` C5/C6 mapping. |
| **T5** | **Arithmetic is `compute_doses`-only (C5/I2).** The model proposes `{generic, formulation, method, band, frequency, is_per_day}` — **no `mg`/`ml`/`drops` numbers**. The engine returns them; the model copies verbatim. | The system's primary clinical-safety invariant: *the AI never does arithmetic that reaches paper.* | `compute_doses` schema omits numeric outputs from the model's proposal; server byte-for-byte re-check (§8.5). |
| **T6** | **Parallel results in ONE `tool_result` message.** Independent tools execute concurrently (`Promise.all`); all `tool_result` blocks return in a **single** user message — never split (splitting trains Opus 4.8 to stop making parallel calls). | Preserves parallel-call behaviour on Opus 4.8 (verified, `claude-api`). | Orchestration (`ai_orchestration.md §4.3`); this file fixes the per-block shape. |
| **T7** | **Prescriptive `description` (when-to-call), `strict` where inputs must validate.** Each `description` states *when* to call ("Call `get_standard_rx` whenever a diagnosis or ICD-10 appears"), countering Opus 4.8's tool-under-reach. `strict: true` on tools whose inputs must validate exactly. | Opus 4.8 is conservative about reaching for tools; prescriptive descriptions give measurable should-call lift. | §3–§8 `description` text; §9 `strict` matrix. |

---

## 2. Cross-cutting tool conventions

### 2.1 The `ClinicalKnowledgePort` seam

```ts
// src/ports/clinical-knowledge.ts — interface only; no adapter imports, no fetch, no SQL literals
export interface ClinicalKnowledgePort {
  getStandardRx(input: GetStandardRxInput, ctx: ToolCtx): Promise<StandardRxView | ToolError>;
  getFormulary(input: GetFormularyInput, ctx: ToolCtx): Promise<FormularyView[] | ToolError>;
  getPreviousRx(input: GetPreviousRxInput, ctx: ToolCtx): Promise<PreviousRxView[] | ToolError>;
  getLabHistory(input: GetLabHistoryInput, ctx: ToolCtx): Promise<LabResultView[] | ToolError>;
  getReference(input: GetReferenceInput, ctx: ToolCtx): Promise<ReferenceView | ToolError>;
  computeDoses(input: ComputeDosesInput, ctx: ToolCtx): Promise<ComputeDosesResult>; // delegates to DoseEnginePort (C5)
}
```

- **`ToolCtx`** is server-only and **never reaches the model**: `{ visitId, patientId, facilityId, role, correlationId }`. The model's tool args carry **only** what its `input_schema` declares; the worker resolves `patientId`/`facilityId` from `ToolCtx` (derived from the `visit_id` that opened the job), **not** from the model's args. A `patient_id` field in a tool's `input_schema` is the **opaque visit-resolved UUID** the worker injects into the prompt's volatile (post-cache) region, never a UHID the model invented.
- Adapters (`DatabasePort`-backed for the four DB tools, `StoragePort`-backed for `get_reference`, `DoseEnginePort`-backed for `compute_doses`) are chosen in `wiring/` by env. `core/` is CI-fenced from `fetch`, SQL literals, adapter imports, and model literals. Every tool has a `__fake__` peer returning fixture rows for sub-second tests.

### 2.2 Where the identifiers come from (least-PII, A7 / SEC-3)

The prototype put the **UHID** in `get_previous_rx`/`get_lab_history` args (`"RKH-25260300001"`) and asked the model to copy it from a "PATIENT ID line" in the note. **Deleted.** In the rebuild:

- The job is opened for a `visit_id`; the worker resolves `patient_id` (an opaque UUID) and the de-identified patient context server-side **once**, places the de-identified context in the volatile post-cache message region, and passes `patient_id` (the UUID) as the value the model echoes into `get_previous_rx`/`get_lab_history`.
- **No UHID, name, phone, DOB, or ABHA is ever in a tool arg or a tool result.** `patient_id` is a UUID with no decodable PII.
- The clinical note may contain PII **only as the doctor typed it**; the system adds none and interpolates none into the cached prefix (`06_security §3.2`, prompt-cache hygiene).

### 2.3 The de-identified patient context (shared input to the loop, C2)

This is **not** a tool result — it is the patient frame the worker injects post-cache so the model can select drugs/regimens. It is the only patient data the model sees, and it is the C2 model-facing form:

```ts
// core/phi/deidentify.ts — pure, total; the ONLY path patient data takes to the model (SEC-3)
export interface DeidentifiedPatientContext {
  patientId: string;            // opaque UUID — the value echoed into get_previous_rx / get_lab_history args
  ageInDays: number;            // server-computed from DOB; DOB itself never sent
  correctedAgeInDays?: number;  // preterm rule pre-resolved server-side (P-corrected); model does NO age math
  weightKg?: number;
  heightCm?: number;
  gestationalAgeWeeks?: number;
  egfr?: number;                // for GFR-adjusted dosing; pre-computed, never derived by the model
  sex: 'M' | 'F';              // C2: model-facing form is 'M'|'F'; DB tokens male/female/other map at the adapter; 'O'/unknown omitted
  allergies: readonly string[]; // drug/substance terms only — no identifiers
  // NOTHING that identifies the child: no name, UHID, guardian, phone, address, DOB, or ABHA
}
```

> **C2 mapping note.** The DB stores `sex in ('male','female','other')` (lowercase). The API/DTO form is `'M'|'F'|'O'`. The **model-facing** form is `'M'|'F'` — `'O'`/unknown maps to *omission of any sex-specific dosing branch* (pediatric dosing has none that depends on it). The single `sexToApi`/`sexFromApi` mapping lives at the database-adapter boundary; no tool code branches on sex strings.

### 2.4 Tool-error envelope (T4 — what the model sees on failure)

When a tool cannot return a normal result, the `tool_result` block carries this **typed, model-readable** shape (and `is_error: true` on the SDK `tool_result` so the model treats it as a non-success), **never** an exception and **never** a silent empty success:

```jsonc
// returned as the content of the tool_result block for the failing tool_use_id
{
  "tool_error": {
    "code": "STANDARD_RX_NOT_FOUND",   // stable UPPER_SNAKE; enumerated per tool in §3–§8
    "message": "No protocol for ICD-10 'H66.90'. Compose from formulary + clinical judgement.",
    "retryable": false,                 // false = re-calling with the same args won't help
    "hint": "diagnosis_name_fallback"   // optional: a next-step the model can take
  }
}
```

**Disposition rules:**
- A tool error is **fail-soft to the loop** (the model continues and can fall back) — it is **not** itself a clinical-safety hard fail. The hard gates live at the server re-check: a missing dose → `compute_doses` returns un-computable → the drug is **omitted with a red stub** (`DOSE_UNCOMPUTABLE`), a formulary miss → `FORMULARY_MISS` omitted stub, never an AI-guessed number (`04_api/error_model.md §6.3`).
- Every tool error is recorded on the `prescription_audit` row (`warnings[]`, `tools_called[]`) and emitted as a `ToolInvoked` domain event (`02_architecture/ai_orchestration.md §7`) so the forensics trail is complete.
- An **infrastructure** failure inside a tool (DB down, Storage 5xx) maps to the canonical `UPSTREAM_FAILED`/`UPSTREAM_TIMEOUT` envelope at the job boundary (`04_api/error_model.md §5.5`) — the worker retries per the upstream policy; if exhausted, the *generation* degrades (it does not return a wrong tool result to the model).

### 2.5 Result-size & token discipline (T2)

| Tool | Raw row(s) | Condensed to the model | Stripped |
|---|---|---|---|
| `get_standard_rx` | one `catalog.standard_prescriptions` row (+ JSONB blobs) | one deterministic protocol DTO | surrogate id, FK ids, audit/platform cols, `source`, `last_reviewed_date`, nulls |
| `get_formulary` | N `catalog.formulary` rows (heavy JSONB) | N `condenseDrugForAI()` DTOs | `brand_names`/`indian_brands` (~77 % of tokens), SNOMED metadata, null fields, provenance, governance cols |
| `get_previous_rx` | N `prescribing.prescriptions` rows | N `PreviousRxView` (no PII fields *on the type*) | every PII column, signatures, receipts, ids, audit |
| `get_lab_history` | N `clinical.lab_results` rows | N `LabResultView` | patient/visit ids, OCR provenance, verifier cols, lab_name unless clinically needed |
| `get_reference` | one Storage `.md` object | the `.md` body (already authored for the model) | nothing (the file *is* the payload) — but resolved via the versioned registry, content-hashed |
| `compute_doses` | engine call | `ComputeDoseResult` **verbatim** | nothing — the engine output is the contract; the model copies it unchanged |

---

## 3. `get_standard_rx` — ICD-10-first protocol lookup

**Backing port:** `DatabasePort` → `catalog.standard_prescriptions` (UNIQUE `(icd10, category, severity)`, `pg_trgm` fuzzy `diagnosis_name` fallback). One deterministic protocol per call.

### 3.1 `input_schema` (given to Claude)

```jsonc
{
  "name": "get_standard_rx",
  "description": "Look up the hospital-approved standard prescription protocol for a diagnosis. ALWAYS use the ICD-10 code as the primary lookup key — it is exact and unambiguous. Fall back to diagnosis_name only if you do not know the ICD-10 code (fuzzy-matched). Call this WHENEVER a diagnosis or ICD-10 code appears in the note, BEFORE composing medicines. Returns first_line_drugs (with regimen + band hints), second_line_drugs, recommended investigations, counselling, warning signs, and referral/hospitalisation criteria.",
  "input_schema": {
    "type": "object",
    "properties": {
      "icd10": {
        "type": "string",
        "description": "ICD-10 code, e.g. 'H66.90', 'J06.9', 'A09'. PREFERRED — primary lookup key."
      },
      "diagnosis_name": {
        "type": "string",
        "description": "Standard medical diagnosis name, e.g. 'Acute Otitis Media'. Fallback only when the ICD-10 code is unknown; matched fuzzily (pg_trgm). Use proper medical terminology, not colloquial terms."
      }
    },
    "required": []
  }
}
```

> **Schema note.** `required: []` (either key satisfies the call); the **worker** asserts at least one of `icd10` / `diagnosis_name` is present and returns `INVALID_TOOL_INPUT` otherwise. `strict` is **false** here (the model legitimately calls with one of two keys). The lookup is **ICD-10-first**: if `icd10` is present and resolves, `diagnosis_name` is ignored; otherwise `pg_trgm similarity(diagnosis_name)` with a floor (e.g. ≥ 0.3) returns the single best protocol.

### 3.2 Condensed output to the model (`StandardRxView`)

```jsonc
{
  "icd10": "H66.90",
  "diagnosis_name": "Acute Otitis Media",
  "category": "ENT",
  "severity": "any",
  "match": { "by": "icd10", "score": 1.0 },   // by: 'icd10' | 'name_fuzzy'; score present only for fuzzy
  "first_line_drugs": [
    { "generic_name": "AMOXICILLIN", "method": "weight", "band_hint": "child", "frequency_per_day": 3, "duration_days": 5, "note": "high-dose for AOM" }
  ],
  "second_line_drugs": [
    { "generic_name": "AMOXICILLIN-CLAVULANATE", "method": "weight", "band_hint": "child", "note": "if no response in 48–72h" }
  ],
  "investigations": [ { "name": "—", "when": "clinical diagnosis; imaging not routine" } ],
  "duration_days_default": 5,
  "counselling": ["complete the full course", "return if worsening ear pain or high fever"],
  "warning_signs": ["mastoid swelling", "neck stiffness", "fever > 3 days on treatment"],
  "referral_criteria": "no improvement in 72h, or complications",
  "hospitalisation_criteria": "toxic child, suspected intracranial spread"
}
```

**Strips:** surrogate `id`, `icd10_concept_id`/`snomed_concept_id` (FK UUIDs), `facility_id`, `version`/`correlation_id`/`created_at`/`updated_at`, `source`, `guideline_changes`, `last_reviewed_date`, `active`, and any null/empty array. `first_line_drugs`/`second_line_drugs` are reshaped to the **regimen-and-band-hint** form the model needs to drive `get_formulary` + `compute_doses` — never raw numeric doses (the model gets the band *name*, not the mg).

### 3.3 Error semantics

| `tool_error.code` | When | `retryable` | Model's next step |
|---|---|---|---|
| `STANDARD_RX_NOT_FOUND` | No row for the ICD-10, and no `diagnosis_name` fuzzy match ≥ floor. | false | Compose from `get_formulary` + clinical judgement; the protocol is advisory, not mandatory. |
| `INVALID_TOOL_INPUT` | Neither `icd10` nor `diagnosis_name` supplied. | false | Re-call with at least one key. |
| `UPSTREAM_FAILED` | DB error (mapped at job boundary). | true | Worker retries; not the model's concern. |

### 3.4 PII handling

**None present.** Protocol data is reference knowledge, not patient data. No `ToolCtx` patient fields are read or returned. Safe to cache the result by `(icd10|name)` across patients.

---

## 4. `get_formulary` — drug lookup (token-stripped)

**Backing port:** `DatabasePort` → `catalog.formulary` (governed KB; UNIQUE `generic_name`; `pg_trgm` on `generic_name`; brand-name fallback). **Batched** — the model passes all drugs in one call.

### 4.1 `input_schema` (given to Claude)

```jsonc
{
  "name": "get_formulary",
  "description": "Look up drugs in the hospital formulary. Pass ALL drugs you plan to prescribe in ONE call (batched). ALWAYS call this for every drug before composing a medicine line. Returns identity, formulations with ingredients[] (strength_numerator/denominator + concentration for dose math), dosing_bands (per-band method + ingredient_doses[] with is_limiting for combo drugs), and all safety arrays (interactions, contraindications, cross_reactions, black-box and pediatric warnings, max_single/max_daily ceilings). For combo drugs, dose by the LIMITING ingredient and check every ingredient's max. You must call get_formulary before compute_doses so you can pass the matching dosing_band + formulation.",
  "input_schema": {
    "type": "object",
    "properties": {
      "drug_names": {
        "type": "array",
        "items": { "type": "string" },
        "minItems": 1,
        "description": "Array of generic drug names in CAPS, e.g. ['AMOXICILLIN','PARACETAMOL']. Case-insensitive; brand names are resolved as a fallback."
      }
    },
    "required": ["drug_names"]
  }
}
```

> **Schema note.** `strict: true` — `drug_names` is a closed shape that must validate exactly. Lookup strategy (server-side): (1) `generic_name_normalized` exact/`ilike`; (2) for names not found, `brand_names` GIN array search (catches "Augmentin"→AMOXICILLIN-CLAVULANATE); (3) `pg_trgm` similarity as last resort. A name resolving to zero rows is reported per-drug (§4.3), not as a whole-call failure.

### 4.2 Condensed output to the model (`condenseDrugForAI()` per drug)

The pure `condenseDrugForAI()` (ported verbatim from the prototype, `index.ts:176–241`) is the **frozen output contract**. Per resolved drug:

```jsonc
{
  "generic_name": "AMOXICILLIN",
  "drug_class": "aminopenicillin",
  "category": "antibiotic",
  "therapeutic_use": ["acute otitis media", "CAP", "UTI"],
  "licensed_in_children": true,
  "formulations": [
    {
      "form": "suspension",
      "route": "oral",
      "indian_conc_note": "125mg/5ml and 250mg/5ml widely available",
      "ingredients": [
        { "name": "amoxicillin", "is_primary": true,
          "strength_numerator": 250, "strength_numerator_unit": "mg",
          "strength_denominator": 5, "strength_denominator_unit": "mL" }
      ]
    }
  ],
  "dosing_bands": [
    { "indication": "acute otitis media", "age_band": "child", "method": "weight",
      "dose_min_qty": 80, "dose_max_qty": 90, "dose_unit": "mg", "is_per_day": true,
      "frequency_per_day": 3, "duration_days": 5, "rounding_rule": "0.5ml",
      "ingredient_doses": [ { "name": "amoxicillin", "dose_min": 80, "dose_max": 90, "unit": "mg/kg/day",
                             "max_single": 1000, "max_daily": 3000, "is_limiting": true } ] }
  ],
  "interactions": ["allopurinol — rash risk"],
  "contraindications": ["penicillin hypersensitivity"],
  "cross_reactions": ["cephalosporins (low cross-reactivity)"],
  "black_box_warnings": [],
  "pediatric_specific_warnings": ["dose by weight; high-dose for AOM"],
  "monitoring_parameters": [],
  "max_single_qty": 1000, "max_single_unit": "mg",
  "max_daily_qty": 3000,  "max_daily_unit": "mg"
}
```

**Strips (the ~83 % token win, T2):**
- **`brand_names` / `indian_brands`** — ~77 % of a drug's tokens. The model selects by generic; brands are for human display only.
- **SNOMED metadata** — `snomed_concept_id`, ingredient-level `snomed_code` (kept on the DB row for FHIR, stripped from the model payload).
- **All null/empty fields** — conditionally included only when non-empty (the prototype's pattern: `if ((drug.interactions||[]).length) result.interactions = …`).
- **Governance/platform columns** — `verification_status`, `data_source`, `formulary_review`, `version`, `correlation_id`, timestamps, `facility_id`, surrogate `id`.
- `renal_bands`/`hepatic_note` are included **only** when `renal_adjustment_required`/`hepatic_adjustment_required` is true.

> **Promoted ceilings.** `max_single_*` / `max_daily_*` are **promoted scalar columns** (`03_data §3.1`, P12) surfaced to the model so it never proposes a band that exceeds the ceiling — but the **binding** cap is enforced by the engine and the server re-check, not by the model. The model's `dosing_bands` selection is a *proposal*; `compute_doses` is the authority.

### 4.3 Error semantics (per-drug, batched)

A batched call returns a `FormularyView[]` of the drugs that resolved **plus** a `not_found[]` list — a partial result is a success, not a failure:

```jsonc
// normal (partial) result
{ "drugs": [ /* condenseDrugForAI() per resolved drug */ ],
  "not_found": ["MONTELUKAST"] }   // names that resolved to zero rows — the model must NOT dose these
```

| `tool_error.code` (whole-call) | When | `retryable` |
|---|---|---|
| `INVALID_TOOL_INPUT` | `drug_names` empty or non-array. | false |
| `UPSTREAM_FAILED` | DB error. | true |

- A drug in `not_found[]` is **never dosed from model memory** — if the model still emits it in `medicines[]`, the server re-check raises `FORMULARY_MISS` and the line becomes a **red omitted stub** (`04_api/error_model.md §6.3`, severity high). This is the contract that keeps "drug not in formulary" from becoming an AI-guessed dose.

### 4.4 PII handling

**None present.** Reference knowledge only; no `ToolCtx` patient fields read or returned. Allergy cross-checking against `DeidentifiedPatientContext.allergies` happens in the **server safety re-check**, not inside this tool — the model is shown `contraindications`/`cross_reactions` so it can avoid a recorded allergen, but the binding allergy gate is server-side and de-identified.

---

## 5. `get_previous_rx` — PII-stripped prior prescriptions

**Backing port:** `DatabasePort` → `prescribing.prescriptions` (signed, immutable). The prototype's ad-hoc `.map()` PII strip is promoted to a **typed compile-time boundary**: `PreviousRxView` *has no PII fields*, so a leak is impossible to write.

### 5.1 `input_schema` (given to Claude)

```jsonc
{
  "name": "get_previous_rx",
  "description": "Fetch the patient's most recent signed prescription(s). Call this when the note says 'continue same treatment', 'repeat last Rx', 'modify previous', 'add X to last', or 'stop Y'. Returns clinical data ONLY — drug generics, regimens, dates, diagnosis codes (no patient identifiers). Use the patient_id provided in the patient context; do not invent one.",
  "input_schema": {
    "type": "object",
    "properties": {
      "patient_id": {
        "type": "string",
        "description": "The opaque patient UUID from the patient context block. NOT a UHID, name, or any identifier you compose."
      },
      "limit": {
        "type": "integer", "minimum": 1, "maximum": 3, "default": 1,
        "description": "How many most-recent prescriptions to fetch (default 1, max 3)."
      }
    },
    "required": ["patient_id"]
  }
}
```

> **Schema note.** `strict: true`. The `patient_id` value the model supplies **must equal** `ToolCtx.patientId` (resolved from the job's `visit_id`); the worker **rejects a mismatch** (`PATIENT_SCOPE_MISMATCH`) — the model cannot pivot to another patient by supplying a different UUID. This is a defense-in-depth backstop on top of RLS (`06_security §2.5`).

### 5.2 Condensed output to the model (`PreviousRxView[]`)

```ts
// core/views/previous-rx.ts — the type ITSELF has no PII field; leakage is a compile error (SEC-3, D-4)
export interface PreviousRxView {
  prescribedOn: string;          // ISO date only (no time-of-day, no identifiers)
  diagnosis: { icd10?: string; text: string };   // coded diagnosis, not a free-text PII-bearing note
  medicines: ReadonlyArray<{
    generic: string;             // CAPS generic only — never a brand tied to a person
    regimen: string;             // e.g. "5 ml three times a day for 5 days" (engine-built string, no patient data)
    durationDays?: number;
  }>;
  investigations?: ReadonlyArray<{ text: string }>;
  followupDays?: number;
  // ABSENT BY TYPE: no patient name, UHID, guardian, phone, address, ABHA, signature, receipt, rx_id, visit_id
}
```

```jsonc
// wire example (most recent first)
[
  { "prescribedOn": "2026-05-12",
    "diagnosis": { "icd10": "J06.9", "text": "Acute URI" },
    "medicines": [ { "generic": "PARACETAMOL", "regimen": "10 ml every 6 hours as needed for fever", "durationDays": 3 } ],
    "followupDays": 3 }
]
```

**Strips:** the entire identity surface — `patient_id`/`visit_id`/`rx_receipt`/`id` (UUIDs and business keys), `signed_by`/`signed_at`, `content_hash`/`signature_jws`, `fhir_bundle_id`/`pdf_url`, `facility_id`, platform columns, and any free-text field that could carry transcribed PII (`generated_json` is **not** passed through; only the typed, reshaped clinical fields are).

### 5.3 Error semantics

| `tool_error.code` | When | `retryable` | Model's next step |
|---|---|---|---|
| `NO_PREVIOUS_RX` | Patient has no signed prescriptions. | false | Treat as a fresh case; do not fabricate a prior regimen. |
| `PATIENT_SCOPE_MISMATCH` | Supplied `patient_id` ≠ `ToolCtx.patientId`. | false | Use the `patient_id` from the patient context block. |
| `INVALID_TOOL_INPUT` | Missing/empty `patient_id`. | false | Re-call with the context `patient_id`. |
| `UPSTREAM_FAILED` | DB error. | true | Worker retries. |

### 5.4 PII handling (the strictest tool)

- **Input:** an opaque UUID only, scope-checked against `ToolCtx`. No UHID/name ever accepted.
- **Output:** `PreviousRxView` is a **type with no PII fields** — the de-identification is *structural*, not a runtime filter that a refactor could weaken. The `09_engineering_discipline/evals_framework.md` "no PII leakage" gate scans this payload over the fixture set; a single PII token fails the gate. This is the D-4 "compile-time safety > review vigilance" decision applied to the highest-risk tool.

---

## 6. `get_lab_history` — recent labs (flags, no identifiers)

**Backing port:** `DatabasePort` → `clinical.lab_results` (LOINC FK into `catalog.concepts`, auto-flagged on entry).

### 6.1 `input_schema` (given to Claude)

```jsonc
{
  "name": "get_lab_history",
  "description": "Fetch the patient's recent lab results. Call this when the note references prior lab values, when monitoring treatment response (e.g. Hb trend for anaemia), or when prescribing a drug that requires lab monitoring (aminoglycosides, methotrexate). Returns test name, value, unit, flag (normal/low/high/critical/abnormal), date, and LOINC code — no patient identifiers. Use the patient_id from the patient context.",
  "input_schema": {
    "type": "object",
    "properties": {
      "patient_id": { "type": "string", "description": "Opaque patient UUID from the patient context block." },
      "test_names": {
        "type": "array", "items": { "type": "string" },
        "description": "Optional: filter to specific tests, e.g. ['Hemoglobin','S. Creatinine']. Omit for all recent results."
      }
    },
    "required": ["patient_id"]
  }
}
```

> **Schema note.** `strict: true`. Same `patient_id` scope-check as §5.1. `test_names` is normalized to `test_name_normalized` for matching; omitted → most-recent N (bounded, e.g. last 20 results / last 12 months).

### 6.2 Condensed output to the model (`LabResultView[]`)

```jsonc
[
  { "test_name": "Hemoglobin", "value": "9.2", "unit": "g/dL", "flag": "low",
    "test_date": "2026-06-20", "loinc": "718-7", "category": "Hematology" },
  { "test_name": "S. Creatinine", "value": "0.4", "unit": "mg/dL", "flag": "normal",
    "test_date": "2026-06-20", "loinc": "2160-0", "category": "Biochemistry" }
]
```

**Strips:** `id`/`patient_id`/`visit_id`/`loinc_concept_id`/`snomed_concept_id` (UUIDs), `value_numeric` (the model reads the display `value`), OCR provenance (`source`, `ocr_extraction_id`, `verification_status`, `verified_by`/`verified_at`), `lab_name` (unless clinically load-bearing — default stripped), platform columns, nulls. `flag` and `test_date` are the clinically load-bearing signals and are always present.

### 6.3 Error semantics

| `tool_error.code` | When | `retryable` | Model's next step |
|---|---|---|---|
| `NO_LAB_HISTORY` | No labs (optionally none matching `test_names`). | false | Proceed without lab context; do not invent values. |
| `PATIENT_SCOPE_MISMATCH` | `patient_id` ≠ `ToolCtx.patientId`. | false | Use the context `patient_id`. |
| `INVALID_TOOL_INPUT` | Missing `patient_id`. | false | Re-call with the context UUID. |
| `UPSTREAM_FAILED` | DB error. | true | Worker retries. |

### 6.4 PII handling

UUID-only input, scope-checked. Output carries **no identifiers** — test name, value, unit, flag, date, LOINC only. A lab value is clinical, not identifying, so it is permitted to the model **after** the identity strip.

---

## 7. `get_reference` — on-demand clinical `.md` references

**Backing port:** `StoragePort` → Supabase Storage / S3, resolved through the **`catalog.clinical_reference` registry** (name → Storage key → content_hash → version; owned by `05_ai/clinical_references.md`). 11 reference files + `worked_example`.

### 7.1 `input_schema` (given to Claude)

```jsonc
{
  "name": "get_reference",
  "description": "Fetch a clinical reference document by name for detailed knowledge on a specific topic BEFORE generating. Available: dosing_methods, standard_prescriptions, vaccination_iap2024, vaccination_nhm_uip, growth_charts, developmental, iv_fluids, neonatal, emergency_triage, antibiotic_stewardship, worked_example. (The NABH compliance block is PRE-EMBEDDED in your system prompt — do NOT fetch nabh_compliance; it is already present.) Call this when the note needs topic depth the core prompt does not carry — e.g. neonatal dosing tiers, IV fluid maintenance, or a vaccination schedule.",
  "input_schema": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "enum": ["dosing_methods","standard_prescriptions","vaccination_iap2024","vaccination_nhm_uip",
                 "growth_charts","developmental","iv_fluids","neonatal","emergency_triage",
                 "antibiotic_stewardship","worked_example"],
        "description": "Registry name of the reference to fetch."
      }
    },
    "required": ["name"]
  }
}
```

> **Schema note.** `strict: true` with a closed `enum` — the model cannot request an arbitrary path (no path traversal; the enum is the allow-list). `nabh_compliance` is **deliberately absent from the enum**: it is pre-embedded in the cached system prefix (`05_ai/prompt_system_design.md`, `ai_orchestration.md §4.2`), so the model never spends a tool round on it. The `enum` is generated from the `catalog.clinical_reference` registry; adding a reference is an ADR + a registry row + a cache-bust (T1).

### 7.2 Condensed output to the model (`ReferenceView`)

```jsonc
{
  "name": "neonatal",
  "version": 3,
  "content": "# Neonatal Dosing\n\n..."   // the resolved .md body, verbatim — it is already authored for the model
}
```

The `.md` body **is** the payload — it is human/model-authored prose, so there is nothing to strip (T2 row "stripped: nothing"). The registry resolution adds `version` (for the audit trail and cache-bust correlation) but the body is returned unchanged. The worker caches the resolved body by `(name, content_hash)`; a registry version bump changes the `content_hash` and busts the cache (the `get_reference` name→object→version→bust rule is owned by `05_ai/clinical_references.md`).

### 7.3 Error semantics

| `tool_error.code` | When | `retryable` | Model's next step |
|---|---|---|---|
| `REFERENCE_NOT_FOUND` | `name` not in the registry (should be unreachable given the `enum`, but enforced server-side as defense-in-depth). | false | Proceed with the core prompt's knowledge; do not invent the reference's content. |
| `UPSTREAM_FAILED` | Storage 5xx / object missing for a registered name (registry/Storage drift). | true | Worker retries; alerts on a content-hash mismatch (integrity). |

> **Integrity (poisoning surface).** A reference file is model-facing clinical content, so it is a **prompt-injection / data-poisoning surface** (`09_engineering_discipline/agent_threat_model.md`). `get_reference` validates the fetched body's `content_hash` against the registry row before returning it; a mismatch is a hard `UPSTREAM_FAILED` + alert, never a silently-served tampered reference. Reference edits are six-eye-reviewed (owned by `05_ai/clinical_references.md`).

### 7.4 PII handling

**None present.** Reference knowledge only; no `ToolCtx` patient fields. The registry, Storage keys, and content hashes carry no patient data.

---

## 8. `compute_doses` — the arithmetic firewall (C5 / I2)

**Backing port:** `DoseEnginePort` (the pure TS port in `core/`, the **runtime authority** per C5; `web/dose-engine.js` is the frozen parity oracle, kept byte-identical by the `ci/dose-parity` gate). **THE AI NEVER DOES ARITHMETIC** — this tool is how that invariant is realized at the wire level.

### 8.1 `input_schema` (given to Claude) — NO numeric mg/ml fields from the model

```jsonc
{
  "name": "compute_doses",
  "description": "Deterministic dose calculator — the ONLY source of every mg/ml/drop/tablet number on the prescription. CALL THIS for every medicine BEFORE emitting medicines[]. Pass ALL drugs in ONE call. Propose drug + formulation + method + the dosing_band you selected from get_formulary + frequency — do NOT do mental math and do NOT pass computed volumes; the engine computes them. Use the returned strings (row2_en/row3_hi) and numbers VERBATIM. For combo drugs, pass the whole dosing_band element; the engine resolves the limiting ingredient.",
  "input_schema": {
    "type": "object",
    "properties": {
      "patient": {
        "type": "object",
        "properties": {
          "weight_kg":  { "type": "number", "description": "Weight in kg (from patient context — do NOT invent)." },
          "height_cm":  { "type": ["number","null"], "description": "Height in cm (needed for BSA dosing)." },
          "age_days":   { "type": ["number","null"], "description": "Chronological age in days (from context)." },
          "corrected_age_days": { "type": ["number","null"], "description": "Preterm corrected age in days (from context; already resolved — do NOT compute)." },
          "ga_weeks":   { "type": ["number","null"], "description": "Gestational age in weeks (preterms)." },
          "egfr":       { "type": ["number","null"], "description": "eGFR for GFR-adjusted dosing (from context)." }
        },
        "required": ["weight_kg"]
      },
      "drugs": {
        "type": "array", "minItems": 1,
        "description": "ALL medicines, batched in one call.",
        "items": {
          "type": "object",
          "properties": {
            "generic":     { "type": "string", "description": "Generic name in CAPS; must match the formulary." },
            "formulation": { "type": "object", "description": "The formulation object from get_formulary (must include ingredients[] with strength_numerator/strength_denominator)." },
            "method":      { "type": "string", "enum": ["weight","bsa","fixed","gfr","infusion","age"] },
            "band":        { "type": "object", "description": "The matching ENTRY from get_formulary.dosing_bands (the whole element with ingredient_doses[], max_single/max_daily, is_limiting). Do NOT pass a single ingredient_doses sub-row." },
            "frequency":   { "type": "number", "description": "Doses per day (1=OD, 2=BD, 3=TDS, 4=QID)." },
            "is_per_day":  { "type": "boolean", "description": "true if the band's dose is per-day (engine divides by frequency)." },
            "output_unit": { "type": "string", "description": "Preferred display unit: drops, mL, tablet, capsule, sachet, etc." }
          },
          "required": ["generic","formulation","method","band","frequency"]
        }
      }
    },
    "required": ["patient","drugs"]
  }
}
```

> **Schema note (the firewall, T5/I2).** There is **no field anywhere in this schema for a computed `mg`, `ml`, `drops`, `volume`, or `dose` number.** The model proposes the *qualitative* prescription — drug, formulation, method, which band, how often — and the engine returns the quantities. `strict: true`. The worker maps these to the engine's `ComputeDoseParams` (`weight`, `bsa` derived from `height_cm`+`weight_kg` via `calculateBSA`, `ingredients` parsed from `formulation`, `ingredientBands` from `band`, `isPerDay`, `frequency`, `form`, `outputUnit`) — the model never sees or supplies those internal numeric params either. Preterm corrected/chronological age is **pre-resolved server-side** (`DeidentifiedPatientContext.correctedAgeInDays`); the engine receives the resolved number and does no age arithmetic.

### 8.2 Output to the model — the engine result **verbatim**

The result is `ComputeDoseResult` **copied unchanged** (verified exports, `sprint-2-saved:dose-engine.ts`): the model pastes these fields straight into `medicines[]`. No condensing, no reshaping — the engine output **is** the contract (C5).

```jsonc
// one entry per input drug, in input order
{
  "results": [
    {
      "generic": "AMOXICILLIN",
      "vol": "5 ml",                         // canonical display volume
      "enD": "5 ml three times a day for 5 days",     // R2 English — copy verbatim into row2_en
      "hiD": "५ मि.ली. दिन में तीन बार ५ दिन तक",        // R3 Devanagari — copy verbatim into row3_hi
      "calc": "90 mg/kg/day × 8.2 kg ÷ 3 = 246 mg ≈ 5 ml @ 250mg/5ml",  // provenance string
      "capped": false,                       // true ⇒ engine clamped to max single/daily
      "fd": "after_food",                    // food instruction code
      "volumeMl": 5.0,                       // numeric ml (rounded per rule)
      "volumeUnits": 5.0,                    // numeric in output_unit
      "warnings": [],                        // e.g. ["near max daily dose"]
      "ingredientDoses": [                   // IngredientDoseDetail[] — per-ingredient audit (combo safety)
        { "name": "amoxicillin", "isPrimary": true, "mgPerDose": 246, "mgPerDay": 738,
          "mgPerKg": 90, "maxExceeded": false, "maxNote": null, "withinRange": true }
      ],
      "pictogram": { "times": ["morning","afternoon","night"], "qty": 5, "unit": "ml",
                     "food": "after_food", "duration_days": 5 }   // R4 sidebar inputs
    }
  ]
}
```

> The `pictogram` field is assembled by the worker from the engine's frequency/qty/unit/food outputs (R4 sidebar). `vol`/`enD`/`hiD`/`calc`/`capped`/`fd`/`volumeMl`/`volumeUnits`/`warnings`/`ingredientDoses` are the engine's `ComputeDoseResult` fields, byte-identical to what the parity oracle produces (Part C `ci/dose-parity` floor: rounding 0.5 ml / 0.1 ml / ¼ tab, max-single/max-daily caps, weight/BSA/GFR methods, combo limiting-ingredient, bilingual R2/R3).

### 8.3 Per-drug un-computable handling (not a tool error — a typed result)

A drug the engine **cannot** dose (no matching band, missing weight on a weight-based method, capped-unsafe) is returned in the same result with `ok: false` and a typed reason — it is **not** a `tool_error` (the call succeeded; this drug just has no number):

```jsonc
{ "generic": "MONTELUKAST", "ok": false, "reason": "no_band_for_age",
  "detail": "no dosing_band matched age_band=infant" }
```

The worker routes every `ok:false` drug to `omitted_medicines[]` → a **red stub** on the Rx (`DOSE_UNCOMPUTABLE`, severity high) — never an AI-guessed number (`04_api/error_model.md §6.2/§6.3`). Reasons: `no_band_for_age`, `weight_missing`, `formulary_miss`, `capped_unsafe`.

### 8.4 Whole-call error semantics

| `tool_error.code` | When | `retryable` |
|---|---|---|
| `INVALID_TOOL_INPUT` | `drugs` empty, or a drug missing `formulation`/`band`/`method`/`frequency`/`generic`. | false |
| `WEIGHT_MISSING` | `patient.weight_kg` absent on a weight/BSA-based batch. | false — surfaces as the `WEIGHT_MISSING` gate (`04_api/error_model.md §5.6`); blocks Generate until weight captured. |

### 8.5 The server re-check (independent of the tool round — zero tolerance)

`compute_doses` running **inside** the tool loop is necessary but not sufficient. After the model emits the final `medicines[]`, the worker **re-runs the engine byte-for-byte** over those medicines, independently of the tool round:

```
re-run DoseEnginePort over final medicines[]  →  match     → SAFE
                                              →  mismatch  → DOSE_MISMATCH, severity=high,
                                                             overall_status=REVIEW_REQUIRED, line flagged
```

- **Zero tolerance.** Any divergence — including a 20 % client-side override — is rejected, not averaged (`04_api/error_model.md §6.2`; the result is `overall_status ∈ {'SAFE','REVIEW_REQUIRED'}`, C3, stored/wire UPPER_SNAKE; the space form "Review required" is display-only).
- **Mandatory invocation.** If `medicines[]` is non-empty but `compute_doses` was never called (`tools_called[]` lacks it), the generation is flagged `compute_doses_missing` (warning → severity escalation). This is the server assertion that realizes I2.
- This is why a wrong number **cannot** reach paper: the only numbers on the Rx come from the deterministic engine, and the only way a non-engine number could appear is caught by this re-check and flagged `REVIEW_REQUIRED`.

### 8.6 PII handling

The `patient` block carries **clinical numerics only** (weight, height, ages, GA, eGFR) — all pre-computed and de-identified (`DeidentifiedPatientContext`); **no name, UHID, DOB, or identifier**. Ages are passed as resolved day-counts (the model never receives a DOB). The engine is a pure function (`zero IO`), so nothing it touches can leak.

---

## 9. Cross-tool matrices (the frozen surface, at a glance)

### 9.1 `strict` & input-shape matrix

| Tool | `strict` | `required` | Identifier in input | Server-side input assertion |
|---|---|---|---|---|
| `get_standard_rx` | false | `[]` | none | at least one of `icd10` / `diagnosis_name` |
| `get_formulary` | **true** | `["drug_names"]` | none | `drug_names` non-empty array |
| `get_previous_rx` | **true** | `["patient_id"]` | UUID (scope-checked) | `patient_id == ToolCtx.patientId` |
| `get_lab_history` | **true** | `["patient_id"]` | UUID (scope-checked) | `patient_id == ToolCtx.patientId` |
| `get_reference` | **true** | `["name"]` | none | `name ∈ enum` (registry-backed) |
| `compute_doses` | **true** | `["patient","drugs"]` | none (weight/age numerics only) | each drug has `formulation`+`band`+`method`+`frequency` |

### 9.2 Output-condensation & PII matrix

| Tool | Output type | PII in output? | Key strip | Caching key |
|---|---|---|---|---|
| `get_standard_rx` | `StandardRxView` | no | ids, audit, source, nulls | `(icd10 \| name)` (cross-patient) |
| `get_formulary` | `FormularyView[]` + `not_found[]` | no | brands/SNOMED/nulls (~83 %) | `sorted(drug_names)` (cross-patient) |
| `get_previous_rx` | `PreviousRxView[]` | **no — by type** | entire identity surface | per-`patient_id`, not cross-patient |
| `get_lab_history` | `LabResultView[]` | no | ids, OCR provenance, `value_numeric` | per-`patient_id`, not cross-patient |
| `get_reference` | `ReferenceView` | no | nothing (body is the payload) | `(name, content_hash)` (cross-patient) |
| `compute_doses` | `ComputeDoseResult[]` (verbatim) | no (numerics only) | nothing (engine output is the contract) | not cached (deterministic; cheap) |

### 9.3 Tool-error code enum (the full catalogue this file freezes)

```
get_standard_rx : STANDARD_RX_NOT_FOUND, INVALID_TOOL_INPUT, UPSTREAM_FAILED
get_formulary   : INVALID_TOOL_INPUT, UPSTREAM_FAILED   (+ per-drug not_found[] in the success body)
get_previous_rx : NO_PREVIOUS_RX, PATIENT_SCOPE_MISMATCH, INVALID_TOOL_INPUT, UPSTREAM_FAILED
get_lab_history : NO_LAB_HISTORY, PATIENT_SCOPE_MISMATCH, INVALID_TOOL_INPUT, UPSTREAM_FAILED
get_reference   : REFERENCE_NOT_FOUND, UPSTREAM_FAILED
compute_doses   : INVALID_TOOL_INPUT, WEIGHT_MISSING   (+ per-drug ok:false reasons in the success body)
```

These `tool_error.code`s are **distinct** from the canonical HTTP error catalogue (`04_api/error_model.md §5`): a tool error is a value inside a `tool_result` block (fail-soft to the loop), whereas the HTTP/job catalogue governs the generation's *outcome*. The two meet where a tool's un-computable result maps to a C6 clinical-safety code (`DOSE_UNCOMPUTABLE`, `FORMULARY_MISS`, `WEIGHT_MISSING`) at the server re-check.

---

## 10. Structured-output retirement of `extractJSON`

The tool loop's **final turn** is constrained by structured outputs, retiring the prototype's brittle `extractJSON()` regex (slice between first `{` and last `}`):

- `output_config.format = { type: "json_schema", schema: <prescription.v1.json> }` on the final generation turn — the bilingual 4-row + pictogram + safety draft contract.
- **Ajv validation** of the returned JSON against `core/schema/prescription.v1.json`. Invalid → `GenerationFailed{reason: schema_invalid}` (`AI_SCHEMA_INVALID`) + retry-once; never a silently malformed draft.
- Structured outputs are **incompatible with assistant prefill and citations** — neither is used here (Opus 4.6+/Fable 5 have no prefill anyway), so this is clean.
- The `medicines[]` numeric fields in `prescription.v1.json` are populated **only** from `compute_doses` output (§8.2); the schema does not let the model emit a free-form dose number outside an engine-produced string.

---

## 11. Conformance gates (machine-checkable; the discipline suite owns the runner)

This file defines **what** is gated; `09_engineering_discipline/` owns the runners.

1. **Tool-schema freeze test** — each tool's serialized `input_schema` matches a checked-in snapshot byte-for-byte; a diff fails CI (drift would silently invalidate the prompt-cache prefix, T1). Tied to the `cache_read_input_tokens != 0` caching audit (`ai_orchestration.md §5.1`).
2. **No-PII-leakage eval** — over the frozen pediatric fixture set, every outbound tool payload (and the de-identified patient context) is scanned; a single PII token fails (SEC-3; `get_previous_rx`/`get_lab_history` are the focus). The `PreviousRxView`/`LabResultView` types having no PII fields is the compile-time half; this is the runtime half.
3. **`compute_doses` mandatory-when-meds test** — a generation with non-empty `medicines[]` whose `tools_called[]` lacks `compute_doses` is flagged (warning + severity escalation); a generated number with no engine provenance hard-blocks (`never_events.yaml`, I2).
4. **Server re-check zero-tolerance test** — an injected non-engine number (incl. a 20 % override) over the final `medicines[]` produces `DOSE_MISMATCH`, `severity=high`, `overall_status=REVIEW_REQUIRED`, line flagged (§8.5).
5. **`get_previous_rx` scope test** — a `patient_id` ≠ `ToolCtx.patientId` returns `PATIENT_SCOPE_MISMATCH`, never another patient's data (defense-in-depth over RLS).
6. **`get_reference` enum/integrity test** — an off-enum `name` is rejected; a content-hash mismatch against the registry hard-fails (poisoning guard, `agent_threat_model.md`).
7. **`condenseDrugForAI()` golden test** — a known formulary row condenses to a fixed token-stripped DTO (brands/SNOMED/nulls absent); a regression that re-adds `indian_brands` fails (T2 token budget).
8. **Dose-parity precondition** — `ci/dose-parity` (Part C, ≥ 20 byte-for-byte fixtures) must be green before `compute_doses` is trusted in generation; the TS `DoseEnginePort` and the JS oracle must agree field-for-field. Release-blocks the Generation context (C5).

---

## 12. Summary — what changed from the prototype

| Concern | Prototype (delete) | Target contract (build) |
|---|---|---|
| Tool I/O | anon-key `fetch()` inside executors; free-text `tool_result` strings | `ClinicalKnowledgePort` behind `DatabasePort`/`StoragePort`/`DoseEnginePort`; typed condensed DTOs |
| Patient ID in tool args | **UHID** copied from a "PATIENT ID line" in the note | opaque **UUID** resolved from `visit_id`, scope-checked against `ToolCtx` |
| `get_previous_rx` PII strip | ad-hoc `.map()` (a review-miss away from a leak) | `PreviousRxView` — a **type with no PII fields** (compile-time un-leakable) |
| Dose numbers | model proposes `dose_value`; some mental math reachable | model proposes drug+formulation+method+band+frequency only; **engine returns every number**; server re-check zero-tolerance |
| `compute_doses` engine | `web/dose-engine.js` (browser) | pure TS `DoseEnginePort` (C5 runtime authority); JS is the frozen parity oracle |
| Tool errors | exceptions / empty arrays | typed non-fatal `{tool_error:{code,message,retryable,hint}}` the model can reason about |
| Reference resolution | hardcoded `STORAGE_BASE/references/<name>.md` path | `catalog.clinical_reference` registry (name→key→hash→version), enum-closed, content-hash-verified |
| NABH | fetched via `get_reference` | pre-embedded in the cached prefix; absent from the `get_reference` enum |
| Final JSON | `extractJSON()` regex | `output_config.format` + Ajv `prescription.v1.json` |
| Sex form to model | DB title-case leaked toward the model | `'M'\|'F'` de-identified (C2); DB `male/female/other` maps at the adapter |

---

### Key source references (absolute / branch-qualified)

- Prototype tool defs + executors (port-from then retire): `supabase/functions/generate-prescription/index.ts` — five tool defs lines 56–151, `condenseDrugForAI` 176–241, `executeGetReference` 155–171, `executeGetFormulary` 243+.
- `compute_doses` tool def + engine types (`origin/sprint-2-saved`): `supabase/functions/generate-prescription/index.ts` (`compute_doses` def), `supabase/functions/_shared/dose-engine.ts` (`ComputeDoseParams`, `ComputeDoseResult`, `IngredientDoseDetail` — verified this session).
- Parity oracle (C5): `web/dose-engine.js` (the doctor-validated baseline the TS port must match byte-for-byte).
- Schema the tools read: `system-spec/03_data/schema_design.md` (§3.1 `catalog.formulary`, §3.2 `catalog.standard_prescriptions`, §3.4 `catalog.clinical_reference`, §5.5 `clinical.lab_results`, §6.3 `prescribing.prescriptions`).
- De-identification boundary: `system-spec/06_security/security_auth_rbac_compliance.md §3.2` (`DeidentifiedPatientContext`, SEC-3).
- Orchestration that invokes this surface: `system-spec/02_architecture/ai_orchestration.md §4` (tools, parallelism, dose separation), `§5` (cache prefix).
- Error semantics: `system-spec/04_api/error_model.md §5.5/§5.6` (C5/C6 codes), `§6` (degradation), `04_api/api_contracts.md §4.7` (draft shape).
- Binding decisions: `system-spec/00_overview/canonical_decisions.md` (C2 sex, C3 overall_status, C5 dose-engine authority, C6 consent, Part B.2 tool-contract freeze, Part C dose-parity gate).
