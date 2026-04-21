# DIS-021c — Session Handoff

**Branch:** `feat/dis-021c`
**Worktree:** `.claude/worktrees/dis-021c`
**Parent:** `feat/dis-plan`
**Date:** 2026-04-20
**Scope:** 2 of 3 original fixes (Fix 1 deferred to DIS-021d by orchestrator decision after STOP-report).

---

## 1. What was built

DIS-021c was scoped as three regression fixes against DIS-021b:

1. **Fix 1 (DEFERRED to DIS-021d):** Restore full typecheck surface in `dis/tsconfig.json` by removing the DIS-021b defensive excludes.
2. **Fix 2 (LANDED):** Lock vitest test discovery via a new `dis/vitest.config.ts` so the pure-Node harness `dis/scripts/__tests__/drift-controls.test.mjs` is no longer collected by vitest's default glob and misreported as a test failure.
3. **Fix 3 (LANDED):** Make `dis/scripts/check-pr-citations.mjs` and `dis/scripts/check-files-touched.mjs` cwd-independent by deriving `DOCS` from `fileURLToPath(import.meta.url)` + `dirname` rather than the cwd-relative `resolve('dis/document_ingestion_service')`.

Fix 1 was attempted first (targeted diff applied, `npm install`, `npx tsc --noEmit`) and surfaced **17 type errors across 8 files that are outside DIS-021c's `files_allowed`.** Per the ticket's explicit STOP-and-report clause ("If you discover that fixing a previously-excluded file requires a real code-correctness change in core/adapter source, STOP and report — that's outside DIS-021c and needs its own ticket"), work was halted, orchestrator was messaged, and Option B (split) was approved. Fix 1 was reverted via `git checkout HEAD -- dis/tsconfig.json`; the tsconfig remains at DIS-021b's aggressive-excludes shape. A typecheck-surface regression is explicitly accepted until DIS-021d.

## 2. Files created/edited

- **Edited** `dis/vitest.config.ts` (new file) — pins `test.include` to `tests/**/*.test.ts`; excludes `scripts/**`, `node_modules/**`, `dist/**`, `.claude/**`.
- **Edited** `dis/scripts/check-pr-citations.mjs` — replaced `resolve('dis/document_ingestion_service')` with script-location-relative resolution via `fileURLToPath(import.meta.url)`.
- **Edited** `dis/scripts/check-files-touched.mjs` — same fix.
- **Created** `dis/handoffs/DIS-021c.md` — this file.

Not edited (Fix 1 reverted): `dis/tsconfig.json` remains unchanged at HEAD.

## 3. Design decisions worth flagging

- **vitest scripts exclude is explicit, not relying on `include`-only filtering.** The `include` glob `tests/**/*.test.ts` already excludes `scripts/**`, but defense-in-depth matters: if a future contributor runs `vitest run dis/scripts/...` by path, the exclude will still prevent the harness being consumed as a test file.
- **DOCS resolution uses `resolve(__dirname, '..', 'document_ingestion_service')` — not `join`.** `resolve` normalises the absolute path and is what was used elsewhere in the file already; keeping the import surface identical (`resolve` + `dirname` + `fileURLToPath`) minimises the diff.
- **Option B over Option C.** The tempting middle path — keep a minimal exclude covering only the four known-broken paths — was rejected because the ticket's target-state is "no source-file exclusions remain beyond node_modules + dist." Half-measuring it would just shift the debt.

## 4. What changed vs the ticket brief

- **Fix 1 scope removed.** Orchestrator approved Option B after STOP-report.
- **Commit subject revised** from `core+infra(DIS-021c): …` to `infra(DIS-021c): lock vitest discovery + cwd-independent DOCS in CI scripts (Fix 1 deferred to DIS-021d)` — no `core` tag since no `src/core/` change ships.
- **Gate 2 note in original brief became moot** — vitest now passes cleanly with the fix applied; no surviving "failing test" from DIS-021b.
- **VERIFY block trimmed** from 10 to 7 (see §5). V1–V3 referenced Fix 1 and are not applicable.

## 5. Verify Report

All 7 VERIFY commands run from worktree root unless noted.

### VERIFY-1 — `cd dis && npx vitest run 2>&1 | tail -15`

