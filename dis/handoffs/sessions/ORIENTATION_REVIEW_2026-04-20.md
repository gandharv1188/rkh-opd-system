# DIS Orientation Review — 2026-04-20

> Written by a fresh orchestrator session after a deep read of the
> `dis/` codebase (Waves 1-3 merged) and all 45 plan documents under
> `dis/document_ingestion_service/`.
>
> Purpose: give the next wave a single artefact that names what is
> binding, what is thin, and what must be reconciled before Wave 4
> (Epic D — HTTP layer) can be dispatched.
>
> Companion to `SESSION_HANDOVER_2026-04-20.md` (authored at the end
> of the build session). This review was authored at the start of the
> next session, after re-reading the codebase with fresh eyes.

---

## §0. TL;DR

- **Git state is clean.** `feat/dis-plan @ 602c634`, one worktree, zero
  teammates, zero cron jobs, PR #1 open. Only untracked file is the
  resume prompt (`Prompt_2.md`).
- **The plan is load-bearing.** 45 docs, ~21,000 lines, machine-checked
  at CI time. Section numbers are effectively API surface.
- **The code has two material bugs that block `npm run typecheck`.**
  Both are consequences of the DIS-020/DIS-021 merge coordination scar
  flagged in `dis/handoffs/DIS-021.md`.
- **The plan itself is honest about what's thin** (see
  `08_team/agentic_dev_protocol.md`): ADRs absent, verification phase
  aspirational, observability not wired.
- **Recommended next step is a ticket (DIS-025), not an architect-only
  fix**, because the change is on the CS-1 clinical-safety surface and
  bypassing Gate 2 / Gate 6a would undermine the plan's own discipline.

---

## §1. Shape of the plan folder

The folder is structured as a **contract** agents implement against,
not just documentation. Numbered `00_…` → `11_…` in dependency order:

| #     | Folder          | Locks down                                                                                                    | Binding for         |
| ----- | --------------- | ------------------------------------------------------------------------------------------------------------- | ------------------- |
| 00    | overview        | North star, glossary (35 canonical terms), 12 non-goals                                                       | Everyone            |
| 01    | product         | Product brief + risk register, 25 user stories `DIS-US-###`, **CS-1..CS-12** clinical-safety rules            | PM, clinicians, eng |
| 02    | architecture    | TDD §1–§20, adapter inventory, portability matrix, 5 sequence diagrams, 17-section coding standards           | All code tickets    |
| 02    | architecture    | **11-control drift-prevention** (5 Phase-1 active, 6 Phase-2 staged)                                          | CI + process        |
| 03    | data            | 5 new tables + alters on 3 existing, 9 migrations M-001..M-009 with rollbacks                                 | DB tickets          |
| 04    | api             | OpenAPI 3.1 + 21-code error envelope                                                                          | HTTP tickets        |
| 05    | testing         | Pyramid strategy, unit catalogue (80+ named tests), 12 integration scenarios, 20-fixture clinical corpus spec | Every ticket        |
| 05    | testing         | **Verify-Driven format** — prose acceptance criteria are explicitly rejected                                  | Every ticket        |
| 06    | rollout         | 5-phase plan (0→4), 10 feature flags catalogue, kill-switch runbook with 5-min RTO, comms/training per role   | Ops                 |
| 07    | tickets         | **188 tickets** across Epics A–H in Verify-Driven form, integration-hold file, template with `files_allowed`  | Agents              |
| 08    | team            | RACI matrix, 7 review gates (Gate 6a clinical / 6b integration = no override), 9-phase agentic dev protocol   | Process             |
| 09    | runbooks        | 7 on-call playbooks written for the 3-AM reader — every action is a command, a decision, or a link            | SRE                 |
| 10–11 | handoff + xscr. | Session handover + JSONL transcript archive                                                                   | Session continuity  |

### Key insights

