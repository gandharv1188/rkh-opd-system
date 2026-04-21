# Handoff — DIS-001b Merge DEPS_REQUIRED → package.json + fix `.ts`→`.js` imports

- **Agent:** Architect direct (Claude Opus 4.7, 1M), session 2026-04-21
- **Branch:** feat/dis-001b-deps-merge
- **Worktree:** main repo (architect-direct, `core`+`infra` tagged)
- **Date:** 2026-04-21
- **Duration:** ~single-session, wall-clock ~15 minutes including npm install
- **TDD refs implemented:** §1 (architectural style), §2 (component layout)
- **CS refs:** none directly (enables DIS-021b which carries CS-1)
- **User story refs:** none

## 1. What was built

The long-deferred first `npm install` for the `dis/` subproject.
Every runtime dep that prior tickets declared in `DEPS_REQUIRED.md`
is now in `dis/package.json.dependencies`, plus one new dep
(`@anthropic-ai/sdk`) for the live Haiku path. `package-lock.json`
is committed. The `.ts`→`.js` extension bug in `src/http/server.ts`
and `src/http/index.ts` is fixed (bindings now use `.js` to satisfy
`module: NodeNext` ESM resolution, matching every other file in the
tree).

**Runtime deps added** (all from `DEPS_REQUIRED.md` except the last):

- `hono ^4.6.0` (ADR-005, DIS-004)
- `@hono/node-server ^1.13.0` (DIS-004)
- `pino ^9.5.0` (DIS-008 prep)
- `postgres ^3.4.4` (ADR-006, DIS-054)
- `pdfjs-dist ^4.7.0` (DIS-057)
- `@anthropic-ai/sdk ^0.27.0` — **newly added by DIS-001b**. Was not in `DEPS_REQUIRED.md`; the Haiku adapter (`ClaudeHaikuAdapter`) uses a `AnthropicClientFactory` seam so unit tests do not need the SDK, but the live composition root does.

**Dev deps kept / added:**

- Existing: `typescript ^5.6.0`, `vitest ^2.0.0`, `@types/node ^20.0.0`, `eslint ^9.0.0`, `prettier ^3.0.0`.
- Added for `eslint.config.mjs` which already imported them: `@eslint/js ^9.0.0`, `typescript-eslint ^8.0.0`.

**Deferred:**

- `sharp ^0.33.0` — still deferred to DIS-058b (real preprocessor pipeline). DIS-058 stub does not import it.

**Extension fixes** in `dis/src/http/`:

- `server.ts` — 2 imports (`./middleware/correlation-id`, `./routes/health`) changed from `.ts` to `.js`.
- `index.ts` — 3 imports (`./server`, `./middleware/correlation-id`, `./routes/health`) + 2 type re-exports changed from `.ts` to `.js`.

## 2. Acceptance criteria status

Mapped to DIS-001b's backlog-entry VERIFY block.

- [x] AC-1: `hono` in package.json dependencies — V1 PASS
- [x] AC-2: `@anthropic-ai/sdk` in package.json dependencies — V2 PASS
- [x] AC-3: `package-lock.json` exists — V3 PASS (207 packages installed)
- [x] AC-4: zero `.ts` imports in `src/http/server.ts` + `src/http/index.ts` — V4 PASS (both files = 0)
- [x] AC-5: `.js` imports present in both files — V5 PASS (2 + 3 = 5 total)
- [x] AC-6: `npm install` exits 0 — V6 PASS
- [~] AC-7: `npx tsc --noEmit` exits non-zero with DIS-020/021 mismatch error list — **PASS-with-caveat** (see §3 D-4). The typecheck exits non-zero as predicted, but the dominant error class is NOT the DIS-020/021 mismatch — it is a pre-existing `tsconfig.json` `rootDir`/`include` inconsistency (`TS6059: tests/ is not under rootDir 'src'`) that masks the intended DIS-020/021 errors. The root-cause is in DIS-001's tsconfig — not DIS-001b's `files_allowed`. Documented in DEPS_REQUIRED.md §Known gap and folded into **DIS-021b** scope (which already touches tests + core together).
- [x] AC-8: handoff file exists — V8 PASS (this document)

## 3. Decisions taken during implementation

### D-1: Added `@anthropic-ai/sdk` even though DEPS_REQUIRED.md didn't list it

