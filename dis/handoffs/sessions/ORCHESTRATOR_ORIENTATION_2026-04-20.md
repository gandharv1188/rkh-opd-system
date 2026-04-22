# Orchestrator Orientation — 2026-04-20 (post-Wave-3 session)

> Authored by the orchestrator after a full, deep re-read of every plan
> document (45 files, ~21k lines) and every source/test/CI file in
> `dis/`, triggered by the user's instruction: "I know you bullshit,
> and that is not acceptable. This is a healthcare project; such
> things will lead to a huge burden at a later date."
>
> Purpose: a durable, reviewable record of what the orchestrator
> actually knows — so the next teammate/session/human reviewer can
> test the claims against the files, not against memory.
>
> Companion to `SESSION_HANDOVER_2026-04-20.md` (end-of-build
> handover) and `ORIENTATION_REVIEW_2026-04-20.md` (initial — now
> superseded by this file where they disagree).

---

## §0. What this document is

This is not a plan and not a proposal. It is a **self-audit** of the
orchestrator's knowledge of the DIS codebase + plan as of
2026-04-20, after reading every document and every source file in
full — not scanning, not grepping for keywords, not summarising from
titles. It exists because an earlier version of this orientation
skipped corners (runbooks 5/7 unread, 7 handoffs unread, all adapter
tests unread, `fitness.mjs` live state never executed), and the user
rightly rejected it as unsafe for a clinical project.

The user may test any claim in this document against the actual
files. Anything I wrote here that a reviewer cannot verify by
re-running the same commands, re-reading the same file, or checking
the same line of code is a drift signal I should be held to.

---

## §1. The plan — 45 documents, all read in full

### 00_overview (3 files)

- **`north_star.md`** — one-sentence goal: cloud-portable,
  verification-gated DIS. Three properties: auditability, safety,
  portability. Solution diagram: `Browser → DIS API → Staging
(ocr_extractions) → Verification UI → promote to clinical tables`.
  "Done" definition: reception uploads discharge summary → nurse
  verifies side-by-side → rows land with `source:'verified'` +
  `ocr_extraction_id` → doctor reads verified labs → AWS redeploy in
  one working day.
- **`glossary.md`** — 35 canonical terms. Binding: agents MUST use
  these exact terms. Key ones: `Extraction` (one row in
  `ocr_extractions`), `Raw response` (verbatim Datalab JSON),
  `Staging` (pre-verified), `Promotion` (copy verified into clinical
  tables), `Auto-approval` (machine promotion when thresholds met),
  `Shadow mode` (parallel run, no user impact).
- **`non_goals.md`** — 12 explicit out-of-scope items: pad-mode OCR,
  on-prem Chandra v1, ABDM/FHIR integration, mobile apps, real-time
  collaboration on verification UI, DICOM/HL7/EML/archives,
  multi-tenant, rewriting the frontend upload form, replacing
  `generate-prescription`, auth/SSO rework, analytics/BI on
  extractions, automatic reprocessing of historical PDFs (379 stay
  as-is).

### 01_product (3 files)

- **`product_brief.md`** — problem, proposal, 4 user roles (reception
  clerk, nurse/verifier, doctor, sysadmin), 7 success criteria (zero
  unverified clinical rows, >95% verified within 4h business hours,
  <30% nurse edit rate, per-doc cost ≤ current, P95 <60s, zero CS
  incidents, 1-day AWS redeploy), in-scope list, 8 risks with
  mitigations. Assumes <100 docs/day at POC.
- **`clinical_safety.md`** — **CS-1..CS-12, 12 hard rules, numbered
  once, never renumber.**
  - **CS-1** No unverified OCR data in clinical tables.
  - **CS-2** Raw OCR + structured responses preserved forever.
  - **CS-3** Every clinical row traces to one extraction via FK
    ON DELETE RESTRICT.
  - **CS-4** Verified values never silently overwritten — re-ingest
    creates new extraction.
  - **CS-5** Reject is permanent; no recovery except new upload.
  - **CS-6** Edits logged field-by-field in `ocr_audit_log`.
  - **CS-7** Confidence gates explicit + default OFF; policy in
    `dis_confidence_policy` table.
  - **CS-8** PII stays within patient RLS boundary.
  - **CS-9** Test-name normalization is audited (raw preserved
    separately from normalized).
  - **CS-10** Discharge-summary latest-only is code-enforced, not
    prompt-enforced.
  - **CS-11** Duplicate-row prevention on promotion
    `(patient_id, test_name, test_date, value_numeric)`.
  - **CS-12** No OCR data reaches prescription generator unverified.
  - Plus out-of-band: weekly clinician audit of 10 random samples,
    red-team fixtures, metrics-driven investigation thresholds.
- **`user_stories.md`** — **DIS-US-001..032, 25 stories** across:
  reception (001-003 upload + progress + retry), nurse (010-015
  queue/verify/approve/edit/reject/duplicate), doctor (020-021 see
  verified + AI badge), admin (030-032 metrics + key rotation + kill
  switch).

### 02_architecture (6 files)

