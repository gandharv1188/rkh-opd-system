# Clinical Safety Requirements

These are **hard** requirements. Any ticket that violates one of these
is blocked until the violation is resolved. Tickets tagged `clinical-safety`
require a second human review by the clinician on `08_team/RACI.md`.

## CS-1: No unverified OCR data in clinical tables

No row shall be inserted into `lab_results`, `vaccinations`, or
`visits.attached_documents.ocr_*` from DIS without one of:

- `verification_status = 'verified'` with non-null `verified_by`, OR
- `verification_status = 'auto_approved'` and the extraction passed
  every confidence gate in the active policy.

**Test:** Integration test attempts to promote a `pending_review`
extraction — must return 409 and write nothing.

## CS-2: Raw OCR output is preserved forever

The raw response from the OCR provider and the raw output from the
structuring LLM are both stored in `ocr_extractions.raw_ocr_response`
and `ocr_extractions.raw_structured_response` indefinitely.

- Never deleted.
- Never updated (append-only via new extraction rows).
- Accessible to the verifier and retrievable via the audit API.

**Test:** After 6 months' simulated time (fixture dataset), all raw
responses are retrievable.

## CS-3: Every clinical row traces to one extraction

Every `lab_results` / `vaccinations` row created by DIS has a non-null
`ocr_extraction_id` foreign key.

- FK is `ON DELETE RESTRICT` — you cannot delete an extraction while
  clinical rows reference it.
- The admin cannot "merge" or "reassign" the FK without an audit log entry.

**Test:** DDL check in migration test. Integration test attempts a delete and fails.

## CS-4: Verified values are not silently overwritten

If the same document is re-ingested and produces different values:

- A new extraction is created.
- The previous verified rows in clinical tables remain.
- The UI shows both, timestamped.
- Only a human can merge or supersede; never automatic.

**Test:** Ingest the same content twice; assert two distinct extractions
and no clinical-table updates.

## CS-5: Reject is permanent

A `rejected` extraction cannot be promoted by any code path. The only
recovery is a new upload.

**Test:** Attempt to approve a rejected extraction — returns 409.

## CS-6: Edits are logged field-by-field

Every nurse edit between AI output and verified value is recorded in
`ocr_audit_log` with before/after values and actor.

**Test:** Submit a verification with two edits — assert two audit rows.

## CS-7: Confidence gates are explicit and reviewable

Auto-approval policy is stored as configuration (not code) in
`dis_confidence_policy`. Any change requires admin action and is
logged.

**Default policy at launch: auto-approval DISABLED.** Every extraction
requires human review. Auto-approval is an opt-in future feature.

## CS-8: PII stays within project boundaries

Raw responses stored in the DB include patient data. RLS policies
restrict read access:

- `patient_id = auth.patient_id()` in the nurse role, OR
- Admin role only for cross-patient queries.

**Test:** RLS policy test asserts a non-matching patient read returns 0 rows.

## CS-9: Test-name normalization is audited

When the structuring LLM maps `"Hb" → "Hemoglobin"`, the original string
is stored in `ocr_extractions.raw_structured_response`, not lost. The
nurse sees both in the UI.

**Rationale:** if the normalization table is wrong, we need to find it
later.

## CS-10: Discharge-summary "latest only" rule is code-enforced, not prompt-enforced

For `document_type = 'discharge_summary'`, the server-side promotion
step takes only the most recent value per `test_name` across the
extracted `lab_values[]` array. This is a guard above any prompt
instruction, so a model regression cannot re-introduce serial values.

**Test:** Fixture with 7 TSB readings across 7 days — assert exactly
one row is promoted, with the latest date.

## CS-11: Duplicate-row prevention on promotion

Before inserting into `lab_results`, the promotion step checks for an
existing row with the same `(patient_id, test_name, test_date,
value_numeric)`. If present, it is skipped and noted in the audit log.

**Test:** Promote the same extraction twice — second run inserts zero
rows, audit log shows skips.

## CS-12: No OCR data may reach the prescription generator unverified

`generate-prescription`'s `get_lab_history` tool filters
`lab_results.verification_status = 'verified'` (or
`source = 'manual'` / `source = 'upload'`).

**Test:** With only an `ai_extracted pending_review` row present, the
tool response contains zero labs.

## Out-of-band safeguards

- **Weekly clinician audit.** Every week, the clinical reviewer samples
  10 random verified extractions and confirms the verified values
  against source. Results logged.
- **Red-team fixtures.** Test set includes deliberately adversarial
  documents (wrong patient name, smudged values, mixed-patient reports).
  These must all be caught by verification.
- **Metrics.** Edit rate, reject rate, and "verified-but-wrong" audit
  rate are tracked. Thresholds trigger investigation tickets.
