# 08 — Specification & Known Issues (R8)

**Slice:** Specification documents, code-review findings, planning notes, release notes — the synthesis of "what we already decided, what is fixed, what is still open."
**Source corpus:** `radhakishan_system/docs/specification/`, `radhakishan_system/docs/code-review/`, `radhakishan_system/docs/planning/`, `radhakishan_system/docs/release-notes/`, `radhakishan_system/docs/architecture/ARTIFACT_INVENTORY.md`, `radhakishan_system/docs/clinical/CLINICAL_RULES_SUMMARY.md`, `radhakishan_system/docs/clinical/dosing_reference_guide.md`, `radhakishan_system/docs/SETUP_GUIDE.md`, `radhakishan_system/docs/README.md`.
**Audience:** Anyone joining the project who needs the institutional memory before touching code. This is the index of decisions and the live bug ledger.
**Last reviewed:** 2026-04-27 (R8 wave).

---

## 1. Purpose & Scope

This document is the canonical pointer to:

1. The clinical and technical **specification** of the system as it has evolved between January and March 2026.
2. The accumulated **code-review findings** — both resolved and open.
3. **Planning artefacts** that describe paths not yet taken (SDK migration, voice transcription upgrade, ABDM hardening).
4. **Release notes** that capture what shipped on a given date.

It is read-only memory. New design decisions go elsewhere; corrections to the record go here.

### Out of scope

- ABDM transport/security details (covered by R5).
- Schema column-by-column documentation (covered by R6).
- Edge Function internals (covered by R4).

---

## 2. The Specification Corpus (what's in `docs/specification/`)

| File                                       | Purpose                                                                                                        | Status                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `radhakishan_specification.md`             | Master spec. 17 chapters. Hospital, problem statement, architecture, schema, web pages, skill, NABH, dosing.   | Current (March 2026 edition).                                   |
| `claude_ai_data_context.md`                | Defines exactly which formulary fields `condenseDrugForAI()` sends to Claude vs strips. ~1,312 tokens example. | Current.                                                        |
| `dose_calculator_spec.md`                  | Behavior of the inline dose calculator panel. 9 sections, 9 known limitations.                                 | Current. Last verified 2026-03-25.                              |
| `combo_drug_dosing_proposal.md`            | Proposal: per-ingredient dosing inside `ingredient_doses[]`.                                                   | Implemented (see §6 chronology).                                |
| `ingredient_doses_migration_plan.md`       | Plan to migrate all 671 dosing bands to `ingredient_doses[]` and remove band-level dose fields.                | Implemented.                                                    |
| `wire_ingredient_doses_plan.md`            | 12-fix plan to wire UI/engine to the new `ingredient_doses[]` shape after migration.                           | Implemented.                                                    |
| `universal_dose_calculator_plan.md`        | Plan to introduce `web/dose-engine.js` as a universal first-principles calculator.                             | Implemented.                                                    |
| `standard_rx_structure_comparison.md`      | DB (469 rows) vs new JSON files (56 rows): field-by-field gap.                                                 | Schema gaps closed; data backfill partially shipped.            |
| `missing_standard_prescription_sections.md` | Six new sections (expected_course, parent_counselling_hi, key_clinical_points, severity_assessment, monitoring_parameters, step_down) absent from PDF protocols. | Partially shipped (4 of 6 fields populated for 56 protocols).   |

> **DECISION (chronology):** "Eliminate all mandatory structured input fields. The doctor's clinical note is the only required input." — `radhakishan_specification.md` §2.1, March 2026 edition. This single decision is the root cause of every other architectural choice in the spec.

---

## 3. Architectural Decisions Recorded in the Spec

The master specification calls these out as `> _DECISION:_` blocks. They are binding for the project until explicitly reversed.

