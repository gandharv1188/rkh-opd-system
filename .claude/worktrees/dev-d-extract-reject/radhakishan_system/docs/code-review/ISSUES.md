# Issue Tracker — Radhakishan Hospital Prescription System

**Created:** 2026-03-24
**Last updated:** 2026-03-24 (Section A complete, Section B-II complete)

Legend: `[ ]` = pending, `[x]` = done, `[~]` = in progress

---

## Section A — User-Reported Issues & Feature Requests

### A1. BMI auto-calculation at registration and prescription pad

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/registration.html`, `web/prescription-pad.html`, `radhakishan_system/schema/radhakishan_supabase_schema.sql`

**Current state:** BMI is not calculated anywhere in the codebase. The system relies on WHO Z-scores (WAZ/HAZ/WHZ) stored in `growth_records`, but no numeric BMI value is ever computed or displayed.

**What needs to happen:**

1. **Registration page:** Auto-calculate BMI when both weight and height are entered. Display it next to vitals. Formula: `weight_kg / (height_cm / 100)^2`. For children < 2 years, BMI is less clinically relevant (WHZ is preferred), but should still be calculated and stored.
2. **Schema:** Add `bmi numeric` column to `visits` table (no CHECK constraint needed — the range varies widely by age). Update the committed schema SQL to match.
3. **Save flow:** Include `bmi` in the `visitPayload` at registration save (line ~1844).
4. **Prescription pad:** Display BMI in the vitals info panel (line ~2998). Include BMI in the clinical note pre-fill (`ctx` string, line ~3050) so it reaches the AI.
5. **Edge Function:** No change needed — BMI will flow through `clinical_note` text.

**Also found — vitals NOT passed to AI:**
The clinical note pre-fill (prescription-pad.html lines 3050-3099) includes only weight, temperature, and BP. These 6 vitals are displayed in the UI panel but never written into the `ctx` string sent to the AI:

- `height_cm`
- `hc_cm`
- `muac_cm`
- `hr_per_min`
- `rr_per_min`
- `spo2_pct`

WAZ/growth trend data is also shown in the UI panel but not injected into the clinical note.

**Fix:** Add all vitals + WAZ + BMI to the `ctx` string so they are available to the AI for clinical reasoning.

---

### A2. AI-generated BMI-based caloric dietary recommendation

- **Status:** `[x]`
- **Priority:** Medium
- **Files:** `radhakishan_system/skill/core_prompt.md`, `web/prescription-pad.html`

**Current state:** The AI has no instruction to provide BMI-based dietary recommendations. The `counselling` array in the prescription JSON can contain free-text advice, but there is no specific prompt for caloric guidance.

**What needs to happen:**

1. **Core prompt:** Add instruction in the counselling section: "If BMI is available, include a brief single-statement caloric dietary recommendation based on the child's BMI-for-age classification (underweight/normal/overweight/obese) and age-appropriate caloric needs."
2. **Prescription pad:** Ensure BMI is in the clinical note (covered by A1). The dietary recommendation will appear in the `counselling` array and be rendered in the existing counselling section.
3. **No new UI element needed** — it flows through the existing counselling block.

---

### A3. Generated prescription lost on navigation

- **Status:** `[x]` _(corrected 2026-03-24: draft NOT cleared after signoff per doctor feedback)_
- **Priority:** Critical
- **Files:** `web/prescription-pad.html`

**Implemented:** Auto-persist to localStorage after generation, restore on re-selection, clear stale state on patient switch. Draft persists after sign-off so doctor can revisit.

---

### A4. Newborn age display (months+days) and gestational vs actual age

- **Status:** `[x]`
- **Priority:** Medium
- **Files:** `web/prescription-pad.html`

**Current state:**

- `calcAge()` (line ~5922) shows: `< 28 days` → "14 days", `1-11 months` → "8 months" (no days), `1-2 years` → "1 yr 3 mo", `2+` → "3 years".
- For infants under 1 year, the days component is lost once they pass 28 days (e.g., a 45-day-old shows "1 months" instead of "1 month 17 days").
- Gestational age and corrected age appear only in the neonatal section of the AI JSON. The main patient info strip (line ~4038) shows only `r.patient.age` (chronological). Both ages are not displayed side-by-side on the prescription header.

**What needs to happen:**

1. **Fix `calcAge()`:** For age < 12 months, show "X months Y days" (e.g., "2 months 14 days").
2. **Prescription header:** When `rxData.neonatal` exists and has `corrected` age, display both: "Age: 3 months 5 days (Corrected: 1 month 20 days)" in the patient info strip.
3. **AI instruction:** The core prompt already instructs preterms to use corrected age for growth/development (line ~279). No change needed there, but the display should show both clearly.
4. **Print output:** Same dual-age display in the printed prescription header.

---

### A5. Prescription sequential numbering

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/prescription-pad.html`, potentially `radhakishan_system/schema/radhakishan_supabase_schema.sql`

