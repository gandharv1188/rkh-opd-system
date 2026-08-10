# DIS Clinical-Safety Dry-Run Report

**Ticket:** DIS-170
**Date:** 2026-04-22
**Purpose:** Assemble audit + red-team + chaos results against every Clinical-Safety (CS) rule in `01_product/clinical_safety.md`, for clinician sign-off before first production ingest.

> CS rule numbering and titles are taken verbatim from the source spec at `dis/document_ingestion_service/01_product/clinical_safety.md`. That spec is authoritative; if it diverges from the dispatch brief, the spec wins.

---

## Summary

| CS | Rule | Enforcement status | Evidence | Sign-off |
| --- | --- | --- | --- | --- |
| CS-1  | No unverified OCR in clinical tables              | Enforced (code + RLS) | DIS-034, DIS-092, DIS-121 | Pending |
| CS-2  | Raw OCR output preserved forever (append-only)    | Enforced (schema + API)| DIS-031, DIS-121          | Pending |
| CS-3  | Every clinical row traces to one extraction       | Enforced (FK RESTRICT) | DIS-034, DIS-145          | Pending |
| CS-4  | Verified values not silently overwritten          | Enforced (flow)        | DIS-121, DIS-140          | Pending |
| CS-5  | Reject is permanent                               | Enforced (state mach.) | DIS-092, DIS-121          | Pending |
| CS-6  | Edits logged field-by-field                       | Enforced (audit log)   | DIS-034, DIS-121          | Pending |
| CS-7  | Confidence gates explicit + reviewable            | Enforced (DB policy)   | DIS-034, DIS-120          | Pending |
| CS-8  | PII stays within project boundaries               | Enforced (RLS + redact)| DIS-034, DIS-152          | Pending |
| CS-9  | Test-name normalization audited                   | Enforced (raw kept)    | DIS-031, DIS-092          | Pending |
| CS-10 | Discharge-summary "latest only" code-enforced     | Enforced (server guard)| DIS-121, DIS-122          | Pending |
| CS-11 | Duplicate-row prevention on promotion             | Enforced (pre-insert)  | DIS-121, DIS-122          | Pending |
| CS-12 | No unverified OCR reaches prescription generator  | Enforced (tool filter) | DIS-121, DIS-130          | Pending |

**Overall verdict (developer):** All 12 CS rules enforced in code on `feat/dis-plan`. Migrations for DIS-145 (FK + indexes) are NOT yet applied to staging Supabase — flagged below. Cost/kill-switch (DIS-163/168/171) deferred until a staging project exists.

---

## CS-1 — No unverified OCR data in clinical tables

- **What the rule guarantees.** No row reaches `lab_results` / `vaccinations` / `visits.attached_documents.ocr_*` without `verification_status='verified'` + non-null `verified_by`, OR `auto_approved` after passing every active confidence gate.
- **How the build enforces it.** Promotion is gated in the `POST /verify` route (DIS-092) and in the server-side promotion step (DIS-121). DDL (DIS-034) sets `verification_status` NOT NULL with CHECK constraint; the default policy (CS-7) is `auto_approval=false`, so promotion requires a human actor.
- **Test evidence.** `supabase/functions/dis-verify/test/promote.test.ts :: "pending_review promotion returns 409"`; `supabase/functions/dis-promote/test/gate.test.ts :: "auto_approved without policy match is rejected"`.
- **Residual risks.** A compromised admin account could flip policy; mitigated by CS-7 policy-change audit but not by a second pair of eyes. RLS on `lab_results` is `anon_full_access` in POC — hardening deferred to post-pilot.
- **Clinician sign-off box**
  ```
  - [ ] Clinician signature: __________ Date: __________
  ```

## CS-2 — Raw OCR output is preserved forever (byte-identically)

- **What the rule guarantees.** `ocr_extractions.raw_ocr_response` and `raw_structured_response` are immutable, never deleted, always retrievable by verifier + audit API.
- **How the build enforces it.** Schema (DIS-031) stores both as JSONB; no UPDATE path writes these columns after insert (DIS-121 promotion writes new rows, never mutates). Audit read API (DIS-092) exposes retrieval by `extraction_id`.
- **Test evidence.** `supabase/functions/dis-ingest/test/raw_preserved.test.ts :: "second ingest inserts new row, does not mutate prior"`; audit API contract test `audit_retrieve.test.ts`.
- **Residual risks.** No cryptographic hash/seal yet — a DB superuser could silently rewrite history. Out of scope for POC; flagged for post-pilot (candidate DIS-200+).
- **Clinician sign-off box**
  ```
  - [ ] Clinician signature: __________ Date: __________
  ```

## CS-3 — Every clinical row traces to one extraction

