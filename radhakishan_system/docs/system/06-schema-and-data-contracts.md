# 06 — Schema and Data Contracts

System documentation for the Supabase PostgreSQL schema and the data contracts surrounding it. Everything documented here reflects the **repository's committed DDL** as of `radhakishan_system/schema/radhakishan_supabase_schema.sql` (615 lines) plus `radhakishan_system/schema/abdm_schema.sql` (166 lines) plus `radhakishan_system/schema/migration_formulary_snomed.sql` (34 lines). The live database has drifted from these files in well-known ways — see Section 12.

---

## 1. Purpose

Define every persistent object the application reads or writes:

- 12 application tables: `formulary`, `doctors`, `standard_prescriptions`, `patients`, `visits`, `prescriptions`, `vaccinations`, `growth_records`, `lab_results`, `developmental_screenings`, `loinc_investigations`, plus 2 ABDM tables (`abdm_care_contexts`, `abdm_consent_artefacts`).
- 3 Storage buckets: `website` (skill files + web assets), `prescriptions` (text outputs), `documents` (uploaded external records).
- The clinical data contract Edge Functions and the prescription pad use to read/write these tables.
- The CHECK constraints that enforce patient-safety invariants (vital-sign ranges, UHID format, GA, BW, SpO2, etc.).
- Indexes (per repo — sparse), RLS posture, and the `update_updated_at()` trigger.

This is the single source of truth for what shape Supabase data has when it leaves Postgres for the frontend or an Edge Function.

---

## 2. Inputs

| Input | Source | Notes |
|---|---|---|
| Base DDL | `radhakishan_system/schema/radhakishan_supabase_schema.sql` | 11 tables (10 listed in DDL header + `loinc_investigations` near end), 21 indexes, 8 `update_updated_at` triggers, 9 RLS policies. |
| ABDM DDL | `radhakishan_system/schema/abdm_schema.sql` | ALTERs `patients`, `doctors`, `formulary`, `standard_prescriptions`, `lab_results`, `prescriptions`. Creates `abdm_care_contexts`, `abdm_consent_artefacts`. |
| SNOMED migration | `radhakishan_system/schema/migration_formulary_snomed.sql` | Adds `formulary.snomed_code` and `formulary.data_source` (CHECK enum). Already folded into the base DDL — kept as an idempotent migration. |
| Field-level specs | `radhakishan_system/docs/database/formulary_database_spec.md`, `formulary_fields_for_ai.md`, `standard_prescriptions_spec.md`, `SUPABASE_SCHEMA_NOTES.md` | Documents per-column intent, JSONB sub-shapes, AI condense rules. |
| Drift / contract audits | `radhakishan_system/docs/code-review/data_contract_audit.md`, `integration_audit_20260325.md` | Lists previously-known drift between live DB and committed DDL. |
| Coding system specs | `radhakishan_system/docs/formulary/snomed_database_spec.md`, `LOINC_sample_per_class.md` | SNOMED CT and LOINC code semantics that flow into JSONB columns. |

---

## 3. Outputs

The schema is consumed by:

- **Web pages** (`web/*.html`) — direct PostgREST `fetch()` calls using the anon key. Patient lookup, registration, prescription pad, prescription output (Print Station), formulary browser, standard-Rx browser, formulary import.
- **Edge Functions** — `generate-prescription` (5 tools incl. `get_formulary`, `get_standard_rx`, `get_previous_rx`, `get_lab_history`), `generate-visit-summary`, `generate-fhir-bundle` (reads visits/prescriptions/labs/vaccinations and assembles FHIR R4 Bundle, persisted to `prescriptions.fhir_bundle`), `ai-protocol-lookup`, the ABDM HIP / HIU functions which write to `abdm_care_contexts` and `abdm_consent_artefacts`.
- **Import scripts** — `import_formulary_abdm.js` (`ON CONFLICT generic_name`), `import_data.js` (legacy formulary + standard Rx), `import_snomed_diagnosis_mappings.js`, `migrate_stdpx_new_fields.sql`, `create_sample_data.js` (scrubs and reseeds 20 patients / 20 visits / 8 with past Rx).

---

## 4. Schema Conventions

- **Primary keys.** UUID v4 via `gen_random_uuid()` for synthetic IDs; human-readable IDs for `patients` (UHID `RKH-YYMM#####`), `prescriptions` (`RX-XXXXXXXX`), `doctors` (`DR-LOKENDER`).
- **Foreign keys.** All cross-table refs are `ON DELETE RESTRICT`. There is no cascading delete anywhere — clinical records are never silently removed.
- **Timestamps.** Every domain table has `created_at timestamptz default now()` and `updated_at timestamptz default now()`. `update_updated_at()` trigger fires `BEFORE UPDATE` and rewrites `NEW.updated_at = now()`.
- **JSONB shape enforcement.** All array-typed JSONB columns carry `CHECK (col is null or jsonb_typeof(col) = 'array')`. Two object-typed JSONB columns (`prescriptions.vaccinations`, `prescriptions.growth`, `prescriptions.qr_data`) carry `jsonb_typeof = 'object'`.
- **Soft delete.** `formulary.active`, `standard_prescriptions.active`, `patients.is_active`, `doctors.is_active`. Records are filtered by these flags rather than deleted.
- **Row Level Security.** Enabled on every domain table. Every table carries one policy named `authenticated_full_access` that permits all operations when `auth.role() = 'authenticated'`. POC mode — to be replaced with per-doctor policies once Supabase Auth is wired.
- **Naming.** snake_case columns; index names follow `idx_<table>_<column>` with `gin` suffix omitted (use of GIN indexes is implied by the column type, not the name).

---

## 5. Table-by-Table Reference

### 5.1 `formulary` — 530–680 drugs (per repo / per live import)