**Current state:** Prescription IDs are generated client-side using `"RX-" + Date.now().toString().slice(-8)` (line ~4803). This produces non-sequential, non-human-readable IDs like `RX-02345678`. There is collision risk if two prescriptions are created within the same 100M millisecond window.

**What needs to happen:**

1. **Sequential format:** `RX-YYMMDD-NNN` where `NNN` is a daily sequential counter (e.g., `RX-260324-001`, `RX-260324-002`).
2. **Database-backed counter:** Query existing prescriptions for today to determine the next sequence number (similar to `generateUHID()` logic). Use pattern: `SELECT id FROM prescriptions WHERE id LIKE 'RX-260324-%' ORDER BY id DESC LIMIT 1`.
3. **Collision safety:** The `prescriptions.id` has a UNIQUE constraint, so a collision will fail gracefully. Add retry logic (up to 3 attempts) on conflict.

---

### A6. AI-generated warning signs based on diagnosis

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/prescription-pad.html`, `radhakishan_system/skill/core_prompt.md`

**Current state:** Warning signs are entirely hardcoded in 3 constant arrays (lines ~1924-1955): `EMERGENCY_BASE` (6 signs for all ages), `EMERGENCY_INFANT` (4 for < 12 months), `EMERGENCY_CHILD` (4 for >= 12 months). The AI has no field in its JSON output for emergency/warning signs. The section is always the same regardless of diagnosis.

**What needs to happen:**

1. **Add to AI JSON schema:** Add `"warning_signs": [{"hi": "string", "en": "string"}]` to the prescription output schema in `core_prompt.md`.
2. **AI instruction:** "Generate 4-6 diagnosis-specific warning signs in both Hindi (Devanagari) and English. Include the universal emergency signs plus signs specific to the diagnosed condition (e.g., for pneumonia: worsening cough, chest indrawing; for GE: persistent vomiting, blood in stool, signs of dehydration)."
3. **Prescription pad rendering:** Replace the hardcoded `getEmergencySigns()` call with rendering from `rxData.warning_signs`. Keep the hardcoded arrays as a fallback if the AI doesn't provide them.
4. **Print output:** Same — render from `rxData.warning_signs` with hardcoded fallback.

**Also check developmental screening:** The AI has a `developmental` section in the JSON schema (core_prompt lines 150-153) and a `developmental.md` reference file. The AI only includes it when the doctor activates the "developmental" section chip. The reference is adequate (7 screening tools, 8 red flags, preterm corrected-age rule). No changes needed unless the doctor wants it auto-included for specific age groups.

---

### A7. Hindi/English language switch for counselling and warning signs

- **Status:** `[x]` _(corrected 2026-03-24: moved select to sticky tabs bar for visibility)_
- **Priority:** Medium
- **Files:** `web/prescription-pad.html`, `radhakishan_system/skill/core_prompt.md`

**Implemented:** Language select dropdown (Bilingual/Hindi/English) in the sticky tabs bar with transparent/white styling. Passes LANGUAGE instruction to AI. Rendering respects language choice for counselling and warning signs.

---

### A8. AI recommending follow-up after 1 day when admission is indicated

- **Status:** `[x]` _(corrected 2026-03-24: explicit `admission_recommended` field instead of referral-based)_
- **Priority:** High
- **Files:** `radhakishan_system/skill/core_prompt.md`, `web/prescription-pad.html`

**Implemented:** Added `admission_recommended` field to AI JSON schema (string or null). AI sets it with reason when admission needed + sets `followup_days` to null. UI shows "ADMISSION RECOMMENDED" badge with reason. Sign-off button changes to "Approve ADMISSION & save" (red).

---

### A9. AI blocking contraindicated medications prescribed by doctor

- **Status:** `[x]`
- **Priority:** High
- **Files:** `radhakishan_system/skill/core_prompt.md`

**Current state:** The core prompt (lines ~229-249) instructs the AI to: substitute if allergy match, flag interactions, cap at max dose, and set `overall_status` to "REVIEW REQUIRED". However, the instruction for contraindicated drugs is ambiguous — for allergies it says "STOP, choose alternative." This can cause the AI to omit a drug the doctor explicitly prescribed.

The doctor expects: if they write "Give Drug X" in their note, the AI should include Drug X in the prescription with a clear safety flag, not silently substitute or omit it.

**What needs to happen:**

1. **Core prompt clarification:** Add explicit rule:
   ```
   DOCTOR OVERRIDE RULE:
   - If the doctor explicitly prescribes a specific medication in the clinical note,
     ALWAYS include it in the prescription output — even if it has contraindications,
     interactions, or allergy concerns.
   - Add a prominent `flag` on the medicine: "CONTRAINDICATED: [reason] — prescribed
     per doctor's explicit instruction"
   - Set `overall_status` to "REVIEW REQUIRED"
   - Include a `safety.note` explaining the contraindication and that the doctor has
     chosen to proceed
   - NEVER silently omit or substitute a drug the doctor explicitly named
   ```
2. **Prescription pad:** Add a visual confirmation step if `overall_status === "REVIEW REQUIRED"` — show a modal before sign-off listing all safety flags, requiring the doctor to acknowledge each one.

---

### A10. Sync vaccination schedule from registration to prescription pad

- **Status:** `[x]`
- **Priority:** Medium
- **Files:** `web/registration.html`, `web/prescription-pad.html`, `radhakishan_system/schema/radhakishan_supabase_schema.sql`

**Current state:** The vaccination schedule choice (NHM vs IAP) at registration is a JavaScript-only in-memory variable (`activeVaxSchedule`). It is never saved to the database. The `visits` table has no `vax_schedule` column. At the prescription pad, the doctor must manually click "NHM Vacc." or "IAP Vacc." — there is no auto-selection based on what reception chose.

**What needs to happen:**

1. **Schema:** Add `vax_schedule text CHECK (vax_schedule IN ('nhm', 'iap'))` column to `visits` table.
2. **Registration save:** Include `vax_schedule: activeVaxSchedule` in `visitPayload`.
3. **Prescription pad load:** Read `visit.vax_schedule` when loading today's patients. In `onPatientSelect()`, auto-activate the corresponding vaccination chip button (`activeMods.add("vax-nhm")` or `activeMods.add("vax-iap")`).
4. **Visual indicator:** Highlight the pre-selected vaccination button so the doctor sees which schedule was chosen at reception.

---

### A11. Show BP percentile and BMI calculation at reception

- **Status:** `[x]`
- **Priority:** Medium
- **Files:** `web/registration.html`

**Current state:**

- **BP percentile:** Already implemented at registration (lines 1369-1438). `calcMAP()` computes the centile using AAP 2017 tables and displays it in a `#bp-centile` div, color-coded (green/amber/red). However, for age < 1 year it shows "Age < 1yr (use neonatal norms)" — no percentile is calculated.
- **BMI:** Not calculated or displayed at reception (covered in A1).

