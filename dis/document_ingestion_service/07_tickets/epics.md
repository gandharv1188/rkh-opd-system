# Epics

Each epic is a coherent slice of work with its own acceptance outcome.
Tickets live under one epic. Epics do not cross the integration gate
unless they explicitly say so.

## Dependency graph

```
A (Foundations) ──► B (Core + Ports) ──► C (Adapters) ──► D (Orchestration)
                                                              │
                                                              ▼
                                                         E (Verification UI)
                                                              │
                                                              ▼
                                              F (Observability + Safety audits)
                                                              │
                                                              ▼
                                            ┌──── G (Integration) [HELD — user gate]
                                            │
                                            ▼
                                    H (AWS Port dry-run)
```

Epics A–F are fully executable by agents without touching the existing
system. Epic G is held behind the integration gate. Epic H validates
portability on AWS sandbox.

---

## Epic A — Foundations

**Goal:** the skeleton of the service builds, tests pass, nothing does
anything useful yet.

**Acceptance:**

- `dis/` directory exists with the layout from `02_architecture/adapters.md`.
- `npm install && npm test` runs green on a fresh clone.
- Dockerfile produces an image that boots and answers `GET /health`.
- CI pipeline runs (GitHub Actions workflow file).
- No adapter code yet — just ports as interface files.

**Tickets:** DIS-001..DIS-015 (project scaffolding, tooling, CI, health endpoint, port interface stubs).

**Touches existing system:** No. All new files under `dis/`.

---

## Epic B — Core business logic

**Goal:** the state machine, orchestrator, confidence policy, promotion
service, audit logger — all pure TypeScript, tested with fakes only.

**Acceptance:**

- `dis/src/core/*` fully implemented to TDD §4, §6, §12, §13.
- Unit test coverage ≥ 90% in `core/`.
- All CS-1..CS-12 clinical-safety tests pass against the core with fake adapters.
- Port validator (no adapter imports in core) is green.

**Tickets:** DIS-020..DIS-045 (orchestrator state machine, optimistic lock, confidence policy, promotion with CS-10/CS-11 guards, audit log append-only enforcement, tests).

**Touches existing system:** No.

---

## Epic C — Adapters (POC stack)

**Goal:** real adapters for the Supabase stack + the Datalab and Claude
providers. Each adapter has a fake peer for tests.

**Acceptance:**

- `DatalabChandraAdapter` passes integration test against the sandbox API ($5 free credit).
- `ClaudeHaikuAdapter` passes structuring contract tests.
- `SupabaseStorageAdapter`, `SupabasePostgresAdapter`, `SupabaseSecretsAdapter`, `PgCronAdapter` all pass contract tests.
- `ClaudeVisionAdapter` (fallback) mirrors current `process-document` behavior; integration test matches output shape.
- `DefaultFileRouter` implements the decision tree in TDD §7.
- `DefaultPreprocessor` implements TDD §8 (deskew + blank-page drop + resize + contrast + JPEG encode).

**Tickets:** DIS-050..DIS-085 (one per adapter, plus fake peer, plus contract test suite).

**Touches existing system:** No — adapters run in the DIS service only. Uses existing Supabase project's Storage / Postgres as a backend, but only creating new tables (`ocr_extractions`, etc.) via its own migrations, which are **not yet applied** until Epic F.

---

## Epic D — Orchestration layer

**Goal:** the HTTP endpoints wire the core to adapters; a real
extraction flows end-to-end.

**Acceptance:**

- All OpenAPI endpoints (`/ingest`, `/extractions/:id`, `/approve`, `/reject`, `/retry`, `/admin/metrics`, `/internal/process-job`) implemented.
- End-to-end test: upload a fixture PDF → extraction reaches `ready_for_review` within P95 target.
- Idempotency, optimistic locking, realtime status push all tested.
- Worker endpoint processes queue jobs without crashing under repeated failures.

**Tickets:** DIS-090..DIS-110 (HTTP server, route handlers, queue worker, realtime push, metrics endpoint).

