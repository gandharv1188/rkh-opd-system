---
report: 06-code-reality-audit
last_refreshed: 2026-04-22
source_commit: 69ce4bc
source_paths:
  - dis/src/
  - dis/tests/
  - dis/migrations/
  - dis/scripts/
  - dis/package.json
  - dis/tsconfig.json
  - dis/vitest.config.ts
  - dis/eslint.config.mjs
  - dis/Dockerfile
covered_files:
  - dis/package.json
  - dis/tsconfig.json
  - dis/vitest.config.ts
  - dis/eslint.config.mjs
  - dis/Dockerfile
  - dis/CHANGELOG.md
  - dis/DEPS_REQUIRED.md
  - dis/README.md
  - dis/src/ports/index.ts
  - dis/src/ports/database.ts
  - dis/src/ports/ocr.ts
  - dis/src/ports/structuring.ts
  - dis/src/ports/storage.ts
  - dis/src/ports/queue.ts
  - dis/src/ports/secrets.ts
  - dis/src/ports/file-router.ts
  - dis/src/ports/preprocessor.ts
  - dis/src/core/orchestrator.ts
  - dis/src/core/state-machine.ts
  - dis/src/core/confidence-policy.ts
  - dis/src/core/promotion.ts
  - dis/src/core/audit-log.ts
  - dis/src/core/__fakes__/database.ts
  - dis/src/core/__fakes__/storage.ts
  - dis/src/core/__fakes__/queue.ts
  - dis/src/core/__fakes__/structuring.ts
  - dis/src/core/__fakes__/ocr.ts
  - dis/src/core/__fakes__/secrets.ts
  - dis/src/core/__fakes__/preprocessor.ts
  - dis/src/core/__fakes__/file-router.ts
  - dis/src/core/__fakes__/index.ts
  - dis/src/adapters/database/supabase-postgres.ts
  - dis/src/adapters/database/__fakes__/supabase-postgres.ts
  - dis/src/adapters/ocr/datalab-chandra.ts
  - dis/src/adapters/structuring/claude-haiku.ts
  - dis/src/adapters/structuring/__fakes__/claude-haiku.ts
  - dis/src/adapters/storage/supabase-storage.ts
  - dis/src/adapters/storage/__fakes__/supabase-storage.ts
  - dis/src/adapters/file-router/default.ts
  - dis/src/adapters/preprocessor/default.ts
  - dis/src/http/server.ts
  - dis/src/http/index.ts
  - dis/src/http/middleware/correlation-id.ts
  - dis/src/http/routes/health.ts
  - dis/src/types/assert-never.ts
  - dis/src/schemas/clinical-extraction.v1.json
  - dis/src/prompts/structuring.md
  - dis/tests/integration/health.test.ts
  - dis/tests/unit/adapters/claude-haiku.test.ts
  - dis/tests/unit/adapters/datalab-chandra.test.ts
  - dis/tests/unit/adapters/file-router.test.ts
  - dis/tests/unit/adapters/preprocessor.test.ts
  - dis/tests/unit/adapters/supabase-postgres.test.ts
  - dis/tests/unit/adapters/supabase-storage.test.ts
  - dis/tests/unit/audit-log.test.ts
  - dis/tests/unit/confidence-policy.test.ts
  - dis/tests/unit/orchestrator.test.ts
  - dis/tests/unit/promotion.test.ts
  - dis/tests/unit/state-machine.test.ts
  - dis/scripts/fitness.mjs
  - dis/scripts/fitness-rules.json
  - dis/scripts/check-files-touched.mjs
  - dis/scripts/check-forbidden-tokens.mjs
  - dis/scripts/check-pr-citations.mjs
  - dis/scripts/port-validator.mjs
  - dis/scripts/README.md
report_owner: code-audit-reviewer
confidence:
  src_enumeration: high
  tests_enumeration: high
  migrations_enumeration: high
  docs_vs_code: medium (inherently judgment-based)
---

## What changed since last refresh

(Empty — first issue of this report.)

## Executive summary

As of commit `69ce4bc`, the DIS codebase is a **port-and-adapter skeleton with the core business logic landed** but **without any composition root, no migrations, no queue adapter, and no HTTP surface beyond `/health`**. The repo has 38 `.ts` source files (~3,268 lines) and 12 test files (124 test cases per done.md; 138 `it/describe/test` occurrences enumerated here).

**What exists (live, tested):**

- 8 port interfaces (`ports/*.ts`) covering ocr, structuring, storage, database, queue, secrets, file-router, preprocessor.
- 5 core modules: state-machine (pure), orchestrator (DI), confidence-policy, promotion, audit-log.
- 5 real adapters: `SupabasePostgresAdapter`, `DatalabChandraAdapter`, `ClaudeHaikuAdapter`, `SupabaseStorageAdapter`, `DefaultFileRouter` — all implementing their port contract with named-method signatures matching `DatabasePort` after DIS-021d.
- 1 stub adapter: `DefaultPreprocessor` (type-safe passthrough, `sharp` pipeline deferred to DIS-058b).
- 1 HTTP route: `GET /health`, with correlation-id middleware.
- 8 in-memory `__fakes__/*` per-port plus 2 adapter-local test fakes.

