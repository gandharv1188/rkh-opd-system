# Clinical Acceptance Tests — DIS

> Scope: the human-in-the-loop layer. Unit and integration tests verify
> mechanics; clinical acceptance verifies that the system produces
> clinically correct output on realistic documents and that the
> verification UI catches adversarial inputs.
>
> Owner: QA Lead curates fixtures. Clinical reviewer (see `08_team/RACI.md`)
> signs off weekly. No rollout stage advances (see `06_rollout/rollout_plan.md`)
> without a signed acceptance run.

## 1. Fixture set (v1 minimum)

Minimum 20 anonymized real documents, at least one per row. Stored in
`dis/tests/fixtures/clinical/` per `fixtures.md` layout.

| #   | Category          | Document type                              | Challenge                     | Source                  |
| --- | ----------------- | ------------------------------------------ | ----------------------------- | ----------------------- |
| 1   | lab_report        | CBC native PDF                             | baseline clean                | anonymized local lab    |
| 2   | lab_report        | CBC scan, slight skew                      | deskew + OCR                  | real scan, 5° tilt      |
| 3   | lab_report        | LFT, multi-column table                    | table extraction              | real                    |
| 4   | lab_report        | RFT with Hindi header                      | multilingual OCR              | real                    |
| 5   | lab_report        | Handwritten lab slip                       | low-confidence path           | real                    |
| 6   | discharge_summary | Neonatal, 7 TSB readings                   | CS-10 latest-only             | synthetic but realistic |
| 7   | discharge_summary | Adult, medications + diagnoses             | medication extraction         | anonymized              |
| 8   | discharge_summary | Scan + smudge on one value                 | adversarial (red-team)        | synthetic               |
| 9   | prescription      | Typed Rx with brand names                  | drug normalization            | real                    |
| 10  | prescription      | Handwritten, English, doctor scrawl        | adversarial; likely reject    | real                    |
| 11  | prescription      | Handwritten, Hindi (Devanagari)            | adversarial multilingual      | real                    |
| 12  | vaccination_card  | IAP card, 8 doses                          | date extraction               | real                    |
| 13  | vaccination_card  | UIP card partial fill                      | missing fields                | real                    |
| 14  | radiology         | X-ray report native PDF                    | imaging findings              | real                    |
| 15  | radiology         | USG report scan                            | scan path                     | real                    |
| 16  | other             | Diet chart (non-medical-ish)               | category handling             | synthetic               |
| 17  | adversarial       | Wrong-patient report (name mismatch)       | red-team                      | synthetic               |
| 18  | adversarial       | Mixed-patient doc (two patients, one scan) | red-team                      | synthetic               |
| 19  | adversarial       | Blank page + single readable page          | preprocessor blank-drop       | real                    |
| 20  | adversarial       | All-blank upload (junk)                    | preprocessor fails gracefully | synthetic               |

Red-team fixtures (17–20) are explicit adversarial tests. They MUST be
either correctly rejected by the nurse in the verification-UI workflow
test, or surface a clear warning banner that makes the correct action
obvious.

## 2. Golden-file pattern

For each fixture `F.pdf`, the repo stores:

```
tests/fixtures/clinical/F/
├── source/F.pdf
├── expected/raw_ocr_markdown.md        # acceptable markdown (optional, lax diff)
├── expected/structured.json            # the ClinicalExtraction v1 payload
├── expected/promotion.json             # {labs_inserted, labs_skipped, ...}
└── expected/ui_flags.json              # {confidence_badges:[...], warnings:[...]}
```

The `structured.json` is the **golden** — the structuring adapter output
must deep-equal this (with tolerance on `confidence` ±0.05). Drift
triggers one of:

- The model changed → open a ticket, regenerate golden after clinical
  reviewer approves.
- The code changed → bug; fix before merge.

Golden updates require:

- PR labeled `golden-update`.
- Clinical reviewer approval recorded in PR description.
- Diff summary (`pnpm test:clinical --update-summary`) posted to PR.

## 3. Test scenarios (per fixture)

For each fixture `F`, the suite runs:

1. Ingest via HTTP API (same path as integration tests).
2. Compare `structured` column to `expected/structured.json` — deep-equal
   minus tolerances (`confidence` ±0.05; string case normalized for
   `test_name_raw`; whitespace collapsed).
3. Simulate nurse approval in **two modes**:
   - `approve_as_is`: send no edits; expect promotion summary = golden.
   - `approve_with_canonical_edits`: apply the canonical edit script in
     `expected/canonical_edits.json` (if present, e.g., for adversarial
     fixtures); expect the edited fields to land in `lab_results`.
