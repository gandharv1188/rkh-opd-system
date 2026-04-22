# Standard Prescriptions: Database vs New JSON Structure Comparison

**Date:** 2026-03-27
**Database:** 469 active protocols in `standard_prescriptions` table
**New JSON:** 56 protocols in `docs/Standard Diagnosis/` folder

---

## Side-by-Side Field Comparison

| Field                      | Database (current)                              | New JSON files                        | Match?                  | Action needed                                             |
| -------------------------- | ----------------------------------------------- | ------------------------------------- | ----------------------- | --------------------------------------------------------- |
| `icd10`                    | text, 100% filled                               | Same                                  | Yes                     | -                                                         |
| `diagnosis_name`           | text, 100% filled                               | Same                                  | Yes                     | -                                                         |
| `category`                 | text, 100% filled                               | Same                                  | Yes                     | Merge duplicates (Skin/Dermatology, Neonatology/Neonatal) |
| `severity`                 | text ("any"/"mild"/"moderate"/"severe"), 100%   | Same                                  | Yes                     | -                                                         |
| `first_line_drugs`         | JSONB `[{drug, notes, is_new_2024_2025}]`, 100% | Same structure                        | Yes                     | -                                                         |
| `second_line_drugs`        | JSONB, same structure, 98%                      | Same structure                        | Yes                     | -                                                         |
| `investigations`           | JSONB `[{name, indication, urgency}]`, 100%     | Same structure                        | Yes                     | -                                                         |
| `counselling`              | text[] (bilingual with `—` separator), 100%     | text[] (English only in new files)    | Partial                 | New files are English-only; DB has bilingual              |
| `warning_signs`            | text[], **5% (23/469)**                         | text[], present in all new files      | **Gap**                 | **Import from new files — 446 protocols missing**         |
| `referral_criteria`        | text, 100%                                      | text, same                            | Yes                     | -                                                         |
| `hospitalisation_criteria` | text, 100%                                      | text, same                            | Yes                     | -                                                         |
| `notes`                    | text, 100%                                      | text, same                            | Yes                     | -                                                         |
| `source`                   | text (single string), 100%                      | text[] (array of sources)             | **Mismatch**            | DB stores as string, new files use array                  |
| `duration_days_default`    | integer, 100%                                   | integer, same                         | Yes                     | -                                                         |
| `guideline_changes`        | text, 58%                                       | text or null, same                    | Yes                     | -                                                         |
| `snomed_code`              | text, 95%                                       | text or null, same                    | Yes                     | -                                                         |
| `snomed_display`           | text, 33%                                       | Not present in new files              | -                       | DB-only field                                             |
| `active`                   | boolean, 100%                                   | boolean, same                         | Yes                     | -                                                         |
| `expected_course`          | text, **0% (empty)**                            | text, **present in new files**        | **Gap**                 | **Import — entirely new data**                            |
| `key_clinical_points`      | text[], **0% (empty)**                          | text[], **present in new files**      | **Gap**                 | **Import — entirely new data**                            |
| `severity_assessment`      | text, **0% (empty)**                            | **object** `{mild, moderate, severe}` | **Gap + Type mismatch** | **DB column is text, new files use JSONB object**         |
| `monitoring_parameters`    | text, **0% (empty)**                            | **JSONB** `[{parameter, frequency}]`  | **Gap + Type mismatch** | **DB column is text, new files use JSONB array**          |
| `last_reviewed_date`       | date, 0%                                        | Not present                           | -                       | Could auto-set on import                                  |

---

## New Fields in JSON Files Not In Database

None — all fields in the new JSON files already have corresponding columns in the database schema.

---

## Key Differences

### 1. `warning_signs` — 5% vs 100%

**Database:** Only 23 of 469 protocols have warning signs. The prescription pad falls back to hardcoded age-based warning signs (EMERGENCY_BASE + EMERGENCY_INFANT/EMERGENCY_CHILD arrays).

**New files:** All 56 protocols have diagnosis-specific warning signs (e.g., DKA has "Altered consciousness, Seizures, Kussmaul breathing"; Common Cold has "Fast breathing, Bluish lips, Fever >3 days").

**Impact:** Importing warning signs from the new files would give Claude diagnosis-specific danger signs instead of generic ones. This is a significant clinical improvement.

### 2. `expected_course` — 0% vs present

**Database:** Column exists but is empty for all 469 protocols.

**New files:** Contains natural-language expected course (e.g., "Fever may last 2-3 days; nasal symptoms 5-7 days; cough may persist up to 7-10 days").

**Impact:** Claude could use this to set patient expectations in counselling and follow-up instructions.

### 3. `key_clinical_points` — 0% vs present

**Database:** Column exists but empty.

**New files:** Array of critical clinical reminders (e.g., "Most common cause is viral; no role of antibiotics", "Never give insulin bolus in pediatric DKA").

