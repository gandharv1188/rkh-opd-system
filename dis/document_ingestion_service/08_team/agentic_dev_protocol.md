# Agentic Product Development Protocol (end-to-end)

> How a feature goes from a one-line user idea through research, design,
> agentic implementation, verification, release, and post-release care —
> in a repeatable, no-corner-cutting way. Per-stage status column shows
> whether the current DIS build already follows the stage.

## Legend

- **Status — Y** = doing this today (demonstrably in a committed file on the current `feat/dis-plan` lineage)
- **Status — P** = partial / informal (exists in spirit, incomplete in artefact, or documented but not yet exercised)
- **Status — N** = not yet (absent from the repo or the operational routine)

Status rows are written honestly — ambition is captured in **Notes**, not
by inflating the Status column. Where a phase is doc-only today (plan
written, code not built), that is **P**, not **Y**, unless the doc itself
is the deliverable for the step.

---

## Phase 0 — Intake

The bridge from "someone has an idea" to "we have scoped work". Keep
it cheap: one page of framing beats a week of speculative design.

| #   | Step                  | What it does                                                                                                                              | Status | Notes                                                                                       |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| 0.1 | Idea capture          | Human writes a one-line intent ("we need OCR for external records") and hands it to the orchestrator.                                     | Y      | User → orchestrator conversation is the intake channel today; no formal form yet.           |
| 0.2 | Problem framing       | Restate the problem in user-outcome terms, list who is affected, and name the smallest useful slice.                                      | Y      | `00_overview/north_star.md` reframes DIS from "OCR" to "verified structured clinical data". |
| 0.3 | Prior-art scan        | Review what already exists in-house (e.g. current `documents` bucket flow) and outside (vendor OCR options) before committing to a build. | P      | In-house context is referenced; no vendor / competitor scan artefact committed.             |
| 0.4 | Non-goals declaration | Name what we will deliberately **not** do in v1, so scope creep can be rejected cheaply.                                                  | Y      | `00_overview/non_goals.md` is explicit and binding.                                         |

---

## Phase 1 — Research

Research phase buys cheap insurance against architecture decisions that
later cost weeks to reverse. Done right, it is scoped and time-boxed.

| #   | Step                                            | What it does                                                                                                                                  | Status | Notes                                                                                                  |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| 1.1 | Domain research (medical / regulatory / vendor) | Get a working grasp of the clinical, legal, and vendor landscape before architecting: NABH, ABDM, DPDPA, Indian medical records law, etc.     | P      | Clinical/ABDM/NABH context lives in CLAUDE.md and `clinical_safety.md`; regulatory memo not committed. |
| 1.2 | Competitive / benchmark scan                    | Price/accuracy/ToS survey of competing vendors so adapter choice is defensible and swap criteria are written down.                            | N      | Adapters doc names providers but no benchmark scorecard exists yet.                                    |
| 1.3 | Data-residency + compliance analysis            | Decide where PHI may live (India-only buckets? cross-border transit?) and document the ruling with citations to DPDPA/ABDM.                   | P      | Portability doc assumes India-resident posture; no explicit DPDPA decision memo.                       |
| 1.4 | Cost modelling (per-unit + scaling)             | Per-document cost, 10x scale cost, break-even vs. in-house OCR — enough numbers to defend or revisit the build/buy call.                      | N      | No cost ledger or model in the repo.                                                                   |
| 1.5 | Spike tickets (time-boxed, throwaway)           | Short tickets ("spike: can Gemini return structured JSON in ≤4s for a blurry Hindi lab report?") whose output is a memo, not production code. | N      | No spike ticket type defined in `07_tickets/`; research happens ad hoc in chat.                        |

---

## Phase 2 — Product definition

Translate a validated idea into requirements concrete enough that an
agent can refuse to build something out of scope.