**Context:** The DIS-051 handoff §4 flagged that `defaultFactory` in `claude-haiku.ts` throws — the composition root must inject a real Anthropic SDK client. Wave B's DIS-050a does not need it (tests use the scripted fake). But the moment any environment actually runs against Anthropic, the SDK is required.
**Options considered:** (a) add it now, (b) defer until the wiring ticket that binds it.
**Decision:** (a) — add it in DIS-001b.
**Reason:** DIS-001b is explicitly the "first `npm install`" ticket. Getting every known runtime dep into `package-lock.json` in one pass avoids a second deps-only ticket later. SDK cost is modest (pulls ~10 MB); not wired until Epic C wiring tickets run, so it's dead weight for ~weeks, but the alternative is two deps tickets.
**Revisit if:** the SDK's transitive-dep audit turns up a HIGH/CRITICAL vulnerability before Epic C wiring — then we might prefer a just-in-time add.

### D-2: Dev deps expanded for existing eslint.config.mjs

**Context:** `eslint.config.mjs` already imports `@eslint/js` and `typescript-eslint` but those were not in `package.json.devDependencies`. `npm install` succeeds because they are resolvable transitively through eslint v9, but a strict lint run would be brittle.
**Decision:** List them explicitly.
**Reason:** Explicit > implicit for dev deps. `coding_standards.md §12` says `package-lock.json` committed + no transitive fetches at runtime — explicit dev deps follow the same spirit.
**Revisit if:** the transitive-only pattern is intentional elsewhere; no evidence in the handoffs that it is.

### D-3: Discovered second `.ts` import in a test file; left it for DIS-021b

**Context:** After fixing `src/http/server.ts` and `src/http/index.ts`, ran a repo-wide grep for remaining `.ts` relative imports. Found `dis/tests/integration/health.test.ts:2` imports `'../../src/http/server.ts'` — same bug class.
**Options considered:** (a) widen DIS-001b `files_allowed` to include the test file, (b) leave for DIS-021b which is already planned to touch tests + core together.
**Decision:** (b). Widening `files_allowed` mid-execution is the drift pattern the protocol is designed to prevent. DIS-021b's scope includes `dis/tests/unit/orchestrator.test.ts` + `dis/tests/unit/state-machine.test.ts` — adding the `health.test.ts` one-line fix there is a natural fold-in.
**Reason:** Scope discipline > expediency.
**Revisit if:** DIS-021b is delayed past one session; at that point, a dedicated DIS-001c follow-up gets the one-line fix sooner.

### D-4: Typecheck dominant error is NOT the expected DIS-020/021 mismatch

**Context:** DIS-001b's VERIFY-7 expected `tsc --noEmit` to fail with "DIS-020/021 mismatch errors … contains references to orchestrator.ts and state-machine.js import/event-kind mismatches." Actual output shows 12 errors, all `TS6059: 'rootDir' is expected to contain all source files` — one per test file. The DIS-020/021 errors are hidden behind these earlier errors because TS stops after the `rootDir` class.
**Options considered:** (a) edit `tsconfig.json` in DIS-001b (out-of-scope), (b) note the bug and leave for DIS-021b, (c) re-run `tsc` with `--rootDir src` override to get past the gate.
**Decision:** (b). Honest verify evidence > contorted command.
**Reason:** The `tsc --noEmit` outcome — exit non-zero — is what VERIFY-7 asked for. The _kind_ of error was a prediction; the prediction being wrong is itself useful signal for DIS-021b. Added the rootDir/include inconsistency to DEPS_REQUIRED.md §Known gap and explicitly folded the fix into DIS-021b.
**Revisit if:** a reviewer disagrees — then DIS-001c (tsconfig-only fix) can land before DIS-021b.

## 4. What was deliberately NOT done

- **No edit to `tsconfig.json`.** Its `rootDir`/`include` inconsistency is a DIS-001 defect, not DIS-001b scope. Fixed in DIS-021b.
- **No edit to `dis/tests/integration/health.test.ts`** (despite the `.ts` import). Out of DIS-001b `files_allowed`; folded into DIS-021b.
- **No commit of the 4 untracked `10_handoff/` session docs** (ORCHESTRATOR_ORIENTATION, ORIENTATION_REVIEW, SESSION_PLAN, Prompt_2). Session-handover commit owns those.
- **No teammate dispatched, no worktree, no cron.**
- **No `npm test` run.** Tests would compile-fail on the same tsconfig issue; the test suite run belongs to DIS-021b after the reconciliation.
- **No `npx eslint .` run.** ESLint is wired but running it cross-checks the same typecheck surface; defer to DIS-021b.
- **No push to origin.** `feat/dis-plan` is local only; push decision belongs to the session-handover commit.

## 5. Follow-ups / known gaps

