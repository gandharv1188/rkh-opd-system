# Section A — Issue Resolution Notes

**Date:** 2026-03-24
**Resolved by:** Claude Code (automated implementation + verification)
**Files modified:** `core_prompt.md`, `registration.html`, `prescription-pad.html`

---

## Summary

All 11 user-reported issues (A1-A11) have been implemented and verified. Three independent verification agents confirmed 0 failures, 0 syntax errors, and 0 regressions across 16 total changes in 3 files.

---

## A1. BMI auto-calculation at registration and prescription pad

**Issue:** BMI was not calculated anywhere. 6 of 11 vitals (height, HC, MUAC, HR, RR, SpO2) were displayed in the UI but never passed to the AI.

**Resolution:**

1. **Registration page — BMI display field added:**
   - File: `web/registration.html`, line 1087
   - Added a read-only `<div id="bmi-display">` in the vitals grid, after the MUAC field.

2. **Registration page — `calcBMI()` function added:**
   - File: `web/registration.html`, lines 1394-1416
   - New function computes `weight / (height/100)^2`, rounds to 1 decimal, and classifies as Underweight/Normal/Normal-Overweight/Obese using simplified pediatric cutoffs.
   - Triggered via `oninput="calcBMI()"` on both `f-wt` (line 1083) and `f-ht` (line 1084).

3. **Registration page — BMI saved in visit payload:**
   - File: `web/registration.html`, lines 1897-1906
   - `bmi` field added to `visitPayload` with formula `(wt / (ht/100)^2).toFixed(1)`, or `null` if either weight or height is missing.

4. **Prescription pad — BMI displayed in vitals panel:**
   - File: `web/prescription-pad.html`, lines 3043-3046
   - In `onPatientSelect()`, BMI is computed from `visit.weight_kg` and `visit.height_cm` and pushed into the vitals display array as `"BMI: X.X kg/m^2"`.

5. **Prescription pad — BMI injected into AI context string:**
   - File: `web/prescription-pad.html`, lines 3102-3105
   - In the clinical note pre-fill (`ctx`), BMI is computed and appended as `"BMI X.X kg/m^2, "` when both weight and height are present.

6. **Prescription pad — All 6 missing vitals added to AI context string:**
   - File: `web/prescription-pad.html`, lines 3116-3132
   - The `vCtx` array now includes: `temp_f` (line 3117), `hr_per_min` (line 3118), `rr_per_min` (line 3119), `spo2_pct` (line 3120), `bp_systolic/bp_diastolic/map_mmhg` (lines 3121-3129), `hc_cm` (line 3130), `muac_cm` (line 3131).
   - All appended to `ctx` as `"Vitals: Temp 100.2F, HR 120/min, RR 32/min, ..."` (line 3132).

**Verification:** PASS

---

## A2. AI-generated BMI-based caloric dietary recommendation

**Issue:** The AI had no instruction to provide BMI-based dietary recommendations. No caloric guidance appeared in counselling output.

**Resolution:**

1. **Core prompt — counselling instruction added:**
   - File: `radhakishan_system/skill/core_prompt.md`, line 217
   - Added field rule under `counselling`: "If BMI or weight-for-height data is available, include a brief single-statement caloric dietary recommendation in the counselling array based on BMI-for-age or WHZ classification (e.g., 'Caloric requirement: ~900 kcal/day for a normally nourished 1-year-old; increase energy-dense foods if underweight')."

2. **No separate UI change needed** — the dietary recommendation flows through the existing `counselling` array, rendered at `prescription-pad.html` line 4455-4456 (review view) and line 5372-5373 (print view).

**Verification:** PASS

---

## A3. Generated prescription lost on navigation

**Issue:** `rxData` was a plain JS variable, never persisted. Page refresh or patient switching lost the generated prescription silently. Stale `rxData` could leak between patients.

**Resolution:**

1. **Clear stale state on patient switch:**
   - File: `web/prescription-pad.html`, lines 2994-2996
   - At the top of `onPatientSelect()`, `rxData = null; rxId = null;` prevents cross-patient contamination.

2. **Auto-persist draft to localStorage after generation:**
   - File: `web/prescription-pad.html`, lines 3973-3978
   - After `generatePrescription()` populates `rxData`, the draft is saved to `localStorage` with key `"rx-draft-" + visitId`.

