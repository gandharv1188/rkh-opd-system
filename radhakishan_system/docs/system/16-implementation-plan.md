# 16 — Consolidated Implementation Plan (post 2026-04-28 review)

_Last updated: 2026-04-28_

This plan executes the 37 decisions captured in doc 15. Each of the five sprints below is shippable on its own — if work stops after any sprint, the system is in a better state than before and continues to function. Effort estimates assume one engineer with AI assistance. The doctor signs off on each sprint via live test prescriptions before the next sprint begins. From this plan forward, all schema changes are committed to `supabase/migrations/` (per decision 21); ad-hoc `db query` runs are no longer the source of truth.

Doc 15 explains *why* each decision was made. This doc covers *how* and *when*.

## Cross-cutting concerns

- **Token rotation (do first, before any other work).** A `sbp_` service-role token was exposed in conversation history during the audit. Rotate it in the Supabase dashboard at the start of sprint 1, before the first deploy. Verify no scripts in `radhakishan_system/scripts/` still reference the old value.
- **Deployment cadence.** Edge Function deploys are grouped to one per sprint, after the sprint's smoke test passes. This keeps cold-start churn predictable and gives the doctor one clear "before/after" diff per sprint.
- **Customer feedback loop.** The doctor runs 5+ live test prescriptions at the end of every sprint and signs off in writing (chat or email). No sprint starts before the previous one is signed off.
- **Rollback plan.** Every sprint must have a documented rollback (git revert SHA + Edge Function redeploy of prior version + schema down-migration where applicable). Nothing ships without one written into the sprint PR description.

---

## Sprint 1 — Stop the bleeding (~3 days)

