# 03 · Data — Data Contracts (Datasets + Prescription Payload)

> **Scope.** This document is the **contract layer** for the *data content* of the system: the JSON knowledge-base datasets (formulary/drugs, ICD-10 protocols, terminology mappings) and the **prescription JSON payload** that flows from the AI generation worker → dose engine → print renderer → FHIR builder. It is **schema-level + use-case level only** — it defines the *shape*, *invariants*, *enums*, *validation rules*, and *cross-record integrity* of each dataset and payload. It deliberately enumerates **no records**.
>
> **Boundary with siblings.** `schema_design.md` owns the **Postgres DDL** (tables, columns, constraints, RLS, triggers). `schema_migration.md` owns the **ETL/cutover plan**. *This* file owns the **JSON contracts** that those tables store in `jsonb` columns and that cross the service boundaries — the things a `jsonb` column's `CHECK` can't fully express and that must be enforced by **Ajv schemas in CI and at write time**. Where this file and the DDL overlap (e.g., the `formulary.formulations` shape), this file is the *authoritative description of the JSON body*; the DDL is authoritative for the *column*.
>
> **Authority.** Built to the TARGET-ARCHITECTURE DIGEST. Decisions here are final. Two facts verified against the live datasets this session are flagged inline as **[VERIFIED]** (and one **[DRIFT]** where the live data violates the target contract and the migration must repair it).

---

## 0. The contract model in one paragraph

Every dataset and payload in this system is governed by a **versioned JSON Schema** (Ajv, draft 2020-12), stored in the repo under `src/<context>/core/schema/*.v<n>.json`, and enforced at **three gates**: (1) **CI** — every seed file and every fixture is validated against its schema, build fails on violation; (2) **write time** — adapters validate before any `INSERT`/`UPDATE` into a `jsonb` column or before returning a tool result to the model; (3) **runtime boundary** — the dose engine, FHIR builder, and print renderer each declare the exact sub-shape they consume and reject anything that does not conform (fail-closed, never best-effort). Datasets carry **provenance** (`verified` vs `placeholder`, `data_source`, `last_reviewed_date`) so clinical-grade and unverified rows are distinguishable. The **prescription payload** is the single most important contract: the AI emits it with **no computed numbers**, the dose engine fills the numeric/bilingual/pictogram fields deterministically, and the server re-validates byte-for-byte before it can be signed.

---

## 1. Contract inventory & ownership

| # | Contract | Schema id | Stored / carried in | Producer | Consumers | Gate |
|---|----------|-----------|---------------------|----------|-----------|------|
| C1 | **Formulary drug** | `formulary.v1.json` | `catalog.formulary` (cols + `jsonb`) | ETL seed, six-eye review | dose engine, `get_formulary` tool, FHIR builder | CI + write |
| C2 | **Dosing band** (sub-of C1) | `dosing_band.v1.json` | `catalog.formulary.dosing_bands` | ETL seed | dose engine (sole arithmetic input) | CI + write |
| C3 | **Formulation** (sub-of C1) | `formulation.v1.json` | `catalog.formulary.formulations` | ETL seed | dose engine `parseIngredients`, FHIR `Medication` | CI + write |
| C4 | **Standard prescription protocol** | `standard_rx.v1.json` | `catalog.standard_prescriptions` | ETL seed | `get_standard_rx` tool, AI context | CI + write |
| C5 | **Terminology concept** | `concept.v1.json` | `catalog.concepts` | ETL from LOINC/SNOMED maps | FK target for C1/C4/labs; FHIR `Coding` | CI + write |
| C6 | **LOINC lab/vitals mapping** | (ETL input → C5) | `radhakishan_system/data/loinc_*` | curated dataset | seed of `catalog.concepts` | CI |
| C7 | **SNOMED maps** (dx/drug/route) | (ETL input → C5) | `radhakishan_system/data/snomed_*` | curated dataset | seed of `catalog.concepts`, FHIR | CI |
| **C8** | **Prescription payload** | `prescription.v1.json` | `prescribing.prescription_drafts.payload` / `prescriptions.rx_json` | AI worker (struct) + dose engine | print renderer, FHIR builder, sign-off gate | CI + write + sign-off |
| C9 | **`compute_doses` tool I/O** | `compute_doses.req/res.v1.json` | bus payload (in-flight) | AI worker (req) / dose engine (res) | AI worker copies res verbatim into C8 | runtime |
| C10 | **`ComputeDoseParams` / `Result`** | TS types (ports) | in-process | callers of `DoseEnginePort` | engine | typecheck + golden fixtures |

Naming/versioning: schemas are **append-only & immutable once shipped**; a breaking change is `…v2.json` with a coexistence window, never an in-place edit (mirrors the migration discipline of forward-only DDL).

---

## 2. C1 — Formulary drug contract (`formulary.v1.json`)

The formulary is a **governed, contract-tested knowledge base** — it is the dose engine's safety dependency, so it is held to the highest contract bar of any dataset.

> **[VERIFIED]** Live `formulary_working.json` = **652 records** (target seed is **530 active drugs** after dedupe/curation; the surplus is candidate/superseded rows that ETL splits into `verified` vs `placeholder`). The ABDM-FHIR v3 export carries the *target* nested `formulations[].ingredients[]` shape this contract codifies.