| Column | Type | Null | Default | Constraint | Intent |
|---|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK | Internal surrogate key. |
| `generic_name` | text | NN | — | UNIQUE | Primary lookup key. The Edge Function and the prescription pad cache by `UPPER(generic_name)`. |
| `snomed_code` | text | nullable | — | — | SNOMED CT concept ID for the substance. Used by FHIR bundle generator. |
| `snomed_display` | text | nullable | — | — | SNOMED preferred term. (Added by `abdm_schema.sql`; not present in the base DDL.) |
| `drug_class` | text | nullable | — | — | e.g. "Aminopenicillin antibiotic". Sent to AI for clinical context. |
| `category` | text | nullable | — | — | Therapeutic category (Infectious / Respiratory / Neurological…). |
| `brand_names` | text[] | nullable | — | — | Legacy brand-name array. Indexed via GIN for brand search; superseded by `formulations[].indian_brands[]`. |
| `therapeutic_use` | text[] | nullable | — | — | Indications. GIN-indexed. |
| `licensed_in_children` | boolean | nullable | `true` | — | AI must flag unlicensed paediatric use. |
| `unlicensed_note` | text | nullable | — | — | Free text shown alongside the unlicensed flag. |
| `data_source` | text | nullable | `'manual'` | CHECK in (`'snomed_branded'`,`'snomed_generic'`,`'orphan'`,`'manual'`) | Provenance of the row — drives whether brands and SNOMED metadata are populated. |
| `formulations` | jsonb | nullable | — | CHECK array | ABDM FHIR R4 formulation array. See spec for the full sub-shape: `form`, `form_snomed_code`, `route`, `unit_of_presentation`, `ingredients[]` (with `strength_numerator`, `strength_denominator`, `basis_of_strength`), `indian_brands[]`, `indian_conc_note`, `display_name`. |
| `dosing_bands` | jsonb | nullable | — | CHECK array | Per-indication / per-age band dosing. Carries `indication`, `age_band` (all/neonate/infant/child/adolescent/neonate-preterm), `ga_weeks_min/max`, `method` (weight/bsa/fixed/gfr/infusion/age), `dose_min_qty`/`dose_max_qty`/`dose_unit`, `is_per_day`, `frequency_per_day`, `interval_hours`, `duration_days`, `max_single_qty/unit`, `max_daily_qty/unit`, `loading_dose_qty/unit`, `rounding_rule` (`0.5ml`/`0.1ml`/`quarter_tab`/`whole_unit`/`exact`). The dose-engine's source of truth. |
| `renal_adjustment_required` | boolean | nullable | `false` | — | Gate flag for renal logic. |
| `renal_bands` | jsonb | nullable | — | CHECK array | GFR-tiered actions (`reduce_dose`/`extend_interval`/`reduce_and_extend`/`avoid`/`no_adjustment`). |
| `hepatic_adjustment_required` | boolean | nullable | `false` | — | Gate flag for hepatic logic. |
| `hepatic_note` | text | nullable | — | — | Free-text hepatic guidance. |
| `black_box_warnings` | text[] | nullable | — | — | AI must surface prominently. |
| `contraindications` | text[] | nullable | — | — | Hard contraindications (allergy, condition). |
| `cross_reactions` | text[] | nullable | — | — | e.g. "Penicillin → cephalosporins". |
| `interactions` | jsonb | nullable | — | CHECK array, GIN-indexed | `{drug_or_class, severity ∈ {black_box,major,moderate,minor}, effect}`. Schema comment uses `drug` but the loaded data uses `drug_or_class`. |
| `monitoring_parameters` | text[] | nullable | — | — | Monitoring requirements (`CBC`, `LFT`...). |
| `pediatric_specific_warnings` | text[] | nullable | — | — | Paediatric-only safety notes. |
| `administration` | jsonb | nullable | — | CHECK array | Per-route reconstitution / dilution / infusion-rate / compatibility / route-specific storage. |
| `food_instructions` | text | nullable | — | — | "Take with food", etc. — printed on Rx. |
| `storage_instructions` | text | nullable | — | — | Pharmacy-side storage; not shown to patient. |
| `pregnancy_category` | text | nullable | — | — | Not used in paediatric flow. |
| `lactation_safe` | text | nullable | — | — | Not used in paediatric flow. |
| `lactation_note` | text | nullable | — | — | Not used. |
| `reference_source` | text[] | nullable | — | — | Provenance of clinical recommendations. |
| `last_reviewed_date` | date | nullable | — | — | Internal review tracking. |
| `notes` | text | nullable | — | — | Generic clinical notes; passed to AI. |
| `active` | boolean | nullable | `true` | — | Soft-delete flag. All Edge Function lookups append `active=eq.true`. |
| `created_at` / `updated_at` | timestamptz | nullable | `now()` | trigger `trg_formulary_updated` | — |

**Indexes (per repo):** `idx_formulary_cat (category)`, `idx_formulary_active (active)`, `idx_formulary_brands (brand_names GIN)`, `idx_formulary_use (therapeutic_use GIN)`, `idx_formulary_interactions (interactions GIN)`, `idx_formulary_dosing (dosing_bands GIN)`, `idx_formulary_snomed (snomed_code) WHERE snomed_code IS NOT NULL`, `idx_formulary_datasource (data_source)`. UNIQUE on `generic_name` is implicit from the column constraint.

**RLS:** enabled, single `authenticated_full_access` policy.

**Trigger:** `trg_formulary_updated BEFORE UPDATE … update_updated_at()`.

### 5.2 `doctors` — credentials reference

| Column | Type | Null | Default | Intent |
|---|---|---|---|---|
| `id` | text | NN | — | PK. e.g. `'DR-LOKENDER'`. Free-text in POC; will become FK target once Supabase Auth doctor logins are added. |
| `full_name` | text | NN | — | Printed on prescriptions. |
| `degree` | text | nullable | — | "MD Pediatrics (PGI Chandigarh)" — printed under signature. |
| `registration_no` | text | nullable | — | "HMC HN 21452 / PMC 23168" — regulatory ID. |
| `specialisation` | text | nullable | — | — |
| `contact_phone` | text | nullable | — | — |
| `is_active` | boolean | nullable | `true` | — |
| `hpr_id` | text | nullable | — | Health Professional Registry ID (added by `abdm_schema.sql`). Required for ABDM HIP signing. |
| `created_at` | timestamptz | nullable | `now()` | — |

**Seed:** one row — `('DR-LOKENDER', 'Dr. Lokender Goyal', 'MD Pediatrics (PGI Chandigarh)', 'HMC HN 21452 / PMC 23168', 'Pediatrics & Neonatology')`.

