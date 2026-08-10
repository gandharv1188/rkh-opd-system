# Session Execution Plan — 2026-04-21

> Session-level delta only. Epic / ticket / backlog content lives in
> `07_tickets/backlog.md`, `07_tickets/epics.md`,
> `02_architecture/drift_prevention.md` etc. This plan cites them
> rather than repeating.

## Rewind required

Two protocol-bypass commits on `feat/dis-plan` from 2026-04-20
(`7049840`, `96e7006`) must be rewound via `git reset --soft HEAD~2`
before any ticket-driven work proceeds. Both are local-only (unpushed)
so no remote impact. Their file changes become the working material
for proper tickets below. **Awaiting user approval before running
the reset.**

## Blocking gate

`fitness.mjs` currently fails on 5 `core_no_sql_literals` violations
in `orchestrator.ts` + `__fakes__/database.ts` (DRIFT-PHASE-1 handoff
§5 DIS-FOLLOWUP-A, re-verified 2026-04-21). No new PR can pass CI
until this is resolved. Resolution options already documented there;
I propose **option (a)** — extract named DatabasePort methods
(`findById`, `findByIdempotencyKey`, `updateStatus`). This is the same
scope as the DIS-020/021 reconciliation so it folds into DIS-021b.

## New tickets to draft this session

Appending to `07_tickets/backlog.md` in a single doc-only commit
tagged DIS-002c. Each follows Verify-Driven format per
`_ticket_template.md`.

| ID       | Summary                                                                                                                                                                                     | Tags                             | Parent rationale                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| DIS-002c | Append session-plan tickets to backlog (this ticket)                                                                                                                                        | `doc-only`, `process`            | meta — registers the new tickets so CI's files-touched check can recognise them             |
| DIS-002d | Scaffold hygiene: adrs/ + clarifications/ folders, done.md backfill, stale-ref fix                                                                                                          | `doc-only`, `process`            | DIS-002 owns the drift-control infrastructure that assumes these folders exist              |
| DIS-002e | ADR pack: ADR-001 hexagonal, ADR-002 Datalab hosted→self-host, ADR-003 kill-switch 503, ADR-004 Datalab webhooks over polling, ADR-005 Hono, ADR-006 postgres driver, ADR-007 Haiku default | `doc-only`, `architecture`       | fills the ADR folder created by DIS-002d; satisfies coding_standards §15 + drift Control 9  |
| DIS-001b | Merge DEPS_REQUIRED.md → package.json, add @anthropic-ai/sdk, fix `.ts`→`.js` in src/http/                                                                                                  | `core`, `infra`                  | DIS-001 owns package.json; DEPS_REQUIRED.md explicitly defers merge to integration time     |
| DIS-021b | Reconcile state-machine event-kinds; route pipeline transitions through `transition()`; extract named DatabasePort methods (clears 5 fitness violations)                                    | `core`, `clinical-safety` (CS-1) | DIS-021 handoff §5 flagged COORDINATION_REQUIRED; DRIFT-PHASE-1 §5 blocker resolved same PR |
| DIS-050a | Datalab adapter hotfix: `output_format` join, drop `langs`, 300s max-wait, 429 → RateLimited, `skipCache`, `webhook_url` per ADR-004                                                        | `adapter`                        | direct follow-up to DIS-050 (document_ocr_flow.md §13)                                      |

## Execution waves

**Wave A — architect-direct, sequential, this session:**

1. DIS-002c (write the tickets above into backlog)
2. DIS-002d (scaffold hygiene — this is where commits 7049840 +
   96e7006 get redone properly, + done.md backfill +
   clarifications/README)
3. DIS-002e (ADR pack — 7 ADRs, one commit per ADR so git blame is
   per-decision)
4. DIS-001b (deps merge + `.ts`→`.js` fix)

Each ticket gets its own branch `feat/dis-<id>-<slug>`, own handoff
at `dis/handoffs/DIS-<id>.md`, own VERIFY report with pasted
actual output. Architect-direct is legitimate for these per
`RACI.md` (all `doc-only` / `infra`, no CS tag except that DIS-001b's
VERIFY will demonstrate the typecheck failure that justifies
DIS-021b).

**Wave B — teammate-dispatched, parallel, next session:**

5. DIS-021b + DIS-050a in parallel under v3 windows-parallel-agents
   protocol. `TeamCreate dis-squad`, two worktrees, 15-min
   CronCreate health check. DIS-021b needs Gate 6a clinical
   sign-off (CS-1).

Dependency: Wave B cannot start until Wave A merges because
DIS-021b + DIS-050a both need `npm install` working (DIS-001b) and
ADR-004 decisions (DIS-002e).

## Open questions blocking Wave A start

1. **OK to `git reset --soft HEAD~2` on `feat/dis-plan`** to rewind
   commits 7049840 + 96e7006? (Local-only, no remote impact.)
2. **OK with the six ticket IDs** DIS-001b / DIS-002c / DIS-002d /
   DIS-002e / DIS-021b / DIS-050a?
3. **OK with proposed ADR-003 = 503 UNAVAILABLE** (resolving the
   kill-switch doc conflict)?
4. **OK with proposed ADR-004 = Datalab webhooks** (confirming
   user's earlier preference)?
5. **OK with proposed fitness-violation resolution = option (a)**
   (extract named DatabasePort methods — folded into DIS-021b)?

On approval of all five, I start Wave A with DIS-002c.
User response: Approved with all five