### 2.1 Top-level shape (use-case view)

A formulary record answers four questions for downstream consumers:
- **Identity & terminology** → "which drug, which SNOMED concept" (for FHIR `Coding`, dedup, `get_formulary` lookup).
- **Formulations** → "what physical product & strength" (the **concentration** the dose engine divides into).
- **Dosing bands** → "how much per kg/BSA, what caps, what frequency" (the **sole arithmetic input** to the engine).
- **Safety metadata** → renal/hepatic adjustment, interactions, contraindications, warnings (AI narrative + safety flags; **never** arithmetic).

```jsonc
// formulary.v1.json  (root: object)
{
  // ── Identity & terminology ──────────────────────────────────────
  "generic_name":        "string",          // REQUIRED, UNIQUE business key, Title Case
  "snomed_code":         "string | null",   // FK → catalog.concepts(system='SNOMED')
  "snomed_display":      "string | null",
  "drug_class":          "string | null",
  "category":            "enum CategoryEnum",// see §2.4
  "brand_names":         "string[]",         // Indian brands, free-text
  "therapeutic_use":     "string[]",         // ICD-title-style indications
  "licensed_in_children":"boolean",          // default true
  "unlicensed_note":     "string | null",

  // ── Provenance / governance (NEW vs prototype) ──────────────────
  "data_source":   "enum: snomed_branded | snomed_generic | orphan | manual",
  "verification_status": "enum: verified | placeholder | legacy",   // six-eye review gate
  "reference_source":    "string | null",    // e.g. 'BNFc 2024', 'IAP 2024'
  "last_reviewed_date":  "date | null",       // ISO-8601; drives staleness alerts
  "active":              "boolean",           // default true

  // ── Polymorphic clinical payload (jsonb arrays) ─────────────────
  "formulations":  "Formulation[]   (C3)",   // ≥1 REQUIRED for a dosable drug
  "dosing_bands":  "DosingBand[]     (C2)",   // ≥1 REQUIRED for a dosable drug

  // ── Adjustment & safety ─────────────────────────────────────────
  "renal_adjustment_required":   "boolean",
  "renal_bands":   "RenalBand[]",             // see §2.5
  "hepatic_adjustment_required": "boolean",
  "hepatic_note":  "string | null",
  "contraindications":          "string[]",
  "cross_reactions":            "string[]",
  "interactions":  "Interaction[]",           // {drug_or_class, severity, effect}
  "black_box_warnings":         "string[]",
  "pediatric_specific_warnings":"string[]",
  "monitoring_parameters":      "string[]",
  "administration":  "string | null",
  "food_instructions":"string | null",
  "storage_instructions":"string | null",
  "pregnancy_category":"string | null",
  "lactation_safe":  "boolean | null",
  "lactation_note":  "string | null"
}
```

### 2.2 C3 — Formulation contract (`formulation.v1.json`)

The **concentration source of truth**. The dose engine's `parseIngredients()` reads `ingredients[]`; the FHIR builder reads it for `Medication.ingredient`. **[VERIFIED]** against the v3 export.

```jsonc
{
  "form":            "string",       // REQUIRED, e.g. 'Oral suspension','Tablet','Powder for injection (IV)'
  "form_snomed_code":"string | null",// FK → catalog.concepts (dose_forms map, C7)
  "route":           "enum RouteEnum",// PO|IV|IM|SC|inhaled|topical|rectal|ophthalmic|nasal|otic
  "ingredients": [                    // REQUIRED, ≥1; multiple = combination drug
    {
      "name":                     "string",   // REQUIRED
      "snomed_code":              "string | null",
      "is_active":                "boolean",   // REQUIRED
      "is_primary":               "boolean",   // REQUIRED; exactly ONE primary per formulation (INVARIANT)
      "strength_numerator":       "number",    // REQUIRED  → concentration_mg
      "strength_numerator_unit":  "string",    // 'mg','mcg','g','IU','unit'
      "strength_denominator":     "number",    // REQUIRED  → concentration_per_ml / per_tablet / per_vial
      "strength_denominator_unit":"string"     // 'mL','tablet','vial','sachet','actuation'
    }
  ],
  "indian_brands": [ { "name":"string","manufacturer":"string|null","snomed_code":"string|null","verified_on":"string|null" } ],
  "indian_conc_note":"string",       // REQUIRED, human-readable, e.g. 'Amoxicillin 250 mg / 5 mL' → row1_en
  "display_name":    "string | null"
}
```

**Formulation invariants (Ajv + CI):**
- `ingredients[]` MUST contain **exactly one** `is_primary:true` entry → else reject (engine picks the primary for the dose denominator).
- `strength_numerator > 0` AND `strength_denominator > 0` (division by the denominator must be safe — a 0 here is a paper-dose hazard).
- `indian_conc_note` REQUIRED and non-empty (it is the printed concentration in `row1_en`).
- `route ∈ RouteEnum` and `form_snomed_code`, if present, MUST resolve in `catalog.concepts`.

### 2.3 C2 — Dosing band contract (`dosing_band.v1.json`) — the safety-critical one

This is the **only numeric input the dose engine trusts**. Every field maps to a `ComputeDoseParams` argument (§7). It must be the most strictly validated contract in the system.