| ID  | Decision                                                                                                                                  | Source                                | Status   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------- |
| D-A | One free-text clinical note + Generate. No HMIS forms.                                                                                    | `radhakishan_specification.md` §2.1   | Binding. |
| D-B | Migrate from Claude.ai Artifacts to Edge Function + Claude API after POC validation.                                                      | §2.3                                  | Done.    |
| D-C | Progressive disclosure: 5 tools (`get_reference`, `get_formulary`, `get_standard_rx`, `get_previous_rx`, `get_lab_history`).              | §3.3                                  | Done.    |
| D-D | NABH compliance reference is always fetched; antibiotic stewardship reference is fetched whenever antibiotics are prescribed.             | §3.3                                  | Done.    |
| D-E | All knowledge in Supabase. No Google Drive.                                                                                               | §3.5                                  | Done.    |
| D-F | Separate quantity from unit in formulary. Never store `'40mg/kg'` as a single string.                                                     | §4.2 Decision 1                       | Done.    |
| D-G | Multiple dosing bands per drug (JSONB array).                                                                                             | §4.2 Decision 2                       | Done.    |
| D-H | Six supported dosing methods: weight, BSA, fixed, GFR, infusion, age/GA-tier.                                                             | §4.2 Decision 3                       | Done.    |
| D-I | When Indian commercial concentration (MIMS/CIMS) differs from international formulary, Indian concentration takes precedence.             | §4.3.1                                | Binding. |
| D-J | ICD-10 is primary key for standard prescription lookup; diagnosis name is fallback.                                                       | `CLINICAL_RULES_SUMMARY.md` rule 6    | Done.    |
| D-K | Per-ingredient dosing (`ingredient_doses[]`) is the single source of truth. Band-level `dose_min/max_qty` fields removed after migration. | `ingredient_doses_migration_plan.md`  | Done.    |
| D-L | Universal slider for all methods (no fixed-dose stepper).                                                                                 | `universal_dose_calculator_plan.md`   | Done.    |
| D-M | Doctor override rule: if the doctor explicitly names a drug, AI must include it (with flag), never silently substitute.                   | `core_prompt.md` lines 243-250 (A9)   | Done.    |
| D-N | Explicit `admission_recommended` field (string-or-null) replaces inference from `followup_days == null && referral`.                      | `section_a_resolution_notes.md` A8    | Done.    |
| D-O | RLS POC posture: `anon_full_access` for the pilot. Per-doctor policies deferred.                                                          | `CODE_REVIEW_ISSUES.md` D-1 (R23)     | Done (POC). |

---

## 4. Clinical Rules That Are Binding

From `clinical/CLINICAL_RULES_SUMMARY.md` and `clinical/dosing_reference_guide.md`. These propagate to the core prompt and the dose engine.

- **3-row medicine format** with Hindi (Devanagari) Row 3 mandatory.
- **Colour coding:** Royal Blue = medicines, Red = investigations, Black = everything else.
- **Six dosing methods:** weight, BSA, GFR-adjusted, fixed, infusion, age/GA-tier.
- **Rounding:** Syrup → 0.5 mL, Drops → 0.1 mL, Tablet → ¼ tab, Injection → 0.1 mL, Insulin → whole unit.
- **Maximum dose rule:** Calculated dose MUST NEVER exceed published max. Apply max and flag.
- **Preterms:** CORRECTED age for growth/development, CHRONOLOGICAL age for vaccinations. Hold corrected age until 2 years chronological.
- **Growth charts:** Fenton 2013 (NICU/preterm < 40wks), WHO 2006 (term 0–5y or preterm post-discharge until 2yr corrected), IAP 2015 (5–18y).
- **WHO Z-score thresholds and MUAC:** SAM < 11.5 cm, MAM 11.5–12.5 cm, normal ≥ 12.5 cm.
- **Triage:** 10-parameter score; 0–1 routine, 2–3 priority, 4–6 urgent, ≥7 emergency.
- **NABH:** 20-section minimum on every prescription; mandatory `nabh_compliance` reference fetch every call.
- **Haryana vaccination:** PCV + Rotavirus free under NHM, no JE (not endemic). JE was removed from `NHM_SCHEDULE` (B3.5).

---

## 5. The Code Review Corpus

Two parallel ledgers live in `docs/code-review/`:

- `CODE_REVIEW_ISSUES.md` — the original triage from March 2026 (FN, BP, D series). All 32 of its R-numbered items are RESOLVED, plus D-10 (audit log), D-13 (doctor PIN auth), D-19 (NABH cert no.) explicitly DEFERRED.
- `ISSUES.md` — a much larger live tracker started 2026-03-24. Two halves: Section A (user-reported A1–A11) and Section B (deep-review B1–B7 with sub-numbers).

### What was already RESOLVED (snapshot — 30 March 2026)

- **Section A:** A1–A11 all `[x]` (BMI, dietary advice, draft persistence, infant age display, sequential RX numbering, AI warning signs, language switch, admission flag, doctor override, vax schedule sync, BP percentile/BMI at reception). Verification: 94/94 live integration test PASS.
- **Section B-II (Functional/Data Integrity):** 50 issues resolved, 10 ABDM/FHIR/ABHA-related deferred. Independent verification 50/50 PASS.
- **Section C (post-review corrections):** 17 items addressed (draft persistence, language chevron, Admit chip, restore button, OCR-all-types, growth trend, sequential receipts, schema drift fix).

Resolution detail and exact line numbers live in:

- `section_a_resolution_notes.md`
- `section_b2_resolution_notes.md`
- `section_c_resolution_notes.md`
- `data_contract_audit.md` (17 PASS, 2 fixed contracts)
- `integration_audit_20260325.md` (11/11 steps PASS, "PRODUCTION READY")

---

## 6. Chronology of Significant Decisions

| Date         | Event                                                                                                             | Source                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Jan–Feb 2026 | POC built as Claude.ai Artifacts. Validates clinical workflow, prompt, JSON schema.                               | spec §2.3                                |
| March 2026   | Production migration: standalone web app + Edge Function + Claude API tool_use. Schema migration, 530-drug import. | spec §2.3                                |
| 2026-03-22   | Code review (V1) on document attachment + visit summary flow. Identifies critical gap: docs not loaded on pad.    | `code_review_documents_and_summaries.md` |
| 2026-03-23   | Code review (V2) on document upload → OCR → save → display. 20 findings (4 critical, 9 important, 7 minor).        | `code_review_document_flow_v2.md`        |
| 2026-03-24   | Sections A + B-II + C all resolved & verified. 53 bugs + 11 features fixed. 17 contracts audited.                 | section_*_resolution_notes.md            |
| 2026-03-24   | Doctor update notes ("What's New") sent to Dr. Lokender Goyal. Standard Rx protocols (24) imported.               | `doctor_update_notes_20260324.md`        |
| 2026-03-25   | End-to-end integration audit. 11/11 steps PASS. Marked PRODUCTION READY.                                          | `integration_audit_20260325.md`          |
| 2026-03-25–27 | Universal Dose Calculator + ingredient_doses[] + 55 new standard protocols + Hindi translations + SNOMED CT codes. 137/137 live tests PASS. | `release-notes/update_20260327.md`       |
| 2026-04-27   | R8 documentation slice (this doc).                                                                                | this doc                                 |

---

## 7. Specification ↔ Implementation Drift Watch

These are points where the spec text and the live system can drift, recorded for the next reviewer to verify periodically.

1. **Neonatal threshold.** `CLAUDE.md` originally said "<28 days," code uses `< 90 days`. Resolution (B3.7): CLAUDE.md was updated to match the code. The 90-day threshold is the correct clinical pediatric cutoff for showing neonatal fields. Verify CLAUDE.md still matches `web/registration.html` line ~1055.
2. **BP norms < 1 year.** UI shows "Age < 1yr (use neonatal norms)" with no percentile calculation. Spec rule unchanged; flagged for future neonatal BP table addition (A11).
3. **Live DB columns added via ALTER TABLE.** As of C15, seven columns existed in live DB but not in committed schema: `bp_systolic/diastolic/map_mmhg`, `bmi`, `vax_schedule`, `receipt_no`, billing columns. All now in committed DDL. Future ALTER TABLE migrations must update the committed schema in the same commit (see §13 open question).
4. **Standard Rx coverage.** New JSON files exist for only 56 of 469 protocols. The 4 enrichment fields (`expected_course`, `key_clinical_points`, `severity_assessment`, `monitoring_parameters`) are populated only for those 56. The remaining 413 are gaps tracked in §14 follow-ups.
5. **ARTIFACT_INVENTORY.md is stale.** It still references the Claude.ai artifact era ("postMessage to Output artifact"). Pre-migration document. Read it for historical context only; the current architecture is in spec §3.

