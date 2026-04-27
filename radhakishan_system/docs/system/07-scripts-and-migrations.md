# 07 — Scripts and Migrations

> Permanent system documentation for the contents of `radhakishan_system/scripts/`.
> Covers all 33 files (28 `.js` + 5 `.sql`) under that directory as of 2026-04-27.
> Read-only audit; nothing in this doc was executed.

---

## 1. Purpose

`radhakishan_system/scripts/` is the **operator toolbox** for the Radhakishan
Hospital pediatric OPD system. Unlike `web/` (the live app) and
`supabase/functions/` (the live Edge Functions), nothing here runs on a
schedule or is invoked by the application at request time. Every file in
this directory is a one-shot CLI utility that an operator runs from their
workstation against the live Supabase project (`ecywxuqhnlkjtdshpcbc`) or
against the local JSON data files in `radhakishan_system/data/`.

The directory exists to:

1. **Bootstrap and refresh reference data.** Import 530+ drugs, 446+ ICD-10
   protocols, LOINC v2.82 lab catalog, and SNOMED-CT India Drug Extension
   mappings into Supabase.
2. **Apply schema migrations** that have been added to the live DB after the
   base DDL was committed. (See §9 — these are not tracked anywhere.)
3. **Enrich and validate** drug/diagnosis JSON files (SNOMED brand
   validation, dosing-band injection, unit-fixing, formulary comparison).
4. **Seed sample data** for staging/demo (`create_sample_data.js`).
5. **Smoke-test** the live system end-to-end (`integration_test.js`).
6. **Upload skill files** to Supabase Storage so the Edge Function can read
   them at runtime.

These are operator workflows, not product features. None of them have a UI;
all are run with `node <script>.js` or `npx supabase db query --linked -f
<file.sql>`.

---

## 2. Architecture / Layout

All scripts live flat in `radhakishan_system/scripts/`. There are no
sub-directories. Conventions:

- **Node version**: scripts assume Node 18+ (`fetch` is global, no
  `node-fetch` import).
- **Auth**: most scripts hard-code the Supabase URL and either the **anon
  key** (older scripts: `import_formulary_2.js`, `import_loinc.js`,
  `import_snomed_mappings.js`, `import_snomed_diagnosis_mappings.js`,
  `integration_test.js`) or read `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  from `.env` at repo root (newer scripts: `import_data.js`,
  `import_formulary_abdm.js`, `upload_skill_files.js`,
  `create_sample_data.js`). The hard-coded anon key is the same JWT shipped
  in every web page, so it is not secret in this codebase, but
  RLS is permissive (`anon_full_access`), so anon-key writes succeed.
- **Working dir**: scripts are designed to be run from the repo root, e.g.
  `node radhakishan_system/scripts/import_data.js`. A few SNOMED scripts
  contain hard-coded absolute Windows paths to a local SNOMED RF2 release
  under `E:/AI-Enabled HMIS/SNOMED/...` — they only run on the maintainer's
  workstation (see §9).
- **Idempotency**: all `import_*` scripts use Supabase's
  `Prefer: resolution=merge-duplicates` upsert pattern or check-then-insert
  by unique key, so re-running is safe.

Logical groupings used in this doc:

| Group                       | Scripts                                                                                                                                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data import                 | `import_data.js`, `import_formulary_2.js`, `import_formulary_abdm.js`, `import_loinc.js`, `import_snomed_mappings.js`, `import_snomed_diagnosis_mappings.js`                                                                                                                                  |
| Schema migrations (SQL)     | `migrate_add_columns.sql`, `migrate_stdpx_new_fields.sql`, `migrate_warning_signs.sql`                                                                                                                                                                                                        |
| Schema migrations (JS)      | `migrate_dosing_bands.js`                                                                                                                                                                                                                                                                     |
| SNOMED extraction & rebuild | `snomed_rebuild.js`, `snomed_full_extract.js`, `snomed_fetch_all_formulations.js`, `snomed_emergency_drugs_extract.js`, `snomed_iv_fluids_extract.js`, `snomed_reextract_v2.js`, `snomed_reextract_v3.js`, `snomed_enrich.js`, `snomed_brand_validator.js`, `snomed_brand_cleanup.js`          |
| Mapping builders            | `build_snomed_mappings.js`                                                                                                                                                                                                                                                                    |
| Dosing-band population      | `populate_dosing_bands.js`, `inject_batch3_dosing.js`, `apply_agent_updates.js`                                                                                                                                                                                                               |
| Validation / comparison     | `validate_standard_rx.js`, `compare_formularies.js`, `_fix_units.js`                                                                                                                                                                                                                          |
| Combination                 | `combine_standard_rx.js`                                                                                                                                                                                                                                                                      |
| Sample data                 | `create_sample_data.js`                                                                                                                                                                                                                                                                       |
| Integration test            | `integration_test.js`                                                                                                                                                                                                                                                                         |
| Storage upload              | `upload_skill_files.js`                                                                                                                                                                                                                                                                       |
| DB diagnostics (SQL)        | `check_lab_constraints.sql`, `check_lab_id.sql`                                                                                                                                                                                                                                               |

> **Files referenced in the original R7 brief but NOT present** in this
> commit: `diagnose_io.sql`, `run_diagnose2.sh`,
> `export_standard_rx_*.js`, `calc_levetiracetam_8_7kg.js`, `snomed_enrich.js`
> is present, but no `_8_7kg` calculator. The git log shows commits
> `148aa12 chore(diag): add Supabase Disk-IO diagnostic harness` and
> `74abd2f feat(dose): Levetiracetam dose-engine verification script` —
> those scripts may live in another worktree slice or have been moved.
> Flagged in §9.

---

## 3. Data flow

The scripts form a **one-way pipeline from local JSON → live Supabase**:

```
SNOMED RF2 release (E:\AI-Enabled HMIS\SNOMED\…)
   │  snomed_rebuild.js / snomed_full_extract.js / snomed_*_extract.js
   │  snomed_reextract_v2 → v3 / snomed_enrich.js / _fix_units.js
   ▼
