# Done — Append-Only Log

> Tickets move here when they pass Gate 7 and are merged. Append-only
> by convention; historical record for agent audit trails.
>
> Format per `08_team/session_handoff.md §8`: copy the ticket's
> one-line verdict from the handoff `§11 Verdict` into the entry
> below at merge time.

## Format

```
### DIS-### — {summary}
- Merged: <date> by <architect>
- Branch: feat/dis-###-<slug> (deleted or retained)
- Commit: <SHA>
- Handoff: dis/handoffs/DIS-###.md
- CS coverage: CS-## (if any)
- Follow-up tickets opened: DIS-###, …
- Verdict: {one-line from handoff §11}
```

---

## Session 2026-04-20 — Waves 1, 2, 3 (15 tickets)

Backfilled 2026-04-21 as part of DIS-002d (scaffold hygiene). Entries
reconstructed from `dis/handoffs/*.md`, `SESSION_HANDOVER_2026-04-20.md
§10` teammate log, and `git log --all --oneline --grep "DIS-"`.

### Wave 1 — Epic A foundations

### DIS-001 — Initialize `dis/` subproject

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-001-scaffold (deleted)
- Commit: see `git log --grep "DIS-001"` (scaffold + Dockerfile stub)
- Handoff: absent (subagent execution; retrofit documented in the
  prior-session handover §10)
- CS coverage: none
- Follow-up tickets opened: DIS-001b (deps merge + `.ts`→`.js` fix)
- Verdict: Complete — scaffold, tsconfig, package.json (empty deps by
  design), folder layout per `adapters.md`.

### DIS-002 — CI workflow + port-validator + PR template + secret scan

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-002-ci (deleted)
- Commit: b29b4e8 (impl) + 21b20a2 (retrofit handoff)
- Handoff: dis/handoffs/DIS-002.md
- CS coverage: none (indirectly supports CS-1 via port-validator DIP)
- Follow-up tickets opened: DIS-002a, DIS-002b (suggested in
  handoff §5), plus session-1 follow-ups DIS-002c/d/e.
- Verdict: Complete, ready for review.

### DIS-003 — Port interface stubs (8 ports + index barrel)

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-003-ports (deleted)
- Commit: 7823597
- Handoff: absent (subagent execution)
- CS coverage: none
- Follow-up tickets opened: none at merge
- Verdict: Complete — 8 port interfaces per TDD §9.1/§10.1, explicit
  re-exports in `ports/index.ts`, `noImplicitAny` clean.

### DIS-004 — Health endpoint + Hono server + correlation-id middleware

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-004-health (deleted)
- Commit: e525140 (failing test) + 837f115 (impl) + fcca601 (retrofit
  handoff)
- Handoff: dis/handoffs/DIS-004.md
- CS coverage: none (indirect: CS-1 Hono portable HTTP, CS-8
  structured logging prep)
- Follow-up tickets opened: DIS-004-followup (run red→green after
  DIS-001b lands — now folded into DIS-001b VERIFY-6/7)
- Verdict: Complete, ready for review.

### Wave 2 — Epic B core business logic

### DIS-020 — Pure state machine (CS-1)

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-020-state-machine (deleted)
- Commit: a6df0ef (see note) + separate test-first commit
- Handoff: dis/handoffs/DIS-020.md
- CS coverage: CS-1 (no bypass of verification), CS-5 (terminals
  terminal)
- Follow-up tickets opened: DIS-021b (reconciliation with DIS-021
  stub, CS-1 tagged)
- Verdict: Complete — 10 States, 11 Event kinds, 18 unit tests,
  `assertNever` exhaustiveness, pure function.

### DIS-021 — IngestionOrchestrator (DI ports)

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-021-orchestrator (deleted)
- Commit: a6df0ef + d49dd57 + abebc65 (handoff)
- Handoff: dis/handoffs/DIS-021.md
- CS coverage: indirect via DIS-020 (CS-1, CS-5)
- Follow-up tickets opened: **DIS-021b (COORDINATION_REQUIRED —
  blocks `tsc --noEmit`)**, DRIFT-PHASE-1 FOLLOWUP-A (5 fitness
  violations from raw SQL literals, also folded into DIS-021b)