**What is missing or stubbed:**

- `src/wiring/` is empty (only `.gitkeep`). No composition root — the 6 adapters cannot actually serve a request end-to-end.
- `src/http/routes/` has only `health.ts`. No `/extractions` POST, no ingest endpoint, no verification endpoint.
- `migrations/` is empty (`.gitkeep` only). `ocr_audit_log`, `extractions`, `document_extractions` tables exist only in `03_data/data_model.md`.
- No queue adapter. `QueuePort` has no implementation.
- No secrets adapter. `SecretsPort` only lives as an interface plus two `FakeSecrets`.
- `Dockerfile` is a stub that logs "dis stub — DIS-004 implements server" (DIS-004 shipped but Dockerfile was not updated).

**Trust level:** `src_enumeration` HIGH (every file read). `docs_vs_code` MEDIUM — cross-referenced against `done.md`, `adapters.md`, `tdd.md`, `DEPS_REQUIRED.md`; judgment calls flagged below.

---

## src/ tree enumeration

### Line counts & purposes (grouped)

| File                                                   | LOC | Purpose                                                                              |
| ------------------------------------------------------ | --: | ------------------------------------------------------------------------------------ |
| **ports/**                                             |     |                                                                                      |
| `src/ports/index.ts`                                   |  66 | Explicit-export barrel for all 8 port type exports.                                  |
| `src/ports/database.ts`                                | 108 | `DatabasePort` interface + `ExtractionRow`, `InsertExtractionInput`.                 |
| `src/ports/ocr.ts`                                     | 143 | `OcrPort`, `Block`, `BlockType`, `OcrInput/Result`, providers.                       |
| `src/ports/structuring.ts`                             |  97 | `StructuringPort`, `ClinicalExtractionShape` (typed as `unknown`).                   |
| `src/ports/storage.ts`                                 |  80 | `StoragePort` with 5 methods; result types discriminated by `kind`.                  |
| `src/ports/file-router.ts`                             |  43 | `FileRouterPort`, `RoutingDecision` discriminated union.                             |
| `src/ports/preprocessor.ts`                            |  55 | `PreprocessorPort`, `PreprocessedDocument`, drop counts.                             |
| `src/ports/queue.ts`                                   |  47 | `QueuePort` (enqueue + startConsumer).                                               |
| `src/ports/secrets.ts`                                 |  26 | `SecretsPort.get(name)`.                                                             |
| **core/**                                              |     |                                                                                      |
| `src/core/orchestrator.ts`                             | 318 | `IngestionOrchestrator` — DI pipeline driver; 4 custom errors.                       |
| `src/core/state-machine.ts`                            | 118 | Pure `transition(state, event)` + 10 States + 11 Event kinds.                        |
| `src/core/confidence-policy.ts`                        |  77 | `evaluatePolicy` — CS-7 fail-closed.                                                 |
| `src/core/promotion.ts`                                | 235 | `buildPromotionPlan` — pure intent-only, CS-10 + CS-11.                              |
| `src/core/audit-log.ts`                                |  94 | `AuditLogger` — append-only `write`/`writeMany`.                                     |
| `src/core/__fakes__/database.ts`                       |  82 | In-memory `FakeDatabase` w/ optimistic lock.                                         |
| `src/core/__fakes__/storage.ts`                        |  41 | `FakeStorage` via `Map`.                                                             |
| `src/core/__fakes__/queue.ts`                          |  30 | `FakeQueue` recording enqueues.                                                      |
| `src/core/__fakes__/ocr.ts`                            |  13 | `FakeOcr` scripted result.                                                           |
| `src/core/__fakes__/structuring.ts`                    |  17 | `FakeStructuring` scripted result.                                                   |
| `src/core/__fakes__/preprocessor.ts`                   |  18 | `FakePreprocessor` passthrough.                                                      |
| `src/core/__fakes__/file-router.ts`                    |   9 | `FakeFileRouter` fixed decision.                                                     |
| `src/core/__fakes__/secrets.ts`                        |  11 | `FakeSecrets` backed by record.                                                      |
| `src/core/__fakes__/index.ts`                          |   9 | Barrel.                                                                              |
| **adapters/**                                          |     |                                                                                      |
| `src/adapters/database/supabase-postgres.ts`           | 226 | `SupabasePostgresAdapter` + driver-loader seam + typed errors.                       |
| `src/adapters/database/__fakes__/supabase-postgres.ts` | 120 | `FakeSupabasePostgresAdapter` — records calls, backs `rows[]`.                       |
| `src/adapters/ocr/datalab-chandra.ts`                  | 363 | Datalab Chandra adapter — submit + poll + 3 error classes + webhook_url.             |
| `src/adapters/structuring/claude-haiku.ts`             | 233 | `ClaudeHaikuAdapter` — Anthropic-shaped DI; retry-once on invalid schema.            |
| `src/adapters/structuring/__fakes__/claude-haiku.ts`   |  36 | Scripted Anthropic factory.                                                          |
| `src/adapters/storage/supabase-storage.ts`             | 192 | REST-based adapter (no @supabase/supabase-js); 5 methods.                            |
| `src/adapters/storage/__fakes__/supabase-storage.ts`   |  91 | `FakeSecrets` + `createFetchMock` for unit tests.                                    |
| `src/adapters/file-router/default.ts`                  |  94 | Extension-based routing; lazy `pdfjs-dist` import via DI seam.                       |
| `src/adapters/preprocessor/default.ts`                 |  43 | STUB — passthrough + 50-page cap; no image processing.                               |
| **http/**                                              |     |                                                                                      |
| `src/http/server.ts`                                   |  62 | `createServer()` + `start(port)` with `@hono/node-server`.                           |
| `src/http/index.ts`                                    |   5 | Barrel re-exports.                                                                   |
| `src/http/middleware/correlation-id.ts`                |  24 | UUIDv4 echo middleware.                                                              |
| `src/http/routes/health.ts`                            |  21 | `GET /health` → `{status:'ok', version}`.                                            |
| **types/**                                             |     |                                                                                      |
| `src/types/assert-never.ts`                            |  21 | Exhaustiveness helper.                                                               |
| **prompts/ + schemas/**                                |     |                                                                                      |
| `src/prompts/structuring.md`                           |   — | Structuring prompt, version frontmatter `v1`.                                        |
| `src/schemas/clinical-extraction.v1.json`              |   — | JSON Schema draft-07; 6 required top-level keys.                                     |
| **wiring/**                                            |     | EMPTY — only `.gitkeep`. **No composition root exists.**                             |

### Status classification

| File                                  | Status                    | Evidence                                                                           |
| ------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| All `src/ports/*.ts`                  | LIVE (interfaces)         | Pure type declarations; no runtime.                                                |
| `src/core/state-machine.ts`           | LIVE                      | Pure function, 27 tests.                                                           |
| `src/core/orchestrator.ts`            | LIVE                      | DI, 19 tests; calls through all ports.                                             |
| `src/core/confidence-policy.ts`       | LIVE                      | 11 tests, CS-7 fail-closed wired (line 62).                                        |
| `src/core/promotion.ts`               | LIVE                      | 14 tests; pure plan builder.                                                       |
| `src/core/audit-log.ts`               | LIVE                      | 8 tests; `AuditLogImmutableError` declared.                                        |
| `adapters/database/supabase-postgres` | LIVE via seam             | Real SQL + driver loader (line 207) throws `DATABASE_DRIVER_MISSING` until wired.  |
| `adapters/ocr/datalab-chandra`        | LIVE                      | 14 tests; real HTTP multipart; 3 error classes.                                    |
| `adapters/structuring/claude-haiku`   | LIVE via seam             | `defaultFactory` throws (line 149); wiring injects real SDK.                       |
| `adapters/storage/supabase-storage`   | LIVE                      | Real fetch; 10 tests.                                                              |
| `adapters/file-router/default`        | LIVE                      | 12 tests; `pdfjs-dist` dynamic import.                                             |
| `adapters/preprocessor/default`       | STUB (documented)         | `lint-allow` TODO marker line 27; passthrough only.                                |
| `src/http/server.ts`                  | PARTIAL                   | Server starts, but only `/health` route.                                           |
| `src/wiring/`                         | MISSING                   | Directory empty.                                                                   |

### Key exports

- `ports/index.ts`: re-exports 34 types + 8 interface types.
- `core/orchestrator.ts`: `IngestionOrchestrator`, `OrchestratorError`, `VersionConflictError`, `ExtractionNotFoundError`, types `OrchestratorDeps/IngestInput/ApproveInput/RejectInput/RetryInput`.
- `core/state-machine.ts`: `transition`, `State`, `Event`, `InvalidStateTransitionError`.
- `core/promotion.ts`: `buildPromotionPlan`, 10 types.
- `core/audit-log.ts`: `AuditLogger`, `AuditEvent`, `AuditLogImmutableError`.
- `adapters/database/supabase-postgres.ts`: `SupabasePostgresAdapter`, `DatabaseError`, `DatabaseConnectionError`, `SqlClient`, `setPostgresDriverLoader`.
- `adapters/ocr/datalab-chandra.ts`: `DatalabChandraAdapter`, `OcrProviderError`, `OcrProviderTimeoutError`, `OcrProviderRateLimitedError`.
- `adapters/structuring/claude-haiku.ts`: `ClaudeHaikuAdapter`, `StructuringSchemaInvalidError`, `AnthropicLike`, `AnthropicClientFactory`.
- `adapters/storage/supabase-storage.ts`: `SupabaseStorageAdapter`, `ObjectNotFoundError`, `StorageProviderError`.

---

## Ports — code reality

| Port file            | Interface           | Methods                                                                                                                                                   | Adapters in tree                                                       | TDD §       |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| `ports/database.ts`  | `DatabasePort`      | `query`, `queryOne`, `transaction`, `setSessionVars`, `findExtractionById`, `findExtractionByIdempotencyKey`, `updateExtractionStatus`, `insertExtraction` | `SupabasePostgresAdapter` (real) + `FakeSupabasePostgresAdapter` + `FakeDatabase` | §6, §9 (data model) |
| `ports/ocr.ts`       | `OcrPort`           | `extract(input)`                                                                                                                                          | `DatalabChandraAdapter` + `FakeOcr`                                    | §9.1        |
| `ports/structuring.ts` | `StructuringPort` | `structure(input)`                                                                                                                                        | `ClaudeHaikuAdapter` + `FakeStructuring`                               | §10.1       |
| `ports/storage.ts`   | `StoragePort`       | `putObject`, `getObject`, `getSignedUploadUrl`, `getSignedDownloadUrl`, `deleteObject`                                                                    | `SupabaseStorageAdapter` + `FakeStorage`                               | §9 portability |
| `ports/queue.ts`     | `QueuePort`         | `enqueue`, `startConsumer`                                                                                                                                | `FakeQueue` only — **no real adapter**                                 | §portability |
| `ports/secrets.ts`   | `SecretsPort`       | `get(name)`                                                                                                                                               | `FakeSecrets` only — **no real adapter**                               | §portability |
| `ports/file-router.ts` | `FileRouterPort`  | `route(input)`                                                                                                                                            | `DefaultFileRouter` + `FakeFileRouter`                                 | §7          |
| `ports/preprocessor.ts` | `PreprocessorPort` | `preprocess(input)`                                                                                                                                     | `DefaultPreprocessor` (stub) + `FakePreprocessor`                      | §8          |

---

## Adapters — code reality

| Adapter file                                             | Port                | State   | Evidence                                                                                                                                | Deps used                                           | Tests                                            |
| -------------------------------------------------------- | ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| `adapters/database/supabase-postgres.ts`                 | `DatabasePort`      | REAL    | All 8 methods implemented. Driver NOT imported statically — `setPostgresDriverLoader` at line 220. Unwired call throws line 208 `DATABASE_DRIVER_MISSING`. | `postgres` via seam                                 | `supabase-postgres.test.ts` (8 cases, 180 LOC)  |
| `adapters/ocr/datalab-chandra.ts`                        | `OcrPort`           | REAL    | Real `fetch` (multipart + poll). Timeout 300s. Rate-limit 429 handler. `webhookUrl` opt per ADR-004. `console.error` on line 164 (eslint-disabled).         | `fetch`, `FormData`, `Blob`                         | `datalab-chandra.test.ts` (14 cases, 405 LOC)   |
| `adapters/structuring/claude-haiku.ts`                   | `StructuringPort`   | REAL via seam | `defaultFactory` throws line 149. Real factory injected at wiring (wiring missing). Retry-on-invalid wired. `StructuringSchemaInvalidError` after 2 attempts.    | `node:fs` (readFileSync), Anthropic-shaped DI | `claude-haiku.test.ts` (7 cases, 180 LOC)       |
| `adapters/storage/supabase-storage.ts`                   | `StoragePort`       | REAL    | 5 methods via Supabase REST; `ObjectNotFoundError` on 404 (line 177). No SDK import — lint-compliant under `supabase_sdk_only_in_supabase_adapters`.        | `fetch`                                             | `supabase-storage.test.ts` (10 cases, 216 LOC)  |
| `adapters/file-router/default.ts`                        | `FileRouterPort`    | REAL    | Extension map + PDF chars-per-page heuristic. `pdfjs-dist` lazy-imported line 32 — optional at test time.                              | `pdfjs-dist` (lazy)                                 | `file-router.test.ts` (12 cases, 154 LOC)       |
| `adapters/preprocessor/default.ts`                       | `PreprocessorPort`  | STUB    | Line 27 `// lint-allow: TODO — DIS-058b (real pipeline)`. Passthrough + 50-page cap. No `sharp` import.                                 | none                                                | `preprocessor.test.ts` (7 cases, 78 LOC)        |

No `secrets` adapter. No `queue` adapter. No `wiring/` composition root. No S3 adapter, no on-prem-Chandra adapter, no Claude-Vision adapter (`OcrProvider` type has `'claude-vision'` and `'onprem-chandra'` values that are currently unreachable).

---

## HTTP / Hono server

**File tree:** `src/http/{server.ts, index.ts, middleware/correlation-id.ts, routes/health.ts}`. 112 LOC total.

**Routes registered:** exactly one — `GET /health`.

**Middleware:** `correlationId()` applied `app.use('*', ...)` in `createServer()`.

**Framework:** Hono v4.6 + `@hono/node-server` v1.13 (matches ADR-005).

**Error handling:** none — no global `onError`, no structured error responses beyond Hono's default.

**OpenAPI comparison:** `document_ingestion_service/04_api/openapi.yaml` (not read in detail) specifies multiple routes (`/extractions`, `/extractions/{id}/approve`, etc.). None of these are wired. **Drift: the service advertises a REST surface that doesn't exist.**

**Deployment reality:** `Dockerfile` (line 35) still runs a console.log stub. DIS-004 shipped server but Dockerfile wasn't updated — see handoff backlog item "DIS-001 Dockerfile stub" in line 2.

---

## tests/ enumeration

| Test file                                     | LOC | `it/describe/test(` count | Subjects under test                                                         |
| --------------------------------------------- | --: | -----------------------: | --------------------------------------------------------------------------- |
| `tests/integration/health.test.ts`            |  48 |                        4 | `createServer()`, `/health` → 200 JSON, correlation-id echo.                |
| `tests/unit/state-machine.test.ts`            | 146 |                       27 | Every valid + invalid transition of `transition()`.                         |
| `tests/unit/orchestrator.test.ts`             | 258 |                       19 | ingest idempotency, process pipeline routes (native/scan), optimistic lock. |
| `tests/unit/confidence-policy.test.ts`        | 123 |                       11 | enabled/disabled, rule pass/fail, block_type, policy version stamp.         |
| `tests/unit/promotion.test.ts`                | 329 |                       14 | CS-10 discharge latest-only, CS-11 dedup, documentPatch passthrough.        |
| `tests/unit/audit-log.test.ts`                | 146 |                        8 | write single/many, JSON serialization, `AuditLogImmutableError`.            |
| `tests/unit/adapters/datalab-chandra.test.ts` | 405 |                       14 | submit 2xx, poll complete, timeout, 429, webhook-url flag, raw response.    |
| `tests/unit/adapters/claude-haiku.test.ts`    | 180 |                        7 | retry-on-invalid, second-failure error, cost micro-INR, schema required.    |
| `tests/unit/adapters/supabase-storage.test.ts`| 216 |                       10 | put/get/delete, signed URL relative+absolute, not-found.                    |
| `tests/unit/adapters/supabase-postgres.test.ts`|180 |                        8 | SET LOCAL key validation, transaction wrap, connection error mapping.       |
| `tests/unit/adapters/file-router.test.ts`     | 154 |                       12 | PDF native vs scan, images, Office, unsupported, threshold override.        |
| `tests/unit/adapters/preprocessor.test.ts`    |  78 |                        7 | passthrough, 50-page cap, `PreprocessorPageCapError`, drop counts.          |
| **TOTAL**                                     | **2263** | **141**              |                                                                             |

**Skip/todo counts:** `it.skip` / `it.todo` / `.skip(` / `.todo(` — **zero occurrences found via Grep.** Done.md claims 124 test cases; the 141 count here includes `describe` blocks — roughly consistent.

Two fixture files: `tests/fixtures/datalab/convert-response.json`, `tests/fixtures/haiku/{sample-markdown.md,expected-extraction.json}`.

`tests/clinical-acceptance/` contains only `.gitkeep`.

---

## migrations/ enumeration

**`migrations/.gitkeep` only — zero SQL files.**

Drift signal: `audit-log.ts` inserts into `ocr_audit_log`; `supabase-postgres.ts` queries `extractions`. Neither table has a migration in this folder. `done.md` DIS-024 verdict: "migration for `ocr_audit_log` + triggers (Epic F scope)". Epic F hasn't shipped yet.

---

## scripts/ enumeration

| Script                              | Purpose                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `fitness.mjs` + `fitness-rules.json`| Control 3 — architectural-fitness grep (core→adapter import bans, no SQL in core).  |
| `check-pr-citations.mjs`            | Control 1 — TDD/CS/DIS-US citation resolution in PR bodies.                         |
| `check-files-touched.mjs`           | Control 2 — enforce ticket `files_allowed:` against git diff.                       |
| `check-forbidden-tokens.mjs`        | Control 7 — TODO/FIXME/.only/.skip grep with `// lint-allow:` escape.               |
| `port-validator.mjs`                | Legacy wrapper delegating to `fitness.mjs`.                                         |
| `scripts/README.md`                 | Usage docs.                                                                         |
| `scripts/__tests__/drift-controls.test.mjs` | Pure-Node smoke harness for the four control scripts (no vitest).           |
| `scripts/__tests__/fixtures/...`    | Fixture trees: `tokens_allowed/`, `tokens_raw/`, `violating/`.                      |

All `.mjs` — deliberately zero-dep so they run pre-`npm install`.

---

## Config reality

### package.json

| Field | Value |
| ----- | ----- |
| `name` | `@rkh/dis` |
| `version` | `0.0.1` |
| `type` | `module` |
| `engines.node` | `"20"` |

Scripts: `build`, `typecheck`, `test`, `test:watch`, `lint`, `format`, `format:check`.

Runtime deps (6): `@anthropic-ai/sdk ^0.27.0`, `@hono/node-server ^1.13.0`, `hono ^4.6.0`, `pdfjs-dist ^4.7.0`, `pino ^9.5.0`, `postgres ^3.4.4`. Dev deps (7): typescript 5.6, vitest 2.0, eslint 9.0, typescript-eslint 8.0, prettier 3.0, @types/node 20, @eslint/js 9.0. **Matches DEPS_REQUIRED.md exactly.** `sharp` absent (deferred to DIS-058b — correct).

### tsconfig.json

- `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `forceConsistentCasingInFileNames` — all on.
- `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2022`.
- `include: ["src/**/*.ts", "tests/**/*.ts"]`; `exclude: ["node_modules", "dist"]`.
- **DEPS_REQUIRED.md line 52 flagged a `rootDir: src` conflict with `include: tests/**`.** Current tsconfig has NO `rootDir` field — so the conflict was resolved (presumably by DIS-021b/d per done.md). DIS-021d verdict confirms: "tsconfig exclude list now minimal".