radhakishan_system/data/formulary_data_ABDM_FHIR{,_generics,_orphans}.json
   │  migrate_dosing_bands.js          (band-level → ingredient_doses[])
   │  populate_dosing_bands.js         (BNFC/IAP source-of-truth bands)
   │  inject_batch3_dosing.js          (merge _batch3_dosing_bands.json)
   │  apply_agent_updates.js           (agent-supplied secondary doses)
   ▼
radhakishan_system/data/  (JSON, source of truth at rest)
   │  import_formulary_abdm.js / import_data.js / import_formulary_2.js
   │  import_loinc.js / import_snomed_mappings.js / import_snomed_diagnosis_mappings.js
   ▼
Supabase (live)
   formulary, standard_prescriptions, loinc_investigations, ...
```

Sample-data and skill-upload paths run independently:

```
create_sample_data.js  →  patients + visits + prescriptions + lab_results + vaccinations
upload_skill_files.js  →  Storage `website` bucket, `skill/` prefix
integration_test.js    →  reads/writes test rows under RKH-00000099999, then deletes
```

SQL migrations are **applied directly** to the live DB by the operator with
`npx supabase db query --linked -f <file>`; there is no migration tracking.

---

## 4. Inputs and outputs

### 4.1 Data import (Node)

| Script                                | Reads                                                                                                                              | Writes (HTTP target)                                                                                                                            | Notes                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `import_data.js`                      | `data/formulary_data.json`, `data/standard_prescriptions_data.json`                                                                | `formulary` (insert/PATCH), `standard_prescriptions` (insert/PATCH)                                                                             | Original importer. Check-then-insert by `generic_name` and `(diagnosis_name, icd10)`.       |
| `import_formulary_2.js`               | `data/formulary_data_2.json` (122 newer drugs)                                                                                     | `formulary` upsert via `Prefer: resolution=merge-duplicates`                                                                                    | Anon key hard-coded.                                                                        |
| `import_formulary_abdm.js`            | `data/formulary_data_ABDM_FHIR.json` (`snomed_branded`), `_generics.json` (`snomed_generic`), `_orphans.json` (`orphan`)           | `formulary` upsert with `data_source` tag, batches of 50; falls back to one-by-one on batch error                                               | Maps every JSON field listed in §6.1; reads `.env`.                                         |
| `import_loinc.js`                     | `C:/Users/gandh/Downloads/RADHAKISHAN HOSPITAL/Loinc_2.82/.../Loinc.csv`                                                           | `loinc_investigations` (batches of 100, `resolution=ignore-duplicates`)                                                                         | Filters out `SURVEY.*`, `ATTACH.*`, `PHENX`, `CLIN.VET`, `CLINTRIAL`, `MEPS`, `NR STATS`.   |
| `import_snomed_mappings.js`           | `data/snomed_drug_mappings.json`                                                                                                   | `formulary` PATCH (`snomed_code`, `snomed_display`) by `generic_name=ilike.<n>`                                                                 | Idempotent; logs every drug.                                                                |
| `import_snomed_diagnosis_mappings.js` | `data/snomed_diagnosis_mappings.json`                                                                                              | `standard_prescriptions` PATCH (`snomed_code`) by row id; batches of 10 in parallel                                                             | Skips entries with `snomed_code === null`.                                                  |

### 4.2 Schema migrations (SQL)

| Script                          | Target table              | Columns added                                                                                                                                     |
| ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrate_add_columns.sql`       | `visits`                  | `bmi numeric`, `vax_schedule text CHECK (nhm/iap)`, `receipt_no text`, `consultation_fee numeric DEFAULT 0`, `payment_mode text DEFAULT 'cash'`, `payment_status text DEFAULT 'pending'`, `procedures jsonb` |
| `migrate_stdpx_new_fields.sql`  | `standard_prescriptions`  | `expected_course text`, `key_clinical_points text[]`, `severity_assessment jsonb`, `monitoring_parameters jsonb`                                  |
| `migrate_warning_signs.sql`     | `standard_prescriptions`  | `warning_signs jsonb`                                                                                                                             |