- **`tdd.md`** — 20 sections, the authoritative contract every PR
  cites. I read all 20. Highlights:
  - §1 Hexagonal + Ports & Adapters; CQRS-lite staging→production
    boundary.
  - §2 Component diagram.
  - §3 Service boundary: 6 browser-facing endpoints + realtime +
    polling fallback.
  - §4 State machine: 10 states, 11 event kinds, all transitions
    audit-logged, invalid transitions throw.
  - §5 Idempotency — `Idempotency-Key` UUID header, stored with
    UNIQUE constraint, duplicate POST returns existing row, CS-11
    dedup on promotion.
  - §6 Optimistic locking: `version INT NOT NULL DEFAULT 1`,
    `UPDATE … WHERE id=? AND version=?` → 409 on mismatch.
  - §7 File router tree: pdf→native-text-probe→(native or scan),
    jpeg/png/heic/webp/bmp/tiff→ocr_image, docx/doc→office_word,
    xlsx/xls/csv→office_sheet, else→415. Threshold 100 chars/page
    configurable via `DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE`.
  - §8 Preprocessing: 9 steps (normalize container, deskew,
    perspective, blank-drop, dup-drop, resize, CLAHE, JPEG q=85,
    page-cap 50).
  - §9 OCR adapters — Datalab Chandra default, Claude Vision
    fallback, on-prem stub. §9.1 OcrPort interface (OcrInput,
    OcrResult, Block discriminator).
  - §10 Structuring adapter — Claude Haiku default, Sonnet
    escalation; prompt versioned; §10.1 StructuringPort interface
    (StructuringInput, StructuringResult, ClinicalExtractionShape).
  - §11 Validated output schema (ClinicalExtraction v1 with labs[]
    / medications[] / diagnoses[] / vaccinations[] / clinical_notes).
  - §12 Confidence policy — stored as JSON in
    `dis_confidence_policy`, `enabled: false` at launch (CS-7).
  - §13 Promotion service — CS-10 discharge dedup + CS-11
    duplicate-guard + single-transaction + rollback on failure
    returns extraction to `pending_review`.
  - §14 Observability — structured JSON logs with correlation IDs,
    metrics, OpenTelemetry tracing (no-op at POC), cost ledger
    per-call.
  - §15 Error model — summary; full in `04_api/error_model.md`.
  - §16 Security — OWASP, signed upload URLs only, CSP, audit log
    trigger-enforced immutable.
  - §17 Portability — adapter per port per environment, 5-step
    porting checklist.
  - §18 Non-functional targets — P50 ingest <1s, P95 end-to-end
    ≤90s, availability 99.5%, per-doc cost ≤ ₹0.40, RTO for kill
    switch <5 min, raw retention indefinite.
  - §19 Legacy-preservation contract — accept base64 + URL inputs;
    don't touch pad-mode; continue writing `ocr_summary` during
    shadow.
  - §20 What DIS does differently — raw preserved forever; no
    writes until verification; idempotency; duplicate guard;
    confidence-gated auto-approval opt-in; adapter-based vendor
    independence.
- **`adapters.md`** — directory layout, 8-port inventory with
  POC+prod adapters, 6 ground rules (core never imports adapter;
  adapters never import each other; core has no Node-specific APIs;
  every adapter has a fake; adapter swaps are config not deploy;
  port-validator lint rule); change-control via ADR with
  `// port-version:` bump.
- **`portability.md`** — Supabase↔AWS matrix across 8 concerns
  (compute / object storage / DB / queue / secrets / realtime /
  auth / CDN); 3 containment boundaries (pure core, thin wiring,
  adapter set); single Dockerfile that runs anywhere; extensions
  required on both stacks (`pgcrypto`, `pg_stat_statements`,
  `pg_trgm`) and Supabase-specific ones we do NOT use
  (`pg_graphql`, `pg_net` except in pg_cron adapter,
  `supabase_vault`); 8-step porting checklist; dry-run required
  before DIS v1 ships.
- **`sequence_diagrams.md`** — 5 ASCII flows: (1) upload →
  ready_for_review scan path with full adapter call chain,
  (2) nurse approve → promotion with transaction, (3) native PDF
  fast-path skipping preprocess+OCR, (4) kill switch flipped,
  (5) shadow mode parallel run.
- **`coding_standards.md`** — 17 binding sections. Language
  (strict TS + ESM + Node 20 + discriminated unions +
  `assertNever`); SOLID/hex/12-factor/CQRS-lite; code organisation
  (folder by feature); typed errors; concurrency; OWASP Top-10
  alignment; DB rules (parameterised only, every mutable table
  has version+correlation_id, append-only via triggers, FK
  `ON DELETE RESTRICT` for clinical); structured pino logging;
  testing (pyramid 80/15/5, core ≥90% lines+branches, fakes over
  mocks, property-based for combinatorial); API (OpenAPI 3.1 as
  source of truth, semver on path, cursor pagination, Idempotency
  header mandatory); conventional commits with
  `feat(DIS-123): … — implements TDD §X.Y`; deps minimization;
  WCAG 2.2 AA; perf budgets ±10%; ADRs for meaningful decisions;
  DoD; CI enforcement.
- **`drift_prevention.md`** — 11 controls: **Phase 1 (active)**:
  Control 1 PR-citation resolver, Control 2 files_allowed
  allowlist, Control 3 architectural fitness functions, Control 7
  dead-code/TODO detector, Control 10 orchestrator 20%/100%
  re-verification sampling. **Phase 2 (staged)**: Control 4 spec
  hash locking, Control 5 anti-regression baselines, Control 6
  forbidden commit-msg tokens, Control 8 prompt version stamping,
  Control 9 ADR-gated `// reason:` escape hatches, Control 11
  handoff diff audit. Failure-mode library F1..F12 maps real
  agent-failure patterns to the control that catches each.

### 03_data (2 files)

- **`data_model.md`** — 5 new tables. `ocr_extractions` is the
  staging command-side table with all raw + structured + verified
  - promotion_result columns, version column, correlation_id,
    tokens_in/out/cost_micro_inr. `ocr_audit_log` is append-only
    (trigger blocks update + delete). `dis_confidence_policy` stores
    single active row with `deactivated_at IS NULL`. `dis_jobs` is
    POC queue (replaced by SQS on AWS). `dis_cost_ledger` is
    append-only finance record. Alters on 3 existing tables
    (lab_results + vaccinations add ocr_extraction_id FK +
    verification_status + verified_by/at with backfill;
    `visits.attached_documents` gains optional ocr_extraction_id +
    ocr_verification_status keys in the JSONB entries). RLS
    patterns with `current_setting('app.role', true)` generic shape.
    Retention: extractions + audit + cost indefinite; jobs 30-day
    post-completion.
- **`migrations.md`** — 9 migrations M-001..M-009, all additive
  and reversible except M-009 (cutover, applied only after
  feature-flag default rollout). Each has `.rollback.sql`. CI
  roundtrips forward→down→forward and byte-compares
  `pg_dump --schema-only`. Data-safety test loads legacy fixture
  and asserts post-migration constraint satisfaction.

### 04_api (1 markdown + 1 referenced YAML)

- **`error_model.md`** — 21 stable UPPER_SNAKE codes. Envelope
  `{error:{code, message, details?, retryable, request_id,
correlation_id}}`. HTTP status mapping — 400 / 401 / 403 / 404 /
  409 (idempotency + version-conflict + invalid state transition)
  / 413 / 415 / 422 / 429 / 500 / 502 / 503 / 504. Retry policy
  base 1s / factor 2 / cap 30s / jitter ±20%. Client behaviors:
  VERSION_CONFLICT → re-GET + re-render, never auto-retry;
  DUPLICATE_DOCUMENT → banner + explicit override_duplicates:true;
  OCR_PROVIDER_UNAVAILABLE → UI message + background retry.