- Verdict: Complete with known coordination scar. Authoritative
  state-machine reconciliation deferred to DIS-021b.

### DIS-022 — Confidence policy evaluator (CS-7)

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-022-confidence (deleted)
- Commit: a322cd8 (impl) + 6b2a233 (test-first) + handoff
- Handoff: dis/handoffs/DIS-022.md
- CS coverage: CS-7 (confidence gates explicit; default off)
- Follow-up tickets opened: none at merge
- Verdict: Complete — fail-closed when `enabled=false`, one-fail-all
  rule, policy version stamped, 18 test assertions across 8 `it()`
  blocks.

### DIS-023 — Promotion service (CS-10, CS-11)

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-023-promotion (deleted)
- Commit: 22a2de2 (test-first) + 8bebe5a (impl) + a70af19 (partial-dedup
  test)
- Handoff: dis/handoffs/DIS-023.md
- CS coverage: CS-10 (discharge latest-only), CS-11 (duplicate-row
  guard)
- Follow-up tickets opened: none at merge
- Verdict: 8/8 tests passing. Pure intent-only plan builder; database
  adapter executes the plan in a transaction.

### DIS-024 — Audit log writer (append-only contract)

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-024-audit-log (deleted)
- Commit: 646fd0c (test-first) + 4dbca6d (impl)
- Handoff: dis/handoffs/DIS-024.md
- CS coverage: CS-3 (every clinical row traces to extraction —
  application-side belt to DB-trigger suspenders)
- Follow-up tickets opened: migration for `ocr_audit_log` + triggers
  (Epic F scope); adapter translation of PG trigger exception (Epic C
  SupabasePostgresAdapter scope)
- Verdict: Complete — `AuditLogger` class exposes only `write` /
  `writeMany`; no `update`/`delete` method exists at the type level;
  `AuditLogImmutableError` exported for adapter-layer PG trigger
  translation.

### Wave-2 meta — drift-prevention Phase 1

### DRIFT-PHASE-1 — Phase 1 drift controls (Controls 1/2/3/7/10)

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-drift-impl (deleted)
- Commit: see `git log --grep "drift"`
- Handoff: dis/handoffs/DRIFT-PHASE-1.md
- CS coverage: meta (controls protect every CS tag downstream)
- Follow-up tickets opened: **DIS-FOLLOWUP-A (5 `core_no_sql_literals`
  violations in orchestrator.ts + **fakes**/database.ts, folded into
  DIS-021b)**, DIS-FOLLOWUP-B (templated glob example), DIS-FOLLOWUP-C
  (rewrite fitness.mjs in TS post-DIS-001b)
- Verdict: Phase-1 machinery wired. 10/11 VERIFY checks pass; V3
  surfaces true-positive Control 3 finding in the pre-existing tree
  (the 5 violations above).

### Wave 3 — Epic C POC adapters

### DIS-050 — DatalabChandraAdapter (CS-2)

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-050-datalab (deleted)
- Commit: see `git log --grep "DIS-050"`; merge commit e035d74
- Handoff: dis/handoffs/DIS-050.md
- CS coverage: CS-2 (raw provider response preserved byte-identically)
- Follow-up tickets opened: **DIS-050a (wire-contract hotfix per
  `10_handoff/document_ocr_flow.md §13` + webhook_url per ADR-004)**,
  integration tests with recorded Datalab response.
- Verdict: 7 unit tests passing; exponential backoff 1→10s with 120s
  total cap; `OcrProviderError` + `OcrProviderTimeoutError`.

### DIS-051 — ClaudeHaikuAdapter

- Merged: 2026-04-20 by orchestrator (3rd teammate; 2 prior stalls)
- Branch: feat/dis-051-haiku (deleted)
- Commit: a17d0f8 (test-first) + a18d731 (impl) + 9a962ab (handoff)
- Handoff: dis/handoffs/DIS-051.md
- CS coverage: CS-9 (JSON-only replies), CS-10 (no invented data, via
  prompt)
- Follow-up tickets opened: DIS-051-followup (replace hand-rolled
  required-keys check with Ajv); SDK integration in wiring layer
  (Epic C wiring scope); pricing constants module.
- Verdict: Adapter + prompt + schema land; retry-on-invalid wired;
  second-failure → `StructuringSchemaInvalidError`.