- **The docs are load-bearing, not decorative.** CI scripts
  (`check-pr-citations.mjs`, `fitness.mjs`, `check-files-touched.mjs`)
  grep the markdown at merge time — e.g. Control 1 literally
  regex-matches `implements TDD §X.Y` in PR bodies against the actual
  TDD section anchors. A doc rename silently breaks CI. Section
  numbers are effectively API surface.
- **Clinical-safety rules are numbered once and never renumber.**
  `CS-1..CS-12` appear in the TDD, test strategy (with explicit
  test-file mapping), data-model triggers, rollout exit criteria,
  kill-switch tree, and runbook paging thresholds. This stable
  numbering is what lets mechanical controls work across 45 files.
- **The integration firewall is physical, not procedural.** Epic G
  tickets live in a separate file (`integration_hold.md`) that agents
  are _forbidden_ to pull from. The "no integration without approval"
  rule is enforced by file location, not by a reviewer remembering to
  check.

---

## §2. What's well-specified (binding contracts agents can't wander from)

- **State machine.** 10 states, explicit transition table in TDD §4,
  CS-1 (no bypass to promoted) + CS-5 (terminals terminal) enforced
  in pure code. Pure `transition()` function. 18 tests map 1:1 to
  TDD §4.
- **Port/adapter contract.** 8 ports, each with POC + prod adapter
  named. `core_no_adapter_imports` + `supabase_sdk_only_in_supabase_adapters`
  fitness rules machine-check the boundary. Port version bumps
  require an ADR.
- **Error model.** 21 stable `UPPER_SNAKE` error codes mapped to HTTP
  status; `retryable` is a first-class field; idempotency-key flow is
  specified end-to-end with behaviour on `same key, different body`.
- **Data model.** Every mutable table gets `version INT NOT NULL
DEFAULT 1` + `correlation_id UUID`; audit log is append-only via
  **both** a DB trigger and a type-level `AuditLogger` (no
  update/delete method exists to call). FKs are `ON DELETE RESTRICT`
  for clinical rows. The `uniq_lab_dedupe` index (CS-11) is a DB-side
  belt on top of a pure-code suspenders (`promotion.ts`).
- **Migrations.** M-001..M-008 are "additive and reversible"; M-009 is
  the only cutover and explicitly waits for default rollout. Every
  migration has `.rollback.sql` and CI round-trips forward→down→forward.
  Zero-downtime discipline.
- **Verify format.** Every acceptance criterion is a Given/When/Then
  with a runnable command and literal expected output. Prose criteria
  are explicitly rejected. Reviewer re-runs 20% (100% for
  clinical-safety / integration).
- **Feature flags + kill switch.** 10 flags catalogued with defaults,
  evaluation site, audit table, and a precedence matrix. Kill switch
  has three flip paths (CLI / dashboard / hot DB row) with a 5-min
  RTO and a ritual for un-flipping (48-h shadow re-soak + clinician
  sign-off).
- **Rollout gating.** Every phase transition is numeric: e.g. Phase
  1→2 requires ≥500 real docs, ≥90% name-match exact agreement,
  ≥95% value-numeric within 1%, 0 unexplained clinical writes, 0
  CS-# violations. No vibes allowed.

---

## §3. What's honestly thin (flagged by the plan itself)

`08_team/agentic_dev_protocol.md` uses Y/P/N status columns without
inflating the score:

| Phase                | Y   | P   | N   | What's missing                                                  |
| -------------------- | --- | --- | --- | --------------------------------------------------------------- |
| 3 Architecture       | 8   | 0   | 1   | ADRs — none exist; `02_architecture/adrs/` hasn't been created  |
| 6 Verification       | 0   | 7   | 2   | CI not yet run end-to-end; clinical fixture corpus empty        |
| 8 Operate            | 1   | 6   | 3   | Observability + cost ledger + eval harness all aspirational     |
| Cross-cutting (X.\*) | 2   | 5   | 0   | Secrets-port discipline partial; PHI scrubber in logs not built |