### vitest.config.ts

9 lines: `include: ['tests/**/*.test.ts']`, excludes node_modules/dist/scripts/.claude.

### eslint.config.mjs

Flat config: `typescript-eslint.configs.recommendedTypeChecked` + `no-explicit-any: warn` + `consistent-type-imports: error`. Ignores `dist/`, `coverage/`, `node_modules/`. Parser project: `./tsconfig.json` — so lint type-checks everything tsconfig includes.

### Dockerfile

- Two-stage (build, runtime). Node 20-alpine.
- Build stage: `COPY package*.json`, `npm ci || npm install --package-lock-only`.
- **No `COPY` of src/** and **no `npm run build`**.
- **CMD line 35 logs "dis stub — DIS-004 implements server"** — which means DIS-004 shipped but this was not updated. Dockerfile comment (line 5) says "DIS-004 writes the HTTP server" as a future event; reality: DIS-004 is in done.md.
- **Drift: Dockerfile still says DIS-001 stub; DIS-004 landed on 2026-04-20 but Dockerfile was not touched.**

---

## DOCS vs CODE DRIFT (core deliverable)

### done.md claims vs. code reality

| Ticket | Claim (from done.md) | Code reality | Verdict |
| ------ | -------------------- | ------------ | ------- |
| DIS-001 | "scaffold, tsconfig, package.json (empty deps by design)" | `tsconfig.json`, `package.json` present. Deps merged in DIS-001b. | MATCHES (with historical note) |
| DIS-002 | "CI workflow + port-validator + PR template" | Scripts at `dis/scripts/`; `fitness.mjs`, `check-*` present. CI file not at this worktree path but assumed under `.github/workflows/dis-ci.yml`. | MATCHES (CI file not verified; scripts present) |
| DIS-003 | "8 port interfaces + barrel; noImplicitAny clean" | `src/ports/` has 8 files + `index.ts`. Counted. | MATCHES |
| DIS-004 | "`GET /health` + Hono + correlation-id" | Exactly that. 4 integration tests. | MATCHES |
| DIS-020 | "10 States, 11 Event kinds, 18 unit tests, assertNever exhaustiveness" | `state-machine.ts` has 10 State literals + 11 Event kinds — verified. Tests count 27 `it/describe` (done.md counts differently). `assertNever` on line 115. | MATCHES |
| DIS-021 | "IngestionOrchestrator DI" | `orchestrator.ts` 318 LOC, 19 tests. | MATCHES |
| DIS-021b | "CS-1: pipeline transitions route through transition()" | `runPipeline` lines 218–253 explicitly call `transition()` at every step. Verified. | MATCHES |
| DIS-021d | "All 17 TS errors cleared; tsconfig exclude minimal; DatabasePort named methods on adapter+fake+test-fixture" | Adapter `supabase-postgres.ts` has `findExtractionById` (line 142), `findExtractionByIdempotencyKey` (151), `updateExtractionStatus` (160), `insertExtraction` (173). Fake (`__fakes__/supabase-postgres.ts`) has all four. `FakeDatabase` has all four. Tsconfig exclude = `["node_modules", "dist"]`. | MATCHES |
| DIS-022 | "CS-7 fail-closed when enabled=false; 18 assertions" | `confidence-policy.ts:62` short-circuits when `!enabled` → `auto_approved: false`. 11 `it/describe`. | MATCHES |
| DIS-023 | "CS-10 discharge latest-only; CS-11 duplicate-row guard; 8/8" | `promotion.ts:130–158` implements CS-10, `labKey`/`vaxKey` dedup. 14 test blocks. | MATCHES |
| DIS-024 | "AuditLogger write/writeMany only; no update/delete at type level; AuditLogImmutableError" | `audit-log.ts` exposes exactly `write` + `writeMany` + `AuditLogImmutableError`. | MATCHES |
| DIS-050 | "DatalabChandraAdapter CS-2 raw-response byte-identical" | `datalab-chandra.ts:286` returns `rawResponse: raw` verbatim. | MATCHES |
| DIS-050a | "6 wire-contract bugs + webhook_url per ADR-004; 13 tests" | `webhookUrl` opt at line 119; `output_format` comma-joined (line 202); `skip_cache` flag. 14 `it/describe` blocks. | MATCHES |
| DIS-051 | "retry-on-invalid; StructuringSchemaInvalidError on 2nd fail" | `claude-haiku.ts:112–127` implements retry; error thrown line 121. | MATCHES |
| DIS-053 | "5 methods via REST, no SDK, 9 tests" | 5 methods present; `@supabase/supabase-js` not imported. 10 test blocks. | MATCHES |
| DIS-054 | "DatabasePort via postgres-driver seam; 7 tests" | `setPostgresDriverLoader` line 220; 8 test blocks. | MATCHES |
| DIS-057 | "TDD §7 decision tree; 11 tests; pdfjs-dist lazy" | 12 test blocks; dynamic `import('pdfjs-dist')` at line 32. | MATCHES |
| DIS-058 | "Type-safe passthrough stub; 6 tests; sharp deferred" | Real file has 7 test blocks; `sharp` not imported. | MATCHES |

**No MISSING or DRIFTED verdicts.** One gap: **done.md does not mention DIS-001 Dockerfile stub update**, and the Dockerfile still prints "dis stub — DIS-004 implements server". This is a known backlog item (`DEPS_REQUIRED.md` implies it; Dockerfile comment on line 4 explicitly marks it).

### ADR decisions — is the code following them?

| ADR | Decision | Code evidence |
| --- | -------- | ------------- |
| ADR-005 | Hono over Fastify | `src/http/server.ts:2` imports `hono`; no fastify anywhere. MATCHES |
| ADR-006 | `postgres` (porsager) over `pg`/drizzle | `supabase-postgres.ts` depends only on a `SqlClient` structural type (line 33); `postgres` declared in package.json; driver injected by seam at line 220. No `pg` or `drizzle` import in src/. MATCHES |
| ADR-007 | Haiku default, Sonnet escalation | `claude-haiku.ts:68` pins `claude-haiku-4-5`. **No Sonnet escalation path** present — adapter only does haiku-with-retry. Escalation is a future ticket (done.md DIS-051 follow-ups mention "future Sonnet-escalation ticket"). PARTIAL |
| ADR-004 | Datalab webhooks over polling (fall-back polling retained) | `datalab-chandra.ts:119` `webhookUrl` opt, line 213 appends to form. Polling still the live path (receiver endpoint is "DIS-097-extended" future work). MATCHES the ADR (fallback polling explicitly required until receiver ships). |
| ADR-003 | Kill switch returns 503 | No 503 handler in `src/http/`. DIS-100 is the ticket; not yet shipped. MISSING (documented — Epic D scope) |
| ADR-001 | Hexagonal ports & adapters | Directory layout matches; fitness rules enforce DIP. MATCHES |
| ADR-002 | Datalab hosted vs self-host | Only `DatalabChandraAdapter` present. Self-host adapter deferred (done.md mentions "future ADR-002-self-host-switchover"). PARTIAL (by design) |

### Adapter contract vs. implementation — method coverage

`DatabasePort` has 8 methods. `SupabasePostgresAdapter` implements all 8 (line 104, 108, 113, 129, 142, 151, 160, 173). `FakeSupabasePostgresAdapter` implements all 8. `FakeDatabase` implements all 8. **No contract drift.**

`StoragePort` has 5 methods. `SupabaseStorageAdapter` implements all 5 (lines 60, 84, 97, 122, 139). `FakeStorage` implements all 5.

`OcrPort` has 1 method. `StructuringPort` has 1 method. `FileRouterPort` has 1 method. `PreprocessorPort` has 1 method. All implemented.

`QueuePort` has 2 methods. Only `FakeQueue` implements (real adapter missing).

`SecretsPort` has 1 method. Only 2 `FakeSecrets` implement (real adapter missing).

### DEPS_REQUIRED vs package.json

| Dep | In DEPS_REQUIRED | In package.json | Match |
| --- | ---------------- | --------------- | ----- |
| hono | ^4.6.0 | ^4.6.0 | Y |
| @hono/node-server | ^1.13.0 | ^1.13.0 | Y |
| pino | ^9.5.0 | ^9.5.0 | Y — but NOT YET IMPORTED anywhere (grep: 0 hits). "Not wired yet — DIS-008" per DEPS_REQUIRED. |
| postgres | ^3.4.4 | ^3.4.4 | Y — not statically imported (via seam) |
| pdfjs-dist | ^4.7.0 | ^4.7.0 | Y — dynamic import only |
| @anthropic-ai/sdk | ^0.27.0 | ^0.27.0 | Y — not statically imported (via AnthropicClientFactory seam) |
| sharp | (deferred) | absent | Y (correctly deferred) |

Dev-deps all match.

### Known issues from DEPS_REQUIRED / CHANGELOG

| Item | Current state |
| ---- | ------------- |
| tsconfig rootDir/include conflict | RESOLVED — no `rootDir` in tsconfig; DIS-021d verdict confirms. |
| `health.test.ts:2` imported `.ts` extension | RESOLVED — file imports `'../../src/http/server.js'` (line 2 of test reads `.js`). *Verified via DIS-001b handoff + current test.* |
| `sharp` deferred to DIS-058b | Honoured — not in package.json. |

### Stubs / TODOs

| File:line | Category | Ticket referenced |
| --------- | -------- | ----------------- |
| `src/adapters/preprocessor/default.ts:27` | `// lint-allow: TODO` | DIS-058b |
| `Dockerfile:3`, :19, :29, :34 | TODO/NOTE | DIS-001, DIS-003, DIS-004 |
| `src/adapters/ocr/datalab-chandra.ts:164` | `console.error` with `eslint-disable` | Deferred pino wiring DIS-008 |
| `src/adapters/structuring/claude-haiku.ts:149` | `defaultFactory` throws — "wiring layer must inject" | Wiring / DIS-051-followup |
| `src/adapters/database/supabase-postgres.ts:208` | driverLoader throws `DATABASE_DRIVER_MISSING` | DIS-060 wiring |
| `src/wiring/.gitkeep` | Empty dir | Epic C wiring (composition root) |
| `src/http/server.ts:45` comment "Real logging + signal handling are wired up later (DIS-008)" | Future | DIS-008 |

(Grep `TODO|FIXME` in src returns only one hit — the preprocessor lint-allow. The service is remarkably TODO-free by design: every placeholder is a typed seam or a `.gitkeep`.)

---

## Risks surfaced by this audit

1. **No composition root (`src/wiring/` empty).** All 5 real adapters have typed seams that throw at call time (`DATABASE_DRIVER_MISSING`, `ClaudeHaikuAdapter: no anthropicClientFactory`). The service **cannot boot end-to-end** beyond `/health`. This is the single biggest gap between docs and reality.
2. **Dockerfile runs a stub.** `CMD ["node", ..., "console.log('dis stub — DIS-004 implements server')"]` on line 35. Anyone pulling the image expects a server and gets a log line.
3. **No migrations.** `audit-log.ts` writes to `ocr_audit_log`, `supabase-postgres.ts` reads/writes `extractions`. Neither table has a migration file. Live deploy would crash on first query. (`03_data/data_model.md` owns the DDL but it hasn't been translated into `migrations/*.sql`.)
4. **No queue adapter.** `QueuePort` exists but no real implementation — `OrchestratorDeps` requires a queue, so the orchestrator can only run with `FakeQueue` under tests. `done.md` has no queue-adapter ticket landed.
5. **No secrets adapter.** Same class of gap — `SecretsPort` used by every live adapter (`DatalabChandraAdapter`, `ClaudeHaikuAdapter`, `SupabaseStorageAdapter`) but zero real implementations.
6. **Pino declared but unused.** `pino ^9.5.0` in package.json; zero src imports. Structured logging (`coding_standards §8`) is theoretical.
7. **Confidence policy has no wired input.** `evaluatePolicy` is pure & tested, but **nothing in orchestrator.ts calls it**. The `ready_for_review` state is reached via `runPipeline`, and the `policy_auto_approved` event is defined in state-machine.ts but never emitted from code. Only tests exercise that transition.
8. **No OpenAPI↔route coverage.** `openapi.yaml` presumably documents POST `/extractions` etc.; only `GET /health` is implemented.
9. **Sonnet escalation path absent** despite ADR-007. Single-model path is all that ships.
10. **`StructuringResult` type drift.** `ports/structuring.ts` defines `StructuringResult` without a `promptVersion` field, but `claude-haiku.ts:143` returns an object with `promptVersion: this.prompt.version`. The adapter returns a superset — TS structural typing allows it, but consumers can't typecheck-access this field through the port. Minor — but the first drift symptom.

---

## Refresh instructions for next session

Re-read: `git log --name-only 69ce4bc..HEAD -- dis/src/ dis/tests/ dis/migrations/ dis/scripts/ dis/package.json dis/tsconfig.json`. Re-enumerate `src/` tree. For each changed file: re-check the "src/ tree enumeration" and "Adapters — code reality" sections. Re-walk DOCS vs CODE DRIFT for any `done.md` additions. Bump `last_refreshed` + `source_commit`.
