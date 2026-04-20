# Handoff — DOC-VERIFY-BACKLOG-B

Agent: `doc-verify-backlog-b` (dis-squad).
Branch: `feat/dis-verify-backlog-b`.
Worktree: `.claude/worktrees/verify-backlog-b`.

## Scope delivered

Rewrote Epics C, D, E, F, G, H (DIS-050..DIS-235) in
`radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/backlog.md`
to the Verify-Driven format, and rewrote each held ticket one-liner in
`integration_hold.md` preserving the `[HELD]` marker and policy text.

Out of scope (owned by `doc-verify-backlog-a`): Epic A + Epic B
(DIS-001..DIS-045). Those sections are byte-identical to main (verified
via diff, see evidence below).

## Structure applied per ticket

Each ticket has: Tags, Epic, Depends on, TDD ref, CS ref (if any),
**Files allowed**, Out of scope, (Execution gate for Epic G),
Description, and a **VERIFY** block of 3–6 steps with exact commands
and expected literals. Epic G VERIFY steps are prefixed `[STAGING ONLY]`
per `verify_format.md` §9, and each Epic G ticket carries
`**Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.`

## Verify Report

### V1: ticket count in new scope

- Command: `grep -cE "^### DIS-(05|06|07|08|09|11|12|13|14|15|16|17|20|21|22|23)" radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/backlog.md`
- Expected: `>= 50`
- Actual: `137`
- Status: PASS

### V2: Files-allowed coverage across full backlog

- Command: `grep -c "Files allowed:" radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/backlog.md`
- Expected: `>= 90` (this scope ≥ 50, plus Epic A/B teammate ≥ ~40)
- Actual: `147`
- Status: PASS

### V3: HELD markers (Epic G)

- Command: `grep -c "\[HELD\]" radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/backlog.md`
- Expected: `>= 10`
- Actual: `10`
- Status: PASS

### V4: Integration hold ticket count

- Command: `grep -c "### DIS-" radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/integration_hold.md`
- Expected: `>= 10`
- Actual: `10`
- Status: PASS

### V5: INTEGRATION APPROVED references in integration_hold.md

- Command: `grep -c "INTEGRATION APPROVED" radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/integration_hold.md`
- Expected: `>= 1`
- Actual: `12`
- Status: PASS

### V6: Epic A + Epic B bytes unchanged (non-overlap with parallel teammate)

- Command: `sed -n '13,149p' backlog.md | diff -q - <(git show HEAD:backlog.md | sed -n '13,149p')`
- Expected: no diff output
- Actual: (empty)
- Status: PASS

### V7: Epic order + template section intact

- Command: `grep -n "^## Epic\|^## Ticket template" backlog.md`
- Expected: Epics A, B, C, D, E, F, G, H in order plus Ticket template section
- Actual:
  - 13 Epic A, 84 Epic B, 151 Epic C, 1022 Epic D, 1443 Epic E, 1953 Epic F, 2538 Epic G, 2763 Epic H, 3069 Ticket template
- Status: PASS

## Next steps for reviewer

- Re-run the five SCOPE verify commands in `integration_hold.md` review.
- Sample 20% of the ticket-level VERIFY steps (file existence, grep)
  before merge.
- Epic G tickets remain HELD; `INTEGRATION APPROVED` still mandatory
  before any staging run.
