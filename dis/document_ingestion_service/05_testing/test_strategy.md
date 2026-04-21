# Test Strategy — Document Ingestion Service

> Owner: QA Lead. Binding on every DIS ticket. Any PR that lowers coverage or
> bypasses a CI gate blocks merge. References: TDD §1–§20, CS-1..CS-12,
> `01_product/user_stories.md`, `02_architecture/adapters.md`.

## 1. Guiding principles

1. **TDD is enforced at the ticket level.** A test ticket with a committed,
   failing test precedes every implementation ticket (see README §Execution
   rules). CI rejects any implementation PR whose linked test ticket does
   not show at least one commit with a `RED` marker.
2. **Pure core, dirty edges.** Business logic in `dis/src/core/` is tested
   with fakes only. Adapters are tested against their ports plus live
   sandboxes. See `02_architecture/adapters.md` §Fakes.
3. **Every clinical-safety rule maps to a named test.** CS-1..CS-12 each
   have a canonical test file and an explicit assertion — tracked in the
   table in §7 below.
4. **Fixtures are first-class.** Clinical acceptance is driven by a
   curated, versioned fixture set (see `fixtures.md`).
5. **Cloud-portable tooling only.** Vitest (or Jest) + supertest + testcontainers
   for Postgres. No Supabase-specific test harnesses. Avoid Deno-only APIs
   so tests run identically on AWS Lambda build.

## 2. Test pyramid

| Layer                                                                     | Tooling                                      | Target share        | Blocks merge?                  |
| ------------------------------------------------------------------------- | -------------------------------------------- | ------------------- | ------------------------------ |
| Unit (pure core, fakes)                                                   | Vitest                                       | ~70% of total tests | yes                            |
| Integration (real adapters → sandbox Postgres + provider sandboxes/fakes) | Vitest + supertest + testcontainers-postgres | ~22%                | yes                            |
| Clinical acceptance (fixture-driven, golden files, human sign-off)        | Vitest + golden-file diff                    | ~6%                 | yes (dataset snapshot)         |
| E2E / UI smoke (Playwright against verification UI)                       | Playwright                                   | ~2%                 | yes (only happy path + reject) |

Percentages are targets, not quotas. What matters: every CS-## has a test
at the correct layer (unit where pure logic, integration where DB/adapter
involvement).

## 3. Coverage requirements

| Path                                                 | Statement coverage | Branch coverage | Notes                                                         |
| ---------------------------------------------------- | ------------------ | --------------- | ------------------------------------------------------------- |
| `src/core/**`                                        | ≥ 90%              | ≥ 85%           | Pure logic — no excuse.                                       |
| `src/adapters/**` (non-network)                      | ≥ 80%              | ≥ 70%           | File router, preprocessor, default adapters.                  |
| `src/adapters/ocr/**`, `src/adapters/structuring/**` | ≥ 70%              | ≥ 60%           | Network boundaries tested via fake + one sandbox integration. |
| `src/http/**`                                        | ≥ 80%              | ≥ 70%           | Route handlers thin; tested via supertest.                    |
| `web/verification-ui/**`                             | smoke only         | —               | Playwright happy path + reject path.                          |

CI gate: `vitest run --coverage` must pass the thresholds above. Drop in
any directory fails the build.

## 4. TDD enforcement (concrete mechanics)

1. Every implementation ticket in `07_tickets/` lists a `test_ticket` field.
2. PR template has a checkbox: `[ ] failing test committed before impl commit`.
3. A lint hook (`scripts/assert-tdd-order.sh`) inspects `git log --oneline
origin/main..HEAD` on the PR branch and fails if the first test file
   touching the impl area was introduced _after_ the first impl file.
4. For clinical-safety tickets: the failing test commit must include
   `[RED][CS-##]` in the subject. A subsequent commit flipping it to green
   must include `[GREEN][CS-##]`.

## 5. Test double strategy (adapters.md §9)

Every port has a fake adapter under `dis/src/adapters/<port>/__fakes__/`.
Core unit tests import fakes exclusively.

| Port               | Fake class                                                                                      | Test-time behaviour                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `OcrPort`          | `FakeOcrAdapter`                                                                                | Canned `OcrResult` per fixture key; can inject provider errors + latency. |
| `StructuringPort`  | `FakeStructuringAdapter`                                                                        | Canned `ClinicalExtraction`; schema-invalid response mode for error path. |
| `StoragePort`      | `InMemoryStorageAdapter`                                                                        | Map-backed blob store. Supports signed-URL simulation.                    |
| `DatabasePort`     | `TestcontainersPostgresAdapter` for integration; `FakeDatabaseAdapter` for unit.                |
| `QueuePort`        | `SyncQueueAdapter`                                                                              | Executes jobs inline; deterministic.                                      |
| `SecretsPort`      | `EnvSecretsAdapter`                                                                             | Reads from process env in tests.                                          |
| `FileRouterPort`   | Real impl — pure logic; no fake needed.                                                         |
| `PreprocessorPort` | Real impl tested with synthetic images; `FakePreprocessor` pass-through for orchestrator tests. |

Fakes MUST implement the same `// port-version: N` that the real adapter
implements (adapters.md §Change control). A version mismatch fails a
compile-time check in `tests/assert-fake-parity.test.ts`.

## 6. CI gates (what blocks merge)

Order of execution in `.github/workflows/dis-ci.yml` (fail-fast):

1. `pnpm lint` — ESLint + Prettier + `no-restricted-imports` rule
   blocking `adapters/*` from `core/*`.