**What needs to happen:**

1. **BMI display:** Add a read-only BMI display field near weight/height. Auto-calculate on input of both fields. Show BMI-for-age classification for children (underweight/normal/overweight/obese using WHO/IAP cutoffs).
2. **BP percentile — already works** for ages 1-18. For neonates (< 1 year), consider adding neonatal BP norms or keeping the current "use neonatal norms" message.
3. **Save BMI to DB:** Covered in A1.

---

## Section B — Code Review Issues (from automated deep review)

### B-I. Security & Authentication Issues

#### B1. Critical Security Issues

##### B1.1 No authentication on any Edge Function

- **Status:** `[ ]`
- **Priority:** Critical
- **Files:** All 10 `supabase/functions/*/index.ts`
- **Issue:** No caller authentication. Anyone can invoke `generate-fhir-bundle` to exfiltrate patient records, `generate-prescription` to burn Claude API credits, or ABDM functions to process fake consent.
- **Fix:** Verify JWT (`supabase.auth.getUser(token)`) on all functions. Add rate limiting.

##### B1.2 Anon key hardcoded everywhere

- **Status:** `[ ]`
- **Priority:** Critical
- **Files:** All 10 Edge Functions, all 8 web pages, 4 import scripts
- **Issue:** Supabase anon key (expires 2089) hardcoded in source. Combined with `anon_full_access` RLS, anyone can CRUD all patient data.
- **Fix:** Edge Functions: use `Deno.env.get("SUPABASE_ANON_KEY")`. Web pages: acceptable for POC but document the risk. Import scripts: use env vars (pattern exists in `import_data.js`).