- **What the rule guarantees.** Every DIS-originated `lab_results` / `vaccinations` row has non-null `ocr_extraction_id`, FK `ON DELETE RESTRICT`. Reassignment requires audit log entry.
- **How the build enforces it.** DDL in DIS-034 + DIS-145 adds `ocr_extraction_id` NOT NULL + FK `ON DELETE RESTRICT`. Promotion step (DIS-121) populates FK from the approved extraction.
- **Test evidence.** `radhakishan_system/schema/test/fk_restrict.sql`; `dis-promote/test/fk_populated.test.ts`.
- **Residual risks.** DIS-145 migration is NOT yet applied to staging Supabase — verified in dev only. **Open question below.** Historical `lab_results` rows from pre-DIS manual entry have NULL `ocr_extraction_id` by design; UI must not treat NULL as "missing provenance" (it means `source='manual'`).
- **Clinician sign-off box**
  ```
  - [ ] Clinician signature: __________ Date: __________
  ```

## CS-4 — Verified values are not silently overwritten

- **What the rule guarantees.** Re-ingesting the same document creates a new extraction, leaves prior verified clinical rows intact, and shows both timestamped in UI; merge is human-only.
- **How the build enforces it.** Ingest route (DIS-121) always inserts a new `ocr_extractions` row; promotion never UPDATEs existing `lab_results`. UI (DIS-140) renders both with timestamps.
- **Test evidence.** `dis-ingest/test/duplicate_doc.test.ts :: "two extractions, zero lab_results updates"`.
- **Residual risks.** "Merge" UI not yet built — users currently see stacked rows and cannot annotate which supersedes which. Tracked for pilot feedback.
- **Clinician sign-off box**
  ```
  - [ ] Clinician signature: __________ Date: __________
  ```

## CS-5 — Reject is permanent

- **What the rule guarantees.** A `rejected` extraction cannot be promoted by any code path. Recovery is a new upload only.
- **How the build enforces it.** Verify route (DIS-092) rejects state transitions out of `rejected` with 409. Promotion step (DIS-121) re-checks `verification_status` at write time.
- **Test evidence.** `dis-verify/test/rejected_permanent.test.ts :: "POST /approve on rejected returns 409"`.
- **Residual risks.** None known at code level. Operationally, a re-uploaded rejected doc produces a fresh extraction with no linkage to the original reject reason — audit trail is soft-linked by `source_document_hash`.
- **Clinician sign-off box**
  ```
  - [ ] Clinician signature: __________ Date: __________
  ```

## CS-6 — Edits are logged field-by-field

- **What the rule guarantees.** Every diff between AI output and verified value is a row in `ocr_audit_log` with before/after + actor.
- **How the build enforces it.** `ocr_audit_log` table (DIS-034); verify route (DIS-092, flow DIS-121) computes field-level diff and bulk-inserts audit rows in the same transaction as verification.
- **Test evidence.** `dis-verify/test/audit_log.test.ts :: "two edits yields two audit rows with before/after"`.
- **Residual risks.** Nested/array fields in `lab_values[]` are diffed at the array-element level; a reorder with no value change still produces noise rows (acceptable — err on the side of logging).
- **Clinician sign-off box**
  ```
  - [ ] Clinician signature: __________ Date: __________
  ```

## CS-7 — Confidence gates are explicit and reviewable

- **What the rule guarantees.** Auto-approval policy lives in `dis_confidence_policy` (config, not code). Changes require admin + are logged. **Default at launch: auto-approval DISABLED.**
- **How the build enforces it.** `dis_confidence_policy` table (DIS-034); policy writes audited via DIS-120. Promotion reads policy at runtime (DIS-121).
- **Test evidence.** `dis-promote/test/policy_disabled.test.ts :: "default policy forces manual review"`; `dis-policy/test/audit_on_change.test.ts`.
- **Residual risks.** No 4-eyes on policy change yet — single admin flip is sufficient. Compensating control: weekly clinician audit (CS "out-of-band") + metrics threshold alerts.
- **Clinician sign-off box**
  ```
  - [ ] Clinician signature: __________ Date: __________
  ```

## CS-8 — PII stays within project boundaries

- **What the rule guarantees.** Raw responses contain PII; RLS limits reads to matching nurse role or admin. PII is redacted from logs + traces.
- **How the build enforces it.** RLS policies (DIS-034) on `ocr_extractions`; log redaction middleware (DIS-152) strips names, UHIDs, DOBs, phone numbers from Edge Function logs + trace spans.
- **Test evidence.** `schema/test/rls_pii.sql :: "cross-patient select returns 0 rows"`; `dis-logs/test/redaction.test.ts :: "12 PII patterns redacted from log lines"`.
- **Residual risks.** Supabase platform logs (not application logs) are outside our redaction middleware — a raw error stack could leak PII in Supabase's own log viewer. Documented for ops; platform-level log scrubbing is a Supabase roadmap item.
- **Clinician sign-off box**
  ```
  - [ ] Clinician signature: __________ Date: __________
  ```

