---
report: 05-tickets-handoffs
last_refreshed: 2026-04-22
source_commit: 69ce4bc
source_paths:
  - dis/document_ingestion_service/07_tickets/
  - dis/handoffs/
covered_files:
  - dis/document_ingestion_service/07_tickets/README.md
  - dis/document_ingestion_service/07_tickets/epics.md
  - dis/document_ingestion_service/07_tickets/backlog.md
  - dis/document_ingestion_service/07_tickets/done.md
  - dis/document_ingestion_service/07_tickets/in_progress.md
  - dis/document_ingestion_service/07_tickets/integration_hold.md
  - dis/document_ingestion_service/07_tickets/blocked.md
  - dis/document_ingestion_service/07_tickets/_ticket_template.md
  - dis/document_ingestion_service/07_tickets/clarifications/README.md
  - dis/handoffs/DIS-001b.md
  - dis/handoffs/DIS-002.md
  - dis/handoffs/DIS-002c.md
  - dis/handoffs/DIS-002d.md
  - dis/handoffs/DIS-002e.md
  - dis/handoffs/DIS-002f.md
  - dis/handoffs/DIS-002g.md
  - dis/handoffs/DIS-002h.md
  - dis/handoffs/DIS-002i.md
  - dis/handoffs/DIS-002j.md
  - dis/handoffs/DIS-004.md
  - dis/handoffs/DIS-020.md
  - dis/handoffs/DIS-021.md
  - dis/handoffs/DIS-021b.md
  - dis/handoffs/DIS-021c.md
  - dis/handoffs/DIS-021d.md
  - dis/handoffs/DIS-022.md
  - dis/handoffs/DIS-023.md
  - dis/handoffs/DIS-024.md
  - dis/handoffs/DIS-050.md
  - dis/handoffs/DIS-050a.md
  - dis/handoffs/DIS-051.md
  - dis/handoffs/DIS-053.md
  - dis/handoffs/DIS-054.md
  - dis/handoffs/DIS-057.md
  - dis/handoffs/DIS-058.md
  - dis/handoffs/DOC-AGENTIC-PROTOCOL.md
  - dis/handoffs/DOC-VERIFY-BACKLOG-A.md
  - dis/handoffs/DOC-VERIFY-BACKLOG-B.md
  - dis/handoffs/DOC-VERIFY-TEMPLATE.md
  - dis/handoffs/DRIFT-DOC-WRITER.md
  - dis/handoffs/DRIFT-PHASE-1.md
  - dis/handoffs/sessions/document_ocr_flow.md
  - dis/handoffs/sessions/ORCHESTRATOR_ORIENTATION_2026-04-20.md
  - dis/handoffs/sessions/ORIENTATION_REVIEW_2026-04-20.md
  - dis/handoffs/sessions/Prompt_2.md
  - dis/handoffs/sessions/SESSION_HANDOVER_2026-04-20.md
  - dis/handoffs/sessions/SESSION_HANDOVER_2026-04-21.md
  - dis/handoffs/sessions/SESSION_HANDOVER_2026-04-21_WaveB.md
  - dis/handoffs/sessions/SESSION_PLAN_2026-04-21.md
report_owner: tickets-handoffs-reviewer
confidence:
  epics: high
  backlog: high
  done: high
  in_progress: high
  per_task_handoffs: high
  session_handoffs: high
  workstream_docs: medium
---

## What changed since last refresh

(Empty on first write.)

## Executive summary

Through 2026-04-21 end-of-Wave-B the DIS squad has shipped **25 tickets** (15 Wave-1..3 on 2026-04-20 + 10 Wave-A/B on 2026-04-21) all merged into `feat/dis-plan`. PR #1 against `main` remains open. **Zero tickets in progress** at the snapshot cut (`dis/document_ingestion_service/07_tickets/in_progress.md:8`); **Wave C is explicitly HELD** on direct user instruction ("Hold off before wave C", cited in `dis/handoffs/DIS-002j.md:65` and `in_progress.md:11`). **Zero blocked tickets** (`blocked.md:15`). **Zero open clarifications** (`clarifications/README.md:63`).

The held-behind-the-user-gate epic G (integration) contains 10 tickets DIS-200..DIS-209 — all `[HELD]` pending `INTEGRATION APPROVED` from Dr. Lokender Goyal per `integration_hold.md`.

Top 5 most recent handoffs:
1. **DIS-002j** (2026-04-21, merge `11e9c1a`) — Wave-B closeout; done.md + session-handover backfill; Wave C held.
2. **DIS-021d** (2026-04-21, merge `f8cbc34`) — CS-1 indirect; restored full typecheck surface; DatabasePort contract landed on adapters.
3. **DIS-021c** (2026-04-21, merge `aef10b7`) — Vitest discovery lock + cwd-independent DOCS; STOP-and-report split produced DIS-021d.
4. **DIS-021b** (2026-04-21, merge `4e23cb2`) — CS-1 state-machine ↔ orchestrator reconciliation; CLINICAL APPROVED.
5. **DIS-050a** (2026-04-21, merge `ba5f944`) — Datalab wire-contract hotfix; ADR-004 `webhook_url` wiring.

## Epics

Source: `dis/document_ingestion_service/07_tickets/epics.md`.