---

## 8. Where the Spec Meets the Code

| Concern                                  | Spec section                       | Code location (current at this writing)                                            |
| ---------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| Tool-use loop                            | spec §3.3                          | `supabase/functions/generate-prescription/index.ts` `toolUseLoop()` ~line 358      |
| `condenseDrugForAI()` field selection    | `claude_ai_data_context.md`        | `supabase/functions/generate-prescription/index.ts`                                |
| Dose calculator UI                       | `dose_calculator_spec.md`          | `web/prescription-pad.html` lines 2145–2873, 5076–6179 + `web/dose-engine.js`      |
| `ingredient_doses[]` consumer wiring     | `wire_ingredient_doses_plan.md`    | `web/prescription-pad.html` (12 fixes), `web/dose-engine.js`, `web/formulary.html` |
| Universal dose engine                    | `universal_dose_calculator_plan.md` | `web/dose-engine.js`                                                               |
| Core prompt v2026.2 (6 dosing methods)   | spec §3.3, R38                     | `radhakishan_system/skill/core_prompt.md`                                          |
| Doctor override rule                     | `section_a_resolution_notes.md` A9 | `radhakishan_system/skill/core_prompt.md` lines 243–250                            |
| `admission_recommended` field            | `section_a_resolution_notes.md` A8 | `core_prompt.md` schema + `web/prescription-pad.html` toggleAdmit()                |

---

## 9. Known Fragility — Open vs Resolved

This is the single most important section. Each entry references the source so future reviewers can find original context.

### 9.1 OPEN — Critical (security, must address before non-pilot scale-up)

From `ISSUES.md` Section B-I (none yet `[x]`):

| ID    | Description                                                                                                                                  | Source                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| B1.1  | No authentication on any of the 10 Edge Functions. Anyone can invoke `generate-prescription` (burns Claude credits) or `generate-fhir-bundle` (exfiltrate PHI). | `ISSUES.md` B1.1                      |
| B1.2  | Anon key hardcoded in all 10 Edge Functions, all 8 web pages, 4 import scripts. Combined with `anon_full_access` RLS = full CRUD by anyone with the URL. | `ISSUES.md` B1.2                      |
| B1.3  | `generate-fhir-bundle` accepts unauthenticated `patient_id` POST and returns full FHIR bundle.                                                | `ISSUES.md` B1.3                      |
| B1.4  | ABDM gateway `validateGatewayRequest()` only checks header presence then proceeds with `console.warn`. No JWT signature verification.        | `ISSUES.md` B1.4                      |
| B1.5  | `abdm-hip-data-transfer` posts PHI to attacker-controllable `dataPushUrl`. No domain validation, no Fidelius ECDH encryption.                | `ISSUES.md` B1.5                      |
| B1.6  | Schema file begins with `DROP TABLE CASCADE`. Running it on production destroys patient data.                                                 | `ISSUES.md` B1.6                      |
| B1.7  | `create_sample_data.js` deletes all rows from all tables with no env guard, no `--dry-run`, no confirmation.                                  | `ISSUES.md` B1.7                      |
| B2.1  | `web/prescription-pad.html` lines 5396, 5451, 5732 build inline `onclick="selectAddMed('${name}')"` — names with `'` break out.               | `ISSUES.md` B2.1                      |
| B2.2  | `prescription-pad.html` line 3920 `postMessage` handler accepts any origin.                                                                   | `ISSUES.md` B2.2                      |
| B2.3  | `prescription-output.html` line 686 renders `p.dose_display` without `esc()`.                                                                 | `ISSUES.md` B2.3                      |