```jsonc
{
  "indication":        "string",      // matches a therapeutic_use entry
  "age_band":          "enum AgeBandEnum",  // CANONICAL set — see §2.4 [DRIFT note]
  "ga_weeks_min":      "number | null",     // gestational-age gating (preterm)
  "ga_weeks_max":      "number | null",
  "method":            "enum DosingMethodEnum",  // 6 canonical methods — see §2.4 [DRIFT]
  "dose_min_qty":      "number | null",
  "dose_min_unit":     "string | null",     // 'mg/kg','mcg/kg','mg/m2',...
  "dose_max_qty":      "number | null",
  "dose_max_unit":     "string | null",
  "dose_basis":        "enum: per_kg | per_m2 | per_dose | per_day",
  "is_per_day":        "boolean",           // true → engine divides by frequency_per_day
  "frequency_per_day": "integer 1..6",      // → FREQ_EN / FREQ_HI key
  "interval_hours":    "number | null",
  "loading_dose_qty":  "number | null", "loading_dose_unit":"string|null", "loading_dose_basis":"string|null",
  "maintenance_dose_qty":"number | null","maintenance_dose_unit":"string|null",
  "duration_days_default":"integer | null",
  "duration_note":     "string | null",
  "max_single_qty":    "number | null", "max_single_unit":"string|null",  // → max-single cap (HARD)
  "max_daily_qty":     "number | null", "max_daily_unit": "string|null",  // → max-daily cap (HARD)
  "rounding_rule":     "enum: 0.5ml | 0.1ml | 0.25tab | unit",            // form-specific rounding
  "notes":             "string | null"
}
```

**Dosing-band invariants (the clinical-safety contract — fail closed):**
1. A drug with any `formulation.route ∈ {PO,...}` and intended for prescribing MUST have ≥1 `dosing_band`. **No band → drug is non-dosable → `get_formulary` returns it flagged, AI must route to `omitted_medicines[]`.**
2. For `method='weight'`: `dose_*_qty` REQUIRED and `> 0`.
3. For `method='bsa'`: `dose_*_unit` MUST be `mg/m2`-shaped; engine requires `heightCm` at call time.
4. `dose_min_qty ≤ dose_max_qty` when both present.
5. `max_single_qty` and `max_daily_qty`, when present, are **HARD caps** — the engine caps to them and sets `capped:true`; a band MUST NOT encode a therapeutic dose that exceeds its own caps (CI cross-check).
6. `frequency_per_day` MUST be present when `is_per_day:true` (engine divides by it).
7. `rounding_rule` MUST be consistent with the formulation form (syrup→`0.5ml`, drops→`0.1ml`, tablet→`0.25tab`).

### 2.4 Controlled vocabularies & the **[DRIFT]** finding

The target enums are **closed sets**. Migration ETL maps the messy live values onto them; CI then forbids any value outside the set.

| Enum | Canonical values (closed) |
|------|---------------------------|
| `CategoryEnum` | `Respiratory, GI, Neonatal, Infectious, ENT, Dermatology, Urology, General, Emergency, Cardiology, Neurology, Endocrine, Hematology, Rheumatology, Other` |
| `DosingMethodEnum` | `weight, bsa, fixed, gfr, infusion, age` — **exactly the 6 dosing methods** the engine implements |
| `AgeBandEnum` | `neonate, infant, child, adolescent, all` (+ optional `ga`/age gating via `ga_weeks_*` and a structured `age_min_months`/`age_max_months` pair) |
| `RouteEnum` | `PO, IV, IM, SC, inhaled, topical, rectal, ophthalmic, nasal, otic` |

> **[DRIFT] — live data violates the closed enums; migration MUST normalize.** Sampling the live `formulary_working.json` dosing bands this session found the `method` field carrying **15 distinct free-text values** (`BSA`, `bsa`, `bsa_based`, `bsa_crcl`, `weight`, `weight_band`, `weight_banded`, `weight_based`, `weight_ige`, `age`, `age_tier`, `fixed`, `infusion`, `titrated`, `topical`) and `age_band` carrying **70+ free-text variants** (`child_1_12yr`, `infant_6_to_11mo`, `neonate_lt1wk`, `adolescent_over_15yr`, …). The dose engine only understands the 6 canonical methods. **Contract requirement:** the ETL ships a deterministic, reviewed **normalization map** (`method`/`age_band` raw → canonical) applied during seed; the canonical value lands in the band, and the raw string is preserved in `notes` for audit. CI then asserts `method ∈ DosingMethodEnum` and `age_band ∈ AgeBandEnum` for 100% of bands — **build fails otherwise.** This is the single highest-value formulary-quality fix, because an un-normalized `method` silently degrades to a wrong engine path.

### 2.5 Renal-band & interaction sub-contracts

```jsonc
// RenalBand
{ "gfr_min":"number","gfr_max":"number","action":"enum: reduce_dose|extend_interval|avoid|monitor","adjusted_dose_note":"string" }
// Interaction
{ "drug_or_class":"string","severity":"enum: major|moderate|minor","effect":"string" }
```
Renal bands feed the `method='gfr'` path; interactions feed the AI's `safety.interactions` narrative (never numbers). `severity` here is a **closed enum** — it is the input to the three-tier safety severity (§6.3 of `schema_design`) and must not be free-text.