| Epic | Name | Scope | Status | Tickets |
|------|------|-------|--------|---------|
| A | Foundations | scaffold + CI + ports + health endpoint (`epics.md:31-46`) | 4/15 done (DIS-001..004) | DIS-001..015 |
| B | Core business logic | state machine, orchestrator, confidence, promotion, audit (`epics.md:50-64`) | 5/25+ done (DIS-020..024 + reconciliations 021b/c/d) | DIS-020..045 |
| C | Adapters (POC stack) | Datalab, Haiku, Supabase storage/postgres/secrets, FileRouter, Preprocessor (`epics.md:68-84`) | 6 done + DIS-050a hotfix (DIS-050/051/053/054/057/058) | DIS-050..085 |
| D | Orchestration layer | HTTP endpoints, queue worker, realtime push, metrics (`epics.md:88-100`) | not started | DIS-090..110 |
| E | Verification UI | `dis/ui/` standalone SPA (`epics.md:106-118`) | not started | DIS-115..140 |
| F | Observability + safety audits + staging migrations | logs/metrics/traces, M-001..M-008 staging apply, clinician audit dry-run (`epics.md:124-138`) | not started | DIS-145..175 |
| G | Integration [HELD] | replaces legacy `process-document`; touches live Supabase + `web/` (`epics.md:144-168`) | all 10 HELD awaiting Integration Gatekeeper | DIS-200..209 |
| H | AWS port dry-run | Terraform + AWS adapters + clinical fixtures on AWS sandbox (`epics.md:172-186`) | not started | DIS-220..235 |

Dependency chain `A → B → C → D → E → F → G / H` is documented at `epics.md:7-23`.

## Tickets — DONE (from done.md)

Source: `dis/document_ingestion_service/07_tickets/done.md` (487 lines).

### Wave 1 — Epic A foundations (2026-04-20)

| ID | Title | Handoff | Merge SHA(s) | Notable artifacts |
|----|-------|---------|--------------|-------------------|
| DIS-001 | Initialize `dis/` subproject | absent (retrofit) | scaffold + Dockerfile stub | tsconfig, package.json, folder layout per `adapters.md` |
| DIS-002 | CI workflow + port-validator + PR template + secret scan | `dis/handoffs/DIS-002.md` | `b29b4e8` + `21b20a2` | `.github/workflows/dis-ci.yml`, `dis/scripts/port-validator.mjs` |
| DIS-003 | Port interface stubs (8 ports + index barrel) | absent | `7823597` | 8 port interfaces per TDD §9.1/§10.1 |
| DIS-004 | Health endpoint + Hono server + correlation-id middleware | `dis/handoffs/DIS-004.md` | `e525140` + `837f115` + `fcca601` | Hono app factory, `/health`, corr-id middleware |

### Wave 2 — Epic B core (2026-04-20)

| ID | Title | Handoff | Merge SHA(s) | CS | Notable |
|----|-------|---------|--------------|----|---------|
| DIS-020 | Pure state machine | `DIS-020.md` | `a6df0ef` (+ test-first) | CS-1, CS-5 | 10 States, 11 Event kinds, 18 tests, `assertNever` |
| DIS-021 | IngestionOrchestrator (DI ports) | `DIS-021.md` | `a6df0ef` + `d49dd57` + `abebc65` | CS-1 indirect | Left **COORDINATION_REQUIRED** scar → DIS-021b |
| DIS-022 | Confidence policy evaluator | `DIS-022.md` | `a322cd8` + `6b2a233` | CS-7 | Fail-closed default; one-fail-all rule |
| DIS-023 | Promotion service (intent plan) | `DIS-023.md` | `22a2de2` + `8bebe5a` + `a70af19` | CS-10, CS-11 | Discharge latest-only + duplicate guard; 8/8 tests |
| DIS-024 | Audit log writer (append-only) | `DIS-024.md` | `646fd0c` + `4dbca6d` | CS-3 | No `update`/`delete` methods at type level |

### Wave-2 meta (2026-04-20)

| ID | Title | Handoff | Verdict |
|----|-------|---------|---------|
| DRIFT-PHASE-1 | Phase 1 drift controls (Controls 1/2/3/7/10) | `DRIFT-PHASE-1.md` | 10/11 VERIFY pass; 5 true-positive `core_no_sql_literals` findings passed to DIS-021b |

### Wave 3 — Epic C POC adapters (2026-04-20)

| ID | Title | Handoff | Merge SHA(s) | CS | Notable |
|----|-------|---------|--------------|----|---------|
| DIS-050 | DatalabChandraAdapter | `DIS-050.md` | merge `e035d74` | CS-2 | 7 unit tests; 1→10s backoff, 120s cap |
| DIS-051 | ClaudeHaikuAdapter | `DIS-051.md` | `a17d0f8` + `a18d731` + `9a962ab` | CS-9, CS-10 | Prompt v1 + JSON schema; retry-on-invalid |
| DIS-053 | SupabaseStorageAdapter | `DIS-053.md` | merge `088db29`; impl `52e3d67` | — | 5 methods via REST, no SDK |
| DIS-054 | SupabasePostgresAdapter | `DIS-054.md` | merge `a41cc65`; impl `e38e35a` | — | Driver-loader pattern, `SET LOCAL` validated |
| DIS-057 | DefaultFileRouter | `DIS-057.md` | merge `d8792d0`; impl `5c0ac0c` | — | TDD §7 tree; 11 tests |
| DIS-058 | DefaultPreprocessor (stub) | `DIS-058.md` | merge `a24e399`; impl `aa8abf6`; handoff `e70fe56` | — | Stub passthrough; real pipeline deferred to DIS-058a..g |

### Wave-meta docs (2026-04-20)