**No index, no RLS, no trigger** in repo. (Yes — `doctors` is the only domain table without RLS in the committed DDL.)

### 5.3 `standard_prescriptions` — ICD-10-keyed protocols (~24–446 rows)

| Column | Type | Null | Default | Constraint | Intent |
|---|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK | — |
| `icd10` | text | nullable | — | NOT unique | Same code may appear under different categories or severities (J18.9 Pneumonia under Respiratory vs Neonatology). Primary lookup key for the AI. |
| `diagnosis_name` | text | NN | — | — | "Common Cold / Acute Rhinopharyngitis". Fallback lookup. |
| `category` | text | nullable | — | — | One of 16 valid categories validated by `ai-protocol-lookup`. |
| `severity` | text | nullable | `'any'` | — | mild/moderate/severe/any. |
| `first_line_drugs` | jsonb | nullable | — | CHECK array | `{drug, notes, is_new_2024_2025}` (data) vs `{drug, dose_qty, dose_unit, dose_basis…}` (schema comment). The lighter shape is what's loaded. |
| `second_line_drugs` | jsonb | nullable | — | CHECK array | Same shape, used for alternatives. |
| `investigations` | jsonb | nullable | — | CHECK array | `{name, indication, urgency ∈ {same-day, routine}}`. |
| `duration_days_default` | integer | nullable | — | — | Default treatment duration. |
| `counselling` | text[] | nullable | — | — | Parent counselling lines; AI translates to Hindi at print. |
| `warning_signs` | jsonb | nullable | — | CHECK array | English strings; AI translates to Hindi. Danger signs requiring same-day attention. |
| `referral_criteria` | text | nullable | — | — | Specialist-referral guidance. |
| `hospitalisation_criteria` | text | nullable | — | — | Admission triggers. |
| `expected_course` | text | nullable | — | — | Natural history (e.g. "Fever 2–3d, cough 5–7d"). Added via `migrate_stdpx_new_fields.sql`. |
| `key_clinical_points` | text[] | nullable | — | — | Pearls for the doctor. Added via migration. |
| `severity_assessment` | jsonb | nullable | — | — | `{mild, moderate, severe}`. Added via migration. |
| `monitoring_parameters` | jsonb | nullable | — | — | `[{parameter, frequency}, …]`. Added via migration. |
| `notes` | text | nullable | — | — | General management guidance. |
| `source` | text | nullable | — | — | Guideline references (IAP, WHO, ACCP). |
| `guideline_changes` | text | nullable | — | — | Recent updates to call out. |
| `last_reviewed_date` | date | nullable | — | — | — |
| `snomed_code` | text | nullable | — | — | SNOMED CT diagnosis concept (added by `abdm_schema.sql`). Required for ABDM FHIR Conditions. |
| `active` | boolean | nullable | `true` | — | Soft-delete flag. |
| `created_at` / `updated_at` | timestamptz | nullable | `now()` | trigger `trg_stdpx_updated` | — |

**Note:** `snomed_display` exists only in the source JSON (data file), not as a DB column.

**Indexes (per repo):** `idx_stdpx_icd10`, `idx_stdpx_icd10_partial (icd10) WHERE icd10 IS NOT NULL`, `idx_stdpx_name (diagnosis_name)`, `idx_stdpx_cat (category)`, `idx_stdpx_active (active)`.

**RLS:** enabled, `authenticated_full_access`.

### 5.4 `patients` — demographics + UHID

| Column | Type | Null | Default | Constraint | Intent |
|---|---|---|---|---|---|
| `id` | text | NN | — | PK; CHECK `id ~ '^RKH-\d{11}$'` | UHID format `RKH-YYMM#####` (11 trailing digits = YYMM + 5-digit serial). Indian financial year encoding. |
| `name` | text | NN | — | — | Full name. |
| `dob` | date | nullable | — | — | Drives age-band selection in dosing. |
| `sex` | text | nullable | — | CHECK in (`Male`,`Female`,`Other`) | Used for growth Z-scores. |
| `guardian_name` | text | nullable | — | — | Printed on prescription. |
| `guardian_relation` | text | nullable | — | — | Father/Mother/Other. |
| `contact_phone` | text | nullable | — | — | Used for SMS/notifications (future). |
| `blood_group` | text | nullable | — | CHECK in (A+/A-/B+/B-/AB+/AB-/O+/O-/Unknown) | Safety field for emergencies. |
| `known_allergies` | text[] | nullable | — | — | Sent to AI on every prescription generation; cross-checked against drug `cross_reactions`. **Patient-safety critical.** |
| `gestational_age_weeks` | numeric | nullable | — | CHECK between 22 and 44 | Preterm classification (<37). |
| `birth_weight_kg` | numeric | nullable | — | CHECK between 0.3 and 6.0 | LBW (<2.5) classification. |
| `is_active` | boolean | nullable | `true` | — | Soft-delete flag. |
| `abha_number` | text | nullable | — | UNIQUE INDEX where not null | 14-digit ABHA ID (added by `abdm_schema.sql`). |
| `abha_address` | text | nullable | — | — | "patient@abdm". |
| `abha_verified` | boolean | nullable | `false` | — | OTP verification status. |
| `abha_linking_token` | text | nullable | — | — | 24-hour ABDM token. |
| `abha_linked_at` | timestamptz | nullable | — | — | When the link was established. |
| `created_at` / `updated_at` | timestamptz | nullable | `now()` | trigger `trg_patients_updated` | — |

**Indexes (per repo):** `idx_patients_name`, `idx_patients_active`, plus the partial unique `idx_patients_abha (abha_number) WHERE abha_number IS NOT NULL`.

**RLS:** enabled, `authenticated_full_access`.

### 5.5 `visits` — per-encounter vitals + clinical state

