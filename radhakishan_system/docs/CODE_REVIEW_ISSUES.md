# Code Review Issues — Radhakishan Hospital OPD Prescription System

**Review date:** March 2026
**Status:** Triaged into Fix Now / Fix Before Pilot / Defer

---

## RESOLVED

These issues have already been addressed:

| #   | Issue                                                                                | Resolution                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Anthropic API call had no `x-api-key` header — prescription generation always failed | Replaced with dual-mode: "Send to Chat" + "Paste JSON" — generation now happens through Claude.ai conversation                                                                                      |
| R2  | Patient ID format wrong (`RH-A123456` / `PED-XXXXXX`)                                | Changed to `RKH-YYMM#####` with sequential Supabase lookup and CHECK constraint                                                                                                                     |
| R3  | UHID collision risk — `Math.random()` with no uniqueness check                       | New `generateUHID()` queries Supabase for max existing ID in prefix, increments sequentially                                                                                                        |
| R4  | Safety checks cosmetic — blanket green checkmarks with no actual verification (FN-1) | Skill prompt now requires Claude to output specific findings per check (allergy, interactions, max dose) with SAFE/REVIEW REQUIRED status. Client-side verification deferred to production build    |
| R5  | No dose validation against formulary max dose (FN-2)                                 | Skill prompt now requires per-medicine max dose comparison with PASS/FLAGGED status. Client-side cross-check deferred to production build                                                           |
| R6  | XSS via innerHTML in all 6 artifacts (FN-3)                                          | Added `esc()` HTML-escaping function to all 6 artifacts; all dynamic data (patient names, AI content, diagnoses, medicines, etc.) now escaped before innerHTML insertion                            |
| R7  | Schema missing `hospitalisation_criteria` and `last_reviewed_date` columns (FN-7)    | Added both columns to schema. Also relaxed `icd10` from NOT NULL to nullable (some diagnoses lack codes). Extracted 446 diagnoses from pediatric guidelines into `standard_prescriptions_data.json` |
| R8  | Dosing band populate broken — short keys don't match JSONB fields (FN-4)             | Replaced short-key loop with explicit fieldMap mapping JSONB names (indication, age_band, etc.) to DOM suffixes. getBands() now also outputs dose_min_unit, dose_basis, duration_days_default       |
| R9  | Interactions field name mismatch `drug` vs `drug_or_class` (FN-5)                    | addInt() now reads `d.drug_or_class \|\| d.drug`, getInts() now outputs `drug_or_class`. Consistent with JSON data schema                                                                           |
| R10 | Route case mismatch PO/IV/SC vs oral/iv/sc (FN-6)                                    | Added routeMap in addForm() that normalises uppercase routes (PO→oral, IV→iv, SC→sc, IM→im, IV/IM→im) before setting select value                                                                   |
| R11 | No @page A4 rule or page-break handling (BP-1)                                       | Added @page A4, break-inside:avoid on sections/medicines/footer, print-color-adjust:exact                                                                                                           |
| R12 | No Devanagari font declared (BP-2)                                                   | Added Noto Sans Devanagari via Google Fonts, applied to .med-r3 Hindi row                                                                                                                           |
| R13 | Storage upload missing bucket name (BP-3)                                            | Fixed path to include `prescriptions` bucket in both upload and public URL                                                                                                                          |
| R14 | calcAge() day-of-month imprecision (BP-4)                                            | Added day-of-month check in both artifacts to prevent off-by-one month errors                                                                                                                       |
| R15 | postMessage wildcard origin (BP-5)                                                   | Replaced all `'*'` with `'https://claude.ai'` across Prescription Pad and Patient Lookup                                                                                                            |
| R16 | Visit creation failure silently ignored (BP-6)                                       | Added else branch that throws error and aborts sign-off if visit POST fails                                                                                                                         |
| R17 | Blood group field never saved (BP-7)                                                 | Added blood_group to registration payload and blood_group column to patients table schema                                                                                                           |
| R18 | Dosing band extra fields stripped on save (BP-8)                                     | Extra fields preserved via data-extra attribute on band elements, merged back in getBands()                                                                                                         |
| R19 | No corrected age for preterms (BP-9)                                                 | calcAge() now accepts gaWeeks param, displays corrected age for GA < 37 weeks until age 2                                                                                                           |
| R20 | MUAC always green (BP-10)                                                            | Now uses clinical thresholds: red < 11.5cm (SAM), amber 11.5-12.5cm (MAM), green >= 12.5cm                                                                                                          |
| R21 | No pagination for history (BP-11)                                                    | Increased limits to 50, tab labels show "50+" when limit reached                                                                                                                                    |
| R22 | Missing mEq dose unit (BP-12)                                                        | Added mEq and mL options to Standard Rx Manager dose unit select                                                                                                                                    |