| ID | Title | Handoff |
|----|-------|---------|
| DOC-AGENTIC-PROTOCOL | Authoring `08_team/agentic_dev_protocol.md` (493 lines, Phases 0–9) | `DOC-AGENTIC-PROTOCOL.md` |
| DOC-VERIFY-TEMPLATE | Verify-Driven ticket template + README | `DOC-VERIFY-TEMPLATE.md` |
| DOC-VERIFY-BACKLOG-A | Epic A+B rewrite in Verify-Driven (41 tickets, 188 VERIFY lines) | `DOC-VERIFY-BACKLOG-A.md` |
| DOC-VERIFY-BACKLOG-B | Epic C..H rewrite + integration_hold sync (137 tickets, 10 HELD) | `DOC-VERIFY-BACKLOG-B.md` |
| DRIFT-DOC-WRITER | `02_architecture/drift_prevention.md` | `DRIFT-DOC-WRITER.md` |

### Session 2026-04-21 — Wave A (sequential, architect-direct)

| ID | Title | Handoff | Commit / merge | Notes |
|----|-------|---------|----------------|-------|
| DIS-002c | Register session-1 follow-up tickets in backlog | `DIS-002c.md` | `7141f17` / `c11e7fc` | 6 Verify-driven entries |
| DIS-002d | Scaffold hygiene (adrs/, clarifications/, done.md backfill) | `DIS-002d.md` | `b6855f5` / `4fe738b` | Moved `document_ocr_flow.md`; backfilled done.md from placeholder to 16 entries |
| DIS-002e | ADR pack ADR-001..007 + kill_switch.md reconciliation | `DIS-002e.md` | `6a279da` / `fdde485` | ADR-003 resolves 307 vs 503; ADR-004 webhook path |
| DIS-001b | Merge DEPS_REQUIRED → package.json + `.ts`→`.js` fix | `DIS-001b.md` | `403b012` / `21a7458` | First `npm install`; deferred `sharp` to DIS-058b |
| DIS-002f | Wave-A session handover + commit 4 untracked session docs | `DIS-002f.md` | `2b38211` / `c36cf07` | SESSION_HANDOVER_2026-04-21 authored |
| DIS-002g | Relocate plan folder into `dis/document_ingestion_service/` | `DIS-002g.md` | `3ccb9da` / `ca33d7d` | 66 files `git mv`; 3 CI files updated |
| DIS-002h | Apply Prettier drift + rewrite stale plan-paths (25 files) | `DIS-002h.md` | `3268a1e` / `082600f` | Sed pass; JSONL preserved as historical record |
| DIS-002i | Widen DIS-021b `files_allowed` for DIS-001b-surfaced bugs | `DIS-002i.md` | `6fb846c` / `2b7b100` | Added tsconfig.json + health.test.ts |

### Session 2026-04-21 — Wave B (parallel v3 worktree protocol)

| ID | Title | Handoff | Commit / merge | CS | Gate 6a |
|----|-------|---------|----------------|----|---------|
| DIS-050a | DatalabChandraAdapter wire-contract hotfix | `DIS-050a.md` | `1b1d486` + `239639f` / `ba5f944` | — | n/a |
| DIS-021b | State-machine ↔ orchestrator reconciliation + named DatabasePort methods | `DIS-021b.md` | `7331260` / `4e23cb2` | CS-1 | CLINICAL APPROVED |
| DIS-021c | Lock vitest discovery + cwd-independent DOCS (Fix 1 deferred) | `DIS-021c.md` | `ddfb95f` / `aef10b7` | — | n/a |
| DIS-021d | Restore full typecheck surface (CS-1 indirect) | `DIS-021d.md` | `0f67d83` + `aa3f363` / `f8cbc34` | CS-1 indirect | CLINICAL APPROVED |
| DIS-002j | Wave-B session-handover + done.md backfill | `DIS-002j.md` | `ac39b91` / `11e9c1a` | — | — |

## Tickets — IN PROGRESS (from in_progress.md)

None. `in_progress.md:8` records "No tickets in progress at `feat/dis-plan` HEAD … Wave C is **HELD** per orchestrator direction." No `### DIS-` entries.

## Tickets — INTEGRATION HOLD (from integration_hold.md)

| ID | Title | What's built so far | Why held | Unblock condition |
|----|-------|---------------------|----------|-------------------|
| DIS-200 | Apply M-001..M-008 to LIVE Supabase | migrations exist per Epic F plan; not applied | touches live DB | INTEGRATION APPROVED per `review_gates.md §6b` |
| DIS-201 | Add FK columns to `lab_results` + `vaccinations` (M-006 live) | migration drafted | live schema change | INTEGRATION APPROVED |
| DIS-202 | Wire `registration.html` upload to DIS `/ingest` | not started | touches `web/` | INTEGRATION APPROVED |
| DIS-203 | Enable shadow mode in `process-document` Edge Function | not started | touches existing Edge Fn | INTEGRATION APPROVED |
| DIS-204 | Filter `loadRecentLabs()` by `verification_status` | not started | touches `web/prescription-pad.html` | INTEGRATION APPROVED |
| DIS-205 | Filter `get_lab_history` tool by `verification_status` | not started | touches `generate-prescription` | INTEGRATION APPROVED |
| DIS-206 | Opt-in rollout per reception clerk | not started | per-operator flag live | INTEGRATION APPROVED |
| DIS-207 | Default rollout (DIS primary) | not started | flips default | INTEGRATION APPROVED |
| DIS-208 | Apply cutover migration M-009 | migration drafted | sentinel backfill + NOT NULL | INTEGRATION APPROVED |
| DIS-209 | Delete legacy `process-document` Edge Function | not started | retires legacy path | INTEGRATION APPROVED after soak |

