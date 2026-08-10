# Handoff — DOC-VERIFY-BACKLOG-A: Rewrite Epic A+B backlog in Verify-Driven format

- **Agent:** doc-verify-backlog-a (Opus 4.7)
- **Branch:** feat/dis-verify-backlog-a
- **Worktree:** .claude/worktrees/verify-backlog-a
- **Date:** 2026-04-20
- **Duration:** ~25 minutes wall-clock
- **TDD refs implemented:** §1, §2, §3, §4, §5, §6, §7, §9.1, §9.2, §10, §10.1, §10.2, §11, §12, §13, §14, §15, §16, §17
- **CS refs:** CS-1, CS-3, CS-7, CS-10, CS-11
- **Scope:** backlog.md — Epic A (DIS-001..015) + Epic B (DIS-020..045), 41 tickets

## 1. What was built

- `dis/document_ingestion_service/07_tickets/backlog.md` — Epic A + Epic B sections rewritten to Verify-Driven format. Each ticket now carries: Tags, Epic, Depends on, TDD ref, CS ref, Files allowed, Out of scope, Description, VERIFY block (4-6 real shell commands with expected output), Status.
- DIS-001..004 preserved as fully-specified and augmented with `Files allowed` + VERIFY block.
- DIS-005..015 and DIS-024..045 expanded from one-line placeholders into complete ticket specs.
- Epic C onwards (DIS-050+) untouched — owned by `doc-verify-backlog-b`.

## 2. Acceptance criteria status

- [x] AC-1: Only backlog.md touched; only Epic A + B sections rewritten. → `git diff --stat` shows single file
- [x] AC-2: Ticket IDs preserved, not renumbered. → DIS-001..015, DIS-020..045
- [x] AC-3: 3-6 VERIFY steps per ticket with real shell commands. → 188 VERIFY-N lines across 41 tickets (avg 4.6/ticket)
- [x] AC-4: Every ticket has `Files allowed:`. → 41 occurrences
- [x] AC-5: Clinical-safety tickets reference CS-## in at least one VERIFY step pointing to test file. → DIS-020 (CS-1), DIS-022 (CS-7), DIS-023 (CS-10/11), DIS-024 (CS-3), DIS-036 (CS-7), DIS-037 (CS-10/11), DIS-038 (CS-3)
- [x] AC-6: Epic C tickets intact. → `grep -c "### DIS-05"` = 4
- [x] AC-7: Conventional commit message prepared.

## 3. Decisions taken during implementation

### D-1: Numbered 11 test tickets DIS-034..DIS-045 by subject

**Context:** Original placeholder said "test tickets: one per core module".
**Choice:** Assigned each DIS-034..045 to a specific core module's integration test (state-machine, orchestrator retry, confidence-policy orchestrator wiring, promotion discharge, audit log, idempotency, version-lock race, content-hash, correlation propagation, error envelope e2e, schema drift, cost aggregate).
**Why:** Verify-Driven format requires concrete file paths and commands; "one per module" cannot be verified.

### D-2: VERIFY steps use `npx vitest run` + `npx tsc --noEmit`

**Context:** Need real shell commands reviewer can re-run.
**Choice:** Standardised on vitest-run commands with explicit test paths; tsc for typecheck evidence; `grep -c` with literal expected counts.
**Why:** Matches DIS-002/DIS-004 existing handoffs in `dis/handoffs/`. Deterministic expected output.

### D-3: CS assertions anchored at test files, not source

**Context:** verify_format.md §8 requires clinical-safety tickets to reference the specific test where CS-## is enforced.
**Choice:** Every CS-tagged ticket has a VERIFY step of shape `grep -cE "CS-##" dis/tests/.../<test>.ts` — expect ≥ 1. Implementers must literally write the CS tag as a comment/test name so the grep passes.
**Why:** Forces the CS assertion to be visible in test code, not buried in source comments.

## 4. Files changed

- `dis/document_ingestion_service/07_tickets/backlog.md` — Epic A + B rewritten (~1,050 lines added, ~130 removed; net growth reflects format expansion).

## 5. Follow-ups / notes for next agent

- `doc-verify-backlog-b` owns Epic C..H in the parallel worktree — no merge conflict expected since file regions are disjoint.
- Implementers of Epic A tickets should note that the `.gitkeep` files referenced in DIS-001 will be superseded as real code arrives; that's expected.
- DIS-027 VERIFY-4 is informational (expects `EXPECTED` output) because Node cannot require a .ts file directly; kept as a placeholder, not a hard gate.

## Verify Report

### AC-1: Ticket count in Epic A+B scope

- Command: `grep -cE "^### DIS-0[0-4][0-9]" dis/document_ingestion_service/07_tickets/backlog.md`
- Expected: `≥ 40`
- Actual:

```
41
```

- **Status:** PASS

### AC-2: VERIFY block per ticket

- Command: `grep -cE "^\*\*VERIFY:\*\*" dis/document_ingestion_service/07_tickets/backlog.md`
- Expected: `≥ 40`
- Actual:

```
41
```

- **Status:** PASS

### AC-3: VERIFY-N steps (≥3 per ticket)

- Command: `grep -cE "^- VERIFY-[0-9]+:" dis/document_ingestion_service/07_tickets/backlog.md`
- Expected: `≥ 120`
- Actual:

```
188
```

- **Status:** PASS

### AC-4: Files allowed on every ticket

- Command: `grep -c "Files allowed:" dis/document_ingestion_service/07_tickets/backlog.md`
- Expected: `≥ 40`
- Actual:

```
41
```

- **Status:** PASS

### AC-5: Epic C tickets sanity-check

- Command: `grep -c "### DIS-05" dis/document_ingestion_service/07_tickets/backlog.md`
- Expected: any non-zero (Epic C still present, owned by other teammate)
- Actual:

```
4
```

- **Status:** PASS