```
 ✓ tests/unit/state-machine.test.ts (22 tests) 10ms
 ✓ tests/unit/confidence-policy.test.ts (18 tests) 10ms
 ✓ tests/unit/audit-log.test.ts (7 tests) 9ms
 ✓ tests/unit/adapters/preprocessor.test.ts (6 tests) 10ms
 ✓ tests/unit/adapters/claude-haiku.test.ts (6 tests) 16ms
 ✓ tests/unit/adapters/supabase-storage.test.ts (9 tests) 21ms
 ✓ tests/unit/adapters/file-router.test.ts (11 tests) 8ms
 ✓ tests/unit/orchestrator.test.ts (14 tests) 19ms
 ✓ tests/integration/health.test.ts (3 tests) 60ms

 Test Files  12 passed (12)
      Tests  124 passed (124)
   Start at  11:46:15
   Duration  1.14s (transform 1.08s, setup 0ms, collect 1.82s, tests 198ms, environment 4ms, prepare 2.03s)
```

`drift-controls.test.mjs` is NOT in the discovered set — confirmed by the absence of `scripts/__tests__/` paths in the output. 12 test files, 124 passing.

### VERIFY-2 — `node dis/scripts/__tests__/drift-controls.test.mjs`

```
PASS: fitness.mjs flags violating fixture (exit=1)
PASS: check-forbidden-tokens flags raw TODO (exit=1)
PASS: check-forbidden-tokens honors lint-allow (exit=0)
PASS: check-pr-citations rejects non-existent TDD §99.99 (exit=1)
PASS: check-pr-citations accepts real TDD §4 (exit=0)

5/5 tests passed.
```

Harness still runnable directly via `node`.

### VERIFY-3 — `node dis/scripts/check-pr-citations.mjs --body "Implements TDD §4 and CS-1"` (repo root cwd)

```
check-pr-citations: all 2 citation(s) resolved.
exit=0
```

### VERIFY-4 — `cd dis && node scripts/check-pr-citations.mjs --body "Implements TDD §4 and CS-1"` (dis cwd)

```
check-pr-citations: all 2 citation(s) resolved.
exit=0
```

### VERIFY-5 — `cd dis/scripts && node check-pr-citations.mjs --body "Implements TDD §4 and CS-1"` (scripts cwd)

```
check-pr-citations: all 2 citation(s) resolved.
exit=0
```

V3/V4/V5 together prove the cwd-independent DOCS resolution works from all three canonical launch locations.

### VERIFY-6 — `node dis/scripts/fitness.mjs`

```
fitness: no violations (7 rule(s), 47 file(s) scanned).
```

Unchanged from pre-DIS-021c.

### VERIFY-7 — `test -f dis/handoffs/DIS-021c.md && echo EXISTS`

`EXISTS` (this file).

## 6. Risks & follow-ups

**DIS-021d (successor ticket, Urgency: M):** Restore full typecheck surface. Inventory of the 17 TS errors that surfaced when Fix 1 was applied:

| #    | File                                                      | Error (abbrev.)                                                                                                                                                        |
| ---- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `src/adapters/database/__fakes__/supabase-postgres.ts:17` | TS2420: `FakeSupabasePostgresAdapter` missing `findExtractionById`, `findExtractionByIdempotencyKey`, `updateExtractionStatus`, `insertExtraction` from `DatabasePort` |
| 2    | `src/adapters/database/__fakes__/supabase-postgres.ts:41` | TS2345: `this` not assignable to `DatabasePort` (same 4 missing)                                                                                                       |
| 3    | `src/adapters/database/supabase-postgres.ts:86`           | TS2420: `SupabasePostgresAdapter` missing same 4 methods                                                                                                               |
| 4    | `src/adapters/database/supabase-postgres.ts:116`          | TS2345: adapter not assignable to `DatabasePort`                                                                                                                       |
| 5    | `src/adapters/storage/__fakes__/supabase-storage.ts:80`   | TS2345: `Buffer<ArrayBufferLike>` not assignable to `BodyInit`                                                                                                         |
| 6    | `src/adapters/storage/supabase-storage.ts:73`             | TS2769: fetch overload, `Buffer` not assignable to `BodyInit`                                                                                                          |
| 7    | `src/http/server.ts:26`                                   | TS2345: `Hono<{ Variables: AppVariables }>` not assignable to `Hono<BlankEnv>` (Hono generics context mismatch)                                                        |
| 8–14 | `src/ports/index.ts:23,33,44,46,48,50,52,60`              | TS2835: NodeNext needs explicit `.js` extensions — `./ocr`, `./structuring`, `./storage`, `./database`, `./queue`, `./secrets`, `./file-router`, `./preprocessor`      |
| 15   | `tests/unit/audit-log.test.ts:10`                         | TS2420: `FakeDatabase` missing same 4 methods                                                                                                                          |
| 16   | `tests/unit/audit-log.test.ts:24`                         | TS2739: inline test DB missing same 4 methods                                                                                                                          |
| 17   | `tests/unit/audit-log.test.ts:60`                         | TS2345: `FakeDatabase` not assignable to `DatabasePort`                                                                                                                |

