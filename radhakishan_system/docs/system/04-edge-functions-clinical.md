# 04 — Clinical Edge Functions (R4)

System documentation for the clinical-AI Supabase Edge Functions powering Radhakishan
Hospital's prescription system. Covers the Claude tool-use loop, prompt loading and
caching, fallback behavior, FHIR Bundle generation, and the AI lookup helpers used
during data curation.

In scope:

- `supabase/functions/generate-prescription` — main Rx generator (Claude tool-use loop)
- `supabase/functions/generate-visit-summary` — registration-time clinical summary
- `supabase/functions/generate-fhir-bundle` — ABDM FHIR R4 Bundle assembler
- `supabase/functions/ai-drug-lookup` — formulary curator helper
- `supabase/functions/ai-protocol-lookup` — standard-prescription curator helper
- `radhakishan_system/skill/` — runtime prompts and clinical references

Out of scope: ABHA/ABDM Gateway functions (`abdm-identity`, `abdm-hip-*`, `abdm-hiu-*`)
are documented separately. Web pages and database schema are documented in their own
system docs.

---

## 1. Purpose & Position in the System

The clinical Edge Functions encapsulate every call from the web app into the
Anthropic Claude API and into Supabase REST. They keep the `ANTHROPIC_API_KEY` off
the browser, centralize the runtime prompt, and expose a fixed JSON contract to the
Prescription Pad and Registration pages.

| Function                  | Caller                         | Anthropic? | Output                              |
| ------------------------- | ------------------------------ | :--------: | ----------------------------------- |
| `generate-prescription`   | Prescription Pad → Generate    |    yes     | Prescription JSON (~250-line schema) |
| `generate-visit-summary`  | Registration (returning pt)    |    yes     | `{ summary: string }` (≤250 words)  |
| `generate-fhir-bundle`    | Sign-off, ABDM share           |     no     | FHIR R4 Document Bundle             |
| `ai-drug-lookup`          | `formulary.html` (admin)       |    yes     | One formulary row JSON              |
| `ai-protocol-lookup`      | `standard-rx.html` (admin)     |    yes     | One standard_prescriptions row JSON |

`generate-fhir-bundle` is consumed both at sign-off (to persist `prescriptions.fhir_bundle`)
and on demand by the ABDM HIP data-transfer flow.

---

## 2. Deployment, Identity & Configuration

All five functions:

- Run on Supabase Edge Runtime (Deno, `std@0.177.0/http/server.ts`).
- Hard-code the project URL `https://ecywxuqhnlkjtdshpcbc.supabase.co` and the
  `anon` JWT — same key the web app uses. There is no service-role key in any
  clinical function; every DB read goes through PostgREST under the
  `anon_full_access` RLS policy.
- Read `ANTHROPIC_API_KEY` from `Deno.env` (set via `supabase secrets set`).
  `generate-fhir-bundle` does not require it.
- Emit identical CORS headers (`*` origin, `POST, OPTIONS`) — they are called
  directly from the browser.
- Deploy individually:
  `npx supabase functions deploy <name> --project-ref ecywxuqhnlkjtdshpcbc`.

`generate-fhir-bundle` also embeds a hospital constant block (`HOSPITAL.name`,
phone, address, `hfr_id`) at the top of the file; `hfr_id` is a TODO for HFR
registration.

---

## 3. `generate-prescription` — Tool-Use Loop in Detail

The core function. Translates a doctor's free-text clinical note into a fully
structured, NABH-compliant prescription JSON via a multi-round Claude conversation
where Claude calls back into Supabase through five tools.

### 3.1 Request shape

```jsonc
POST /generate-prescription
{
  "clinical_note": "string (required) — doctor's note + INCLUDE SECTIONS line",
  "patient_allergies": ["Penicillin", ...],   // optional, appended to user msg
  "patient_id": "RKH-25260300001",            // optional, enables get_previous_rx
  "formulary_context": ...,                   // accepted but unused (legacy)
  "std_rx_context":   ...                     // accepted but unused (legacy)
}
```

`formulary_context` / `std_rx_context` are read off the request body but never used —
they were the pre-tool-use injection mechanism. Today, all clinical knowledge is
fetched by Claude itself via tools.

### 3.2 Response shape