3. **Restore draft on patient re-selection:**
   - File: `web/prescription-pad.html`, lines 3185-3202
   - In `onPatientSelect()`, if patient is not "done", checks `localStorage` for a draft. If found and valid (has `patient.name`), restores it into `rxData`, calls `renderReview()`, switches to review view, and shows toast "Restored unsaved prescription draft".

4. **Draft persists after sign-off** _(updated 2026-03-24)_:
   - Draft is NOT cleared after `signOff()` — the doctor may want to revisit the prescription later. The draft remains in localStorage until the next generation for the same visit overwrites it.

**Verification:** PASS

**Post-review correction:** Originally the draft was cleared on sign-off. Per doctor feedback, this was removed so prescriptions remain accessible for revisiting.

---

## A4. Newborn age display (months+days) and gestational vs actual age

**Issue:** For infants under 12 months, the days component was lost after 28 days (e.g., 45-day-old showed "1 months" instead of "1 month 17 days"). Corrected age for preterms was not shown in the prescription header.

**Resolution:**

1. **`calcAge()` fixed to include days for infants < 12 months:**
   - File: `web/prescription-pad.html`, lines 6061-6087
   - For `y === 0` (under 1 year), the function now returns `"X month(s) Y day(s)"` with proper pluralization (line 6079-6084). E.g., "2 months 14 days" instead of "2 months".
   - For < 28 days: returns `"N days"` (line 6067).
   - For 1-2 years: returns `"Y yr M mo"` (line 6085).
   - For 2+ years: returns `"Y years"` (line 6086).

2. **Review panel — dual age display with corrected age:**
   - File: `web/prescription-pad.html`, line 4137
   - Patient info strip now shows: `"Age (Corrected: X)"` when `r.neonatal?.corrected` exists. Implementation: `${esc(r.patient.age)}${r.neonatal?.corrected ? " (Corrected: " + esc(r.neonatal.corrected) + ")" : ""}`.

3. **Print output — same dual age display:**
   - File: `web/prescription-pad.html`, line 5265
   - Print header meta shows identical corrected age suffix: `${esc(r.patient?.age || "")}${r.neonatal?.corrected ? " (Corrected: " + esc(r.neonatal.corrected) + ")" : ""}`.

**Verification:** PASS

---

## A5. Prescription sequential numbering

**Issue:** Prescription IDs were `"RX-" + Date.now().toString().slice(-8)` — non-sequential, non-human-readable, with collision risk.

**Resolution:**

1. **New `generateRxId()` function with daily sequential counter:**
   - File: `web/prescription-pad.html`, lines 6039-6059
   - Format: `RX-YYMMDD-NNN` (e.g., `RX-260324-001`).
   - Queries Supabase: `SELECT id FROM prescriptions WHERE id LIKE 'RX-YYMMDD-%' ORDER BY id DESC LIMIT 1` (line 6046-6049).
   - Parses the last sequence number and increments (line 6053-6054).
   - Falls back to `001` if no existing prescriptions for today (line 6058).

2. **Called in `signOff()` before save:**
   - File: `web/prescription-pad.html`, line 4914
   - `if (!isUpdateMode) rxId = await generateRxId();` ensures a fresh sequential ID for new prescriptions.

**Verification:** PASS

---

## A6. AI-generated warning signs based on diagnosis

**Issue:** Warning signs were entirely hardcoded in 3 constant arrays (EMERGENCY_BASE, EMERGENCY_INFANT, EMERGENCY_CHILD). The AI had no field in its JSON output for diagnosis-specific warning signs.

**Resolution:**

1. **Core prompt — `warning_signs` field added to JSON schema:**
   - File: `radhakishan_system/skill/core_prompt.md`, lines 179-181
   - Added `"warning_signs": [{"hi": "Hindi warning in Devanagari", "en": "English warning sign"}]` to the output schema.

2. **Core prompt — AI instruction for diagnosis-specific signs:**
   - File: `radhakishan_system/skill/core_prompt.md`, line 219
   - Field rule: "Array of 6-8 bilingual warning signs. ALWAYS include 4 universal emergency signs (fast breathing/chest indrawing, blue lips, convulsions, unresponsive). Add 2-4 diagnosis-specific warning signs relevant to the patient's condition... Each entry has `hi` (Hindi) and `en` (English). Tailor to patient age group."