| #   | Step                                   | What it does                                                                                                           | Status | Notes                                                                                   |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| 2.1 | Product brief                          | One-pager capturing problem, users, outcomes, scope, out-of-scope, success metrics.                                    | Y      | `01_product/product_brief.md`.                                                          |
| 2.2 | User stories + role mapping            | Stories per actor (reception clerk, nurse, doctor, gatekeeper) with acceptance criteria.                               | Y      | `01_product/user_stories.md` plus `08_team/RACI.md`.                                    |
| 2.3 | Clinical / safety requirements (CS-##) | Enumerated, stable-numbered safety rules that every downstream ticket must trace to.                                   | Y      | `01_product/clinical_safety.md` with CS-1..CS-12.                                       |
| 2.4 | Success criteria (quantitative)        | Target numbers — e.g. nurse edit-rate ≤ X%, reject-rate ≤ Y%, time-to-verified ≤ Zs — measurable from telemetry.       | P      | Product brief names targets; telemetry to measure them is not yet wired.                |
| 2.5 | Risks + mitigations register           | List of what could go wrong (wrong lab value promoted, vendor outage, cost blow-up) with named mitigations and owners. | P      | Clinical-safety doc covers clinical risks; business/vendor/cost risks not consolidated. |

---

## Phase 3 — Architecture design

A design is "complete enough" when an agent with only the docs could
re-derive the same interfaces without asking a human clarifying
questions.

| #   | Step                                                | What it does                                                                                                       | Status | Notes                                                                         |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------- |
| 3.1 | Technical Design Document (TDD)                     | Canonical description of the system: components, state machine, flows, invariants. The contract agents implement.  | Y      | `02_architecture/tdd.md` (~430 lines, CS-linked).                             |
| 3.2 | Sequence diagrams                                   | Per-scenario sequences (happy path, stuck, reject, promotion, kill-switch) so concurrency/ordering is unambiguous. | Y      | `02_architecture/sequence_diagrams.md`.                                       |
| 3.3 | Ports & adapters interfaces                         | Every external dependency behind a typed port; adapter is swappable by config.                                     | Y      | `02_architecture/adapters.md` names ports for OCR, LLM, storage, DB, secrets. |
| 3.4 | Portability plan (cloud A → cloud B)                | A dry-run-ready doc explaining how to move the system to a different cloud/provider without rewriting core logic.  | Y      | `02_architecture/portability.md`.                                             |
| 3.5 | Data model + migrations                             | Schema + forward migrations + rollback plan; migration files numbered and replayable.                              | Y      | `03_data/data_model.md` + `03_data/migrations.md` (M-001..M-008).             |
| 3.6 | API contract (OpenAPI)                              | Machine-readable request/response schema — the single source of truth for client + server.                         | Y      | `04_api/openapi.yaml`.                                                        |
| 3.7 | Error model                                         | Enumerated error codes, retry semantics, and which errors the orchestrator may auto-retry.                         | Y      | `04_api/error_model.md`.                                                      |
| 3.8 | Coding standards (SOLID / 12-factor / OWASP / a11y) | House rules for structure, security, accessibility so reviewers aren't relitigating taste in every PR.             | Y      | `02_architecture/coding_standards.md`.                                        |
| 3.9 | ADRs for non-trivial decisions                      | Architectural Decision Records capturing "chose X over Y because Z" — so reversals later have context.             | N      | No `adr/` folder; decisions live in chat and in TDD prose.                    |

---

## Phase 4 — Planning

Planning turns a design into a work graph that an army of agents can
actually execute in parallel without stepping on each other.

| #   | Step                                        | What it does                                                                                                    | Status | Notes                                                                            |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| 4.1 | Epics + dependency graph                    | Cluster tickets into epics A..G with explicit dependency arrows so waves can be parallelised safely.            | Y      | `07_tickets/epics.md` + prose dependency notes.                                  |
| 4.2 | Ticket backlog (Verify-Driven format)       | Each ticket has Brief, Acceptance Criteria, VERIFY commands, files-allowed list — so dispatch is deterministic. | Y      | `07_tickets/backlog.md` + `_ticket_template.md` + `05_testing/verify_format.md`. |
| 4.3 | Integration gate (what needs user sign-off) | Explicit list of tickets held until the human gatekeeper writes INTEGRATION APPROVED.                           | Y      | `07_tickets/integration_hold.md` (Epic G, DIS-200..207).                         |
| 4.4 | Feature-flag plan                           | Every user-visible change is behind a flag with clear on/off semantics and default.                             | Y      | `06_rollout/feature_flags.md`.                                                   |
| 4.5 | Rollout plan (shadow → opt-in → default)    | Staged exposure — shadow for safety, opt-in for learning, default for scale — with exit criteria per stage.     | Y      | `06_rollout/rollout_plan.md` (doc complete; execution not yet started).          |
| 4.6 | Kill switch design                          | One flag that turns the feature off hard, everywhere, in under one minute — and a tested runbook to use it.     | Y      | `06_rollout/kill_switch.md` + runbook in `09_runbooks/`.                         |

---

## Phase 5 — Agentic build

The fork between "AI-assisted coding" and "AI-driven team". This phase
is where most correctness and velocity is won or lost.

Phase 5a — team, isolation, dispatch:

| #   | Step                                                | What it does                                                                                                                                     | Status | Notes                                                                                        |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------- |
| 5.1 | Team / squad creation (persistent teammates)        | Named worker agents are created once and reused across tickets, so context (memory, tone, conventions) accrues instead of being rebuilt per run. | Y      | `dis-squad` with persistent `doc-*` and `dis-*` teammates is the current operating model.    |
| 5.2 | Worktree isolation protocol (Windows-safe)          | Every parallel agent works in its own `.claude/worktrees/<id>/` with forbidden sibling/main writes — prevents cross-agent file leakage.          | Y      | `windows-parallel-agents` v3 protocol is applied on every dispatch; enforced in task briefs. |
| 5.3 | Ticket dispatch (brief + acceptance + VERIFY steps) | Each dispatched task has a machine-checkable acceptance section so completion is objective, not vibes.                                           | Y      | `verify_format.md` + `_ticket_template.md`; dispatcher briefs follow the template.           |
| 5.4 | TDD test-first (failing test before impl)           | Worker writes a failing test, shows it red, then makes it green — design pressure comes from the test, not the implementer.                      | P      | `test_strategy.md` mandates TDD; observance varies per ticket and is not yet CI-enforced.    |
| 5.5 | Parallel wave execution                             | Independent tickets run concurrently in isolated worktrees; dependent tickets wait for the predecessor wave.                                     | Y      | Wave 1 (DIS-001..005) and Wave 2 (DIS-010..014) ran under this model; Wave 3 in progress.    |

Phase 5b — handoff, correction, drift, gaps, integration hold:

| #   | Step                                                               | What it does                                                                                                                        | Status | Notes                                                                                                       |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| 5.6 | Mid-flight course correction (SendMessage)                         | Orchestrator can adjust a running agent via direct message without killing the session — cheaper than a full re-dispatch.           | Y      | `SendMessage` tool used for clarifications; documented in session handoff §4 implicitly.                    |
| 5.7 | Session handoff per ticket                                         | Every agent writes `dis/handoffs/DIS-###.md` capturing decisions, acceptance evidence, follow-ups — before the final commit.        | Y      | `08_team/session_handoff.md` §3 — enforced at Gate 7.                                                       |
| 5.8 | Drift prevention (Phase 1 + Phase 2 controls)                      | Pre-dispatch checks and mid-flight scans that keep agents from silently wandering off-spec (e.g. renaming files, skipping CS refs). | P      | Phase-1 controls (brief-scoped files-allowed, sanity assertions) are in briefs; Phase-2 not yet rolled out. |
| 5.9 | Implementation-gap prevention (mutation / golden / property-based) | Techniques that catch "test passes but code is wrong" — mutation testing, golden fixtures, property-based tests on invariants.      | P      | Golden fixtures planned (`05_testing/fixtures.md`); mutation + property tests not yet introduced.           |

Phase 5c — the integration firewall:

| #    | Step                                  | What it does                                                                                                                                        | Status | Notes                                                                                   |
| ---- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| 5.10 | Integration hold — user-gated tickets | Any ticket touching live systems (live DB, live Edge Functions, `web/`) is physically held in `integration_hold.md` until the gatekeeper signs off. | Y      | Enforced by `07_tickets/integration_hold.md` — agents are forbidden from pulling these. |

---

## Phase 6 — Verification

Verification is what turns "agent claims done" into "provably done".
It is the single most important compounding investment.

| #   | Step                                                                      | What it does                                                                                                                         | Status | Notes                                                                                           |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------- |
| 6.1 | Unit tests (≥90% core)                                                    | Fast, pure tests on the core state machine / policy / services; coverage floor is a CI gate.                                         | P      | Target documented in `test_strategy.md`; coverage threshold not yet CI-enforced.                |
| 6.2 | Integration tests against sandbox adapters                                | Hit real adapters in a sandboxed mode — fake OCR vendor, fake LLM — so the wire contract is exercised, not just mocked.              | P      | `05_testing/integration_tests.md` specifies; implementation in Wave 3.                          |
| 6.3 | Orchestrator re-verification sampling (20% / 100% clinical)               | Orchestrator re-runs a sample of worker claims from raw evidence; clinical-safety tickets are re-verified at 100%.                   | P      | Rule stated in `review_gates.md`; sampling not yet automated.                                   |
| 6.4 | Clinical-acceptance fixtures (20+ anonymised docs)                        | A corpus of real-shaped documents with expected structured outputs — the closest thing to ground truth we'll have.                   | P      | `clinical_acceptance.md` and `fixtures.md` describe the corpus; corpus not yet populated.       |
| 6.5 | Red-team adversarial fixtures                                             | Documents designed to break the system (adversarial OCR, conflicting units, wrong name, forged headers) included in the test corpus. | N      | Not yet defined.                                                                                |
| 6.6 | Clinical reviewer sign-off                                                | Dr. Goyal signs off on each acceptance run before a rollout stage advances.                                                          | P      | Role defined in RACI; sign-off moments listed in `review_gates.md`; no runs to sign off on yet. |
| 6.7 | CI gate checks (lint, typecheck, ports, tokens, citations, files-allowed) | Automated PR gates: linting, type-check, secret scan, token-usage cap, citation/traceability tags, files-allowed diff check.         | P      | Gate definitions in `review_gates.md`; CI workflow not yet scaffolded.                          |
| 6.8 | Schema migration round-trip                                               | Every migration ships with a down-migration; CI runs forward → down → forward on an ephemeral DB.                                    | P      | Migrations authored; round-trip CI not yet.                                                     |
| 6.9 | Performance budget check                                                  | p95 latency / cost per 1K docs tracked against a budget; regressions fail the build.                                                 | N      | No perf harness yet.                                                                            |

---

## Phase 7 — Release

Release is a gradient, not an event. Each step reduces risk by exposing
the new behaviour to more traffic on an explicit schedule.

| #   | Step                             | What it does                                                                                                           | Status | Notes                                                                                |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| 7.1 | Shadow mode launch               | New system runs alongside the old one, producing output that is logged but not shown to users — purely for comparison. | N      | Shadow tickets (DIS-203) are written but on hold; not yet executed.                  |
| 7.2 | Opt-in rollout (per-operator)    | Turn the feature on for one reception clerk at a time; measure edit-rate before adding the next.                       | N      | DIS-206 held.                                                                        |
| 7.3 | Default rollout                  | Flip feature flag to default-on; legacy path remains available behind a flag until soak completes.                     | N      | DIS-207 held.                                                                        |
| 7.4 | Legacy removal after soak        | After a clean soak period, delete the legacy code path so maintenance cost doesn't compound.                           | N      | Not yet scheduled.                                                                   |
| 7.5 | Training + comms (roles × phase) | Per-role (clerk, nurse, doctor) micro-training assets tied to each rollout phase.                                      | P      | `06_rollout/comms_and_training.md` has the matrix; training assets not yet produced. |
| 7.6 | Feature-handoff document         | Orchestrator's final `FEATURE_HANDOFF.md` summarising what was built, where to find it, and who owns it.               | P      | Template defined in `session_handoff.md` §4; feature not yet complete.               |

---

## Phase 8 — Operate & learn

A shipped feature is a liability until it is observable and maintained.
This phase is where ongoing cost-of-ownership either stays flat or
compounds.

Phase 8a — telemetry, cost, audit, alerting:

| #   | Step                                                    | What it does                                                                                                              | Status | Notes                                                                          |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| 8.1 | Observability (logs, metrics, tracing, correlation IDs) | Every request carries a correlation ID through every component; metrics are scraped and alertable.                        | P      | Logging + correlation IDs are in the TDD; runtime telemetry not yet wired.     |
| 8.2 | Cost ledger + monthly review                            | Per-provider usage ledger with monthly review — so cost drift doesn't become the next surprise.                           | N      | Not yet.                                                                       |
| 8.3 | Weekly clinician sample audit                           | Dr. Goyal spot-audits a weekly sample of promoted documents; audit outcomes feed back into the fixture corpus.            | P      | Cadence in `review_gates.md`; no audits run yet (no prod data).                |
| 8.4 | Error-rate alerting + SEV triage                        | Automated alerts on error-rate spikes; incident SEV levels with response SLAs.                                            | P      | `09_runbooks/incident_response.md` defines SEV levels; alerting not yet wired. |
| 8.5 | Incident response runbooks                              | Written, tested runbooks for the known failure modes — stuck jobs, provider outage, migration incident, DR, key rotation. | Y      | `09_runbooks/*.md` cover six scenarios.                                        |

Phase 8b — drills, post-mortem, model drift, dashboards:

| #   | Step                                         | What it does                                                                                                    | Status | Notes                                                                  |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| 8.6 | Key rotation drill (quarterly)               | Rotate provider keys / Supabase service key on a schedule; never in response to incident-only.                  | P      | Runbook exists (`09_runbooks/key_rotation.md`); no drill has been run. |
| 8.7 | DR restore drill (quarterly)                 | Restore from backup into a sandbox and verify data shape + app boot; proves the DR doc isn't fiction.           | P      | Runbook exists; no drill executed.                                     |
| 8.8 | Post-mortem (blameless) on SEV1/SEV2         | Every major incident gets a written blameless post-mortem; actions feed the backlog with owners and dates.      | P      | Template implied in runbook; no incidents yet.                         |
| 8.9 | Prompt eval harness (Forge / custom rubrics) | Automated evals against the LLM/OCR prompts with rubric-scored outputs; prevents silent drift as models change. | N      | Not yet introduced.                                                    |

Phase 8c — the product-level metric:

| #    | Step                                    | What it does                                                                                                | Status | Notes                                        |
| ---- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------- |
| 8.10 | Nurse edit-rate + reject-rate dashboard | Live dashboards for the two headline metrics; rollout decisions are made from the chart, not from gut feel. | N      | Metric definitions exist; dashboards do not. |

---

## Phase 9 — Iterate

Post-launch, the system keeps paying down debt and picking up learnings.
Iteration is cheap only if the earlier phases were honest.

| #   | Step                                                | What it does                                                                                                       | Status | Notes                                                                               |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------- |
| 9.1 | Retrospective per wave                              | After each agent wave, a 30-minute retro: what went well, what cost time, what becomes a rule next time.           | P      | Retros happen ad hoc in user/orchestrator chat; no written retro template yet.      |
| 9.2 | ADR updates when decisions change                   | When we reverse a past call, write a superseding ADR rather than silently editing history.                         | N      | No ADR system in place, so no reversals are recorded formally.                      |
| 9.3 | Tech-debt register                                  | One append-only list of known debt items with rough cost and trigger ("fix when traffic × 10").                    | N      | Not yet a dedicated file.                                                           |
| 9.4 | Innovation slot (1–2 days per epic)                 | Time explicitly reserved per epic for an agent/engineer to propose an improvement outside the backlog.             | N      | Not scheduled.                                                                      |
| 9.5 | Quarterly portability dry-run (e.g. Supabase → AWS) | Actually walk through the portability doc — not just read it — in a sandbox, to keep it honest.                    | N      | Doc exists; no dry-run executed.                                                    |
| 9.6 | End-of-feature handoff (orchestrator deliverable)   | The feature-level `FEATURE_HANDOFF.md` is the last thing shipped — architecture, ownership, open risks, next bets. | P      | Template defined in `session_handoff.md`; no feature has yet shipped to trigger it. |

---

## Cross-cutting concerns (not a phase — always-on)

These apply in every phase. If one slips, it doesn't fail a gate
visibly — it shows up months later as a security bug, a bill, or a
regulatory letter.

| #   | Step                                             | What it does                                                                                                                          | Status | Notes                                                                                 |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| X.1 | Secret handling (Secrets Adapter only)           | All secrets flow through a single typed port; no `process.env` reads scattered through business logic.                                | P      | Adapter specified in `adapters.md`; not all call sites migrated yet.                  |
| X.2 | PHI scrubbing in logs                            | Logs pass through a scrubber before leaving the process; tests assert no names/UHIDs appear in log output.                            | P      | Rule stated in coding_standards; scrubber + tests not yet in place.                   |
| X.3 | Accessibility (WCAG AA) on any UI                | Every UI surface meets WCAG AA — tab order, contrast, keyboard nav, aria labels.                                                      | P      | Required in coding_standards; no audit run on existing `web/` pages.                  |
| X.4 | Security review on auth / RLS / boundary changes | Any change to RLS, auth flows, or trust boundaries requires a security review note on the PR.                                         | P      | Review gates define it; no changes yet to exercise it.                                |
| X.5 | Conventional Commits + ADRs                      | Commit history is machine-parseable; architectural changes land with an ADR alongside the code diff.                                  | P      | Commit style is followed; ADR half is missing (see 3.9 / 9.2).                        |
| X.6 | Append-only audit log                            | Every promotion / override / reject is written to an append-only table that can reconstruct the full clinical decision trail.         | Y      | CS-10 / CS-11 and migration M-007 mandate it; writer ticket is DIS-024 (in progress). |
| X.7 | Windows-parallel-agents v3 protocol              | Worktree isolation, forbidden paths, re-anchor, write-path assertion — the engineering safety net for parallel agent work on Windows. | Y      | Applied on every dispatch. Documented in the `windows-parallel-agents` skill.         |

---

## Summary matrix

Counts below are across rows in each phase. `X/Y` = Y rows marked as
doing (`Y`), partial (`P`), or not-yet (`N`).

| Phase                   | Rows |   Y |   P |   N |
| ----------------------- | ---: | --: | --: | --: |
| Phase 0 — Intake        |    4 |   3 |   1 |   0 |
| Phase 1 — Research      |    5 |   0 |   2 |   3 |
| Phase 2 — Product       |    5 |   3 |   2 |   0 |
| Phase 3 — Architecture  |    9 |   8 |   0 |   1 |
| Phase 4 — Planning      |    6 |   6 |   0 |   0 |
| Phase 5 — Agentic build |   10 |   7 |   3 |   0 |
| Phase 6 — Verification  |    9 |   0 |   7 |   2 |
| Phase 7 — Release       |    6 |   0 |   2 |   4 |
| Phase 8 — Operate       |   10 |   1 |   6 |   3 |
| Phase 9 — Iterate       |    6 |   0 |   2 |   4 |
| Cross-cutting (X.\*)    |    7 |   2 |   5 |   0 |

One-liners per phase:

- **Phase 0 — 3/4 done** (1 partial, 0 not started) — intake is lightweight but explicit.
- **Phase 1 — 0/5 done** (2 partial, 3 not started) — research is the weakest early-stage phase.
- **Phase 2 — 3/5 done** (2 partial, 0 not started) — definition is solid, measurement/risk register lags.
- **Phase 3 — 8/9 done** (0 partial, 1 not started) — architecture is the strongest phase; only ADRs missing.
- **Phase 4 — 6/6 done** (0 partial, 0 not started) — planning is complete on paper.
- **Phase 5 — 7/10 done** (3 partial, 0 not started) — the agentic-build backbone is in place; drift + gap controls are the open edge.
- **Phase 6 — 0/9 done** (7 partial, 2 not started) — verification is widely planned but not yet exercised end-to-end.
- **Phase 7 — 0/6 done** (2 partial, 4 not started) — release is gated; nothing has rolled out yet by design.
- **Phase 8 — 1/10 done** (6 partial, 3 not started) — operate-and-learn is mostly prospective; runbooks exist, telemetry does not.
- **Phase 9 — 0/6 done** (2 partial, 4 not started) — iteration rituals are not yet started because the feature hasn't shipped.
- **Cross-cutting — 2/7 done** (5 partial, 0 not started) — safety net is real in principle; most of it still needs the wiring to make it enforceable.

---

## What's missing most urgently

The 5–8 items below, currently `N` or `P`, would compound correctness
and velocity the most if addressed in the next wave or two.

- **3.9 ADRs for non-trivial decisions.** The architecture is strong but the _reasons_ live in chat. Without ADRs, the next reviewer (human or agent) cannot tell which decisions are load-bearing vs. incidental, which makes refactors dangerous.
- **5.9 Implementation-gap prevention (mutation / golden / property-based).** Today a passing test set does not rule out a wrong implementation; adding mutation testing on the policy layer and golden-file fixtures for the extractor would close the most expensive class of silent bugs.
- **6.4 Clinical-acceptance fixtures (20+ real-shaped docs).** Without the corpus, rollout decisions will rest on vibes. This is the single artefact that turns the whole verification phase from aspirational into measurable.
- **6.7 CI gate checks wired in.** Gates are documented but not enforced. One GitHub Actions workflow (lint + typecheck + files-allowed diff + secret scan + coverage threshold) converts human vigilance into automation.
- **8.1 / 8.10 Observability + nurse edit-rate dashboard.** Shadow and opt-in rollouts are meaningless without the telemetry to judge them. Correlation IDs + a simple edit-rate/reject-rate view unblocks every downstream rollout decision.
- **8.9 Prompt eval harness.** The system leans on an LLM. Without an automated eval run pinned to each prompt change, silent regressions on model upgrades are near-certain.
- **1.4 Cost modelling.** A one-page per-unit + 10×-scale model would change architecture conversations (batch vs. stream, vendor swap thresholds) from speculative to defensible. Cheap to produce; high leverage.
- **5.8 Drift prevention — Phase 2 controls.** Phase 1 drift controls exist in briefs. Phase 2 (mid-flight scans for off-spec changes, forbidden-file tripwires) converts drift prevention from "write a careful brief" into "the system blocks the mistake". This is the next natural step now that Waves 1–2 have demonstrated the parallel-agent model works.

---

## Phase notes — why each phase exists, what good looks like, common failure modes

The tables above give the "what". This section gives the "why" and the
taste-test, so future readers can judge whether a given step is being
done well, done theatrically, or quietly skipped.

### Phase 0 — Intake

**Why it exists.** Product-level mistakes are cheap to fix at intake
and expensive to fix everywhere downstream. An unframed idea
("add OCR") becomes a different product than a framed one ("turn
external documents into verified structured data a nurse trusts").
Intake is where that framing happens.

**What good looks like.** Ten minutes of writing beats ten hours of
guessing. A single page answers: who is the user, what is the
smallest useful slice, what is explicitly out of scope, and what
does "done" feel like to the user. The non-goals list is the quiet
hero — it pre-declines half of the drift pressure the project will
see later.

**Common failure modes.** Rushing past framing into architecture;
using "OCR" as a shorthand that hides disagreements about scope;
omitting non-goals and then re-litigating them mid-build.

### Phase 1 — Research

**Why it exists.** Architecture decisions made without domain,
vendor, or cost knowledge tend to be wrong in ways that only show
up under scale. Research is the cheapest part of the whole pipeline
and the one most often skipped.

**What good looks like.** A short, dated memo per topic (regulatory,
vendor scorecard, cost model, residency) with citations. Each memo
ends with a decision or an explicit "unknown — revisit when X".
Spike tickets are tiny, time-boxed, and produce memos — not
production code.

**Common failure modes.** Tacit research (it lives in chat and
evaporates); unbounded spikes that become parallel implementations;
vendor comparisons done on marketing pages rather than measured
behaviour.

### Phase 2 — Product definition

**Why it exists.** Agents executing tickets cannot negotiate scope
from first principles. They need a crisp product spec and an
enumerated safety list to refuse out-of-scope work.

**What good looks like.** User stories that read like acceptance
criteria; safety requirements numbered and stable (CS-1 never
renumbers); success metrics that are quantitative and measurable
from the telemetry you actually plan to ship. A risk register that
names owners, not just risks.

**Common failure modes.** Vague stories ("user can upload a
document"); safety rules that drift between documents; success
criteria stated only qualitatively ("it should be fast").

### Phase 3 — Architecture design

**Why it exists.** The TDD is the contract that every agent implements
against. If it is ambiguous, agents will resolve ambiguity inventively
and divergently. If it is rigorous, agents converge.

**What good looks like.** A TDD detailed enough that two independent
agents, given only the docs, would produce interfaces that match.
Every external dependency is behind a port; every error is enumerated;
every non-trivial decision has an ADR.

**Common failure modes.** Architecture-by-diagram (lots of boxes,
no interfaces); "we'll figure out errors later"; no ADRs, so the
next refactor is blind.

### Phase 4 — Planning

**Why it exists.** Parallel agentic execution only compounds velocity
if tickets are independent. Planning is the work of making independence
real and visible.

**What good looks like.** Epics with a dependency graph, tickets in
a Verify-Driven format, integration hold made physical (a separate
file agents are forbidden to pull from), feature flags and kill
switches designed before the code is written.

**Common failure modes.** "Plan" that is a flat list with hidden
dependencies; integration tickets that sneak into the normal backlog;
feature flags bolted on post-hoc, defeating their purpose.

### Phase 5 — Agentic build

**Why it exists.** This is the execution phase where all the earlier
investment pays off — or fails to. Agentic build is where drift,
silent gaps, and isolation bugs show up.

**What good looks like.** Persistent named teammates; worktree
isolation enforced every time; failing test before implementation;
mid-flight course correction via message rather than re-dispatch;
session handoffs written as the last file before commit. Integration
tickets never move into in-progress without a written approval.

**Common failure modes.** One-shot agent summoning that loses context
per ticket; shared working trees on Windows that stomp each other;
tests written after implementation (and therefore aligned to the bug);
handoffs omitted under time pressure.

### Phase 6 — Verification

**Why it exists.** "Agent says done" is not "done". Verification
converts claims into evidence: tests run, samples re-verified, fixtures
matched, gates passed. It is the single biggest compounding investment
in the whole protocol.

**What good looks like.** Coverage thresholds enforced in CI;
integration tests run against sandbox adapters, not mocks; a clinical
acceptance corpus that is real-shaped and adversarial; performance
budgets that fail the build on regression.

**Common failure modes.** Coverage reported but not gated; tests
against mocks that lie; acceptance fixtures that only cover the happy
path; performance checked only in production.

### Phase 7 — Release

**Why it exists.** A release is a probability-of-harm operation. Staged
rollout converts unknowns into measurable ones before exposing all
users.

**What good looks like.** Shadow mode that is actually compared to
the legacy path; opt-in that is per-operator and measured; default
rollout only after a defined soak; legacy removal scheduled and done.
Training material per role, per phase.

**Common failure modes.** "Shadow" that nobody compares; opt-in that
never becomes default because exit criteria weren't defined; legacy
paths that accumulate forever; training that goes out once in email
and is never read.

### Phase 8 — Operate & learn

**Why it exists.** Software that ships without observability decays
silently. Operate-and-learn is the phase that keeps the cost of
ownership flat.

**What good looks like.** Correlation IDs on every request; cost
ledger reviewed monthly; weekly clinician audit feeding back into
fixtures; incident runbooks that are rehearsed, not written and
forgotten; prompt eval harness pinned to every prompt change.

**Common failure modes.** Logging without correlation; cost discovered
on the invoice; runbooks that are untested fiction; model upgrades
that silently regress behaviour because nothing measured the delta.

### Phase 9 — Iterate

**Why it exists.** Every feature generates debt, surprise, and
learning. Iteration rituals turn those into improvements rather than
entropy.

**What good looks like.** Retros per wave that produce written rules;
ADR reversals done openly; tech-debt register that is consulted
before new epics are scoped; a quarterly portability dry-run that
finds the rust before it matters.

**Common failure modes.** No retros; decisions silently reversed
without superseding ADRs; tech debt tracked only in individual heads;
portability docs that have never been exercised.

### Cross-cutting concerns

**Why they exist.** Some disciplines (secret handling, PHI scrubbing,
accessibility, security review, audit logging) must be present in
every phase. Treating them as a single phase means they get skipped
whenever a phase runs short on time.

**What good looks like.** A typed secrets port that is the only way
to read secrets; a log scrubber with assertions; WCAG AA checked per
PR when UI changes; security review notes on any auth/RLS/boundary
change; an append-only audit log that can reconstruct the full
clinical trail.

**Common failure modes.** `process.env` scattered through business
logic; PHI in logs discovered during an incident; accessibility
"later"; audit log that is actually mutable.

---

## How to use this document

- **Onboarding a new agent or engineer.** Read Phase 0–2 to understand
  the product; skim Phase 3–4 to understand the interfaces; read
  Phase 5 in full.
- **Starting a new feature.** Use the phases as a checklist — any
  step you intend to skip should be a deliberate decision, written
  down somewhere.
- **Quarterly review.** Re-score the Status column. Entries should
  move right (N → P → Y), not the other way. Regressions indicate
  rituals that are being skipped under pressure.
- **Hiring and delegation.** The phases line up with natural
  specialisations — a product researcher owns Phase 0–2, an architect
  owns Phase 3–4, an orchestrator owns Phase 5, a QA/clinical lead
  owns Phase 6, a release manager owns Phase 7, SRE owns Phase 8, and
  everyone owns Phase 9.

This document is meant to be boring in the best way: predictable,
durable, and hard to argue with. If a future wave starts cutting
corners, the first question should be "which row are we skipping, and
is it written down?".