The 8 items the doc itself flags as "most urgent next" match what a
fresh reader would flag: ADRs, mutation / golden tests, the 20-fixture
corpus, CI gate wiring, telemetry + edit-rate dashboard, prompt eval
harness, cost model, Phase-2 drift controls.

---

## §4. Material issues found in the code (blockers for Wave 4)

### 4.1. 🔴 Core state-machine ↔ orchestrator type/event mismatch

`src/core/state-machine.ts` exports `State` and `Event`.
`src/core/orchestrator.ts:22` imports `type ExtractionState` and calls
`transition(row.status, event)` where `event` has kind `'approved'` /
`'rejected'`. The state-machine's `Event` union has no such kinds —
the real kinds are `'nurse_approve'` / `'nurse_reject'`.

This is exactly the coordination scar DIS-021's handoff warned about:
DIS-021 was authored against a local stub (`ExtractionState`,
`ExtractionEvent`, `'approved'`/`'rejected'`), and the DIS-020 merge
never reconciled it. Right now:

- `import { transition, type ExtractionState } from './state-machine.js'`
  — `ExtractionState` doesn't exist there → TS2305.
- `transition(row.status, { kind: 'approved', actor })` — type error
  on `event.kind`.
- `'uploaded' → 'structuring'` via `routed_native` is a native path,
  but the orchestrator calls `advance(row, 'preprocessing')` then
  `'ocr'` then `'structuring'` through `advance()` which uses raw
  UPDATE — **it bypasses `transition()` entirely for pipeline
  progression**. CS-1 guards don't fire on the pipeline path; they
  only fire on the approve/reject path.

This is the single biggest thing blocking the "run `npm install` +
`npm test`" step. The tests won't typecheck until this is fixed.

### 4.2. 🟡 `dis/package.json` is empty of runtime deps

`dependencies: {}`. `hono`, `@hono/node-server`, `postgres`,
`pdfjs-dist`, `@anthropic-ai/sdk`, `pino` are all referenced by
source but not declared. `dis/DEPS_REQUIRED.md` lists them but nobody
has merged. Until they're in `package.json`, `npm install && npm
test` fails immediately on import resolution.

Also: `@anthropic-ai/sdk` is not in `DEPS_REQUIRED.md`; the Haiku
adapter uses a factory so it technically doesn't need the SDK at
test time, but it's needed before the adapter can run live.

### 4.3. 🟡 `ExtractionRecord.version` never initialized

`DbExtractionRow.version` is selected but the INSERT SQL in
`ingest()` and `retry()` doesn't set it, and no DB schema / migration
file exists yet in `dis/migrations/` (the directory is empty). So
`version` will be `undefined` on fresh rows and the optimistic-lock
compare in `advance()` / `transitionWithLock()` will silently never
match. Tests pass with fakes that default it to `0`, but this is
latent real-world breakage on a CS-4-adjacent surface (verified
values not silently overwritten).

### 4.4. 🟡 ADR folder doesn't exist

The prior session handover says "ADR folder `02_architecture/adrs/`
is empty". It's actually **absent** (`ls` returns ENOENT). Multiple
docs cross-reference `02_architecture/adrs/NNNN-*.md`, and
drift-prevention Control 9 (Phase 2) is designed to grep for
`ADR-\d+` references and resolve them. Low stakes today; breaks on
Phase 2 rollout.

### 4.5. 🟡 `src/http/server.ts` uses `.ts` import extensions

With `module: NodeNext`, Node ESM resolution expects `.js`
extensions (what the rest of the codebase uses). TypeScript 5.6+ has
`allowImportingTsExtensions` but it requires `noEmit` — this will
break `tsc` build. Adapter files use `.js` correctly; only
`src/http/server.ts` uses `.ts`.

### 4.6. 🟢 Preprocessor is a 50-page-cap passthrough

Known, documented as DIS-058b. Not a blocker.

---

## §5. Cross-doc discrepancies

These are small but worth fixing before Wave 4 so the
drift-prevention CI has clean ground to stand on.

1. **`in_progress.md` / `done.md` are empty placeholders.**
   `session_handoff.md §8` instructs the Architect to copy each
   ticket's one-line verdict into `done.md` at merge. 15 tickets
   merged; the board doesn't reflect any of them. Silent drift of the
   process itself.
2. **ADR folder absent, not empty** (see §4.4).
3. **`07_tickets/clarifications/` folder doesn't exist**, though
   `README.md` lifecycle and Gate 1 escalation path both reference
   it. CI scripts that glob against it will crash.
4. **Backlog has 188 tickets.** ID ranges: 001–045 (Epics A/B),
   050–085 (Epic C), 090–110 (Epic D), 115–140 (Epic E), 145–175
   (Epic F), 200–209 (Epic G held), 220–235 (Epic H). Spot-check
   whether every ticket actually has a `files_allowed` block before
   Wave 4 (the retrofit happened late in Wave 2 per the handover's
   §3.c).
5. **`kill_switch.md` references two different implementations.**
   `rollout_plan.md` says `DIS_KILL_SWITCH=true` returns `503
