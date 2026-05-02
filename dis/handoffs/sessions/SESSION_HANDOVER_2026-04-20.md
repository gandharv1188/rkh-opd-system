# DIS v1 — Session Handover — 2026-04-20

> Authored directly by the orchestrator (Claude Opus 4.7, 1M) at end of
> session, before the next compaction, so the durable record is a
> first-hand account rather than an agent-reconstructed summary.
>
> **Purpose:** a fresh session (new Claude instance or human architect)
> can resume DIS v1 development from this document + the plan folder
> without context loss.

---

## §0. TL;DR

- **Session:** ~10h of continuous agentic development on 2026-04-20 UTC.
- **Feature:** Document Ingestion Service (DIS) v1 — replaces the
  current `process-document` Edge Function with a verification-gated,
  cloud-portable pipeline. Datalab Chandra OCR + Claude Haiku
  structuring.
- **Outcome:** full plan authored + first **15** tickets executed
  (Epic A foundation 4, Epic B core 5, Epic C POC adapters 6). All
  committed to `feat/dis-plan`, pushed, **PR #1 open**.
- **State:** **paused** at end of Wave 3. All teammates shut down. Cron
  cancelled. Zero active worktrees. Integration with the existing
  system (Epic G) is held behind an explicit `INTEGRATION APPROVED`
  user gate.
- **Next:** Epic D (HTTP layer + queue + worker endpoint) — not
  dispatched.

---

## §1. Session metadata

