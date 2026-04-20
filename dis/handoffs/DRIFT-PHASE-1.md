# Handoff — DRIFT-PHASE-1: Implement Phase 1 drift-prevention controls

- **Agent:** drift-implementer (Claude Opus 4.7)
- **Branch:** feat/dis-drift-impl
- **Worktree:** .claude/worktrees/drift-implementer
- **Date:** 2026-04-20
- **Duration:** ~45 minutes wall-clock
- **Spec:** `02_architecture/drift_prevention.md` §3 Controls 1, 2, 3, 7, 10

## 1. What was built

- `dis/scripts/check-pr-citations.mjs` — Control 1 (PR citation resolver).
- `dis/scripts/check-files-touched.mjs` — Control 2 (files_allowed allowlist).
- `dis/scripts/fitness-rules.json` — Control 3 declarative rules (7 seeded).
- `dis/scripts/fitness.mjs` — Control 3 engine (glob + forbidden-pattern scanner).
- `dis/scripts/check-forbidden-tokens.mjs` — Control 7 (TODO/FIXME/.only/.skip etc.).
- `dis/scripts/port-validator.mjs` — rewritten as 3-line wrapper delegating to fitness.mjs.
- `dis/scripts/__tests__/drift-controls.test.mjs` — pure-Node self-test harness.
- `dis/scripts/__tests__/fixtures/...` — synthetic trees for self-tests.
- `dis/scripts/README.md` — documents the 5 scripts + self-test.
- `.github/workflows/dis-ci.yml` — added 5 jobs: `citations`, `files-touched`, `fitness`, `forbidden-tokens`, `drift-controls-selftest`. All required (non-advisory).
- `radhakishan_system/docs/feature_plans/document_ingestion_service/08_team/review_gates.md` — Gate 5 amended with Control 10 (20%/100% sampling paragraph).

## 2. Acceptance status

- [x] Control 1 script + CI job → `check-pr-citations.mjs`; `citations` job.
- [x] Control 2 script + CI job → `check-files-touched.mjs`; `files-touched` job (PR-only).
- [x] Control 3 rules + engine + CI job → `fitness-rules.json` + `fitness.mjs`; `fitness` job.
- [x] Control 7 script + CI job → `check-forbidden-tokens.mjs`; `forbidden-tokens` job.
- [x] Control 10 paragraph added to Gate 5 verbatim.
- [x] Self-test harness passes 5/5.
- [x] port-validator.mjs delegates to fitness.mjs (backward compat).
- [x] All scripts are pure Node ESM; no external deps; no arbitrary eval; no network.

## 3. Decisions taken

### D-1: fitness.mjs uses its own minimal glob, not `globby`

**Context:** Phase 1 constraint — no external deps until DIS-001 lands package-lock.json.
**Decision:** Implemented a small glob→RegExp helper supporting `**`, `*`, `?`.
**Reason:** Rules are path-prefix + wildcard shapes; the full glob grammar is overkill.
**Revisit if:** DIS-001 completes and we want to replace with `globby` for richer patterns.

### D-2: check-pr-citations exits 0 when body has zero citations

**Context:** Control 1 text says "CI reads the PR body and verifies each citation." It does not explicitly require ≥1 citation.
**Decision:** Warn-and-pass when zero. Fail only when a _stated_ citation doesn't resolve.
**Reason:** Human reviewers can still reject uncited PRs at Gate 5; auto-failing zero-citation PRs would block draft/early PRs.
**Revisit if:** Wave 3 retrospective shows agents routinely skipping citations.

### D-3: Files-touched allowlist supports simple `*` globs

**Context:** `_ticket_template.md` currently shows literal file paths in `files_allowed:`. Some tickets may legitimately want `dis/tests/unit/foo/*.test.ts`.
**Decision:** Support `*` wildcards (not full glob). Literal paths still match.
**Reason:** Matches intent of the template without over-engineering.
**Revisit if:** Tickets start abusing broad wildcards to evade scope control.

### D-4: Forbidden-tokens excludes `__tests__`, `__fakes__`, and `*.test.ts`

**Context:** Drift-prevention §3 Control 7 explicitly exempts test files.
**Decision:** Walker skips those directories/suffixes entirely.
**Reason:** `.skip()` is legitimate during TDD (Gate 2 leaves tests skipped pending implementation).
**Revisit if:** The exemption proves too broad and skipped tests leak into production paths.