2. `pnpm typecheck` — strict TS, no `any` outside declared escape hatches.
3. `pnpm test:unit --coverage` — thresholds from §3.
4. `pnpm test:integration` — spins up testcontainers Postgres, applies
   migrations, runs integration suite against fakes for external providers
   by default; `CI_USE_LIVE_PROVIDERS=1` unlocks sandbox providers on the
   nightly job.
5. `pnpm test:clinical` — fixture-driven golden file suite (see
   `clinical_acceptance.md`). Dataset snapshot must match or be
   explicitly re-approved in the PR.
6. `pnpm migrate:roundtrip` — applies every migration forward, then every
   `down` in reverse, then forward again. Must finish clean.
7. `pnpm openapi:lint` — `04_api/openapi.yaml` valid; route handlers match
   the spec (`supertest-openapi` response validator).
8. `pnpm security:scan` — secret scanner + dependency audit.
9. `pnpm test:e2e:smoke` — Playwright happy path + reject path only
   (full E2E runs nightly).

Any red step = no merge. No `--skip-tests` flag. No `--no-verify`.

## 7. CS-1..CS-12 → test mapping

Every row below is a binding contract. If the file doesn't exist, the
acceptance criterion isn't met and the ticket can't close.

| CS    | Requirement (short)                         | Test file                                       | Test name                                                                                     |
| ----- | ------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| CS-1  | No unverified row in clinical tables        | `tests/integration/promotion.cs1.test.ts`       | `rejects promotion of pending_review extraction with 409`                                     |
| CS-2  | Raw responses preserved forever             | `tests/integration/audit_retention.cs2.test.ts` | `raw_ocr_response and raw_structured_response survive 6-month simulated clock`                |
| CS-3  | Every clinical row → one extraction (FK)    | `tests/integration/schema.cs3.test.ts`          | `cannot delete extraction while lab_results references it`                                    |
| CS-4  | Verified values not silently overwritten    | `tests/integration/duplicate.cs4.test.ts`       | `re-ingest same hash yields 2 extractions, 0 clinical mutations`                              |
| CS-5  | Reject is permanent                         | `tests/integration/state_machine.cs5.test.ts`   | `approve on rejected extraction returns INVALID_STATE_TRANSITION`                             |
| CS-6  | Edits logged field-by-field                 | `tests/unit/audit-log.cs6.test.ts`              | `two edited fields produce two field_edit audit rows with before/after`                       |
| CS-7  | Confidence gates explicit + default off     | `tests/unit/confidence-policy.cs7.test.ts`      | `default policy marks every extraction pending_review; enabling requires audit row`           |
| CS-8  | PII stays within patient boundary           | `tests/integration/rls.cs8.test.ts`             | `nurse scoped to patient A reads zero rows for patient B`                                     |
| CS-9  | Test-name normalization is audited          | `tests/unit/structuring.cs9.test.ts`            | `raw test_name_raw preserved separately from test_name_normalized in raw_structured_response` |
| CS-10 | Discharge summary latest-only               | `tests/unit/promotion.cs10.test.ts`             | `7 TSB readings → 1 lab_results row with latest test_date`                                    |
| CS-11 | Duplicate-row prevention                    | `tests/integration/promotion.cs11.test.ts`      | `second promotion of same extraction inserts 0 rows, logs skip per row`                       |
| CS-12 | No OCR data reaches Rx generator unverified | `tests/integration/rx_filter.cs12.test.ts`      | `get_lab_history returns 0 rows when only ai_extracted pending_review exists`                 |

Every test above additionally carries a `// CS-##` comment tag so grep
audits are trivial.

## 8. Non-functional testing

| Target (TDD §18)        | Test                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| P50 `/ingest` < 1 s     | k6 smoke in `tests/perf/ingest.k6.ts`, nightly.                                     |
| P95 end-to-end < 90 s   | Integration run over 50 fixtures, p95 asserted.                                     |
| Kill-switch RTO < 5 min | `tests/integration/kill_switch.test.ts` measures route-swap latency.                |
| Cost ≤ ₹0.40/doc        | `tests/clinical/cost_budget.test.ts` asserts `dis_cost_ledger` sum per fixture run. |

## 9. Environments

- **Local:** Vitest + testcontainers-postgres + all fakes. No network.
- **CI sandbox:** GitHub-hosted runner, testcontainers, provider fakes by
  default. Nightly `live-providers` job hits Datalab sandbox + Anthropic
  sandbox keys from repo secrets.
- **Staging:** Real Supabase project `dis-staging`, real Datalab, real
  Anthropic. Clinical acceptance suite runs here before each rollout
  stage bump (see `06_rollout/rollout_plan.md`).

## 10. Ownership

- Unit + integration — all engineers, blocked by CI.
- Clinical acceptance — QA Lead owns fixture curation; clinical reviewer
  (per `08_team/RACI.md`) signs off weekly.
- Performance — Tech Lead owns nightly reports; regressions open a ticket
  in `07_tickets/`.

## 11. Definition of Done (test slice)

A feature ticket is only Done when:

- [ ] Unit tests in the mapped file exist and pass.
- [ ] If CS-##-tagged: the mapped test in §7 exists and passes.
- [ ] Coverage thresholds in §3 not reduced in any touched directory.
- [ ] Every new fixture added under `tests/fixtures/` per `fixtures.md`.
- [ ] No adapter imported from `core/` (lint gate).
- [ ] Openapi round-trip passes if any route changed.

## 12. Out of scope for this document

- The _content_ of individual unit tests — see `unit_tests.md`.
- Integration scenarios — see `integration_tests.md`.
- Fixture curation — see `fixtures.md` + `clinical_acceptance.md`.
- Rollout gating checklists — see `06_rollout/rollout_plan.md`.