---

## 3. C4 — Standard prescription protocol (`standard_rx.v1.json`)

> **[VERIFIED]** Live `standard_prescriptions_combined.json` = **482 rows / 482 distinct ICD-10 codes** (target ≈ **446 curated protocols**; the surplus rows collapse during dedupe to `(icd10, category, severity)`). Same-ICD-10 multiple-protocol case is real (e.g. pneumonia under Respiratory vs Neonatal).

```jsonc
// standard_rx.v1.json  (root: object)
{
  "icd10":          "string",        // NOT unique alone; FK → catalog.concepts(system='ICD10')
  "diagnosis_name": "string",        // REQUIRED; pg_trgm fuzzy-match target
  "category":       "enum CategoryEnum",
  "severity":       "enum: any | mild | moderate | severe",
  // UNIQUE business key: (icd10, category, severity)  ← contract & DDL agree

  "first_line_drugs":  "ProtocolDrug[]",   // {drug, notes, is_new_2024_2025}
  "second_line_drugs": "ProtocolDrug[]",
  "investigations":    "ProtocolInvestigation[]", // {name, indication, urgency}
  "counselling":       "string[]",          // may be Devanagari
  "warning_signs":     "string[]",          // English; AI translates to bilingual
  "referral_criteria":      "string | null",
  "hospitalisation_criteria":"string | null",
  "notes":             "string | null",
  "source":            "string | null",     // 'IAP 2024','WHO 2023','CDC 2024'
  "duration_days_default":"integer | null",
  "guideline_changes": "string | null",
  "snomed_code":       "string | null", "snomed_display":"string | null",
  // Rich optional fields (newer protocols)
  "expected_course":   "string | null",
  "key_clinical_points":"string[] | null",
  "severity_assessment":"{ mild, moderate, severe } | null",
  "monitoring_parameters":"[{parameter, frequency}] | null",
  "active":            "boolean"
}
// ProtocolDrug:          { "drug":"string","notes":"string","is_new_2024_2025":"boolean" }
// ProtocolInvestigation: { "name":"string","indication":"string","urgency":"enum: stat|urgent|routine" }
```

**Protocol invariants:**
- `(icd10, category, severity)` UNIQUE — enforced both as a DDL constraint and as a CI dedup assert over the seed file.
- Every `first_line_drugs[].drug` / `second_line_drugs[].drug` SHOULD resolve to a `catalog.formulary.generic_name`. CI emits a **referential-integrity report** of unmatched drug names (warn, not fail — protocols legitimately list non-formulary or non-drug items such as ORS, which the AI routes to `non_pharmacological[]`).
- `icd10` MUST resolve in `catalog.concepts`; unresolvable codes are quarantined in ETL, not seeded.
- **Use-case note:** `first_line_drugs` frequently contains **non-pharmacological items** (ORS, KMC, steam inhalation). The contract permits this; the AI prompt (`core_prompt.md`) and `non_pharmacological[]` payload field (§5) are the routing mechanism — these items MUST NOT reach `medicines[]`.

---

## 4. C5–C7 — Terminology contracts (the integrity spine)

All clinical codes resolve to one **concept table** (`catalog.concepts`); the dataset files are its ETL inputs. This kills free-text-code drift and gives the FHIR builder a single `Coding` source.

```jsonc
// concept.v1.json  (catalog.concepts row)
{ "system":"enum: ICD10 | SNOMED | LOINC",  "code":"string",  "display":"string" }
// UNIQUE (system, code).  FKs point here from formulary.snomed_code, standard_rx.icd10/snomed_code,
//                          lab_results.loinc_code, vitals → loinc.
```

### 4.1 Source dataset shapes (ETL inputs — **[VERIFIED]** counts & shapes)

| File | Shape | Count | Maps to concept system | Notes |
|------|-------|-------|------------------------|-------|
| `loinc_lab_mappings.json` | `array` of `{test_name, category, loinc_code, loinc_display, unit}` | **39** | LOINC | drives structured lab entry units/flags + FHIR `Observation` |
| `loinc_vitals_mappings.json` | `array` of `{vital_name, column, loinc_code, loinc_display, unit, fhir_category}` | **8** | LOINC | binds vitals columns → LOINC for FHIR `vital-signs` |
| `snomed_diagnosis_mappings.json` | `array` of `{id, icd10, diagnosis_name, snomed_code, snomed_display}` | **446** | SNOMED | ICD-10↔SNOMED crosswalk for diagnoses |
| `snomed_drug_mappings.json` | `array` of `{generic_name, snomed_code, snomed_display}` | **530** | SNOMED | drug↔SNOMED for `formulary.snomed_code` & FHIR `Medication` |
| `snomed_route_mappings.json` | `object`: `routes[10] · methods[7] · dose_forms[15] · additional_instructions[6]` (each `{system_value, snomed_code, snomed_display}`) + `composition_types{5}` + `section_codes{9}` (each `{snomed_code, snomed_display}`) | — | SNOMED | FHIR coding for routes/forms/instructions and Composition section codes |