### DIS-053 — SupabaseStorageAdapter

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-053-supabase-storage (deleted)
- Commit: merge 088db29; impl commit 52e3d67
- Handoff: dis/handoffs/DIS-053.md
- CS coverage: none
- Follow-up tickets opened: S3Adapter (Epic H — portability
  equivalence), integration tests against live Supabase project.
- Verdict: 5 methods implemented via REST (no Supabase SDK), 9 unit
  tests passing, URL-encoding preserved slashes, credentials via
  SecretsPort.

### DIS-054 — SupabasePostgresAdapter

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-054-supabase-postgres (deleted)
- Commit: merge a41cc65; impl commit e38e35a
- Handoff: dis/handoffs/DIS-054.md
- CS coverage: none
- Follow-up tickets opened: DIS-060 wires real `postgres` driver via
  `setPostgresDriverLoader`; integration tests (DIS-075).
- Verdict: DatabasePort implemented via `postgres` driver
  indirection; driver-loader pattern keeps unit tests hermetic; 7
  tests passing; `SET LOCAL` key-name validated; typed connection
  errors.

### DIS-057 — DefaultFileRouter

- Merged: 2026-04-20 by orchestrator
- Branch: feat/dis-057-file-router (deleted)
- Commit: merge d8792d0; impl commit 5c0ac0c
- Handoff: dis/handoffs/DIS-057.md
- CS coverage: none
- Follow-up tickets opened: wire `DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE`
  env to constructor in composition root (Epic C wiring).
- Verdict: TDD §7 decision tree implemented; 11 unit tests passing
  (each branch + threshold override); `pdfjs-dist` lazy-imported via
  DI seam.

### DIS-058 — DefaultPreprocessor (stub)

- Merged: 2026-04-20 by orchestrator (2nd teammate; 1 prior conflict)
- Branch: feat/dis-058-preprocessor (deleted)
- Commit: merge a24e399; impl commit aa8abf6; handoff e70fe56
- Handoff: dis/handoffs/DIS-058.md
- CS coverage: none (stub)
- Follow-up tickets opened: **DIS-058a..g (real sharp-based pipeline
  per TDD §8)**.
- Verdict: Type-safe passthrough stub with 50-page cap; 6 unit tests;
  `sharp ^0.33` dep deferred to DIS-058a-g; real pipeline intentionally
  out of scope.

### Wave-meta — documentation

### DOC-AGENTIC-PROTOCOL — Authoring `08_team/agentic_dev_protocol.md`

- Merged: 2026-04-20
- Branch: feat/agentic-dev-protocol (deleted)
- Handoff: dis/handoffs/DOC-AGENTIC-PROTOCOL.md
- Verdict: 493-line Phases 0–9 + Cross-cutting doc with honest Y/P/N
  status; 70 numbered sub-items + 7 cross-cutting.

### DOC-VERIFY-TEMPLATE — Verify-Driven ticket template + README section

- Merged: 2026-04-20
- Branch: feat/dis-verify-template (deleted)
- Handoff: dis/handoffs/DOC-VERIFY-TEMPLATE.md
- Verdict: `_ticket_template.md` + `07_tickets/README.md` updated;
  `files_allowed:` YAML list + numbered VERIFY-N block mandatory.

### DOC-VERIFY-BACKLOG-A — Epic A+B rewrite to Verify-Driven

- Merged: 2026-04-20
- Branch: feat/dis-verify-backlog-a (deleted)
- Handoff: dis/handoffs/DOC-VERIFY-BACKLOG-A.md
- Verdict: 41 tickets in scope; 188 VERIFY-N lines; CS-1/3/7/10/11
  anchored at test files per verify_format.md §8.

### DOC-VERIFY-BACKLOG-B — Epic C..H rewrite + integration_hold sync

- Merged: 2026-04-20
- Branch: feat/dis-verify-backlog-b (deleted)
- Handoff: dis/handoffs/DOC-VERIFY-BACKLOG-B.md
- Verdict: 137 tickets in scope; 10 [HELD] markers in Epic G; Epic A+B
  bytes confirmed unchanged (non-overlap with parallel teammate).

### DRIFT-DOC-WRITER — Authoring `02_architecture/drift_prevention.md`