| Field                     | Value                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session ID (UUID)         | `783e7b47-9182-4acd-bfc2-371cb44fe402`                                                                                                                          |
| Raw transcript (JSONL)    | `dis/document_ingestion_service/11_session_transcripts/2026-04-20_dis-build-session.jsonl` (~4.5 MB, 2912 lines, continuous — no compaction events in the file) |
| Orchestrator model        | Claude Opus 4.7 (1M context)                                                                                                                                    |
| Branch of record          | `feat/dis-plan` (pushed to `origin`)                                                                                                                            |
| PR                        | [#1 — docs(dis): plan Document Ingestion Service (DIS)](https://github.com/gandharv1188/rkh-opd-system/pull/1)                                                  |
| Team                      | `dis-squad` (TeamCreate used mid-session; first-half teammates were named subagents, second-half were real teammates)                                           |
| Context usage at handover | ~58% at `/context` check; climbed during handover drafting                                                                                                      |

---

## §2. What was built — chronological

### Phase 0 — Documentation plan (no code)

`00_overview/`, `01_product/`, `02_architecture/`, `03_data/`, `04_api/`,
`05_testing/`, `06_rollout/`, `07_tickets/`, `08_team/`, `09_runbooks/`
— roughly 40 markdown files including:

- North Star, glossary, non-goals
- Product brief, user stories DIS-US-001..032, clinical-safety CS-1..CS-12
- TDD §1..§20, adapter interfaces, portability plan, sequence diagrams,
  coding standards §1..§17
- Data model: `ocr_extractions`, `ocr_audit_log`, `dis_jobs`,
  `dis_cost_ledger`, `dis_confidence_policy`. Migrations M-001..M-009.
- OpenAPI 3.1 spec, error model
- Session-handoff protocol, Verify-format spec, agentic-dev-protocol,
  drift-prevention (11 controls, Phase 1 + Phase 2)
- Test strategy, unit/integration/clinical-acceptance plans, fixtures
- Rollout (shadow → opt-in → default), feature flags, kill switch,
  comms & training
- Runbooks: incident response, key rotation, migration incident,
  provider outage, DR, stuck jobs
- RACI, review gates, ticket board (README, epics, template,
  backlog in Verify-Driven format, integration-hold, in-progress,
  done, blocked)

Plus the Chandra vs. Claude Vision comparison + pricing appendix in
`dis/document_ingestion_service/10_handoff/document_ocr_flow.md`
(moved into the handoff folder on 2026-04-20; session 2 findings
appended as §13 in that file), the sample OCR PDFs
in `radhakishan_system/data/sample_ocr_pdfs/`, the Levetiracetam dose
sanity check in `radhakishan_system/scripts/calc_levetiracetam_8_7kg.js`.

### Wave 1 — Epic A foundations (dev tickets)

| Ticket  | Title                                                                | Teammate                                          |
| ------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| DIS-001 | Initialize `dis/` subproject — tsconfig, package.json, folder layout | `dev-001-scaffold` (subagent)                     |
| DIS-002 | CI workflow + port validator + PR template + secret scan             | subagent → retrofit handoff by `dis-002-retrofit` |
| DIS-003 | 8 port interface stubs + index barrel + assertNever helper           | subagent                                          |
| DIS-004 | Health endpoint + Hono server + TDD-first failing test               | subagent → retrofit by `dis-004-retrofit`         |

### Wave 2 — Epic B core business logic (teammate squad)

| Ticket  | Title                                   | Teammate                | CS coverage  |
| ------- | --------------------------------------- | ----------------------- | ------------ |
| DIS-020 | State machine (pure)                    | `dev-state-machine`     | CS-1         |
| DIS-021 | IngestionOrchestrator (DI ports)        | `dev-orchestrator`      | —            |
| DIS-022 | Confidence policy evaluator             | `dev-confidence-policy` | CS-7         |
| DIS-023 | Promotion service (latest-only, dedupe) | `dev-promotion`         | CS-10, CS-11 |
| DIS-024 | Audit log writer (append-only contract) | `dev-audit-log`         | —            |

### Drift + Verify meta-work

- Drift-prevention doc drafted (`drift-doc-writer`): 11 controls, Phase 1
  recommended now / Phase 2 deferred.
- Verify-Driven Ticketing format authored (`05_testing/verify_format.md`).
- Template + backlog rewrite to Verify-Driven (first teammate stalled;
  replaced with 3 leaner teammates: `doc-verify-template`,
  `doc-verify-backlog-a`, `doc-verify-backlog-b`).
- Phase 1 drift controls implemented (`drift-implementer`): CI scripts
  `check-pr-citations.mjs`, `check-files-touched.mjs`, `fitness.mjs` +
  `fitness-rules.json`, `check-forbidden-tokens.mjs`, self-test harness,
  `.github/workflows/dis-ci.yml` jobs, review_gates.md Gate 5 20%
  re-verification paragraph.

### Wave 3 — Epic C POC adapters

| Ticket  | Title                      | Teammate                                               | Notes                                                                         |
| ------- | -------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| DIS-050 | DatalabChandraAdapter      | `dev-datalab`                                          | CS-2 raw-response preservation                                                |
| DIS-051 | ClaudeHaikuAdapter         | `dev-haiku` → `dev-haiku-2` → **`dev-haiku-3`**        | 2 stalls before success; 3rd teammate completed on existing test-first commit |
| DIS-053 | SupabaseStorageAdapter     | `dev-storage`                                          | —                                                                             |
| DIS-054 | SupabasePostgresAdapter    | `dev-postgres`                                         | No `@supabase/supabase-js` — pure `postgres` driver                           |
| DIS-057 | DefaultFileRouter          | `dev-file-router`                                      | TDD §7 decision tree                                                          |
| DIS-058 | DefaultPreprocessor (stub) | `dev-preprocessor` conflict → **`dev-preprocessor-2`** | Landed as passthrough stub; real pipeline deferred to **DIS-058b**            |

### Session archiving (this phase)

- Transcript copied to `11_session_transcripts/` with a README
  documenting JSONL format + Windows/macOS on-disk paths.
- This handover document (the file you are reading).

---

## §3. Current state

- **Branch tree:** only `feat/dis-plan` at `HEAD` past `3f8ef16`.
  All wave branches merged and deleted.
- **PR #1:** open on `main`. Title: `docs(dis): plan Document Ingestion
Service (DIS) — architecture, tickets, rollout`. Includes all plan
  docs + all code from Waves 1-3.
- **Worktrees live:** none (all cleaned up).
- **Active teammates:** none (all shut down via `SendMessage(shutdown_request)`).
- **Cron jobs:** none (the 15-min teammate-health-check `5af9c766` was cancelled).
- **Stash:** none (the intermediate `pre-drift-merge-cleanup` stash was dropped after recovery).
- **Task list (TaskList):** tasks 1-13 completed; task 14 (this handover) in-progress-by-orchestrator.

---

## §4. Architectural decisions — durable

1. **Hexagonal Ports & Adapters.** Core in `dis/src/core/`; 8 ports in
   `dis/src/ports/`; adapters in `dis/src/adapters/`. Core may not import
   adapters — enforced by `fitness.mjs`.
2. **CQRS-lite staging → production boundary.** `ocr_extractions` is
   the command side; `lab_results` + `vaccinations` are the query side.
   Promotion is the explicit command.
3. **Verification-gated clinical data.** Default confidence policy is
   `enabled: false` (CS-7) — every extraction lands in
   `ready_for_review`. Auto-approval is opt-in per tenant.
4. **CS-2 preservation of raw responses.** Datalab's full JSON is
   stored byte-identical on `ocr_extractions.raw_ocr_response`.
5. **Datalab Chandra hosted API + Claude Haiku structuring.**
   Per-page Cloud-Hosted plan ($25/month flat, $3/$4.50 per 1000
   pages). Self-host inflection at **sustained 1000 docs/day**
   (saved in memory).
6. **TDD test-first.** Failing test committed before implementation
   (Gate 2). Enforced by review_gates.md.
7. **Verify-Driven Ticketing.** Every ticket ends with numbered
   `VERIFY-N` shell commands + literal expected output. Prose
   acceptance criteria rejected.
8. **Session handoff per ticket.** Every merged branch has
   `dis/handoffs/DIS-###.md` with a structured handoff + Verify report
   (actual command output pasted).
9. **Drift prevention Phase 1 active.** CI enforces: PR citations,
   `files_allowed` scope, architectural fitness, forbidden tokens,
   and 20% re-verification sampling at Gate 5.
10. **Integration gate (§6b).** Any ticket touching `web/`,
    `supabase/functions/`, or live schema is held in
    `integration_hold.md` and needs `INTEGRATION APPROVED` from the
    user before execution. **This is binding, no override.**
11. **Preprocessor v1 is a stub.** Passthrough with 50-page cap. Real
    pipeline (deskew, CLAHE, sharp) deferred to **DIS-058b**.
12. **Teammates > subagents.** Subagents used early (Wave 1); real
    teammates (spawned with `team_name`) used from Wave 2 onward.
    SendMessage works only for teammates — this is what enables
    shutdown/poke/re-dispatch.
13. **Portability by containment.** Core + ports + HTTP routes never
    change across clouds. Only `src/wiring/supabase.ts` vs
    `src/wiring/aws.ts` + the specific adapter implementations differ.

---

## §5. Clinical safety commitments (CS-1..CS-12)

| #     | Rule                                           | Where enforced                                                        |
| ----- | ---------------------------------------------- | --------------------------------------------------------------------- |
| CS-1  | No unverified OCR data reaches clinical tables | State machine (`state-machine.ts`) + promotion gate                   |
| CS-2  | Raw OCR response preserved forever             | `ocr_extractions.raw_ocr_response` JSONB + DatalabChandraAdapter test |
| CS-3  | Every clinical row traces to one extraction    | FK `ocr_extraction_id ON DELETE RESTRICT`                             |
| CS-4  | Verified values never silently overwritten     | Re-ingest creates new extraction; UI duplicate banner                 |
| CS-5  | Reject is permanent                            | State machine terminal check                                          |
| CS-6  | Edits logged field-by-field                    | `ocr_audit_log` + audit-log adapter                                   |
| CS-7  | Confidence gates explicit, default OFF         | `dis_confidence_policy.enabled=false` + policy evaluator              |
| CS-8  | PII stays within project boundary              | RLS + coding_standards §8 (no PII in logs)                            |
| CS-9  | Test-name normalization audited                | Raw name preserved in `raw_structured_response`                       |
| CS-10 | Discharge-summary latest-only is code-enforced | `promotion.ts` dedup logic + 7-TSB fixture test                       |
| CS-11 | Duplicate-row prevention on promotion          | `promotion.ts` pre-check + DB `uniq_lab_dedupe`                       |
| CS-12 | No unverified data to prescription generator   | Filter on `verification_status='verified'` (pending in Epic G)        |

**Clinical Reviewer (human) sign-off is still required** before any
`clinical-safety`-tagged ticket merges to main.

---

## §6. What the tests prove so far

All tests written TDD-first; **none have been actually executed**
because `npm install` has not been run (DIS-001 produced `package.json`
but intentionally skipped install — deferred to integration time).

| Area                 | Test files | Approx test cases                                      |
| -------------------- | ---------- | ------------------------------------------------------ |
| Core state machine   | 1          | 18                                                     |
| Orchestrator         | 1          | 10+                                                    |
| Confidence policy    | 1          | 18 (loop over 0.0..1.0)                                |
| Promotion            | 1          | 8 (incl. 7-TSB CS-10 fixture, idempotent replay CS-11) |
| Audit log            | 1          | 6+ (update/delete contract prohibition)                |
| Datalab adapter      | 1          | 7                                                      |
| Haiku adapter        | 1          | 6                                                      |
| Supabase Storage     | 1          | 9                                                      |
| Supabase Postgres    | 1          | 6+                                                     |
| File router          | 1          | 8+                                                     |
| Preprocessor stub    | 1          | 6                                                      |
| Drift controls smoke | 1          | ~6                                                     |
| Health endpoint      | 1          | 4                                                      |

First thing the next session should do after reviewing this handover
is run `npm install` in `dis/` and execute the test suite. Many tests
assume sibling fixtures (`tests/fixtures/datalab/convert-response.json`,
`tests/fixtures/haiku/*`, etc.) which are committed.

---

## §7. Known gaps & follow-ups

1. **DIS-058b** — real preprocessor pipeline (sharp-based:
   normalize/deskew/blank/dup/resize/CLAHE/JPEG). Stub is in place.
2. **`npm install` pending.** All dependencies declared in
   `dis/package.json` + `dis/DEPS_REQUIRED.md`: `hono`,
   `@hono/node-server`, `pino`, `postgres`, `pdfjs-dist`,
   `sharp` (for DIS-058b). Dev: `vitest`, `@types/node`.
3. **Anthropic SDK** is declared as `@anthropic-ai/sdk` (per
   DEPS_REQUIRED.md) but NOT in `package.json`. Needs to be added
   before Haiku adapter can run live.
4. **Epic G integration tickets DIS-200..209 all held.** See §8.
5. **No staging Supabase project.** DIS-145 will need a fresh
   project provisioned before the migrations can be tried end-to-end.
6. **Observability not wired.** `pino` declared but no logger
   instantiated anywhere. DIS-147 (logs), DIS-148 (metrics), DIS-149
   (cost ledger writes) are open.
7. **Verification UI (Epic E) not started.** DIS-115..140.
8. **ADR folder is empty.** `02_architecture/adrs/` contains no ADRs
   — every architectural decision made this session was made
   in-conversation without a formal ADR file. Worth back-filling ADR-001
   (hexagonal + ports) and ADR-002 (Datalab hosted vs self-host
   threshold at 1000 docs/day) before next wave.
9. **379 production PDFs** live in the Supabase `documents` bucket —
   no backfill plan yet. Separate ticket needed once DIS is live.
10. **Prescription-pad "pad mode" OCR** is a non-goal (see non_goals.md
    §1). Stays on Claude Vision for now.
11. **Drift Control 10 (20% re-verification) has not been exercised
    via its formal sampling protocol** — all Wave 3 merges used informal
    spot-checks. The procedure kicks in from Wave 4 onward.
12. **Some transcript-only content is not in plan docs**: teammate
    decision logs (D-1/D-2/D-3 from DIS-050), stall/retry chains
    (DIS-051 x3), conflict reports (DIS-058 original vs stub). If you
    want these durable as individual chat-log files, see §13 last
    bullet.
13. **DEPS_REQUIRED.md and package.json are out of sync** — Wave 3
    adapters appended deps to DEPS_REQUIRED.md but nobody edited
    `dis/package.json` (per DIS-001 scope lock). At integration time
    these must be merged by the architect.

---

## §8. On hold (Epic G)

All tagged `integration`. All require `INTEGRATION APPROVED — DIS-### — <name>, <date>`
from the Integration Gatekeeper (user) in the PR thread before any
execution.

- **DIS-200** — Apply M-001..M-008 to LIVE Supabase.
- **DIS-201** — Add FK columns to `lab_results` + `vaccinations` (M-006 live).
- **DIS-202** — Wire `registration.html` upload to DIS `/ingest`.
- **DIS-203** — Enable shadow mode in `process-document`.
- **DIS-204** — Filter `loadRecentLabs()` by `verification_status`.
- **DIS-205** — Filter `get_lab_history` tool output likewise.
- **DIS-206** — Opt-in rollout per reception clerk.
- **DIS-207** — Default rollout (DIS becomes primary).
- **DIS-208** — Apply cutover migration M-009.
- **DIS-209** — Delete legacy `process-document` Edge Function after soak.

Phased execution sequence is in `06_rollout/rollout_plan.md`. Kill
switch (instant revert to legacy) documented in `06_rollout/kill_switch.md`.

---

## §9. How to resume (copy-pasteable checklist for the next session)

```bash
# 0. Orient
cd "E:/AI-Enabled HMIS/radhakishan_hospital_prescription_system_2026"
cat dis/document_ingestion_service/README.md

# 1. Git state
git fetch
git checkout feat/dis-plan
git pull
git log --oneline -15
git worktree list        # should be just the main worktree
gh pr view 1 --json title,state,url

# 2. Read in order
cat dis/document_ingestion_service/00_overview/north_star.md
cat dis/document_ingestion_service/08_team/agentic_dev_protocol.md
cat dis/document_ingestion_service/10_handoff/SESSION_HANDOVER_2026-04-20.md   # this file
cat dis/document_ingestion_service/02_architecture/drift_prevention.md
cat dis/document_ingestion_service/05_testing/verify_format.md
cat dis/document_ingestion_service/08_team/review_gates.md

# 3. Install + test (first thing to verify DIS builds clean)
cd dis
# First: merge entries from DEPS_REQUIRED.md into package.json (architect job).
# Then:
npm install
npm run typecheck
npm test

# 4. Load memory
cat C:/Users/gandh/.claude/projects/E--AI-Enabled-HMIS-radhakishan-hospital-prescription-system-2026/memory/MEMORY.md

# 5. Decide the next wave. Likely order:
#    a) Back-fill DEPS_REQUIRED.md → package.json; run tests.
#    b) Write ADR-001 (hexagonal) + ADR-002 (Chandra-vs-self-host).
#    c) Dispatch Wave 4 — Epic D (DIS-090..110) — HTTP server wiring,
#       /ingest, /approve, /reject, /retry, worker endpoint, queue
#       adapter (pg_cron), realtime push, admin metrics.
#    d) DIS-058b (real preprocessor).
#    e) Wave 5 — Epic E verification UI.
#    f) Wave 6 — Epic F observability + staging migrations.
#    g) Then pause for the user to grant Epic G (integration) approval.

# 6. When dispatching teammates
# - TeamCreate once per session (persistent team).
# - Each Agent dispatch: set team_name: "dis-squad" + unique name +
#   run_in_background: true + v3 hardened worktree prompt.
# - Use the cron health-check pattern: CronCreate every 15 min.
# - files_allowed + VERIFY steps are MANDATORY per Phase 1 drift control.
```

---

## §10. Teammate performance log (full, incl. retries)

| Teammate                  | Role     | Ticket                      | Outcome                 | Note                                                         |
| ------------------------- | -------- | --------------------------- | ----------------------- | ------------------------------------------------------------ |
| `dev-001-scaffold`        | subagent | DIS-001                     | ✅ merged               | Scaffold + Dockerfile stub                                   |
| `dis-002-ci` (subagent)   | subagent | DIS-002                     | ✅ merged               | CI + port-validator                                          |
| `dis-002-retrofit`        | subagent | DIS-002 handoff             | ✅ merged               | Verify report retroactive                                    |
| `dis-003-ports`           | subagent | DIS-003                     | ✅ merged               | 8 port stubs                                                 |
| `dis-004-health`          | subagent | DIS-004                     | ✅ merged               | Health endpoint TDD-first                                    |
| `dis-004-retrofit`        | subagent | DIS-004 handoff             | ✅ merged               | Retroactive verify                                           |
| `drift-doc-writer`        | subagent | drift_prevention.md         | ✅ merged               | 11 controls                                                  |
| `verify-coordinator`      | subagent | rewrite template + backlog  | ⚠ stalled at 8 min      | Replaced by 3 leaner agents                                  |
| `doc-verify-template`     | teammate | template + README           | ✅ merged               | Adds `files_allowed` field                                   |
| `doc-verify-backlog-a`    | teammate | Epic A+B Verify format      | ✅ merged               | DIS-001..045 rewritten                                       |
| `doc-verify-backlog-b`    | teammate | Epic C-H + integration_hold | ✅ merged               | DIS-050..235 rewritten                                       |
| `doc-agentic-protocol`    | teammate | agentic_dev_protocol.md     | ✅ merged               | Phases 0-9 Y/P/N status                                      |
| `dev-state-machine`       | teammate | DIS-020                     | ✅ merged               | 18 tests, CS-1                                               |
| `dev-orchestrator`        | teammate | DIS-021                     | ✅ merged               | DI ports, VersionConflictError                               |
| `dev-confidence-policy`   | teammate | DIS-022                     | ✅ merged               | CS-7 fail-closed default                                     |
| `dev-promotion`           | teammate | DIS-023                     | ✅ merged               | 8 tests, 7-TSB fixture                                       |
| `dev-audit-log`           | teammate | DIS-024                     | ✅ merged               | Append-only type contract                                    |
| `drift-implementer`       | teammate | Phase 1 drift controls      | ✅ merged               | 5 CI scripts + Gate 5 paragraph                              |
| `dev-datalab`             | teammate | DIS-050                     | ✅ merged               | CS-2 raw preservation; D-1..D-4 decisions in handoff         |
| `dev-haiku`               | teammate | DIS-051                     | ❌ stalled              | 48 min no commits                                            |
| `dev-haiku-2`             | teammate | DIS-051 re-dispatch         | ❌ stalled              | Test-first only, no impl                                     |
| `dev-haiku-3`             | teammate | DIS-051 impl-only           | ✅ merged               | Appended impl on existing test commit                        |
| `dev-storage`             | teammate | DIS-053                     | ✅ merged               | Supabase Storage REST                                        |
| `dev-postgres`            | teammate | DIS-054                     | ✅ merged               | `postgres` driver, no SDK                                    |
| `dev-file-router`         | teammate | DIS-057                     | ✅ merged               | TDD §7 decision tree                                         |
| `dev-preprocessor`        | teammate | DIS-058                     | ⚠ conflict              | Original pipeline superseded by stub that landed in parallel |
| `dev-preprocessor-2`      | teammate | DIS-058 stub                | ✅ merged               | Passthrough; real pipeline → DIS-058b                        |
| `session-handover-writer` | teammate | this handover               | 🛑 shut down mid-flight | Orchestrator took over directly to avoid compaction risk     |

**Stall signature observed twice (dev-haiku, dev-haiku-2, dev-preprocessor):**
teammate starts, writes some files, does not commit, goes idle. Recovery
pattern: shutdown → recreate worktree → re-dispatch with leaner brief
(no extra features, strict time budget).

**Silent completion signature** (observed on
`doc-verify-backlog-a`, `dev-file-router`, `dev-storage`, `dev-postgres`,
etc.): teammate commits full ticket, goes idle without sending a chat
summary. Detected by periodic `git log` on the branch. **This is why
the 15-min cron is essential.**

---

## §11. Drift prevention — state at end of session

| Control                               | Status                              | Notes                                                                                                                                 |
| ------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — PR citation check                 | ✅ wired, not yet exercised         | `check-pr-citations.mjs` + CI job. Fires on next PR.                                                                                  |
| 2 — `files_allowed` allowlist         | ✅ wired; template updated          | Applied retroactively to Wave 3 dispatch prompts. First fully-enforced wave is Wave 4.                                                |
| 3 — Architectural fitness functions   | ✅ wired                            | `fitness.mjs` + `fitness-rules.json` (7 rules). Port-validator delegates to it now. No violations in current tree.                    |
| 7 — Forbidden tokens                  | ✅ wired                            | `check-forbidden-tokens.mjs`. No violations in current tree.                                                                          |
| 10 — Orchestrator 20% re-verification | ✅ documented (review_gates Gate 5) | Protocol exists but hasn't been formally exercised — all merges so far used informal spot-checks. **Exercise on first Wave 4 merge.** |
| 4-6, 8, 9, 11 (Phase 2)               | ⏳ deferred                         | Spec lives in `drift_prevention.md` §4. Add tickets when a drift incident justifies.                                                  |

---

## §12. Cost & scaling notes (forward-looking)

From memory + Datalab pricing research:

- **Current POC volume:** ~20 docs/day → ~$26/month all-in (Datalab $25
  flat plan covers, Haiku ~$1).
- **Inflection point for self-host:** sustained 1000 docs/day over 60
  days → $333/month hosted vs ~$200-400/month GPU. Switch driver
  becomes data residency, not pure cost savings.
- **Datalab Cloud-Hosted pricing:**
  - $25/month flat + $25 credit
  - $3.00 per 1000 pages (markdown/layout)
  - $4.50 per 1000 pages (accurate mode = Chandra — what we use)
  - $0.01/request minimum
- **Tenants that want direct promotion** (no verification) can flip
  `dis_confidence_policy.enabled=true` + rules `confidence >= 0`.
  Zero code changes required. Radhakishan stays OFF.

---

## §13. Gotchas for the next session

1. **Context math.** At start of next session, read: `CLAUDE.md`,
   `memory/MEMORY.md`, `SESSION_HANDOVER_2026-04-20.md`, and **the
   README files of the plan subfolders only** — not the full TDD or
   backlog. Saves ~100k tokens of context.
2. **Teammate idle ≠ done.** Confirm with `git log <branch>` +
   `ls dis/handoffs/DIS-###.md` before marking a task completed.
3. **Windows worktree permission quirks.** Occasionally
   `git worktree remove --force` fails with "Permission denied" — the
   directory lock releases eventually; branch cleanup still succeeds.
   Safe to ignore; the next `git worktree add` on a fresh path works.
4. **Formatter CRLF nags.** Every write triggers prettier + the CRLF
   linter. Treat the `M` spam as noise unless it's in files you
   actually intended to touch.
5. **Agent `name` without `team_name` = subagent**, not a teammate.
   You **cannot** send `SendMessage` / `shutdown_request` to a subagent
   — it only works for agents spawned with `team_name: "dis-squad"`.
   Always use the teammate form.
6. **Subagents and teammates both produce `idle_notification` events.**
   Late idle notifications keep arriving from already-shut-down
   teammates — ignore them silently.
7. **The JSONL transcript is 4.5 MB**; **never** feed it to a
   Read/Agent in one shot — use `grep`/`head`/`tail`/`jq`/Node filters.
   Doing otherwise will blow the receiving agent's context.
8. **The `.env` file holds `DATALAB_API_KEY`.** The adapter reads it
   via the SecretsPort. Never hardcode. Never log. Never echo in
   commit messages.
9. **`files_allowed` is enforced from Wave 4 onward.** Every new
   ticket dispatch must include this block in the prompt, and the
   teammate must not write files outside it. CI will reject the PR
   otherwise.
10. **Integration gate (§6b) is absolute.** A new session must NOT
    merge any ticket tagged `integration` without the user's written
    `INTEGRATION APPROVED` note. This is where I can mislead a future
    self if I forget — the sign-off must be **explicit and visible in
    the PR thread**.
11. **Do not archive teammate chat logs unless asked.** They're in the
    JSONL; extracting them is a separate task. The decision-lists in
    handoff files (D-1/D-2/…) are the durable subset.
12. **Cron is session-only.** The 15-min health-check does not survive
    session restart. Re-create it at the start of the next session
    before dispatching any wave (`CronCreate` with the same prompt
    body I used — see the transcript for exact syntax).

---

## §14. Sign-off

- **Orchestrator:** Claude Opus 4.7 (1M context)
- **Session end:** 2026-04-20 ~12:30 UTC (last committed operation was
  the archival of the transcript)
- **Final commit hash on `feat/dis-plan`:** see `git log -1`
- **Final PR status:** open, #1, on `main`
- **Integration status:** HELD (untouched existing system)
- **Next session entry point:** this file + `07_tickets/in_progress.md`
  (should be empty) + `gh pr view 1`

**Binding note for the next orchestrator:** the next wave to execute
is **Epic D (DIS-090..110)** — HTTP server wiring. Do not jump to
Epic E (UI) or Epic G (integration) before Epic D. Do not touch
`web/`, `supabase/functions/`, or the live Radhakishan Supabase
database without user sign-off.