##### B1.3 Patient data exfiltration via generate-fhir-bundle

- **Status:** `[ ]`
- **Priority:** Critical
- **Files:** `supabase/functions/generate-fhir-bundle/index.ts` line ~1487
- **Issue:** Accepts `patient_id` from unauthenticated POST, returns complete FHIR bundle.
- **Fix:** Require valid Supabase user JWT. Add consent verification for ABDM-initiated calls.

##### B1.4 ABDM gateway requests not validated

- **Status:** `[ ]`
- **Priority:** Critical
- **Files:** `abdm-hip-discover`, `abdm-hip-link`, `abdm-hip-consent`, `abdm-hip-data-transfer`
- **Issue:** `validateGatewayRequest()` only checks header presence, then processes anyway with `console.warn`.
- **Fix:** Implement ABDM gateway JWT signature verification. Reject (not warn) invalid requests.

##### B1.5 PHI pushed unencrypted to attacker-controlled URL

- **Status:** `[ ]`
- **Priority:** Critical
- **Files:** `supabase/functions/abdm-hip-data-transfer/index.ts` line ~380
- **Issue:** `dataPushUrl` from request body. No domain validation, no encryption, no auth.
- **Fix:** Validate URL against ABDM gateway domain. Implement Fidelius ECDH encryption.

##### B1.6 Schema DROP TABLE CASCADE at top of production schema

- **Status:** `[ ]`
- **Priority:** Critical
- **Files:** `radhakishan_system/schema/radhakishan_supabase_schema.sql` lines 13-19
- **Issue:** Running schema file destroys all patient data.
- **Fix:** Move to separate `reset_dev_schema.sql`. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for migrations.

##### B1.7 create_sample_data.js deletes all data with no guard

- **Status:** `[ ]`
- **Priority:** Critical
- **Files:** `radhakishan_system/scripts/create_sample_data.js` lines 51-61
- **Issue:** Deletes ALL rows from ALL tables with no env check, no confirmation.
- **Fix:** Add `NODE_ENV !== 'production'` guard, `--dry-run` mode, confirmation prompt.