| Column | Type | Null | Default | Constraint | Intent |
|---|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK | — |
| `patient_id` | text | **NN** | — | FK → `patients(id)` ON DELETE RESTRICT | Every visit must have a patient. |
| `visit_date` | date | NN | `current_date` | — | OPD encounter date. |
| `doctor_id` | text | nullable | — | FK → `doctors(id)` | — |
| `weight_kg` | numeric | nullable | — | CHECK 0.3..200 | Anthropometry. Drives weight-based dosing. |
| `height_cm` | numeric | nullable | — | CHECK 20..220 | — |
| `hc_cm` | numeric | nullable | — | CHECK 15..60 | Head circumference. |
| `muac_cm` | numeric | nullable | — | CHECK 5..30 | Mid-upper-arm circumference (SAM/MAM screen). |
| `temp_f` | numeric | nullable | — | CHECK 90..108 | Fahrenheit. |
| `hr_per_min` | integer | nullable | — | CHECK 30..300 | Heart rate. |
| `rr_per_min` | integer | nullable | — | CHECK 5..120 | Respiratory rate. |
| `spo2_pct` | numeric | nullable | — | CHECK 50..100 | Oxygen saturation. |
| `bp_systolic` | integer | nullable | — | CHECK 30..250 | Added during data-contract drift fixes. |
| `bp_diastolic` | integer | nullable | — | CHECK 15..150 | — |
| `map_mmhg` | numeric | nullable | — | CHECK 20..200 | Mean arterial pressure. |
| `bmi` | numeric | nullable | — | — | Computed at registration. |
| `vax_schedule` | text | nullable | — | CHECK in (`nhm`,`iap`) | Selected vaccination schedule for this visit (mutually exclusive). |
| `receipt_no` | text | nullable | — | — | Sequential billing receipt `RKH-RCT-YYMMDD-NNN`. |
| `chief_complaints` | text | nullable | — | — | Reception entry. |
| `diagnosis_codes` | jsonb | nullable | — | CHECK array | `[{icd10, name, type ∈ {provisional, final}}]`. |
| `clinical_notes` | text | nullable | — | — | Doctor's structured note. |
| `triage_score` | integer | nullable | — | CHECK 0..15 | Acuity scoring. |
| `raw_dictation` | text | nullable | — | — | Auto-saved doctor's dictation (debounced, see CLAUDE.md). Separate from cleaned `clinical_notes`. |
| `visit_summary` | text | nullable | — | — | AI-generated summary of prior visits, populated by `generate-visit-summary` for returning patients. |
| `attached_documents` | jsonb | nullable | — | — | Metadata for documents uploaded to the `documents` bucket. |
| `consultation_fee` | numeric | nullable | `0` | — | Billing. |
| `payment_mode` | text | nullable | `'cash'` | CHECK in (`cash`,`upi`,`card`,`insurance`,`free`) | — |
| `payment_status` | text | nullable | `'pending'` | CHECK in (`pending`,`paid`,`waived`) | — |
| `procedures` | jsonb | nullable | — | — | `[{name, charge, payMode, status, receiptNo}]`. |
| `created_at` / `updated_at` | timestamptz | nullable | `now()` | trigger `trg_visits_updated` | — |

**Indexes (per repo):** `idx_visits_patient (patient_id)`, `idx_visits_date (visit_date)`, `idx_visits_patient_date (patient_id, visit_date desc)`.

**RLS:** enabled, `authenticated_full_access`.

### 5.6 `prescriptions` — generated Rx + approval

| Column | Type | Null | Default | Constraint | Intent |
|---|---|---|---|---|---|
| `id` | text | NN | — | PK; format `RX-XXXXXXXX` | Human-readable Rx ID. |
| `visit_id` | uuid | **NN** | — | FK → `visits(id)` ON DELETE RESTRICT | Every Rx ties to a visit. |
| `patient_id` | text | **NN** | — | FK → `patients(id)` ON DELETE RESTRICT | **Denormalised** (also reachable via `visit_id`). Kept for query performance; consistency is application-level. |
| `generated_json` | jsonb | NN | — | — | Full AI output. Source of truth for re-render in Print Station. |
| `medicines` | jsonb | nullable | — | CHECK array | Extracted medicines for fast filter. |
| `investigations` | jsonb | nullable | — | CHECK array | Extracted investigations. |
| `vaccinations` | jsonb | nullable | — | CHECK object | `{given_today, previously_given, …}` snapshot. |
| `growth` | jsonb | nullable | — | CHECK object | Z-score snapshot. |
| `approved_by` | text | nullable | — | — | Doctor ID at sign-off. |
| `approved_at` | timestamptz | nullable | — | — | Sign-off timestamp. |
| `is_approved` | boolean | nullable | `false` | — | Print Station filters on this. |
| `pdf_url` | text | nullable | — | — | Storage URL of the rendered text/PDF. |
| `qr_data` | jsonb | nullable | — | CHECK object | Minimal re-registration payload — `{rx_id, uhid, pt_name, date, dx_codes, hash}`. |
| `version` | integer | nullable | `1` | — | Edit-after-approval versioning. |
| `edit_notes` | text | nullable | — | — | Reason for the edit. |
| `fhir_bundle` | jsonb | nullable | — | — | ABDM FHIR R4 Bundle (added by `abdm_schema.sql`). |
| `created_at` / `updated_at` | timestamptz | nullable | `now()` | trigger `trg_prescriptions_updated` | — |

**Indexes (per repo):** `idx_rx_patient`, `idx_rx_visit`, `idx_rx_approved (is_approved)`, `idx_rx_date (created_at)`.

**RLS:** enabled, `authenticated_full_access`.

### 5.7 `vaccinations` — IAP 2024 + NHM-UIP history

| Column | Type | Null | Default | Constraint | Intent |
|---|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK | — |
| `patient_id` | text | NN | — | FK → `patients(id)` ON DELETE RESTRICT | — |
| `vaccine_name` | text | NN | — | — | Standardised name (BCG, OPV, IPV, DPT, …). |
| `dose_number` | integer | nullable | — | — | 1/2/3/booster. |
| `date_given` | date | nullable | — | — | — |
| `next_due_date` | date | nullable | — | — | Drives the "due" / "overdue" UI. |
| `batch_number` | text | nullable | — | — | Cold-chain audit. |
| `given_by` | text | nullable | — | — | Doctor / nurse name. |
| `visit_id` | uuid | nullable | — | FK → `visits(id)` (no ON DELETE clause) | Optional link to the encounter. |
| `free_or_paid` | text | nullable | — | CHECK in (`free_uip`,`paid`) | Haryana: PCV + Rotavirus free, no JE. |
| `route` | text | nullable | — | — | IM/SC/Oral/ID. |
| `site` | text | nullable | — | — | Anatomical site. |
| `created_at` / `updated_at` | timestamptz | nullable | `now()` | trigger `trg_vaccinations_updated` | — |