UNAVAILABLE`; the runbook says it 307-proxies to legacy. Only one
   can be true when DIS-100 (kill-switch middleware) is written. The
   307 proxy is richer; the 503 is simpler. ADR-worthy call.
6. **`data_model.md` says `version INT NOT NULL DEFAULT 1`** but
   `dis/src/core/orchestrator.ts` inserts without setting version
   (§4.3). Contract specified; implementation hasn't reached it.
7. **`test_strategy.md §5` claims `FileRouterPort` has no fake**,
   but `dis/src/core/__fakes__/file-router.ts` exists and is used by
   orchestrator tests. Harmless; flag for hygiene.

---

## §6. Recommended first-hour plan before dispatching Wave 4

The plan's own discipline is the single biggest asset in the repo.
The temptation is to paper over the 4.1–4.5 issues quickly and
dispatch Wave 4; the argument against is that the next wave will
build on top of whatever contract lands now, so a hasty fix
compounds.

### 6.1. Backfill process hygiene (10 min, architect-only)

- Move the 15 merged tickets into `07_tickets/done.md` with
  merged-date, PR, CS coverage, follow-up IDs (data is all in
  `dis/handoffs/DIS-*.md`).
- Create empty `02_architecture/adrs/` folder and
  `07_tickets/clarifications/` folder (so CI scripts that glob
  against them don't crash).

### 6.2. Write ADR-001, ADR-002, ADR-003 (30–45 min, architect-only)

- **ADR-001** — Hexagonal + ports (captures the 8-port inventory +
  fitness-rule invariants).
- **ADR-002** — Datalab hosted → self-host at 1000 docs/day (already
  in memory, needs formalizing so reviewers can find the reason).
- **ADR-003** — `503 UNAVAILABLE` vs `307 proxy` for kill switch.
  Pick one; reconcile `rollout_plan.md` and `kill_switch.md` in the
  same ADR PR. Recommendation: 503 (simpler, less cross-system
  coupling; matches `error_model.md` which already lists
  `UNAVAILABLE` as a code).

### 6.3. Merge DEPS_REQUIRED into `dis/package.json` (15 min)

Add `@anthropic-ai/sdk`, fix the `.ts`→`.js` imports in
`src/http/server.ts`, then `npm install && npm run typecheck &&
npm test`. Expect typecheck to fail on the state-machine mismatch —
that's the signal the next step is needed.

### 6.4. Open DIS-025 — reconcile DIS-020/021 stub mismatch

Architect-drafted Verify-Driven ticket.

- **Title:** Reconcile DIS-020/021 stub mismatch; route pipeline
  progressions through `transition()`.
- **Tags:** `core`, `clinical-safety` (CS-1)
- **Files allowed (exhaustive):**
  - `dis/src/core/orchestrator.ts`
  - `dis/src/core/state-machine.ts`
  - `dis/tests/unit/orchestrator.test.ts`
  - `dis/tests/unit/state-machine.test.ts` (minor — add one CS-1
    integration test proving pipeline-path transitions go through
    `transition()`)
  - `dis/handoffs/DIS-025.md`
  - `dis/CHANGELOG.md`
- **VERIFY** — numbered shell commands proving: (1) `tsc --noEmit`
  exits 0; (2) `npm test -- orchestrator` reaches green with at
  least one new test that asserts the native-text path invokes
  `transition()` for each state change; (3) a grep for `advance\(`
  in `orchestrator.ts` shows all callers pass the next state
  _computed by_ `transition()`; (4) `fitness.mjs` stays clean.
- **Gate 6a** — human clinical sign-off required because CS-1 is in
  scope.
- Dispatch as a single teammate (`dev-reconcile-020-021`) under the
  v3 Windows-parallel-agents protocol. Single worktree. No parallel
  wave for this one.

### 6.5. Only after DIS-025 merges, dispatch Wave 4 (Epic D)

- `TeamCreate dis-squad` (persistent).
- `CronCreate 7,22,37,52 * * * *` for the 15-min health check.
- Fan out DIS-090..100 in parallel using the `files_allowed` from the
  backlog. Each teammate under v3 worktree isolation with
  `run_in_background: true`.
- DIS-100 (kill-switch middleware) implements the ADR-003 choice.

### Why this order

- The plan's whole point is that even the Architect doesn't bypass
  gates. `agentic_dev_protocol.md §Phase 5b` calls out "tests
  written after implementation (and therefore aligned to the bug)"
  as the failure mode being prevented. The reconciliation fix
  touches CS-1 — exactly where the plan is strictest.
- Steps 6.1–6.3 are scaffolding, not business logic, and DIS-001
  explicitly deferred `package.json` to integration time. Safe as
  architect-owned.
- Step 6.4 is the only item that could plausibly be "just fix it,
  it's obvious" — but doing that on a CS-1 surface is exactly the
  pattern the drift doc Control 10 (re-verification sampling) is
  designed to catch. Better to walk through the gates.

---

## §7. What I did not touch

- I did not touch `web/`, `supabase/functions/`, the live database,
  or anything under the integration hold.
- I did not create any files in `dis/` or change any source.
- I did not dispatch any teammate, create any team, or schedule any
  cron job.
- I did not consume any provider credits.

The orientation above is pure read-only analysis.

---

## §8. Open questions for the user before dispatching anything

Three questions before I write any code:

1. **Reconciliation as DIS-025 ticket** (Gate 2 test-first +
   clinician sign-off) **or as direct architect edit**? I strongly
   recommend the ticket path given the plan's own rules. Your call.
2. **ADR-003 — kill switch `503 UNAVAILABLE` vs `307 legacy
proxy`**? I lean 503 (simpler, less cross-system coupling;
   matches `error_model.md`). Your call.
3. **Order of operations** — is it fine to do all of §6.1 + §6.2 +
   §6.3 as a single architect commit on `feat/dis-plan`, or would
   you prefer separate PRs for paper trail? (Separate PRs cost one
   cycle each but keep the history granular for auditors.)

Awaiting your call on all three before writing anything.

---

## §9. Sign-off

- **Orchestrator:** Claude Opus 4.7 (1M context)
- **Session start:** 2026-04-20, after previous session paused at
  `602c634` on `feat/dis-plan`.
- **Mode:** deep read of all 45 plan documents + `dis/` source tree +
  CI scripts + handoff files. Zero writes, zero teammate dispatches.
- **Next action pending user approval:** items §6.1–§6.3 (scaffold
  hygiene + ADRs + deps) as architect edits, then §6.4 (DIS-025
  ticket) via a teammate, then §6.5 (Wave 4 dispatch).