### D-5: port-validator.mjs is now a 3-line wrapper

**Context:** Task said "trivial to implement" → make it a wrapper; otherwise leave + note.
**Decision:** Wrapper (trivial — spawnSync fitness.mjs with `--only`).
**Reason:** Single source of truth in `fitness-rules.json`.

## 4. What was NOT done

- No tuning of the `core_no_sql_literals` rule to accommodate DIS-021's
  existing SQL literal pattern (see §5, follow-up).
- No Control 4, 5, 6, 8, 9, 11 (Phase 2, out of scope).
- No `ticket-file` autodetect — `check-files-touched.mjs` searches the
  four canonical ticket lists; rare custom ticket locations need
  `--ticket-file <path>`.

## 5. Follow-ups / known gaps

- **DIS-FOLLOWUP-A (suggested):** Refactor `dis/src/core/orchestrator.ts` to
  replace raw SQL literals (`'SELECT * FROM extractions WHERE id = $1'`)
  with named `DatabasePort` methods (e.g. `db.findById(id)`,
  `db.findByIdempotencyKey(key)`). Current tree has 5 `fitness.mjs`
  violations (4 in `orchestrator.ts`, 1 in `__fakes__/database.ts`) that
  pre-date this ticket. **Control 3 correctly catches these** — the
  original TDD §1 / coding_standards §2 say core does no raw SQL. This
  is genuine architectural drift already present in Wave 2.
  **Urgency M** — must be resolved before `fitness` becomes a blocking
  merge gate on any branch rebased from `feat/dis-plan` that includes
  DIS-021. Options: (a) land the refactor in Wave 3; (b) temporarily
  scope the SQL rule to exclude `__fakes__` and add an ADR-gated
  `// reason:` exemption on the four orchestrator lines; (c) split the
  SQL rule into `core_no_ddl` (block CREATE/DROP/ALTER only) and a
  Wave-3 strict rule.
- **DIS-FOLLOWUP-B (suggested):** Amend `_ticket_template.md`
  `files_allowed:` example to show a globbed entry so ticket authors
  know the feature exists. **Urgency S**.
- **DIS-FOLLOWUP-C (suggested):** Once `dis/package.json` exists, consider
  rewriting `fitness.mjs` in TypeScript with typed rule schema + unit
  tests via the repo's chosen test runner. **Urgency L**.

## 6. Files touched

- Added:
  - `dis/scripts/check-pr-citations.mjs`
  - `dis/scripts/check-files-touched.mjs`
  - `dis/scripts/fitness.mjs`
  - `dis/scripts/fitness-rules.json`
  - `dis/scripts/check-forbidden-tokens.mjs`
  - `dis/scripts/__tests__/drift-controls.test.mjs`
  - `dis/scripts/__tests__/fixtures/violating/dis/src/core/bad.ts`
  - `dis/scripts/__tests__/fixtures/violating/dis/scripts/fitness-rules.json`
  - `dis/scripts/__tests__/fixtures/tokens_raw/dis/src/core/raw.ts`
  - `dis/scripts/__tests__/fixtures/tokens_allowed/dis/src/core/allowed.ts`
  - `dis/handoffs/DRIFT-PHASE-1.md` (this file)
- Modified:
  - `dis/scripts/port-validator.mjs` (rewritten as wrapper)
  - `dis/scripts/README.md`
  - `.github/workflows/dis-ci.yml`
  - `radhakishan_system/docs/feature_plans/document_ingestion_service/08_team/review_gates.md`
- Deleted: none.

## 7. External dependencies introduced

None. All scripts use only Node built-ins (`node:fs`, `node:path`,
`node:child_process`, `node:url`).

## 8. Tests

- Tests added: 5 smoke cases in `drift-controls.test.mjs` (pure Node).
- Coverage: self-test covers fitness.mjs (violation path), check-forbidden-tokens.mjs (both raw + allow paths), check-pr-citations.mjs (both exist + not-exist paths). `check-files-touched.mjs` is not self-tested — it requires a real git worktree and a ticket with a `files_allowed:` block; covered by its first PR run.

## 9. Reproducing the work locally (VERIFY report — actual output)

### V1 — citation resolver accepts real TDD §