---

## FIX NOW — Blocks core functionality or clinical safety

### ~~FN-1. Safety checks are cosmetic~~ → RESOLVED (R4)

### ~~FN-2. No dose validation against formulary max dose~~ → RESOLVED (R5)

### ~~FN-3. XSS via innerHTML — all artifacts~~ → RESOLVED (R6)

### ~~FN-4. Dosing band populate broken in Formulary Manager~~ → RESOLVED (R8)

### ~~FN-5. Interactions field name mismatch between Importer and Manager~~ → RESOLVED (R9)

### ~~FN-6. Route case mismatch — data vs Manager~~ → RESOLVED (R10)

### ~~FN-7. Schema missing columns used by Standard Rx Manager~~ → RESOLVED (R7)

---

## ~~FIX BEFORE PILOT~~ — All resolved (R11–R22)

### ~~BP-1~~ → R11. Added `@page { size: A4; margin: 12mm 10mm }`, `break-inside: avoid` on `.rx-sec`, `.med-row`, `.rx-footer`, and `print-color-adjust: exact`

### ~~BP-2~~ → R12. Added Google Fonts Noto Sans Devanagari, applied to `.med-r3` (Hindi row)

### ~~BP-3~~ → R13. Fixed Supabase Storage path to include `prescriptions` bucket name in both upload and public URL

### ~~BP-4~~ → R14. Fixed `calcAge()` in both Prescription Pad and Patient Lookup — now checks day-of-month to prevent off-by-one month errors

### ~~BP-5~~ → R15. Replaced all `postMessage(..., '*')` with `'https://claude.ai'` in Prescription Pad and Patient Lookup

### ~~BP-6~~ → R16. Added else branch to visit creation — now throws error and aborts sign-off if visit POST fails

### ~~BP-7~~ → R17. Added `blood_group` to patient registration payload and `blood_group text` column to schema

### ~~BP-8~~ → R18. Extra dosing band fields (`ga_weeks_min/max`, `loading_dose_basis`, `maintenance_dose_qty/unit`) preserved via `data-extra` attribute and merged back in `getBands()`

### ~~BP-9~~ → R19. `calcAge()` in Patient Lookup now accepts `gaWeeks` param, displays corrected age for preterms (GA < 37 weeks, until age 2)

### ~~BP-10~~ → R20. MUAC color coding now uses clinical thresholds: red < 11.5cm (SAM), amber 11.5–12.5cm (MAM), green ≥ 12.5cm

### ~~BP-11~~ → R21. Increased query limits to 50 per tab, tab labels show "50+" when limit is reached

### ~~BP-12~~ → R22. Added `mEq` and `mL` dose unit options to Standard Rx Manager

---

## DEFER — Production concerns, not POC blockers

### ~~D-1. Row Level Security entirely disabled~~ → RESOLVED (R23)

RLS enabled on all 7 tables with `auth.role() = 'authenticated'` policy. Per-doctor policies deferred to production. Note added to specification Section 12.3.

### ~~D-2. `ON DELETE CASCADE` on all foreign keys~~ → RESOLVED (R24)

Changed all FKs to `ON DELETE RESTRICT`. Added `is_active boolean default true` to patients table. Patient search queries in both Prescription Pad and Patient Lookup now filter by `is_active=eq.true`.

### ~~D-3. No `known_allergies` column on patients table~~ → RESOLVED (R25)

Added `known_allergies text[]` to patients schema. Registration form has comma-separated allergy input. Patient cards display allergies in RED. Production upgrade to structured JSONB noted in specification Section 11.1.

### D-4. No `doctors` reference table

**Severity:** MEDIUM
**Location:** Schema — throughout
**Description:** Doctor IDs appear as free text (`doctor_id`, `approved_by`, `given_by`). No validation, no credential storage, no protection against typos.
**Fix:** Create a `doctors` table with name, degree, registration number, and use FK references.

### D-5. Missing NOT NULL constraints on critical foreign keys

**Severity:** MAJOR for production
**Location:** Schema — `visits.patient_id`, `prescriptions.visit_id`, `prescriptions.patient_id`
**Description:** These FK columns allow NULL, permitting orphan records (visits without patients, prescriptions without visits).
**Fix:** Add `NOT NULL` to these columns.

### D-6. No CHECK constraints on medical data ranges

**Severity:** MAJOR for production
**Location:** Schema — `visits` table
**Description:** No range validation on `weight_kg`, `height_cm`, `temp_f`, `hr_per_min`, `rr_per_min`, `spo2_pct`, `triage_score`. Negative weights or impossible SpO2 values would be accepted.
**Fix:** Add CHECK constraints with clinically valid ranges.