### 9.2 OPEN — High (functional/data integrity, non-pilot blockers)

| ID    | Description                                                                                                            | Source           |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- |
| B4.1  | PostgREST injection: AI-generated drug names interpolated into URL filter in `generate-prescription` line ~175.        | `ISSUES.md` B4.1 |
| B4.7  | `abdm-hiu-data-receive` accepts arbitrary JSON as FHIR; no schema validation.                                          | `ISSUES.md` B4.7 |
| B5.1  | RLS policies use `authenticated` role, but app authenticates as `anon`. Mismatch.                                      | `ISSUES.md` B5.1 |
| B5.2  | `lab_results` has RLS enabled but **NO POLICY**. Effective deny-all for anon caller (drift from rest of schema).        | `ISSUES.md` B5.2 |

### 9.3 OPEN — Medium

| ID    | Description                                                                                                            | Source           |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- |
| B6.12 | `generate-visit-summary` line 163 logs patient UHID in plaintext.                                                       | `ISSUES.md` B6.12 |
| B6.14 | `patient-lookup.html` lines 1046–1053 hardcodes postMessage target to `claude.ai`.                                      | `ISSUES.md` B6.14 |
| B7.1  | No `<meta name="robots" content="noindex">` on any page.                                                                | `ISSUES.md` B7.1  |
| B7.23 | `patient-lookup.html` message event listener has no origin check.                                                       | `ISSUES.md` B7.23 |

### 9.4 OPEN — Document/OCR Flow (from V2 review)

From `code_review_document_flow_v2.md`:

| #   | Description                                                                                                            | Source            |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | Double OCR execution. Pre-OCR on file selection + server-side OCR on save both call Claude Vision. ~$0.02–0.10 wasted/document. | V2 #1             |
| 2   | Historical lab values from discharge summaries extracted as current. Doctor sees 7 TSB readings as "Recent Labs."      | V2 #2 — clinical safety |
| 3   | `parseFloat("0") || null` loses zero values (e.g., zero reticulocyte count).                                           | V2 #3             |
| 4   | `_saved_to_db: true` set even when all INSERTs fail.                                                                   | V2 #4             |
| 5   | Dead code: `extractDocumentData()` 84 lines.                                                                            | V2 #5             |
| 6   | `URL.createObjectURL` not revoked.                                                                                      | V2 #6             |
| 7   | Category read at file-selection time, not save time.                                                                    | V2 #7             |
| 8   | Inconsistent OCR category lists at lines 3155 vs 3291.                                                                  | V2 #8             |
| 9   | `docUploadCount` and `_preOcrResults` never reset on form clear.                                                        | V2 #9             |
| 10  | HEIC files mislabeled as `image/jpeg`.                                                                                  | V2 #10            |
| 11  | Missing `test_category` in lab_results INSERT from `process-document`.                                                  | V2 #11            |
| 12  | Missing `lab_name` and `reference_range` in lab_results INSERT.                                                          | V2 #12            |
| 13  | Contradictory system prompt in pad mode.                                                                                | V2 #13            |
| 14  | No duplicate prevention for re-processed documents.                                                                     | V2 #14            |
| 15–20 | Minor (process-image called twice, esc() on `ocr_lab_count`, past visits include current, `_from_date` unused, SERVICE_KEY silent fallback, fragile spread on 32K args). | V2 #15–20         |

### 9.5 OPEN — V1 critical (document display)

From `code_review_documents_and_summaries.md` (March 22):

| #  | Description                                                                                                                                  | Status                                |
| -- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1  | Documents uploaded at registration are not displayed on prescription pad. No `loadDocuments()` function.                                     | Partially addressed by 03-27 update — Documents tab now shows OCR summaries. Verify whether original document URLs are still inaccessible. |
| 2  | Visit summary appended to free-text notepad, can be accidentally edited.                                                                     | Partially addressed (separate Clinical Summary panel added 03-27). |
| 3  | `visits.raw_dictation` field collision (registration writes JSON, pad writes free text — pad overwrites).                                    | Open. Requires schema split or dedicated `document_uploads` table. |
| 4  | OCR lab values visible but source documents are not.                                                                                          | Partially addressed.                  |
| 5  | Visit summary doesn't consider lab results / document OCR.                                                                                    | RESOLVED (03-27 update — `generate-visit-summary` now consumes document OCR). |