```
$ node dis/scripts/check-pr-citations.mjs --body "Implements TDD §4"; echo EXIT=$?
check-pr-citations: all 1 citation(s) resolved.
EXIT=0
```

Expected EXIT=0 ✓

### V2 — citation resolver rejects non-existent TDD §

```
$ node dis/scripts/check-pr-citations.mjs --body "Implements TDD §99.99"; echo EXIT=$?
check-pr-citations: broken citations:
  - TDD §99.99
EXIT=1
```

Expected EXIT=1 ✓

### V3 — fitness.mjs against current tree

```
$ node dis/scripts/fitness.mjs; echo EXIT=$?
dis/src/core/orchestrator.ts:128: [core_no_sql_literals] core must not contain raw SQL literals — "'SELECT * FROM extractions WHERE idempotency_key = $1',"
dis/src/core/orchestrator.ts:255: [core_no_sql_literals] core must not contain raw SQL literals — "'SELECT * FROM extractions WHERE id = $1',"
dis/src/core/orchestrator.ts:284: [core_no_sql_literals] core must not contain raw SQL literals — "'SELECT * FROM extractions WHERE id = $1',"
dis/src/core/orchestrator.ts:295: [core_no_sql_literals] core must not contain raw SQL literals — "'SELECT * FROM extractions WHERE id = $1',"
dis/src/core/__fakes__/database.ts:53: [core_no_sql_literals] core must not contain raw SQL literals — "if (s.startsWith('select') && s.includes('from extractions')) {"
fitness: 5 violation(s) across 7 rule(s).
EXIT=1
```

Expected EXIT=0 — **DIVERGENCE**. The team-lead VERIFY checklist assumed
Wave 2 already passed the new rules, but Control 3's `core_no_sql_literals`
rule — implemented exactly as specified in `drift_prevention.md` §3 —
catches five pre-existing raw SQL literals in DIS-021's orchestrator and
its in-memory fake. The rule is working as designed; the prior tree
violates it. See §5 DIS-FOLLOWUP-A for resolution options.

### V4 — forbidden tokens

```
$ node dis/scripts/check-forbidden-tokens.mjs; echo EXIT=$?
check-forbidden-tokens: clean (19 file(s) scanned).
EXIT=0
```

Expected EXIT=0 ✓

### V5 — self-test

```
$ node dis/scripts/__tests__/drift-controls.test.mjs; echo EXIT=$?
PASS: fitness.mjs flags violating fixture (exit=1)
PASS: check-forbidden-tokens flags raw TODO (exit=1)
PASS: check-forbidden-tokens honors lint-allow (exit=0)
PASS: check-pr-citations rejects non-existent TDD §99.99 (exit=1)
PASS: check-pr-citations accepts real TDD §4 (exit=0)

5/5 tests passed.
EXIT=0
```

Expected EXIT=0 ✓

### V6 — `citations` in dis-ci.yml

```
$ grep -c "citations" .github/workflows/dis-ci.yml
3
```

Expected ≥1 ✓

### V7 — `files-touched` in dis-ci.yml

```
$ grep -c "files-touched" .github/workflows/dis-ci.yml
2
```

Expected ≥1 ✓

### V8 — `fitness` in dis-ci.yml

```
$ grep -c "fitness" .github/workflows/dis-ci.yml
3
```

Expected ≥1 ✓

### V9 — `forbidden-tokens` in dis-ci.yml

```
$ grep -c "forbidden-tokens" .github/workflows/dis-ci.yml
2
```

Expected ≥1 ✓

### V10 — `20%` in review_gates.md

```
$ grep -c "20%" radhakishan_system/docs/feature_plans/document_ingestion_service/08_team/review_gates.md
1
```

Expected ≥1 ✓

### V11 — script count

```
$ ls dis/scripts/*.mjs | wc -l
5
```

Expected ≥5 ✓

## 10. Summary

10 of 11 VERIFY checks pass as expected. V3 surfaces a true-positive
Control 3 finding in the existing tree — see §5 DIS-FOLLOWUP-A. Phase 1
machinery is otherwise wired, CI jobs are required/blocking, self-tests
pass, and Gate 5 has the Control 10 paragraph. Ready for Wave 3
dispatch once FOLLOWUP-A is resolved (by refactor or scoped ADR-gated
exemption).