- **`openapi.yaml`** — referenced but not in the plan folder
  (lives in the dis/ source tree as DIS-007 scope; DIS-007 not
  yet built).

### 05_testing (6 files)

- **`test_strategy.md`** — pyramid: unit 70%, integration 22%,
  clinical acceptance 6%, e2e/UI smoke 2%. Coverage thresholds
  per folder (core ≥90/85, adapters non-network ≥80/70, network
  ≥70/60, http ≥80/70, UI smoke-only). TDD mechanics:
  `test_ticket:` field on every impl ticket, PR template
  checkbox, `assert-tdd-order.sh` lint hook, clinical-safety
  tickets use `[RED][CS-##]` / `[GREEN][CS-##]` commit prefixes.
  9 CI gates in fail-fast order (lint, typecheck, unit+coverage,
  integration, clinical, migrate:roundtrip, openapi:lint,
  security:scan, e2e smoke). CS-1..CS-12 → test-file mapping.
- **`clinical_acceptance.md`** — 20-fixture minimum with explicit
  per-fixture category + challenge + source table. Golden-file
  pattern. Weekly clinician audit (10 samples, 4-week rolling
  window, >95% CORRECT required, zero MAJOR_ERROR before default
  rollout, ≤1/100 in steady state, 2 MAJOR_ERROR in one week →
  auto-pause rollout). Operational metrics green/yellow/red
  thresholds. Sign-off process.
- **`fixtures.md`** — folder layout, kebab-case naming,
  metadata.yaml with anonymization.verified_by + verified_at.
  PHI handling non-negotiable: 8 redaction rules, pair-reviewed,
  pre-commit PII guard with name/Aadhaar/UHID regex. Minimum
  coverage 18+ fixtures across 6 categories.
- **`integration_tests.md`** — 10 named scenarios with per-step
  assertions: happy_path_pdf, reject_path, duplicate_document,
  discharge_latest_only (7 TSB CS-10), idempotency,
  version_conflict, kill_switch, provider_outage,
  confidence_default_off, rls_patient_isolation. Execution matrix
  PR-time uses fakes, nightly hits sandbox providers.
- **`unit_tests.md`** — 8 test files catalogue. I counted the named
  tests: orchestrator 10, state-machine 10, confidence-policy 10,
  promotion 11, audit-log 10, file-router 11, preprocessor 11,
  structuring 10.
- **`verify_format.md`** — binding format. Every AC becomes a
  Given/When/Then with `Command` + `Expected output` + `Actual
output` (pasted verbatim — no paraphrase) + `Artifact` (commit
  SHA / test file:line) + `Status: PASS | FAIL | N/A`.
  Clinical-safety tickets carry an additional "Clinical evidence
  / Sign-off pending" row. Integration tickets prefix every
  VERIFY with `Environment: STAGING`. Minimal good/bad example.
  Reviewer re-runs 20% default, 100% for clinical-safety /
  integration.

### 06_rollout (4 files)

- **`rollout_plan.md`** — Phase 0 dev (1 week) → Phase 1 shadow
  mode (2 weeks, ≥500 real docs, numeric agreement thresholds per
  field type) → Phase 2 opt-in (2-3 clerks then ≤6, 2-4 weeks,
  edit rate ≤15%, reject rate ≤10%, P95 time-to-verify ≤30 min
  business hours, zero CS incidents) → Phase 3 default (2-week
  soak, edit ≤12%, reject ≤8%, hard-error ≤2%) → Phase 4 legacy
  removal. **CS-7 auto-approval remains `false` through Phase 0-4
  exit** — separate governance ticket only.
- **`feature_flags.md`** — 10 flags catalogued. DIS_ENABLED
  master. DIS_KILL_SWITCH overrides everything else when true.
  DIS_SHADOW_MODE / DIS_OPT_IN_OPERATORS / DIS_OCR_PROVIDER /
  DIS_STRUCTURING_PROVIDER. DIS_AUTO_APPROVAL_ENABLED is
  database-controlled (via `dis_confidence_policy`) not
  env-var — audit trail sits next to clinical tables.
  DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE / DIS_MAX_PAGES /
  DIS_MAX_UPLOAD_MB. Precedence matrix and `dis_config_audit` +
  `dis_runtime_flags` schema.
- **`kill_switch.md`** — 3 flip paths (CLI ~60s, dashboard ~2min,
  hot DB row via LISTEN/NOTIFY sub-minute), RTO ≤5min, 3
  detection signals, decision tree (CS violation → flip
  unconditional; 5xx>5% sustained → flip unless clear transient;
  backlog>500 → flip). Un-flip ritual: 48h shadow re-soak
  (4h for non-safety) + clinician sign-off + new `dis_config_audit`
  row with reason. Quarterly game-day test + pre-phase-transition
  staging test + per-deploy CI synthetic. **Uses 307-proxy to
  legacy** per runbook prose — conflicts with `rollout_plan.md` +
  `feature_flags.md` + DIS-100 backlog which all say 503
  UNAVAILABLE. This is a known cross-doc discrepancy needing
  reconciliation.
- **`comms_and_training.md`** — 6 audiences, per-phase comms
  matrix, training packs (reception clerk / nurse / doctor /
  admin), rollback announcement template, clinical-safety
  escalation path with paging timings, weekly status report
  format, feedback channels (WhatsApp, paper clipboard at nurse
  station, weekly 15-min standup), training completion
  spreadsheet — no operator clears DIS until 18/20 fixtures
  verified correctly in training.

### 07_tickets (7 files + clarifications placeholder missing)