#### B2. Critical XSS Issues

##### B2.1 Single-quote injection in onclick attributes (prescription-pad)

- **Status:** `[ ]`
- **Priority:** Critical
- **Files:** `web/prescription-pad.html` lines 5396, 5451, 5732
- **Issue:** Drug/investigation names interpolated into `onclick='selectAddMed("${name}")'` without single-quote escaping. Names with `'` break out of the JS string.
- **Fix:** Use `data-*` attributes and `addEventListener` instead of inline onclick.

##### B2.2 postMessage handler accepts any origin (prescription-pad)

- **Status:** `[ ]`
- **Priority:** Critical
- **Files:** `web/prescription-pad.html` line 3920
- **Issue:** No `e.origin` check. Any page can inject arbitrary prescription JSON.
- **Fix:** Add `if (e.origin !== location.origin) return;`.

##### B2.3 dose_display rendered without esc() (prescription-output)

- **Status:** `[ ]`
- **Priority:** Critical
- **Files:** `web/prescription-output.html` line 686
- **Issue:** `p.dose_display` from AI JSON rendered without `esc()` in `renderDoseIcon()` fallback.
- **Fix:** Change to `${esc(p.dose_display || "")}`.

#### High Security Issues (moved from other subsections)

##### B4.1 PostgREST injection via AI-generated drug names

- **Status:** `[ ]`
- **Priority:** High
- **Files:** `supabase/functions/generate-prescription/index.ts` line 175
- **Issue:** Drug names from Claude tool calls interpolated into URL filter.
- **Fix:** Validate against `/^[A-Za-z\s\-\/\(\)]+$/`.

##### B4.7 Accepts arbitrary JSON as FHIR health data

- **Status:** `[ ]`
- **Priority:** High
- **Files:** `supabase/functions/abdm-hiu-data-receive/index.ts` line 313
- **Fix:** Reject plain-JSON in production. Validate FHIR Bundle schema.

##### B5.1 RLS mismatch: policies use authenticated but app uses anon

- **Status:** `[ ]`
- **Priority:** High
- **Files:** `radhakishan_system/schema/radhakishan_supabase_schema.sql` lines 469-495
- **Fix:** Align policy with actual auth model.

##### B5.2 lab_results has RLS enabled but NO policy (deny-all)

- **Status:** `[ ]`
- **Priority:** High
- **Files:** `radhakishan_system/schema/radhakishan_supabase_schema.sql` line 476
- **Fix:** Add RLS policy for `lab_results`.

#### Medium Security Issues (moved from other subsections)

##### B6.12 Patient UHID logged in plaintext (generate-visit-summary)

- **Files:** `supabase/functions/generate-visit-summary/index.ts` line 163
- **Fix:** Remove or hash.

##### B6.14 postMessage target hardcoded to claude.ai (patient-lookup)

- **Files:** `web/patient-lookup.html` lines 1046-1053
- **Fix:** Use `location.origin`.

#### Low Security Issues (moved from other subsections)

- B7.1 No `<meta name="robots" content="noindex">` on any page
- B7.23 message event listener no origin check (patient-lookup)

---

### B-II. Functional, Data Integrity & Code Quality Issues

#### B3. High — Data Integrity

##### B3.1 State carryover between patients (registration)

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/registration.html` lines 2157, 3353
- **Issue:** `cancelForm()` and `resetAll()` don't reset `labEntries`, `existingVax`, `proceduresList`. Next patient inherits previous patient's data.
- **Fix:** Add `labEntries = []; existingVax = []; proceduresList = []; currentVisitId = null;` to both functions.

##### B3.2 Fee/payment read from DOM after innerHTML clear (registration)

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/registration.html` line 2061
- **Issue:** `f-fee`, `f-pay-mode`, `f-pay-status` read after `innerHTML=""`. Receipt always shows ₹0/Cash/Pending.
- **Fix:** Read values before clearing DOM, or use `lastToken` data.

