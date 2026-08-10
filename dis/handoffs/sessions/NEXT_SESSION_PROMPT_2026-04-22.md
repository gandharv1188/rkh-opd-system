# Next-Session Pickup Prompt (authored 2026-04-22)

> Copy the body below verbatim into the next session's first message. It
> tells the next orchestrator exactly what to read, in what order, and
> what state to verify before acting.

---

You are resuming the Document Ingestion Service (DIS) build on the `radhakishan-prescription-system` repo. The prior orchestrator (Claude Opus 4.7) left a durable handover and orientation package for exactly this purpose. Read in the order below before doing anything else.

## 1. Fast orientation (read these IN ORDER, fully, not skim)

1. **`dis/handoffs/orientation/README.md`** — the synthesis index + 9 critical findings F1-F9 (note: F1 is now CLOSED, update as you read). ~200 lines.
2. **`dis/handoffs/sessions/SESSION_HANDOVER_2026-04-22.md`** — the most recent session's full record: what merged, what's queued, what's held, what gotchas were observed. ~760 lines. **This is your primary entry-point document.**
3. **`dis/handoffs/orientation/_meta/refresh-protocol.md`** — how to refresh orientation reports in-place after new work lands. ~140 lines.

Then read whichever of the six detailed reports is relevant to the slice you're working on:
- `dis/handoffs/orientation/01-overview-product.md` — product, clinical safety (CS-1..12), user stories, non-goals
- `dis/handoffs/orientation/02-architecture.md` — TDD, all ADRs (ADR-001..008), ports & adapters, portability
- `dis/handoffs/orientation/03-data-api-testing.md` — data model, OpenAPI, error model, test strategy
- `dis/handoffs/orientation/04-rollout-team-runbooks.md` — rollout, RACI, review gates, runbooks
- `dis/handoffs/orientation/05-tickets-handoffs.md` — epics, backlog, done log, session handovers
- `dis/handoffs/orientation/06-code-reality-audit.md` — docs-vs-code drift (was authored before Wave 3a/4 — partially stale; refresh per `_meta/refresh-protocol.md`)

## 2. Protocol docs (read before dispatching any teammate)

1. **`CLAUDE.md` §Agentic Team Management** (repo root) — the binding team protocol. Includes operating rules #27 (3-ticket cap, fresh teammates per wave, shutdown+respawn recovery) and #30 (`.progress.jsonl` checkpoints).
2. **`.claude/skills/windows-parallel-agents/SKILL.md`** — v3 worktree isolation protocol. READ FULLY before any parallel dispatch.
3. **`.claude/skills/windows-parallel-agents/prompt-template.md`** — the v3 hardened prompt prefix you MUST prepend to every teammate dispatch. Six placeholders to substitute.
4. **`.claude/skills/windows-parallel-agents/orchestrator-flow.md`** — step-by-step wave execution (pre-install deps commit → create worktrees → dispatch → monitor → merge → cleanup).
5. **`dis/document_ingestion_service/08_team/session_handoff.md`** — the 11-section ticket-handoff template every teammate must use. Gate 7 DoD.
6. **`dis/document_ingestion_service/08_team/agentic_dev_protocol.md`** — the end-to-end 9-phase process.
7. **`dis/document_ingestion_service/08_team/review_gates.md`** — Gates 1–7 definitions. Note: the user directive for this build is that Gate 6a (clinical safety sign-off) is **batched at end** rather than per-ticket blocking. 4 CS-tagged merges currently await one consolidated `CLINICAL APPROVED` (DIS-034 CS-1, DIS-036 CS-7, DIS-037 CS-10+11, DIS-038 CS-3).
8. **`dis/document_ingestion_service/05_testing/verify_format.md`** — VDT ticket shape + files_allowed + VERIFY blocks.
9. **`dis/document_ingestion_service/07_tickets/_ticket_template.md`** — the ticket template.
10. **`agentic-dev-playbook/README.md`** — 1,465-line playbook of everything learned in this build (PART A exercised, PART B unexercised). Skim the PART A section index; dive only where relevant.

## 3. Architecture spine (read if doing architectural work)

- `dis/document_ingestion_service/02_architecture/tdd.md` — the master design
- `dis/document_ingestion_service/02_architecture/adapters.md` — ports & adapters inventory
- `dis/document_ingestion_service/02_architecture/portability.md` — Supabase → AWS thesis
- `dis/document_ingestion_service/02_architecture/coding_standards.md`
- `dis/document_ingestion_service/02_architecture/drift_prevention.md`
- All 8 ADRs at `dis/document_ingestion_service/02_architecture/adrs/` — especially **ADR-008** which introduces `DocumentTextExtractorPort` and is the reason Wave 3b precedes Wave 5.

## 4. State at session start

- `feat/dis-plan` at `be759e9` (on both local and `origin/feat/dis-plan`). Confirm with `git log --oneline -1`.
- `origin/feat-dis-plan-snapshot-2026-04-21` — user's safe fallback, **do not touch**.
- `origin/main` — PR #1 open; untouched.
- Invariants: fitness 0 / 76 files, tsc exit 0, vitest **53 test files / 380 tests passing**.
- `dis/src/wiring/supabase.ts` + `dis/src/wiring/aws.ts` populated (F1 first half closed).
- `dis/migrations/M-001..M-008` with rollback pairs (F1 second half closed).
- No migration applied to any database yet — that's Wave 7.

Run this to confirm your starting state matches:

```
cd "E:/projects/AI-Enabled HMIS/radhakishan-prescription-system-folder/radhakishan-prescription-system"
git log --oneline -1
git status --short
git worktree list
node dis/scripts/fitness.mjs
(cd dis && npx tsc --noEmit && npx vitest run 2>&1 | tail -3)
```