- Merged: 2026-04-20
- Branch: feat/dis-drift-prevention (deleted)
- Handoff: dis/handoffs/DRIFT-DOC-WRITER.md
- Verdict: 11 controls; Phase-1 Controls 1/2/3/7/10 recommended for
  immediate adoption; Phase-2 staged; failure-mode library F1..F12.

---

## Session 2026-04-21 — Wave A

### DIS-002c — Register session-1 follow-up tickets in backlog

- Merged: 2026-04-21 by orchestrator into feat/dis-plan
- Branch: feat/dis-002c-backlog-expand (retained locally)
- Commit: 7141f17; merge commit c11e7fc
- Handoff: dis/handoffs/DIS-002c.md
- CS coverage: none (`doc-only`, `process`)
- Follow-up tickets opened: self-registered (plus DIS-002d/e, DIS-001b,
  DIS-021b, DIS-050a — all registered in the same PR).
- Verdict: Complete, ready for review. 8/8 VERIFY PASS (VERIFY-7
  self-corrected mid-execution per handoff §3 D-4).

### DIS-002d — Scaffold hygiene

- Merged: 2026-04-21 by orchestrator into feat/dis-plan
- Branch: feat/dis-002d-scaffold-hygiene (retained locally)
- Commit: b6855f5; merge commit 4fe738b
- Handoff: dis/handoffs/DIS-002d.md
- CS coverage: none (`doc-only`, `process`)
- Follow-up tickets opened: DIS-002e (populates the adrs/ folder
  this ticket scaffolded); DIS-002f (owns the 4 untracked
  `10_handoff/` session artefacts left out of this scope).
- Verdict: Complete, ready for review. 7/7 VERIFY PASS.

### DIS-002e — ADR pack (ADR-001..007) + kill_switch.md reconciliation

- Merged: 2026-04-21 by orchestrator into feat/dis-plan
- Branch: feat/dis-002e-adr-pack (retained locally)
- Commit: 6a279da; merge commit fdde485
- Handoff: dis/handoffs/DIS-002e.md
- CS coverage: ADR-003 indirectly touches CS-9 (kill-switch
  semantics); ADR-004 preserves CS-2 under the webhook path.
- Follow-up tickets opened: DIS-100 implements ADR-003 (Epic D);
  DIS-050a + DIS-097-extended implement ADR-004 (adapter +
  receiver endpoint); future ADR-002-self-host-switchover at
  1000 docs/day threshold; future Sonnet-escalation ticket.
- Verdict: Complete, ready for review. 9/9 VERIFY PASS (incl.
  V8: zero "307" in kill_switch.md — reconciliation complete).

### DIS-001b — Merge DEPS_REQUIRED into package.json + fix .ts→.js in src/http/

- Merged: 2026-04-21 by orchestrator into feat/dis-plan
- Branch: feat/dis-001b-deps-merge (retained locally)
- Commit: 403b012; merge commit 21a7458
- Handoff: dis/handoffs/DIS-001b.md
- CS coverage: none directly (enables DIS-021b which carries CS-1)
- Follow-up tickets opened: DIS-021b gains scope for
  (a) tsconfig.json rootDir/include fix (DIS-001 defect surfaced
  by V7), (b) one-line .ts→.js fix in
  dis/tests/integration/health.test.ts:2. `sharp ^0.33.0` still
  deferred to DIS-058b.
- Verdict: Complete — 7 clean PASS + 1 PASS-with-caveat. V7 tsc
  errors are TS6059 rootDir (masking the predicted DIS-020/021
  mismatch); root cause is DIS-001 tsconfig defect folded into
  DIS-021b.

### DIS-002f — Wave-A session handover + commit 4 untracked session-mgmt docs

- Merged: 2026-04-21 by orchestrator into feat/dis-plan
- Branch: feat/dis-002f-session-handover (retained locally)
- Commit: (filled at commit time); merge commit: (filled at merge)
- Handoff: dis/handoffs/DIS-002f.md
- CS coverage: none (`doc-only`, `process`)
- Follow-up tickets opened: Wave B — DIS-021b + DIS-050a under v3
  windows-parallel-agents protocol.
- Verdict: (filled at commit time after 7/7 VERIFY PASS).