4. For red-team fixtures: run a UI-level Playwright script asserting the
   warning banner text is visible. Reject path verified.

## 4. Weekly clinician audit

Owner: clinical reviewer per RACI.

**Procedure:**

1. Every Monday, sample 10 random extractions from the previous week
   with `status IN ('verified','auto_approved','promoted')` — stratified:
   5 lab reports, 3 discharge summaries, 1 prescription, 1 vaccination
   card (substitute if absent).
2. For each sampled extraction, open `raw_ocr_markdown` + source PDF and
   compare against `verified_structured`.
3. Score each: `CORRECT`, `MINOR_ERROR` (unit/date typo, clinically
   equivalent), `MAJOR_ERROR` (value wrong, wrong drug, wrong patient).
4. Results logged to `dis_weekly_audit` table (new; see data_model for
   future migration) with reviewer ID.

**Pass criteria (rolling 4-week window):**

- ≥ 95% `CORRECT`.
- 0 `MAJOR_ERROR` before default rollout; ≤ 1 per 100 in steady state.
- Any `MAJOR_ERROR` opens a P1 ticket; if it changed a doctor's decision,
  trigger incident runbook in `09_runbooks/`.

**Escalation:** two `MAJOR_ERROR` in one week → automatic pause on any
rollout advancement until root cause addressed.

## 5. Operational metrics

Tracked continuously and asserted weekly. Thresholds are contracts.

| Metric                   | Definition                                  | Green | Yellow (investigate) | Red (incident) |
| ------------------------ | ------------------------------------------- | ----- | -------------------- | -------------- |
| Edit rate                | `edits_per_extraction > 0` / total verified | < 30% | 30–50%               | > 50%          |
| Reject rate              | rejected / total terminal                   | < 10% | 10–20%               | > 20%          |
| Verified-but-wrong       | audit `MAJOR_ERROR` / audited               | 0%    | < 1%                 | > 1%           |
| Time-to-verification P95 | `verified_at - created_at`                  | < 4 h | 4–8 h                | > 8 h          |
| Queue depth max          | `pending_review` at any moment              | < 20  | 20–50                | > 50           |

Metrics dashboards are populated from `ocr_extractions`, `ocr_audit_log`,
and `dis_cost_ledger`. Queries live in `09_runbooks/metrics_queries.sql`.

## 6. Sign-off process

Per `08_team/RACI.md`:

- **Responsible:** QA Lead — curates fixtures, runs the suite.
- **Accountable:** Clinical Reviewer — signs off each fixture-set
  version and each weekly audit.
- **Consulted:** Tech Lead — when errors trace to code.
- **Informed:** PM, Ops.

A clinical acceptance run is "green" and unlocks rollout advancement
only when:

- All fixtures pass (or deltas explicitly approved under §2).
- Weekly audit passes §4 criteria.
- No open P1 clinical-safety ticket.

Sign-off artifact: a PR titled
`clinical-acceptance: week YYYY-Www signed off`
with the reviewer's name in the body and the audit table attached.

## 7. Adversarial / red-team suite details

Fixtures 17–20 have specific assertions:

- **17 (wrong-patient report):** The verification UI must surface a
  `patient_mismatch_suspected` warning when the name on the document
  does not match the patient record (basic fuzzy-name check). The
  canonical nurse action is **reject with reason `wrong_patient`**. Test
  asserts that reject path succeeds and no rows reach clinical tables.
- **18 (mixed-patient):** The UI offers no "auto-split" option (that's a
  non-goal). Canonical action: reject with note. Test asserts rejection.
- **19 (blank + 1 readable):** The preprocessor drops the blank page;
  extraction proceeds with 1 page. `dropped.blank=1` recorded. Test
  asserts the readable page's labs are extracted correctly.
- **20 (all-blank):** Extraction reaches status `failed` with
  `error_code='ALL_PAGES_BLANK'`. Nurse sees failure with suggested
  action: re-scan. No rows written anywhere.

## 8. Regression guard

Before any structuring prompt change or adapter swap:

1. Run full fixture suite against the candidate.
2. Any fixture that flips from green to red without a golden update PR
   is a hard block on the change.
3. Benchmark report attached to the change PR: {fixture, pre, post,
   delta, clinical impact}.

## 9. Out of scope for this doc

- Mechanics of how golden files are regenerated — see `fixtures.md` §Update procedure.
- Schema details — see `03_data/data_model.md`.
- Who is on the RACI — see `08_team/RACI.md`.
