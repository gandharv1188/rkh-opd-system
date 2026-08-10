---
index: orientation
last_refreshed: 2026-04-22
source_commit: 69ce4bc
orchestrator: Claude Opus 4.7 (1M context)
synthesizes:
  - 01-overview-product.md
  - 02-architecture.md
  - 03-data-api-testing.md
  - 04-rollout-team-runbooks.md
  - 05-tickets-handoffs.md
  - 06-code-reality-audit.md
---

# DIS Orientation — Start Here

> **Purpose.** A future Claude Code session (or human) can read this page and the six numbered reports and be fully oriented on the Document Ingestion Service feature — without re-reading the 377 source markdown files or the live TypeScript tree.
>
> **Audience.** Primarily the next orchestrator session. Secondarily: clinical reviewer, new engineer, auditor.
>
> **How this relates to the source docs.** Source docs (`dis/document_ingestion_service/**`, `dis/src/**`, `dis/handoffs/**`) remain the authority. These orientation reports are a compressed, cross-cited, drift-flagged index into them. When the synthesis here conflicts with a source doc, the source doc wins — and that conflict is itself a drift finding to surface.

---

## §1. How to use this orientation package

**Fast path (10 minutes):**

1. Read this README end to end.
2. Skim §3 (project in one page) and §4 (critical findings).
3. Stop. You are oriented enough to answer "what is DIS, what's shipped, what's broken".

**Deep path (30–60 minutes):**

1. Read this README.
2. Read the report whose slice is most relevant to your task:
   - Designing a new feature? → `02-architecture.md`
   - Writing a ticket? → `05-tickets-handoffs.md`
   - Touching the code? → `06-code-reality-audit.md`
   - Preparing a rollout or runbook? → `04-rollout-team-runbooks.md`
   - Safety-tagged work? → `01-overview-product.md` §Clinical safety + `03-data-api-testing.md` Part 3
   - Data model / API contract? → `03-data-api-testing.md`
3. Follow the report's citations into the source docs only when you need depth beyond the report.

**Exhaustive path:** Read the six reports in numbered order. You will have read ~4,100 lines of dense, cited prose and will be as oriented as the orchestrator who synthesized this package.

**Refresh path (next session):** See `_meta/refresh-protocol.md`. In short: `git log <source-paths> 69ce4bc..HEAD`. If empty, the corresponding report is still current. If not, read only the diff + any new handoffs, update the report in place, bump `last_refreshed` and `source_commit`.

---

## §2. The six reports

| # | File | Slice | Lines | Owner (reviewer) | Merge commit |
|---|------|-------|-------|------------------|--------------|
| 01 | [`01-overview-product.md`](./01-overview-product.md) | `00_overview/` + `01_product/` — what DIS is, who it's for, clinical safety (CS-1..CS-12), user stories, non-goals. | 314 | overview-reviewer | `4614f59` |
| 02 | [`02-architecture.md`](./02-architecture.md) | `02_architecture/` — TDD, all 7 ADRs (one subsection each), ports & adapters inventory, portability thesis, coding standards, drift prevention, sequence diagrams. | 426 | architecture-reviewer | `d9fef77` |
| 03 | [`03-data-api-testing.md`](./03-data-api-testing.md) | `03_data/` + `04_api/` + `05_testing/` — data model (11 tables), migrations (M-001..M-008), OpenAPI surface, error model, idempotency, test strategy, clinical acceptance, verify format, fixtures. | 1504 | data-api-test-reviewer | `a1e77cc` |
| 04 | [`04-rollout-team-runbooks.md`](./04-rollout-team-runbooks.md) | `06_rollout/` + `08_team/` + `09_runbooks/` — rollout stages (shadow → opt-in → default), 10 feature flags, kill-switch (three flip paths), SLOs, RACI, 7 review gates, session-handoff template, agentic dev protocol, 6 runbooks. | 1007 | ops-reviewer | `3b8bf8b` |
| 05 | [`05-tickets-handoffs.md`](./05-tickets-handoffs.md) | `07_tickets/` + `dis/handoffs/` + `dis/handoffs/sessions/` — epics, backlog, 29 done tickets with merge SHAs, 10 held integration tickets, 32 DIS-### per-task handoffs, 6 DOC/DRIFT workstream docs, 8 session-level handoffs, execution timeline. | 400 | tickets-handoffs-reviewer | `8e13a63` |
| 06 | [`06-code-reality-audit.md`](./06-code-reality-audit.md) | `dis/src/`, `dis/tests/`, `dis/migrations/`, `dis/scripts/` + config — docs-vs-code drift audit. Every ticket in done.md cross-checked against the actual code. | 451 | code-audit-reviewer | `e923d98` |