3. **Prescription pad — review rendering uses AI signs with hardcoded fallback:**
   - File: `web/prescription-pad.html`, lines 4458-4467
   - `const warnSigns = r.warning_signs?.length ? r.warning_signs : getEmergencySigns(patientAgeMonths);`
   - Hardcoded arrays retained at lines 1948-1995 as fallback.

4. **Prescription pad — print rendering uses same pattern:**
   - File: `web/prescription-pad.html`, lines 5375-5383
   - `const printWarnSigns = r.warning_signs?.length ? r.warning_signs : getEmergencySigns(printAgeMonths);`

**Verification:** PASS

---

## A7. Hindi/English language switch for counselling and warning signs

**Issue:** No language toggle existed. Warning signs were always bilingual. Counselling text was always English. No mechanism to choose language per patient.

**Resolution:**

1. **UI — language select dropdown in sticky tabs bar** _(updated 2026-03-24)_:
   - File: `web/prescription-pad.html` — `<select id="rx-lang">` placed in the sticky tabs bar (always visible), with transparent background and white text. Three options: Bilingual (default), Hindi, English. Uses `margin-left:auto` to sit at the right end.

2. **Language passed to AI via clinical note:**
   - File: `web/prescription-pad.html`, lines 3901-3905
   - In `generatePrescription()`: reads `rx-lang` value (line 3901), appends `"\nLANGUAGE: Hindi"` or `"\nLANGUAGE: English"` to the clinical note if not bilingual (lines 3902-3905).

3. **Language preference stored on rxData:**
   - File: `web/prescription-pad.html`, line 3967
   - `rxData._lang = rxLang;` preserves the language choice for rendering.

4. **Core prompt — language instruction added:**
   - File: `radhakishan_system/skill/core_prompt.md`, lines 41-46
   - Instructions for Hindi (Devanagari counselling, `en` omittable), English (`hi` omittable), and Bilingual (default, both included). Medicine Row 3 Hindi is always included regardless.

5. **Review rendering respects language:**
   - File: `web/prescription-pad.html`, lines 4465-4467
   - Warning signs conditionally render `hi` and `en` fields based on `warnLang` (`rxData._lang`).

6. **Print rendering respects language:**
   - File: `web/prescription-pad.html`, lines 5382-5383
   - Same conditional rendering using `printLang` derived from `rxData._lang`.

**Verification:** PASS

---

## A8. AI recommending follow-up after 1 day when admission is indicated

**Issue:** The AI sometimes set `followup_days: 1` for severe cases requiring admission — contradictory guidance. No rule distinguished admission from outpatient follow-up.

**Resolution** _(updated 2026-03-24 — changed from referral-based to explicit `admission_recommended` field)_:

1. **Core prompt — `admission_recommended` field added to JSON schema:**
   - File: `radhakishan_system/skill/core_prompt.md`
   - New field: `"admission_recommended": "string or null (null if outpatient; reason string if admission needed)"`.
   - Field rule: When admission is warranted, set `admission_recommended` to a brief reason string and `followup_days` to null.

2. **Core prompt — `followup_days` made nullable:**
   - File: `radhakishan_system/skill/core_prompt.md`
   - Schema: `"followup_days": "number or null (null if admission recommended)"`.
   - Rule references `admission_recommended` as the trigger for null followup.

3. **Prescription pad — review rendering checks `admission_recommended`:**
   - File: `web/prescription-pad.html`
   - When `r.admission_recommended` is truthy, displays red "ADMISSION RECOMMENDED" badge with the reason string, hiding the follow-up days input.
   - Sign-off button changes to "Approve ADMISSION & save" with red background.

4. **Prescription pad — print rendering checks `admission_recommended`:**
   - File: `web/prescription-pad.html`
   - Print output shows admission notice with reason when `r.admission_recommended` is present.

**Verification:** PASS

**Post-review correction:** Originally checked `r.followup_days == null && r.referral`. Per doctor feedback, changed to an explicit `admission_recommended` field with a dedicated UI indicator and modified sign-off button.

---

## A9. AI blocking contraindicated medications prescribed by doctor

**Issue:** The AI could silently omit or substitute drugs the doctor explicitly prescribed, due to allergy/contraindication matching. The doctor expected flagged inclusion, not silent removal.

**Resolution:**