**Indexes (per repo):** `idx_vax_patient`, `idx_vax_due (next_due_date)`, `idx_vax_patient_name (patient_id, vaccine_name)`.

**RLS:** enabled, `authenticated_full_access`.

### 5.8 `growth_records` — WHO Z-scores

| Column | Type | Null | Default | Intent |
|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `patient_id` | text | NN | — | FK → `patients(id)` ON DELETE RESTRICT |
| `visit_id` | uuid | nullable | — | FK → `visits(id)` |
| `recorded_date` | date | nullable | `current_date` | — |
| `weight_kg` / `height_cm` / `hc_cm` / `muac_cm` | numeric | nullable | — | Same anthropometry as visits — denormalised at sign-off for trend queries. |
| `waz` / `haz` / `whz` / `hcaz` | numeric | nullable | — | Z-scores. WAZ=weight-for-age, HAZ=height-for-age, WHZ=weight-for-height, HCAZ=head-circ-for-age. |
| `chart_used` | text | nullable | — | `WHO2006` / `IAP2015` / `Fenton2013`. **Fenton2013 is the preterm chart**; switched on automatically when GA<37w. |
| `classification` | text | nullable | — | `Well nourished` / `MAM` / `SAM` / `Underweight` / `Stunted`. |
| `created_at` / `updated_at` | timestamptz | nullable | `now()` | trigger `trg_growth_records_updated` |

**Indexes (per repo):** `idx_growth_patient`, `idx_growth_patient_date (patient_id, recorded_date desc)`.

**RLS:** enabled, `authenticated_full_access`. **No CHECK constraints on the anthropometry columns** in this table (unlike `visits`).

### 5.9 `lab_results` — structured investigations

| Column | Type | Null | Default | Constraint | Intent |
|---|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK | — |
| `patient_id` | text | NN | — | FK → `patients(id)` ON DELETE RESTRICT | — |
| `visit_id` | uuid | nullable | — | FK → `visits(id)` | — |
| `test_name` | text | NN | — | — | Free text or COMMON_LABS canonical name. |
| `test_category` | text | nullable | — | — | One of `Hematology` / `Biochemistry` / `Microbiology` / `Imaging`. |
| `value` | text | NN | — | — | Stored as text to permit qualitative results. |
| `value_numeric` | numeric | nullable | — | — | Parsed numeric for trend graphs. |
| `unit` | text | nullable | — | — | mg/dL, g/dL, /µL, etc. |
| `reference_range` | text | nullable | — | — | Display string. |
| `flag` | text | nullable | — | CHECK in (`normal`,`low`,`high`,`critical`,`abnormal`) | Auto-flagged at registration; consumed by `get_lab_history` tool. |
| `test_date` | date | NN | `current_date` | — | — |
| `lab_name` | text | nullable | — | — | External lab provenance. |
| `source` | text | nullable | `'manual'` | CHECK in (`manual`,`ai_extracted`,`upload`) | How the row was created. |
| `notes` | text | nullable | — | — | — |
| `loinc_code` | text | nullable | — | — | Added by `abdm_schema.sql`. Drives FHIR Observation. |
| `snomed_code` | text | nullable | — | — | Added by `abdm_schema.sql`. For non-LOINC observations. |
| `created_at` / `updated_at` | timestamptz | nullable | `now()` | — | **No `update_updated_at` trigger declared in repo for `lab_results`.** |

**Indexes (per repo):** `idx_lab_patient`, `idx_lab_patient_date (patient_id, test_date desc)`, `idx_lab_test (test_name)`.

**RLS:** **NOT enabled in the committed DDL** for `lab_results`. (See Section 12.)

### 5.10 `developmental_screenings`

| Column | Type | Null | Default | Intent |
|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `patient_id` | text | NN | — | FK → `patients(id)` ON DELETE RESTRICT |
| `visit_id` | uuid | nullable | — | FK → `visits(id)` |
| `screening_date` | date | nullable | `current_date` | — |
| `tool_used` | text | nullable | — | `TDSC` / `DDST-II` / `M-CHAT-R` / `HINE` / `ASQ` / `LEST` / `IAP Card`. |
| `gross_motor` / `fine_motor` / `language` / `social` / `cognitive` | text | nullable | — | Per-domain finding. |
| `overall_result` | text | nullable | — | `Normal` / `Suspect` / `Delayed` / `At risk`. |
| `red_flags` | text[] | nullable | — | e.g. `{'No social smile by 3mo'}`. |
| `referral_needed` | boolean | nullable | `false` | — |
| `referral_to` | text | nullable | — | `Developmental Pediatrician` / `Speech Therapy` / `Neurology`. |
| `notes` | text | nullable | — | — |
| `created_at` / `updated_at` | timestamptz | nullable | `now()` | trigger `trg_devscreenings_updated` |

**Indexes (per repo):** `idx_devscreen_patient`, `idx_devscreen_date (patient_id, screening_date desc)`.

**RLS:** enabled, `authenticated_full_access`.

### 5.11 `loinc_investigations` — LOINC v2.82 reference

`CREATE TABLE IF NOT EXISTS` — keyed by `loinc_code` (UNIQUE). Carries `component`, `long_name`, `short_name`, `display_name`, `consumer_name`, `class`, `class_type`, `system_specimen`, `property`, `scale`, `method`, `example_units`, `example_ucum_units`, `order_obs`, `related_names`, `common_test_rank`, `common_order_rank`, `created_at`. Only `created_at` (no `updated_at`).

**No indexes declared in repo** beyond the implicit unique on `loinc_code`. **RLS enabled**, `authenticated_full_access`.

### 5.12 `abdm_care_contexts`

Each row represents a linkable health-record unit (typically a visit + its prescription) shareable to ABDM via the HIP.