##### B3.3 toast() undefined — should be showToast() (registration)

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/registration.html` lines 3604, 3622, 3629
- **Issue:** `toast()` is never defined. Crashes `verifyAbha()`.
- **Fix:** Replace `toast(...)` with `showToast(...)`.

##### B3.4 UHID generation race condition (registration)

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/registration.html` lines 653-680
- **Issue:** No lock/sequence. Concurrent registrations can generate same UHID.
- **Fix:** Use PostgreSQL sequence or retry on unique constraint violation.

##### B3.5 JE vaccine in Haryana NHM schedule (registration)

- **Status:** `[x]`
- **Priority:** High (Clinical safety)
- **Files:** `web/registration.html` lines 1326, 1338
- **Issue:** JE vaccine included in NHM schedule but NOT routine in Haryana (not endemic).
- **Fix:** Remove `{ n: "JE", d: 1 }` and `{ n: "JE", d: 2 }` from `NHM_SCHEDULE`.

##### B3.6 IAP vaccination pre-selected — spec says neither (registration)

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/registration.html` lines 1149, 1346
- **Issue:** `activeVaxSchedule = "iap"` on load. Spec says neither pre-selected.
- **Fix:** Initialize `activeVaxSchedule = null`. Style both buttons inactive by default.

##### B3.7 Neonatal threshold 90 days — spec says 28 days (registration)

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/registration.html` lines 1050-1054
- **Issue:** Neonatal section shows for age < 90 days. CLAUDE.md says < 28 days.
- **Fix:** Change to `ageDays < 28`.

##### B3.8 Auto-save listener accumulates (prescription-pad)

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/prescription-pad.html` lines 2909-2923
- **Issue:** `addEventListener("input")` added on every patient selection, never removed.
- **Fix:** Store listener ref, `removeEventListener` before adding new one.

##### B3.9 Race condition in onPatientSelect (prescription-pad)

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/prescription-pad.html` lines 2956-3190
- **Issue:** Rapid patient switching causes interleaved async updates.
- **Fix:** Track `currentLoadId` counter, check in each async continuation.

##### B3.10 window.open() not null-checked in printRx (prescription-pad)

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/prescription-pad.html` line 5296
- **Issue:** Popup blocker returns null, crashes print flow.
- **Fix:** Add `if (!w) { alert("Please allow pop-ups to print."); return; }`.

##### B3.11 showToast() ignores error flag (registration)

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/registration.html` lines 3236, 3443
- **Issue:** Second argument ignored. Errors show in green like success.
- **Fix:** Add `isError` parameter and red CSS class.