**Terminology contract rules:**
- ETL loads all five files into `catalog.concepts` (de-duplicated on `(system, code)`); the source `display` values become the canonical concept display.
- A `loinc_code`/`snomed_code` written to any clinical/catalog row MUST exist in `catalog.concepts` (FK) — **validate on write**, do not accept arbitrary code strings.
- `snomed_route_mappings.composition_types`/`section_codes` are **FHIR-builder-only** lookups (OPConsultation/Prescription Composition assembly) — they are not patient data; loaded as static config, not concepts FKs.
- Units in `loinc_lab_mappings` are the **authoritative unit** for the matching lab; structured lab entry auto-fills and auto-flags against these (no free-text unit).

---

## 5. C8 — Prescription payload contract (`prescription.v1.json`) — the headline

This is the object the AI worker emits, the dose engine completes, the print renderer draws, the FHIR builder maps, and the sign-off gate guards. It is the **single canonical Rx shape** — there is exactly one renderer and one schema (the duplicate `printRx`/`renderRx` of the prototype is eliminated).

### 5.1 Hard separation of authorship (the open/closed safety boundary)

The payload's fields are **partitioned by author**, and CI/runtime enforces who may write what:

| Field group | Author | Rule |
|-------------|--------|------|
| Clinical narrative, drug selection, regimen *intent*, routing | **AI** | AI proposes `medicines[].{row1_en, method, formulation, snomed_*}`, frequency, duration, flags, counselling |
| **All numbers + bilingual dose strings + pictogram dose** | **Dose engine** | `row2_en`, `row3_hi`, `calc`, `concentration_mg`, `concentration_per_ml`, `dose_mg_per_kg`, `max_dose_single_mg`, `pictogram.dose_display/dose_qty/dose_fraction` come **verbatim** from `compute_doses` (C9) |
| `safety.severity_server`, `safety.overall_status`, caps | **Server** | server recomputes; AI's values are advisory and are overwritten |
| `patient.*` demographics, `uhid` | **System** (from visit context) | not invented by AI |

**Invariant CS-DOSE:** the AI MUST NOT be the source of any numeric dose field that reaches paper. The server diffs AI-emitted numbers against the engine's recompute **byte-for-byte (zero tolerance)**; any mismatch → `safety.overall_status='REVIEW_REQUIRED'` (UPPER_SNAKE stored/wire token, C3), `severity_server='high'`, and the draft cannot be signed without explicit acknowledgement.

### 5.2 Root shape (authoritative; field names exact)

```jsonc
{
  "patient":  { "name","uhid","age","dob","sex","weight_kg","height_cm","hc_cm","guardian" },
  "vitals":   { "temp_f","hr_per_min","rr_per_min","spo2_pct","bp_systolic","bp_diastolic","map_mmhg" },
  "chief_complaints":"string", "clinical_history":"string", "examination":"string",
  "neonatal": { "ga","pna","bw","corrected","notes" } /* null for non-neonates */,
  "diagnosis":[ { "name","icd10","snomed_code":"string|null","type":"provisional|final" } ],
  "triage_score":"integer", "triage_action":"Routine OPD|Priority|Urgent|Emergency",

  "medicines": [ Medicine ],                 // see §5.3 — the 4-row bilingual + pictogram block
  "non_pharmacological": [ { "instruction","instruction_hi","category":"diet|therapy|procedure|lifestyle" } ],
  "investigations":[ { "name","loinc_code":"string|null","indication","urgency":"same-day|routine" } ],
  "iv_fluids":[ { "fluid","volume_ml","rate_ml_hr","additives","duration_hrs","monitoring" } ],

  "growth": { "chart":"WHO2006|IAP2015|Fenton2013","waz","haz","whz","hcaz","muac","classification","comment" },
  "vaccinations": { "schedule_used":"IAP2024|NHM-UIP|Both","due":[],"overdue":[],"next_due","notes" },
  "developmental": { "tool_used","findings","red_flags":[] },
  "diet":"string", "counselling":["string"], "referral":"string",

  // ── Completeness reconciliation (Sprint-1 contract) ──
  "requested_medicines": ["string"],         // REQUIRED: every drug the doctor named, verbatim
  "omitted_medicines":   [ { "name","reason": OmitReason } ],  // REQUIRED (may be [])

  "safety": {
    "allergy_note":"NKDA | ALLERGY: …",
    "interactions":"None found | …",
    "max_dose_check":[ { "drug","calculated_dose_mg","max_allowed_mg","status":"PASS|FLAGGED" } ],
    "flags":[],
    "overall_status":"SAFE | REVIEW_REQUIRED",   // UPPER_SNAKE stored/wire (C3); "REVIEW REQUIRED" (space) is display-only, never persisted/sent
    "severity_server":"none | moderate | high"   // server-owned, gate three-tier (C3); audit 'low' maps to 'none' at the gate
  },
  "warning_signs":[ { "hi","en" } ],
  "admission_recommended":"string | null", "followup_days":"number | null",
  "doctor_notes":"string", "nabh_compliant": true
}
```

### 5.3 `Medicine` — the 4-row bilingual + pictogram block (most load-bearing sub-contract)

The defining artifact of the system. Four rendered rows + a structured pictogram, all in Royal Blue.