### 9.6 RESOLVED (snapshot — for cross-reference)

- **CODE_REVIEW_ISSUES.md:** R1–R38 all resolved. D-10 (audit log), D-13 (doctor auth), D-19 (NABH cert no.) deferred.
- **ISSUES.md Section A:** A1–A11 all `[x]`.
- **ISSUES.md Section B-II:** 50/60 closed; 10 ABDM/FHIR/ABHA-related deferred (B4.4, B4.5, B4.6, B6.1, B6.2, B6.10, B6.13, B6.21, B7.11, B7.12).
- **Section C:** all 17 corrections shipped (see chronology in §6).
- **integration_audit_20260325.md:** all 11 steps PASS — production-ready snapshot.
- **release-notes/update_20260327.md:** universal dose calculator, `ingredient_doses[]` migration, 55 new protocols, 137/137 live test PASS.

---

## 10. Data Contract Snapshot (R&D anchors)

`data_contract_audit.md` (2026-03-24) verified 17 contracts PASS. They serve as anchors any time the system is refactored:

- Registration vitals → `visits` table (all 11 vital fields + BP).
- Prescription pad reads `visits` vitals, vax_schedule.
- Prescription pad → Edge Function payload (`clinical_note`, `patient_allergies`, `patient_id`).
- Edge Function tools all return correct fields including `admission_recommended`, `warning_signs` in `get_previous_rx`.
- AI JSON → `renderReview()` and `printRx()` render every section (medicines, investigations, iv_fluids, growth, vaccinations, developmental, diet, referral, neonatal, counselling, warning_signs, admission_recommended).
- `signOff` writes prescriptions, visits, growth_records, vaccinations.
- Language instruction passes to AI.
- Admit chip → INCLUDE SECTIONS → AI.

If any of these breaks during a refactor, R8 considers it a regression against established contract.

---

## 11. Planning Documents — Direction of Travel

`docs/planning/` contains forward-looking documents that are NOT yet shipped. They define the next horizon.

### 11.1 SDK Migration (`SDK_MIGRATION_PLAN.md`)

Migrate from current "GitHub Pages + Edge Function" stack to a full SDK app (React + Anthropic SDK + Node backend) when ANY of these triggers fires:

- > 150 prescriptions/day.
- > 2 doctors concurrent.
- Mobile app needed.
- HIS/EMR integration needed.
- DSC/PKI digital signature required.
- Offline mode required.
- Knowledge base > 5 MB.

Estimated effort: 6–8 weeks, one developer. Cost crossover at ~$138/month (vs current Max plan).

### 11.2 Voice Transcription Upgrade (`voice_transcription_upgrade_plan.md`)

Current: Web Speech API (Chrome-only, no medical vocabulary). Target: OpenAI **GPT-4o Transcribe** (REST + streaming, large prompt window for medical vocabulary, ~₹600–4,500/month).

Plan exists; new Edge Function `transcribe-audio` not yet built. Wispr Flow rejected (no API). OpenAI Whisper rejected (no streaming).

### 11.3 Tasks log (`tasks.md`)

Snapshot of agentic work that completed: dosing bands for 679 drugs (940 bands, 100% coverage), ABDM FHIR refactor across `prescription-pad.html` / `formulary.html` / `formulary-import.html` / `core_prompt.md` / `formulary_lookup_prompt.md`, Standard Rx drug name validation (184 fixes), 444/470 SNOMED diagnosis mappings, 16 skill files uploaded.

---

## 12. Doctor-Facing Update Notes