All three use `ADD COLUMN IF NOT EXISTS` so they are idempotent. Apply with
`npx supabase db query --linked -f radhakishan_system/scripts/<file>.sql`.

### 4.3 Schema migration (Node, JSON-only)

`migrate_dosing_bands.js` does **not** touch the DB. It reads the three
ABDM-FHIR formulary files and rewrites each `dosing_bands[]` entry to the
new per-ingredient shape: band-level fields `dose_min_qty`, `dose_max_qty`,
`dose_unit`, `dose_basis`, `max_single_qty`, `max_single_unit`,
`max_daily_qty`, `max_daily_unit`, `dose_reference_ingredient` move into a
new `band.ingredient_doses[]` array; band-level retains `indication`,
`age_band`, `method`, `frequency_per_day`, `interval_hours`,
`duration_days`, `rounding_rule`, `notes`, etc. Output goes to
`*_v3.json` files for review before replacing originals.

### 4.4 SNOMED extraction / enrichment

All SNOMED scripts share the same loader pattern: read tab-delimited
`sct2_Description_Snapshot-en_*.txt` (fully-specified names + preferred
terms), `sct2_Relationship_Snapshot_*.txt` (IS-A + attribute relationships
incl. type IDs `116680003` IS-A, `762949000`/`127489000` HAS_INGREDIENT,
`774159003` HAS_SUPPLIER, `411116001` HAS_DOSE_FORM, `763032000`
HAS_UNIT_OF_PRESENTATION, `774158006` HAS_TRADE_NAME, `732943007`
HAS_BASIS_OF_STRENGTH_SUBSTANCE), and
`sct2_RelationshipConcreteValues_Snapshot_*.txt` (numeric strength values:
`1142135004` PRES_NUM_VAL, `1142136003` PRES_DEN_VAL, `1142137007`
CONC_NUM_VAL, `1142138002` CONC_DEN_VAL; with unit refs `733722007`
PRES_NUM_UNIT, `732945000` PRES_DEN_UNIT, `733725009` CONC_NUM_UNIT,
`732947008` CONC_DEN_UNIT).

| Script                              | Reads                                                                                                                  | Writes (file)                                                                                                                                  | Purpose                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `snomed_rebuild.js`                 | `data/formulary_working.json`, India + Intl SNOMED RF2                                                                 | `formulary_data_ABDM_FHIR.json`, `_generics.json`, `_orphans.json`                                                                             | 7-phase complete rebuild: validate codes, brand-match unmatched, generic-name fallback, full extraction, classify, append IV/emergency. |
| `snomed_full_extract.js`            | India RF2 + `formulary_data_ABDM_FHIR.json`                                                                            | `formulary_data_ABDM_FHIR.json` (overwrite)                                                                                                    | For each generic with a SNOMED code, find all branded children → build `formulations[]` with `indian_brands[]`.                      |
| `snomed_fetch_all_formulations.js`  | India + Intl RF2 + branded + generics formulary files                                                                  | `formulary_data_ABDM_FHIR{,_generics}.json`                                                                                                    | Reverse-index ingredient → all Clinical Drugs; **append** missing formulations without removing existing ones.                       |
| `snomed_emergency_drugs_extract.js` | India RF2                                                                                                              | `formulary_data_ABDM_FHIR.json` (append)                                                                                                        | Adds 25 hard-coded emergency/anaesthesia drugs (dopamine, epinephrine, ketamine, etc.) by regex search on FSNs.                      |
| `snomed_iv_fluids_extract.js`       | India + Intl RF2                                                                                                       | `formulary_data_ABDM_FHIR.json` (append)                                                                                                        | NS, DNS, dextrose, KCl, NaHCO3, Ca-gluconate, MgSO4, mannitol, water-for-injection, albumin, gelatin, HES.                           |
| `snomed_reextract_v2.js`            | India RF2 + ABDM-FHIR files                                                                                            | `*_v2.json`                                                                                                                                    | Fixes SNOMED India unit bugs (CONC vs PRES units), filters mono-only formulations onto single-ingredient drugs.                      |
| `snomed_reextract_v3.js`            | India + Intl RF2 + `*_v2.json`                                                                                         | `*_v2.json` (in place)                                                                                                                          | Loads International edition relationships too, re-runs extraction only for drugs that have zero SNOMED-sourced formulations.         |
| `snomed_enrich.js`                  | India + Intl RF2 + ABDM-FHIR files                                                                                     | Same files (or `_enriched_preview_*` with `--dry-run`)                                                                                          | Adds `unit_of_presentation`, `generic_clinical_drug_code`, `trade_name`, `brand_family`, `basis_of_strength` to each entry.          |
| `snomed_brand_validator.js`         | India RF2 + `formulary_data_ABDM_FHIR.json`                                                                            | `data/_brand_mismatches_v2.json`                                                                                                                | Reports brand→generic mismatches between our data and SNOMED India branded FSNs.                                                     |
| `snomed_brand_cleanup.js`           | India RF2 + `formulary_data_ABDM_FHIR.json`                                                                            | `formulary_data_ABDM_FHIR.json` + `_brand_mismatches.json`                                                                                      | Phase 1: validate brands; Phase 2: pull all SNOMED brands per generic into `formulations[].indian_brands[]`.                         |
| `_fix_units.js`                     | All three ABDM-FHIR JSON files                                                                                         | Same files (in place)                                                                                                                          | Normalizes unit names (`milligram`→`mg`, etc.) and detects/swaps inverted numerator/denominator (mL/mg → mg/mL).                     |