## CS-9 — Test-name normalization is audited

- **What the rule guarantees.** When LLM maps `"Hb" → "Hemoglobin"`, the original string survives in `raw_structured_response` and is shown to the nurse.
- **How the build enforces it.** Structuring LLM output is stored verbatim (DIS-031). Verifier UI (DIS-092 contract) renders both `raw_test_name` and `normalized_test_name`.
- **Test evidence.** `dis-ingest/test/raw_name_preserved.test.ts`; UI snapshot test `verifier_shows_both_names.test.tsx`.
- **Residual risks.** Normalization table lives in the prompt, not a queryable table — auditing "which normalizations fired last month" is grep-over-raw-responses, not a report. Acceptable for POC volumes.
- **Clinician sign-off box**
  ```
  - [ ] Clinician signature: __________ Date: __________
  ```

## CS-10 — Discharge-summary "latest only" rule is code-enforced

- **What the rule guarantees.** For `document_type='discharge_summary'`, server-side promotion takes only the most-recent value per `test_name`, so a prompt regression can't silently re-introduce serial rows.
- **How the build enforces it.** Promotion step (DIS-121) groups extracted `lab_values[]` by `test_name` and selects `MAX(test_date)` before insert. Hard guard, independent of prompt (DIS-122 red-team test).
- **Test evidence.** `dis-promote/test/discharge_latest.test.ts :: "7 TSB readings across 7 days -> 1 row at latest date"`.
- **Residual risks.** Ties on `test_date` fall back to extraction order — documented but unlikely in practice. Non-lab fields in discharge (diagnoses, medications) are not subject to this rule.
- **Clinician sign-off box**
  ```
  - [ ] Clinician signature: __________ Date: __________
  ```

## CS-11 — Duplicate-row prevention on promotion

- **What the rule guarantees.** Pre-insert check skips any `(patient_id, test_name, test_date, value_numeric)` already present and audits the skip.
- **How the build enforces it.** Promotion step (DIS-121) SELECTs on the 4-tuple before each INSERT; skipped rows go to `ocr_audit_log` with `action='dedupe_skip'` (DIS-122).
- **Test evidence.** `dis-promote/test/dedupe.test.ts :: "second promotion of same extraction inserts 0 rows, logs N skips"`.
- **Residual risks.** `value_numeric` is compared exactly — a unit change (mg/dL vs mmol/L) between ingests would bypass dedupe. Unit normalization is a follow-up.
- **Clinician sign-off box**
  ```
  - [ ] Clinician signature: __________ Date: __________
  ```

## CS-12 — No OCR data may reach the prescription generator unverified

- **What the rule guarantees.** `generate-prescription`'s `get_lab_history` returns only `verification_status='verified'` rows (or `source in ('manual','upload')`).
- **How the build enforces it.** Tool handler (DIS-121 integration + DIS-130) filters by `verification_status` in its REST query. `ai_extracted pending_review` is invisible to the LLM.
- **Test evidence.** `generate-prescription/test/get_lab_history.test.ts :: "pending_review rows excluded"`.
- **Residual risks.** Other tools (`get_previous_rx`, `get_reference`) don't touch OCR data today. If a future tool surfaces lab text from `raw_structured_response`, it must re-apply the same filter — captured as a code-review checklist item in `08_team/review_gates.md`.
- **Clinician sign-off box**
  ```
  - [ ] Clinician signature: __________ Date: __________
  ```

---

## Open questions for sign-off

1. **DIS-145 migrations not yet applied to staging Supabase.** FK `ON DELETE RESTRICT` and supporting indexes exist in the migration SQL but no staging project has been provisioned yet. CS-3 evidence is dev-local until applied. *Owner: DevOps.*
2. **DIS-163 (kill-switch), DIS-168 (cost guardrail), DIS-171 (chaos drill).** Deferred pending staging environment. These are referenced in the brief's CS-9 / CS-12 scope but are *out-of-band safeguards* per the source spec, not primary CS rules. To be re-verified once staging is live.
3. **RLS hardening for pilot.** POC runs `anon_full_access`. Before first real patient data, confirm whether pilot will use the POC policy or enable nurse-role RLS described in CS-8. *Owner: clinical lead + project owner.*
4. **Merge UI for CS-4.** Stacked-rows view is in, but "supersede" action is not. Confirm whether pilot can launch without it (paper workaround) or whether it blocks sign-off.
5. **Weekly audit cadence.** Source spec mandates a 10-sample weekly audit. Confirm clinician availability and the logbook location (`10_handoff/weekly_audit_log.md` proposed).

---

*End of dry-run report. Once all 12 sign-off boxes are ticked and the open questions above have recorded answers, DIS is cleared for first-patient ingest on the pilot clinic instance.*