```jsonc
{
  "prescription": { ...the JSON described in core_prompt.md... },
  "meta": {
    "mode": "tool-use" | "fallback-single-shot",
    "rounds": <int>,                  // tool-use only
    "input_tokens":  <int>,           // tool-use only
    "output_tokens": <int>,           // tool-use only
    "error": "<msg>"                  // fallback only
  }
}
```

On parse failure the prescription field is replaced with
`{ error, parse_error, raw_preview }` (HTTP 200 — the caller is expected to
display it, not retry).

### 3.3 The five tools

Defined as a static `tools` array. All schemas use `input_schema` (Anthropic
tool-use format). Schemas, descriptions, and routing in `executeTool()`:

| Tool              | Input                                     | Backed by                                                    |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `get_reference`   | `{ name }`                                | Storage: `website/skill/references/<name>.md` or `examples/worked_example.md` |
| `get_formulary`   | `{ drug_names: string[] }`                | PostgREST `formulary` (two-strategy lookup)                  |
| `get_standard_rx` | `{ icd10?, name? }` (at least one)        | PostgREST `standard_prescriptions`                           |
| `get_previous_rx` | `{ patient_id, limit? (1–3) }`            | PostgREST `prescriptions` (PII-stripped projection)          |
| `get_lab_history` | `{ patient_id, test_names?: string[] }`   | PostgREST `lab_results`                                      |