### 4.5 Mapping builders

| Script                       | Reads                                                                            | Writes                                                                |
| ---------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `build_snomed_mappings.js`   | `_temp_rows.json` (DB query export), an in-script ICD-10→SNOMED lookup table     | `data/snomed_diagnosis_mappings.json` (consumed by `import_snomed_diagnosis_mappings.js`) |

### 4.6 Dosing bands

| Script                       | Reads                                                                         | Writes                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `populate_dosing_bands.js`   | (script-internal `DOSING_DB` constant — BNFC 2025-26, IAP 2024, WHO, Nelson, Harriet Lane) | All three ABDM-FHIR formulary JSON files (in place); 143 drugs (Batch 1 — Infectious + Resp + Allergy). |
| `inject_batch3_dosing.js`    | `data/_batch3_dosing_bands.json`                                              | All three ABDM-FHIR formulary files (in place); skips drugs that already have bands.                |
| `apply_agent_updates.js`     | (script-internal `allUpdates` array from Agents 1, 2, 4)                      | `data/formulary_data_ABDM_FHIR_v3.json` (in place); only fills `ingredient_doses[]` rows where `source` is null. |

### 4.7 Validation, combination, comparison

| Script                       | Reads                                                                                            | Writes                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `validate_standard_rx.js`    | `standard_prescriptions_data.json`, `_data_new.json`, all three formulary JSON files             | Patches drug-name mismatches in the two standard-Rx files (Acetaminophen→Paracetamol, Albuterol→Salbutamol, route-suffix stripping, etc.); reports unresolved + non-drug items. |
| `combine_standard_rx.js`     | `standard_prescriptions_data.json`, `_data_new.json`, `docs/Standard Diagnosis/*.json` (55 files) | `data/standard_prescriptions_combined.json` — 470+ protocols with merged enriched fields. |
| `compare_formularies.js`     | DB drug list (hard-coded as `dbDrugs[]`) vs JSON formulary files                                 | stdout report (no file write).                                                        |

### 4.8 Sample data, integration, storage upload