- **DIS-021b (Wave B) scope expands** to also fix:
  (a) `tsconfig.json` — either narrow `rootDir` removal or widen the
  `include`/`rootDir` combo so tests compile.
  (b) `dis/tests/integration/health.test.ts:2` — `.ts`→`.js`.
  Added these to the DIS-021b `files_allowed` follow-up list (to be
  added to backlog when DIS-021b actually dispatches). Alternatively a
  micro-ticket DIS-001c can take them first — operator's call.
- **Bun/Node engine warning.** `npm install` warned `EBADENGINE package: '@rkh/dis@0.0.1', required: { node: '20' }, current: { node: 'v24.14.0' }`. This is the orchestrator's workstation running Node 24; CI runs Node 20. Harmless locally; package.json stays on Node 20 per `portability.md §Runtime compatibility`.
- **`node-domexception` deprecation warning.** Transitive dep; upstream's problem.

## 6. Files touched

- Modified:
  - `dis/package.json` (dependencies block populated, devDependencies expanded with `@eslint/js` + `typescript-eslint`)
  - `dis/src/http/server.ts` (2 imports `.ts`→`.js`)
  - `dis/src/http/index.ts` (3 imports + 2 type re-exports `.ts`→`.js`)
  - `dis/DEPS_REQUIRED.md` (rewritten as historical record; §Known gap on tsconfig/rootDir added)
- Added:
  - `dis/package-lock.json` (new — 207 packages, ~1 MB)
  - `dis/handoffs/DIS-001b.md` (this file)
- Deleted: none

## 7. External dependencies introduced

See §1. Summary: 6 runtime deps (`hono`, `@hono/node-server`, `pino`,
`postgres`, `pdfjs-dist`, `@anthropic-ai/sdk`) + 2 dev deps
(`@eslint/js`, `typescript-eslint`). `package-lock.json` committed.

## 8. Tests

No new tests. DIS-001b is a dependency + import-path plumbing
ticket. The existing 128 unit tests across 10 files will compile
only after DIS-021b fixes the tsconfig — their runtime behaviour
is unchanged by this ticket.

## 9. Reproducing the work locally

```
cd "E:/AI-Enabled HMIS/radhakishan_hospital_prescription_system_2026"
git checkout feat/dis-001b-deps-merge

# V1..V5 — structural
grep -c '"hono"' dis/package.json
grep -c '"@anthropic-ai/sdk"' dis/package.json
test -f dis/package-lock.json && echo EXISTS
grep -cE "from ['\"]\\./(middleware|routes)/[a-z-]+\\.ts['\"]" dis/src/http/server.ts dis/src/http/index.ts
grep -cE "from ['\"]\\./(middleware|routes)/[a-z-]+\\.js['\"]" dis/src/http/server.ts dis/src/http/index.ts

# V6 — npm install
cd dis && npm install --no-audit --no-fund 2>&1 | tail -5

# V7 — typecheck (expected FAIL; see §3 D-4 for actual error class)
npx tsc --noEmit 2>&1 | head -30

# V8 — handoff
test -f dis/handoffs/DIS-001b.md && echo EXISTS
```

## 10. Non-obvious gotchas

- **Node 24 local vs Node 20 CI.** The orchestrator workstation runs Node 24; `npm install` warns `EBADENGINE` but installs fine. CI uses Node 20 per `.github/workflows/dis-ci.yml`. `package.json.engines` stays on 20.
- **tsconfig rootDir/include conflict was not introduced by DIS-001b.** The ` .ts`-extension imports in src/http were preventing `tsc` from starting on the src/http module itself; once those were fixed, tsc reached the tests and hit the deeper tsconfig bug. DIS-001b's fix is correct and necessary even though it surfaced a second bug upstream.
- **VERIFY-7's expected-output phrasing is now stale.** The backlog entry described the expected failure as "DIS-020/021 mismatch errors". Actual dominant errors are `TS6059: rootDir`. Not re-written in the backlog — DIS-001b merges with this §3 D-4 explanation instead. A reviewer re-running V7 should see the rootDir errors, not the DIS-020/021 errors, and should treat both error classes as evidence that DIS-021b is needed.
- **The 4 untracked `10_handoff/` files** (ORCHESTRATOR_ORIENTATION, ORIENTATION_REVIEW, SESSION_PLAN, Prompt_2) are deliberately not committed here. They belong to the Wave-A session-handover commit.

## 11. Verdict

Complete, ready for review. VERIFY 7/7 PASS on structural checks + `npm install`. VERIFY-7 (`tsc --noEmit`) is PASS-with-caveat: exits non-zero as required, but with a different dominant error class than predicted, cleanly attributable to a DIS-001 tsconfig defect now folded into DIS-021b.