```jsonc
{
  "number":           "integer",     // 1-based ordinal
  // ── THE FOUR ROWS ─────────────────────────────────────────────
  "row1_en":          "string",      // R1: GENERIC NAME IN CAPITALS (Indian concentration)   [AI, from indian_conc_note]
  "row2_en":          "string",      // R2: English dose+route+freq+duration                  [ENGINE verbatim]
  "row3_hi":          "string",      // R3: Hindi (Devanagari) for parents — ALWAYS present    [ENGINE verbatim]
  "pictogram":        "Pictogram",   // R4: structured → inline-SVG sidebar                    [ENGINE numbers]

  // ── Engine inputs/outputs (numeric — ENGINE-owned) ────────────
  "calc":             "string",      // ONE-LINE math trace, e.g. '15mg/kg × 7.2kg = 108mg ÷ (120mg/5mL) = 4.5mL'
  "dose_mg_per_kg":   "number", "dose_per_day_divided":"number",
  "concentration_mg": "number", "concentration_per_ml":"number",
  "max_dose_single_mg":"number",
  "formulation":      "enum: syrup|drops|eye drops|nasal drops|ear drops|tablet|injection|inhaler|topical",
  "method":           "enum DosingMethodEnum",
  // ── Provenance & flags (AI-owned) ─────────────────────────────
  "snomed_code":"string|null", "snomed_display":"string|null",
  "flag":"string"                    // "" if no concern; else short safety note
}
```

```jsonc
// Pictogram  (R4 — drives the inline-SVG sidebar; NO external images)
{
  "form":"syrup|tablet|drops|eye drops|nasal drops|ear drops|injection|inhaler|topical",
  "dose_display":"4 ml",             // ENGINE: human dose per administration
  "dose_qty":"number",               // ENGINE: units/ml per dose
  "dose_fraction":"null | half | quarter",   // ENGINE: tablet fractions only
  "times":["morning","afternoon","evening","bedtime"],  // mapped from frequency; sunrise/sun/sunset/moon icons
  "prn":"boolean",                   // true → times must be []
  "max_per_day":"number | null",     // PRN cap
  "duration_days":"number | null",
  "with_food":"boolean",
  "special":"null | short-string"    // e.g. 'fever_only','empty_stomach'
}
```

**Medicine invariants (Ajv + runtime):**
1. **R3 `row3_hi` is ALWAYS present** in Devanagari regardless of the `LANGUAGE` setting — a non-negotiable accessibility contract (low-literacy parents).
2. `row2_en` MUST equal the engine's `enD`, `row3_hi` MUST equal `hiD`, `pictogram.dose_display` MUST equal `vol` — string-identical (the verbatim-copy rule; server re-checks).
3. `pictogram.form` MUST equal `formulation` (same physical form).
4. `prn:true` ⇒ `times == []` and `max_per_day != null` and `duration_days == null`.
5. `dose_fraction ∈ {half,quarter}` only when `form` is a solid (`tablet`); else `null`.
6. `concentration_mg > 0` AND `concentration_per_ml > 0` (no divide-by-zero into paper).
7. **Bilingual + pictogram pairing:** every pictogram icon is accompanied by Hindi+English text — **never icon-only** (false-confidence risk; NABH quality artifact).

### 5.4 Completeness reconciliation contract (the "never silently drop a drug" rule)

A formal, server-checked invariant — the prototype's hardest-won safety property, promoted to a contract:

```
len(requested_medicines)  ==  len(medicines drawn from doctor's named drugs)  +  len(omitted_medicines)
```
- `requested_medicines[]` = every drug the doctor named, verbatim.
- Each requested drug appears in **exactly one** of `medicines[]` or `omitted_medicines[]`.
- `OmitReason ∈ { not_in_formulary, age_contraindication, dangerous_interaction, doctor_specified_dose_unsafe_engine_capped, fallback_mode_omission(server), server_completeness_check_skipped_retry(server) }`.
- **Allergy is NEVER a valid omit reason** — an allergy-clashing drug stays in `medicines[]` with a `flag` + a safe-alternative note; the doctor decides (doctor-override rule). The server **rejects** any payload that fails the length reconciliation.

### 5.5 Payload lifecycle & validation gates

```
AI emits payload (NO numbers in dose fields)
   └─► compute_doses (C9) per drug ─► engine returns vol/enD/hiD/calc/capped
        └─► worker copies engine output VERBATIM into medicines[]
             └─► Ajv: prescription.v1.json  (CI fixtures + write-time)
                  └─► server re-recompute & byte-diff (CS-DOSE)  ─► severity_server
                       └─► persisted: prescription_drafts.payload (pending_review)
                            └─► SignOff command ─► prescriptions.rx_json (immutable, content-hashed)
```
At **sign-off**, the gate re-validates the full payload + reconciliation + dose byte-match; a draft failing any check cannot transition `draft_ready → signed`. The `signed` state materializes as a **row insert** into `prescribing.prescriptions` (its existence *is* the signed state — `status:'signed'` is a synthetic/computed API field, not a column; C4), not a status mutation. Edits after sign-off are **new rows** in `rx_versions` (append-only), never in-place mutation.

---

## 6. C9 — `compute_doses` tool contract (AI ⇄ dose engine)