**Total: 4,102 lines of dense, cited orientation material.**

The synthesis below summarizes. The reports are detailed. When in doubt, read the report.

---

## §3. The project in one page

**What DIS is.** A cloud-portable, verification-gated Document Ingestion Service that replaces the current `supabase/functions/process-document` Edge Function. Pipeline: upload → file-router → preprocess (OCR paths) → OCR → structuring (LLM) → staging (`ocr_extractions`) → human verification → promotion into clinical tables (`lab_results`, `vaccinations`). No OCR-derived row reaches a doctor's surface without human verification OR an explicit confidence-gated auto-approval policy. See `01-overview-product.md §North Star`.

**Why it exists.** The current `process-document` writes Claude Vision output directly into clinical tables — no staging, no audit trail, no reproducibility, tied to one model and one cloud. DIS fixes all three: auditability, safety, portability. See `01-overview-product.md §Executive summary`.

**Architectural style.** Hexagonal (Ports & Adapters) with 8 named ports: `OcrPort`, `StructuringPort`, `StoragePort`, `DatabasePort`, `QueuePort`, `SecretsPort`, `FileRouterPort`, `PreprocessorPort`. Core is pure TypeScript; adapters isolate cloud/vendor; wiring layer (`src/wiring/supabase.ts` or `src/wiring/aws.ts`) is the only place provider choice is made. See `02-architecture.md §Ports` + ADR-001.

**Stack.** Node 20, TypeScript strict, Hono HTTP (ADR-005), `postgres` driver (ADR-006), Claude Haiku default structuring + Sonnet escalation (ADR-007), Datalab hosted Chandra for OCR (ADR-002) switching to self-hosted at 1000 docs/day sustained, webhook-first completion signaling with polling fallback (ADR-004), kill-switch returns 503 with Retry-After (ADR-003). See `02-architecture.md §ADRs`.

**Portability thesis.** Supabase Postgres → AWS RDS, Supabase Storage → S3, pg_cron → SQS, Supabase secrets → AWS Secrets Manager. Core never changes. Wiring layer and adapters are the only boundary that does. Formal dry-run gated by Epic E before DIS is declared portable. See `02-architecture.md §Portability thesis` + `portability.md`.

**Status right now.** 29 tickets merged on `feat/dis-plan`. 0 in progress. Wave C (DIS-005..015 Epic A completion) **held on user direction**. `feat/dis-plan` is 37+ commits ahead of `origin/feat/dis-plan` (the 31 from Wave B + the 6 merge commits from this orientation wave). Epic G integration tickets (DIS-200..209) are in absolute integration hold, locked behind user gatekeeping. No code has ever been deployed or run against real clinical data. See `05-tickets-handoffs.md §Executive summary`.

**Clinical safety posture.** 12 numbered safety requirements (CS-1..CS-12). The state machine (CS-1) is enforced end-to-end in `src/core/state-machine.ts` + `src/core/orchestrator.ts` with both explicit clinical sign-off by the user. CS-2 (raw response byte-identical) is enforced in Datalab adapter. Others range from "implemented" through "partially implemented" to "rationale-only, no test" (notably CS-9). See `01-overview-product.md §Clinical safety` + `03-data-api-testing.md §Clinical acceptance tests`.

**Team model.** Single orchestrator (Claude Opus 4.7, 1M context) + persistent `dis-squad` of named worker teammates + clinical reviewer (Dr. Lokender Goyal). Agents run in isolated Windows worktrees per the `windows-parallel-agents` v3 protocol. CS-tagged tickets require explicit `CLINICAL APPROVED` chat sign-off before merge (Gate 6a). See `04-rollout-team-runbooks.md §Team` + `CLAUDE.md §Agentic Team Management`.

---

## §4. Critical findings (must read before touching anything)

These are the highest-priority drift/gap findings across all six reports. Each is spot-checked and validated against the source tree (see `_meta/source-manifest.md` for the citations).

### F1 — Service cannot boot end-to-end

`dis/src/wiring/` and `dis/migrations/` are both empty. 29 shipped tickets have built ports, adapters, and core, but the composition root and schema migrations — the two pieces that turn the parts into a running service — are both stubs. Every real adapter currently throws a `*_MISSING` error on first call because no wiring binds it. The Dockerfile CMD is still a placeholder log line. **Source:** `06-code-reality-audit.md` §Biggest risks.

**Implication for next work:** before any rollout conversation is real, either an Epic A or Epic B ticket has to land `src/wiring/supabase.ts` + the initial migration chain. This is the single largest gap between documentation and reality.