| Column | Type | Null | Default | Constraint | Intent |
|---|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK | — |
| `patient_id` | text | NN | — | FK → `patients(id)` ON DELETE RESTRICT | — |
| `visit_id` | uuid | nullable | — | FK → `visits(id)` | — |
| `prescription_id` | text | nullable | — | FK → `prescriptions(id)` | — |
| `care_context_ref` | text | NN | — | — | Unique reference sent to ABDM, e.g. `RKH-CC-<uuid>`. |
| `display_text` | text | NN | — | — | Human label (e.g. "OPD Visit – 17 Mar 2026"). |
| `record_types` | text[] | NN | — | — | e.g. `{'OPConsultation','Prescription'}`. |
| `linked` | boolean | nullable | `false` | — | Has the context been confirmed linked at the gateway? |
| `linked_at` | timestamptz | nullable | — | — | — |
| `created_at` / `updated_at` | timestamptz | nullable | `now()` | trigger `trg_abdm_care_contexts_updated` | — |

**Indexes (per repo):** `idx_abdm_cc_patient`, `idx_abdm_cc_ref`. **RLS enabled.**

### 5.13 `abdm_consent_artefacts`

| Column | Type | Null | Default | Constraint | Intent |
|---|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK | — |
| `consent_id` | text | NN | — | UNIQUE | ABDM consent artefact ID. |
| `patient_id` | text | nullable | — | FK → `patients(id)` ON DELETE RESTRICT | — |
| `requester_name` | text | nullable | — | — | Whom the patient is sharing with. |
| `purpose` | text | nullable | — | — | `CAREMGT` / `BTG` / `PUBHLTH` / etc. |
| `hi_types` | text[] | nullable | — | — | `{'OPConsultation','Prescription'}`. |
| `date_range_from` / `date_range_to` | timestamptz | nullable | — | — | Period of records authorised. |
| `expiry` | timestamptz | nullable | — | — | When this artefact stops being valid. |
| `status` | text | nullable | `'REQUESTED'` | CHECK in (`REQUESTED`,`GRANTED`,`DENIED`,`REVOKED`,`EXPIRED`) | State machine. |
| `artefact_json` | jsonb | nullable | — | — | Full ABDM consent artefact as received. |
| `created_at` / `updated_at` | timestamptz | nullable | `now()` | trigger `trg_abdm_consent_artefacts_updated` | — |

**Indexes (per repo):** `idx_abdm_consent_patient`, `idx_abdm_consent_id`, `idx_abdm_consent_status`. **RLS enabled.**

---

## 6. Storage Buckets

| Bucket | Visibility | Layout | Used By |
|---|---|---|---|
| `website` | public | `skill/` (core_prompt + 11 references), web pages, `prompts/` | `generate-prescription` (loads `core_prompt.md` + on-demand references), `ai-protocol-lookup` (`skill/protocol_lookup_prompt.md`). |
| `prescriptions` | public | `{patient_id}/{rx_id}.txt` | Sign-off writes a text snapshot; future upgrade to PDF. |
| `documents` | public | `{patient_id}/<filename>` | External record uploads from registration. |

---

## 7. Relationship Map

```
patients (id: RKH-YYMM#####)
   │
   ├──< visits.patient_id        (RESTRICT)
   │     │
   │     ├──< prescriptions.visit_id   (RESTRICT)        <─── prescriptions.patient_id (RESTRICT, denormalised)
   │     ├──< vaccinations.visit_id    (no FK action)
   │     ├──< growth_records.visit_id  (no FK action)
   │     ├──< lab_results.visit_id     (no FK action)
   │     ├──< developmental_screenings.visit_id
   │     └──< abdm_care_contexts.visit_id
   │
   ├──< vaccinations.patient_id            (RESTRICT)
   ├──< growth_records.patient_id          (RESTRICT)
   ├──< lab_results.patient_id             (RESTRICT)
   ├──< developmental_screenings.patient_id (RESTRICT)
   ├──< abdm_care_contexts.patient_id      (RESTRICT)
   └──< abdm_consent_artefacts.patient_id  (RESTRICT)

doctors (id: 'DR-LOKENDER')
   └──< visits.doctor_id                   (no ON DELETE clause)

prescriptions (id: 'RX-XXXXXXXX')
   └──< abdm_care_contexts.prescription_id (no ON DELETE clause)

formulary, standard_prescriptions, loinc_investigations
   - Reference tables. No incoming FKs. Cross-referenced softly:
     standard_prescriptions.first_line_drugs[].drug ↔ formulary.generic_name
     lab_results.loinc_code ↔ loinc_investigations.loinc_code
```

All FKs that exist in the repo use `ON DELETE RESTRICT`. The `visit_id` FKs on `vaccinations`, `growth_records`, `lab_results`, `developmental_screenings`, `abdm_care_contexts`, plus `abdm_care_contexts.prescription_id` and `visits.doctor_id`, do **not** carry an explicit `ON DELETE` clause — they default to `NO ACTION`, which fails the same way `RESTRICT` does in practice.

---

## 8. CHECK Constraints — Patient-Safety Inventory

CHECK constraints encode invariants the database enforces regardless of application code. Every one of these blocks a class of clinical error:

| Table | Constraint | Safety guarantee |
|---|---|---|
| `formulary` | `data_source ∈ {snomed_branded,snomed_generic,orphan,manual}` | Provenance always known — AI can decide whether to trust brand/SNOMED metadata. |
| `formulary` | `formulations`/`dosing_bands`/`renal_bands`/`interactions`/`administration` are JSONB **arrays** if not null | Malformed JSONB cannot poison the dose engine. |
| `standard_prescriptions` | Same JSONB array shape constraints on `first_line_drugs`, `second_line_drugs`, `investigations`, `warning_signs` | Protocols always parse into iterable arrays. |
| `patients` | `id ~ '^RKH-\d{11}$'` | UHID format is structural — typos produce hard rejects, not orphan rows. |
| `patients` | `sex ∈ {Male,Female,Other}` | Growth Z-score charts always pick a known curve. |
| `patients` | `blood_group ∈ {A+,A-,B+,B-,AB+,AB-,O+,O-,Unknown}` | Free-text "B positive" cannot leak into emergency lookups. |
| `patients` | `gestational_age_weeks BETWEEN 22 AND 44` | Plausibility check — extreme prematurity (<22w) is not survivable; ≥44w is biologically impossible. Forces explicit data review. |
| `patients` | `birth_weight_kg BETWEEN 0.3 AND 6.0` | Below 300 g and above 6 kg are typos. Forces re-entry. |
| `visits` | `weight_kg BETWEEN 0.3 AND 200` | Catches 0/empty/decimal-error weights; prevents weight-based dosing from blowing up. |
| `visits` | `height_cm BETWEEN 20 AND 220` | Plausibility for paediatric range (and adolescent extreme). |
| `visits` | `hc_cm BETWEEN 15 AND 60` | Head circumference plausibility. |
| `visits` | `muac_cm BETWEEN 5 AND 30` | MUAC plausibility — also keeps SAM threshold (<11.5 cm) detectable. |
| `visits` | `temp_f BETWEEN 90 AND 108` | Hypothermia / lethal hyperthermia bounds. |
| `visits` | `hr_per_min BETWEEN 30 AND 300` | Bradycardia / tachycardia bounds. |
| `visits` | `rr_per_min BETWEEN 5 AND 120` | Apnoea / extreme tachypnoea bounds. |
| `visits` | `spo2_pct BETWEEN 50 AND 100` | Below 50% is unrecoverable; above 100% is impossible. |
| `visits` | `bp_systolic BETWEEN 30 AND 250`, `bp_diastolic BETWEEN 15 AND 150`, `map_mmhg BETWEEN 20 AND 200` | Plausibility envelopes for paediatric BP. |
| `visits` | `triage_score BETWEEN 0 AND 15` | Acuity scale boundaries. |
| `visits` | `vax_schedule ∈ {nhm,iap}` | Forces mutual exclusivity — the prescription pad must commit to one schedule. |
| `visits` | `payment_mode ∈ {cash,upi,card,insurance,free}`, `payment_status ∈ {pending,paid,waived}` | Billing state hygiene. |
| `prescriptions` | `medicines`/`investigations` are JSONB **arrays**; `vaccinations`/`growth`/`qr_data` are JSONB **objects** | Print Station and FHIR generator can rely on the shape — no defensive type-checks needed. |
| `vaccinations` | `free_or_paid ∈ {free_uip,paid}` | Haryana subsidy classification cannot drift. |
| `lab_results` | `flag ∈ {normal,low,high,critical,abnormal}`, `source ∈ {manual,ai_extracted,upload}` | The `flag` set drives `get_lab_history` (Edge Function tool); its closed enum prevents the AI from hallucinating new flag values. |
| `abdm_consent_artefacts` | `status ∈ {REQUESTED,GRANTED,DENIED,REVOKED,EXPIRED}` | ABDM consent state machine is enforced at the database. |

---

## 9. Indexes (per repo)

The committed DDL declares **~21 indexes** (excluding implicit indexes on PK / UNIQUE columns). Listed by table:

- `formulary` (8): cat, active, brand_names GIN, therapeutic_use GIN, interactions GIN, dosing_bands GIN, snomed_code (partial WHERE NOT NULL), data_source.
- `standard_prescriptions` (5): icd10, icd10 partial (WHERE NOT NULL), name, cat, active.
- `patients` (3): name, active, abha_number partial unique (WHERE NOT NULL).
- `visits` (3): patient_id, date, (patient_id, date desc).
- `prescriptions` (4): patient, visit, approved, created_at.
- `vaccinations` (3): patient, due, (patient, vaccine_name).
- `growth_records` (2): patient, (patient, date desc).
- `lab_results` (3): patient, (patient, test_date desc), test_name.
- `developmental_screenings` (2): patient, (patient, screening_date desc).
- `abdm_care_contexts` (2), `abdm_consent_artefacts` (3).
- `doctors`, `loinc_investigations`: none beyond PK / unique.

This is a deliberately sparse set tuned for the dominant query patterns (lookup by patient, lookup by ICD-10, lookup by drug name, sort by visit/test/screening date desc). The live database has many more — see Section 12.

---

## 10. RLS Posture

| Table | RLS enabled? | Policy |
|---|---|---|
| `formulary` | yes | `authenticated_full_access` |
| `standard_prescriptions` | yes | `authenticated_full_access` |
| `patients` | yes | `authenticated_full_access` |
| `visits` | yes | `authenticated_full_access` |
| `prescriptions` | yes | `authenticated_full_access` |
| `vaccinations` | yes | `authenticated_full_access` |
| `growth_records` | yes | `authenticated_full_access` |
| `developmental_screenings` | yes | `authenticated_full_access` |
| `loinc_investigations` | yes | `authenticated_full_access` |
| `abdm_care_contexts` | yes | `authenticated_full_access` |
| `abdm_consent_artefacts` | yes | `authenticated_full_access` |
| `doctors` | **NOT in committed DDL** | — |
| `lab_results` | **NOT in committed DDL** | — |

Every enabled policy is `for all using (auth.role() = 'authenticated')`. POC posture — the comment in the DDL flags that this becomes per-doctor in production. The web pages today use the **anon** key, so policies are effectively bypass-once-anon-allowed unless the live database enforces a stricter policy (it does — see Section 12).

---

## 11. Triggers and Functions

One PL/pgSQL function:

```
update_updated_at()  →  NEW.updated_at = now(); RETURN NEW
```

Bound `BEFORE UPDATE FOR EACH ROW` on:

- `formulary` (`trg_formulary_updated`)
- `standard_prescriptions` (`trg_stdpx_updated`)
- `patients` (`trg_patients_updated`)
- `prescriptions` (`trg_prescriptions_updated`)
- `visits` (`trg_visits_updated`)
- `vaccinations` (`trg_vaccinations_updated`)
- `growth_records` (`trg_growth_records_updated`)
- `developmental_screenings` (`trg_devscreenings_updated`)
- `abdm_care_contexts` (`trg_abdm_care_contexts_updated`)
- `abdm_consent_artefacts` (`trg_abdm_consent_artefacts_updated`)

Tables **without** an `updated_at` trigger in the committed DDL: `doctors`, `lab_results`, `loinc_investigations`. (`doctors` and `loinc_investigations` make sense — reference tables. `lab_results` having no trigger is likely an oversight; the column exists with `default now()`.)

---

## 12. Surprises / Drift

This documentation describes the **repository** schema. The live Supabase database has drifted in known ways. Anyone working from this doc against the live DB should expect:

1. **Index count is ~25× higher live.** The repo declares ~21 indexes; the live database carries ~50. Most of the extra indexes are for FHIR / ABDM query performance and growth-curve queries added since the last DDL commit. **Do not assume an index does not exist just because the repo lacks it.** Pull live `pg_indexes` if performance work depends on it.
2. **`loinc_investigations` lives in production but is not in the repo's `radhakishan_supabase_schema.sql` DDL header comment.** The table itself *is* declared inside the file (lines 505–526) and its RLS + policy are present, but the closing comment block says "10 tables created" and lists 11. Treat the table as authoritatively present.
3. **`doctors` has no RLS in the repo** but the live DB does (the project's RLS audit added it). Same goes for `lab_results`. If you write a PR to add RLS to either, expect the live policy to already exist.
4. **`lab_results` is missing its `update_updated_at` trigger** in the committed DDL. The column exists; the live DB has the trigger.
5. **Schema drift previously documented and fixed** (`data_contract_audit.md`): `bp_systolic`, `bp_diastolic`, `map_mmhg`, `bmi`, `vax_schedule`, `receipt_no`, `consultation_fee`, `payment_mode`, `payment_status`, `procedures` were all added live before being added to the committed DDL. They are now in both.
6. **Data row counts disagree across docs.** `formulary_database_spec.md` reports 680 rows (454 snomed_branded + 158 snomed_generic + 68 orphan); `CLAUDE.md` says 530; `standard_prescriptions_spec.md` says 24 protocols; `CLAUDE.md` says 446. Both are right at different points in the project — the live DB at any moment may match either.
7. **`prescriptions.patient_id` is denormalised.** It must equal `(SELECT patient_id FROM visits WHERE id = prescriptions.visit_id)`. There is no DB-level constraint enforcing this — it is enforced at the application layer (sign-off code). Any backfill / migration script must preserve this invariant manually.
8. **`first_line_drugs[].drug` ↔ `formulary.generic_name`** is a **soft reference** with no FK. Some standard-prescription entries deliberately point at non-formulary entities (e.g. "Oxygen Therapy", "Nasal Suction", "Cough Management (Honey + Warm Fluids)"). Lookups must tolerate misses.
9. **`formulary.dosing_bands[].interactions` schema/data mismatch.** The DDL comment writes interaction entries as `{drug, severity, effect}` but the loaded data uses `{drug_or_class, severity, effect}`. The condense-for-AI helper preserves whichever key is present.
10. **No `ON DELETE` clause on several FKs.** `vaccinations.visit_id`, `growth_records.visit_id`, `lab_results.visit_id`, `developmental_screenings.visit_id`, `abdm_care_contexts.visit_id`, `abdm_care_contexts.prescription_id`, `visits.doctor_id` all default to `NO ACTION`. This is functionally `RESTRICT` in single-statement transactions but differs in deferred constraints. Be explicit if a future migration changes deletion behaviour.
11. **Storage bucket policies are not in the schema files.** The three buckets (`website`, `prescriptions`, `documents`) are configured in the Supabase dashboard; their policies (today: anon read/write for the POC) live outside this repo.
12. **CHECK constraints on `growth_records` measurements are absent** even though the same fields on `visits` are bounded. A garbage `weight_kg` written to `growth_records` will be accepted; the bound is only enforced at the visit-write step. If you ever populate `growth_records` from an external import, validate manually.

---

## 13. How to Extend Safely

When adding a column or table:

1. Write the change as a new file in `radhakishan_system/schema/` (`migration_<scope>_<change>.sql`), idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, etc.). Do **not** edit the historical base or ABDM files in place — they are the canonical "from-zero" recreate scripts.
2. Mirror the column into the relevant per-table spec file under `radhakishan_system/docs/database/`.
3. If the column carries patient-safety meaning (a vital range, an allowed-value set, an FK to a patient row), add a CHECK constraint and document the safety guarantee in Section 8 of this doc.
4. Run the migration via `npx supabase db query --linked -f <file.sql>`.
5. Update the relevant Edge Function SELECT lists (`generate-prescription/index.ts`, `generate-fhir-bundle`) and the prescription-pad `preloadKnowledge()` query if AI / UI need the new field.
6. Re-run `data_contract_audit.md` mentally: clinical note → Edge Function → tools → renderReview → printRx → signOff → Print Station — does the new field flow all the way through, and is it RLS-safe?

When dropping or renaming a column: don't, in the live DB, without coordinating a freeze window. ON DELETE RESTRICT means a botched migration cannot silently destroy clinical history, but it also means migrations that try to delete dependent rows fail loudly mid-transaction.

---

## 14. References

- `radhakishan_system/schema/radhakishan_supabase_schema.sql` — base DDL (615 lines).
- `radhakishan_system/schema/abdm_schema.sql` — ABDM extension DDL (166 lines).
- `radhakishan_system/schema/migration_formulary_snomed.sql` — SNOMED migration (folded into base DDL; idempotent).
- `radhakishan_system/docs/database/formulary_database_spec.md` — per-column intent + JSONB sub-shapes for `formulary`.
- `radhakishan_system/docs/database/formulary_fields_for_ai.md` — which fields the Edge Function condenses before sending to Claude.
- `radhakishan_system/docs/database/standard_prescriptions_spec.md` — per-column intent + JSONB sub-shapes for `standard_prescriptions`.
- `radhakishan_system/docs/database/SUPABASE_SCHEMA_NOTES.md` — older quick-reference (pre-ABDM shape; some JSONB examples now superseded by FHIR-aligned form).
- `radhakishan_system/docs/code-review/data_contract_audit.md` — frontend ↔ DB ↔ AI contract pass list (March 2026).
- `radhakishan_system/docs/code-review/integration_audit_20260325.md` — full E2E audit (PRODUCTION READY).
- `radhakishan_system/docs/formulary/snomed_database_spec.md` — RF2 file format, India Drug Extension quirks, PRES unit-swap workaround, extraction pipeline.
- `radhakishan_system/docs/formulary/LOINC_sample_per_class.md` — LOINC class samples that drive `lab_results.loinc_code` and `loinc_investigations` (large file; not summarised here).
- Sibling system docs in `radhakishan_system/docs/system/` cover the Edge Functions, prescription pad, registration page, and Print Station that consume this schema.
