# Ticket Board — Document Ingestion Service

This folder is the agentic execution backlog. Every piece of work lives
as a ticket. The Architect (Claude orchestrator) creates tickets;
worker agents execute them under the review gates defined in
`08_team/review_gates.md`.

## Layout

```
07_tickets/
├── README.md                  (this file)
├── epics.md                   (A..H — high-level groupings)
├── backlog.md                 (DIS-### tickets, full text)
├── in_progress.md             (what's currently being worked on)
├── done.md                    (completed tickets; append-only log)
├── blocked.md                 (waiting on clarification / dependencies)
├── integration_hold.md        (tickets gated on user integration approval)
└── clarifications/
    └── CLAR-###.md            (one file per open clarification)
```

## Ticket lifecycle

```
Drafted (Architect)
   │
   ▼
Ready   (Gate 1 passed — pre-start)
   │
   ▼
In Progress (Test-first committed — Gate 2 passed)
   │
   ├── → Blocked (dependency / clarification)
   │       │
   │       └── → Ready (once unblocked)
   │
   ▼
In Review (PR open, Gates 4 + 5 running)
   │
   ▼
Conditional Review (Gate 6 — safety / integration / security / breaking)
   │
   ▼
Done (Gate 7 — DoD checked, merged)
```

## Ticket ID scheme

- `DIS-###` — sequential, never reused.
- `CLAR-###` — clarifications.
- `ADR-###` — architecture decision records (under `02_architecture/adrs/`).

## Tag reference

| Tag               | Meaning                                                                  | Special gate                         |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| `core`            | Changes to `dis/src/core/` or `dis/src/ports/`                           | —                                    |
| `adapter`         | Changes inside `dis/src/adapters/`                                       | —                                    |
| `ui`              | Changes to verification UI (new files under `dis/ui/`)                   | —                                    |
| `migration`       | SQL migration                                                            | Gate 6d (breaking) if destructive    |
| `test`            | Test-only ticket                                                         | Still requires Gate 4 + 5            |
| `doc-only`        | Documentation / runbook                                                  | Skips Gate 2 (test-first)            |
| `clinical-safety` | Implements CS-1..CS-12                                                   | Gate 6a (clinical reviewer)          |
| `integration`     | **Touches existing system** (web/, existing Edge Functions, live schema) | **Gate 6b — user approval required** |
| `security`        | Auth / secrets / RLS                                                     | Gate 6c                              |
| `breaking`        | Port interface or schema break                                           | Gate 6d                              |
| `infra`           | CI, deploy, secrets, monitoring                                          | —                                    |

## The integration hold rule (binding)

**No ticket in `integration_hold.md` may be pulled into `in_progress` without
an explicit `INTEGRATION APPROVED` note from the Integration Gatekeeper
(Dr. Lokender Goyal) in the ticket thread.**

This is the enforcement of the "no integration until we say so" rule.
Tickets tagged `integration` are parked in `integration_hold.md` as soon
as they are drafted. Agents cannot pick them up.

## Working an agent wave

1. Architect selects N tickets that are `Ready` and have no unmet dependencies.
2. Architect ensures none are in `integration_hold.md`.
3. Architect pre-installs any shared deps (per the
   `windows-parallel-agents` skill's orchestrator flow, step 1).
4. Architect creates one worktree per selected ticket (step 2 of the skill).
5. Architect dispatches agents with the v3 hardened prefix + ticket brief.
6. Architect merges agent branches sequentially after verification.
7. Architect updates `done.md` and moves dependent tickets to `Ready`.

## Ownership of this board

The Architect owns the backlog. Worker agents do NOT edit `epics.md`,
`backlog.md`, or the status lists — they only touch files inside
`dis/` per their ticket brief. Status transitions happen when the
Architect merges their branch.

## Verify-Driven Ticketing

Every DIS ticket ends with a numbered `VERIFY-N` block of
copy-pasteable shell commands, each with a literal expected output (or
regex) and a one-line pass criterion. Prose acceptance criteria are
not accepted — if a criterion cannot be reduced to a shell command
with a deterministic output, it is restated or split until it can.
Reviewers re-run the VERIFY steps verbatim; any drift between the
command output pasted in the handoff and the reviewer's re-run is a
Gate 5 failure. The template also requires an exhaustive
`files_allowed` list; any PR that writes outside that list is rejected
by CI (enforced from Wave 3+).

This format composes cleanly with the other controls. Test-first
(Gate 2) proves the code meets its own unit tests; VERIFY proves the
ticket met its acceptance conditions; the session handoff (see
[`../08_team/session_handoff.md`](../08_team/session_handoff.md) §3)
captures the actual pasted outputs so a reviewer — or a future agent
resuming cold — has a single artifact that is both reproducible and
auditable. Combined with the Phase 1 drift-prevention controls
arriving in Wave 3 (see
[`../02_architecture/drift_prevention.md`](../02_architecture/drift_prevention.md)),
Verify-Driven Ticketing is what keeps multi-agent waves honest: no
ticket claims "done" without machine-checkable evidence, and no agent
silently widens its blast radius beyond `files_allowed`. Binding spec:
[`../05_testing/verify_format.md`](../05_testing/verify_format.md).