**Touches existing system:** No.

---

## Epic E — Verification UI

**Goal:** a new standalone web page that nurses use to verify extractions.

**Acceptance:**

- `dis/ui/` holds a standalone SPA (or static HTML if chosen) that talks to DIS API only.
- Queue page, side-by-side verification page, approve/reject flows, duplicate warning, bounding-box overlay (when present).
- Accessible (WCAG AA) and works offline-first for in-progress verifications (localStorage).
- Lighthouse perf ≥ 85 on the queue page.
- Not linked from `web/` yet — stands alone on its own route.

**Tickets:** DIS-115..DIS-140 (UI scaffolding, queue view, detail view, edit form, approval flow, rejection flow, tests via Playwright).

**Touches existing system:** No — new page under `dis/ui/`. Not linked from registration.html or prescription-pad.html.

---

## Epic F — Observability, safety audits, migrations-in-staging

**Goal:** DIS is observable, auditable, and its migrations are ready to
apply but **not yet applied** to the live database.

**Acceptance:**

- Structured logs + metrics + traces (TDD §14).
- Migrations M-001..M-008 executable against a Supabase **staging** project (cloned from prod schema, no live data).
- M-009 documented but not applied.
- Clinical-safety test suite (all CS-1..CS-12) runs against staging + returns pass.
- Weekly clinician audit workflow defined and dry-run performed on fixture data.
- Runbooks (Epic-B-level) validated via tabletop exercises.

**Tickets:** DIS-145..DIS-175 (logging, metrics, tracing, audit export, migration apply in staging, clinician audit dry-run).

**Touches existing system:** No — staging is a separate Supabase project. The live Supabase DB is untouched.

---

## Epic G — Integration with existing system [HELD]

> **This epic is in `integration_hold.md`. No ticket may be pulled
> without the Integration Gatekeeper's written approval per §6b of
> `review_gates.md`. The user (Dr. Lokender Goyal) controls the gate.**

**Goal:** DIS replaces the current `process-document` call from
registration.html, and existing clinical tables gain the verification
columns.

**Tickets (drafted, held):**

- DIS-200: apply M-001..M-008 to **live** Supabase database
- DIS-201: apply M-006 (add FK columns to `lab_results` / `vaccinations`)
- DIS-202: modify `registration.html:onDocFileSelected` + `uploadDocuments` to POST to DIS instead of legacy `process-document`
- DIS-203: feature-flag `DIS_SHADOW_MODE` — run both pipelines, write DIS to `ocr_extractions` only
- DIS-204: modify `loadRecentLabs()` in prescription-pad.html to filter by `verification_status`
- DIS-205: modify `get_lab_history` tool in `generate-prescription` similarly
- DIS-206: opt-in phase — flag per-operator
- DIS-207: default phase — DIS becomes primary
- DIS-208: apply cutover migration M-009
- DIS-209: delete legacy `process-document` Edge Function after soak

Each of these carries the `integration` tag and cannot execute without
user approval.

---

## Epic H — AWS port dry-run

**Goal:** prove portability by running the clinical-acceptance suite
against a fresh AWS deployment.

**Acceptance:**

- Terraform provisions a sandbox AWS account end-to-end.
- `DIS_STACK=aws` wiring composes S3/RDS/SQS/SecretsManager adapters.
- Clinical-acceptance fixtures pass against the AWS deployment.
- Port duration + code-change count recorded; target: zero core changes.

**Tickets:** DIS-220..DIS-235 (Terraform, wiring, adapter implementations, CI for AWS sandbox, dry-run runbook).

**Touches existing system:** No. Isolated sandbox account.

---

## Epic sequencing

Target cadence: one epic per 1-2 weeks with agent waves of 3-8
tickets. Architect runs `windows-parallel-agents` orchestration each
wave.

Epic G (integration) is expected weeks after A-F complete — whenever
the user chooses to flip the integration switch. Epic H can run in
parallel with G.