`doctor_update_notes_20260324.md` — the readable summary sent to Dr. Lokender Goyal on 2026-03-24. Important when reconciling user expectations: anything described there is either shipped or explicitly flagged as forthcoming. Use this file when answering "did we promise this to the doctor?"

`release-notes/update_20260327.md` — the 25–27 March 2026 release: universal dose calculator, ingredient_doses migration, 55 new protocols, 18 emergency drug SNOMED additions, 137/137 live tests PASS. Two known issues retained at publish time:

1. Three drugs with merged-ingredient data errors (SIMETHICONE+DILL OIL+FENNEL OIL, SODIUM CHLORIDE 0.9%, SODIUM CHLORIDE+DEXTROSE).
2. UTC date boundary at 5:30 AM IST instead of midnight IST. Acceptable for hospital hours.

---

## 13. Open Questions / Contradictions Between Specs

Where two documents disagree or where a spec leaves a question unresolved.

1. **`raw_dictation` field contract — JSON or free text?**
   `code_review_documents_and_summaries.md` Finding 3 documents that registration writes a JSON array and the prescription pad writes free-text dictation, overwriting each other. The spec text and the schema do not adjudicate. Resolution implicitly favours free-text (auto-save), with documents now surfacing via dedicated UI; but the field is still typed as plain text and a schema split has not been performed.

2. **Neonatal threshold — 28 vs 90 days.**
   `CLAUDE.md` originally said `<28 days`. Code (`registration.html`) uses `<90 days`. B3.7 reconciled this by editing `CLAUDE.md` to match code. The pediatric clinical literature supports either depending on context (neonate definition vs young-infant section visibility). Project decision: 90 days for **showing the neonatal section** in the registration UI; 28 days remains the formal neonatal definition for clinical classification. Anyone making this distinction in new code should check both.

3. **`severity_assessment` and `monitoring_parameters` — text or JSONB?**
   `standard_rx_structure_comparison.md` documents the type mismatch: DB columns are `text`, new JSON files use JSONB structures. The migration SQL is specified (ALTER COLUMN ... TYPE JSONB) but only 56 of 469 protocols have data. Live DB type at the time of writing — check `radhakishan_system/schema/radhakishan_supabase_schema.sql` directly.

4. **Standard Rx `source` field — string or array?**
   DB stores text (e.g., `"CDC 2024, WHO"`); new JSON files use array. Edge Function tolerates both. Standardisation deferred.

5. **A8 admission semantics changed mid-implementation.**
   Originally inferred from `followup_days == null && referral` (Section A first pass). Corrected to explicit `admission_recommended` field (Section C). Older code paths still reading the old contract should be audited.

6. **Spec says BSA falls through to weight slider; release notes claim "Universal slider for all drugs" works correctly for BSA.**
   `dose_calculator_spec.md` §6.3 lists BSA as a known limitation ("falls through to the weight-based slider path. The slider still shows mg/kg units"). `release-notes/update_20260327.md` says "Universal slider for all drugs ... whether weight-based, fixed-dose, BSA-based, or age-based." The dose engine plan (`universal_dose_calculator_plan.md`) supports both readings — BSA inputs are handled if `params.bsa` (or height for Mosteller) is provided. Verify on the next BSA-dosed drug whether the slider axis label correctly reads `mg/m²`.

7. **Skill prompt source of truth.**
   `radhakishan_system/skill/radhakishan_prescription_skill.md` is described in the spec as "original full skill (933 lines, reference artifact — NOT used at runtime)." The runtime path is `core_prompt.md` + on-demand references. The original is retained per spec; ensure no edits to it propagate by accident — the project decision is the lean core prompt.

---

## 14. Suggested Follow-ups (planned but not yet implemented)

Items recorded in spec or planning docs that have a defined plan but no shipped code.

### 14.1 From the Specification Corpus