> **Tool wire details live in `05_ai/tool_contracts.md`.** This section owns the *data shapes* of the `compute_doses` request/response. The **`input_schema` Claude actually sees** and the **condensed, token-stripped output returned to the model** for all 6 tools (the 5 progressive-disclosure tools + `compute_doses`) are frozen in `05_ai/tool_contracts.md`; `compute_doses` there delegates to the TS `DoseEnginePort` (the runtime arithmetic authority; `web/dose-engine.js` is the frozen parity oracle). On any disagreement about the on-the-wire tool surface, `05_ai/tool_contracts.md` wins.

The AI batches **all** drugs into one tool call; the engine returns per-drug results the AI copies verbatim. This is the seam that keeps arithmetic out of the model.

```jsonc
// REQUEST  (compute_doses.req.v1.json) — AI → engine, ONE call, ALL drugs
{ "drugs": [ {
    "name":"string",
    "method":"weight|bsa|fixed|gfr|infusion|age",
    "weight":"number|null", "heightCm":"number|null", "bsa":"number|null",
    "sliderValue":"number|null",        // for method='fixed' (doctor-specified dose)
    "isPerDay":"boolean", "frequency":"integer",
    "ingredients":[ Ingredient ],        // from formulary formulation (primary + actives)
    "form":"string", "outputUnit":"string|null",
    "ingredientBands":[ IngredientBand ] // caps + per-ingredient dose detail
} ] }

// RESPONSE (compute_doses.res.v1.json) — engine → AI, per drug
{ "results":[ {
    "name":"string", "ok":"boolean", "error":"string|null",
    "vol":"4.5 mL",                      // → pictogram.dose_display
    "enD":"string",                      // → row2_en  (verbatim)
    "hiD":"string (Devanagari)",         // → row3_hi  (verbatim)
    "calc":"string",                     // → medicines[].calc
    "capped":"boolean",                  // true if max-single/daily cap applied → flag + severity high
    "volumeMl":"number","volumeUnits":"number",
    "ingredientDoses":[ { "name","isPrimary","mgPerDose","mgPerDay","mgPerKg","maxExceeded","maxNote","withinRange" } ],
    "warnings":["string"]
} ] }
```
**Contract rules:** request MUST batch (one call, never per-drug); `ok:false` ⇒ the AI MUST route that drug to `omitted_medicines[]` with the engine's `error`; `capped:true` ⇒ AI sets the medicine `flag` and the server sets `severity_server='high'`; the AI may not alter `enD`/`hiD`/`vol`/`calc`.

---

## 7. C10 — `DoseEnginePort` type contract (the sealed arithmetic authority)

The pure TS port (`core/`, no DOM/IO) — verified signatures from `supabase/functions/_shared/dose-engine.ts` (745-line port). These types ARE the contract; the golden JS↔TS parity fixtures (§8) are the test gate.

```ts
interface Ingredient {            // engine-normalized (from formulary formulation)
  name: string; isPrimary: boolean; concMgPerUnit: number;
  strengthNum: number; strengthNumUnit: string; strengthDen: number; strengthDenUnit: string;
  doseMinPerKg: number|null; doseMaxPerKg: number|null;
  maxSingleMg: number|null; maxDailyMg: number|null; snomed_code?: string;
}
interface ComputeDoseParams {
  method?: "weight"|"bsa"|"fixed"|"gfr"|"infusion"|"age";
  weight?: number; bsa?: number; heightCm?: number; sliderValue?: number;
  isPerDay?: boolean; frequency?: number; ingredients?: Ingredient[];
  form?: string; outputUnit?: string; dropsPerMl?: number; ingredientBands?: IngredientBand[];
}
interface ComputeDoseResult {     // vol/enD/hiD/calc flow into the payload verbatim
  vol: string; enD: string; hiD: string; calc: string; capped: boolean; fd: string;
  volumeMl: number; volumeUnits: number; ingredientDoses: IngredientDoseDetail[]; warnings: string[];
}
// Pure exports (no side effects): computeDose, parseIngredients, makeIngredient, calculateBSA,
//   roundToUnit, isSolidForm, buildCalcString, formatDoseDisplay
// Bilingual maps (closed dictionaries): HINDI_DROPS, HINDI_ML, HINDI_TABLETS, HINDI_UNITS,
//   FREQ_EN, FREQ_HI ; const DROPS_PER_ML = 20
```

**Rounding contract (deterministic, form-specific — `roundToUnit`):**

| Form | Rounding unit | Source rule |
|------|---------------|-------------|
| Syrup / oral suspension | **0.5 mL** | round **up** for syrups (never reduce a calculated dose for "practical measurement") |
| Drops (oral/eye/nasal/ear) | **0.1 mL** | `DROPS_PER_ML = 20` |
| Tablet | **0.25 tablet** (¼) | `dose_fraction ∈ {half, quarter}` |
| Injection / vial / unit | per `outputUnit` | no silent reduction |