**Impact:** Claude could use these as guardrails to avoid prescribing errors.

### 4. `severity_assessment` — Type mismatch

**Database column:** `text` (single string)
**New files:** JSONB object with keys `{mild, moderate, severe}`, each containing criteria text.

```json
// New file format:
"severity_assessment": {
  "mild": "Runny nose, mild cough, no respiratory distress, feeding well",
  "moderate": "Fever, irritability, reduced feeding, mild nasal blockage",
  "severe": "Respiratory distress, hypoxia, poor feeding, lethargy"
}
```

**Action:** DB column type needs to change from `text` to `JSONB` to accommodate the structured severity tiers.

### 5. `monitoring_parameters` — Type mismatch

**Database column:** `text` (single string)
**New files:** JSONB array of objects with `parameter` and `frequency`.

```json
// New file format:
"monitoring_parameters": [
  { "parameter": "Temperature", "frequency": "4-6 hourly" },
  { "parameter": "Blood glucose", "frequency": "Hourly" },
  { "parameter": "GCS/neurological status", "frequency": "Half-hourly to hourly" }
]
```

**Action:** DB column type needs to change from `text` to `JSONB` to accommodate the structured array.

### 6. `source` — String vs Array

**Database:** Single text string (e.g., `"CDC 2024, WHO"`)
**New files:** Array of strings (e.g., `["IAP 2024", "WHO 2023", "AAP Guidelines"]`)

**Action:** Minor — the Edge Function and Claude can handle both formats. Could standardize to array.

### 7. `counselling` — Bilingual vs English-only

**Database:** Bilingual strings with `—` separator (e.g., `"Give plenty of fluids — पर्याप्त पानी पिलाएं"`)
**New files:** English-only strings.

**Action:** The AI generates bilingual counselling at runtime regardless of what's in standard_prescriptions. This difference is acceptable — the standard Rx counselling serves as prompts/guidance for Claude, not direct output.

---

## Coverage Comparison

**Database has 469 protocols. New files have 56 protocols.**

The 56 new files are heavily weighted towards:

- **Neonatology:** ~25 protocols (Bathing, Burping, Cord Care, Breastfeeding, Jaundice, Hearing Screening, Metabolic Screening, etc.)
- **Emergency/Critical care:** DKA, Septic Shock, Hyperkalemia, AKI, Acid-Base Disorders
- **Electrolyte disorders:** Hypo/Hypernatremia, Hypo/Hypocalcemia, Hypo/Hyperkalemia
- **General:** Common Cold, Dehydration, Infantile Colic

Many of these (especially neonatal counseling protocols like Bathing, Burping, Tummy Time, Car Seat) are **new categories not in the database** — they're patient education protocols rather than drug prescriptions.

---

## Schema Migration Required

```sql
-- Change severity_assessment from text to JSONB
ALTER TABLE standard_prescriptions
  ALTER COLUMN severity_assessment TYPE JSONB USING severity_assessment::JSONB;

-- Change monitoring_parameters from text to JSONB
ALTER TABLE standard_prescriptions
  ALTER COLUMN monitoring_parameters TYPE JSONB USING monitoring_parameters::JSONB;
```

---

## Import Strategy

### Phase 1: Schema migration

- Change `severity_assessment` and `monitoring_parameters` column types to JSONB

### Phase 2: Enrich existing 469 protocols

- Import `warning_signs` from matching new files (by ICD-10 code)
- Import `expected_course`, `key_clinical_points`, `severity_assessment`, `monitoring_parameters` where available
- Do NOT overwrite existing data (counselling, drugs, investigations)

### Phase 3: Add new protocols

- Import the ~30 neonatal counseling protocols that don't exist in the database
- These are mostly non-pharmacological (no drugs) — education/counseling protocols

### Phase 4: Populate remaining 413 protocols

- Deploy research agents to populate `warning_signs`, `expected_course`, `key_clinical_points`, `severity_assessment`, `monitoring_parameters` for the remaining protocols not covered by the 56 new files

---

## Summary

| Aspect                                         | Database (469)  | New Files (56) | Gap                               |
| ---------------------------------------------- | --------------- | -------------- | --------------------------------- |
| Core fields (diagnosis, drugs, investigations) | 100%            | 100%           | None                              |
| `warning_signs`                                | 5%              | 100%           | **446 protocols need data**       |
| `expected_course`                              | 0%              | 100%           | **469 protocols need data**       |
| `key_clinical_points`                          | 0%              | 100%           | **469 protocols need data**       |
| `severity_assessment`                          | 0% + wrong type | 100% as JSONB  | **Schema change + 469 need data** |
| `monitoring_parameters`                        | 0% + wrong type | 100% as JSONB  | **Schema change + 469 need data** |
| Neonatal counseling protocols                  | 58 general      | 25 specialized | **New protocols to add**          |