| Script                       | Behaviour                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create_sample_data.js`      | Auto-scrubs `prescriptions`, `vaccinations`, `growth_records`, `lab_results`, `developmental_screenings`, `visits`, `patients`; reseeds 20 patients, 20 visits, past-Rx history for 8.    |
| `integration_test.js`        | 16-test live smoke test (patients + visits + lab_results + vaccinations + growth_records + formulary structural checks + standard_rx + Edge Function `generate-prescription` + `get_lab_history`). Uses `RKH-00000099999` test patient and `INTEGRATION-TEST-` name prefix; cleans up after itself. |
| `upload_skill_files.js`      | Recursively uploads every `*.md` under `radhakishan_system/skill/` to Storage bucket `website` under prefix `skill/` (`x-upsert: true`). Verifies public read of `skill/core_prompt.md`. |

### 4.9 Diagnostic SQL

| Script                       | What it does                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `check_lab_constraints.sql`  | `SELECT conname, pg_get_constraintdef(...)` for all CHECK constraints on `lab_results`.                     |
| `check_lab_id.sql`           | Returns `column_name`, `data_type`, `column_default` for `lab_results.id`.                                  |

These are one-liners for ad-hoc DB inspection; they are run via
`npx supabase db query --linked -f <file>`.

---

## 5. Persistence

Scripts persist to three places:

1. **Local JSON** under `radhakishan_system/data/` — every SNOMED extractor
   and dosing-band script overwrites these files in place. There is no
   versioning beyond git; review-suffixed files (`*_v2.json`, `*_v3.json`,
   `_enriched_preview_*.json`, `_brand_mismatches*.json`) are temporary
   review artifacts that are eventually replaced by their unsuffixed
   counterparts.
2. **Supabase tables** (`formulary`, `standard_prescriptions`,
   `loinc_investigations`, `patients`, `visits`, `prescriptions`,
   `lab_results`, `vaccinations`, `growth_records`,
   `developmental_screenings`) via the REST API.
3. **Supabase Storage** bucket `website` under prefix `skill/` (only
   `upload_skill_files.js`).

No script writes to `prescriptions/` or `documents/` Storage buckets — those
are populated at runtime by the Edge Function and registration page
respectively.

---

## 6. APIs and contracts

### 6.1 Drug row contract (consumed by `import_formulary_abdm.js`)

The script maps each input JSON drug to a row with these columns
(`toRow()`):

```
generic_name, snomed_code, drug_class, category, brand_names[], therapeutic_use[],
licensed_in_children, unlicensed_note, data_source, formulations[], dosing_bands[],
renal_adjustment_required, renal_bands[], hepatic_adjustment_required, hepatic_note,
black_box_warnings[], contraindications[], cross_reactions[], interactions[],
monitoring_parameters[], pediatric_specific_warnings[], administration[],
food_instructions, storage_instructions, pregnancy_category, lactation_safe,
lactation_note, reference_source[], last_reviewed_date, active
```

Upsert key is `generic_name` (Supabase `on_conflict=generic_name`,
`Prefer: resolution=merge-duplicates`). The
`formulary` table must therefore have a UNIQUE constraint on `generic_name`
(it does — see CLAUDE.md).

### 6.2 Standard prescription contract (consumed by `combine_standard_rx.js`)

```
icd10, diagnosis_name, category, severity, first_line_drugs[], second_line_drugs[],
investigations[], counselling[], warning_signs[], referral_criteria,
hospitalisation_criteria, notes, source, duration_days_default, guideline_changes,
snomed_code, snomed_display, expected_course, key_clinical_points,
severity_assessment, monitoring_parameters, active
```

Merge precedence: enriched `docs/Standard Diagnosis/*.json` (55) >
`standard_prescriptions_data_new.json` (24) >
`standard_prescriptions_data.json` (446). Dedup key is uppercase
`icd10 || diagnosis_name`; secondary fuzzy match on diagnosis-name prefix.

### 6.3 LOINC row contract

`import_loinc.js` writes:

```
loinc_code (PK), component, long_name, short_name, display_name, consumer_name,
class, class_type, system_specimen (normalized: Bld→Blood, Ser/Plas→Serum/Plasma…),
property, scale, method, example_units, example_ucum_units, order_obs,
related_names, common_test_rank, common_order_rank, active
```

Filter: `STATUS == 'ACTIVE'` and class not in survey/claims/veterinary/research
list.

### 6.4 SNOMED concept ID glossary (used across all SNOMED scripts)

| Type ID                  | Meaning                                          |
| ------------------------ | ------------------------------------------------ |
| `900000000000003001`     | Fully-specified name (FSN)                       |
| `900000000000013009`     | Preferred term                                   |
| `116680003`              | IS-A                                             |
| `762949000`, `127489000` | HAS_INGREDIENT (active / precise)                |
| `774159003`              | HAS_SUPPLIER (manufacturer)                      |
| `774158006`              | HAS_TRADE_NAME                                   |
| `411116001`              | HAS_DOSE_FORM                                    |
| `763032000`              | HAS_UNIT_OF_PRESENTATION                         |
| `732943007`              | HAS_BASIS_OF_STRENGTH_SUBSTANCE                  |
| `1142135004 / 1142136003`| PRES_NUM_VAL / PRES_DEN_VAL                      |
| `1142137007 / 1142138002`| CONC_NUM_VAL / CONC_DEN_VAL                      |
| `733722007 / 732945000`  | PRES_NUM_UNIT / PRES_DEN_UNIT                    |
| `733725009 / 732947008`  | CONC_NUM_UNIT / CONC_DEN_UNIT                    |

### 6.5 Edge-Function smoke test (`integration_test.js`)

Calls `POST {SB}/functions/v1/generate-prescription` with a minimal visit
fixture; verifies HTTP 200 and JSON shape (`medications[]`, `safety_check`,
etc.). No mocks — test runs against the live Edge Function and live DB.

---

## 7. Configuration / environment

| Variable                          | Used by                                                                                                             | Default if unset                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `SUPABASE_URL`                    | `import_data.js`, `import_formulary_abdm.js`, `upload_skill_files.js`, `create_sample_data.js`                      | Hard-coded `https://ecywxuqhnlkjtdshpcbc.supabase.co` (only `create_sample_data.js`) |
| `SUPABASE_SERVICE_ROLE_KEY`       | Same set                                                                                                            | None — script aborts                                                          |
| `SUPABASE_ANON_KEY`               | `create_sample_data.js` (fallback)                                                                                  | None                                                                          |
| (hard-coded anon key)             | `import_formulary_2.js`, `import_loinc.js`, `import_snomed_mappings.js`, `import_snomed_diagnosis_mappings.js`, `integration_test.js` | n/a                                                                           |

`.env` is read from `radhakishan_system/scripts/../../.env` (i.e. repo
root). Format: simple `KEY=VALUE` lines, no quoting, comments start with
`#`. The `.env` file is gitignored (per `57ef9f0` "Add .env credentials
file, .gitignore, remove hardcoded keys").

SNOMED scripts hard-code Windows paths:

```
E:\AI-Enabled HMIS\SNOMED\SnomedCT_IndiaDrugExtensionRF2_PRODUCTION_IN1000189_20260313T120000Z\…\Snapshot\Terminology\
E:\AI-Enabled HMIS\SNOMED\SnomedCT_InternationalRF2_PRODUCTION_20260301T120000Z\…\Snapshot\Terminology\
```

LOINC import hard-codes:

```
C:/Users/gandh/Downloads/RADHAKISHAN HOSPITAL/Loinc_2.82/Loinc_2.82/LoincTable/Loinc.csv
```

These paths are unique to the maintainer's workstation. To run on another
machine, edit the `BASE`/`INDIA_BASE`/`INT_BASE`/`LOINC_CSV` constants at the
top of the file.

---

## 8. Operations / runbook

### 8.1 First-time bootstrap (cold start of new Supabase project)

```
1. Create project + apply base DDL:
   npx supabase db query --linked -f radhakishan_system/schema/radhakishan_supabase_schema.sql
   npx supabase db query --linked -f radhakishan_system/schema/abdm_schema.sql

2. Apply post-base column additions (idempotent):
   npx supabase db query --linked -f radhakishan_system/scripts/migrate_add_columns.sql
   npx supabase db query --linked -f radhakishan_system/scripts/migrate_stdpx_new_fields.sql
   npx supabase db query --linked -f radhakishan_system/scripts/migrate_warning_signs.sql

3. Import reference data:
   node radhakishan_system/scripts/import_formulary_abdm.js   # 679 drugs (3 files)
   node radhakishan_system/scripts/import_data.js             # original formulary + standard Rx
   node radhakishan_system/scripts/import_formulary_2.js      # +122 drugs
   node radhakishan_system/scripts/import_loinc.js            # ~50k LOINC rows after filtering
   node radhakishan_system/scripts/import_snomed_mappings.js  # PATCH formulary.snomed_code
   node radhakishan_system/scripts/import_snomed_diagnosis_mappings.js  # PATCH standard_prescriptions.snomed_code

4. Upload skill files to Storage:
   node radhakishan_system/scripts/upload_skill_files.js

5. (Optional) Seed sample patients/visits:
   node radhakishan_system/scripts/create_sample_data.js
```

### 8.2 Refresh formulary from new SNOMED release

```
1. Download new RF2 release, update INDIA_BASE / INT_BASE constants in scripts.
2. node radhakishan_system/scripts/snomed_rebuild.js
3. Spot-check with: node radhakishan_system/scripts/snomed_brand_validator.js
4. node radhakishan_system/scripts/_fix_units.js
5. node radhakishan_system/scripts/snomed_enrich.js --dry-run   # review previews
6. node radhakishan_system/scripts/snomed_enrich.js             # write for real
7. node radhakishan_system/scripts/import_formulary_abdm.js     # push to live DB
```

### 8.3 Daily smoke test

```
node radhakishan_system/scripts/integration_test.js
# Expect: 137/137 PASS (per commit 26c68d0)
```

### 8.4 Validate stored prescription data after a guideline update

```
node radhakishan_system/scripts/validate_standard_rx.js
# Reports drug-name fixes applied + remaining unresolved + non-drug items.
```

---

## 9. Known fragility / gotchas

> ### 9.1 Schema migrations are not tracked (CRITICAL)
>
> The three `migrate_*.sql` files are applied to the live DB by the
> operator running `npx supabase db query --linked -f <file>`. Supabase's
> CLI **does not record this** — there is no `supabase_migrations.schema_migrations`
> row, no `migration_id`, no idempotency tracking beyond
> `IF NOT EXISTS`. Consequences:
>
> - **No way to know which migrations have been applied** to the live DB
>   without manually inspecting `information_schema.columns`.
> - **No rollback mechanism.** Each file is forward-only; no `DOWN` script.
> - **The base schema files** (`radhakishan_system/schema/radhakishan_supabase_schema.sql`,
>   `abdm_schema.sql`) **drift from production.** The live `visits` table
>   has the columns added by `migrate_add_columns.sql` (`bmi`, `vax_schedule`,
>   `receipt_no`, `consultation_fee`, `payment_mode`, `payment_status`,
>   `procedures`); the base DDL doesn't. A clean re-bootstrap from the base
>   DDL alone will produce a structurally-different DB.
> - **No CI gate** prevents the schema in `radhakishan_system/schema/` from
>   diverging further. The only ground-truth is the live Supabase project.
>
> **Recommendation for future work**: introduce `supabase migration new`
> workflow or commit a `current_schema_dump.sql` regenerated weekly via
> `pg_dump --schema-only`.

### 9.2 Hard-coded local paths in SNOMED scripts

`snomed_rebuild.js`, `snomed_full_extract.js`,
`snomed_emergency_drugs_extract.js`, `snomed_iv_fluids_extract.js`,
`snomed_fetch_all_formulations.js`, `snomed_reextract_v{2,3}.js`,
`snomed_enrich.js`, `snomed_brand_validator.js`,
`snomed_brand_cleanup.js`, and `import_loinc.js` all reference Windows
absolute paths that exist only on the maintainer's machine. Re-running on
any other host requires editing constants at the top of each file.

### 9.3 Hard-coded credentials in older scripts

`import_formulary_2.js`, `import_loinc.js`,
`import_snomed_mappings.js`, `import_snomed_diagnosis_mappings.js`, and
`integration_test.js` ship with the Supabase anon JWT inline. This key is
also embedded in every web page in `web/` so it is not strictly secret, but
**rotating the anon key is a multi-file edit** — the `web/` HTML files,
these scripts, the Edge Function fallbacks, etc.

### 9.4 SNOMED India unit-swap bug

SNOMED India RF2 (March 2026 release) ships with swapped numerator/
denominator units for some liquid formulations: `PRES_NUM_UNIT` says
`mL` when it should be `mg`, and `PRES_DEN_UNIT` says `mg` when it
should be `mL`. `_fix_units.js` and `snomed_reextract_v2.js` work
around this by preferring CONC unit refs and falling back to the formulation's
`UNIT_OF_PRESENTATION`. Any newer RF2 release should be re-validated against
the cross-check in `snomed_reextract_v2.js` (`KNOWN` map: Paracetamol,
Amoxicillin, Ibuprofen, Azithromycin, Cetirizine).

### 9.5 Sample data is destructive

`create_sample_data.js` calls
`DELETE FROM <table> WHERE id IS NOT NULL` against `prescriptions`,
`vaccinations`, `growth_records`, `lab_results`, `developmental_screenings`,
`visits`, and `patients` **before reseeding**. **Never run this against
production data.** It is intended for the staging Supabase project only;
the script does not check which project it is connecting to.

### 9.6 Integration test pollutes briefly

`integration_test.js` writes test rows tagged with patient id
`RKH-00000099999` and name prefix `INTEGRATION-TEST-`. It cleans them up at
the end but if interrupted mid-run, those rows persist. A safe re-run
deletes them on test 1's setup phase.

### 9.7 Files referenced in R7 brief but missing in this slice

The R7 dispatch brief mentioned `diagnose_io.sql`, `run_diagnose2.sh`,
`export_standard_rx_*.js`, and `calc_levetiracetam_8_7kg.js`. The git log
on `feat/dis-plan` shows commits `148aa12 chore(diag): add Supabase Disk-IO
diagnostic harness` and `74abd2f feat(dose): Levetiracetam dose-engine
verification script`, but those files are not present in
`radhakishan_system/scripts/` on the worktree branch as of this audit. They
likely live in another worktree slice or the repo root. **Action**:
re-locate when you next rebase onto `feat/dis-plan`.

### 9.8 `data_source` column relies on `import_formulary_abdm.js`

The three-way classification (`snomed_branded`, `snomed_generic`, `orphan`)
is set only by `import_formulary_abdm.js`. `import_formulary_2.js`
and `import_data.js` do not write `data_source`, so drugs imported via
those paths will have `data_source = NULL` and may be hidden by views or
queries that filter on it.

### 9.9 Multiple SNOMED rebuilders, no clear successor relationship

`snomed_full_extract.js` → `snomed_fetch_all_formulations.js` →
`snomed_reextract_v2.js` → `snomed_reextract_v3.js` →
`snomed_rebuild.js` represent successive generations of the same
extraction logic. There is no explicit deprecation; running an older
version after a newer one will overwrite improvements. **Use
`snomed_rebuild.js` for full rebuilds, `snomed_fetch_all_formulations.js`
for incremental top-up, and treat the `_v2`/`_v3` scripts as historical.**

---

## 10. Tests

| Layer                  | Test                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Live integration       | `integration_test.js` — 16 tests, last reported 137/137 PASS (commit `26c68d0`).                          |
| Cross-check (SNOMED)   | `snomed_reextract_v2.js` includes a `KNOWN` map of expected concentrations for 5 reference drugs and prints ✅/❌ per formulation. |
| Brand validation       | `snomed_brand_validator.js` reports validated/correct/mismatched/notFound counts.                          |
| Drug-name consistency  | `validate_standard_rx.js` reports `Match rate %` after applying fixes.                                     |

There are **no unit tests, no Jest, no Mocha, no ESLint config** for these
scripts. Every check is a stdout report.

---

## 11. Security and privacy

- **Anon-key writes are unrestricted** because the live RLS policy
  `anon_full_access` permits all CRUD for the anon role (per CLAUDE.md POC
  posture). Any of these scripts could in principle wipe production tables.
  Mitigation: `create_sample_data.js` is the only intentionally destructive
  script and it is gated by env vars; the rest are insert/upsert/PATCH only.
- **Service-role key** is required for `import_data.js`,
  `import_formulary_abdm.js`, `upload_skill_files.js`, and
  `create_sample_data.js`. It must remain in `.env` only and is never
  hard-coded in scripts.
- **PII**: `create_sample_data.js` and `integration_test.js` use synthetic
  names (`Arjun Kumar`, `Test Guardian`, etc.). The integration test is
  scoped to a single fixed patient id.
- **SNOMED licence**: India Drug Extension is shipped under SNOMED
  International's affiliate agreement with India. The RF2 release files are
  not in the repo (they live on the operator's workstation under
  `E:\AI-Enabled HMIS\SNOMED\…`); only derived JSON ends up under
  `radhakishan_system/data/`.
- **LOINC licence**: Free-of-charge with attribution. The `LICENSE.txt`
  shipped with the LOINC release is not in the repo; the operator must keep
  it locally.

---

## 12. Performance

- `snomed_rebuild.js` and similar full-rebuild scripts read **all three
  RF2 snapshot files** into memory (descriptions, relationships, concrete
  values). On the maintainer's box the load takes 5-10 seconds and uses
  ~500-800 MB RSS. Not a concern at this volume.
- `import_loinc.js` processes ~100k LOINC rows; with the
  `EXCLUDE_PREFIXES` filter and 100-row batches, the live import takes
  under 2 minutes against Supabase.
- `import_formulary_abdm.js` upserts in batches of 50 with a single-row
  fallback on batch failure. Total time for 679 drugs is ~30 seconds.
- `integration_test.js` makes ~30 round trips to Supabase + 1 Edge
  Function call; total runtime ~10 seconds.
- No script implements pagination beyond manual `BATCH` constants. There is
  no rate limiting, no retry-with-backoff, and no concurrency control
  beyond `Promise.all` over a 10-row chunk in
  `import_snomed_diagnosis_mappings.js`.

---

## 13. Deployment

These scripts are **not deployed**. They run on the operator's workstation,
on demand. There is no:

- CI workflow that invokes any of them. (`.github/workflows/deploy-pages.yml`
  only deploys `web/` — see CLAUDE.md.)
- Cron schedule.
- Container image.
- Production environment that needs them at runtime.

The only deployment-adjacent script is `upload_skill_files.js`, which the
operator runs after editing `radhakishan_system/skill/*.md`. The Edge
Function `generate-prescription` reads those files from Storage at runtime
(with caching), so the upload is the deploy-equivalent for skill content.

---

## 14. Pointers / cross-refs

- **Schema base DDL**: `radhakishan_system/schema/radhakishan_supabase_schema.sql`,
  `radhakishan_system/schema/abdm_schema.sql`
- **Source JSON data files** (consumed and produced by scripts here):
  `radhakishan_system/data/formulary_data*.json`,
  `radhakishan_system/data/standard_prescriptions_*.json`,
  `radhakishan_system/data/snomed_*_mappings.json`,
  `radhakishan_system/data/_batch3_dosing_bands.json`,
  `radhakishan_system/data/_brand_mismatches*.json`
- **Skill files** uploaded by `upload_skill_files.js`:
  `radhakishan_system/skill/core_prompt.md`, `references/*.md`,
  `examples/worked_example.md`, plus the legacy
  `radhakishan_prescription_skill.md`
- **Edge Function exercised by `integration_test.js`**:
  `supabase/functions/generate-prescription/`
- **Live Supabase project**: `ecywxuqhnlkjtdshpcbc` (URL hard-coded in
  multiple scripts)
- **Adjacent system docs**:
  - `00-overview.md` — system topology
  - `01-web-app.md` — registration / prescription pad / print station
  - `02-edge-functions.md` — Edge Functions consumed by `integration_test.js`
  - `03-database.md` — table schema this doc's migrations target
  - `04-storage.md` — buckets `upload_skill_files.js` writes to
  - `05-skill-files.md` — content uploaded by `upload_skill_files.js`
  - `06-data-files.md` — JSON files in `data/` (this doc's primary inputs)

---

_Last reviewed: 2026-04-27. All file timestamps from `git log` are between
2026-03-17 and 2026-03-27._
