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

### ~~D-4. No `doctors` reference table~~ → RESOLVED (R26)

Created `doctors` table with id, full_name, degree, registration_no, specialisation. Seeded with Dr. Lokender Goyal. FK enforcement deferred to production. Noted in specification Section 12.4.

### ~~D-5. Missing NOT NULL constraints on critical foreign keys~~ → RESOLVED (R27)

Added `NOT NULL` to `visits.patient_id`, `prescriptions.visit_id`, and `prescriptions.patient_id`.

### ~~D-6. No CHECK constraints on medical data ranges~~ → RESOLVED (R28)

Added CHECK constraints: visits (weight 0.3-200kg, height 20-220cm, HC 15-60cm, MUAC 5-30cm, temp 85-110F, HR 20-300, RR 5-120, SpO2 0-100%, triage 0-15), patients (GA 22-44wks, birth weight 0.3-6.0kg).

### ~~D-7. `formulary.generic_name` not UNIQUE~~ → RESOLVED (R29)

Added `UNIQUE` constraint to `formulary.generic_name`.

### ~~D-8. Missing `updated_at` on visits, vaccinations, growth_records~~ → RESOLVED (R30)

Added `updated_at timestamptz default now()` and update triggers to all three tables.

### ~~D-9. Missing composite indexes~~ → RESOLVED (R31)

Added `visits(patient_id, visit_date desc)`, `vaccinations(patient_id, vaccine_name)`, `growth_records(patient_id, recorded_date desc)`.

### D-10. No audit log table

**Severity:** MEDIUM for NABH production compliance
**Location:** Schema
**Description:** No audit trail of who viewed/edited patient records. NABH IMS chapter recommends this.
**Status:** DEFERRED to production. For POC, the `updated_at` timestamps and Supabase's built-in Postgres logs provide a minimal audit trail. A dedicated `audit_log` table with action type, user, timestamp, affected table/row, and before/after values should be created when the system moves to production with real patient data.

### ~~D-11. No developmental screening table~~ → RESOLVED (R32)

Created `developmental_screenings` table with tool_used, domain-specific fields (gross_motor, fine_motor, language, social, cognitive), overall_result, red_flags array, referral_needed, referral_to. Includes RLS, indexes, and updated_at trigger.

### ~~D-12. Skill describes only 3 of 6 dosing methods~~ → RESOLVED (R38)

Complete skill rewrite (v2026.2). All 6 dosing methods now documented: weight-based, BSA, GFR-adjusted, fixed dose, infusion rate, age/GA-tier. Also fixed: JSON schema aligned with artifact field names, added neonatal object, NHM-UIP vaccination schedule alongside IAP 2024, complete worked example, edge case handling (missing weight, neonatal pathway, unknown allergies), XML-tagged structure, Hindi translation rules, 10 standard prescriptions (added febrile seizures + croup), hepatic/renal consideration, Haryana-specific vaccine notes.

### D-13. No doctor authentication / PIN-based sign-off — DEFERRED

**Severity:** MEDIUM for production
**Location:** Prescription Pad
**Description:** Anyone with page access and Supabase credentials can sign prescriptions as any doctor. The doctor selector is a simple dropdown.
**Status:** Deferred to production. Requires Supabase Auth integration (see specification Section 12.3 and 12.4).

### ~~D-14. `sex` column and other enums unconstrained~~ → RESOLVED (R33)

Added CHECK constraints: `patients.sex` in (Male, Female, Other), `formulary.licensed_in_children` in (true, partial, false), `vaccinations.free_or_paid` in (free_uip, paid).

### ~~D-15. JSONB fields lack basic type validation~~ → RESOLVED (R34)

Added `CHECK (col is null or jsonb_typeof(col) = 'array'|'object')` to all 14 JSONB columns: formulary (formulations, dosing_bands, renal_bands, interactions, administration), standard_prescriptions (first_line_drugs, second_line_drugs, investigations), visits (diagnosis_codes), prescriptions (medicines, investigations, vaccinations, growth, qr_data).

### ~~D-16. QR code payload may exceed capacity~~ → RESOLVED (R35)

Trimmed QR payload to re-registration essentials only: UHID, patient name (max 30 chars), DOB, sex initial. Removed diagnosis, weight, date, hospital code. Well within QR capacity.

### ~~D-17. CDN dependency for QR code library~~ → NOTED (specification Section 12.6)

Library is only 9 KB. Noted for production inline bundling. POC uses CDN with existing fallback. See specification Section 12.6.

### ~~D-18. Missing categories in Formulary Manager filter tabs~~ → RESOLVED (R36)

Split filter tabs into two rows: Drug class (14 tabs: Antibiotics, Analgesics, etc.) and Clinical specialty (17 tabs: Respiratory, ENT, GI, etc.). Dropdown grouped with `<optgroup>` for both sets. All categories from formulary data now have matching tabs.

### D-19. No NABH accreditation number on prescriptions — DEFERRED

Header changed to "NABH Accredited". Actual certificate number to be added when available.

### ~~D-20. Voice dictation missing `onerror` handler~~ → RESOLVED (R37)

Added `recog.onerror` handler that resets mic button UI and shows specific messages for not-allowed, no-speech, network, and aborted errors.

---

_Last updated: March 2026_