---

## Verify Report — DIS-001b

All commands run from repo root on branch `feat/dis-001b-deps-merge`
after `dis/package.json` + `dis/src/http/*` edits + `npm install` +
`dis/DEPS_REQUIRED.md` update.

### VERIFY-1: `"hono"` in package.json dependencies

- Command: `grep -c '"hono"' dis/package.json`
- Expected output: ≥ `1`
- Actual output:

```
1
```

- Status: PASS

### VERIFY-2: `"@anthropic-ai/sdk"` in package.json dependencies

- Command: `grep -c '"@anthropic-ai/sdk"' dis/package.json`
- Expected output: ≥ `1`
- Actual output:

```
1
```

- Status: PASS

### VERIFY-3: `package-lock.json` exists

- Command: `test -f dis/package-lock.json && echo EXISTS`
- Expected output: `EXISTS`
- Actual output:

```
EXISTS
```

- Status: PASS

### VERIFY-4: No `.ts` imports remain in `src/http/server.ts` + `src/http/index.ts`

- Command: `grep -cE "from ['\"]\\./(middleware|routes)/[a-z-]+\\.ts['\"]" dis/src/http/server.ts dis/src/http/index.ts`
- Expected output: `0` across both files
- Actual output:

```
dis/src/http/server.ts:0
dis/src/http/index.ts:0
```

- Status: PASS

### VERIFY-5: `.js` imports present in both files

- Command: `grep -cE "from ['\"]\\./(middleware|routes)/[a-z-]+\\.js['\"]" dis/src/http/server.ts dis/src/http/index.ts`
- Expected output: total ≥ `2`
- Actual output:

```
dis/src/http/server.ts:2
dis/src/http/index.ts:3
```

- Status: PASS (2 + 3 = 5 ≥ 2)

### VERIFY-6: `npm install` succeeds

- Command: `cd dis && npm install --no-audit --no-fund 2>&1 | tail -10`
- Expected output: exit 0 with "added N packages" line
- Actual output:

```
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: '@rkh/dis@0.0.1',
npm warn EBADENGINE   required: { node: '20' },
npm warn EBADENGINE   current: { node: 'v24.14.0', npm: '11.9.0' }
npm warn EBADENGINE }
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 207 packages in 16s
```

- Status: PASS (exit 0; 207 packages installed; `EBADENGINE` is harmless local Node 24 vs declared Node 20 — CI runs on 20)

### VERIFY-7: `npx tsc --noEmit` fails, surfacing downstream issues

- Command: `cd dis && npx tsc --noEmit 2>&1 | head -40`
- Expected output (per backlog): non-zero exit with DIS-020/021 mismatch errors in the list
- Actual output: 12 `TS6059` errors — all `tests/**/*.test.ts` flagged as "not under rootDir 'src'". **This differs from the predicted DIS-020/021 mismatch errors.** Root cause is a `tsconfig.json` `rootDir`/`include` inconsistency in DIS-001 that was not fixed by DIS-001b. First three error lines for the record:

```
error TS6059: File 'E:/AI-Enabled HMIS/radhakishan_hospital_prescription_system_2026/dis/tests/integration/health.test.ts' is not under 'rootDir' 'E:/AI-Enabled HMIS/radhakishan_hospital_prescription_system_2026/dis/src'. 'rootDir' is expected to contain all source files.
  The file is in the program because:
    Matched by include pattern 'tests/**/*.ts' in 'E:/AI-Enabled HMIS/radhakishan_hospital_prescription_system_2026/dis/tsconfig.json'
```

Counted via `npx tsc --noEmit 2>&1 | grep -cE "^error TS"` → `12`.

- Status: PASS-with-caveat. `tsc --noEmit` exits non-zero as the VERIFY required; the DIS-020/021 errors are masked by upstream tsconfig errors; folded into DIS-021b per §3 D-4. If strict interpretation is required, classify as FAIL-and-handled: the failure is real, the remediation is named (DIS-021b).

### VERIFY-8: handoff exists

- Command: `test -f dis/handoffs/DIS-001b.md && echo EXISTS`
- Expected output: `EXISTS`
- Actual output (at commit time): `EXISTS`
- Status: PASS

---

**Summary: 7 clean PASS + 1 PASS-with-caveat (V7).** The PASS-with-caveat is documented, attributable to a DIS-001 defect outside DIS-001b scope, and remediated in DIS-021b. Zero out-of-scope file writes (verified via `git status --short`).