- **Six missing standard prescription sections** (`missing_standard_prescription_sections.md`): expected_course, parent_counselling_hi, key_clinical_points, severity_assessment_table, monitoring_parameters, step_down_discharge_plan. Schema columns and types decided; 56 of 469 protocols populated; 413 remaining.
- **Backfill Standard Rx coverage** (`standard_rx_structure_comparison.md` Phases 3–4): 446 protocols still need diagnosis-specific `warning_signs`; 469 still need `expected_course`, `key_clinical_points`, populated structured `severity_assessment` and `monitoring_parameters`.
- **Standardise `source` field to array** across DB.
- **Combo drug per-ingredient dose enrichment for secondary ingredients** beyond the 48 already enriched.

### 14.2 From the Code-Review Corpus

- **Audit log table** (D-10, deferred): NABH IMS chapter recommends. Needs `audit_log` with action, user, timestamp, table/row, before/after.
- **Doctor PIN-based sign-off / Supabase Auth** (D-13).
- **NABH accreditation number on prescriptions** (D-19) once certificate is in hand.
- **Deno std@0.177.0 upgrade** (B7.16) — pinned to >2-year-old version in Edge Functions.

### 14.3 From Document Flow V1 / V2

- **Dedicated `document_uploads` table** OR dedicated `documents JSONB` column on `visits` (V1 Finding 3 / V2 implicit). Splits the `raw_dictation` collision permanently.
- **Document viewer in pad** so doctor can verify OCR against original (V1 Finding 4).
- **Visit summary should include lab results** in addition to past Rx and OCR (V1 Finding 5 — partly done; verify lab inclusion).
- **Source-document tagging on lab_results** (V2 #2) so AI-extracted historical labs are not shown in "Recent Labs."
- **Duplicate-prevention check on lab_results INSERT** in `process-document` (V2 #14).

### 14.4 From Planning Docs

- **SDK migration** when triggers in §11.1 fire.
- **Voice transcription upgrade** to GPT-4o Transcribe (`transcribe-audio` Edge Function, MediaRecorder integration, medical prompt seeding, Web Speech API fallback).
- **Real-time streaming via OpenAI Realtime API** if chunked latency is unacceptable.

### 14.5 From the 27-March Release Notes

- **Cleanup of three merged-ingredient data errors** in formulary.
- **UTC date boundary fix** so the patient list rolls at midnight IST instead of 5:30 AM IST.

---

## Appendix A — File Map for This Slice

```
radhakishan_system/docs/
├── specification/
│   ├── radhakishan_specification.md          (master spec — 17 chapters)
│   ├── claude_ai_data_context.md             (what gets sent to Claude)
│   ├── combo_drug_dosing_proposal.md         (per-ingredient dosing proposal)
│   ├── dose_calculator_spec.md               (calculator UI/engine spec)
│   ├── ingredient_doses_migration_plan.md    (671 bands → ingredient_doses[])
│   ├── missing_standard_prescription_sections.md
│   ├── standard_rx_structure_comparison.md   (DB vs JSON gap)
│   ├── universal_dose_calculator_plan.md     (dose-engine.js plan)
│   └── wire_ingredient_doses_plan.md         (12-fix consumer wiring)
├── code-review/
│   ├── CODE_REVIEW_ISSUES.md                 (R1–R38 ledger)
│   ├── ISSUES.md                              (Sections A + B, live)
│   ├── code_review_document_flow_v2.md
│   ├── code_review_documents_and_summaries.md
│   ├── data_contract_audit.md
│   ├── integration_audit_20260325.md
│   ├── section_a_resolution_notes.md
│   ├── section_b2_resolution_notes.md
│   └── section_c_resolution_notes.md
├── release-notes/
│   └── update_20260327.md
├── planning/
│   ├── SDK_MIGRATION_PLAN.md
│   ├── voice_transcription_upgrade_plan.md
│   ├── tasks.md
│   └── doctor_update_notes_20260324.md
├── architecture/
│   └── ARTIFACT_INVENTORY.md                  (PRE-MIGRATION HISTORY)
├── clinical/
│   ├── CLINICAL_RULES_SUMMARY.md
│   └── dosing_reference_guide.md
├── SETUP_GUIDE.md
└── README.md
```

---

_R8 documentation slice. Read-only memory of the project's specification, fixes, and direction of travel as of 2026-04-27._