**Why first.** The highest-leverage clinical safety fixes (omitted/added drugs, doctor's word is law, deterministic temperature) all touch the same prompt + Edge Function surface. Bundling them avoids three separate redeploys and gets the most dangerous behaviour off the live system fastest.

**Goals**
- Prescriptions never silently drop a drug the doctor wrote.
- Prescriptions never silently add a drug the doctor did not write.
- The Std Rx button is opt-in per visit and resets per patient.
- Output is reproducible (temperature 0) and on the latest model.
- Logs no longer leak UHIDs.

**Tasks**

| Task | Files affected | Effort | Decision ref |
|---|---|---|---|
| Set `temperature: 0` on Claude API call | `supabase/functions/generate-prescription/index.ts` | 5 min | 36 |
| Replace formulary-not-found string with structured error payload | `supabase/functions/generate-prescription/index.ts` | 30 min | 37 |
| Mask UHID in all `console.log` calls | `supabase/functions/generate-prescription/index.ts`, `supabase/functions/generate-visit-summary/index.ts` | 30 min | 15 |
| Add `requested_medicines[]` and `omitted_medicines[]` to JSON schema | `supabase/functions/generate-prescription/index.ts`, `radhakishan_system/skill/core_prompt.md` | 1 hr | 1, 2 |
| Server-side completeness check + auto-retry once with structured nudge | `supabase/functions/generate-prescription/index.ts` | 2 hr | 1 |
| Update `core_prompt.md`: enumeration step, "doctor's word is law", Std Rx button rules in prompt | `radhakishan_system/skill/core_prompt.md` | 2 hr | 1, 2, 32 |
| Cache full menu of (icd10, diagnosis_name) pairs in system prompt | `supabase/functions/generate-prescription/index.ts` | 1 hr | 6a |
| Remove "ALWAYS call get_standard_rx" + "include ALL first-line drugs" lines | `radhakishan_system/skill/core_prompt.md` | 5 min | 2 |
| Front-end: pre-fetch selected protocol via `stdRxCache`, send as `<doctor_selected_protocol>` block when button ON | `web/prescription-pad.html` | 2 hr | 2 |
| Front-end: Std Rx button default OFF, reset per patient | `web/prescription-pad.html` | 1 hr | 32 |
| Bump model to Sonnet 4.6 + deploy | `supabase/functions/generate-prescription/index.ts` | 15 min | 35 |

**Schema changes**

| File | Purpose |
|---|---|
| `supabase/migrations/20260428_001_prescription_audit.sql` | Create `prescription_audit` table for tool-call/output logging (decision 18) |
| `supabase/migrations/20260428_002_pg_trgm.sql` | `CREATE EXTENSION IF NOT EXISTS pg_trgm` — preparation for sprint 2 fuzzy match (decision 6b) |

**Testing checklist**
- [ ] Re-run the 5 audit cases (HETANSHI, BHAVYANSH, VAIDIKA, and two others from doc 11) end-to-end.
- [ ] For each case, confirm every drug the doctor wrote appears in output.
- [ ] For each case with Std Rx button OFF, confirm no protocol-only drugs are added.
- [ ] Toggle Std Rx button ON for one case, confirm `<doctor_selected_protocol>` block reaches the AI.
- [ ] Same patient input run twice produces byte-identical drug list (temperature 0 sanity check).
- [ ] Search server logs for any UHID — should return zero.

**Sign-off criteria**
Doctor confirms via 5+ live test prescriptions that (a) drugs they wrote are always kept, (b) protocol-only drugs are not added when the button is OFF, and (c) the button resets to OFF when switching patients.

---

## Sprint 2 — Dose engine + safety severity (~4 days)

**Why second.** With omissions/additions fixed, the next-largest clinical risk is incorrect dose math. This sprint moves dose calculation from AI mental arithmetic to deterministic code, and introduces a three-tier severity model so the UI can block sign-off when it must.

**Goals**
- Every weight-based dose number on a prescription is computed by `dose-engine.ts`, not by the LLM.
- Three severity tiers (high / moderate / low) drive UI behaviour consistently.
- High-severity flags block sign-off until acknowledged.
- Doctor-specified doses are always printed; the engine warns but does not overwrite.

**Tasks**

| Task | Files affected | Effort | Decision ref |
|---|---|---|---|
| Port `web/dose-engine.js` → `supabase/functions/_shared/dose-engine.ts` | new file | 4 hr | 5 |
| Add `compute_doses` tool with `strict: true` schema | `supabase/functions/generate-prescription/index.ts` | 2 hr | 5 |
| Update `core_prompt.md` to mandate `compute_doses` for all weight-based dosing | `radhakishan_system/skill/core_prompt.md` | 1 hr | 5 |
| Server-side enforcement: refuse output if `compute_doses` not called when meds present | `supabase/functions/generate-prescription/index.ts` | 1 hr | 5 |
| Three-tier severity in JSON schema + `ai_safety_notes` field | `supabase/functions/generate-prescription/index.ts`, `radhakishan_system/skill/core_prompt.md` | 1 hr | 8 |
| Server + AI both emit severity; final = `max()` | `supabase/functions/generate-prescription/index.ts` | 1 hr | 8 |
| Doctor-specified dose flow: print doctor value, banner if engine flags unsafe | `web/prescription-pad.html`, Edge Function | 2 hr | 4 |
| Implicit dose flow: AI picks band, engine calculates, AI copies | Edge Function, `core_prompt.md` | 2 hr | 5 |
| High-severity gate: banner + acknowledge checkbox + Sign disabled | `web/prescription-pad.html` | 2 hr | 31, 7 |
| Allergy clash: warning + suggested alternative + override checkbox | `web/prescription-pad.html`, Edge Function | 2 hr | 10 |
| Formulary miss: stub + fuzzy suggestions + force high severity | `web/prescription-pad.html`, Edge Function | 2 hr | 9 |
| Front-end: prompt for missing weight at Generate (backup path) | `web/prescription-pad.html` | 30 min | 11 backup |
| Front-end: pre-compute `corrected_age_days` + `chronological_age_days` for preterms | `web/prescription-pad.html` | 1 hr | 12 |
| `pg_trgm` similarity match inside `get_standard_rx` tool | Edge Function | 1 hr | 6b |

**Schema changes**

| File | Purpose |
|---|---|
| `supabase/migrations/20260501_001_stdrx_trgm_index.sql` | `CREATE INDEX ... USING gin (diagnosis_name gin_trgm_ops)` on `standard_prescriptions` |

**Testing checklist**
- [ ] 20 dose-engine fixtures (drops, syrup, tablets, suspensions, neonatal, GFR-adjusted) — TS port output must match JS frontend output exactly.
- [ ] Trigger high-severity flag (e.g. allergy clash) — Sign button must disable until acknowledged.
- [ ] Doctor-specified overdose — output prints doctor's number with red banner; engine does NOT overwrite.
- [ ] Misspelled diagnosis ("otits media") — fuzzy match returns AOM protocol.
- [ ] Formulary miss for "ibuprofeen" — stub + suggestion + high severity.

**Sign-off criteria**
Doctor confirms via test that (a) high-severity flags block sign-off, (b) their explicit doses are never overridden, and (c) dose numbers on test prescriptions match what they expect for the patient's weight.

---

## Sprint 3 — Authentication + security (~3 days)

**Why third.** The dose engine and audit work mean nothing if anyone on the public internet can hit the app. This sprint closes the auth hole and removes the remaining external-data leaks. It depends on sprints 1–2 being signed off because adding auth mid-flow would complicate testing.

**Goals**
- Site is no longer accessible without login.
- Hardcoded keys move to a single config file.
- External-CDN data leaks (qrserver, claude.ai postMessage) are eliminated.
- Mandatory clinical fields (weight, allergy) are enforced at entry, not at Rx generation.

**Tasks**

| Task | Files affected | Effort | Decision ref |
|---|---|---|---|
| Provision Supabase Auth (email/password) | Supabase dashboard | 30 min | 22 Phase A |
| Create accounts (doctor + 3–4 nurses + 2–3 reception, exact list from customer) | Supabase dashboard | 30 min | 22 |
| Login page + session redirect on every page | new `web/login.html`, all 8 pages | 4 hr | 22 |
| Move `SUPABASE_URL` + `ANON_KEY` into `web/config.js` | new `web/config.js`, all 8 pages | 2 hr | 23 |
| Update 8 HTML pages to load `config.js` + check auth before any DB call | all `web/*.html` | 3 hr | 23 |
| Vendor `qrcode.js` locally, replace `api.qrserver.com` | `web/registration.html`, `web/prescription-output.html` | 1 hr | 24 |
| Mandatory weight at nurse station | `web/registration.html` | 1 hr | 11 primary |
| Mandatory allergy at registration | `web/registration.html` | 1 hr | 27 |
| Vaccine "Other..." whitelist UI | `web/registration.html` | 2 hr | 26 |
| Delete `postMessage` listener from prescription pad | `web/prescription-pad.html` | 5 min | 28 |
| Strip patient name/UHID from voice transcription `patient_context` | `web/prescription-pad.html` | 30 min | 29 |
| Strip ABHA from QR payload, add UHID-based lookup | `web/registration.html`, `web/patient-lookup.html` | 1 hr | 30 |
| Defer pre-OCR upload until `patient_id` exists | `web/registration.html` | 1 hr | 25 |
| Project-id guard in `create_sample_data.js` | `radhakishan_system/scripts/create_sample_data.js` | 15 min | 20 |

**Schema changes**
Supabase Auth user tables are managed automatically. Per-role RLS policies are deferred to sprint 4 so this sprint stays narrowly scoped to "lock the door".

**Testing checklist**
- [ ] Open every page in incognito → all redirect to login.
- [ ] After login, all flows (register, prescribe, print, lookup, formulary, std rx) work as before.
- [ ] Network tab shows zero requests to `api.qrserver.com` or `claude.ai`.
- [ ] Try to register a patient with no allergy field — blocked.
- [ ] Try to generate Rx without nurse-entered weight — blocked at nurse station, not at Rx.

**Sign-off criteria**
The site cannot be used without login. The doctor confirms each staff member can log in with their own credentials and the clinic's normal day works end-to-end.

---

## Sprint 4 — Audit, edit history, schema baseline (~3 days)

**Why fourth.** With auth in place, we can finally attribute changes to a real user. This sprint makes the system NABH/medico-legal defensible: every prescription edit is preserved, receipts cannot collide, the schema lives in version control, and per-role RLS policies are switched on.

**Goals**
- No prescription edit ever overwrites a prior version.
- Schema in git matches schema in production (both directions).
- Receipt numbers cannot collide under concurrent sign-off.
- RLS prevents reception from reading prescriptions, etc.

**Tasks**

| Task | Files affected | Effort | Decision ref |
|---|---|---|---|
| Create `prescriptions_history` table | new migration | 30 min | 14 |
| Edit-mode flow: every save inserts new version row | `web/prescription-pad.html`, Edge Function | 3 hr | 14 |
| Print page shows "Version N of M" tag | `web/prescription-output.html` | 1 hr | 14 |
| `pg_dump` live schema → commit as new repo baseline | `radhakishan_system/schema/` | 1 hr | 21 |
| Adopt `supabase/migrations/` folder going forward | repo structure | 30 min | 21 |
| Receipt collision fix: Postgres sequence + atomic claim RPC | new migration, `web/prescription-pad.html` | 2 hr | 19 |
| Link `doctor_id` to prescriptions for audit attribution | `web/prescription-pad.html`, Edge Function | 1 hr | 22 (depends on sprint 3) |
| RLS per-role policies (doctor / nurse / reception) | new migration | 3 hr | 22 Phase B |
| Front-end Hindi token library (~30 clinical phrases) | `web/prescription-pad.html` | 2 hr | 13 |
| Server-side Devanagari validation in `row3_hi` | Edge Function | 1 hr | 13 |
| Verifier scaffold: Haiku call wired, feature-flagged OFF | Edge Function | 2 hr | 17 |
| Tool-loop monitoring: log when ≥5 rounds | Edge Function | 30 min | 33 |
| Extend early-stopping heuristic at line 569 | Edge Function | 1 hr | 33 |

**Schema changes**

| File | Purpose |
|---|---|
| `supabase/migrations/20260507_001_prescriptions_history.sql` | Versioned history table |
| `supabase/migrations/20260507_002_receipt_sequence.sql` | Daily sequence + atomic claim RPC |
| `supabase/migrations/20260507_003_rls_per_role.sql` | Role-scoped RLS policies replacing `anon_full_access` |
| `radhakishan_system/schema/baseline_2026_04.sql` | `pg_dump` baseline committed as authoritative starting point |

**Testing checklist**
- [ ] Edit a signed prescription → both versions present in `prescriptions_history`, print shows "Version 2 of 2".
- [ ] Two browser tabs sign off simultaneously → both get distinct receipt numbers.
- [ ] Login as reception → cannot SELECT from `prescriptions`.
- [ ] Login as nurse → can read patient data, cannot sign off Rx.
- [ ] Diff `pg_dump` of live DB against committed baseline → empty.

**Sign-off criteria**
NABH-defensible audit trail exists for prescriptions. Each role sees only what they should. The clinic continues normal operation with no workflow regressions.

---

## Sprint 5 — Hygiene and polish (~2–3 days)

**Why last.** These are the remaining low/medium issues from the code review (decision 34). None block the clinic; bundling them into one sprint keeps the previous four focused on safety-critical work.

**Goals**
- Codebase passes a fresh code review with no medium-severity issues open.
- Dead code, duplicated logic, and hardcoded paths are removed.
- Storage policies are committed to the repo.

**Tasks**

| Task | Files affected | Effort | Decision ref |
|---|---|---|---|
| Consolidate duplicated `simplifyForm` regex | `web/prescription-pad.html`, others | 30 min | L2 |
| Fix `lab.value_numeric` `parseFloat(0) → null` bug | `web/registration.html` | 15 min | L4 |
| Remove MODS dead code | search + remove | 30 min | L6 |
| Resolve two competing CSS classes for collapsibles | `web/registration.html`, `web/prescription-pad.html` | 1 hr | L7 |
| `generateRxId` 999/day wraparound fix | `web/prescription-pad.html` | 30 min | L3 |
| Fix `existingVax` flicker | `web/registration.html` | 30 min | L5 |
| Remove SNOMED rebuilder generations 1–4, keep latest | `radhakishan_system/scripts/` | 30 min | M10 |
| Replace hardcoded Windows paths with env vars | `radhakishan_system/scripts/` | 1 hr | M11 |
| Remove `postMessage` to claude.ai from patient-lookup | `web/patient-lookup.html` | 5 min | M3 |
| Commit Storage policies to repo | new `supabase/storage_policies.sql` | 30 min | L12 |
| Add `lab_results.updated_at` trigger | new migration | 30 min | L13 |

**Schema changes**

| File | Purpose |
|---|---|
| `supabase/migrations/20260512_001_lab_results_updated_at.sql` | Trigger for `updated_at` |

**Testing checklist**
- [ ] Visual smoke test on every page (registration, prescription pad, output, lookup, formulary, formulary import, std rx, index).
- [ ] Generate Rx #1000 of the day — receipt rolls cleanly.
- [ ] Edit a lab result — `updated_at` advances.
- [ ] Re-run import scripts on a fresh laptop without editing paths.

**Sign-off criteria**
The codebase passes a fresh code review with no medium-severity issues open. M2 (Hindi token library) is already shipped in sprint 4; M11 deferred items, if any remain, are explicitly listed in `09-known-issues.md` with rationale.

---

## Closing

Total estimated timeline: ~15 working days end-to-end, assuming parallel work on the schema baseline (sprint 4) can begin in the background during sprint 3. Real elapsed time will be longer because clinic operations interrupt engineering and because each sprint waits for the doctor's sign-off on live test prescriptions before the next begins. A realistic calendar window is 4–6 weeks. If anything in sprints 1 or 2 surfaces a regression in clinical output, the affected sprint is re-opened before later sprints proceed — clinical safety always pre-empts schedule.