All are `Status: HELD`. Approval format specified at `integration_hold.md:151-163`; auto-revocation clause at `:165-173` (per-ticket, non-transferable).

## Tickets — BACKLOG (from backlog.md)

**Counts by epic** (source: `backlog.md` section grep):

| Epic section | Ticket count | Line range |
|--------------|--------------|------------|
| Epic A (DIS-001..015) | 15 | `:15-420` |
| Epic B (DIS-020..045) | 26 | `:422-1049` |
| Epic C (DIS-050..085) | 43 (incl. DIS-058a..g splits) | `:1051-1918` |
| Epic D (DIS-090..110) | 21 | `:1922-2340` |
| Epic E (DIS-115..140) | 26 | `:2343-2850` |
| Epic F (DIS-145..175) | 31 | `:2853-3440` |
| Epic G (DIS-200..209 HELD) | 10 | `:3443-3660` |
| Epic H (DIS-220..235) | 16 | `:3663-3975` |
| Session-1 follow-ups (DIS-002c..j, DIS-001b, DIS-021b..d, DIS-050a) | 13 | `:3979-4487` |

**Total ticket entries in backlog.md: ~201**; 25 already in `done.md`.

**Execution-locked tickets (VERIFY-N gate requires `dis/handoffs/DIS-###.md`):** every Session-1 follow-up ticket carries a `test -f dis/handoffs/DIS-###.md` VERIFY step:

- DIS-002c (`backlog.md:3988` + VERIFY-8 `:4003`)
- DIS-002d (`:4024` + VERIFY-7 `:4047`)
- DIS-002e (`:4070` + VERIFY-9 `:4099`)
- DIS-001b (`:4118` + VERIFY-8 `:4144`)
- DIS-021b (`:4167` + VERIFY-10 `:4213`)
- DIS-002f (`:4235` + VERIFY-7 `:4249`)
- DIS-002g (`:4269` + VERIFY-10 `:4296`)
- DIS-021c (`:4314` + VERIFY-10 `:4339`)
- DIS-021d (`:4362` + VERIFY-10 `:4389`)
- DIS-002j (`:4407` + VERIFY-5 `:4419`)
- DIS-050a (`:4437` + VERIFY-9 `:4479`)

All 11 have handoff files present.

**Unusual status markers:**
- All Epic G tickets carry `[HELD]` inline in the title line (`backlog.md:3443,3467,3489,3512,3533,3554,3574,3595,3616,3637`) and `Status: HELD`.
- No `deferred`, `blocked`, or `clarification-pending` markers found outside Epic G.

## Clarifications

Source: `dis/document_ingestion_service/07_tickets/clarifications/` (only `README.md`).

| ID | Summary | Blocks | Status |
|----|---------|--------|--------|
| — | (no clarifications yet) | — | — |

Index table at `clarifications/README.md:61-63` is empty. Zero open, zero answered, zero withdrawn.

## Per-task handoffs — DIS-###.md

32 files total in `dis/handoffs/` (flat, not counting `sessions/` or `orientation/`). Summary table:

| Ticket | One-line description | Files touched / artifacts | Caveats / follow-ups | Merge SHA |
|--------|----------------------|----------------------------|-----------------------|-----------|
| DIS-001b | First `npm install`; merges DEPS_REQUIRED into `package.json`; fixes `.ts`→`.js` imports in `src/http/` | `dis/package.json`, `package-lock.json`, `src/http/*.ts` | `sharp ^0.33` still deferred to DIS-058b | merge `21a7458` |
| DIS-002 | CI workflow + port-validator + PR template + gitleaks (retrofit handoff) | `.github/workflows/dis-ci.yml`, `dis/scripts/port-validator.mjs`, `.github/pull_request_template.md` | Follow-ups DIS-002a/b suggested, later folded into session-1 meta tickets | impl `b29b4e8`, retrofit `21b20a2` |
| DIS-002c | Appends 6 session-1 follow-up tickets to backlog.md | `backlog.md` | Self-registering meta-ticket | `c11e7fc` |
| DIS-002d | Scaffold hygiene: adrs/ + clarifications/ READMEs, move `document_ocr_flow.md`, backfill done.md | `02_architecture/adrs/README.md`, `07_tickets/clarifications/README.md`, `10_handoff/document_ocr_flow.md`, `done.md`, `in_progress.md` | 4 untracked `10_handoff/` files deliberately deferred to DIS-002f | `4fe738b` |
| DIS-002e | ADR pack ADR-001..007 + kill_switch.md reconciliation | 7 ADR files + `adrs/README.md` + `kill_switch.md` | ADR-003 resolves 307→503; future ADR-002-self-host-switchover pending 1000 docs/day | `fdde485` |
| DIS-002f | Wave-A session handover + commit 4 untracked session-mgmt docs | `SESSION_HANDOVER_2026-04-21.md` + 4 session docs | — | `c36cf07` |
| DIS-002g | Relocate plan folder to `dis/document_ingestion_service/` | 66 files `git mv`; 3 CI files updated | Triggered Prettier drift → DIS-002h | `ca33d7d` |
| DIS-002h | Apply stashed Prettier drift + rewrite 25 stale plan-paths | 6 Prettier reformats + 25 sed rewrites | JSONL transcript intentionally preserved | `082600f` |
| DIS-002i | Widen DIS-021b `files_allowed` (tsconfig.json + health.test.ts) | `backlog.md` edit only | Pre-Wave-B housekeeping | `2b7b100` |
| DIS-002j | Wave-B closeout: done.md backfill + SESSION_HANDOVER_2026-04-21_WaveB | `backlog.md`, `done.md`, `in_progress.md`, `SESSION_HANDOVER_2026-04-21_WaveB.md` | Wave C **HELD** per user | `11e9c1a` |
| DIS-004 | Health endpoint + Hono server + correlation-id middleware | `src/http/server.ts`, `routes/health.ts`, `middleware/correlation-id.ts`, `index.ts`, `tests/integration/health.test.ts`, `DEPS_REQUIRED.md` | Red→green re-run folded into DIS-001b | `e525140` + `837f115` |
| DIS-020 | Pure state machine, 10 states × 11 events | `src/core/state-machine.ts`, `tests/unit/state-machine.test.ts` | — | `a6df0ef` |
| DIS-021 | IngestionOrchestrator with DI over 8 ports + 12 tests | `src/core/orchestrator.ts`, fakes, `tests/unit/orchestrator.test.ts` | **COORDINATION_REQUIRED** scar → DIS-021b; 5 SQL-literal fitness violations → DIS-021b | `a6df0ef` + `d49dd57` |
| DIS-021b | State-machine ↔ orchestrator reconciliation + 4 named `DatabasePort` methods (CS-1) | `src/core/orchestrator.ts`, `ports/database.ts` | Regression cleanup deferred to DIS-021c; DatabasePort contract gap → DIS-021d | `4e23cb2` (CLINICAL APPROVED) |
| DIS-021c | Vitest discovery lock + cwd-independent CI-script DOCS (Fix 1 deferred) | `dis/vitest.config.ts`, `check-pr-citations.mjs`, `check-files-touched.mjs` | STOP-and-reported 17 TS errors → DIS-021d | `aef10b7` |
| DIS-021d | Restore full typecheck surface; implement 4 DatabasePort methods on real + fake adapters (CS-1 indirect) | `tsconfig.json`, `ports/index.ts`, `adapters/database/supabase-postgres.ts` + fake, `adapters/storage/supabase-storage.ts` + fake, `http/server.ts`, `middleware/correlation-id.ts`, `audit-log.test.ts` | `tsc --noEmit` now exits 0; 12 files / 124 tests pass | `f8cbc34` (CLINICAL APPROVED) |
| DIS-022 | Confidence policy evaluator (CS-7) fail-closed | `src/core/confidence-policy.ts`, tests (18 assertions / 8 `it()`) | — | see `a322cd8` |
| DIS-023 | Promotion plan builder (CS-10 discharge latest-only, CS-11 dedupe) | `src/core/promotion.ts`, tests (8 cases) | — | `22a2de2` + `8bebe5a` |
| DIS-024 | Audit-log writer, append-only at type + DB level | `src/core/audit-log.ts`, tests (7) | Migration for `ocr_audit_log` + triggers deferred to Epic F | `4dbca6d` |
| DIS-050 | DatalabChandraAdapter (CS-2 byte-identical rawResponse) | `src/adapters/ocr/datalab-chandra.ts`, fixtures, tests | → DIS-050a for wire-contract hotfix | merge `e035d74` |
| DIS-050a | Wire-contract hotfix + ADR-004 `webhook_url` (6 bugs + CS-2 unchanged) | `src/adapters/ocr/datalab-chandra.ts`, tests (13 total) | Webhook receiver deferred to DIS-097-extended (Epic D) | `ba5f944` |
| DIS-051 | ClaudeHaikuAdapter (CS-9, CS-10 no invented data) | `src/adapters/structuring/claude-haiku.ts`, `prompts/structuring.md` v1, `schemas/clinical-extraction.v1.json` | Ajv swap-in + pricing constants deferred | `a17d0f8` + `a18d731` |
| DIS-053 | SupabaseStorageAdapter via REST | `src/adapters/storage/supabase-storage.ts`, fakes, 9 tests | S3Adapter equivalent → Epic H | merge `088db29` |
| DIS-054 | SupabasePostgresAdapter via `postgres` driver | `src/adapters/database/supabase-postgres.ts`, 7 tests | Wires to DIS-060 via `setPostgresDriverLoader` | merge `a41cc65` |
| DIS-057 | DefaultFileRouter (TDD §7 decision tree) | `src/adapters/file-router/default.ts`, 11 tests | `DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE` env wiring deferred | merge `d8792d0` |
| DIS-058 | DefaultPreprocessor (stub, 50-page cap) | `src/adapters/preprocessor/default.ts`, 6 tests | Real sharp pipeline → DIS-058a..g | merge `a24e399` |

## Workstream handoffs — DOC-*, DRIFT-*