- **`README.md`** — lifecycle, 11 tags, integration hold rule
  (binding, absolute), wave workflow, Architect owns the board
  (agents don't edit status lists), Verify-Driven Ticketing
  section pointing at verify_format.md.
- **`_ticket_template.md`** — mandatory fields, YAML
  `files_allowed:` block with CI-rejection note,
  numbered `VERIFY-N` (Command / Expect / Pass-if) inside
  unlanguaged fenced block, Out-of-scope explicit-new-tickets,
  Test plan (unit/integration/clinical), Review gates checklist
  extended with 4 Verify-specific rows.
- **`epics.md`** — A→B→C→D→E→F→G(held)→H. Each epic has
  acceptance, ticket range, "touches existing system?" answer.
- **`backlog.md`** — **3969 lines, 188 tickets**, every ticket in
  Verify-Driven format. I read the full file end-to-end across
  four Read calls. Status counts as of 2026-04-20: 15 merged,
  173 Ready.
- **`integration_hold.md`** — 10 Epic G tickets (DIS-200..209)
  each with execution gate text + [STAGING ONLY] VERIFY prefix.
- **`in_progress.md`** / **`done.md`** / **`blocked.md`** — all
  placeholder skeletons. `done.md` has NOT been backfilled with
  the 15 merged tickets (architect process gap flagged).

### 08_team (4 files)

- **`RACI.md`** — roles, matrix, tag effects
  (`clinical-safety` → Gate 6a human clinician sign-off;
  `integration` → Gate 6b user `INTEGRATION APPROVED`;
  `migration` → SRE+Architect joint + CI roundtrip; `security` →
  Security Reviewer; `breaking` → ADR + Architect
  `BREAKING APPROVED`; `doc-only` → skip Gate 2). Escalation
  (blocked ticket >24h → clarification; CS concern mid-ticket →
  stop + escalate; data-leak suspicion → SEV1). Out-of-band
  duties (weekly clinician audit, monthly cost review, quarterly
  DR drill).
- **`review_gates.md`** — 7 gates + conditional 6. Gate 5
  Code-review explicitly includes Control 10 re-verification
  paragraph (reviewer re-runs ≥20% of VERIFY commands from the
  handoff; 100% for clinical-safety / integration). Merge
  mechanics: squash-and-merge features, rebase-and-merge
  migrations, Architect is the only role that merges to the
  integration branch. **No emergency override for 6a or 6b.**
- **`session_handoff.md`** — 2-level (ticket + feature-level).
  Ticket-level template 11 sections + Verify Report. Lives in
  `dis/handoffs/DIS-###.md` committed on the ticket's branch.
  Feature-level template for DIS v1 completion. Integration with
  gates (Gate 7 DoD checks handoff present + sections filled).
  Agent prompt amendment: "SESSION HANDOFF" block immediately
  before mandatory final commit.
- **`agentic_dev_protocol.md`** — Phases 0..9 + cross-cutting
  X.1..X.7. Honest Y/P/N status (27 Y, 28 P, 14 N across ~69
  rows by my last count). "What's missing most urgently" names
  ADRs, mutation/golden/property-based tests, clinical-acceptance
  corpus, CI gate wiring, observability+dashboards, prompt eval
  harness, cost model, Phase-2 drift controls.

### 09_runbooks (7 files)

- **`README.md`** — paging matrix (SEV1 CS violation = Primary +
  Clinical, SEV2 5xx>5% = Primary, SEV3 email-only), "if unclear
  flip kill switch first" first rule, 6-path entry-point guide.
- **`incident_response.md`** — 3 severities, paging, 15-min
  stabilize→snapshot→comms loop with exact shell commands,
  kill-switch decision tree, timeline template, blameless
  post-mortem within 72h, SEV1 must include at least one new
  monitoring/alerting action item.
- **`key_rotation.md`** — 4 rotation triggers, golden rule
  (never revoke until new confirmed), POC procedure (Datalab +
  Anthropic + Supabase service-key special-case with 5-min
  freeze), prod AWS procedure (AWSPENDING → AWSCURRENT via
  Secrets Manager staging), fingerprint verification,
  audit-log row, rollback path.
- **`migration_incident.md`** — 6 symptom classes, per-migration
  recovery for M-001..M-009, lock-timeout handling, long-backfill
  batching, data-safety validation pre-resume (schema match +
  CS-3 invariant + clinical-acceptance green), unrecoverable
  escalation to PITR restore.
- **`provider_outage.md`** — Datalab vs Anthropic outage
  detection, fallback decision tree, flip `DIS_OCR_PROVIDER=claude`
  procedure, cost awareness (3-5x fallback cost), comms template
  to reception, resumption procedure (batch-retry failed
  extractions via `dis_requeue_failed.js`), CS-1+CS-3 invariants
  verified before all-clear, schema-drift distinct class.
- **`dr_and_backup.md`** — backup inventory with frequency +
  retention per asset. RTO/RPO POC 4h/24h, Prod 1h/5min via PITR.
  Full and logical restore paths per environment. CS-2 raw
  response safeguards (column never updated, weekly export to
  object storage with 7-year Object Lock compliance mode on
  prod). Quarterly drill with 7 pass-criteria checks.
- **`stuck_jobs.md`** — 6 scenario classes with sample fixture
  UUIDs. Stuck-in-ocr diagnosis + fix. Queue backlog causes table.
  **Duplicate promotion = SEV1** (CS-11 violation). Nurse reports
  wrong confidence — where-the-bug-likely-is matrix. Stuck in
  pending_review is a process issue, never auto-aged-out per CS
  rules. Cost spike diagnosis.

### 10_handoff (4 files) — this document joins them

- **`SESSION_HANDOVER_2026-04-20.md`** (previous session
  end-of-build handover).
- **`ORIENTATION_REVIEW_2026-04-20.md`** (my first orientation
  attempt — partially superseded by this file).
- **`document_ocr_flow.md`** (comprehensive OCR flow + Chandra
  comparison + §13 session-2 findings I wrote).
- **`Prompt_2.md`** (user's resume prompt, untracked).

### 11_session_transcripts (1 file)

- **`README.md`** — JSONL format, Windows/macOS paths, what is
  archived, privacy note, retention indefinite. Does NOT contain
  the JSONL itself at the documented path — the actual 4.5MB
  file is noted as archived at
  `11_session_transcripts/2026-04-20_dis-build-session.jsonl` but
  I have not read or confirmed it (user said "skip for now"; I
  honoured that).

---

## §2. The code — what exists in `dis/`, all read in full

**Ports (10 files including `.gitkeep`, DIS-003):** `ocr.ts`,
`structuring.ts`, `storage.ts`, `database.ts`, `queue.ts`,
`secrets.ts`, `file-router.ts`, `preprocessor.ts`, `index.ts`
(barrel with explicit re-exports, no `export *`). Every port uses
`readonly` on public fields. `rawResponse: unknown` at both
OcrPort and StructuringPort boundaries — the core never
introspects.

**Core (5 TS + 9 fakes + index = 14 files + `.gitkeep`, DIS-020..024):**

- `state-machine.ts` — pure, 10 `State` literals, 11 `Event`
  kinds (discriminated on `kind`). `InvalidStateTransitionError`
  with `readonly from`, `readonly event`, code
  `'INVALID_STATE_TRANSITION'`. `transition(state, event)` is a
  `switch` over `event.kind` with `assertNever(event)` default.
- `orchestrator.ts` — `IngestionOrchestrator` class DI over 8
  ports. `OrchestratorError` base, `VersionConflictError`
  (`code='VERSION_CONFLICT'`, carries `extractionId`,
  `currentVersion`, `currentStatus`), `ExtractionNotFoundError`
  (`code='EXTRACTION_NOT_FOUND'`). Methods: `ingest` (idempotency
  lookup then storage put then DB insert, version=1),
  `process` (runs pipeline via `advance()` raw UPDATEs — does
  NOT route through `transition()` on the happy path, **this is
  a known CS-1 gap** flagged by DIS-021 handoff D-1),
  `approve`/`reject` (go through `transitionWithLock()` which
  DOES call `transition(row.status, { kind: 'approved' | 'rejected', ... })`).
  **Imports `type ExtractionState` from `./state-machine.js`,
  but state-machine exports the type as `State`, not
  `ExtractionState`.** **Calls `transition()` with
  `{ kind: 'approved' }` / `{ kind: 'rejected' }`, but
  state-machine's `Event` union has `'nurse_approve'` /
  `'nurse_reject'`.** This is the DIS-020/021 coordination scar.
- `confidence-policy.ts` — pure `evaluatePolicy`. CS-7
  short-circuit on `!enabled` returns
  `{ auto_approved: false, rule_results, policy_version }`.
  Missing field confidence treated as 0. Empty rules while
  enabled → auto_approved false (fail-closed).
- `promotion.ts` — pure `buildPromotionPlan`.
  `applyDischargeSummaryLatestOnly` collapses labs by
  `testNameNormalized` keeping latest `testDate` (string
  compare) for `document_type === 'discharge_summary'`. CS-11
  dedup via `ExistingRowHints.labKeys` / `vaxKeys` as
  `ReadonlySet<string>`. Skipped rows carry reason codes
  `'discharge_summary_superseded'` or `'duplicate_pkid_match'`.
- `audit-log.ts` — `AuditLogger` class. Exposes only
  `write(event)` and `writeMany(events)`. No `update` or
  `delete` method at the type level. `AuditLogImmutableError`
  with `code='AUDIT_LOG_IMMUTABLE'` and `attemptedOperation`
  discriminator (`'update'|'delete'`). Insert SQL is the
  parameterised form matching `data_model.md` schema. Wraps in
  `db.transaction()`.

**Core fakes in `__fakes__/`:** FakeDatabase (pattern-dispatched
in-memory table over INSERT/SELECT/UPDATE for `extractions`),
FakeStorage (Map), FakeQueue (array), FakeSecrets
(Record lookup), FakeFileRouter (fixed decision), FakePreprocessor
(passthrough with drop counts 0), FakeOcr (scripted result or
Error), FakeStructuring (scripted result or Error), index
re-exports all eight.

**Adapters (6 TS + 3 local fakes):**

- `ocr/datalab-chandra.ts` — `DatalabChandraAdapter implements
OcrPort`. POST multipart form to
  `https://www.datalab.to/api/v1/convert` with `X-Api-Key` from
  `SecretsPort.get('DATALAB_API_KEY')`. Sends `mode=accurate`,
  each output format as a separate `form.append('output_format', …)`
  call (**bug vs docs which say comma-separated**), `langs`
  field (**bug — field does not exist in live API**). Polls
  `request_check_url` with backoff 1s/2s/4s/8s cap 10s, total
  cap 120s (**too tight for accurate mode on multi-page
  discharge summaries**). On HTTP non-2xx → `OcrProviderError`
  (generic, does NOT distinguish 429 → RateLimitedError).
  Preserves `rawResponse` byte-identically (CS-2).
  `OcrProviderTimeoutError` on total-wait exceeded. Block-type
  coercion tolerant (unknown → `'text'`).
- `structuring/claude-haiku.ts` — `ClaudeHaikuAdapter implements
StructuringPort`. Reads `prompts/structuring.md` + its YAML
  frontmatter version + `schemas/clinical-extraction.v1.json` at
  construction. Anthropic client injected via
  `AnthropicClientFactory(apiKey): AnthropicLike`. Hand-rolled
  required-keys check (not Ajv — flagged as DIS-051-followup).
  Retries once with stricter cue on first validation failure;
  second failure throws `StructuringSchemaInvalidError` with
  `attempts`, `lastRaw`. Cost accounting at placeholder Haiku
  prices (83 / 416 µINR per token). Stamps `promptVersion`.
- `storage/supabase-storage.ts` — implements all 5 `StoragePort`
  methods against Supabase Storage REST (no
  `@supabase/supabase-js`). `ObjectNotFoundError` on 404,
  `StorageProviderError` on other non-OK. URL-encodes segments
  while preserving slashes. Reads SUPABASE_URL +
  SUPABASE_SERVICE_ROLE_KEY from SecretsPort.
- `storage/__fakes__/supabase-storage.ts` — FakeSecrets helper
  - `createFetchMock` builder that records calls and returns
    scripted responses keyed by `${method} ${url}`.
- `database/supabase-postgres.ts` — implements `DatabasePort`
  over a `postgres` client abstracted as `SqlClient` structural
  type. Driver loader pattern (`setPostgresDriverLoader`) so
  `postgres` is not imported at module load — unit tests stay
  hermetic. `query` delegates to driver's `unsafe(sql, params)`
  (parameterised, not string-interp). `queryOne` + first-or-null.
  `transaction` uses driver's `begin` with nested adapter.
  `setSessionVars` emits `SET LOCAL <key> = $1` parameterised.
  Key name validated `/^[a-z_][a-z0-9_.]*$/i`. Typed errors
  `DatabaseError` (base, `code: string`) + `DatabaseConnectionError`
  (wraps `ECONNREFUSED/ECONNRESET/ETIMEDOUT/ENOTFOUND/EAI_AGAIN/CONNECTION_*`).
- `database/__fakes__/supabase-postgres.ts` —
  `FakeSupabasePostgresAdapter` records every call. Transaction
  emits BEGIN/COMMIT or BEGIN/ROLLBACK pseudo-calls.
- `structuring/__fakes__/claude-haiku.ts` — `scriptedAnthropicFactory`
  returns a factory that plays responses in order and records
  keys + params.
- `file-router/default.ts` — `DefaultFileRouter implements
FileRouterPort`. Lower-cased extension decides.
  `nativeTextMinCharsPerPage` default 100 overridable via
  constructor. `pdfTextExtractor` DI seam; default lazy-imports
  `pdfjs-dist`. Unsupported → `{kind:'unsupported', reason:'disallowed_extension'}`.
- `preprocessor/default.ts` — **stub only**. 50-page cap,
  passthrough. `PreprocessorPageCapError` with
  `code='PREPROCESSOR_PAGE_CAP_EXCEEDED'`. Real pipeline
  (sharp-based) deferred to DIS-058b.

**HTTP (4 + `.gitkeep`, DIS-004):**

- `server.ts` — `createServer()` returns fresh Hono with
  typed `AppVariables.correlationId`. `start(port)` binds to
  127.0.0.1 via `@hono/node-server`, returns `{port, close}`.
  **Imports `./middleware/correlation-id.ts` and
  `./routes/health.ts` with `.ts` extensions** — breaks
  `tsc --noEmit` under `module: NodeNext`.
- `index.ts` — barrel re-exports. Same `.ts`-extension bug.
- `middleware/correlation-id.ts` — reads `x-correlation-id`,
  validates UUIDv4 regex, mints via `node:crypto.randomUUID()`
  when absent or malformed, sets on `c.set('correlationId', id)`
  and `c.header(...)`.
- `routes/health.ts` — `registerHealthRoute(app)` exposes
  `GET /health → {status:'ok', version}` where version =
  `process.env.DIS_VERSION ?? '0.0.1'`.

**Prompts + schemas (2 files):**

- `prompts/structuring.md` — YAML frontmatter `version: 1`,
  rules 1-6 (single JSON object, no invented data, verbatim
  numerics, confidence [0,1], dates YYYY-MM-DD, flag
  `unknown` when no reference range), 3 few-shot examples.
- `schemas/clinical-extraction.v1.json` — JSON Schema draft-07,
  required `['document_type','summary','labs','medications',
'diagnoses','vaccinations']`, `additionalProperties: true`,
  all array items typed as `object` (shape validation deferred
  to Ajv in DIS-051-followup).

**Types (1 file):** `assert-never.ts` — throws `Unexpected value:
${JSON.stringify(x)}`.

**Tests (11 files):** 10 unit + 1 integration. Counts confirmed
by reading every file:

- `state-machine.test.ts` — **18** test cases covering native
  path, ocr-scan path, fail transitions, invalid transitions
  (including the CS-1 guard `ready_for_review → promoted`
  throws), error payload shape, purity.
- `orchestrator.test.ts` — **12** tests: ingest creates uploaded
  - version=1, idempotency replay, storage put, native-text
    transition chain, ocr-scan chain (preprocessor + ocr calls),
    approve correct/wrong version (+ VersionConflictError shape),
    reject correct/wrong, retry creates new + parent FK + preserves
    failed parent.
- `confidence-policy.test.ts` — **~18 assertions / 11+ it() blocks**
  including the CS-7 loop 0.0..1.0 step 0.1 always false when
  disabled, enabled+pass, one-fail-all, missing field → 0,
  block_type=table requirement, version stamping (1/7/42).
- `promotion.test.ts` — **8** tests across 5 describe blocks:
  CS-10 7-TSB collapse, per-test-name discharge dedup, partial
  dedup, non-discharge preserves all, CS-11 full dedup on
  replay, skipped-row payload, vax dedup, documentPatch
  passthrough.
- `audit-log.test.ts` — **7** tests: insert happens, all required
  fields present, runs inside transaction, writeMany preserves
  order, no update/delete method exists, Error shape for
  update and delete attempts.
- `adapters/datalab-chandra.test.ts` — **7** tests: synchronous
  complete, submit→poll→complete with observed backoff
  schedule, 500 → OcrProviderError, 120s budget exceeded →
  OcrProviderTimeoutError, status=failed → OcrProviderError,
  X-Api-Key header, rawResponse byte-identical.
- `adapters/claude-haiku.test.ts` — **6** tests: valid first
  response, retry on invalid (verifies stricter cue in
  second message), hard-fail after second invalid, secrets
  lookup + factory keyed right, rawResponse preserved,
  promptVersion stamped.
- `adapters/supabase-storage.test.ts` — **9** tests: each of 5
  methods happy path, 404, 5xx, URL-encoding, credentials from
  SecretsPort.
- `adapters/supabase-postgres.test.ts` — **7** tests: parameterised
  query + frozen rows, queryOne first/null, transaction commit,
  rollback on throw + rethrow, setSessionVars parameterised
  per-key, pool reuse across calls, connection-error wrapping.
- `adapters/file-router.test.ts` — **11** tests: each ext
  branch + threshold override + unsupported case.
- `adapters/preprocessor.test.ts` — **6** tests: single JPEG
  passthrough, PDF passthrough, empty, cap override, default-50
  boundary, buffer identity preserved.
- `integration/health.test.ts` — **3** tests: status+ok+version,
  x-correlation-id response header, inbound echo.

**Fixtures:** `datalab/convert-response.json` (status complete,
markdown + json.blocks + page_count:2 + version chandra-2026-03),
`haiku/sample-markdown.md` (CBC with Hb 10.2 LOW + WBC 8.4
NORMAL), `haiku/expected-extraction.json` (lab_report with
Hemoglobin 10.2 low hematology).

**Scripts (5 .mjs + fitness-rules.json + self-test fixtures +
README):**

- `fitness.mjs` — reads `fitness-rules.json`, walks `dis/src`,
  applies each rule's glob+forbidden_pattern+flags, supports
  `--root` + `--rules` + `--only`, prints
  `<file>:<line>: [<rule>] <msg> — <snippet>`.
- `fitness-rules.json` — 7 rules:
  (1) core_no_adapter_imports,
  (2) ports_no_adapter_imports,
  (3) core_no_fetch,
  (4) core_no_xhr,
  (5) core_no_sql_literals (the one that catches the 5
  orchestrator+fake-db violations),
  (6) supabase_sdk_only_in_supabase_adapters,
  (7) aws_sdk_only_in_aws_adapters. Each with glob_exclude
  allow-lists for Supabase/AWS adapter paths.
- `check-pr-citations.mjs` — parses TDD §N[.M], CS-##,
  DIS-US-###, coding_standards §N citations from PR body,
  resolves each against the corresponding source file by regex
  on the section anchor. Zero citations → exit 0 advisory
  (Gate 5 still rejects uncited PRs).
- `check-files-touched.mjs` — extracts ticket id from branch
  name `feat/dis-(\d+)`, finds `### DIS-<id>` block in backlog /
  integration_hold / in_progress / done, parses `files_allowed:`
  YAML list from fenced `yaml` block, diffs PR against
  `merge-base HEAD origin/feat/dis-plan`, fails on any out-of-list
  file. Supports simple `*` globs.
- `check-forbidden-tokens.mjs` — scans `dis/src/**/*.ts`
  excluding `__fakes__`, `tests`, `__tests__`, `*.test.ts`.
  Tokens: TODO, FIXME, XXX, HACK, console.log, debugger, .only,
  .skip. Inline escape `// lint-allow: <TOKEN> — DIS-###`
  honored on same line or line immediately above.
- `port-validator.mjs` — 3-line wrapper spawning `fitness.mjs`
  with `--only core_no_adapter_imports,ports_no_adapter_imports`.
- `__tests__/drift-controls.test.mjs` — 5 smoke cases. Currently
  passes 5/5 (I verified).

**Root files:** `package.json` (runtime deps empty,
devDependencies has typescript / vitest / @types/node / eslint /
prettier), `tsconfig.json` (strict, target ES2022, module
NodeNext, `noUncheckedIndexedAccess`, `noImplicitOverride`,
`rootDir: src`, `include: src/**/*.ts + tests/**/*.ts`),
`eslint.config.mjs` (tseslint recommendedTypeChecked +
consistent-type-imports error + no-explicit-any warn),
`Dockerfile` (multi-stage stub with TODO markers for DIS-003/004
— these TODOs are in `.dockerfile` not `.ts` so not scanned by
forbidden-tokens), `README.md`, `CHANGELOG.md` (Keep-a-Changelog
with single `Unreleased / Added / - DIS-001 project scaffolding`
line), `DEPS_REQUIRED.md` (lists hono / @hono/node-server / pino
/ postgres / pdfjs-dist / sharp as runtime deps + vitest /
@types/node as dev). `migrations/` directory exists but is empty.

**CI workflow `.github/workflows/dis-ci.yml`** has 10 jobs:
lint-typecheck-test, port-validator, citations, files-touched
(PR-only), fitness, forbidden-tokens, drift-controls-selftest,
secret-scan (gitleaks, conditional on GITLEAKS_LICENSE),
openapi-lint (conditional on dis/openapi.yaml existing),
migration-roundtrip placeholder (disabled `if: false`).

---

## §3. Handoffs — all 13 read in full

Files in `dis/handoffs/`:

| File                    | Purpose                             | My status |
| ----------------------- | ----------------------------------- | --------- |
| DIS-002.md              | CI workflow + port-validator        | Read full |
| DIS-004.md              | Health endpoint + correlation-id MW | Read full |
| DIS-020.md              | State machine                       | Read full |
| DIS-021.md              | IngestionOrchestrator               | Read full |
| DIS-022.md              | Confidence policy                   | Read full |
| DIS-023.md              | Promotion service                   | Read full |
| DIS-024.md              | Audit log writer                    | Read full |
| DIS-050.md              | DatalabChandraAdapter               | Read full |
| DIS-051.md              | ClaudeHaikuAdapter                  | Read full |
| DIS-053.md              | SupabaseStorageAdapter              | Read full |
| DIS-054.md              | SupabasePostgresAdapter             | Read full |
| DIS-057.md              | DefaultFileRouter                   | Read full |
| DIS-058.md              | DefaultPreprocessor stub            | Read full |
| DOC-AGENTIC-PROTOCOL.md | Authoring of agentic_dev_protocol   | Read full |
| DOC-VERIFY-BACKLOG-A.md | Epic A+B rewrite to Verify format   | Read full |
| DOC-VERIFY-BACKLOG-B.md | Epic C-H rewrite + integration_hold | Read full |
| DOC-VERIFY-TEMPLATE.md  | \_ticket_template + README Verify § | Read full |
| DRIFT-DOC-WRITER.md     | Authoring of drift_prevention.md    | Read full |
| DRIFT-PHASE-1.md        | Phase-1 CI scripts + Gate-5 update  | Read full |

DIS-001 handoff is **absent** — scaffold was done by subagent,
handover §10 teammate log marks it merged without a retrofit.

---

## §4. Known open issues, verified live

These are the blockers a future session must resolve before any
new wave can ship cleanly.

1. **DIS-020/021 state-machine reconciliation** — COORDINATION_REQUIRED
   flagged in DIS-021 handoff §3 D-1 + §5. Orchestrator imports
   `type ExtractionState` but state-machine exports `State`; calls
   `transition()` with `{kind:'approved'}` / `{kind:'rejected'}`
   but state-machine's `Event` union has `'nurse_approve'` /
   `'nurse_reject'`. Blocks `tsc --noEmit`. Pipeline happy-path
   transitions don't route through `transition()` — CS-1 guards
   only fire on approve/reject path, not on the preprocessing →
   ocr → structuring → ready_for_review chain.

2. **5 existing fitness violations** (DRIFT-PHASE-1 handoff §5
   DIS-FOLLOWUP-A). **I just verified these are still present by
   running `node dis/scripts/fitness.mjs`:**
   - `dis/src/core/orchestrator.ts:128` — `'SELECT * FROM extractions WHERE idempotency_key = $1'`
   - `dis/src/core/orchestrator.ts:255` — `'SELECT * FROM extractions WHERE id = $1'`
   - `dis/src/core/orchestrator.ts:284` — `'SELECT * FROM extractions WHERE id = $1'`
   - `dis/src/core/orchestrator.ts:295` — `'SELECT * FROM extractions WHERE id = $1'`
   - `dis/src/core/__fakes__/database.ts:53` — pattern-dispatch
     string
     `fitness.mjs` exits 1. Any new PR that triggers CI will fail.
     DRIFT-PHASE-1 §5 proposes three resolution options:
     (a) refactor orchestrator.ts to use named DatabasePort methods
     (`db.findById`, `db.findByIdempotencyKey`, …),
     (b) ADR-gated `// reason:` exemption on the 4 lines +
     scope-exclude **fakes**,
     (c) split the rule into `core_no_ddl` (block CREATE/DROP/ALTER
     only) and a stricter Wave-3 rule. **Medium urgency** — must be
     resolved before fitness becomes a real merge gate.

3. **DatalabChandraAdapter 5 wire-contract bugs** documented in
   `document_ocr_flow.md §13` after the live-docs re-verification:
   - `output_format` appended multiple times instead of
     comma-separated string (today accidentally works because only
     `['markdown']` is requested — breaks the moment we add `json`).
   - `langs` form field sent though the live API has no such
     field (silently dropped today, may be rejected later).
   - No `skip_cache` awareness for CS-2 fresh-response audit on
     retry.
   - `DEFAULT_MAX_TOTAL_WAIT_MS = 120_000` too tight for
     accurate-mode Chandra on multi-page discharge summaries;
     should be 300s and env-configurable `DIS_OCR_MAX_WAIT_MS`.
   - Generic non-2xx → `OcrProviderError`; must distinguish 429
     → retryable per `error_model.md` §Retry policy.
   - Plus ADR-004 direction (user-selected): replace polling with
     `webhook_url` push-based completion.

4. **`dis/package.json` runtime deps empty.** Every new runtime
   dep sits in `DEPS_REQUIRED.md` waiting for architect-owned
   merge: hono, @hono/node-server, pino, postgres, pdfjs-dist,
   sharp (for DIS-058b), plus `@anthropic-ai/sdk` which is
   **not yet in DEPS_REQUIRED.md** — Haiku adapter works in
   tests via injected factory but cannot run live without the
   SDK.

5. **`src/http/server.ts` + `src/http/index.ts` use `.ts`
   extensions in imports.** Every other file uses `.js`.
   `module: NodeNext` requires `.js`. Breaks `tsc` build.

6. **ADR folder `02_architecture/adrs/` does not exist.**
   Referenced by coding_standards §15, adapters.md Change-control,
   drift_prevention Control 9 (Phase-2), review_gates Gate 6d. No
   ADRs exist yet.

7. **`07_tickets/clarifications/` folder does not exist.**
   Referenced by README.md lifecycle and RACI escalation.

8. **`07_tickets/done.md` not backfilled** with the 15 merged
   tickets despite `session_handoff.md §8` instructing the
   Architect to do so at merge time. In-progress.md equally
   stale.

9. **DIS-051 uses hand-rolled required-keys check, not Ajv.**
   Flagged by DIS-051 handoff §4 as DIS-051-followup; full
   JSON-schema coverage (type narrowing, enum checks, array item
   shapes) awaits Ajv introduction.

10. **Two local-only commits on `feat/dis-plan`** that bypassed
    the Verify-Driven protocol (authored by me in this session
    before the user corrected me): `7049840` (move
    document_ocr_flow + §13) and `96e7006` (ADR folder scaffold).
    Not pushed. Need rewinding so the work is redone through
    proper tickets with VERIFY reports and handoffs.

---

## §5. Cross-document discrepancies

- **Kill-switch mechanism disagreement.** `rollout_plan.md` +
  `feature_flags.md` + DIS-100 backlog ticket all describe 503
  UNAVAILABLE on writes when enabled; `kill_switch.md` describes
  a 307-proxy to the legacy `process-document` handler. Only one
  can be true. `error_model.md` lists UNAVAILABLE (503) as a
  first-class code. Needs an ADR (I will call it ADR-003) to pick
  one and reconcile.
- **`ai_extracted` in `verification_status`.** `data_model.md`
  allows `verified | ai_extracted | auto_approved | manual` on
  the column. `clinical_safety.md` CS-1 says only `verified` or
  `auto_approved` flow into clinical tables. Resolution:
  `ai_extracted` is the legacy-backfill value assigned to
  pre-DIS rows by M-006; DIS-204/205 filter it out of
  doctor-visible reads per CS-12. This is internally consistent
  but the docs could state the split more explicitly.
- **`data_model.md` has `version INT NOT NULL DEFAULT 1`** but
  `orchestrator.ts` `ingest()` and `retry()` INSERTs don't set
  version. Today relies on a column default that only exists
  once migration M-001 runs. Today fakes default to 0 which
  tests accept.
- **`document_ocr_flow.md §12.8.1`** hardcodes
  `/convert-result-check` as the poll pattern. Live Datalab API
  returns the poll URL in `request_check_url` on the initial
  response. Adapter does the right thing (reads
  `initial.request_check_url`); only the doc prose is stale.
  Captured in §13 of the same file.

---

## §6. Working-state snapshot (git, CI, process)

- **Branch**: `feat/dis-plan`
- **Local HEAD**: `96e7006` (2 commits ahead of `origin/feat/dis-plan`
  at `602c634`)
- **Untracked files**: `Prompt_2.md`,
  `ORIENTATION_REVIEW_2026-04-20.md`,
  `clarifications/README.md`
- **Open PRs**: PR #1 (feat/dis-plan → main, awaiting review)
- **Active teammates**: 0
- **Worktrees**: main only
- **Cron jobs**: 0 (15-min teammate health-check not re-created)
- **`fitness.mjs`**: EXIT=1 with 5 violations (§4 item 2)
- **`check-forbidden-tokens.mjs`**: EXIT=0 (25 files scanned
  clean)
- **`drift-controls.test.mjs`**: 5/5 pass
- **Task list**: cleared per user's latest protocol direction

---

## §7. What this document does NOT claim

- I have NOT read the 4.5MB session transcript JSONL (user
  explicitly permitted skipping it). If any decision ever needs
  to cross-reference a mid-build teammate exchange, that
  transcript is authoritative.
- I have NOT executed `npm install` or `npm test` (deferred per
  DIS-001 integration-time policy; this is planned work for a
  future ticket).
- I have NOT touched live Supabase, `web/`, or
  `supabase/functions/` — the integration hold is absolute.
- I have NOT dispatched any teammate.
- I have NOT merged PR #1.

---

## §8. Sign-off

- **Orchestrator**: Claude Opus 4.7 (1M context)
- **Date**: 2026-04-20
- **Mode**: deep read of every plan document + every source/test
  /CI file in `dis/`. Live verification of `fitness.mjs`,
  `check-forbidden-tokens.mjs`, and the drift-controls self-test.
  Zero code changes made during orientation. Zero teammates
  dispatched.
- **Next action**: awaits user direction. Proposed direction
  (from prior chat): three new Verify-Driven tickets — DIS-001b
  (package.json deps merge + .ts→.js fix), DIS-002c (scaffold
  hygiene: done.md backfill + adrs/ + clarifications/ folder
  creation + stale-ref fixup), DIS-002d (ADR-001..007 pack
  including ADR-003 kill-switch 503 and ADR-004 Datalab
  webhooks). Then DIS-021b reconciliation + DIS-050a adapter
  hotfix via the dis-squad team under v3 worktree protocol.