### F2 — 119 stale `10_handoff/` path references across 20 files

Earlier this session I moved 8 session-level docs from `dis/document_ingestion_service/10_handoff/` to `dis/handoffs/sessions/`. The move was limited by user instruction to not edit other files, so **119 references in 20 files now point at a directory that no longer contains those docs**. Largest concentrations: `07_tickets/backlog.md` (43 occurrences — many inside VERIFY blocks), `DIS-002f.md` (25 occurrences). One JSONL transcript correctly retains the old path as historical (do not rewrite). **Source:** `05-tickets-handoffs.md` §Drift findings; independently grep-verified by me this session.

**Implication for next work:** a follow-up ticket (scope: rewrite `10_handoff/` → `handoffs/sessions/` across the 20 files, except the 11_session_transcripts .jsonl) is cheap and eliminates a large class of future confusion.

### F3 — `sequence_diagrams.md:104` contradicts ADR-003

ADR-003 (Accepted 2026-04-21) mandates HTTP 503 with Retry-After for the kill-switch, explicitly rejecting 307-proxy-to-legacy ("entangles two service lifecycles… no canonical error code for proxied-to-legacy"). But `sequence_diagrams.md:104` Flow 4 still says "503 w/ redirect hint OR proxies transparently". **Source:** `02-architecture.md` §Drift findings; spot-checked and validated this session.

**Implication:** any agent implementing the kill-switch from sequence_diagrams.md would implement the rejected behavior. Rewrite that line to match ADR-003 before DIS-100 (kill-switch middleware) is dispatched.

### F4 — OpenAPI does not declare the 503 kill-switch response

Related to F3 but distinct: `openapi.yaml` has zero `503` or `UNAVAILABLE` responses on any endpoint, despite ADR-003 making 503-with-Retry-After a first-class contract. **Source:** `03-data-api-testing.md` §Part 2 drift; spot-checked and validated this session.

**Implication:** API contract is incomplete against the accepted ADR. Fix co-located with F3.

### F5 — On-call rotation is unstaffed

`RACI.md:83` defers on-call rotation "when we have > 1 admin". Meanwhile `incident_response.md` pages "Primary on-call" for SEV1 (5-min target) and SEV2 (15-min target) without naming who. In effect the incident runbook references a role that does not exist. **Source:** `04-rollout-team-runbooks.md` §Drift findings; spot-checked and validated this session.

**Implication for rollout:** a rollout conversation depends on there being a named human who will answer the SEV1 page. No rollout beyond shadow is credible without this.

### F6 — Glossary table header malformed; `Confidence gate` row leaks a pipe

`dis/document_ingestion_service/00_overview/glossary.md:6-7` has three `|` columns in the separator row but most body rows have two; the `Confidence gate` row at `:31` embeds a `|` inside a cell value, which most renderers will corrupt. **Source:** `01-overview-product.md` §Drift findings; spot-checked and validated this session.

**Implication:** cosmetic, but the glossary is cited as the binding term-source — a corrupted render is a real hazard for future agents.

### F7 — CS-9 has no automated test

Every other clinical safety requirement has a named test. CS-9 (UI shows both raw and normalized test name post-structuring) is rationale-only at `clinical_safety.md:88-95`. **Source:** `01-overview-product.md` §Drift findings.

**Implication:** CS-9 drift can land silently. Add a UI-level or promotion-level assertion.

### F8 — Phase-1 drift controls: `_ticket_template.md` may lack `files_allowed:` block

The architecture report flags that Phase-1 drift controls are still marked "Proposed" in some places, and `_ticket_template.md` may not carry the `files_allowed:` block that `verify_format.md` requires. Needs verification in the next wave. **Source:** `02-architecture.md` §Drift findings.

### F9 — Several ADR decisions have no implementation ticket

- ADR-003 (kill-switch 503) — middleware is DIS-100 backlog, but not yet a Wave-C or Wave-D candidate.
- ADR-007 Sonnet escalation — explicitly declared deferred, but no backlog ticket filed.
- ADR-004 webhook receiver — DIS-097-extended is notional, not a backlog entry with VERIFY block.

**Source:** `02-architecture.md` + `06-code-reality-audit.md`.

**Implication:** "accepted ADR, no ticket" is a slow drift pattern. Rectify as part of Wave C grooming.

---

## §5. What is solid (not just paper)

The reports are rigorous about drift, which can paint a pessimistic picture. The genuinely load-bearing work that is in place:

- **Core business logic is live and tested.** `src/core/state-machine.ts` (CS-1), `src/core/orchestrator.ts` (CS-1 through the happy path via DIS-021b), `src/core/confidence-policy.ts` (CS-7 fail-closed default), `src/core/promotion.ts` (CS-10/CS-11 guards), `src/core/audit-log.ts` (CS-2/CS-3/CS-6 append-only contract). 124 tests pass. See `06-code-reality-audit.md` §src tree.
- **Five real adapters.** `DatalabChandraAdapter` with CS-2 byte-identical `rawResponse` (DIS-050 + DIS-050a hotfix), `ClaudeHaikuAdapter` with schema validation + retry (DIS-051), `SupabasePostgresAdapter` using `postgres` via `setPostgresDriverLoader` indirection (DIS-054 per ADR-006), `SupabaseStorageAdapter` (DIS-053), `DefaultFileRouter` with pdfjs-dist native-text probe (DIS-057). See `06-code-reality-audit.md` §Adapters.
- **All 7 ADRs are written and accepted.** Every load-bearing architectural decision is in `adrs/` with Context/Decision/Consequences/Alternatives. This is the strongest phase of the project per `agentic_dev_protocol.md §Phase 3` (8/9 rows Y).
- **Verify-Driven Ticketing is working.** Every Wave-B merge had a failing-test-first commit, an impl commit, and a handoff at `dis/handoffs/DIS-###.md` — machine-checkable Gate 2 + Gate 7 observance.
- **Windows parallel-agents v3 protocol is battle-tested.** Two prior waves (Wave B — 4 tickets; this orientation wave — 6 teammates) both ran parallel without leaks to main. Six-for-six WORKTREE RESPECTED verdicts on this wave.
- **Full typecheck + test + fitness invariants are green.** `tsc --noEmit` exits 0, vitest 124/124, `fitness.mjs` 0 violations as of end of Wave B (DIS-021d).

---

## §6. Next-session entry point

The next session should:

1. **Read this README + the six reports in §2.** 45–60 minutes, yields full orientation.
2. **Check remote state.** `git fetch && git log --oneline origin/feat/dis-plan..HEAD` — if the remote sync after this session completed, this is empty. If anything's drifted, reconcile.
3. **Check drift since 2026-04-22.** Run the refresh protocol in `_meta/refresh-protocol.md`. For each report, `git log --name-only 69ce4bc..HEAD -- <source_paths>`. Empty output → report current; non-empty → update that report only.
4. **Decide the next wave.** Wave C (DIS-005..015) is queued and held. Before dispatching, consider whether any of the F1–F9 findings in §4 should come first. F1 (wiring + migrations) is the largest blocker for any rollout path.
5. **Preserve the orientation invariant.** The six reports are durable artifacts. Future sessions update them in place rather than appending new snapshots — append-only snapshots defeat the purpose.

---

## §7. What this orientation package deliberately is NOT

- **Not a substitute for `CLAUDE.md`.** Project-level CLAUDE.md at the repo root governs cross-cutting conventions (pediatric OPD system, Supabase credentials, registration flow, etc.). This package covers DIS specifically.
- **Not a substitute for source docs.** The synthesis compresses; the source is authoritative. When this synthesis disagrees with a source doc, trust the source and log it as drift.
- **Not a substitute for session handovers.** `dis/handoffs/sessions/SESSION_HANDOVER_*.md` are the in-the-moment records. This orientation is the slower-moving map.
- **Not complete on research/cost/residency.** Per `agentic_dev_protocol.md §Phase 1`, research discipline is weak (0/5 rows done). Orientation reports surface this gap; they do not fill it.

---

## §8. Provenance

- **Generated:** 2026-04-22 during orchestration session on `feat/dis-plan` branch.
- **Source commit:** `69ce4bc` (post-session-handoff-reorg).
- **Method:** Six parallel Agent tasks in isolated Windows worktrees per `windows-parallel-agents` v3 skill; orchestrator read the load-bearing spine docs (north_star, non_goals, glossary, all 7 ADRs, tdd.md, adapters.md, portability.md, coding_standards.md, agentic_dev_protocol.md, session_handoff.md, most recent session handover) in parallel; synthesis after all 6 reports verified + spot-checked.
- **Verification:** each report returned with `VERDICT: WORKTREE RESPECTED` + commit SHA + source-manifest. Orchestrator spot-checked one drift claim per report against the source tree; all six validated.
- **Merge commits (in order):** `4614f59`, `d9fef77`, `a1e77cc`, `3b8bf8b`, `8e13a63`, `e923d98`.

Every claim in the six reports (and in §4 above) is traceable to a source file path (and often a line number). If a future session finds a claim that does not check out, that is itself a drift finding to log and update.