| Handoff | Purpose | What was achieved | Status |
|---------|---------|--------------------|--------|
| `DOC-AGENTIC-PROTOCOL.md` | Author end-to-end agentic protocol | `08_team/agentic_dev_protocol.md` (493 lines; Phases 0–9 + Cross-cutting X.1-X.7; 70 numbered + 7 cross-cutting items with per-row Y/P/N status) | Merged 2026-04-20 |
| `DOC-VERIFY-TEMPLATE.md` | Adopt Verify-Driven format | `_ticket_template.md` + `07_tickets/README.md` updated; `files_allowed:` YAML + VERIFY-N block mandatory | Merged 2026-04-20 |
| `DOC-VERIFY-BACKLOG-A.md` | Epic A+B rewrite | 41 tickets, 188 VERIFY-N lines; CS-1/3/7/10/11 anchored at test file level | Merged 2026-04-20 |
| `DOC-VERIFY-BACKLOG-B.md` | Epic C..H rewrite + integration_hold sync | 137 tickets; 10 `[HELD]` markers in Epic G; non-overlap with Backlog-A verified | Merged 2026-04-20 |
| `DRIFT-DOC-WRITER.md` | Author `02_architecture/drift_prevention.md` | 11 controls (5 Phase-1 + 6 Phase-2), rollout plan, F1..F12 failure-mode library | Merged 2026-04-20 |
| `DRIFT-PHASE-1.md` | Implement Controls 1/2/3/7/10 | `check-pr-citations.mjs`, `check-files-touched.mjs`, `fitness-rules.json` + `fitness.mjs` | Merged 2026-04-20; 10/11 VERIFY pass; 5 true-positive findings → DIS-021b |

## Session-level handoffs — sessions/ folder

Source: `dis/handoffs/sessions/` (8 files, moved on 2026-04-22 from `dis/document_ingestion_service/10_handoff/`).

| File | Purpose | Date | Key decisions / findings | Superseded by |
|------|---------|------|--------------------------|---------------|
| `ORIENTATION_REVIEW_2026-04-20.md` | Fresh-session orientation after Wave 3 re-read | 2026-04-20 (early session) | `feat/dis-plan @ 602c634`; PR #1 open; 2 typecheck-blocking bugs from DIS-020/021 coordination scar | `ORCHESTRATOR_ORIENTATION_2026-04-20.md` (where they disagree) |
| `ORCHESTRATOR_ORIENTATION_2026-04-20.md` | 8-section self-audit after full deep read of 45 plan docs + all source | 2026-04-20 | Written in response to user "I know you bullshit…"; authoritative orientation record | — |
| `SESSION_HANDOVER_2026-04-20.md` | End-of-Wave-3 handover | 2026-04-20 | 15 tickets shipped (Epic A/B/C); plan authored; PR #1 open; paused | Live — Wave-A/B handovers build on it |
| `Prompt_2.md` | User-supplied resume prompt | 2026-04-21 (session start) | Directs reading of CLAUDE.md + prior handover + MEMORY.md; verifies git state; confirms zero teammates | — (session artifact) |
| `SESSION_PLAN_2026-04-21.md` | Session delta before ticket work begins | 2026-04-21 | Required `git reset --soft HEAD~2` on commits `7049840` + `96e7006` (protocol-bypass); fitness.mjs blocking at 5 violations | — |
| `SESSION_HANDOVER_2026-04-21.md` | End-of-Wave-A handover | 2026-04-21 | 4 tickets merged (DIS-002c/d/e + DIS-001b); Wave A complete; PR #1 still open; Wave B planned (DIS-021b + DIS-050a) | `SESSION_HANDOVER_2026-04-21_WaveB.md` extends it |
| `SESSION_HANDOVER_2026-04-21_WaveB.md` | End-of-Wave-B handover | 2026-04-21 | 4 tickets merged (DIS-050a, DIS-021b CS-1, DIS-021c, DIS-021d CS-1-indirect); both CS-tagged merges under Gate 6a CLINICAL APPROVED; feat/dis-plan 31+ commits ahead of origin; **Wave C HELD per user** | — (current state) |
| `document_ocr_flow.md` | Reference doc: end-to-end OCR / Claude Vision flow for the existing `process-document` path | pre-session (session-2 §13 appended 2026-04-20) | Notes the system is NOT OCR but Claude Vision multi-modal; §13 added live-wire bugs that seeded DIS-050a | Living document — ADR-002, ADR-004, ADR-007 cite specific sections |

## Execution timeline

Chronological narrative reconstructed from `done.md` + session handovers + handoff dates:

- **2026-04-20 (Wave 1 — Epic A, ~morning):** DIS-001 scaffold; DIS-002 CI + port-validator (commit `b29b4e8`); DIS-003 8 port stubs (`7823597`); DIS-004 health endpoint (`e525140` + `837f115`).
- **2026-04-20 (Wave 2 — Epic B, ~midday):** DIS-020 state machine (`a6df0ef`); DIS-021 orchestrator (same commit — coordination scar noted; 5 SQL-literal fitness violations recorded); DIS-022 confidence policy (`a322cd8`); DIS-023 promotion service (`22a2de2`+`8bebe5a`); DIS-024 audit log (`4dbca6d`).
- **2026-04-20 (Wave-2 meta):** DRIFT-DOC-WRITER authored drift_prevention.md; DRIFT-PHASE-1 implemented Controls 1/2/3/7/10.
- **2026-04-20 (Wave 3 — Epic C):** DIS-050 DatalabChandraAdapter (merge `e035d74`); DIS-051 ClaudeHaikuAdapter (after 2 prior teammate stalls, third teammate shipped at `a17d0f8`+`a18d731`); DIS-053 SupabaseStorageAdapter (`088db29`); DIS-054 SupabasePostgresAdapter (`a41cc65`); DIS-057 DefaultFileRouter (`d8792d0`); DIS-058 DefaultPreprocessor stub after 1 prior conflict (`a24e399`).
- **2026-04-20 (Wave-meta docs):** DOC-AGENTIC-PROTOCOL, DOC-VERIFY-TEMPLATE, DOC-VERIFY-BACKLOG-A, DOC-VERIFY-BACKLOG-B — all merged.
- **2026-04-20 (end of session):** SESSION_HANDOVER_2026-04-20.md authored; 15 tickets shipped; PR #1 open; paused. ORIENTATION_REVIEW_2026-04-20.md authored at start of next session after the reviewer deep-read the 45 plan docs.
- **2026-04-20 (post-handover, unpushed):** Two protocol-bypass commits `7049840` + `96e7006` landed locally — flagged by SESSION_PLAN_2026-04-21 as requiring `git reset --soft HEAD~2` before ticket-driven work.
- **2026-04-21 (session start):** ORCHESTRATOR_ORIENTATION_2026-04-20.md authored as corrected self-audit after user push-back on orientation accuracy; SESSION_PLAN_2026-04-21.md scoped Wave A + Wave B.
- **2026-04-21 (Wave A, ~morning, architect-direct sequential):** DIS-002c appended 6 follow-up tickets to backlog; DIS-002d scaffold hygiene (adrs/, clarifications/, document_ocr_flow.md moved to 10_handoff/, done.md backfilled from 19-line placeholder to 16 entries); DIS-002e ADR-001..007 + kill_switch.md reconciled to 503.
- **2026-04-21 (Wave A, ~midday):** DIS-001b first `npm install` merged DEPS_REQUIRED into package.json + `.ts`→`.js` fix in `src/http/` (V7 surfaced TS6059 rootDir defect → folded into DIS-021b); DIS-002f Wave-A session handover + 4 untracked session docs committed; DIS-002g `git mv` of 66 plan files into `dis/document_ingestion_service/`; DIS-002h Prettier drift applied + 25 stale-path rewrites; DIS-002i widens DIS-021b `files_allowed`.
- **2026-04-21 (Wave B dispatch, parallel v3 worktree protocol):** DIS-050a Datalab wire-contract hotfix (6 bugs + ADR-004 webhook_url; merge `ba5f944`); DIS-021b CS-1 state-machine reconciliation + 4 named DatabasePort methods (merge `4e23cb2` after CLINICAL APPROVED).
- **2026-04-21 (Wave B regression cleanup):** DIS-021c STOP-and-reported 17 TS errors when attempting to remove DIS-021b defensive tsconfig excludes (merge `aef10b7`); split approved → DIS-021d restored full typecheck surface, landed DatabasePort contract on real + fake adapters, `tsc --noEmit` exits 0, 12 files / 124 tests pass (merge `f8cbc34` after CLINICAL APPROVED).
- **2026-04-21 (close):** DIS-002j Wave-B closeout handover (`11e9c1a`); **Wave C held per user ("Hold off before wave C")**; paused with zero teammates, zero worktrees besides main, zero cron jobs, clean tree.
- **2026-04-22 (between sessions):** Session-level handoff docs moved from `dis/document_ingestion_service/10_handoff/` to `dis/handoffs/sessions/` (commit `69ce4bc`, current HEAD of base branch for this review).

## Velocity + confidence signals

Evidence from handoff filenames and done.md entries:

- **Rework cadence:** Of 25 shipped tickets, 6 carry suffixes (a/b/c/d): DIS-001b, DIS-002c/d/e/f/g/h/i/j (8), DIS-021b/c/d (3), DIS-050a (1). DIS-002 carries the heaviest meta-ticket train (8 suffixes) — but these are **planned meta-tickets**, not rework. Genuine rework is confined to **DIS-021b/c/d** (three passes on the state-machine/orchestrator area) and **DIS-050a** (one wire-contract pass on the Datalab adapter). The DIS-021 chain surfaced a coordination scar and its follow-ons were cleanly scope-split (notably DIS-021c STOP-and-reported rather than expanding its blast radius).
- **Test-first discipline:** Gate 2 test-first commits are present for every Wave-2/3 ticket (DIS-020 through DIS-058) and for both CS-tagged Wave-B merges (DIS-021b, DIS-021d have explicit failing-test commits before impl).
- **CS sign-off discipline:** Only CS-tagged tickets require Gate 6a CLINICAL APPROVED. In Wave B both qualifying merges (DIS-021b CS-1, DIS-021d CS-1-indirect) carried explicit approval sign-off.
- **Session handover cadence:** One per session (2026-04-20, 2026-04-21 Wave A, 2026-04-21 Wave B), plus mid-session plan + post-session orientation. Thorough.
- **Verdict — project on track.** The code+doc pair is self-consistent; rework is contained and documented; tests and types are green; the integration gate is respected. Accelerating cadence (15 tickets in one Wave-3 session → 10 tickets in Wave-A+B session) suggests maturity of the parallel-agent protocol. The explicit user-held Wave C is the current governor.

## Cross-references observed

Load-bearing citation chains:

- **ADR-003 (kill-switch 503)** is cited by `rollout_plan.md §Phase 1`, `feature_flags.md §2`, DIS-100 (backlog), `kill_switch.md` (now corrected), and DIS-002e handoff. Authority resolves a previous 307-vs-503 conflict.
- **ADR-004 (Datalab webhooks)** is cited by DIS-050a handoff (§1 item 6, §ADR refs), DIS-097-extended (receiver endpoint, backlog scope), and `10_handoff/document_ocr_flow.md §13.4` (live-wire findings).
- **ADR-006 (postgres driver)** is cited by DIS-054, DIS-021b (named DatabasePort methods), DIS-021d (CS-1 indirect contract propagation).
- **CS-1** tags chain: state-machine → orchestrator → DatabasePort → adapter. DIS-020 (origin) → DIS-021b (reconciliation) → DIS-021d (persistence contract closure).
- **`10_handoff/document_ocr_flow.md §13`** is cited by DIS-050a, ADR-002, ADR-004, ADR-007 as the authoritative live-wire audit.
- **done.md `§Verdict` lines** are copied verbatim from each handoff's `§11 Verdict` per `08_team/session_handoff.md §8`.

