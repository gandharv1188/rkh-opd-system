# Code Review Issues — Radhakishan Hospital OPD Prescription System

**Review date:** March 2026
**Status:** Triaged into Fix Now / Fix Before Pilot / Defer

---

## RESOLVED

These issues have already been addressed:

| #   | Issue                                                                                | Resolution                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Anthropic API call had no `x-api-key` header — prescription generation always failed | Replaced with dual-mode: "Send to Chat" + "Paste JSON" — generation now happens through Claude.ai conversation                                                                                   |
| R2  | Patient ID format wrong (`RH-A123456` / `PED-XXXXXX`)                                | Changed to `RKH-YYMM#####` with sequential Supabase lookup and CHECK constraint                                                                                                                  |
| R3  | UHID collision risk — `Math.random()` with no uniqueness check                       | New `generateUHID()` queries Supabase for max existing ID in prefix, increments sequentially                                                                                                     |
| R4  | Safety checks cosmetic — blanket green checkmarks with no actual verification (FN-1) | Skill prompt now requires Claude to output specific findings per check (allergy, interactions, max dose) with SAFE/REVIEW REQUIRED status. Client-side verification deferred to production build |
| R5  | No dose validation against formulary max dose (FN-2)                                 | Skill prompt now requires per-medicine max dose comparison with PASS/FLAGGED status. Client-side cross-check deferred to production build                                                        |
| R6  | XSS via innerHTML in all 6 artifacts (FN-3)                                          | Added `esc()` HTML-escaping function to all 6 artifacts; all dynamic data (patient names, AI content, diagnoses, medicines, etc.) now escaped before innerHTML insertion                         |

---

## FIX NOW — Blocks core functionality or clinical safety

### ~~FN-1. Safety checks are cosmetic~~ → RESOLVED (R4)

### ~~FN-2. No dose validation against formulary max dose~~ → RESOLVED (R5)

### ~~FN-3. XSS via innerHTML — all artifacts~~ → RESOLVED (R6)

### FN-4. Dosing band populate broken in Formulary Manager

**Severity:** HIGH
**Location:** `radhakishan_formulary_v2.html` — `addBand()` / populate loop
**Description:** The populate loop uses short key names (`ind`, `ab`, `meth`, `du`, etc.) that don't match the actual JSONB field names (`indication`, `age_band`, `method`, `dose_unit`). Editing any existing drug shows blank dosing bands. The Formulary Manager is effectively unable to edit dosing data after import.
**Fix:** Map short DOM IDs to actual JSONB field names in the populate function, or rename the DOM element IDs to match the data fields.

### FN-5. Interactions field name mismatch between Importer and Manager

**Severity:** HIGH
**Location:** Formulary Manager vs Importer vs `formulary_data.json`
**Description:** The JSON data and Importer use `drug_or_class` for the interaction drug field. The Manager uses `drug`. Editing an imported drug shows blank interaction drug names. The schema comment also says `drug`.
**Fix:** Standardise on one field name across all three. Either update the Manager to read/write `drug_or_class`, or normalise the data on import to use `drug`.

### FN-6. Route case mismatch — data vs Manager

**Severity:** HIGH
**Location:** Formulary Manager formulation populate
**Description:** Imported data uses uppercase route values (`PO`, `IV`, `SC`, `IV/IM`). The Manager's `<select>` options use lowercase (`oral`, `iv`, `im`, `sc`). Populating an imported drug's formulations shows wrong route selections.
**Fix:** Normalise routes on import to lowercase, or add case-insensitive matching in the populate function.

### FN-7. Schema missing columns used by Standard Rx Manager

**Severity:** HIGH
**Location:** `radhakishan_supabase_schema.sql` — `standard_prescriptions` table
**Description:** The Standard Rx Manager saves `hospitalisation_criteria` and `last_reviewed_date` fields, but these columns don't exist in the `standard_prescriptions` table. Saves will silently lose this data or fail.
**Fix:** Add to schema:

```sql
ALTER TABLE standard_prescriptions
  ADD COLUMN hospitalisation_criteria text,
  ADD COLUMN last_reviewed_date date;
```

---

## FIX BEFORE PILOT — Important but won't block POC demo

### BP-1. No `@page` A4 rule or page-break handling in print CSS

**Severity:** HIGH
**Location:** `radhakishan_prescription_output_v2.html` — `@media print` block
**Description:** No `@page { size: A4; margin: ... }` rule. No `break-inside: avoid` on medicine rows or sections. Long prescriptions break at arbitrary points; footer may land on a separate page.
**Fix:** Add `@page` rule and `break-inside: avoid` on `.med-row`, section containers, and the doctor authentication block.

### BP-2. No Devanagari font declared

**Severity:** MEDIUM
**Location:** `radhakishan_prescription_output_v2.html` — CSS font stack
**Description:** Relies on `Georgia` and `system-ui` which may lack Devanagari glyphs on non-Indian systems. Hindi text could render as boxes.
**Fix:** Add `@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari')` or a similar Devanagari-capable font to the font stack.

### BP-3. `generateAndUploadPDF` creates .txt, not PDF; storage path missing bucket name

**Severity:** MEDIUM
**Location:** Prescription Pad — `generateAndUploadPDF()` function
**Description:** Despite the function name, it creates a `text/plain` Blob saved as `.txt`. The Supabase Storage upload path also lacks the bucket name (`prescriptions`), so the upload will fail.
**Fix:** Either rename the function to reflect what it does (text upload), or implement actual PDF generation using jsPDF/html2canvas. Fix the storage path to include the bucket name.