### D-7. `formulary.generic_name` not UNIQUE

**Severity:** MAJOR for production
**Location:** Schema — `formulary` table
**Description:** Nothing prevents duplicate drug entries for the same generic name, causing ambiguity during prescription generation.
**Fix:** Add a UNIQUE constraint on `generic_name`.

### D-8. Missing `updated_at` on visits, vaccinations, growth_records

**Severity:** MEDIUM
**Location:** Schema — 3 tables
**Description:** These tables have `created_at` but no `updated_at` column or trigger, unlike other mutable tables.
**Fix:** Add `updated_at` columns and triggers.

### D-9. Missing composite indexes

**Severity:** LOW (performance at scale)
**Location:** Schema
**Description:** Missing composite indexes on `visits(patient_id, visit_date)`, `growth_records(patient_id, recorded_date)`, `vaccinations(patient_id, vaccine_name)`. Individual indexes exist but common query patterns need composites.
**Fix:** Add composite indexes.

### D-10. No audit log table

**Severity:** MEDIUM for NABH production compliance
**Location:** Schema
**Description:** No audit trail of who viewed/edited patient records. NABH IMS chapter recommends this.
**Fix:** Create an `audit_log` table for production deployment.

### D-11. No developmental screening table

**Severity:** LOW
**Location:** Schema
**Description:** Developmental assessment results live only inside `prescriptions.generated_json`, making them unqueryable. The clinical rules require developmental screening at every visit.
**Fix:** Create a `developmental_screenings` table for structured storage.

### D-12. Skill describes only 3 of 6 dosing methods

**Severity:** LOW
**Location:** `radhakishan_prescription_skill.md` — Section 4
**Description:** Only weight-based, BSA-based, and GFR-adjusted methods are described. Fixed dose, infusion rate, and age-based methods are supported in the schema and formulary but not documented in the skill prompt.
**Fix:** Add sections for the remaining 3 methods.

### D-13. No doctor authentication / PIN-based sign-off

**Severity:** MEDIUM for production
**Location:** Prescription Pad
**Description:** Anyone with page access and Supabase credentials can sign prescriptions as any doctor. The doctor selector is a simple dropdown.
**Fix:** Add at minimum a PIN-based sign-off for production.

### D-14. `sex` column and other enums unconstrained

**Severity:** LOW
**Location:** Schema — `patients.sex`, `formulary.licensed_in_children`, `vaccinations.free_or_paid`
**Description:** These text columns accept any value. Documented valid values are not enforced by CHECK constraints.
**Fix:** Add CHECK constraints for each.

### D-15. JSONB fields lack basic type validation

**Severity:** LOW
**Location:** Schema — all JSONB columns
**Description:** No CHECK that JSONB array fields actually contain arrays (e.g., `formulations`, `dosing_bands`, `interactions`). Malformed structures silently accepted.
**Fix:** Add `CHECK (jsonb_typeof(column) = 'array')` where applicable.

### D-16. QR code payload may exceed capacity

**Severity:** LOW
**Location:** `radhakishan_prescription_output_v2.html` — QR generation
**Description:** QR payload is raw JSON with patient name, diagnoses, etc. With many diagnoses and long names, it could exceed QR capacity at correction level M / 64px.
**Fix:** Truncate payload or switch to a URL-based verification link.

### D-17. CDN dependency for QR code library

**Severity:** LOW
**Location:** `radhakishan_prescription_output_v2.html` — qrcodejs from cdnjs
**Description:** If CDN is unavailable (offline clinic), QR generation silently fails.
**Fix:** Bundle the library inline or provide a local fallback for offline use.

### D-18. Missing categories in Formulary Manager filter tabs

**Severity:** LOW
**Location:** `radhakishan_formulary_v2.html` — category tabs and dropdown
**Description:** Several categories in the JSON data (Rheumatology, Neurological, Infectious, Respiratory, Dermatology, Hematology) have no matching filter tab or dropdown option.
**Fix:** Add missing categories to both the filter tabs and the category dropdown.

### D-19. No NABH accreditation number on prescriptions

**Severity:** LOW
**Location:** `radhakishan_prescription_output_v2.html` — header
**Description:** Shows "NABH HCO 6th Edition Accredited" text but not the actual accreditation certificate number, which NABH requires on clinical documents.
**Fix:** Add the accreditation number to the header.

### D-20. Voice dictation missing `onerror` handler

**Severity:** LOW
**Location:** Prescription Pad — SpeechRecognition setup
**Description:** No `onerror` handler for permission denied, network errors, or "not-allowed" errors. The UI may get stuck in recording state.
**Fix:** Add `recog.onerror` handler that resets the UI state and shows an appropriate message.

---

_Last updated: March 2026_