**Cap contract:** `max_single` and `max_daily` are HARD; on breach the engine clamps and sets `capped:true` + a `warnings[]` entry — it never emits a number above the cap. Server re-applies the same caps with **zero tolerance** (the prototype's 20% client override is rejected).

---

## 8. Validation, provenance & CI gates (how the contracts are enforced)

### 8.1 The three enforcement gates

| Gate | What runs | Failure action |
|------|-----------|----------------|
| **CI / build** | Ajv validates *every* seed file & every fixture vs its `*.v1.json`; enum closure checks (incl. §2.4 [DRIFT] normalization); `(icd10,category,severity)` dedup; formulary↔protocol referential report; golden JS↔TS dose parity fixtures (≥20 cases) | **build fails** (merge-blocker) |
| **Write time** | adapter validates payload before `INSERT`/`UPDATE` into any `jsonb` column and before returning a `get_formulary`/`get_standard_rx` tool result | reject with `error-envelope` |
| **Sign-off** | full `prescription.v1.json` + completeness reconciliation + dose byte-match | block `draft_ready → signed` |

### 8.2 Golden dose-parity fixtures (TDD gate — mandatory before trusting the engine)

The TS port ships **without** fixtures in `sprint-2-saved`; this contract closes that gap. ≥20 frozen cases asserting JS↔TS identical output across: weight-based syrup (0.5 mL round-up), drops (0.1 mL), tablet quarters, BSA path, max-single & max-daily cap clamping, combination-drug primary selection, and **bilingual string identity** (`enD`/`hiD` exact). A diff in any field fails CI — the engine is not trusted until green.

### 8.3 Generation eval gate (frozen pediatric fixture set)

A frozen suite of clinical notes evaluated each release for: dose within rounding rules, all NABH fields present (`nabh_compliant`, warning_signs ≥4 universal, allergy_note), no PII leakage in `get_previous_rx`/visit-summary boundaries, `prescription.v1.json` conformance, and the safety invariants (CS-DOSE, completeness reconciliation, allergy-stays-in-medicines). *The runner/operating model lives in `09_engineering_discipline/`; this file defines only WHAT is gated.*

### 8.4 Provenance & data-quality contract (across all datasets)

- **Verified vs placeholder:** every formulary/protocol row carries `verification_status` (`verified | placeholder | legacy`); only `verified` rows are clinical-grade. `get_formulary` may serve `placeholder` rows but stamps them so the AI flags the medicine for review.
- **Six-eye review:** changes to `verified` clinical data carry reviewer provenance (`reference_source`, `last_reviewed_date`); CI flags rows past a staleness threshold.
- **Encoding normalization (ETL contract):** the digest names em-dash mojibake (`â€"`) in the live data; the seed ETL MUST normalize to UTF-8 (em-dash `—`, en-dash `–`) and CI asserts **zero** U+FFFD / mojibake byte sequences in any seed file. *(Note: the working copies sampled this session were already clean of U+FFFD at the byte level; the contract still enforces it so a re-export cannot regress.)*
- **PII boundary:** `get_previous_rx` and visit-summary outputs are PII-stripped at a **typed boundary** (not an ad-hoc `.map`); the prescription payload sent to the model carries no patient PII beyond what clinical reasoning requires. No dataset or payload ever places PII in a SNOMED/LOINC code, a `notes` field, a log, or a URL.

---

## 9. Decisions & resolved tensions (decisive)

1. **Closed enums win over the live free-text.** `method`/`age_band`/`route`/`severity` are closed sets; the migration normalizes the **[DRIFT]** values and CI forbids regressions. A wrong/unrecognized `method` is a silent dosing hazard — non-negotiable.
2. **JSONB stays for the genuinely polymorphic** (`formulations`, `dosing_bands`, `renal_bands`, `interactions`) but is **schema-governed** — Ajv + `CHECK(jsonb_typeof = 'array')` + the §2 invariants. Polymorphism is not an excuse for un-validated data.
3. **The prescription payload has exactly one schema and one renderer.** The prototype's duplicate `printRx`/`renderRx` and divergent shapes are collapsed; `prescription.v1.json` is the sole contract.
4. **Numbers belong to the engine, narrative to the AI** — partitioned authorship (§5.1) enforced by CS-DOSE byte-diff. This is the system's central safety invariant, expressed as a data contract rather than prompt text.
5. **Terminology is FK-integral, not free-text.** Every code resolves to `catalog.concepts`; codes are validated on write. The five mapping datasets are its ETL inputs, not parallel sources of truth.
6. **Contracts are versioned & immutable.** `*.v1.json` never edited in place; breaking changes ship as `v2` with a coexistence window — the same forward-only discipline as the DDL migrations.

---

### Cross-references
- **DDL** for these `jsonb` columns & constraints → `03_data/schema_design.md` (§3 `catalog`, §6 `prescribing`).
- **ETL / normalization / cutover** for the [DRIFT] enums, mojibake, dedupe → `03_data/schema_migration.md` (§4.1, §5).
- **Dose-engine port placement & tool-loop** → `02_architecture/` (Generation context) and the `DoseEnginePort` (runtime arithmetic authority; `web/dose-engine.js` = frozen parity oracle).
- **Tool input_schema (to Claude) + condensed output (to the model)** for all 6 tools → `05_ai/tool_contracts.md`.
- **Eval/TDD runner** that executes §8.2–§8.3 gates → `09_engineering_discipline/`.
- **Source datasets** (read-only): `radhakishan_system/data/{formulary_working.json, standard_prescriptions_combined.json, loinc_*.json, snomed_*.json}`; payload schema source: `core_prompt.md` (`origin/sprint-2-saved`); engine types: `supabase/functions/_shared/dose-engine.ts` (`origin/sprint-2-saved`).