### BP-4. `calcAge()` day-of-month imprecision

**Severity:** MEDIUM
**Location:** Prescription Pad and Patient Lookup — `calcAge()` function
**Description:** Month calculation doesn't account for day-of-month. A child born Jan 15 evaluated on Feb 14 shows "1 month" when actually under 1 month. For neonatal dosing decisions, age precision matters.
**Fix:** Use day-level arithmetic for patients under 3 months; month-level is fine for older children.

### BP-5. postMessage uses wildcard `'*'` target origin

**Severity:** MEDIUM
**Location:** Prescription Pad (line ~2170), Output artifact, Patient Lookup
**Description:** `window.parent.postMessage({...}, '*')` sends data (including patient PII and clinical information) to any parent frame. In the Claude.ai sandbox this is lower risk, but any page embedding the artifact in an iframe could receive the data.
**Fix:** Restrict target origin to `'https://claude.ai'` or the known parent domain.

### BP-6. Visit creation failure silently ignored

**Severity:** MEDIUM
**Location:** Prescription Pad — `signOff()` function
**Description:** If the visit POST fails (`vRes.ok` is false), the code continues without a `visitId`, saving the prescription with `visit_id: undefined`. This corrupts the data model.
**Fix:** Check `vRes.ok` and abort sign-off with an error message if the visit creation fails.

### BP-7. Blood group field collected but never saved

**Severity:** MEDIUM
**Location:** Patient Lookup — `registerPatient()` function
**Description:** The registration form has a "Blood group" input (`np-bg`) that is collected and cleared, but never included in the save payload. Data entered there is silently lost.
**Fix:** Add `blood_group` to the payload and ensure the column exists in the `patients` table.

### BP-8. Dosing band schema divergence — extra fields stripped on edit-save

**Severity:** MEDIUM
**Location:** Formulary Manager — `getBands()` vs `formulary_data.json`
**Description:** The imported JSON data includes ~6 extra fields per dosing band (`dose_min_unit`, `dose_basis`, `loading_dose_basis`, `maintenance_dose_qty/unit`, `ga_weeks_min/max`, `duration_days_default`) that the Manager doesn't know about. Editing and saving a drug silently strips these fields.
**Fix:** Either add these fields to the Manager's form and `getBands()` output, or preserve unknown fields on save by merging with existing data rather than replacing.

### BP-9. No corrected age calculation for premature infants

**Severity:** MEDIUM
**Location:** Patient Lookup — `calcAge()` and growth display
**Description:** Gestational age is collected but never used in age display or growth Z-score context. For premature infants, WHO standards require corrected age until 2 years for growth/developmental assessments.
**Fix:** When `gestational_age_weeks` is present and < 37, calculate and display corrected age alongside chronological age.

### BP-10. MUAC always shows green regardless of value

**Severity:** MEDIUM
**Location:** Patient Lookup — growth trend display
**Description:** The Z-score colour coding function is applied to WAZ/HAZ/WHZ/HCZ but MUAC always gets the `z-ok` (green) class. A severely malnourished child with MUAC < 11.5cm still shows green.
**Fix:** Apply MUAC-specific thresholds: red < 11.5cm (SAM), amber 11.5–12.5cm (MAM), green > 12.5cm.

### BP-11. No pagination for visit/prescription history

**Severity:** LOW
**Location:** Patient Lookup — `loadDetail()` function
**Description:** Visits capped at 20, prescriptions at 10, with no "load more" or indication that more exist. Tab counts show limited data, not total counts (e.g., "Visits (20)" when 35 exist).
**Fix:** Add a "Load more" button or infinite scroll, and use a COUNT query for accurate tab labels.

### BP-12. Standard Rx Manager missing `mEq` dose unit

**Severity:** LOW
**Location:** `radhakishan_standard_rx_manager.html` — dose_unit `<select>`
**Description:** The `dose_unit` dropdown is missing `mEq` (milliequivalents), used for electrolyte drugs like KCl. Also missing `mL` for direct volume-based dosing.
**Fix:** Add `mEq` and `mL` options to the dose unit select.

---

## DEFER — Production concerns, not POC blockers

### D-1. Row Level Security entirely disabled

**Severity:** CRITICAL for production
**Location:** `radhakishan_supabase_schema.sql` — lines 344-351 (commented out)
**Description:** All RLS statements are commented out. Any client with the anon key has full read/write access to all patient data. Acceptable for POC with controlled access, but a data privacy concern for production.
**Fix:** Enable RLS on all tables and create policies before production deployment with real patient data.

### D-2. `ON DELETE CASCADE` on all foreign keys

**Severity:** MAJOR for production
**Location:** Schema — all FK definitions
**Description:** Deleting a patient silently destroys all their visits, prescriptions, vaccinations, and growth records. For medical/legal audit requirements, records should be preserved.
**Fix:** Change to `ON DELETE RESTRICT` and implement soft-delete with an `active` boolean flag.

### D-3. No `known_allergies` column on patients table

**Severity:** MAJOR for production
**Location:** Schema — `patients` table
**Description:** The clinical rules mandate allergy checks at every visit, but there's no persistent column to store a patient's allergy history. Currently allergies are only captured per-visit in the AI prompt.
**Fix:** Add `known_allergies text[]` to `patients` and display/check it in the Prescription Pad.

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
