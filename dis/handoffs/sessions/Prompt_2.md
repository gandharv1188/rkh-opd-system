I'm resuming work on the Document Ingestion Service (DIS) feature build for  
 the Radhakishan Hospital pediatric prescription system. The previous session  
 paused cleanly on 2026-04-20 after completing Waves 1-3.

=== START HERE ===

1. Read these three files first, in order:
   - CLAUDE.md (project overview + Agentic Team Management section)
   - dis/document_ingestion_service/10_handoff/SE
     SSION_HANDOVER_2026-04-20.md (full handover from last session)
   - C:\Users\gandh\.claude\projects\E--AI-Enabled-HMIS-radhakishan-hospital-prescr
     iption-system-2026\memory\MEMORY.md

2. Then verify git state:
   cd "E:/AI-Enabled HMIS/radhakishan_hospital_prescription_system_2026"
   git fetch
   git checkout feat/dis-plan
   git pull
   git log --oneline -10
   git worktree list # expect only main
   gh pr view 1 # PR should be open

3. Confirm zero active teammates: TaskList
   (there will be stale in_progress entries from the prior session task file;  
   ignore them — they're all merged. Fresh task list starts this session.)

=== OPEN PR ===

PR #1 — feat/dis-plan → main
URL: https://github.com/gandharv1188/rkh-opd-system/pull/1
Title: "docs(dis): plan Document Ingestion Service (DIS) — architecture,
tickets, rollout"
Status: OPEN, awaiting review + Wave 4+ work before merge to main.

PR currently contains:

- Complete DIS plan (40+ docs in
  dis/document_ingestion_service/)
- Wave 1 foundation (DIS-001, 002, 003, 004)
- Wave 2 core business logic (DIS-020, 021, 022, 023, 024)
- Wave 3 POC adapters (DIS-050, 051, 053, 054, 057, 058-stub)
- Phase 1 drift-prevention CI scripts
- Session transcript archive + handover doc
- .gitattributes pinning LF endings

=== WHAT'S DONE ===

- Full plan authored: architecture, tickets in Verify-Driven format, drift
  prevention, runbooks, RACI, coding standards, session-handoff protocol,
  agentic dev protocol
- 15 tickets executed across 3 waves (all with TDD test-first + handoff files  
  in dis/handoffs/DIS-###.md)
- Phase 1 drift controls active in CI: PR citations, files_allowed enforcement,  
  architectural fitness functions, forbidden tokens, 20% VERIFY re-run sampling
- Team system: dis-squad created via TeamCreate (may have been torn down;
  re-create at session start if dispatching any wave)

=== WHAT'S NEXT (in priority order) ===

1. First thing: run `npm install` inside dis/ — no teammate has done this yet.  
   DEPS_REQUIRED.md lists the deps that need merging into dis/package.json
   first (postgres, pdfjs-dist, sharp, @anthropic-ai/sdk, etc.). Then run
   `npm test` to validate Waves 1-3 tests pass.

2. Write ADR-001 (hexagonal + ports) and ADR-002 (Datalab hosted →
   self-host at 1000 docs/day threshold). ADR folder
   `02_architecture/adrs/` exists but empty.

3. Dispatch Wave 4 — Epic D (HTTP layer):
   - DIS-090 POST /ingest
   - DIS-091 GET /extractions/:id
   - DIS-092 POST /extractions/:id/approve
   - DIS-093 POST /extractions/:id/reject
   - DIS-094 POST /extractions/:id/retry
   - DIS-095 GET /extractions (queue list)
   - DIS-096 POST /uploads/signed-url
   - DIS-097 POST /internal/process-job (worker)
   - DIS-098 Realtime status push
   - DIS-099 GET /admin/metrics
   - DIS-100 Kill-switch middleware
     Use the windows-parallel-agents v3 skill; TeamCreate dis-squad; every
     teammate dispatched with files_allowed + VERIFY steps + 15-min health
     check cron (CronCreate).

4. DIS-058b — replace preprocessor stub with real sharp-based pipeline
   (deferred from Wave 3).

5. Wave 5 — Epic E (Verification UI, DIS-115..140).

6. Wave 6 — Epic F (observability + staging migrations, DIS-145..175).

=== WHAT'S HELD (do NOT execute without explicit approval) ===

Epic G integration tickets DIS-200..209 are in integration_hold.md. These
touch web/, existing Edge Functions, and the live Supabase database. Each
requires a written "INTEGRATION APPROVED — DIS-### — <name>, <date>" note
from Dr. Lokender Goyal (user) in the PR thread before execution.

=== BINDING RULES FROM LAST SESSION (re-read before dispatching) ===

- TDD test-first mandatory (Gate 2 in review_gates.md) — failing test
  commit before impl commit
- Every teammate dispatched with team_name: "dis-squad" + unique name +
  run_in_background: true + v3 hardened worktree prompt
- Every ticket has exhaustive files_allowed: list; CI rejects PRs writing
  outside it
- Every ticket ends with numbered VERIFY-N shell commands + literal expected  
  output; actual command output pasted in the handoff
- Session handoff file at dis/handoffs/DIS-###.md required per ticket
  (Gate 7 DoD)
- Clinical-safety tickets (CS-1..CS-12) need human clinical reviewer sign-off  
  before merge
- Re-create the teammate health check cron at session start:
  CronCreate("7,22,37,52 \* \* \* \*", ...) — see how last session wired it

=== GOTCHAS FROM LAST SESSION ===

- Agent spawned with `name` but no `team_name` is a subagent, not a
  teammate — cannot receive SendMessage. Always use teammate form.
- idle ≠ done. Confirm with git log + handoff file before marking completed.
- Some teammates stall silently — health-check cron catches it.
- LF/CRLF warnings are now silenced (fixed via .gitattributes last session).
- Windows worktree removal sometimes fails with permission denied — safe to  
  ignore; branch cleanup still works.

Proceed with Step 1 (read the three files) and report back on git state
before dispatching any wave.