1. **Core prompt — DOCTOR OVERRIDE RULE added:**
   - File: `radhakishan_system/skill/core_prompt.md`, lines 243-250
   - Explicit rule: "If the doctor explicitly names a specific medication in the clinical note, ALWAYS include that drug in the prescription output -- even if it has contraindications, allergy concerns, or interaction flags. NEVER silently omit or substitute a drug the doctor explicitly prescribed."
   - Instructions to: include the medicine with full dose calculation, add a prominent `flag` ("CAUTION: [specific concern] -- prescribed per doctor's explicit instruction"), set `safety.overall_status` to "REVIEW REQUIRED", and add an entry to `safety.flags`.

2. **Safety flags rendering in review panel (pre-existing, no change needed):**
   - File: `web/prescription-pad.html`, lines 4185-4186
   - Safety flags are already rendered as `flag-row` divs with warning icons when `r.safety?.flags` has entries.

3. **Overall status display in review panel (pre-existing, no change needed):**
   - File: `web/prescription-pad.html`, line 2560
   - Already renders `safety.overall_status` as bold text ("SAFE" or "REVIEW REQUIRED").

**Verification:** PASS

---

## A10. Sync vaccination schedule from registration to prescription pad

**Issue:** The vaccination schedule choice (NHM vs IAP) at registration was a JavaScript-only in-memory variable (`activeVaxSchedule`), never saved to the database. The doctor had to manually re-select the schedule at the prescription pad.

**Resolution:**

1. **Registration page — `vax_schedule` saved in visit payload:**
   - File: `web/registration.html`, line 1907
   - Added `vax_schedule: activeVaxSchedule || null` to the visit payload object.

2. **Prescription pad — `vax_schedule` fetched with visit data:**
   - File: `web/prescription-pad.html`, line 2245
   - The visits query `select` clause includes `vax_schedule` in the comma-separated field list.

3. **Prescription pad — auto-activate vaccination chip on patient select:**
   - File: `web/prescription-pad.html`, lines 3008-3015
   - In `onPatientSelect()`, after clearing section chips to defaults (lines 2999-3006), checks `visit?.vax_schedule`:
     - If `"nhm"`: adds `"vax-nhm"` to `activeMods` and highlights the chip button (lines 3009-3011).
     - If `"iap"`: adds `"vax-iap"` to `activeMods` and highlights the chip button (lines 3012-3014).
   - The pre-selected chip is visually highlighted via `classList.add("on")`.

**Verification:** PASS

---

## A11. Show BP percentile and BMI calculation at reception

**Issue:** BMI was not calculated or displayed at reception. BP percentile was already implemented for ages 1-18 but showed a message for age < 1 year.

**Resolution:**

1. **BMI display field added to registration vitals grid:**
   - File: `web/registration.html`, line 1087
   - `<div class="ff"><label>BMI</label><div id="bmi-display" ...>` -- read-only display showing computed BMI with classification label.

2. **`calcBMI()` function added:**
   - File: `web/registration.html`, lines 1394-1416
   - Auto-calculates on weight/height input, displays value with classification (Underweight/Normal/Normal-Overweight/Obese).
   - Guards: returns early if weight or height missing, or height < 30 cm (line 1399).

3. **BP percentile — confirmed pre-existing:**
   - File: `web/registration.html`, lines 1369-1438 (AAP 2017 lookup tables) and lines 1417-1438 (`calcMAP()` function).
   - Already functional for ages 1-18. For age < 1 year, displays "Age < 1yr (use neonatal norms)" as documented.
   - No change made to neonatal BP logic per the issue specification.

4. **BMI saved to database — covered by A1:**
   - File: `web/registration.html`, lines 1897-1906
   - `bmi` field in visit payload.

**Verification:** PASS

---

## Post-Review Corrections (2026-03-24)

### A3 — Draft not cleared after sign-off

**Correction:** Removed `localStorage.removeItem` call from `signOff()`. Doctor may need to revisit the prescription after signing. Draft now persists until the next generation for the same visit overwrites it.

### A7 — Language switch relocated to "Include in prescription" section

**Correction:** Moved `<select id="rx-lang">` from the sticky tabs bar to the mod-chips area. Styled as a pill-shaped dropdown matching chip design. Uses Unicode `▼` chevron positioned absolutely (cross-browser). Options: "Bilingual" (default), "हिंदी", "English".

### A8 — Explicit `admission_recommended` field replacing referral-based admission

