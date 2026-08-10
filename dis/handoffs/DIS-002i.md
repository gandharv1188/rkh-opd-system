# Handoff — DIS-002i Widen DIS-021b files_allowed for DIS-001b-surfaced bugs

- **Agent:** Architect direct (Claude Opus 4.7, 1M), session 2026-04-21
- **Branch:** feat/dis-002i-widen-021b
- **Duration:** ~5 minutes
- **TDD refs:** n/a (meta backlog edit)
- **CS refs:** none

## 1. What was built

Widened DIS-021b's `files_allowed` list in `backlog.md` to include
two paths that DIS-001b §5 identified as belonging to DIS-021b's
scope but which weren't in the original DIS-021b entry authored by
DIS-002c:

- `dis/tsconfig.json` — fix the `rootDir: src` / `include:
tests/**/*.ts` inconsistency that blocks `tsc --noEmit`.
- `dis/tests/integration/health.test.ts` — one-line `.ts`→`.js`
  import fix, same bug class DIS-001b handled in `src/http/`.

Also corrected a markdown-escaping artefact where `__fakes__` had
rendered as `**fakes**` (stray double-asterisks interpreted as
bold), and added a clarifying note in the Out-of-scope line so
the teammate knows the authoritative path uses double-underscores.

Pre-Wave-B dispatch housekeeping. One-file edit.

## 2. Acceptance status

- [x] V1: backlog lists `tsconfig.json` in DIS-021b files_allowed
- [x] V2: backlog lists `tests/integration/health.test.ts` in DIS-021b files_allowed
- [x] V3: handoff exists

## 3. Files touched

- Modified: `dis/document_ingestion_service/07_tickets/backlog.md`
- Added: `dis/handoffs/DIS-002i.md`

## 4. Verify Report

### V1

- Command: `grep -c "dis/tsconfig.json" dis/document_ingestion_service/07_tickets/backlog.md`
- Expected: ≥ 1
- Actual: verified at commit time
- Status: PASS

### V2

- Command: `grep -c "tests/integration/health.test.ts" dis/document_ingestion_service/07_tickets/backlog.md`
- Expected: ≥ 1
- Actual: verified at commit time
- Status: PASS

### V3

- Command: `test -f dis/handoffs/DIS-002i.md && echo EXISTS`
- Expected: EXISTS
- Actual: EXISTS (this file)
- Status: PASS

## 5. Verdict

Complete. DIS-021b is now dispatchable to a teammate with the
correct `files_allowed` scope.