##### B3.12 btn may be null in finally block (registration)

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/registration.html` lines 2104-2107
- **Issue:** Crash in `finally` suppresses original save error.
- **Fix:** Wrap `finally` block with `if (btn) { ... }`.

##### B3.13 Filter/select index mismatch (prescription-output)

- **Status:** `[x]`
- **Priority:** High
- **Files:** `web/prescription-output.html` lines 961-1028
- **Issue:** `onRxSelect()` re-filters independently. Wrong Rx may render after filter change.
- **Fix:** Store `displayedRxRows` at module level, read from that in `onRxSelect()`.

#### B4. High — Edge Function Issues (non-security)

##### B4.2 extractJSON unguarded — generic 500 on parse failure

- **Status:** `[x]`
- **Priority:** High
- **Files:** `supabase/functions/generate-prescription/index.ts` line 501
- **Fix:** Wrap in try/catch, log raw text, return structured error.

##### B4.3 Tool-use loop has no timeout

- **Status:** `[x]`
- **Priority:** High
- **Files:** `supabase/functions/generate-prescription/index.ts` line 358
- **Fix:** Set `AbortController` timeout at 120s. Detect repeated identical tool calls.

##### B4.4 Schema mismatch: abdm-hip-data-transfer vs generate-fhir-bundle

- **Status:** `[ ]` _(deferred — ABDM/FHIR)_
- **Priority:** High
- **Files:** `abdm-hip-data-transfer/index.ts` + `generate-fhir-bundle/index.ts`
- **Issue:** Data-transfer sends `patientId`/`hiTypes`, FHIR expects `patient_id`/`type`. Always fails.
- **Fix:** Align schemas.

##### B4.5 Consent stored without patient_id — breaks data transfer

- **Status:** `[ ]` _(deferred — ABDM/FHIR)_
- **Priority:** High
- **Files:** `supabase/functions/abdm-hip-consent/index.ts` line 110
- **Fix:** Implement full artefact fetch from ABDM or store patient mapping.

##### B4.6 FHIR bundle generated but never persisted to DB

- **Status:** `[ ]` _(deferred — ABDM/FHIR)_
- **Priority:** High
- **Files:** `supabase/functions/generate-fhir-bundle/index.ts` line 1665
- **Fix:** PATCH `prescriptions.fhir_bundle` after generation.

#### B5. High — Schema Issues (non-security)

##### B5.3 patient_id nullable in vaccinations and growth_records

- **Status:** `[x]`
- **Priority:** High
- **Files:** `radhakishan_system/schema/radhakishan_supabase_schema.sql` lines 329, 357
- **Fix:** Add `NOT NULL`.

##### B5.4 licensed_in_children type mismatch (text vs boolean)

- **Status:** `[x]`
- **Priority:** High
- **Files:** `radhakishan_system/schema/radhakishan_supabase_schema.sql` line 36
- **Fix:** Align JSON data and schema type.

##### B5.5 BP columns missing from committed schema DDL

- **Status:** `[x]`
- **Priority:** High
- **Files:** `radhakishan_system/schema/radhakishan_supabase_schema.sql`
- **Issue:** `bp_systolic`, `bp_diastolic`, `map_mmhg` exist in live DB but not in committed schema. Schema drift.
- **Fix:** Add columns to schema SQL.

#### B6. Medium Issues (non-security)

##### B6.1 Nebulisation mapped to transdermal SNOMED code _(deferred — FHIR)_

- **Files:** `generate-fhir-bundle/index.ts` line 125
- **Fix:** Use correct SNOMED code for nebulisation.

##### B6.2 FHIR confidentiality "V" should be "N" for routine OPD _(deferred — FHIR)_

- **Files:** `generate-fhir-bundle/index.ts` line 845

##### B6.3 Undefined CSS vars --brd and --ink1 (prescription-pad)

- **Files:** `web/prescription-pad.html` lines 678, 690, 2767, 2769
- **Fix:** Change to `--bdr2` and `--ink2`.

##### B6.4 Tabs bar sticky top:0 overlaps header (prescription-pad)

- **Files:** `web/prescription-pad.html` lines 163-171

##### B6.5 saveNote() doesn't check HTTP response (prescription-pad)

- **Files:** `web/prescription-pad.html` lines 2934-2953
- **Fix:** Check `r.ok` before showing "Saved".

##### B6.6 All checked vaccines saved as given_today regardless of status

- **Files:** `web/prescription-pad.html` lines 4769-4780
- **Fix:** Only include items with status dropdown = "completed".

##### B6.7 Address field never saved (registration)

- **Files:** `web/registration.html` line 967
- **Fix:** Either save or remove the field.

##### B6.8 N+1 sequential INSERTs for vaccinations/labs (registration)

- **Files:** `web/registration.html` lines 1906-1963
- **Fix:** Batch insert via array POST.

##### B6.9 editVisit() dead code (registration)

- **Files:** `web/registration.html` lines 3367-3421
- **Fix:** Remove or wire up.

##### B6.10 ABHA Verify button non-functional (registration) _(deferred — ABHA)_

- **Files:** `web/registration.html` lines 3601-3631
- **Fix:** Disable until Edge Function deployed.

##### B6.11 Fallback skill.md URL wrong path (generate-prescription)

- **Files:** `supabase/functions/generate-prescription/index.ts` line 464
- **Fix:** Update to correct Storage path.

##### B6.13 DENIED consent update matches wrong column _(deferred — ABDM)_

- **Files:** `supabase/functions/abdm-hip-consent/index.ts` line 168

##### B6.15 Delete PATCH failure silently ignored (formulary, standard-rx)

- **Files:** `web/formulary.html`, `web/standard-rx.html`
- **Fix:** Add error feedback.

##### B6.16 No transaction on formulary import — partial imports

- **Files:** `web/formulary-import.html` lines 996-1048

##### B6.17 Sequential import 120ms delay — 63+ seconds for 530 drugs

- **Files:** `web/formulary-import.html` line 1047
- **Fix:** Batch upsert.

##### B6.18 No CHECK on blood_group (schema)

- **Files:** `radhakishan_system/schema/radhakishan_supabase_schema.sql` line 218

##### B6.19 icd10 nullable in standard_prescriptions (schema)

- **Files:** `radhakishan_system/schema/radhakishan_supabase_schema.sql` line 160

##### B6.20 doctor_id not FK-enforced in visits (schema)

- **Files:** `radhakishan_system/schema/radhakishan_supabase_schema.sql` line 243

##### B6.21 care*context_ref missing UNIQUE constraint (ABDM schema) *(deferred — ABDM)\_

- **Files:** `radhakishan_system/schema/abdm_schema.sql` line 76

##### B6.22 loinc_investigations table not defined in schema

- **Files:** Referenced by `import_loinc.js` but absent from DDL

##### B6.23 Upsert uses non-unique diagnosis_name as key (import_data)

- **Files:** `radhakishan_system/scripts/import_data.js` lines 110-113

##### B6.24 Errors silently swallowed after 3rd failure (import_data)

- **Files:** `radhakishan_system/scripts/import_data.js` lines 87-91

#### B7. Low Issues (non-security)

- B7.2 connectDB() called 2-3x on load (patient-lookup, standard-rx)
- B7.3 showNewPatientForm() doesn't reset currentVisitId (registration)
- B7.4 calcAge() timezone offset near midnight (registration)
- B7.5 Receipt number uses Math.random() — not guaranteed unique
- B7.6 Silent auto-change of visit type to follow-up (registration)
- B7.7 enhanceDocument() blocks main thread (registration)
- B7.8 URL.createObjectURL() not revoked — memory leak (prescription-pad)
- B7.9 CSS color comparison fragile cross-browser (prescription-pad)
- B7.10 Hindi font may not load before print() (prescription-pad)
- B7.11 ABHA identifier uses wrong FHIR type code "MR" (FHIR bundle) _(deferred — FHIR)_
- B7.12 occurrenceDateTime can be undefined — required FHIR field _(deferred — FHIR)_
- B7.13 Vital sign CHECK ranges allow implausible values (schema)
- B7.14 serial PK on 4 tables — inconsistent with UUID pattern (schema)
- B7.15 Unnecessary pgcrypto extension (schema)
- B7.16 Deno std@0.177.0 pinned to 2+ year old version (Edge Functions)
- B7.17 Redundant index on formulary.generic_name (schema)
- B7.18 No GIN indexes on formulary JSONB fields (schema)
- B7.19 Denormalized patient_id on prescriptions — no consistency check
- B7.20 generateAndUploadPDF() uploads .txt not PDF (prescription-pad)
- B7.21 Double-encoding of esc() values passed to JS then esc() again
- B7.22 startImport() and importValidOnly() identical (formulary-import)
- B7.24 Vaccination chip state not preserved through patient reset
- B7.25 cancelUpdate() triggers full expensive patient reload
