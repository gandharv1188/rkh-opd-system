# DIS Rollout Plan

> Authoritative phased rollout for the Document Ingestion Service (DIS).
> Every phase has entry criteria, exit criteria, rollback trigger, a comms
> plan, and numeric success metrics. No phase advances on vibes.
>
> Referenced artefacts: `01_product/clinical_safety.md` (CS-1…CS-12),
> `01_product/user_stories.md` (DIS-US-###), `02_architecture/tdd.md`
> (§4 state machine, §18 non-functional targets), `06_rollout/feature_flags.md`,
> `06_rollout/kill_switch.md`.

## Rollout overview

| Phase | Name                | Duration                          | Audience                                          | Writes to `lab_results`?                               |
| ----- | ------------------- | --------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| 0     | Internal dev + test | 1 week                            | Engineers only                                    | No (test env only)                                     |
| 1     | Shadow mode         | 2 weeks                           | All prod traffic, legacy remains system of record | **No** — DIS writes only to `ocr_extractions`          |
| 2     | Opt-in              | 2–4 weeks                         | Named reception clerks                            | Yes — only for opted-in operators, via verification    |
| 3     | Default             | 2 weeks soak                      | All traffic                                       | Yes — DIS is default; legacy reachable via kill switch |
| 4     | Legacy removal      | 1 PR, ≥ 1 week after Phase 3 exit | —                                                 | Legacy `process-document` deleted                      |

Kill switch (`DIS_KILL_SWITCH`) is live from Phase 1 onward.

---

## Phase 0 — Internal dev + test only

**Audience.** Engineering team. No real patients. Dev project
`ecywxuqhnlkjtdshpcbc-dev` (cloned schema, fixture data only).

**Flags.**

- `DIS_ENABLED=true` (dev project only)
- `DIS_SHADOW_MODE=false`
- `DIS_OPT_IN_OPERATORS=""`
- `DIS_OCR_PROVIDER=datalab`
- `DIS_STRUCTURING_PROVIDER=haiku`
- `DIS_AUTO_APPROVAL_ENABLED=false` (CS-7: must stay false at launch)
- `DIS_KILL_SWITCH=false`

**Entry criteria.**

- TDD §1–§20 signed off.
- Migrations in `03_data/migrations.md` applied on dev project.
- `ocr_extractions`, `ocr_audit_log`, `dis_confidence_policy`, `dis_cost_ledger` tables exist.
- OpenAPI `04_api/openapi.yaml` served; contract tests green.
- Red-team fixture set (see `clinical_safety.md` §"Out-of-band safeguards") checked in.

**Exit criteria (all numeric).**

- 100% of state transitions in §4 TDD covered by integration tests.
- Contract tests for every endpoint in `04_api/openapi.yaml`: pass.
- Red-team fixture set: all 12 adversarial documents are either rejected
  or promoted with correct verified values (0 silent failures).
- Unit coverage on DIS core ≥ 85%.
- P95 end-to-end latency on dev fixtures ≤ 90 s (TDD §18).
- Zero rows written to `lab_results` / `vaccinations` in dev without
  an associated `ocr_extraction_id` (CS-3 DDL test).

**Rollback trigger.** Any CS-# violation in a test run. Revert merge,
re-test.

**Comms plan.**

- Internal Slack: `#dis-rollout` channel created.
- Daily engineering standup reviews red-team fixture pass rate.

**Success metrics (logged to `dis_cost_ledger` and `ocr_audit_log`).**

- Test env: mean OCR latency, mean structuring latency, mean cost/doc.
- Baseline established for Phase 1 comparison.

---

## Phase 1 — SHADOW MODE (parallel, no clinical writes)

**Audience.** 100% of real production traffic. Legacy `process-document`
remains the system of record. DIS runs in parallel and writes **only**
to `ocr_extractions` — never to `lab_results`, never to `vaccinations`,
never to `visits.attached_documents.ocr_*`. This is hard-enforced by
leaving the promotion path behind the `DIS_SHADOW_MODE=true` guard:
when shadow mode is on, `PromotionService.promote()` throws
`ShadowModePromotionBlocked`.

**Flags.**

- `DIS_ENABLED=true`
- `DIS_SHADOW_MODE=true`
- `DIS_OPT_IN_OPERATORS=""`
- `DIS_AUTO_APPROVAL_ENABLED=false` (CS-7 hard rule)
- `DIS_KILL_SWITCH=false`

**What runs where.**

- Browser upload flow is unchanged. Registration page keeps calling the
  legacy `process-document` for on-screen OCR summary (so reception
  workflow is not disturbed).
- A side-channel copies every uploaded document to DIS `/ingest`.
- DIS runs full pipeline → `ocr_extractions.status = pending_review`.
- A diff worker joins `ocr_extractions` with whatever legacy wrote to
  `visits.attached_documents.ocr_*`. Per-field diffs are logged to
  `dis_shadow_diffs` (field, legacy_value, dis_value, agreement_bool).

**Entry criteria.**

- Phase 0 exit criteria met.
- `dis_shadow_diffs` table + materialized view `dis_shadow_agreement`
  deployed.
- Diff worker scheduled (pg_cron every 5 min on Supabase).
- DIS URL reachable from Edge Functions and from the browser.
- Kill switch tested end-to-end (see `kill_switch.md`).

**Duration.** 2 weeks (minimum 10 business days, so we sample at least
~500 real uploads given current volumes).

**Exit criteria (all numeric).**

- ≥ 500 real documents processed by DIS in shadow.
- Per-field agreement with legacy:
  - `summary` similarity (Jaccard on tokens) ≥ 0.80 median.
  - `lab_values.test_name_normalized`: exact-match ≥ 90%.
  - `lab_values.value_numeric`: numeric equality (±1%) ≥ 95% on rows
    where both pipelines extracted a value.
  - `vaccinations.vaccine_name_normalized`: ≥ 90% exact match.
- DIS hard-error rate (extractions ending in `failed` state): ≤ 3%.
- DIS P95 end-to-end to `pending_review`: ≤ 90 s (TDD §18).
- Per-document cost: ≤ ₹0.40 (TDD §18).
- Zero rows in `lab_results`/`vaccinations` attributable to DIS
  (SQL audit: `SELECT COUNT(*) FROM lab_results
WHERE ocr_extraction_id IN (SELECT id FROM ocr_extractions
WHERE created_at > <phase1_start>)` = 0).
- Zero CS-# violations in audit sampling.

**Rollback trigger.**

- DIS hard-error rate > 10% over any 2 h window, OR
- P95 latency > 180 s over any 2 h window, OR
- Any unexplained write to `lab_results` linked to a DIS extraction, OR
- A clinical-safety incident report (even if unproven): flip
  `DIS_ENABLED=false`, stop the diff worker, RCA within 24 h.

**Comms plan.**

- Day −3: email to reception + nurse leads: "DIS will run in shadow;
  UI unchanged." Signed by clinical lead.
- Day 0: go-live notice in `#dis-rollout`.
- Week 1 end: first agreement report posted to `#dis-rollout` and
  emailed to clinical lead.
- Week 2 end: go/no-go meeting with clinical lead + engineering lead.

**Success metrics tracked daily.**

- Upload volume (legacy vs shadow).
- Agreement % per field category.
- DIS latency P50/P95.
- DIS error rate.
- DIS cost per document.
- Queue depth in `ocr_extractions` (pending_review count). N.B. shadow
  mode never drains this queue; it grows monotonically — a known artefact.

---

## Phase 2 — OPT-IN (named operators, verification UI live)

**Audience.** A named allowlist of 2–3 reception clerks (initial list
maintained in `DIS_OPT_IN_OPERATORS`). Everyone else stays on the legacy
pipeline. Nurse verification UI (DIS-US-010…015) is live for opted-in
extractions only.

**Flags.**

- `DIS_ENABLED=true`
- `DIS_SHADOW_MODE=false`
- `DIS_OPT_IN_OPERATORS="<user_id_1>,<user_id_2>"` (start with 2)
- `DIS_AUTO_APPROVAL_ENABLED=false` (CS-7)
- `DIS_KILL_SWITCH=false`
- `DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE=100`
- `DIS_MAX_PAGES=50`
- `DIS_MAX_UPLOAD_MB=20`

**How routing works.**

- Browser calls `/ingest` if `auth.user_id ∈ DIS_OPT_IN_OPERATORS`,
  else legacy `process-document`. Evaluated in `registration.html`
  on upload.
- Server double-checks: the `/ingest` endpoint rejects 403 if the
  caller is not in the opt-in list (defense in depth).

**Entry criteria.**

- Phase 1 exit criteria met and signed off by clinical lead.
- Nurse verification UI shipped (DIS-US-011, 012, 013, 014, 015).
- Queue page shipped (DIS-US-010).
- Training completed: see `comms_and_training.md` §"Phase 2 training".
- Red-team adversarial fixtures re-run on latest prompts: all caught.
- `get_lab_history` and `loadRecentLabs()` confirmed to filter
  `verification_status = 'verified'` (CS-12, DIS-US-020).

**Duration.** 2–4 weeks. Start at 2 operators, expand after week 2 to
≤ 6 operators if metrics stay clean.

**Exit criteria (all numeric).**

- ≥ 300 real documents verified through the UI across ≥ 6 operators.
- Nurse **edit rate** (fields edited vs fields approved unchanged) ≤ 15%.
- Nurse **reject rate** (rejected / total) ≤ 10%.
- "Verified-but-wrong" rate from clinician weekly audit: 0 in the last
  2 weekly audits (CS-#"Out-of-band safeguards").
- P95 time-from-upload-to-verified ≤ 30 min during business hours.
- Nurse NPS / thumbs-up on verification UI ≥ 80% in structured survey.
- 0 clinical-safety incidents.
- All CS-1…CS-12 integration tests still green on `main`.

**Rollback trigger.**

- Any clinical-safety incident (CS-1…CS-12 violation in prod): flip
  `DIS_KILL_SWITCH=true` within 15 min.
- Edit rate > 30% sustained for 3 days (AI output too noisy — pause and
  retune prompt).
- Reject rate > 25% sustained for 3 days.
- Queue drain latency > 4 h during business hours for 2 consecutive
  days (nurse capacity insufficient).

**Comms plan.**

- Day −7: 1:1 with each opted-in reception clerk; walkthrough.
- Day −3: 20-minute nurse training session (see training checklist).
- Day 0: go-live, support engineer on-call pager.
- Daily standup for first week.
- Weekly status report (see `comms_and_training.md`).

**Success metrics (weekly).**

- Uploads routed to DIS / total uploads by opted-in operators.
- Verification throughput per nurse per hour.
- Edit rate, reject rate, by document category.
- Time-in-queue P50/P95.
- Cost per verified extraction.
- Zero-violation streak (days since last CS-# incident).

---

## Phase 3 — DEFAULT (DIS is the default; legacy reachable via kill switch)

**Audience.** 100% of reception. Legacy `process-document` code still
deployed but only invoked when `DIS_KILL_SWITCH=true`.

**Flags.**

- `DIS_ENABLED=true`
- `DIS_SHADOW_MODE=false`
- `DIS_OPT_IN_OPERATORS="*"` (wildcard = everyone)
- `DIS_AUTO_APPROVAL_ENABLED=false` (still off at launch; CS-7)
- `DIS_KILL_SWITCH=false`

**Entry criteria.**

- Phase 2 exit criteria met, signed off by clinical lead.
- Runbook `09_runbooks/kill_switch.md` tested in staging and prod.
- On-call rotation published.
- Support engineer trained on verification UI issues.

**Duration.** 2-week soak.

**Exit criteria (all numeric).**

- All Phase 2 metric thresholds hold for all 14 days.
- Edit rate ≤ 12%, reject rate ≤ 8%, hard-error rate ≤ 2%.
- P95 end-to-end ≤ 90 s.
- Kill switch not used during the soak (if used once, restart the 14-day clock).
- 0 CS-# violations.

**Rollback trigger.** Same as Phase 2.

**Comms plan.**

- All-reception email: "DIS is now default for all new uploads; legacy
  remains as emergency fallback."
- Training refresher for nurse team.
- Status in weekly hospital-ops meeting.

---

## Phase 4 — LEGACY REMOVAL

**Audience.** N/A — internal only.

**Entry criteria.**

- Phase 3 soak complete, all exit criteria met.
- No open incident referencing legacy.
- At least 1 week has passed since any consideration of flipping the
  kill switch.

**What we do.**

1. Remove the `DIS_KILL_SWITCH` branch from `/ingest` router.
2. Delete `supabase/functions/process-document/` directory.
3. Remove legacy DB triggers and shadow-diff tables (keep archive dump).
4. Update CLAUDE.md to remove legacy references.

**Exit criteria.**

- `process-document` removed from Supabase project.
- CI green, no import references to legacy.
- Final go-live note: "DIS is now the sole document ingestion path."

**Rollback trigger.** If anything goes wrong after removal, restore
from git history into a new Edge Function; DIS is still default.

**Comms plan.**

- Change log entry in release notes.
- Mention in weekly status report.

---

## Cross-phase safety invariants (always true, never negotiable)

1. **CS-7:** `DIS_AUTO_APPROVAL_ENABLED` is `false` from Phase 0 through
   Phase 4 exit. Any change is a separate governance ticket.
2. **CS-1:** Only `verified` or (future) `auto_approved` extractions
   promote to clinical tables.
3. **CS-12:** `loadRecentLabs()` and `get_lab_history` filter
   `verification_status = 'verified'` at all times.
4. **Kill switch ≤ 5 min RTO** from flip to full effect (TDD §18).
5. **Raw responses retained indefinitely** (CS-2).

## Decision authority

| Decision                         | Owner                                                      | Backup                 |
| -------------------------------- | ---------------------------------------------------------- | ---------------------- |
| Phase entry/exit                 | Engineering lead + Clinical lead (Dr. Goyal)               | —                      |
| Flip kill switch                 | On-call engineer                                           | Engineering lead       |
| CS-# incident classification     | Clinical lead                                              | RACI `08_team/RACI.md` |
| Opt-in operator list change      | Engineering lead                                           | Reception lead         |
| Flip `DIS_AUTO_APPROVAL_ENABLED` | Requires separate governance ticket; not part of this plan |