Tool descriptions are written to teach Claude when to call each one — for example
`get_standard_rx` instructs "ALWAYS use ICD-10 code as the primary lookup", and
`get_previous_rx` lists trigger phrases ("continue same treatment", "repeat last
prescription", "modify previous", "add X to last", "stop Y").

### 3.4 Per-tool data contracts and column projections

`get_reference(name)` resolves `name` against a hard-coded `REFERENCE_NAMES` list
(11 entries — see §6) plus the literal `"worked_example"`. Returns the raw `.md`
text from Storage, cached per-instance. Unknown names return a string listing valid
choices instead of an error code so Claude can self-correct.

`get_formulary(drug_names)` runs two Postgres queries against the `formulary`
table, projecting these columns:

```
generic_name, drug_class, licensed_in_children, unlicensed_note,
formulations, dosing_bands, interactions, contraindications, cross_reactions,
black_box_warnings, pediatric_specific_warnings, monitoring_parameters,
renal_adjustment_required, renal_bands, hepatic_adjustment_required, hepatic_note,
administration, food_instructions, notes, snomed_code, snomed_display, brand_names
```

Strategy 1 is `or=(generic_name.ilike.%X%, …)` for every requested name. For any
name not satisfied by Strategy 1, Strategy 2 fetches every `active=true` row and
filters client-side over both `brand_names text[]` and the nested
`formulations[].indian_brands[].name|trade_name` (this is how brand lookups like
"Augmentin", "Wikoryl", "Crocin" resolve to a generic).

The result is then run through `condenseDrugForAI()` which:

- Drops `indian_brands` (~77% of payload tokens) and per-formulation noise
- Strips `snomed_code` from `dosing_bands[].ingredient_doses[]` (keeps `source`)
- Removes null/empty fields
- Conditionally includes `renal_bands` only if `renal_adjustment_required`
- Conditionally includes `hepatic_note` only if `hepatic_adjustment_required`

The condensed JSON is stringified and returned to Claude. If zero rows match, the
return value is the literal string
`No formulary entries found for: <names>. Use your clinical training knowledge for dosing.` —
graceful degradation rather than failure.

`get_standard_rx(icd10?, name?)` queries `standard_prescriptions` projecting:

```
icd10, diagnosis_name, snomed_code, first_line_drugs, second_line_drugs,
investigations, counselling, warning_signs, referral_criteria,
hospitalisation_criteria, expected_course, key_clinical_points,
severity_assessment, monitoring_parameters, guideline_changes, notes,
duration_days_default
```

with `active=true` and `limit=5`. Three lookup strategies, in order:

1. Exact ICD-10 (`icd10=eq.X`)
2. Prefix ICD-10 (`icd10=ilike.X%`) — so `H66` matches `H66.90`
3. Diagnosis name partial match (`diagnosis_name=ilike.%X%`)

Empty result returns `No hospital protocol found for <searched>. Use standard clinical guidelines.`

`get_previous_rx(patient_id, limit?)` clamps `limit` to `[1,3]`, queries
`prescriptions` with `is_approved=eq.true` ordered by `created_at desc`, projecting
only `id, created_at, generated_json`. The body of `generated_json` is then
deliberately re-projected to a **PII-stripped** subset: diagnosis, medicines (only
display rows + dose math + pictogram), investigations, vitals, safety summary,
followup, admission, warning signs, doctor notes, vaccinations, growth,
counselling, diet, referral, complaints, history, examination. Patient name, UHID,
guardian, DOB are not forwarded back to Claude.

`get_lab_history(patient_id, test_names?)` queries `lab_results` ordered by
`test_date desc`, `limit=20`, projecting:

```
test_name, value, value_numeric, unit, reference_range, flag, test_date,
notes, loinc_code
```

`test_names` (when supplied) becomes an `or=(test_name.ilike.%X%,…)` filter.

### 3.5 The loop itself (`toolUseLoop`)

```
MAX_TOOL_LOOPS = 10
model          = claude-sonnet-4-20250514
max_tokens     = 8192
timeout        = 120 s (AbortController on the entire loop)
```

Each iteration:

1. POST `https://api.anthropic.com/v1/messages` with the running `messages[]`,
   the embedded `system` prompt, and the `tools` array. `anthropic-version:
   2023-06-01`.
2. Accumulate `usage.input_tokens` and `usage.output_tokens`.
3. Append the assistant `content` (verbatim block list) to `messages`.
4. Branch on `stop_reason`:
   - `end_turn` — concatenate text blocks and return as the final answer.
   - `tool_use` — extract `tool_use` blocks, dedupe-check against the previous
     round (see §3.6), execute **all tools in parallel** via `Promise.all` +
     `executeTool()`, then append a single `user` message with `tool_result`
     blocks (one per tool_use_id).
   - any other reason (`max_tokens`, etc.) — concatenate available text and
     return; logged as a warning.
5. After 10 rounds without `end_turn` → throws `Tool-use loop exceeded 10 rounds`
   which falls through to single-shot fallback (§3.7).

Round-1 target prescribed by `core_prompt.md`: Claude should batch *all* tool
calls in the first round, then emit JSON in round 2.

### 3.6 Repeat-call detection

`lastToolCallKey` is built from the sorted `name:JSON.stringify(input)` of every
tool block in the round. If the next round's key is identical — the model is
spinning — the loop ends with whatever text Claude emitted alongside the duplicate
calls. This is a soft termination; no error is raised.

### 3.7 Fallback: single-shot mode

Triggered by **any** thrown error in `toolUseLoop` — API errors, network failures,
the 10-round cap, or the 120 s timeout. `singleShotFallback`:

1. Loads `core_prompt.md` from Storage (cached as `"full-skill"`).
2. Prepends `SINGLE-SHOT MODE: Generate the COMPLETE prescription JSON
   immediately. Output ONLY raw JSON.` to the system prompt.
3. Calls Claude **without the `tools` parameter** — no tool round-tripping.
4. Returns the text content directly.

`meta.mode` then reads `"fallback-single-shot"` and `meta.error` carries the
original failure message. The schema of the prescription is unchanged — the
penalty is purely clinical depth (Claude leans on training knowledge instead of
fetching the formulary or hospital protocols).

### 3.8 JSON extraction

`extractJSON()` strips markdown code fences, slices from the first `{` to the
last `}`, and `JSON.parse`s. On parse failure it returns `{ error, parse_error,
raw_preview: <first 200 chars> }` so the caller can render a recoverable error.

### 3.9 System prompt assembly

For every request, the function loads two files from Storage (both cached
in-memory after first hit):

- `website/skill/core_prompt.md` — the runtime instruction set (~370 lines)
- `website/skill/references/nabh_compliance.md`

These are concatenated (`corePrompt + "\n\n" + nabhRef`) and used as the
`system` prompt. NABH compliance is embedded so Claude does not need to spend a
tool call on it — `core_prompt.md` explicitly forbids
`get_reference("nabh_compliance")` and `get_reference("worked_example")` unless
unsure of format.

The user message is the doctor's `clinical_note` plus, conditionally:

- `\n\nKNOWN PATIENT ALLERGIES: <comma list>` — if `patient_allergies` provided
- `\n\nPATIENT ID: <UHID> (use with get_previous_rx tool if doctor requests
  continuation or modification of previous treatment)` — if `patient_id`
  provided

---

## 4. Prompt Storage, Caching & Versioning

### 4.1 Storage layout

All clinical prompts live in the public Supabase Storage bucket `website` under
the `skill/` prefix:

```
skill/
  core_prompt.md                    ← runtime system prompt for generate-prescription
  formulary_lookup_prompt.md        ← system prompt for ai-drug-lookup
  protocol_lookup_prompt.md         ← system prompt for ai-protocol-lookup
  references/
    dosing_methods.md
    standard_prescriptions.md
    vaccination_iap2024.md
    vaccination_nhm_uip.md
    growth_charts.md
    developmental.md
    iv_fluids.md
    neonatal.md
    emergency_triage.md
    nabh_compliance.md          ← always embedded into the core prompt
    antibiotic_stewardship.md
  examples/
    worked_example.md
```

The repository copy under `radhakishan_system/skill/` is the source of truth and
is uploaded to Storage using the same paths. The legacy
`radhakishan_prescription_skill.md` (933 lines) is a reference artifact only — it
is never fetched at runtime.

### 4.2 In-memory caching

Each Edge Function instance keeps a module-level `cache` object (or a single
`cachedPrompt` for the lookup helpers). Behavior:

- First request: `fetchCached(url, key)` does an HTTP GET and stashes the body.
- Subsequent requests (same instance): zero network calls — `cache[key]` is
  served directly.
- Cold start: cache empties when Supabase recycles the instance.

This means a content edit in Storage is visible to *new* instances immediately;
warm instances continue to serve the prior version until they cycle. There is no
explicit cache-busting — operators rely on instance recycling, which Supabase
performs frequently.

### 4.3 Versioning model

There is no formal version field on the prompt files. Versioning is performed
through git history of `radhakishan_system/skill/` and the upload step. The
function does not record which prompt revision served a given prescription. If
strict provenance becomes required, the recommended path is:

- Append a `version: YYYY-MM-DD` front-matter line to `core_prompt.md`.
- Echo it into `meta.prompt_version` in the response.
- Persist into `prescriptions.generated_json.meta` at sign-off.

### 4.4 References fetched on demand

Out of the eleven references, only `nabh_compliance` is auto-embedded.
`worked_example` is discouraged. The remaining nine are fetched by Claude via
`get_reference` tool calls based on the routing rules in `core_prompt.md`:

| Reference                | Triggered when                                                  |
| ------------------------ | --------------------------------------------------------------- |
| `vaccination_iap2024`    | INCLUDE SECTIONS specifies "IAP 2024 ACVIP"                     |
| `vaccination_nhm_uip`    | INCLUDE SECTIONS specifies "NHM-UIP government"                 |
| `growth_charts`          | Growth section requested                                        |
| `developmental`          | Developmental screening section requested                       |
| `iv_fluids`              | IV fluids requested                                             |
| `neonatal`               | GA < 37 wk, age < 28 d, or BW < 2.5 kg                          |
| `dosing_methods`         | BSA, GFR, infusion, or age/GA-tier dosing                       |
| `antibiotic_stewardship` | Antibiotics likely                                              |
| `emergency_triage`       | At Claude's discretion (triage uncertainty)                     |
| `standard_prescriptions` | Reference document; rarely fetched (the tool covers this)       |

---

## 5. `generate-visit-summary`

Compact non-tool function. At registration, when a returning patient creates a
visit, the front-end calls this to produce a ≤250-word clinical brief for the
doctor's tab.

Request:

```jsonc
{ "patient_id": "RKH-...", "current_weight_kg": 12.4,
  "current_complaints": "...", "patient_age": "3 yr 2 mo",
  "document_summaries": ["lab report Hb 9.2 ...", ...] }
```

The function fetches the last 5 approved prescriptions
(`prescriptions?patient_id=eq.X&is_approved=eq.true&order=created_at.desc&limit=5&select=id,created_at,generated_json`)
and re-projects the same PII-stripped clinical subset described in §3.4
(`get_previous_rx`), then concatenates any `document_summaries` from the OCR/upload
flow.

Single Claude call (`claude-sonnet-4-20250514`, `max_tokens=512`, no tools, no
streaming). The system prompt is **inlined as a TypeScript constant** — not loaded
from Storage — and instructs Claude to weight the most recent visit heavily, flag
ongoing meds and follow-up adherence, and produce a no-PII clinical paragraph.

Failure semantics differ from `generate-prescription`: the function never returns
HTTP 5xx for AI failures. It returns `{ summary: null, reason: "..." }` with HTTP
200 so the registration flow continues without blocking.

The output is stored by the front-end into `visits.visit_summary`.

---

## 6. `generate-fhir-bundle`

Pure data-shaping function. No Claude. Reads from Supabase, emits an ABDM-
compliant FHIR R4 Document Bundle conforming to the NRCeS IG v6.5.0
(`https://nrces.in/ndhm/fhir/r4/...`).

### 6.1 Request

```jsonc
POST /generate-fhir-bundle
{
  "type": "OPConsultation" | "Prescription" | "DiagnosticReport" | "ImmunizationRecord",
  "patient_id":     "RKH-...",     // required
  "visit_id":        "<uuid>",     // required for OPConsultation, Prescription
  "prescription_id": "<uuid>"      // optional; auto-loaded by visit_id if omitted
}
```

Returns `{ bundle: <FHIR Bundle> }` or HTTP 4xx with `{ error }`.

`HealthDocumentRecord` is declared in `COMPOSITION_TYPES` but has no generator
implementation in this file (the switch in `serve()` returns "Unsupported bundle
type" if requested).

### 6.2 Triggers

The function is invoked from two places:

- **Sign-off in Prescription Pad** — generates an `OPConsultation` bundle and
  persists it into `prescriptions.fhir_bundle` (JSONB) so it can be served
  without regeneration.
- **ABDM HIP data-transfer** — on a consent-bound data request, the
  `abdm-hip-data-transfer` function selects the appropriate bundle type per
  care context.

There is no automatic trigger from `generate-prescription`; bundle generation is
strictly downstream of doctor sign-off.

### 6.3 Database reads

| Source table              | Filter                                                      | Used for                |
| ------------------------- | ----------------------------------------------------------- | ----------------------- |
| `patients`                | `id=eq.<patient_id>` (`select=*`)                           | Patient resource        |
| `doctors`                 | `id=eq.DR-LOKENDER` (default, hard-coded)                   | Practitioner resource   |
| `visits`                  | `id=eq.<visit_id>`                                          | Encounter, vitals       |
| `prescriptions`           | `id=eq.<prescription_id>` or `visit_id=eq.X & is_approved`  | Medications, dx         |
| `lab_results`             | `patient_id=eq.X & order=test_date.desc & limit=50`         | DiagnosticReport        |
| `vaccinations`            | `patient_id=eq.X & order=date_given.desc`                   | ImmunizationRecord      |
| `formulary`               | `generic_name=ilike.X & limit=1` (per medicine, on-demand)  | SNOMED enrichment       |
| `standard_prescriptions`  | `icd10=eq.X & limit=1` (per diagnosis, on-demand)           | SNOMED enrichment       |

The formulary/standard_prescriptions hits are *fallbacks* — if the prescription
JSON already carries `snomed_code` (newer Rx), no extra query is made. Older Rx
generated before SNOMED enrichment landed will pay one DB round-trip per drug
and per diagnosis.

### 6.4 Bundle assembly per type

All four generators share helpers: `buildPatientResource`,
`buildPractitionerResource`, `buildOrganizationResource`,
`buildEncounterResource`, `buildConditionResource`,
`buildAllergyIntoleranceResource`, `buildVitalObservation`,
`buildMedicationRequestResource`, `buildServiceRequestResource`,
`buildLabObservation`, `buildImmunizationResource`,
`buildDiagnosticReportResource`, plus `buildComposition` and `wrapInBundle`.

| Type                  | Composition profile          | Sections                                                                                  |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| `OPConsultation`      | `OPConsultRecord`            | ChiefComplaints, PhysicalExamination (vitals), Allergies, Medications, InvestigationAdvice, FollowUp |
| `Prescription`        | `PrescriptionRecord`         | Medications                                                                               |
| `DiagnosticReport`    | `DiagnosticReportRecord`     | Diagnostic Reports (DiagnosticReport + Observations)                                      |
| `ImmunizationRecord`  | `ImmunizationRecord`         | Immunization Records                                                                      |

Identifier systems hard-coded at the top of the file:

```
ABHA_SYSTEM   = https://healthid.ndhm.gov.in
HPR_SYSTEM    = https://doctor.ndhm.gov.in
HFR_SYSTEM    = https://facility.ndhm.gov.in
MRN_SYSTEM    = https://rx.radhakishanhospital.com/patients
SNOMED_SYSTEM = http://snomed.info/sct
ICD10_SYSTEM  = http://hl7.org/fhir/sid/icd-10
LOINC_SYSTEM  = http://loinc.org
```

`COMPOSITION_TYPES`, `SECTION_CODES`, `VITAL_LOINC` (8 vitals), and `ROUTE_CODES`
(10 administration routes) are exhaustive lookup tables in the source. Vitals are
projected from `visits` columns: `weight_kg`, `height_cm`, `hc_cm`, `muac_cm`,
`temp_f`, `hr_per_min`, `rr_per_min`, `spo2_pct` — each becomes an `Observation`
with the corresponding LOINC code and UCUM unit.

### 6.5 Deterministic IDs

Every resource gets a fresh `crypto.randomUUID()`. References inside the bundle
use `<ResourceType>/<uuid>`; entries use `urn:uuid:<id>` as `fullUrl`. Bundles
themselves are tagged `type: "document"` and identified via
`https://rx.radhakishanhospital.com/bundles`.

---

## 7. `ai-drug-lookup` and `ai-protocol-lookup`

These are **curator tools**, not part of the OPD prescription path. They live in
the admin pages (`formulary.html`, `formulary-import.html`, `standard-rx.html`)
and let an editor type a brand or generic name, see Claude's structured proposal,
review it, then upsert into `formulary` / `standard_prescriptions`.

### 7.1 Shared shape

Both follow the same skeleton:

1. Read `ANTHROPIC_API_KEY`.
2. Lazy-load a system prompt from Storage (`formulary_lookup_prompt.md` or
   `protocol_lookup_prompt.md`) into a module-level `cachedPrompt`.
3. Build a tightly-scoped user message.
4. Call Claude (`claude-sonnet-4-20250514`, `max_tokens=4096`, no tools).
5. `extractJSON` (same logic as `generate-prescription`).
6. Validate against a category enum and required fields, attaching `_warnings`
   (protocol) or returning HTTP 422 (drug — missing `generic_name`).

### 7.2 `ai-drug-lookup`

Input: `{ "drug_name": "Wikoryl AF" }`.

The user message contains an explicit "EXACT BRAND NAME MATCHING" guard with
two case studies (`EasiBreathe` ≠ Salbutamol, `Wikoryl AF` ≠ Paracetamol-combo)
designed to suppress Claude's tendency to guess composition from name shape.

Output: a single formulary row JSON (full schema in
`formulary_lookup_prompt.md`). Post-processing:

- Forces `generic_name` to UPPERCASE
- Logs (but does not reject) categories outside `VALID_CATEGORIES`
- Returns HTTP 422 if `generic_name` is missing or JSON parse fails

### 7.3 `ai-protocol-lookup`

Input: `{ "diagnosis": "Acute Otitis Media", "icd10": "H66.90" }` (at least one).

Output: a single `standard_prescriptions` row JSON. `validateProtocol()` checks
`icd10`, `diagnosis_name`, `category` (against a 16-entry enum that differs
slightly from the drug categories), and array shapes for
`first_line_drugs`/`second_line_drugs`/`investigations`/`counselling`/`warning_signs`.
Validation failures attach to `_warnings`; the row is still returned so a human
can decide.

Both responses include a `_meta.input_tokens` / `_meta.output_tokens` block — the
admin UIs surface this for cost tracking.

### 7.4 Relationship to the main flow

The lookup helpers **are not invoked at prescription time.** They only seed the
`formulary` and `standard_prescriptions` tables that `get_formulary` and
`get_standard_rx` later read from. Output drift between the curator prompts and
the runtime expectations is the principal failure mode — any field added by a
curator that the runtime doesn't project (column projection in §3.4) will simply
be ignored by Claude during prescription, while any field expected by the
runtime but missing from the curator output will become `null` in Claude's
context.

---

## 8. Error Modes & Fallbacks

| Scenario                                            | Behavior                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| Anthropic API 4xx/5xx (in tool loop)                | Throws → caught in handler → falls through to `singleShotFallback`       |
| Tool loop exceeds 10 rounds                         | Throws `Tool-use loop exceeded 10 rounds` → fallback                     |
| 120 s `AbortController` timeout                     | Loop aborts → caught → fallback                                          |
| Identical tool calls across two rounds              | Soft exit with whatever text has been emitted (no fallback)              |
| `executeGetFormulary` HTTP error                    | Returns `Formulary query error: HTTP <code>` as tool result string       |
| `get_formulary` empty result                        | Returns guidance string asking Claude to use training knowledge          |
| `get_standard_rx` empty result                      | Same — string suggesting "standard clinical guidelines"                  |
| `get_previous_rx` no rows                           | `No previous approved prescriptions found for patient X.`                |
| `get_lab_history` no rows                           | `No lab results found for patient X.`                                    |
| Storage 404 on a reference name                     | Returns `Error loading reference "X": <msg>` as tool result              |
| Final JSON unparseable                              | HTTP 200 with `{ prescription: { error, parse_error, raw_preview }, meta } ` |
| `generate-visit-summary` Claude failure             | HTTP 200 with `{ summary: null, reason }` (non-blocking)                 |
| `generate-fhir-bundle` patient/visit not found      | HTTP 404 with `{ error }`                                                |
| `generate-fhir-bundle` no labs/vaccinations         | HTTP 404 with `{ error: "No ... for patient X" }`                        |
| `ai-drug-lookup` missing `generic_name`             | HTTP 422 with `raw_response` preview                                     |

Tool result strings deliberately stay human-readable and machine-ignorable — the
contract is "give Claude something it can reason about", not "fail loudly". This
is the chief reason the system has high single-call success: knowledge gaps
become prompts, not exceptions.

---

## 9. Performance Notes

- **Prompt caching cost:** `core_prompt.md` (~370 lines) and `nabh_compliance.md`
  ride along on every request. There is currently no use of Anthropic
  prompt-caching headers (`cache_control`); each call pays full input-token
  pricing for the system prompt. Documented as future optimization in
  `claude-api` skill.
- **Parallel tool execution:** the loop runs all `tool_use` blocks in a round
  through `Promise.all`. A typical Round 1 fires `get_standard_rx` +
  `get_formulary` + (optionally) one `get_reference` in parallel.
- **Condensation:** `condenseDrugForAI` saves ~83% of tokens vs a raw formulary
  row (mostly by dropping `indian_brands` which is unused in clinical
  reasoning).
- **Targets:** `core_prompt.md` is written for "2 rounds" — round 1 = all tools,
  round 2 = JSON. Real traces hit 2–4 rounds depending on complexity (combo
  drugs, IV fluids, vaccinations).

---

## 10. Security & PII Handling

- Anon-key reads only. No service-role JWT in any clinical function. RLS
  enforces row visibility (currently `anon_full_access` for the POC).
- `get_previous_rx` and `generate-visit-summary` both apply an explicit
  PII-stripping projection before any data crosses the Anthropic boundary —
  patient name, UHID, guardian, DOB are removed; clinical content (diagnosis,
  meds, vitals, safety) is forwarded.
- `patient_id` UHID *is* sent to Claude in `generate-prescription` as the user
  message context (so it can be echoed into `patient.uhid` in the JSON). Names
  and DOBs are not.
- `ANTHROPIC_API_KEY` is only readable inside the function; never proxied to
  the client.
- CORS is wide-open (`*`). Misuse is mitigated by RLS + the anon key being a
  read-mostly key under POC RLS.

---

## 11. Observability

Each function `console.log`s a small structured trace:

- `generate-prescription`: per-round `Round N: calling Claude API...`, per-tool
  `  Tool: <name>(<input json>)`, per-completion `Completed in N round(s).
  Tokens: X in, Y out.`
- `generate-visit-summary`: `Summary generated for <UHID>: <chars>, X in / Y
  out tokens`.
- `generate-fhir-bundle`: `FHIR Bundle generated: type=X, patient=Y,
  entries=Z`.
- `ai-drug-lookup`/`ai-protocol-lookup`: token counts per call.

These show up in Supabase function logs (`supabase functions logs <name>
--project-ref ...`). There is no metrics export — the `meta` block on the
prescription response is the only structured signal returned to the caller.

---

## 12. Schema Touchpoints

Tables read or written by these functions:

| Table                     | Read by                                                              | Written by               |
| ------------------------- | -------------------------------------------------------------------- | ------------------------ |
| `formulary`               | `generate-prescription` (`get_formulary`), `generate-fhir-bundle`    | `ai-drug-lookup` (admin) |
| `standard_prescriptions`  | `generate-prescription` (`get_standard_rx`), `generate-fhir-bundle`  | `ai-protocol-lookup`     |
| `prescriptions`           | `generate-prescription` (`get_previous_rx`), `generate-visit-summary`, `generate-fhir-bundle` | front-end at sign-off    |
| `lab_results`             | `generate-prescription` (`get_lab_history`), `generate-fhir-bundle`  | front-end (registration) |
| `patients`                | `generate-fhir-bundle`                                               | —                        |
| `doctors`                 | `generate-fhir-bundle` (default `DR-LOKENDER`)                       | —                        |
| `visits`                  | `generate-fhir-bundle`                                               | —                        |
| `vaccinations`            | `generate-fhir-bundle`                                               | —                        |

None of the clinical Edge Functions mutate the database — all writes are
performed by the web app under the anon JWT after Edge Function output is
reviewed.

---

## 13. Known Limitations / Future Work

- **No prompt versioning** — see §4.3.
- **No Anthropic prompt-cache** — `core_prompt.md` is re-charged on every call.
- **`HealthDocumentRecord` bundle type unimplemented** — declared in the
  composition type table but the `serve()` switch returns "Unsupported bundle
  type". ABDM Milestone 2 ticks the other four; HDR is on the backlog.
- **Hospital identifiers hard-coded** (`HOSPITAL`, `HFR_SYSTEM`, project URL,
  anon key). All five files duplicate the same constants. Future work:
  centralize via Edge Function shared module.
- **No retry on Anthropic transient 5xx** in any function — failure goes
  straight to fallback (`generate-prescription`) or `summary: null`
  (`generate-visit-summary`).
- **`brand_names` Strategy 2 fetches every active drug** for client-side
  filtering. Acceptable today (~530 rows) but does not scale.
- **`ai-protocol-lookup` has no upper bound on output token cost** beyond
  `max_tokens=4096`. Field validation is non-blocking — invalid categories
  flow into `_warnings`, not errors.

---

## 14. File Reference

| File                                                                   | Lines | Role                                       |
| ---------------------------------------------------------------------- | ----- | ------------------------------------------ |
| `supabase/functions/generate-prescription/index.ts`                    | 772   | Tool-use loop, fallback, JSON extraction   |
| `supabase/functions/generate-fhir-bundle/index.ts`                     | 1680  | FHIR R4 bundle assembler                   |
| `supabase/functions/generate-visit-summary/index.ts`                   | 194   | Single-shot AI summary                     |
| `supabase/functions/ai-drug-lookup/index.ts`                           | 214   | Formulary curator helper                   |
| `supabase/functions/ai-protocol-lookup/index.ts`                       | 215   | Standard-prescription curator helper       |
| `radhakishan_system/skill/core_prompt.md`                              | ~370  | Runtime system prompt + JSON contract      |
| `radhakishan_system/skill/radhakishan_prescription_skill.md`           | 933   | Original full skill (artifact only)        |
| `radhakishan_system/skill/formulary_lookup_prompt.md`                  | ~125  | System prompt for `ai-drug-lookup`         |
| `radhakishan_system/skill/protocol_lookup_prompt.md`                   | ~105  | System prompt for `ai-protocol-lookup`     |
| `radhakishan_system/skill/examples/worked_example.md`                  | —     | Arjun AOM end-to-end example               |
| `radhakishan_system/skill/references/dosing_methods.md`                | —     | BSA / GFR / infusion / age-tier dosing     |
| `radhakishan_system/skill/references/nabh_compliance.md`               | —     | Auto-embedded into core prompt             |
| `radhakishan_system/skill/references/emergency_triage.md`              | —     | Triage decision support                    |
| `radhakishan_system/skill/references/antibiotic_stewardship.md`        | —     | Stewardship rules                          |
| `radhakishan_system/skill/references/neonatal.md`                      | —     | Neonatal care                              |
| `radhakishan_system/skill/references/iv_fluids.md`                     | —     | IV fluid protocols                         |
| `radhakishan_system/skill/references/growth_charts.md`                 | —     | WHO/IAP/Fenton growth charts               |
| `radhakishan_system/skill/references/developmental.md`                 | —     | Developmental screening                    |
| `radhakishan_system/skill/references/standard_prescriptions.md`        | —     | Reference/index of stocked protocols       |
| `radhakishan_system/skill/references/vaccination_iap2024.md`           | —     | IAP 2024 ACVIP schedule                    |
| `radhakishan_system/skill/references/vaccination_nhm_uip.md`           | —     | NHM-UIP government schedule (Haryana)      |