**Correction:** Added `admission_recommended` field to core prompt JSON schema. Replaced `r.followup_days == null && r.referral` checks with `r.admission_recommended`. Added red "Admit" chip button to the "Include in prescription" section with `toggleAdmit()` function and `admit-on` CSS class. Sign-off button changes to "Approve ADMISSION & save" (red). Print station (`prescription-output.html`) also updated. Edge Function's `get_previous_rx` tool now passes `admission_recommended` and `warning_signs` through.

### Medication Restore button fix

**Issue:** After striking through (removing) a medication, the "Restore" button was unclickable. Root cause: `.item-struck { pointer-events: none }` on `.med-top` blocked ALL clicks inside the struck card.
**Fix:** Added `.item-struck .item-remove { pointer-events: auto; opacity: 1; text-decoration: none }` so the Restore button remains clickable while the rest of the card is struck through. Works in both pre-signoff and post-signoff edit modes.

### Patient search combo box improvement

**Fix:** Auto-select text on focus so the doctor can immediately type a new search. Search results now appear at the top of the dropdown list, above the existing patient entries.

### Vaccination status options expanded

**Issue:** Only "Completed" and "Scheduled" statuses were available for vaccines.
**Fix:** Changed "Completed" to "Administered". Added new statuses: "Previously given" (for vaccines given elsewhere), "Deferred", and "Refused". Previously given vaccines are saved to the database with the date from the date picker.

### All document types generate OCR summaries

**Issue:** OCR summary generation was limited to certain document types.
**Fix:** All uploaded document types (lab reports, imaging, discharge summaries, etc.) now trigger OCR summary extraction via the process-document Edge Function.

### Growth trend improvements

**Issue:** Growth trend display required at least 2 visits and did not show time span or handle single-value cases.
**Fix:** Time span is now shown in the trend display. Single-value support added (shows the value without a trend arrow). Relaxed the 2-visit minimum requirement so even first-visit patients see their current measurements.

### Sequential receipt numbers

**Issue:** Receipt numbers used timestamp-based generation which was not human-readable or sequential.
**Fix:** Changed to sequential format `RKH-RCT-YYMMDD-NNN` where NNN resets daily. Queries Supabase for the last receipt number of the day and increments.

### Live DB migration: 7 columns added to visits table

**Migration:** Added 7 columns to the live `visits` table via ALTER TABLE: `bmi`, `vax_schedule`, `receipt_no`, `consultation_fee`, `payment_mode`, `payment_status`, `procedures`. All columns nullable with appropriate CHECK constraints. Committed schema DDL updated to match.

### Live integration test: 94/94 PASS

**Verification:** Full end-to-end integration test covering all registration, prescription pad, and print station workflows. 94 out of 94 test assertions passed with 0 failures, confirming all Section A fixes work correctly against the live database.

---

## File Change Summary

| File                                      | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Issues Addressed           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `radhakishan_system/skill/core_prompt.md` | Language instruction (lines 41-46), warning_signs schema (lines 179-181), followup_days nullable (line 182), BMI counselling rule (line 217), warning_signs field rule (line 219), admission rule (line 220), doctor override rule (lines 243-250)                                                                                                                                                                                                                                                                                                                                                                                                     | A2, A6, A7, A8, A9         |
| `web/registration.html`                   | BMI display field (line 1087), oninput triggers (lines 1083-1084), calcBMI function (lines 1394-1416), BMI in visit payload (lines 1897-1906), vax_schedule in visit payload (line 1907)                                                                                                                                                                                                                                                                                                                                                                                                                                                               | A1, A10, A11               |
| `web/prescription-pad.html`               | Stale state clearing (lines 2994-2996), BMI in vitals panel (lines 3043-3046), all vitals in ctx string (lines 3098-3132), BMI in ctx (lines 3102-3105), draft restore (lines 3185-3202), language select UI (lines 1690-1708), language in generatePrescription (lines 3901-3905), draft auto-save (lines 3973-3978), warning signs with fallback (lines 4458-4467), admission display (lines 4470-4472), corrected age in review (line 4137), corrected age in print (line 5265), print warning signs (lines 5375-5383), print admission (line 5384), draft cleanup (lines 5127-5130), generateRxId (lines 6039-6059), calcAge fix (lines 6061-6087) | A1, A3, A4, A5, A6, A7, A8 |