## 5. What's ready to dispatch next

Per `SESSION_HANDOVER_2026-04-22.md §6`, the work queue in priority order:

**Priority 1 — Wave 3b (prerequisite for Wave 5):** ADR-008 deferred tickets. Order matters:

1. **DIS-058z** FIRST — authors `dis/src/ports/document-text-extractor.ts` + fake. Blocker for the rest.
2. **DIS-059** (rewritten) — `NativePdfTextAdapter` at `dis/src/adapters/document-text-extractor/native-pdf-text.ts`
3. **DIS-060** (rewritten) — `OfficeWordAdapter`
4. **DIS-061** (rewritten) — `OfficeSheetAdapter`
5. **DIS-059o** (new) — `OcrBridgeAdapter` that delegates to any `OcrPort` implementation

All 5 tickets are Ready in `dis/document_ingestion_service/07_tickets/backlog.md` (DIS-058z around line 1465; rewrites of DIS-059/060/061 + DIS-059o directly after).

**Priority 2 — Wave 5 Epic D (HELD pending user go-ahead):** DIS-090..110 — HTTP endpoints (/ingest, /extractions/:id, /approve, /reject, /retry, /admin/metrics, /internal/process-job, /internal/datalab-webhook) + kill-switch middleware per ADR-003 + end-to-end HTTP test. About 21 tickets, dispatch as 2 sub-waves of 3-4 teammates. **Do not dispatch without explicit user go-ahead.**

**Priority 3 — Waves 6 and 7:** Verification UI (Epic E, ~26 tickets, 3 sub-waves) and Observability + Staging migrations (Epic F, ~31 tickets, 3 sub-waves). Wave 7 applies M-001..M-008 to a staging Supabase project — needs user confirmation on which project to point at.

**Priority 4 — Wave 8 STOP:** Refresh orientation reports in-place per `_meta/refresh-protocol.md`, author the consolidated Gate 6a CS-tag batch sign-off request for the user (list every CS-tagged merge from this build with evidence), write session handover, push, **STOP before Epic G**. User reviews, issues one `CLINICAL APPROVED`, then Epic G integration.

**Priority 0 — Absolute hold:** Epic G (DIS-200..209) remains on integration hold. User is the gatekeeper. Do not pull any Epic G ticket.

## 6. Follow-up tickets registered but not scheduled

Documented in `SESSION_HANDOVER_2026-04-22.md §5`. Land opportunistically or fold into their natural wave:

- DIS-025a (idempotency SQL → named DatabasePort methods)
- DIS-002l (stale 10_handoff refs in 8 out-of-scope meta/orientation files)
- DIS-002m (VERIFY-3 expected-string fix in DIS-002k)
- DIS-007-followup (openapi.yaml 503/UNAVAILABLE declaration for ADR-003 compliance)
- DIS-058a-platforms-followup (HEIC decode on Linux CI)
- DIS-058b-followup (full Hough deskew)
- DIS-058c-followup (true 4-corner homography warp)
- DIS-079-followup-d (DATABASE_URL via SecretsPort)
- DIS-079-followup-wire-siblings (wire Wave-3a adapters into createSupabasePorts)

## 7. Your first actions in the next session (DO THIS FIRST)

1. Read orientation README + SESSION_HANDOVER_2026-04-22 (step 1 above).
2. Run the verification block in §4 to confirm state matches.
3. Run the orientation refresh protocol: `git log --name-only be759e9..HEAD -- <source_paths>` per report. Most reports will be current. Update `06-code-reality-audit.md` to reflect Wave 3a + Wave 4 additions (new `src/wiring/`, new `src/adapters/queue/`, `src/adapters/secrets/`, `src/adapters/preprocessor/stages/`, new `migrations/`, new `src/core/` utilities from Wave 2a).
4. Ask the user whether to (a) proceed with Wave 3b, (b) issue the consolidated Gate 6a clinical sign-off request first, or (c) both in parallel. Do not dispatch Wave 5 without explicit go-ahead.
5. When dispatching, follow `CLAUDE.md §Agentic Team Management` + `windows-parallel-agents` protocol exactly. Use the v3 hardened prompt prefix. Include the `.progress.jsonl` checkpoint rule in every brief. Max 3 tickets per teammate. Fresh teammates per wave.

## 8. Known behaviors to ignore

- **Late idle notifications** from teammates after their shutdown-approved — ignore silently per `SESSION_HANDOVER_2026-04-20.md §13 gotcha 6`.
- **`task-list` auto-dispatch** poking already-assigned or already-shutdown teammates with unrelated Task items — ignore; clear the `owner` field on `TaskUpdate` after teammate shutdown.
- **Windows `git worktree remove --force` "Filename too long"** — safe to ignore; branch is deleted, directory is gitignored.

## 9. User directives that supersede defaults

- **Gate 6a clinical sign-off is BATCHED at end**, not per-ticket blocking. CS-tagged tickets merge during the wave with a note; one consolidated `CLINICAL APPROVED` before Epic G covers all of them.
- **Snapshot branch `origin/feat-dis-plan-snapshot-2026-04-21` is an explicit safe fallback.** Do not delete, modify, or push to it.
- **Auto mode is active** unless the user says otherwise — proceed autonomously on low-risk work, confirm before destructive actions.
- **Context self-monitoring**: write the session handover when approaching ~70% context. Finish the current wave before stopping; do not stop mid-wave.
- **Playbook is the durable operations manual.** When a new operating rule surfaces, append it to `CLAUDE.md §Agentic Team Management` + `agentic-dev-playbook/README.md`.

Acknowledge you've read the above, run the §4 verification block, then ask the user for direction on priority 1 vs 2 vs the clinical sign-off batch. Do not start work before acknowledgement.