## Drift, gaps, contradictions

### Stale path references to `dis/document_ingestion_service/10_handoff/`

The 2026-04-22 move of session docs to `dis/handoffs/sessions/` (commit `69ce4bc`) was a file move only — **119 occurrences of the old `10_handoff/` path remain across 20 files**. This is the single most widespread drift in the handoff/ticket corpus. Priority files to rewrite:

- `dis/handoffs/DIS-002f.md` — 25 occurrences (§1, §3 D-4, files_allowed, §4 AC-2/3/4/5, §5 pasted VERIFY commands)
- `dis/handoffs/DIS-002d.md` — 13 occurrences (§1 moved-to path now double-stale, §VERIFY-3/V6)
- `dis/handoffs/DIS-002h.md` — 5 occurrences (files touched list)
- `dis/handoffs/DIS-002j.md` — 4 occurrences (§3 files-touched table)
- `dis/handoffs/DIS-002e.md` — 2 (ADR-002, ADR-004 citation bodies)
- `dis/handoffs/DIS-002g.md` — 1 (§D-1 rationale)
- `dis/handoffs/DIS-001b.md` — 2
- `dis/handoffs/DIS-050a.md` — 2 (§metadata Flow-doc pointer, §5 implements-note)
- `dis/handoffs/sessions/SESSION_HANDOVER_2026-04-20.md` — 2 (self-path reference)
- `dis/handoffs/sessions/SESSION_HANDOVER_2026-04-21.md` — 2
- `dis/handoffs/sessions/Prompt_2.md` — 1
- `dis/document_ingestion_service/07_tickets/backlog.md` — **43 occurrences** (VERIFY commands on session-1 follow-up tickets still target `10_handoff/` paths — these VERIFY commands would FAIL if re-run today)
- `dis/document_ingestion_service/07_tickets/done.md` — 2
- `dis/document_ingestion_service/07_tickets/in_progress.md` — 1 (pointer to "SESSION_HANDOVER_2026-04-21_WaveB.md §6")
- `dis/document_ingestion_service/07_tickets/integration_hold.md` — 1 (DIS-209 files_allowed still cites `10_handoff/legacy-retired.md`)
- `dis/document_ingestion_service/08_team/session_handoff.md` — 2 (spec cites `10_handoff/`)
- `dis/document_ingestion_service/02_architecture/adrs/ADR-002-datalab-hosted-vs-self-host.md` — 2
- `dis/document_ingestion_service/02_architecture/adrs/ADR-007-claude-haiku-default-sonnet-escalation.md` — 1
- `dis/src/adapters/ocr/datalab-chandra.ts` — 2 (inline comment with doc pointer)
- `dis/document_ingestion_service/11_session_transcripts/2026-04-20_dis-build-session.jsonl` — 6 (immutable historical record; do NOT rewrite — consistent with DIS-002h's JSONL-preserve policy)

**Impact:** Medium severity. Re-running the VERIFY commands for DIS-002c through DIS-002j would produce spurious failures; future ADR supersession tasks would cite a defunct path.

**Not drift:**
- JSONL transcript references — intentionally preserved per DIS-002h policy.

### done.md vs handoff existence — all consistent

Spot check: every entry in done.md names an existing file in `dis/handoffs/` (or explicitly flags "Handoff: absent" for DIS-001 + DIS-003). Confirmed 32 handoffs exist vs 25 tickets logged done + 6 DOC/DRIFT/SESSION handoffs — 1 extra (DIS-002i, which is a pre-Wave-B meta and is also in done.md §Wave A, so the count reconciles).

### Backlog VERIFY gate satisfaction

Every session-1 follow-up in backlog.md has a matching `dis/handoffs/DIS-###.md` file (verified by filename enumeration above). No orphan VERIFY gates.

### Session-handover promises delivered

- Wave-B dispatch plan (SESSION_HANDOVER_2026-04-21 §6) named DIS-021b + DIS-050a → both delivered, plus cleanup chain.
- Wave-C plan (SESSION_HANDOVER_2026-04-21_WaveB §6) is **queued but held** on user direction; not yet promised-and-undelivered.

### Clarifications with no resolution

None — zero open.

### Other observed contradictions

- `blocked.md` is empty (`:15 _Empty._`). Consistent with in_progress.md + done.md state.
- `DIS-001` + `DIS-003` in done.md carry `Handoff: absent` — acknowledged, not a gap.

## Refresh instructions for next session

Re-read: `git log --name-only 69ce4bc..HEAD -- dis/document_ingestion_service/07_tickets/ dis/handoffs/`. For each new handoff: add a row to the DONE or IN_PROGRESS table. For each new session doc under `dis/handoffs/sessions/`: add to the sessions section. Update execution-timeline with new entries. Bump `last_refreshed` + `source_commit`. When the `10_handoff/` drift is finally rewritten, re-run `rg -n "10_handoff/" dis` and drop the drift subsection once the count is 0 (excluding the JSONL transcript).