Root causes grouped:

- **RC-A (findings 1–4, 15–17):** `DatabasePort` gained 4 extraction-lifecycle methods (likely in DIS-020/021 state-machine work) that were NOT propagated to the adapter, fake adapter, or the test-fixture `FakeDatabase` in `audit-log.test.ts`. DIS-021b's assertion that these were "resolved in `src/core/`" was incorrect — the port contract leaked outward and adapters never caught up.
- **RC-B (findings 5–6):** Node 24 `@types/node` narrowed `BodyInit` to exclude `Buffer<ArrayBufferLike>`. Package engine is pinned to Node 20 so CI should be green; local dev on Node 24 will trip this. DIS-021d should convert `Buffer` → `Uint8Array` at the fetch boundary, or cast with a narrow helper.
- **RC-C (findings 8–14):** `src/ports/index.ts` is a pure re-export barrel; NodeNext requires explicit `.js` extensions on relative imports. Mechanical fix, 7 lines.
- **RC-D (finding 7):** `src/http/server.ts` instantiates a Hono app with `AppVariables` context but a caller expects `BlankEnv`. Requires generic plumbing fix at the call site.

**Wave C Epic A not blocked:** none of the surfaced errors affect files currently in scope for pending Wave C tickets, because the tsconfig remains permissive.

**No other risks** introduced by DIS-021c itself; the vitest and DOCS fixes have zero production-path blast radius.

## 7. Test-first (Gate 2) note

Vitest was already green on main post-DIS-021b merge for the `tests/**` suite proper, but the post-merge sanity run exposed that vitest was _also_ discovering and failing on the `drift-controls.test.mjs` pure-Node harness. DIS-021c's `vitest.config.ts` addresses this without modifying any test file — the harness was always intended to run via `node`, not via vitest. VERIFY-1 demonstrates the now-clean run; VERIFY-2 demonstrates the harness still passes under its intended runner.

No new tests authored — DIS-021c is infra-only.

## 8. Session stats

- Commits: 1
- Files changed: 4 (3 code + 1 handoff)
- Lines changed: ~20 across code files
- Tool iterations: ~15 (including STOP-and-report cycle)
- Real-time duration: ~30 min (including orchestrator turnaround on Option B)

## 9. Next ticket handoff target

**DIS-021d** — Restore full typecheck surface. Inventory and root causes above. `files_allowed` must include at minimum:

- `dis/tsconfig.json`
- `dis/src/ports/index.ts`
- `dis/src/adapters/database/supabase-postgres.ts`
- `dis/src/adapters/database/__fakes__/supabase-postgres.ts`
- `dis/src/adapters/storage/supabase-storage.ts`
- `dis/src/adapters/storage/__fakes__/supabase-storage.ts`
- `dis/src/http/server.ts`
- `dis/tests/unit/audit-log.test.ts`
- `dis/src/ports/database.ts` (likely — to cross-check the `DatabasePort` contract)
- `dis/handoffs/DIS-021d.md`

Orchestrator will register DIS-021d in backlog.

## 10. Merge checklist

- [x] VERIFY-1 through VERIFY-7 pass, output pasted above.
- [x] `files_allowed` respected — diff limited to `dis/vitest.config.ts`, `dis/scripts/check-pr-citations.mjs`, `dis/scripts/check-files-touched.mjs`, `dis/handoffs/DIS-021c.md`.
- [x] No writes to main repo; worktree isolation verified with `rev-parse --show-toplevel` at pre-commit sanity check.
- [x] Handoff includes DIS-021d follow-up inventory.
- [ ] Orchestrator to land DIS-021c and dispatch DIS-021d.

## 11. Links

- Backlog entry: `dis/document_ingestion_service/07_tickets/backlog.md` → `### DIS-021c`
- Predecessor: `dis/handoffs/DIS-021b.md`
- Session handoff protocol: `dis/document_ingestion_service/08_team/session_handoff.md §3`
- TDD §1, §14; coding_standards.md §1, §11 (typecheck is not optional — Fix 1 defers satisfying §1 to DIS-021d; escalated explicitly)
- verify_format.md §2
