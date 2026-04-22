# Backlog — DIS Tickets

> Every ticket follows the template in `_ticket_template.md`. Tickets are
> ordered by ID, grouped by epic. Only the first 3-4 tickets per epic
> are fully fleshed out here; remaining tickets carry a one-line
> placeholder so the Architect can expand them as agents come free.
>
> **Binding:** no ticket tagged `integration` may leave `integration_hold.md`
> without the Integration Gatekeeper's written approval.

---

## Epic A — Foundations

### DIS-001 — Initialize `dis/` subproject

- **Tags:** `infra`, `doc-only`
- **Epic:** A
- **Depends on:** none
- **TDD ref:** §1, §2 (architectural style, component layout)
- **CS ref:** none
- **Files allowed:**
  - dis/package.json
  - dis/tsconfig.json
  - dis/.nvmrc
  - dis/.gitignore
  - dis/Dockerfile
  - dis/README.md
  - dis/src/core/.gitkeep
  - dis/src/ports/.gitkeep
  - dis/src/adapters/.gitkeep
  - dis/src/http/.gitkeep
  - dis/src/wiring/.gitkeep
  - dis/tests/.gitkeep
- **Out of scope:** business logic, adapter code, any file outside `dis/`.

**Description:**
Create `dis/` root directory with the layout in `adapters.md`. Add `package.json` (Node 20 ESM), `tsconfig.json`, `.nvmrc`, `.gitignore`, `Dockerfile` skeleton, `README.md`. No dependencies installed beyond TypeScript + Hono.

**VERIFY:**

- VERIFY-1: `node -e "const p=require('./dis/package.json');process.exit(p.type==='module'&&p.engines&&p.engines.node.startsWith('20')?0:1)"` — expect exit code 0
- VERIFY-2: `node -e "const p=require('./dis/package.json');const s=p.scripts||{};process.exit(['build','test','lint','typecheck'].every(k=>s[k])?0:1)"` — expect exit code 0
- VERIFY-3: `grep -c '"strict": true' dis/tsconfig.json` — expect `1`
- VERIFY-4: `for d in core ports adapters http wiring; do test -f dis/src/$d/.gitkeep || echo MISSING:$d; done; test -f dis/tests/.gitkeep || echo MISSING:tests` — expect empty stdout
- VERIFY-5: `cd dis && npm run typecheck` — expect exit code 0
- VERIFY-6: `grep -c "feature_plans/document_ingestion_service" dis/README.md` — expect ≥ `1`

**Status:** Ready

### DIS-002 — CI workflow

- **Tags:** `infra`
- **Epic:** A
- **Depends on:** DIS-001
- **TDD ref:** §14 (observability), §17 (portability)
- **CS ref:** none
- **Files allowed:**
  - .github/workflows/dis-ci.yml
  - dis/scripts/port-validator.sh
- **Out of scope:** deploy steps, AWS wiring, any non-CI workflow.

**Description:**
GitHub Actions workflow that runs on PRs touching `dis/**` — lint, typecheck, test, Docker build, secret scan (gitleaks), and port-validator script.

**VERIFY:**

- VERIFY-1: `test -f .github/workflows/dis-ci.yml && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "paths:|dis/\*\*" .github/workflows/dis-ci.yml` — expect ≥ `2`
- VERIFY-3: `grep -cE "node-version.*20|'20'" .github/workflows/dis-ci.yml` — expect ≥ `1`
- VERIFY-4: `grep -ci "gitleaks" .github/workflows/dis-ci.yml` — expect ≥ `1`
- VERIFY-5: `test -x dis/scripts/port-validator.sh || test -f dis/scripts/port-validator.sh && echo OK` — expect `OK`
- VERIFY-6: `grep -cE "adapters/" dis/scripts/port-validator.sh` — expect ≥ `1`

**Status:** Ready

### DIS-003 — Port interface stubs

- **Tags:** `core`, `test`
- **Epic:** A
- **Depends on:** DIS-001
- **TDD ref:** §1, §9.1, §10.1
- **CS ref:** none
- **Files allowed:**
  - dis/src/ports/ocr.ts
  - dis/src/ports/structuring.ts
  - dis/src/ports/storage.ts
  - dis/src/ports/database.ts
  - dis/src/ports/queue.ts
  - dis/src/ports/secrets.ts
  - dis/src/ports/file-router.ts
  - dis/src/ports/preprocessor.ts
  - dis/src/ports/index.ts
- **Out of scope:** any implementation, any adapter, any test fixture body.

**Description:**
Create 8 port interface files with JSDoc + type signatures from TDD §9.1 / §10.1 / `adapters.md`. Add `ports/index.ts` re-exports. No implementations.

**VERIFY:**

- VERIFY-1: `for p in ocr structuring storage database queue secrets file-router preprocessor; do test -f dis/src/ports/$p.ts || echo MISSING:$p; done` — expect empty stdout
- VERIFY-2: `grep -cE "^export (interface|type) " dis/src/ports/ocr.ts` — expect ≥ `1`
- VERIFY-3: `grep -c "export " dis/src/ports/index.ts` — expect ≥ `8`
- VERIFY-4: `cd dis && npx tsc --noEmit` — expect exit code 0
- VERIFY-5: `grep -rE "from ['\"].*/adapters/" dis/src/ports/ || echo CLEAN` — expect `CLEAN`

**Status:** Ready

### DIS-004 — Health endpoint

- **Tags:** `core`, `infra`
- **Epic:** A
- **Depends on:** DIS-001
- **TDD ref:** §3
- **CS ref:** none
- **Files allowed:**
  - dis/src/http/server.ts
  - dis/src/http/routes/health.ts
  - dis/tests/integration/health.test.ts
- **Out of scope:** other routes, port wiring, adapter usage.

**Description:**
Minimal Hono server with `GET /health` → `{status: 'ok', version}`. No port usage, no adapters. Dockerfile builds and answers health.

**VERIFY:**

- VERIFY-1: `test -f dis/src/http/server.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "/health" dis/src/http/server.ts dis/src/http/routes/health.ts` — expect ≥ `1`
- VERIFY-3: `cd dis && npx vitest run tests/integration/health.test.ts` — expect exit code 0 and `passed` in output
- VERIFY-4: `grep -c "status.*ok" dis/tests/integration/health.test.ts` — expect ≥ `1`
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-005 — Hono routing convention + error-envelope middleware

- **Tags:** `core`, `infra`
- **Epic:** A
- **Depends on:** DIS-004
- **TDD ref:** §15 (error model), §3 (HTTP surface)
- **CS ref:** none
- **Files allowed:**
  - dis/src/http/middleware/error-envelope.ts
  - dis/src/http/router.ts
  - dis/tests/unit/error-envelope.test.ts
- **Out of scope:** business logic, adapter errors, cross-origin / auth middleware.

**Description:**
Implement routing convention (route modules mounted by feature) and an error-envelope middleware that converts thrown errors into the canonical JSON envelope defined in `04_api/error_model.md` (fields: `error.code`, `error.message`, `error.correlation_id`).

**VERIFY:**

- VERIFY-1: `test -f dis/src/http/middleware/error-envelope.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "error\.code|error\.correlation_id" dis/src/http/middleware/error-envelope.ts` — expect ≥ `2`
- VERIFY-3: `cd dis && npx vitest run tests/unit/error-envelope.test.ts` — expect exit code 0
- VERIFY-4: `grep -c "describe\|it(" dis/tests/unit/error-envelope.test.ts` — expect ≥ `3`
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-006 — JSON schema validator + clinical_extraction.v1.json

- **Tags:** `core`, `test`
- **Epic:** A
- **Depends on:** DIS-001
- **TDD ref:** §10.2, §11 (contract)
- **CS ref:** none
- **Files allowed:**
  - dis/src/core/schema/ajv.ts
  - dis/src/core/schema/clinical_extraction.v1.json
  - dis/tests/unit/schema-validator.test.ts
- **Out of scope:** other schemas, HTTP wiring, business evaluation of fields.

**Description:**
Ajv wrapper that compiles and caches schemas. Add `clinical_extraction.v1.json` with the ClinicalExtraction contract from TDD §10.2.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/schema/clinical_extraction.v1.json && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `node -e "JSON.parse(require('fs').readFileSync('dis/src/core/schema/clinical_extraction.v1.json','utf8'));console.log('VALID')"` — expect `VALID`
- VERIFY-3: `grep -cE "\"\\$schema\"|\"properties\"" dis/src/core/schema/clinical_extraction.v1.json` — expect ≥ `2`
- VERIFY-4: `cd dis && npx vitest run tests/unit/schema-validator.test.ts` — expect exit code 0
- VERIFY-5: `grep -c "ajv\|Ajv" dis/src/core/schema/ajv.ts` — expect ≥ `1`

**Status:** Ready

### DIS-007 — OpenAPI YAML canonicalised in dis/openapi.yaml

- **Tags:** `infra`, `doc-only`
- **Epic:** A
- **Depends on:** DIS-002
- **TDD ref:** §3 (HTTP surface)
- **CS ref:** none
- **Files allowed:**
  - dis/openapi.yaml
  - dis/scripts/validate-openapi.sh
  - .github/workflows/dis-ci.yml
- **Out of scope:** generating client code, rewriting routes, UI.

**Description:**
Copy the canonical OpenAPI spec from `04_api/openapi.yaml` into `dis/openapi.yaml`. CI step validates it with `@redocly/cli` or `swagger-cli`.

**VERIFY:**

- VERIFY-1: `test -f dis/openapi.yaml && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "^openapi: 3\." dis/openapi.yaml` — expect `1`
- VERIFY-3: `grep -c "/health" dis/openapi.yaml` — expect ≥ `1`
- VERIFY-4: `grep -ci "openapi" .github/workflows/dis-ci.yml` — expect ≥ `1`
- VERIFY-5: `test -f dis/scripts/validate-openapi.sh && echo OK` — expect `OK`

**Status:** Ready

### DIS-008 — Structured logger (pino) + correlation-id middleware

- **Tags:** `core`, `infra`
- **Epic:** A
- **Depends on:** DIS-004
- **TDD ref:** §14 (observability)
- **CS ref:** none
- **Files allowed:**
  - dis/src/core/logger.ts
  - dis/src/http/middleware/correlation-id.ts
  - dis/tests/unit/logger.test.ts
  - dis/tests/integration/correlation-id.test.ts
- **Out of scope:** remote log shipping, OTLP exporter (DIS-147), metrics.

**Description:**
Pino-based structured logger with service/version fields. Middleware that reads `X-Correlation-Id`, generates a UUID v4 if absent, binds it to the request context, and echoes it on the response.

**VERIFY:**

- VERIFY-1: `grep -cE "pino" dis/src/core/logger.ts dis/package.json` — expect ≥ `2`
- VERIFY-2: `grep -cE "X-Correlation-Id|correlation_id|correlationId" dis/src/http/middleware/correlation-id.ts` — expect ≥ `2`
- VERIFY-3: `cd dis && npx vitest run tests/unit/logger.test.ts tests/integration/correlation-id.test.ts` — expect exit code 0
- VERIFY-4: `grep -c "uuid\|randomUUID" dis/src/http/middleware/correlation-id.ts` — expect ≥ `1`
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-009 — Metrics stub + /admin/metrics endpoint

- **Tags:** `core`, `infra`
- **Epic:** A
- **Depends on:** DIS-004, DIS-008
- **TDD ref:** §14 (observability)
- **CS ref:** none
- **Files allowed:**
  - dis/src/core/metrics.ts
  - dis/src/http/routes/admin-metrics.ts
  - dis/tests/integration/admin-metrics.test.ts
- **Out of scope:** Prometheus exposition format (later), auth on the endpoint.

**Description:**
In-memory counters + gauges with `inc(name,labels)` and `snapshot()`. Expose via `GET /admin/metrics` as JSON for POC.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/metrics.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "inc\s*\(|snapshot\s*\(" dis/src/core/metrics.ts` — expect ≥ `2`
- VERIFY-3: `grep -c "/admin/metrics" dis/src/http/routes/admin-metrics.ts` — expect ≥ `1`
- VERIFY-4: `cd dis && npx vitest run tests/integration/admin-metrics.test.ts` — expect exit code 0
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-010 — Env var loader with zod schema

- **Tags:** `core`, `infra`
- **Epic:** A
- **Depends on:** DIS-001
- **TDD ref:** §16 (configuration)
- **CS ref:** none
- **Files allowed:**
  - dis/src/core/env.ts
  - dis/src/core/env.schema.ts
  - dis/tests/unit/env.test.ts
- **Out of scope:** secrets loading (DIS-055), runtime reloading.

**Description:**
Zod schema validates required env vars at boot: `PORT`, `NODE_ENV`, `DIS_OCR_PROVIDER`, `DIS_MAX_UPLOAD_MB`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc. Missing or bad → process exits with readable error.

**VERIFY:**

- VERIFY-1: `grep -cE "zod" dis/src/core/env.schema.ts dis/package.json` — expect ≥ `2`
- VERIFY-2: `grep -cE "DIS_OCR_PROVIDER|SUPABASE_URL|DIS_MAX_UPLOAD_MB" dis/src/core/env.schema.ts` — expect ≥ `3`
- VERIFY-3: `cd dis && npx vitest run tests/unit/env.test.ts` — expect exit code 0
- VERIFY-4: `grep -cE "parse\s*\(" dis/src/core/env.ts` — expect ≥ `1`
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-011 — Port validator script (CI-wired)

- **Tags:** `infra`, `test`
- **Epic:** A
- **Depends on:** DIS-002, DIS-003
- **TDD ref:** §1 (architectural style)
- **CS ref:** none
- **Files allowed:**
  - dis/scripts/port-validator.sh
  - dis/tests/unit/port-validator.test.ts
- **Out of scope:** refactoring any source file the validator flags.

**Description:**
Script that fails if any file under `dis/src/core/` or `dis/src/ports/` imports from `dis/src/adapters/`. Wired into DIS-002 CI step.

**VERIFY:**

- VERIFY-1: `test -f dis/scripts/port-validator.sh && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `bash dis/scripts/port-validator.sh` — expect exit code 0 on clean tree
- VERIFY-3: `grep -cE "adapters/" dis/scripts/port-validator.sh` — expect ≥ `1`
- VERIFY-4: `grep -c "port-validator" .github/workflows/dis-ci.yml` — expect ≥ `1`
- VERIFY-5: `cd dis && npx vitest run tests/unit/port-validator.test.ts` — expect exit code 0

**Status:** Ready

### DIS-012 — Test harness utilities (fake adapter factory)

- **Tags:** `core`, `test`
- **Epic:** A
- **Depends on:** DIS-003
- **TDD ref:** §9.1, §10.1
- **CS ref:** none
- **Files allowed:**
  - dis/tests/helpers/fake-adapters.ts
  - dis/tests/helpers/index.ts
  - dis/tests/unit/fake-adapters.test.ts
- **Out of scope:** real adapters, real I/O.

**Description:**
Factory producing in-memory fakes for all 8 ports with tunable behaviours (success, timeout, schema-drift). Used by every core test in Epic B.

**VERIFY:**

- VERIFY-1: `test -f dis/tests/helpers/fake-adapters.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "FakeOcr|FakeStructuring|FakeStorage|FakeDatabase|FakeQueue|FakeSecrets|FakeFileRouter|FakePreprocessor" dis/tests/helpers/fake-adapters.ts` — expect ≥ `8`
- VERIFY-3: `cd dis && npx vitest run tests/unit/fake-adapters.test.ts` — expect exit code 0
- VERIFY-4: `cd dis && npx tsc --noEmit` — expect exit code 0
- VERIFY-5: `grep -cE "from ['\"].*src/adapters" dis/tests/helpers/fake-adapters.ts || echo CLEAN` — expect `CLEAN`

**Status:** Ready

### DIS-013 — Fixture loader for tests

- **Tags:** `test`
- **Epic:** A
- **Depends on:** DIS-001
- **TDD ref:** §11 (testing strategy)
- **CS ref:** none
- **Files allowed:**
  - dis/tests/fixtures/README.md
  - dis/tests/fixtures/index.ts
  - dis/tests/fixtures/sample_extraction.v1.json
  - dis/tests/unit/fixture-loader.test.ts
- **Out of scope:** real patient data.

**Description:**
`loadFixture(name)` helper returns a typed fixture object from `tests/fixtures/*.json`. All DIS clinical fixtures are synthetic.

**VERIFY:**

- VERIFY-1: `test -f dis/tests/fixtures/index.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -c "loadFixture" dis/tests/fixtures/index.ts` — expect ≥ `1`
- VERIFY-3: `node -e "JSON.parse(require('fs').readFileSync('dis/tests/fixtures/sample_extraction.v1.json','utf8'));console.log('VALID')"` — expect `VALID`
- VERIFY-4: `cd dis && npx vitest run tests/unit/fixture-loader.test.ts` — expect exit code 0
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-014 — Idempotency key middleware (skeleton)

- **Tags:** `core`, `infra`
- **Epic:** A
- **Depends on:** DIS-004, DIS-008
- **TDD ref:** §3, §5
- **CS ref:** none
- **Files allowed:**
  - dis/src/http/middleware/idempotency.ts
  - dis/tests/unit/idempotency.test.ts
- **Out of scope:** persistent idempotency store (DIS-025).

**Description:**
Read `Idempotency-Key` header; for matching routes, short-circuit and return a stub `IdempotencyResolution` (the store is DIS-025). Rejects missing header on `POST /ingest` with 400.

**VERIFY:**

- VERIFY-1: `test -f dis/src/http/middleware/idempotency.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "Idempotency-Key" dis/src/http/middleware/idempotency.ts` — expect ≥ `1`
- VERIFY-3: `cd dis && npx vitest run tests/unit/idempotency.test.ts` — expect exit code 0
- VERIFY-4: `grep -c "400" dis/src/http/middleware/idempotency.ts` — expect ≥ `1`
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-015 — dis/CHANGELOG.md seeded

- **Tags:** `doc-only`, `infra`
- **Epic:** A
- **Depends on:** DIS-001
- **TDD ref:** §17 (portability/release)
- **CS ref:** none
- **Files allowed:**
  - dis/CHANGELOG.md
- **Out of scope:** release automation tooling.

**Description:**
Seed `dis/CHANGELOG.md` following Keep-a-Changelog format with a single `Unreleased` section listing current Epic A work.

**VERIFY:**

- VERIFY-1: `test -f dis/CHANGELOG.md && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "^## \[Unreleased\]" dis/CHANGELOG.md` — expect ≥ `1`
- VERIFY-3: `grep -ciE "keep a changelog|keepachangelog" dis/CHANGELOG.md` — expect ≥ `1`
- VERIFY-4: `wc -l < dis/CHANGELOG.md` — expect ≥ `10`

**Status:** Ready

---

## Epic B — Core business logic

### DIS-020 — State machine (pure)

- **Tags:** `core`, `clinical-safety` (CS-1 — no bypass of verification)
- **Epic:** B
- **Depends on:** DIS-003, DIS-006
- **TDD ref:** §4
- **CS ref:** CS-1
- **Files allowed:**
  - dis/src/core/state-machine.ts
  - dis/src/core/errors.ts
  - dis/tests/unit/state-machine.test.ts
- **Out of scope:** any adapter, HTTP wiring, persistence.

**Description:**
Pure state machine `(currentState, event) → nextState | Error`. Events: `upload`, `routed_native`, `routed_scan`, `preprocessed`, `ocr_complete`, `structured`, `policy_auto_approved`, `nurse_approve`, `nurse_reject`, `promoted`, `fail`. Invalid transitions throw `InvalidStateTransitionError`. CS-1: no event path can skip `nurse_approve` when policy `enabled: false`.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/state-machine.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "InvalidStateTransitionError" dis/src/core/errors.ts dis/src/core/state-machine.ts` — expect ≥ `2`
- VERIFY-3: `cd dis && npx vitest run tests/unit/state-machine.test.ts` — expect exit code 0
- VERIFY-4: `grep -cE "CS-1" dis/tests/unit/state-machine.test.ts` — expect ≥ `1` (CS-1 assertion named in test file)
- VERIFY-5: `cd dis && npx vitest run tests/unit/state-machine.test.ts --coverage` — expect `100%` branches in state-machine.ts
- VERIFY-6: `grep -cE "from ['\"].*adapters|from ['\"].*http" dis/src/core/state-machine.ts || echo CLEAN` — expect `CLEAN`

**Status:** Ready

### DIS-021 — IngestionOrchestrator

- **Tags:** `core`
- **Epic:** B
- **Depends on:** DIS-020, DIS-003, DIS-012
- **TDD ref:** §4, §6
- **CS ref:** none (composes CS-1 via DIS-020)
- **Files allowed:**
  - dis/src/core/orchestrator.ts
  - dis/src/core/errors.ts
  - dis/tests/unit/orchestrator.test.ts
- **Out of scope:** real adapters, HTTP endpoint wiring (DIS-090+).

**Description:**
Class that accepts 8 injected ports and runs one extraction end-to-end. Exposes `ingest()`, `process()`, `approve()`, `reject()`, `retry()`. Optimistic locking on `approve()` — `VersionConflictError` when DB version differs from expected.

**VERIFY:**

- VERIFY-1: `grep -cE "class IngestionOrchestrator" dis/src/core/orchestrator.ts` — expect `1`
- VERIFY-2: `grep -cE "ingest\s*\(|process\s*\(|approve\s*\(|reject\s*\(|retry\s*\(" dis/src/core/orchestrator.ts` — expect ≥ `5`
- VERIFY-3: `grep -cE "VersionConflictError" dis/src/core/errors.ts dis/src/core/orchestrator.ts` — expect ≥ `2`
- VERIFY-4: `cd dis && npx vitest run tests/unit/orchestrator.test.ts` — expect exit code 0
- VERIFY-5: `grep -cE "FakeOcr|FakeDatabase|FakeStorage" dis/tests/unit/orchestrator.test.ts` — expect ≥ `3`
- VERIFY-6: `grep -cE "from ['\"].*adapters" dis/src/core/orchestrator.ts || echo CLEAN` — expect `CLEAN`

**Status:** Ready

### DIS-022 — Confidence policy evaluator

- **Tags:** `core`, `clinical-safety` (CS-7)
- **Epic:** B
- **Depends on:** DIS-003, DIS-006
- **TDD ref:** §12
- **CS ref:** CS-7
- **Files allowed:**
  - dis/src/core/confidence-policy.ts
  - dis/tests/unit/confidence-policy.test.ts
- **Out of scope:** policy persistence, admin UI for policy editing.

**Description:**
Pure function `(extraction, policyConfig, blockList) → { auto_approved, rule_results, policy_version }`. Default at launch `enabled: false` — must always return `auto_approved: false`. Per-field rules evaluated independently; one field below threshold → full extraction requires review. Policy version stamped on every decision.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/confidence-policy.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `cd dis && npx vitest run tests/unit/confidence-policy.test.ts` — expect exit code 0
- VERIFY-3: `grep -cE "CS-7" dis/tests/unit/confidence-policy.test.ts` — expect ≥ `1`
- VERIFY-4: `grep -cE "enabled.*false|auto_approved.*false" dis/tests/unit/confidence-policy.test.ts` — expect ≥ `2`
- VERIFY-5: `grep -c "policy_version" dis/src/core/confidence-policy.ts` — expect ≥ `1`
- VERIFY-6: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-023 — Promotion service

- **Tags:** `core`, `clinical-safety` (CS-10, CS-11)
- **Epic:** B
- **Depends on:** DIS-020, DIS-003
- **TDD ref:** §13
- **CS ref:** CS-10, CS-11
- **Files allowed:**
  - dis/src/core/promotion.ts
  - dis/tests/unit/promotion.test.ts
  - dis/tests/fixtures/discharge_summary_7_tsb.json
- **Out of scope:** executing the transaction (database adapter's job).

**Description:**
Pure function `(verifiedExtraction) → PromotionPlan` with INSERTs for `lab_results` / `vaccinations` + PATCH for `visits.attached_documents`. CS-10: for `document_type=discharge_summary`, dedupe labs by `test_name_normalized` keeping latest `test_date`. CS-11: skip if `(patient_id, test_name, test_date, value_numeric)` already exists. Plan lists skipped rows with reason.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/promotion.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `cd dis && npx vitest run tests/unit/promotion.test.ts` — expect exit code 0
- VERIFY-3: `grep -cE "CS-10" dis/tests/unit/promotion.test.ts` — expect ≥ `1`
- VERIFY-4: `grep -cE "CS-11" dis/tests/unit/promotion.test.ts` — expect ≥ `1`
- VERIFY-5: `grep -cE "7.*TSB|tsb.*7" dis/tests/unit/promotion.test.ts` — expect ≥ `1` (7-reading dedupe fixture assertion)
- VERIFY-6: `grep -cE "skipped|skippedRows" dis/src/core/promotion.ts` — expect ≥ `1`

**Status:** Ready

### DIS-024 — Audit log writer (append-only)

- **Tags:** `core`, `clinical-safety` (CS-3)
- **Epic:** B
- **Depends on:** DIS-020, DIS-008
- **TDD ref:** §6, §14
- **CS ref:** CS-3
- **Files allowed:**
  - dis/src/core/audit-log.ts
  - dis/tests/unit/audit-log.test.ts
- **Out of scope:** DB-level append-only enforcement (that is the migration in Epic F).

**Description:**
Pure writer that emits `AuditEvent` records: `{event, actor, subject_id, before, after, ts, correlation_id}`. Application-level guard rejects mutations of previously-written rows (delete/update).

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/audit-log.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `cd dis && npx vitest run tests/unit/audit-log.test.ts` — expect exit code 0
- VERIFY-3: `grep -cE "CS-3" dis/tests/unit/audit-log.test.ts` — expect ≥ `1`
- VERIFY-4: `grep -cE "append[-_]?only|immut" dis/src/core/audit-log.ts` — expect ≥ `1`
- VERIFY-5: `grep -cE "correlation_id" dis/src/core/audit-log.ts` — expect ≥ `1`

**Status:** Ready

### DIS-025 — Idempotency key handler

- **Tags:** `core`
- **Epic:** B
- **Depends on:** DIS-014, DIS-003
- **TDD ref:** §5
- **CS ref:** none
- **Files allowed:**
  - dis/src/core/idempotency-store.ts
  - dis/tests/unit/idempotency-store.test.ts
- **Out of scope:** DB table definition (Epic F migrations), middleware wiring (DIS-014).

**Description:**
Pure store interface backed by DatabasePort. `recordAndResolve(key, payloadHash)` returns `{action: 'new' | 'replay' | 'collision'}`. Collision = same key with different payload hash.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/idempotency-store.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "new|replay|collision" dis/src/core/idempotency-store.ts` — expect ≥ `3`
- VERIFY-3: `cd dis && npx vitest run tests/unit/idempotency-store.test.ts` — expect exit code 0
- VERIFY-4: `grep -c "payloadHash\|payload_hash" dis/src/core/idempotency-store.ts` — expect ≥ `1`
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-026 — Version / optimistic-lock helper

- **Tags:** `core`
- **Epic:** B
- **Depends on:** DIS-003
- **TDD ref:** §6
- **CS ref:** none
- **Files allowed:**
  - dis/src/core/version-lock.ts
  - dis/tests/unit/version-lock.test.ts
- **Out of scope:** SQL UPDATE wiring (Epic C SupabasePostgresAdapter).

**Description:**
`compareAndSet(currentVersion, expectedVersion) → boolean` + helper `bumpVersion(v)` enforcing monotonic integer increments. Used by orchestrator approve path.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/version-lock.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "compareAndSet|bumpVersion" dis/src/core/version-lock.ts` — expect ≥ `2`
- VERIFY-3: `cd dis && npx vitest run tests/unit/version-lock.test.ts` — expect exit code 0
- VERIFY-4: `grep -cE "VersionConflict" dis/src/core/version-lock.ts dis/src/core/errors.ts` — expect ≥ `1`
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-027 — Content-hash utility (sha256)

- **Tags:** `core`
- **Epic:** B
- **Depends on:** DIS-001
- **TDD ref:** §5, §11
- **CS ref:** none
- **Files allowed:**
  - dis/src/core/content-hash.ts
  - dis/tests/unit/content-hash.test.ts
- **Out of scope:** storage upload (DIS-053).

**Description:**
Pure utility `sha256(bytes) → hex string` using Node `crypto`. Used for duplicate detection, idempotency payload hashing, and storage integrity.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/content-hash.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "createHash\s*\(\s*['\"]sha256" dis/src/core/content-hash.ts` — expect ≥ `1`
- VERIFY-3: `cd dis && npx vitest run tests/unit/content-hash.test.ts` — expect exit code 0
- VERIFY-4: `node -e "const {sha256}=require('./dis/src/core/content-hash.ts'.replace('.ts','.js'));" 2>&1 | head -1 || echo EXPECTED` — expect `EXPECTED` (ts not compiled; informational)
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-028 — Correlation ID generator + propagator

- **Tags:** `core`
- **Epic:** B
- **Depends on:** DIS-008
- **TDD ref:** §14
- **CS ref:** none
- **Files allowed:**
  - dis/src/core/correlation.ts
  - dis/tests/unit/correlation.test.ts
- **Out of scope:** HTTP middleware (DIS-008 owns that).

**Description:**
`newCorrelationId() → string` (UUID v4) + AsyncLocalStorage-backed `withCorrelation(id, fn)` and `currentCorrelationId()` for cross-cutting propagation into logger, metrics, and audit log.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/correlation.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "AsyncLocalStorage|randomUUID" dis/src/core/correlation.ts` — expect ≥ `2`
- VERIFY-3: `cd dis && npx vitest run tests/unit/correlation.test.ts` — expect exit code 0
- VERIFY-4: `grep -c "withCorrelation\|currentCorrelationId" dis/src/core/correlation.ts` — expect ≥ `2`

**Status:** Ready

### DIS-029 — Error envelope builder

- **Tags:** `core`
- **Epic:** B
- **Depends on:** DIS-005, DIS-028
- **TDD ref:** §15
- **CS ref:** none
- **Files allowed:**
  - dis/src/core/error-envelope.ts
  - dis/tests/unit/error-envelope-builder.test.ts
- **Out of scope:** HTTP middleware wiring (DIS-005).

**Description:**
Pure builder `toEnvelope(err, correlationId) → ErrorEnvelope` mapping known DIS errors to stable `error.code` values defined in `04_api/error_model.md`.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/error-envelope.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "toEnvelope" dis/src/core/error-envelope.ts` — expect ≥ `1`
- VERIFY-3: `cd dis && npx vitest run tests/unit/error-envelope-builder.test.ts` — expect exit code 0
- VERIFY-4: `grep -cE "InvalidStateTransitionError|VersionConflictError|OcrProviderTimeoutError" dis/src/core/error-envelope.ts` — expect ≥ `2`
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-030 — ClinicalExtraction schema validator

- **Tags:** `core`, `test`
- **Epic:** B
- **Depends on:** DIS-006
- **TDD ref:** §10.2
- **CS ref:** none
- **Files allowed:**
  - dis/src/core/validate-extraction.ts
  - dis/tests/unit/validate-extraction.test.ts
- **Out of scope:** structuring adapter (DIS-051).

**Description:**
Wraps Ajv compile of `clinical_extraction.v1.json` and exposes `validateExtraction(obj) → { ok, errors }`. Used by DIS-051 on every structuring response.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/validate-extraction.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -c "clinical_extraction.v1.json" dis/src/core/validate-extraction.ts` — expect ≥ `1`
- VERIFY-3: `cd dis && npx vitest run tests/unit/validate-extraction.test.ts` — expect exit code 0
- VERIFY-4: `grep -cE "validateExtraction" dis/src/core/validate-extraction.ts` — expect ≥ `1`
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-031 — Structuring prompt management

- **Tags:** `core`
- **Epic:** B
- **Depends on:** DIS-001
- **TDD ref:** §10
- **CS ref:** none
- **Files allowed:**
  - dis/src/core/prompts/loader.ts
  - dis/src/core/prompts/structuring.md
  - dis/tests/unit/prompt-loader.test.ts
- **Out of scope:** the Claude adapter (DIS-051).

**Description:**
Load `structuring.md` once at startup, expose `getStructuringPrompt() → { text, version }` where version is content-hashed. Stamped onto every structuring call for auditability.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/prompts/structuring.md && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `wc -l < dis/src/core/prompts/structuring.md` — expect ≥ `5`
- VERIFY-3: `grep -c "getStructuringPrompt" dis/src/core/prompts/loader.ts` — expect ≥ `1`
- VERIFY-4: `grep -cE "version|hash" dis/src/core/prompts/loader.ts` — expect ≥ `1`
- VERIFY-5: `cd dis && npx vitest run tests/unit/prompt-loader.test.ts` — expect exit code 0

**Status:** Ready

### DIS-032 — Cost calculator (tokens + pages → micro-INR)

- **Tags:** `core`
- **Epic:** B
- **Depends on:** DIS-010
- **TDD ref:** §14
- **CS ref:** none
- **Files allowed:**
  - dis/src/core/cost-calculator.ts
  - dis/tests/unit/cost-calculator.test.ts
- **Out of scope:** cost ledger writer (DIS-149).

**Description:**
Pure function mapping OCR page count + LLM token counts to a cost in micro-INR using env-configured rate tables. Returns a `CostBreakdown` suitable for the cost ledger.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/cost-calculator.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "micro.?INR|microINR|micro_inr" dis/src/core/cost-calculator.ts` — expect ≥ `1`
- VERIFY-3: `cd dis && npx vitest run tests/unit/cost-calculator.test.ts` — expect exit code 0
- VERIFY-4: `grep -cE "input_tokens|output_tokens|pages" dis/src/core/cost-calculator.ts` — expect ≥ `2`

**Status:** Ready

### DIS-033 — Native-PDF text extractor (pdfjs-dist wrapper)

- **Tags:** `core`
- **Epic:** B
- **Depends on:** DIS-001
- **TDD ref:** §7 (file-router), §9.2
- **CS ref:** none
- **Files allowed:**
  - dis/src/core/native-pdf.ts
  - dis/tests/unit/native-pdf.test.ts
  - dis/tests/fixtures/native_text.pdf
- **Out of scope:** scanned-PDF OCR (Epic C DatalabChandraAdapter).

**Description:**
Pure wrapper over `pdfjs-dist` exposing `extractNativeText(bytes) → { pages: [{text, page}] }`. Throws `NativePdfUnavailableError` if the PDF has no text layer; the file-router (DIS-057) uses that to fall through to OCR.

**VERIFY:**

- VERIFY-1: `test -f dis/src/core/native-pdf.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "pdfjs-dist" dis/src/core/native-pdf.ts dis/package.json` — expect ≥ `2`
- VERIFY-3: `cd dis && npx vitest run tests/unit/native-pdf.test.ts` — expect exit code 0
- VERIFY-4: `grep -c "NativePdfUnavailableError" dis/src/core/native-pdf.ts dis/src/core/errors.ts` — expect ≥ `1`
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect exit code 0

**Status:** Ready

### DIS-034 — State-machine integration test (full happy path)

- **Tags:** `core`, `test`
- **Epic:** B
- **Depends on:** DIS-020, DIS-021, DIS-012
- **TDD ref:** §4, §6
- **CS ref:** CS-1
- **Files allowed:**
  - dis/tests/integration/state-machine-happy-path.test.ts
- **Out of scope:** real adapters.

**Description:**
End-to-end path through the orchestrator using fakes: `upload → routed_native → ocr_complete → structured → nurse_approve → promoted`.

**VERIFY:**

- VERIFY-1: `test -f dis/tests/integration/state-machine-happy-path.test.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "CS-1" dis/tests/integration/state-machine-happy-path.test.ts` — expect ≥ `1`
- VERIFY-3: `cd dis && npx vitest run tests/integration/state-machine-happy-path.test.ts` — expect exit code 0
- VERIFY-4: `grep -cE "promoted" dis/tests/integration/state-machine-happy-path.test.ts` — expect ≥ `1`

**Status:** Ready

### DIS-035 — Orchestrator retry path integration test

- **Tags:** `core`, `test`
- **Epic:** B
- **Depends on:** DIS-021, DIS-012
- **TDD ref:** §4, §6
- **CS ref:** none
- **Files allowed:**
  - dis/tests/integration/orchestrator-retry.test.ts
- **Out of scope:** real adapters.

**Description:**
Covers `retry()` after an OCR failure: old extraction row preserved, new row created with incremented version.

**VERIFY:**

- VERIFY-1: `test -f dis/tests/integration/orchestrator-retry.test.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `cd dis && npx vitest run tests/integration/orchestrator-retry.test.ts` — expect exit code 0
- VERIFY-3: `grep -cE "retry|preserve" dis/tests/integration/orchestrator-retry.test.ts` — expect ≥ `2`

**Status:** Ready

### DIS-036 — Confidence-policy integration with orchestrator

- **Tags:** `core`, `test`, `clinical-safety` (CS-7)
- **Epic:** B
- **Depends on:** DIS-021, DIS-022
- **TDD ref:** §12
- **CS ref:** CS-7
- **Files allowed:**
  - dis/tests/integration/confidence-policy-orchestrator.test.ts
- **Out of scope:** real adapters.

**Description:**
Verifies policy `enabled: false` forces every extraction through `nurse_approve` regardless of per-field confidence.

**VERIFY:**

- VERIFY-1: `test -f dis/tests/integration/confidence-policy-orchestrator.test.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "CS-7" dis/tests/integration/confidence-policy-orchestrator.test.ts` — expect ≥ `1`
- VERIFY-3: `cd dis && npx vitest run tests/integration/confidence-policy-orchestrator.test.ts` — expect exit code 0
- VERIFY-4: `grep -cE "enabled.*false" dis/tests/integration/confidence-policy-orchestrator.test.ts` — expect ≥ `1`

**Status:** Ready

### DIS-037 — Promotion service integration (discharge summary)

- **Tags:** `core`, `test`, `clinical-safety` (CS-10, CS-11)
- **Epic:** B
- **Depends on:** DIS-023, DIS-012
- **TDD ref:** §13
- **CS ref:** CS-10, CS-11
- **Files allowed:**
  - dis/tests/integration/promotion-discharge.test.ts
- **Out of scope:** real database adapter (DIS-054).

**Description:**
Uses fake database + fixture discharge summary with 7 TSB readings → asserts one lab insert (CS-10) and zero inserts on replay (CS-11).

**VERIFY:**

- VERIFY-1: `test -f dis/tests/integration/promotion-discharge.test.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "CS-10" dis/tests/integration/promotion-discharge.test.ts` — expect ≥ `1`
- VERIFY-3: `grep -cE "CS-11" dis/tests/integration/promotion-discharge.test.ts` — expect ≥ `1`
- VERIFY-4: `cd dis && npx vitest run tests/integration/promotion-discharge.test.ts` — expect exit code 0

**Status:** Ready

### DIS-038 — Audit log integration (orchestrator wiring)

- **Tags:** `core`, `test`, `clinical-safety` (CS-3)
- **Epic:** B
- **Depends on:** DIS-024, DIS-021
- **TDD ref:** §6, §14
- **CS ref:** CS-3
- **Files allowed:**
  - dis/tests/integration/audit-log-orchestrator.test.ts
- **Out of scope:** DB-level trigger enforcement.

**Description:**
Every orchestrator method produces an audit event. Verifies fields `event`, `actor`, `subject_id`, `correlation_id`, `before`, `after`.

**VERIFY:**

- VERIFY-1: `test -f dis/tests/integration/audit-log-orchestrator.test.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -cE "CS-3" dis/tests/integration/audit-log-orchestrator.test.ts` — expect ≥ `1`
- VERIFY-3: `cd dis && npx vitest run tests/integration/audit-log-orchestrator.test.ts` — expect exit code 0
- VERIFY-4: `grep -cE "correlation_id|correlationId" dis/tests/integration/audit-log-orchestrator.test.ts` — expect ≥ `1`

**Status:** Ready

### DIS-039 — Idempotency store integration test

- **Tags:** `core`, `test`
- **Epic:** B
- **Depends on:** DIS-025, DIS-012
- **TDD ref:** §5
- **CS ref:** none
- **Files allowed:**
  - dis/tests/integration/idempotency-store.test.ts
- **Out of scope:** real database.

**Description:**
Covers all three `recordAndResolve()` outcomes with fake database: `new`, `replay`, `collision`.

**VERIFY:**

- VERIFY-1: `test -f dis/tests/integration/idempotency-store.test.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `cd dis && npx vitest run tests/integration/idempotency-store.test.ts` — expect exit code 0
- VERIFY-3: `grep -cE "new|replay|collision" dis/tests/integration/idempotency-store.test.ts` — expect ≥ `3`

**Status:** Ready

### DIS-040 — Version-lock integration (approve race)

- **Tags:** `core`, `test`
- **Epic:** B
- **Depends on:** DIS-021, DIS-026
- **TDD ref:** §6
- **CS ref:** none
- **Files allowed:**
  - dis/tests/integration/approve-race.test.ts
- **Out of scope:** real adapters.

**Description:**
Two concurrent `approve()` calls on the same extraction — exactly one succeeds, the other throws `VersionConflictError`.

**VERIFY:**

- VERIFY-1: `test -f dis/tests/integration/approve-race.test.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `cd dis && npx vitest run tests/integration/approve-race.test.ts` — expect exit code 0
- VERIFY-3: `grep -c "VersionConflictError" dis/tests/integration/approve-race.test.ts` — expect ≥ `1`

**Status:** Ready

### DIS-041 — Content-hash + storage dedupe integration

- **Tags:** `core`, `test`
- **Epic:** B
- **Depends on:** DIS-027, DIS-012
- **TDD ref:** §5
- **CS ref:** none
- **Files allowed:**
  - dis/tests/integration/content-hash-dedupe.test.ts
- **Out of scope:** Supabase Storage (DIS-053).

**Description:**
Re-uploading byte-identical file → second upload resolves to the existing `extraction_id` and no new storage write is enqueued.

**VERIFY:**

- VERIFY-1: `test -f dis/tests/integration/content-hash-dedupe.test.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `cd dis && npx vitest run tests/integration/content-hash-dedupe.test.ts` — expect exit code 0
- VERIFY-3: `grep -c "sha256\|content_hash\|contentHash" dis/tests/integration/content-hash-dedupe.test.ts` — expect ≥ `1`

**Status:** Ready

### DIS-042 — Correlation propagation integration

- **Tags:** `core`, `test`
- **Epic:** B
- **Depends on:** DIS-028, DIS-024
- **TDD ref:** §14
- **CS ref:** none
- **Files allowed:**
  - dis/tests/integration/correlation-propagation.test.ts
- **Out of scope:** real HTTP round-trip.

**Description:**
Single `ingest()` call — correlation id present on the orchestrator log line AND on the emitted audit event AND on the metrics sample.

**VERIFY:**

- VERIFY-1: `test -f dis/tests/integration/correlation-propagation.test.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `cd dis && npx vitest run tests/integration/correlation-propagation.test.ts` — expect exit code 0
- VERIFY-3: `grep -cE "correlation" dis/tests/integration/correlation-propagation.test.ts` — expect ≥ `3`

**Status:** Ready

### DIS-043 — Error envelope integration (end-to-end)

- **Tags:** `core`, `test`
- **Epic:** B
- **Depends on:** DIS-029, DIS-005
- **TDD ref:** §15
- **CS ref:** none
- **Files allowed:**
  - dis/tests/integration/error-envelope-e2e.test.ts
- **Out of scope:** real adapters.

**Description:**
Throws every known DIS error through the HTTP middleware and asserts the JSON envelope matches `04_api/error_model.md`.

**VERIFY:**

- VERIFY-1: `test -f dis/tests/integration/error-envelope-e2e.test.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `cd dis && npx vitest run tests/integration/error-envelope-e2e.test.ts` — expect exit code 0
- VERIFY-3: `grep -cE "error.code|correlation_id" dis/tests/integration/error-envelope-e2e.test.ts` — expect ≥ `2`

**Status:** Ready

### DIS-044 — ClinicalExtraction schema integration (drift detection)

- **Tags:** `core`, `test`
- **Epic:** B
- **Depends on:** DIS-030, DIS-021
- **TDD ref:** §10.2
- **CS ref:** none
- **Files allowed:**
  - dis/tests/integration/schema-drift.test.ts
- **Out of scope:** live Claude calls.

**Description:**
Fake structuring adapter returns a response missing a required field → orchestrator retries once (DIS-051 contract), then surfaces `StructuringSchemaInvalidError`.

**VERIFY:**

- VERIFY-1: `test -f dis/tests/integration/schema-drift.test.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `cd dis && npx vitest run tests/integration/schema-drift.test.ts` — expect exit code 0
- VERIFY-3: `grep -c "StructuringSchemaInvalidError" dis/tests/integration/schema-drift.test.ts` — expect ≥ `1`

**Status:** Ready

### DIS-045 — Cost calculator integration (per-run aggregate)

- **Tags:** `core`, `test`
- **Epic:** B
- **Depends on:** DIS-032, DIS-021
- **TDD ref:** §14
- **CS ref:** none
- **Files allowed:**
  - dis/tests/integration/cost-aggregate.test.ts
- **Out of scope:** cost ledger persistence (DIS-149).

**Description:**
One orchestrator run with fake adapters supplying page counts + token counts — asserts a single `CostBreakdown` with OCR + LLM line items and the sum matches expected micro-INR.

**VERIFY:**

- VERIFY-1: `test -f dis/tests/integration/cost-aggregate.test.ts && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `cd dis && npx vitest run tests/integration/cost-aggregate.test.ts` — expect exit code 0
- VERIFY-3: `grep -cE "CostBreakdown|micro" dis/tests/integration/cost-aggregate.test.ts` — expect ≥ `1`

**Status:** Ready

---

## Epic C — Adapters (POC stack)

### DIS-050 — DatalabChandraAdapter

- **Tags:** `adapter`, `clinical-safety` (CS-2 — preserve raw response)
- **Epic:** C
- **Depends on:** DIS-003, DIS-010 (env loader), DIS-055 (SupabaseSecretsAdapter)
- **TDD ref:** §9.2
- **CS ref:** CS-2 (preserve raw OCR response verbatim for audit)
- **Files allowed:**
  - dis/src/adapters/ocr/datalab-chandra.ts
  - dis/src/adapters/ocr/datalab-chandra.types.ts
  - dis/tests/adapters/ocr/datalab-chandra.contract.test.ts
  - dis/tests/adapters/ocr/datalab-chandra.integration.test.ts
  - dis/tests/fixtures/datalab/\*.json
- **Out of scope:** on-prem Chandra client, any other OCR provider, caching of OCR results.

**Description:** Implements `OcrPort` against Datalab's hosted API. Submits to `POST /api/v1/convert` with `output_format=markdown,json`, mode `accurate`. Polls `GET /convert-result-check/{id}` with exponential backoff (1s → 10s, max 120s). Raw response preserved verbatim on `OcrResult.rawResponse`. Key is pulled from Secrets Adapter.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/ocr/datalab-chandra.contract.test.ts` — expect `Test Files  1 passed` and `Tests  passed` count > 0.
- VERIFY-2: `cd dis && npx vitest run tests/adapters/ocr/datalab-chandra.integration.test.ts --reporter=verbose` — expect one test case `submits real PDF and returns markdown + rawResponse` PASS; paste last 10 lines of output.
- VERIFY-3: `grep -n "rawResponse" dis/src/adapters/ocr/datalab-chandra.ts` — expect at least one line assigning `rawResponse:` with the full provider payload (no field stripping).
- VERIFY-4: `grep -nE "DATALAB_API_KEY" dis/src/adapters/ocr/datalab-chandra.ts` — expect zero hardcoded key constants; only a call through `SecretsPort.get('DATALAB_API_KEY')`.
- VERIFY-5: `cd dis && npx vitest run -t "times out after 120s"` — expect a test asserting `OcrProviderTimeoutError` is thrown.
- VERIFY-6: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-051 — ClaudeHaikuAdapter

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-003, DIS-030 (schema validator), DIS-031 (prompt loader)
- **TDD ref:** §10
- **Files allowed:**
  - dis/src/adapters/structuring/claude-haiku.ts
  - dis/src/adapters/structuring/claude-haiku.types.ts
  - dis/tests/adapters/structuring/claude-haiku.contract.test.ts
  - dis/tests/adapters/structuring/claude-haiku.live.test.ts
  - dis/tests/fixtures/haiku/\*.{md,json}
- **Out of scope:** Sonnet fallback adapter (separate ticket), prompt editing, tool-use loop.

**Description:** Implements `StructuringPort`. Sends Markdown + prompt to Claude Haiku, expects JSON matching `clinical_extraction.v1.json`. On schema failure, retries once with `strict: true` cue. Second failure throws `StructuringSchemaInvalidError`. Logs drift retries.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/structuring/claude-haiku.contract.test.ts` — expect all tests PASS; one case named `validates canned Haiku response against v1 schema`.
- VERIFY-2: `cd dis && npx vitest run tests/adapters/structuring/claude-haiku.live.test.ts` — expect PASS with real Anthropic call on one fixture.
- VERIFY-3: `cd dis && npx vitest run -t "retries once on schema drift"` — expect PASS; verify log line `structuring.retry.schema_drift` appears in captured logs.
- VERIFY-4: `grep -n "ajv\\|validate" dis/src/adapters/structuring/claude-haiku.ts` — expect schema validator invoked on every response.
- VERIFY-5: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-052 — ClaudeVisionAdapter (fallback)

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-003
- **TDD ref:** §9.2
- **Files allowed:**
  - dis/src/adapters/ocr/claude-vision.ts
  - dis/tests/adapters/ocr/claude-vision.contract.test.ts
  - dis/tests/fixtures/vision/\*.{pdf,json}
- **Out of scope:** switching logic (lives in wiring), cost tracking beyond the `OcrResult.costMicroINR` field.

**Description:** Implements `OcrPort` by calling Anthropic's Vision API — mirrors the current `process-document` behaviour. Activated when `DIS_OCR_PROVIDER=claude`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/ocr/claude-vision.contract.test.ts` — expect PASS; output shape matches `OcrResult` from `dis/src/ports/ocr.ts`.
- VERIFY-2: `cd dis && npx vitest run -t "matches OcrPort contract"` — expect PASS.
- VERIFY-3: `grep -n "implements OcrPort\\|: OcrPort" dis/src/adapters/ocr/claude-vision.ts` — expect the contract binding.
- VERIFY-4: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-053 — SupabaseStorageAdapter

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-003
- **TDD ref:** §9.3 (StoragePort)
- **Files allowed:**
  - dis/src/adapters/storage/supabase-storage.ts
  - dis/tests/adapters/storage/supabase-storage.contract.test.ts
- **Out of scope:** AWS S3 adapter, lifecycle rules, cleanup jobs.

**Description:** Implements `StoragePort` with `putObject`, `getObject`, `getSignedUploadUrl`, `getSignedDownloadUrl`, `deleteObject` against the `documents` bucket.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/storage/supabase-storage.contract.test.ts` — expect PASS.
- VERIFY-2: `grep -nE "putObject|getSignedUploadUrl|getSignedDownloadUrl|deleteObject|getObject" dis/src/adapters/storage/supabase-storage.ts` — expect 5 method definitions.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-054 — SupabasePostgresAdapter

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-003
- **TDD ref:** §9.4 (DatabasePort)
- **Files allowed:**
  - dis/src/adapters/database/supabase-postgres.ts
  - dis/tests/adapters/database/supabase-postgres.contract.test.ts
- **Out of scope:** Supabase SDK leaking into `dis/src/core/**`; ORMs.

**Description:** Implements `DatabasePort` via the `postgres` client. Provides `query`, `transaction`, and optimistic-lock helpers. Supabase SDK never imported from core.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/database/supabase-postgres.contract.test.ts` — expect PASS.
- VERIFY-2: `cd dis && node scripts/port-validator.mjs` — expect exit 0 (no forbidden adapter imports in core/ports).
- VERIFY-3: `grep -rn "@supabase/supabase-js" dis/src/core dis/src/ports` — expect zero matches.
- VERIFY-4: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-055 — SupabaseSecretsAdapter

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-003
- **TDD ref:** §16
- **Files allowed:**
  - dis/src/adapters/secrets/supabase-secrets.ts
  - dis/tests/adapters/secrets/supabase-secrets.contract.test.ts
- **Out of scope:** AWS Secrets Manager adapter (Epic H).

**Description:** Implements `SecretsPort` with an in-memory 5-minute cache per TDD §16. Cache miss fetches from Supabase Vault.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/secrets/supabase-secrets.contract.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "cache hit within 5 minutes"` — expect PASS.
- VERIFY-3: `cd dis && npx vitest run -t "cache expires after 5 minutes"` — expect PASS with fake timer advancing past TTL.
- VERIFY-4: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-056 — PgCronAdapter

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-054
- **TDD ref:** §9.5 (QueuePort)
- **Files allowed:**
  - dis/src/adapters/queue/pg-cron.ts
  - dis/tests/adapters/queue/pg-cron.contract.test.ts
- **Out of scope:** AWS SQS adapter, dead-letter handling (separate ticket).

**Description:** Implements `QueuePort.enqueue` as INSERT on `dis_jobs`; worker polling handled by a pg_cron-scheduled SELECT FOR UPDATE SKIP LOCKED.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/queue/pg-cron.contract.test.ts` — expect PASS.
- VERIFY-2: `grep -n "INSERT INTO dis_jobs" dis/src/adapters/queue/pg-cron.ts` — expect one match.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-057 — DefaultFileRouter

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-003
- **TDD ref:** §7 (routing decision tree)
- **Files allowed:**
  - dis/src/adapters/file-router/default.ts
  - dis/tests/adapters/file-router/default.test.ts
- **Out of scope:** container normalization (DIS-058a), preprocessing logic.

**Description:** Implements `FileRouterPort` — decides native-PDF / scan-PDF / image / office per TDD §7 based on MIME + pdf text extraction probe.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/file-router/default.test.ts` — expect PASS with cases for each branch of §7 tree.
- VERIFY-2: `cd dis && npx vitest run -t "native PDF with text layer"` — expect PASS.
- VERIFY-3: `cd dis && npx vitest run -t "scanned PDF with no text"` — expect PASS.
- VERIFY-4: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-058 — DefaultPreprocessor (aggregate)

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-057
- **TDD ref:** §8
- **Files allowed:**
  - dis/src/adapters/preprocessor/default.ts
  - dis/src/adapters/preprocessor/pipeline.ts
  - dis/tests/adapters/preprocessor/default.test.ts
- **Out of scope:** sub-step tickets DIS-058a..g own their individual stages; this ticket composes them.

**Description:** Composes all sub-stages (DIS-058a..g) into the `PreprocessorPort` pipeline.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/preprocessor/default.test.ts` — expect PASS, one end-to-end case.
- VERIFY-2: `grep -nE "normalizeContainer|deskew|perspectiveCorrect|detectBlank|detectDuplicate|resizeClahe|pageCountCap" dis/src/adapters/preprocessor/default.ts` — expect all 7 names referenced.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-058a — Preprocessor: container normalization (HEIC/WebP → JPEG)

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-057
- **TDD ref:** §8.1
- **Files allowed:**
  - dis/src/adapters/preprocessor/stages/normalize-container.ts
  - dis/tests/adapters/preprocessor/stages/normalize-container.test.ts
  - dis/tests/fixtures/images/\*.{heic,webp}

**Description:** Converts HEIC/WebP inputs to JPEG while preserving EXIF orientation.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/preprocessor/stages/normalize-container.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "HEIC to JPEG"` — expect PASS with output MIME `image/jpeg`.
- VERIFY-3: `cd dis && npx vitest run -t "WebP to JPEG"` — expect PASS.
- VERIFY-4: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-058b — Preprocessor: deskew

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-058a
- **TDD ref:** §8.2
- **Files allowed:**
  - dis/src/adapters/preprocessor/stages/deskew.ts
  - dis/tests/adapters/preprocessor/stages/deskew.test.ts

**Description:** Detects skew angle via Hough transform and rotates the image accordingly; caps rotation at ±15°.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/preprocessor/stages/deskew.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "rotates 7 degree skew"` — expect PASS with residual skew < 1°.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-058c — Preprocessor: perspective correction

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-058b
- **TDD ref:** §8.3
- **Files allowed:**
  - dis/src/adapters/preprocessor/stages/perspective.ts
  - dis/tests/adapters/preprocessor/stages/perspective.test.ts

**Description:** Detects quadrilateral document boundary and applies perspective warp.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/preprocessor/stages/perspective.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "no quad detected leaves image unchanged"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-058d — Preprocessor: blank-page detection

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-058c
- **TDD ref:** §8.4
- **Files allowed:**
  - dis/src/adapters/preprocessor/stages/blank-page.ts
  - dis/tests/adapters/preprocessor/stages/blank-page.test.ts

**Description:** Marks pages with < 1% non-background pixel ratio as blank and drops them from the pipeline.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/preprocessor/stages/blank-page.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "keeps page with visible text"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-058e — Preprocessor: duplicate-page detection

- **Tags:** `adapter`, `clinical-safety` (CS-4 — duplicate warning)
- **Epic:** C
- **Depends on:** DIS-058d
- **TDD ref:** §8.5
- **CS ref:** CS-4
- **Files allowed:**
  - dis/src/adapters/preprocessor/stages/duplicate-page.ts
  - dis/tests/adapters/preprocessor/stages/duplicate-page.test.ts

**Description:** Computes per-page perceptual hash; flags pages with Hamming distance ≤ 5 as duplicates. Emits warning event for CS-4.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/preprocessor/stages/duplicate-page.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "emits duplicate warning event"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-058f — Preprocessor: resize + CLAHE + JPEG encode

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-058e
- **TDD ref:** §8.6
- **Files allowed:**
  - dis/src/adapters/preprocessor/stages/resize-clahe.ts
  - dis/tests/adapters/preprocessor/stages/resize-clahe.test.ts

**Description:** Resizes to a max edge of 2000px, applies CLAHE (Contrast-Limited Adaptive Histogram Equalization), re-encodes as JPEG q=92.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/preprocessor/stages/resize-clahe.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "caps longest edge at 2000px"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-058g — Preprocessor: page-count cap

- **Tags:** `adapter`, `clinical-safety` (CS-12 — predictable cost)
- **Epic:** C
- **Depends on:** DIS-058f
- **TDD ref:** §8.7
- **CS ref:** CS-12
- **Files allowed:**
  - dis/src/adapters/preprocessor/stages/page-cap.ts
  - dis/tests/adapters/preprocessor/stages/page-cap.test.ts

**Description:** Enforces `DIS_MAX_PAGES` (default 50). Over-cap uploads short-circuit with `PageCapExceededError`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/preprocessor/stages/page-cap.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "throws PageCapExceededError at 51 pages"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-058z — Author `DocumentTextExtractorPort` (unblocks DIS-059/060/061)

- **Tags:** `core`, `port`, `infra`
- **Epic:** C
- **Depends on:** ADR-008 (2026-04-22)
- **Blocks:** DIS-059, DIS-060, DIS-061, DIS-059o
- **TDD ref:** §7
- **Files allowed:**
  - dis/src/ports/document-text-extractor.ts
  - dis/src/ports/index.ts  (re-export the new port)
  - dis/tests/helpers/fake-adapters.ts  (add FakeDocumentTextExtractorAdapter)
  - dis/tests/helpers/index.ts
  - dis/tests/unit/fake-adapters.test.ts  (one test asserts the fake honors the port)
  - dis/handoffs/DIS-058z.md

**Description:**
Author the new `DocumentTextExtractorPort` declared in ADR-008 — the file-router's dispatch target. Interface shape + `ExtractionResult` type per ADR-008 §Decision rule 4 (verbatim).

Unblocks the rewritten DIS-059 (NativePdfText), DIS-060 (OfficeWord), DIS-061 (OfficeSheet), and the new DIS-059o (OcrBridgeAdapter).

No existing adapter touched. No existing port touched. Purely additive.

**VERIFY:**

```
VERIFY-1: test -f dis/src/ports/document-text-extractor.ts && echo EXISTS  # expect EXISTS
VERIFY-2: grep -c "DocumentTextExtractorPort\|ExtractionResult\|ExtractionRoute" dis/src/ports/document-text-extractor.ts  # expect >= 3
VERIFY-3: grep -c "FakeDocumentTextExtractorAdapter" dis/tests/helpers/fake-adapters.ts  # expect >= 1
VERIFY-4: cd dis && npx tsc --noEmit  # expect exit 0
VERIFY-5: cd dis && npx vitest run tests/unit/fake-adapters.test.ts  # expect pass, covers the new fake
VERIFY-6: node dis/scripts/fitness.mjs  # expect 0 violations
VERIFY-7: test -f dis/handoffs/DIS-058z.md && echo EXISTS  # expect EXISTS
```

**Out of scope:**
- The 4 adapter implementations — owned by DIS-059/060/061/059o (unblocked by this ticket).
- `adapters.md` inventory text amendment — Wave 3b follow-up ticket or same PR as DIS-059o.
- `tdd.md §7` text amendment — same.

**Status:** Ready

---

### DIS-059 — NativePdfTextAdapter (implements `DocumentTextExtractorPort`, not `OcrPort`) — rewritten per ADR-008

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-058z (port author), DIS-033 (pdfjs utility), DIS-057 (file router)
- **Blocks:** none
- **TDD ref:** §7 (file router routes NATIVE_TEXT → this), §9.2
- **Files allowed:**
  - dis/src/adapters/document-text-extractor/native-pdf-text.ts
  - dis/tests/adapters/document-text-extractor/native-pdf-text.test.ts
  - dis/handoffs/DIS-059.md

**Description:**
Implements `DocumentTextExtractorPort` with `route: 'native_text'`. Backed by `core/native-pdf.ts` (DIS-033 `extractNativeText`). `rawResponse` = the extracted pages structure. `providerDetails` is **undefined** (native-PDF has no provider).

**Note:** This is a rewrite of the original DIS-059 ticket. The prior assumption ("implements OcrPort") was identified as a category error by teammate `dev-c-office-parsers` during Wave-3a dispatch 2026-04-22. See ADR-008.

**VERIFY:**

```
VERIFY-1: test -f dis/src/adapters/document-text-extractor/native-pdf-text.ts && echo EXISTS
VERIFY-2: grep -c "DocumentTextExtractorPort\|route.*native_text" dis/src/adapters/document-text-extractor/native-pdf-text.ts  # expect >= 2
VERIFY-3: grep -c "OcrPort" dis/src/adapters/document-text-extractor/native-pdf-text.ts  # expect 0 (no OcrPort import)
VERIFY-4: cd dis && npx vitest run tests/adapters/document-text-extractor/native-pdf-text.test.ts  # expect pass
VERIFY-5: cd dis && npx tsc --noEmit  # expect exit 0
VERIFY-6: node dis/scripts/fitness.mjs  # expect 0 violations
VERIFY-7: test -f dis/handoffs/DIS-059.md && echo EXISTS
```

**Out of scope:**
- Scanned PDFs (route via OcrBridgeAdapter — DIS-059o).
- Performance tuning for very large PDFs — follow-up ticket.

**Status:** Ready (after DIS-058z lands)

---

### DIS-060 — OfficeWordAdapter (implements `DocumentTextExtractorPort`) — rewritten per ADR-008

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-058z (port author), DIS-057 (file router)
- **TDD ref:** §7 (OFFICE_WORD route), §9.2
- **Files allowed:**
  - dis/src/adapters/document-text-extractor/office-word.ts
  - dis/tests/adapters/document-text-extractor/office-word.test.ts
  - dis/tests/fixtures/office/*.docx
  - dis/handoffs/DIS-060.md

**Description:**
Implements `DocumentTextExtractorPort` with `route: 'office_word'`. Uses `mammoth` (installed via Wave-3a chore commit 86714b4). `rawResponse` = full mammoth response.

**Note:** Rewrite per ADR-008.

**VERIFY:**

```
VERIFY-1: test -f dis/src/adapters/document-text-extractor/office-word.ts && echo EXISTS
VERIFY-2: grep -c "route.*office_word\|mammoth" dis/src/adapters/document-text-extractor/office-word.ts  # expect >= 2
VERIFY-3: grep -c "OcrPort" dis/src/adapters/document-text-extractor/office-word.ts  # expect 0
VERIFY-4: cd dis && npx vitest run tests/adapters/document-text-extractor/office-word.test.ts  # expect pass
VERIFY-5: cd dis && npx tsc --noEmit  # expect exit 0
VERIFY-6: node dis/scripts/fitness.mjs  # expect 0 violations
VERIFY-7: test -f dis/handoffs/DIS-060.md && echo EXISTS
```

**Status:** Ready (after DIS-058z lands)

---

### DIS-061 — OfficeSheetAdapter (implements `DocumentTextExtractorPort`) — rewritten per ADR-008

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-058z (port author), DIS-057 (file router)
- **TDD ref:** §7 (OFFICE_SHEET route), §9.2
- **Files allowed:**
  - dis/src/adapters/document-text-extractor/office-sheet.ts
  - dis/tests/adapters/document-text-extractor/office-sheet.test.ts
  - dis/tests/fixtures/office/*.xlsx
  - dis/tests/fixtures/office/*.csv
  - dis/handoffs/DIS-061.md

**Description:**
Implements `DocumentTextExtractorPort` with `route: 'office_sheet'`. Uses `xlsx` (installed via Wave-3a chore commit 86714b4). One markdown table per worksheet. `rawResponse` = workbook JSON. CSV handled as a single-sheet workbook.

**Note:** Rewrite per ADR-008.

**VERIFY:**

```
VERIFY-1: test -f dis/src/adapters/document-text-extractor/office-sheet.ts && echo EXISTS
VERIFY-2: grep -c "route.*office_sheet\|xlsx" dis/src/adapters/document-text-extractor/office-sheet.ts  # expect >= 2
VERIFY-3: grep -c "OcrPort" dis/src/adapters/document-text-extractor/office-sheet.ts  # expect 0
VERIFY-4: cd dis && npx vitest run tests/adapters/document-text-extractor/office-sheet.test.ts  # expect pass
VERIFY-5: cd dis && npx tsc --noEmit  # expect exit 0
VERIFY-6: node dis/scripts/fitness.mjs  # expect 0 violations
VERIFY-7: test -f dis/handoffs/DIS-061.md && echo EXISTS
```

**Status:** Ready (after DIS-058z lands)

---

### DIS-059o — OcrBridgeAdapter (delegates DocumentTextExtractorPort → OcrPort)

- **Tags:** `adapter`, `bridge`
- **Epic:** C
- **Depends on:** DIS-058z (port author), existing `OcrPort` and any OCR adapter
- **TDD ref:** §7 (OCR_IMAGE route), §9.2
- **Files allowed:**
  - dis/src/adapters/document-text-extractor/ocr-bridge.ts
  - dis/tests/adapters/document-text-extractor/ocr-bridge.test.ts
  - dis/handoffs/DIS-059o.md

**Description:**
The sole adapter that bridges the new port to the legacy `OcrPort`. Constructor takes an `OcrPort` instance; its `routeAndExtract` delegates to `ocr.extract(...)` and maps `OcrResult → ExtractionResult` with `route: 'ocr_image'` and `providerDetails` populated from `OcrResult.provider`, `.providerVersion`, `.tokensUsed`. Preserves `rawResponse` byte-identically (CS-2).

**VERIFY:**

```
VERIFY-1: test -f dis/src/adapters/document-text-extractor/ocr-bridge.ts && echo EXISTS
VERIFY-2: grep -c "OcrPort\|route.*ocr_image" dis/src/adapters/document-text-extractor/ocr-bridge.ts  # expect >= 2
VERIFY-3: grep -c "providerDetails" dis/src/adapters/document-text-extractor/ocr-bridge.ts  # expect >= 1
VERIFY-4: cd dis && npx vitest run tests/adapters/document-text-extractor/ocr-bridge.test.ts  # expect pass (fake OcrPort injected)
VERIFY-5: cd dis && npx tsc --noEmit  # expect exit 0
VERIFY-6: node dis/scripts/fitness.mjs  # expect 0 violations
VERIFY-7: test -f dis/handoffs/DIS-059o.md && echo EXISTS
```

**Status:** Ready (after DIS-058z lands)

### DIS-062 — OnpremChandraAdapter.stub

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-003
- **TDD ref:** §9.2 (future on-prem path)
- **Files allowed:**
  - dis/src/adapters/ocr/onprem-chandra.stub.ts
  - dis/tests/adapters/ocr/onprem-chandra.stub.test.ts
- **Out of scope:** any real implementation; ticket merely reserves the interface.

**Description:** Compiling stub that throws `NotImplementedError`. Preserves the `OcrPort` contract for a future on-prem Chandra deployment.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/ocr/onprem-chandra.stub.test.ts` — expect PASS; asserts `NotImplementedError` on every method.
- VERIFY-2: `grep -n "throw new NotImplementedError" dis/src/adapters/ocr/onprem-chandra.stub.ts` — expect ≥ 1 match.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-063 — Fake OcrPort adapter

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-003
- **TDD ref:** §9.2
- **Files allowed:**
  - dis/src/adapters/ocr/fake.ts
  - dis/tests/adapters/ocr/fake.test.ts

**Description:** In-memory `OcrPort` fake for core unit tests; returns canned `OcrResult` from an injected map.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/ocr/fake.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-064 — Fake StructuringPort adapter

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-003
- **TDD ref:** §10
- **Files allowed:**
  - dis/src/adapters/structuring/fake.ts
  - dis/tests/adapters/structuring/fake.test.ts

**Description:** In-memory `StructuringPort` fake returning canned extractions.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/structuring/fake.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-065 — Fake StoragePort adapter

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-003
- **Files allowed:**
  - dis/src/adapters/storage/fake.ts
  - dis/tests/adapters/storage/fake.test.ts

**Description:** In-memory `StoragePort` fake backed by a `Map<string, Uint8Array>`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/storage/fake.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-066 — Fake DatabasePort adapter

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-003
- **Files allowed:**
  - dis/src/adapters/database/fake.ts
  - dis/tests/adapters/database/fake.test.ts

**Description:** In-memory `DatabasePort` fake with transaction + optimistic-lock simulation.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/database/fake.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "rolls back on error inside transaction"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-067 — Fake QueuePort adapter

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-003
- **Files allowed:**
  - dis/src/adapters/queue/fake.ts
  - dis/tests/adapters/queue/fake.test.ts

**Description:** In-memory FIFO `QueuePort` fake.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/queue/fake.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-068 — Fake SecretsPort adapter

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-003
- **Files allowed:**
  - dis/src/adapters/secrets/fake.ts
  - dis/tests/adapters/secrets/fake.test.ts

**Description:** In-memory `SecretsPort` fake driven by a plain object of key-value pairs.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/secrets/fake.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-069 — Fake FileRouterPort adapter

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-003
- **Files allowed:**
  - dis/src/adapters/file-router/fake.ts
  - dis/tests/adapters/file-router/fake.test.ts

**Description:** In-memory `FileRouterPort` fake driven by a per-MIME decision map.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/file-router/fake.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-070 — Fake PreprocessorPort adapter

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-003
- **Files allowed:**
  - dis/src/adapters/preprocessor/fake.ts
  - dis/tests/adapters/preprocessor/fake.test.ts

**Description:** Pass-through `PreprocessorPort` fake that records the stages it was asked to run.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/preprocessor/fake.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-071 — Shared OcrPort contract test suite

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-063
- **TDD ref:** §9.2
- **Files allowed:**
  - dis/tests/contracts/ocr-port.contract.ts
  - dis/tests/contracts/ocr-port.runner.test.ts

**Description:** A generic contract test suite each `OcrPort` implementation re-runs via a factory parameter.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/contracts/ocr-port.runner.test.ts` — expect PASS across all registered implementations.
- VERIFY-2: `grep -n "runOcrPortContract" dis/tests/contracts/ocr-port.runner.test.ts` — expect at least 3 invocations (Datalab, Claude Vision, Fake).
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-072 — Shared StructuringPort contract test suite

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-064
- **TDD ref:** §10
- **Files allowed:**
  - dis/tests/contracts/structuring-port.contract.ts
  - dis/tests/contracts/structuring-port.runner.test.ts

**Description:** Generic contract suite for every `StructuringPort` implementation.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/contracts/structuring-port.runner.test.ts` — expect PASS for each implementation.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-073 — Shared StoragePort contract test suite

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-065
- **Files allowed:**
  - dis/tests/contracts/storage-port.contract.ts
  - dis/tests/contracts/storage-port.runner.test.ts

**Description:** Generic contract suite for every `StoragePort` implementation.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/contracts/storage-port.runner.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-074 — Shared DatabasePort contract test suite

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-066
- **Files allowed:**
  - dis/tests/contracts/database-port.contract.ts
  - dis/tests/contracts/database-port.runner.test.ts

**Description:** Generic contract suite — covers query + transaction + optimistic lock semantics.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/contracts/database-port.runner.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-075 — Shared QueuePort contract test suite

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-067
- **Files allowed:**
  - dis/tests/contracts/queue-port.contract.ts
  - dis/tests/contracts/queue-port.runner.test.ts

**Description:** Generic contract suite for `QueuePort`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/contracts/queue-port.runner.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-076 — Shared SecretsPort contract test suite

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-068
- **Files allowed:**
  - dis/tests/contracts/secrets-port.contract.ts
  - dis/tests/contracts/secrets-port.runner.test.ts

**Description:** Generic contract suite for `SecretsPort`, including cache TTL behaviour.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/contracts/secrets-port.runner.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-077 — Shared FileRouterPort contract test suite

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-069
- **Files allowed:**
  - dis/tests/contracts/file-router-port.contract.ts
  - dis/tests/contracts/file-router-port.runner.test.ts

**Description:** Generic contract suite for `FileRouterPort`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/contracts/file-router-port.runner.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-078 — Shared PreprocessorPort contract test suite

- **Tags:** `adapter`, `test`
- **Epic:** C
- **Depends on:** DIS-070
- **Files allowed:**
  - dis/tests/contracts/preprocessor-port.contract.ts
  - dis/tests/contracts/preprocessor-port.runner.test.ts

**Description:** Generic contract suite for `PreprocessorPort`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/contracts/preprocessor-port.runner.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-079 — Adapter wiring composition root (POC)

- **Tags:** `adapter`, `core`
- **Epic:** C
- **Depends on:** DIS-050..DIS-078
- **TDD ref:** §9, §17
- **Files allowed:**
  - dis/src/wiring/poc.ts
  - dis/tests/wiring/poc.test.ts

**Description:** Assembles all POC adapters into an `AppContainer` for `dis/src/http/server.ts`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/wiring/poc.test.ts` — expect PASS; AppContainer builds without throwing.
- VERIFY-2: `cd dis && node scripts/port-validator.mjs` — expect exit 0.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-080 — Adapter cost instrumentation

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-050, DIS-051
- **TDD ref:** §14
- **Files allowed:**
  - dis/src/adapters/common/cost-meter.ts
  - dis/tests/adapters/common/cost-meter.test.ts

**Description:** Shared helper that records `costMicroINR` per OCR / structuring call and flushes to the cost ledger.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/common/cost-meter.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "converts USD tokens to micro-INR"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-081 — Adapter retry / backoff helper

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-003
- **TDD ref:** §9.2
- **Files allowed:**
  - dis/src/adapters/common/retry.ts
  - dis/tests/adapters/common/retry.test.ts

**Description:** Generic exponential backoff with full jitter; consumed by Datalab, Haiku, Vision, PgCron.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/common/retry.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "caps backoff at ceiling"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-082 — Adapter structured error mapping

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-029 (error envelope)
- **TDD ref:** §15
- **Files allowed:**
  - dis/src/adapters/common/errors.ts
  - dis/tests/adapters/common/errors.test.ts

**Description:** Maps provider-specific errors (HTTP status, body shape) to the DIS error taxonomy.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/common/errors.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "maps Datalab 429 to RateLimitedError"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-083 — Adapter config schema + env validation

- **Tags:** `adapter`, `infra`
- **Epic:** C
- **Depends on:** DIS-010
- **TDD ref:** §17
- **Files allowed:**
  - dis/src/adapters/common/config.ts
  - dis/tests/adapters/common/config.test.ts

**Description:** Zod schema for every adapter-specific env var (DATALAB_API_KEY, ANTHROPIC_API_KEY, DIS_OCR_PROVIDER, etc.). Fails fast on boot.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/common/config.test.ts` — expect PASS.
- VERIFY-2: `cd dis && node -e "require('./dist/adapters/common/config.js').load({})"` — expect process exits non-zero with listed missing keys.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-084 — Adapter logging middleware

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-008 (pino)
- **TDD ref:** §14
- **Files allowed:**
  - dis/src/adapters/common/logging.ts
  - dis/tests/adapters/common/logging.test.ts

**Description:** Wraps every outbound adapter call in a pino child logger carrying `correlation_id`, `adapter`, `method`, `duration_ms`, `outcome`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/common/logging.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "emits adapter.call.done log line"` — expect PASS with captured log containing `correlation_id`.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-085 — Adapter README index

- **Tags:** `adapter`, `doc-only`
- **Epic:** C
- **Depends on:** DIS-050..DIS-084
- **Files allowed:**
  - dis/src/adapters/README.md

**Description:** One-page index listing every adapter, its port, its fake peer, and its contract suite file.

**VERIFY:**

- VERIFY-1: `ls dis/src/adapters/README.md` — expect the file exists.
- VERIFY-2: `grep -cE "^\\| DIS-0[5-8][0-9]" dis/src/adapters/README.md` — expect ≥ 30 rows.
- VERIFY-3: `grep -c "ocr-port.contract" dis/src/adapters/README.md` — expect ≥ 1.

**Status:** Ready

---

## Epic D — Orchestration layer

### DIS-090 — POST /ingest

- **Tags:** `core`, `test`
- **Epic:** D
- **Depends on:** DIS-021, DIS-053, DIS-055
- **TDD ref:** §3, §5
- **Files allowed:**
  - dis/src/http/routes/ingest.ts
  - dis/tests/http/ingest.test.ts
- **Out of scope:** signed-url issuance (DIS-096), process worker logic.

**Description:** Route handler that accepts the upload, stores the extraction row in `uploaded` state, enqueues a process job, returns `{extraction_id}`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/ingest.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "returns 201 with extraction_id + correlation_id"` — expect PASS.
- VERIFY-3: `cd dis && npx vitest run -t "same Idempotency-Key returns same extraction_id"` — expect PASS.
- VERIFY-4: `cd dis && npx vitest run -t "rejects unsupported content-type with 415"` — expect PASS.
- VERIFY-5: `cd dis && npx vitest run -t "rejects file over DIS_MAX_UPLOAD_MB with 413"` — expect PASS.
- VERIFY-6: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-091 — GET /extractions/:id

- **Tags:** `core`
- **Epic:** D
- **Depends on:** DIS-054
- **TDD ref:** §3
- **Files allowed:**
  - dis/src/http/routes/extractions-get.ts
  - dis/tests/http/extractions-get.test.ts
- **Out of scope:** list endpoint (DIS-095), realtime push (DIS-098).

**Description:** Returns the full extraction row for the verification UI. RLS-enforced.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/extractions-get.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "returns raw_ocr_markdown, raw_ocr_blocks, structured, verified_structured, confidence_summary, version"` — expect PASS.
- VERIFY-3: `cd dis && npx vitest run -t "RLS denies cross-patient reads"` — expect PASS.
- VERIFY-4: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-092 — POST /extractions/:id/approve

- **Tags:** `core`, `clinical-safety` (CS-1, CS-10)
- **Epic:** D
- **Depends on:** DIS-021, DIS-023, DIS-054
- **TDD ref:** §4, §13
- **CS ref:** CS-1 (no bypass of verification), CS-10 (dedupe on promotion)
- **Files allowed:**
  - dis/src/http/routes/extractions-approve.ts
  - dis/tests/http/extractions-approve.test.ts

**Description:** Approves a verified extraction under optimistic lock, triggers promotion, returns the promotion summary.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/extractions-approve.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "version mismatch returns 409 VersionConflictError"` — expect PASS.
- VERIFY-3: `cd dis && npx vitest run -t "returns promotion summary with inserted + skipped counts"` — expect PASS.
- VERIFY-4: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-093 — POST /extractions/:id/reject

- **Tags:** `core`
- **Epic:** D
- **Depends on:** DIS-021, DIS-054
- **TDD ref:** §4
- **Files allowed:**
  - dis/src/http/routes/extractions-reject.ts
  - dis/tests/http/extractions-reject.test.ts

**Description:** Transitions to `rejected`, records reason string.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/extractions-reject.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "requires non-empty reason"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-094 — POST /extractions/:id/retry

- **Tags:** `core`
- **Epic:** D
- **Depends on:** DIS-021, DIS-054
- **TDD ref:** §4
- **Files allowed:**
  - dis/src/http/routes/extractions-retry.ts
  - dis/tests/http/extractions-retry.test.ts

**Description:** Creates a new extraction from the same upload; the old extraction is preserved for audit.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/extractions-retry.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "old extraction remains readable after retry"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-095 — GET /extractions (queue listing)

- **Tags:** `core`
- **Epic:** D
- **Depends on:** DIS-054
- **TDD ref:** §3
- **Files allowed:**
  - dis/src/http/routes/extractions-list.ts
  - dis/tests/http/extractions-list.test.ts

**Description:** Cursor-paginated queue listing filtered by `status`, `patient_id`, `operator_id`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/extractions-list.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "returns next_cursor when more rows exist"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-096 — POST /uploads/signed-url

- **Tags:** `core`
- **Epic:** D
- **Depends on:** DIS-053
- **TDD ref:** §3, §9.3
- **Files allowed:**
  - dis/src/http/routes/uploads-signed-url.ts
  - dis/tests/http/uploads-signed-url.test.ts

**Description:** Returns a signed upload URL + target path for direct-to-storage uploads.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/uploads-signed-url.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "URL expires at configured TTL"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-097 — POST /internal/process-job (worker dispatch)

- **Tags:** `core`
- **Epic:** D
- **Depends on:** DIS-021, DIS-056
- **TDD ref:** §5, §6
- **Files allowed:**
  - dis/src/http/routes/process-job.ts
  - dis/tests/http/process-job.test.ts

**Description:** Internal endpoint invoked by the pg_cron worker; runs `IngestionOrchestrator.process()` for one job.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/process-job.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "refuses external callers without worker token"` — expect PASS (403).
- VERIFY-3: `cd dis && npx vitest run -t "marks job complete on success"` — expect PASS.
- VERIFY-4: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-098 — Realtime status push

- **Tags:** `core`
- **Epic:** D
- **Depends on:** DIS-054
- **TDD ref:** §3
- **Files allowed:**
  - dis/src/http/realtime/status-channel.ts
  - dis/tests/http/realtime-status.test.ts

**Description:** Publishes `extraction.status.changed` events to a Supabase Realtime channel for the verification UI.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/realtime-status.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "emits event on state transition"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-099 — GET /admin/metrics

- **Tags:** `core`, `infra`
- **Epic:** D
- **Depends on:** DIS-009
- **TDD ref:** §14
- **Files allowed:**
  - dis/src/http/routes/admin-metrics.ts
  - dis/tests/http/admin-metrics.test.ts

**Description:** Exposes in-process counters + gauges (queue depth, pass rate, p50/p95 latency).

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/admin-metrics.test.ts` — expect PASS.
- VERIFY-2: `curl -s http://localhost:3000/admin/metrics | jq '.queue_depth'` — expect a numeric value (run against local dev server).
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-100 — Kill-switch middleware

- **Tags:** `core`, `clinical-safety` (CS-9 — emergency stop)
- **Epic:** D
- **Depends on:** DIS-054
- **TDD ref:** §6
- **CS ref:** CS-9
- **Files allowed:**
  - dis/src/http/middleware/kill-switch.ts
  - dis/tests/http/kill-switch.test.ts

**Description:** When `dis_kill_switch.enabled=true` in the config table, every write endpoint returns 503 with a `Retry-After` header pointing at the legacy flow.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/kill-switch.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "returns 503 on writes when enabled"` — expect PASS.
- VERIFY-3: `cd dis && npx vitest run -t "GETs still succeed when enabled"` — expect PASS.
- VERIFY-4: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-101 — Global error handler middleware

- **Tags:** `core`
- **Epic:** D
- **Depends on:** DIS-029
- **TDD ref:** §15
- **Files allowed:**
  - dis/src/http/middleware/error-handler.ts
  - dis/tests/http/error-handler.test.ts

**Description:** Catches every thrown error, maps to the error envelope, logs with `correlation_id`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/error-handler.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "unhandled exception becomes 500 with envelope"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-102 — Per-operator rate limiter

- **Tags:** `core`
- **Epic:** D
- **Depends on:** DIS-054
- **TDD ref:** §6
- **Files allowed:**
  - dis/src/http/middleware/rate-limit.ts
  - dis/tests/http/rate-limit.test.ts

**Description:** Token-bucket per `operator_id` — 60 uploads / 10 minutes default; configurable.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/rate-limit.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "returns 429 after burst exhausted"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-103 — Integration test: ingest → process → verify → approve (end-to-end)

- **Tags:** `core`, `test`
- **Epic:** D
- **Depends on:** DIS-090..DIS-092
- **TDD ref:** §5, §6
- **Files allowed:**
  - dis/tests/e2e/happy-path.test.ts

**Description:** End-to-end test walking a fixture PDF through the full orchestration happy path, using fake adapters.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/e2e/happy-path.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "extraction reaches promoted state"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-104 — Integration test: retry recovery

- **Tags:** `core`, `test`
- **Epic:** D
- **Depends on:** DIS-094, DIS-097
- **Files allowed:**
  - dis/tests/e2e/retry.test.ts

**Description:** E2E — OCR fails, operator retries, second attempt succeeds.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/e2e/retry.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "original extraction preserved"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-105 — Integration test: reject path

- **Tags:** `core`, `test`
- **Epic:** D
- **Depends on:** DIS-093
- **Files allowed:**
  - dis/tests/e2e/reject.test.ts

**Description:** E2E — operator rejects an extraction; no promotion occurs.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/e2e/reject.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "no row inserted into lab_results"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-106 — Integration test: idempotency replay

- **Tags:** `core`, `test`
- **Epic:** D
- **Depends on:** DIS-090, DIS-025
- **Files allowed:**
  - dis/tests/e2e/idempotency.test.ts

**Description:** E2E — same Idempotency-Key replayed 5 times yields exactly 1 extraction row.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/e2e/idempotency.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "replay yields a single extraction_id"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-107 — Integration test: version conflict on approve

- **Tags:** `core`, `test`
- **Epic:** D
- **Depends on:** DIS-092
- **Files allowed:**
  - dis/tests/e2e/version-conflict.test.ts

**Description:** E2E — two operators approve concurrently; loser gets 409.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/e2e/version-conflict.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "second approve returns 409"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-108 — Integration test: kill-switch flip

- **Tags:** `core`, `test`, `clinical-safety` (CS-9)
- **Epic:** D
- **Depends on:** DIS-100
- **CS ref:** CS-9
- **Files allowed:**
  - dis/tests/e2e/kill-switch.test.ts

**Description:** E2E — flip kill switch mid-flight, verify writes stop within one request.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/e2e/kill-switch.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "subsequent POST returns 503"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-109 — Integration test: realtime channel roundtrip

- **Tags:** `core`, `test`
- **Epic:** D
- **Depends on:** DIS-098
- **Files allowed:**
  - dis/tests/e2e/realtime.test.ts

**Description:** E2E — subscribe to realtime channel, trigger state change, assert event received within 2s.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/e2e/realtime.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "event arrives within 2s"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-110 — Integration test: rate-limit + retry-after header

- **Tags:** `core`, `test`
- **Epic:** D
- **Depends on:** DIS-102
- **Files allowed:**
  - dis/tests/e2e/rate-limit.test.ts

**Description:** E2E — burst past the per-operator limit; verify `Retry-After` header.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/e2e/rate-limit.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "Retry-After header present on 429"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

---

## Epic E — Verification UI

### DIS-115 — UI scaffolding

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-004
- **TDD ref:** §11
- **Files allowed:**
  - dis/ui/package.json
  - dis/ui/vite.config.ts
  - dis/ui/tsconfig.json
  - dis/ui/index.html
  - dis/ui/src/App.tsx
  - dis/ui/src/layout/\*.tsx
  - dis/ui/tests/smoke.spec.ts

**Description:** Single-page app — Vite + React + TypeScript. Shell layout: topbar, queue sidebar, main content area. Decision between React vs. static HTML recorded as ADR-001.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npm run build` — expect exit 0 with `dist/` produced.
- VERIFY-2: `cd dis/ui && npx playwright test tests/smoke.spec.ts` — expect PASS.
- VERIFY-3: `cd dis/ui && npx lighthouse http://localhost:4173 --only-categories=performance --quiet --chrome-flags="--headless" --output=json --output-path=-lh.json && jq '.categories.performance.score' -lh.json` — expect value ≥ 0.85.
- VERIFY-4: `cd dis/ui && npx axe http://localhost:4173 --exit` — expect exit 0 (WCAG AA baseline).

**Status:** Ready

### DIS-116 — Queue page

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-115, DIS-095
- **Files allowed:**
  - dis/ui/src/pages/Queue.tsx
  - dis/ui/tests/queue.spec.ts

**Description:** Lists pending extractions; supports filter by status + operator. Pagination via cursor.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/queue.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx playwright test -g "loads next page on scroll"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-117 — Detail / verification page

- **Tags:** `ui`, `clinical-safety` (CS-1 — human verification)
- **Epic:** E
- **Depends on:** DIS-115, DIS-091
- **CS ref:** CS-1
- **Files allowed:**
  - dis/ui/src/pages/Verify.tsx
  - dis/ui/tests/verify.spec.ts

**Description:** Side-by-side PDF viewer + structured fields with confidence badges. Required before approve.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/verify.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx playwright test -g "approve button disabled until all fields viewed"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-118 — PDF.js viewer component

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-115
- **Files allowed:**
  - dis/ui/src/components/PdfViewer.tsx
  - dis/ui/tests/pdf-viewer.spec.ts

**Description:** Wraps `pdfjs-dist` with page navigation + zoom controls.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/pdf-viewer.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx playwright test -g "renders page 2 after next click"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-119 — Field edit form with confidence badges

- **Tags:** `ui`, `clinical-safety` (CS-3 — confidence surfacing)
- **Epic:** E
- **Depends on:** DIS-115
- **CS ref:** CS-3
- **Files allowed:**
  - dis/ui/src/components/FieldEditor.tsx
  - dis/ui/src/components/ConfidenceBadge.tsx
  - dis/ui/tests/field-editor.spec.ts

**Description:** Per-field editor showing AI value, edited value, confidence badge (high / medium / low).

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/field-editor.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx playwright test -g "renders low confidence badge in red"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-120 — Bounding-box overlay

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-118
- **Files allowed:**
  - dis/ui/src/components/BboxOverlay.tsx
  - dis/ui/tests/bbox-overlay.spec.ts

**Description:** Draws field-level bounding boxes over the PDF viewer when `bbox` data present; syncs highlight with focused field.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/bbox-overlay.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx playwright test -g "highlights bbox when field gains focus"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-121 — Approve / Reject flows with confirm

- **Tags:** `ui`, `clinical-safety` (CS-1)
- **Epic:** E
- **Depends on:** DIS-115, DIS-092, DIS-093
- **CS ref:** CS-1
- **Files allowed:**
  - dis/ui/src/flows/ApproveFlow.tsx
  - dis/ui/src/flows/RejectFlow.tsx
  - dis/ui/tests/approve-reject.spec.ts

**Description:** Confirm modal on approve; reason textarea on reject. Disables button after click.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/approve-reject.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx playwright test -g "reject requires reason"` — expect PASS.
- VERIFY-3: `cd dis/ui && npx playwright test -g "approve button disabled after click"` — expect PASS.
- VERIFY-4: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-122 — Duplicate warning banner

- **Tags:** `ui`, `clinical-safety` (CS-4)
- **Epic:** E
- **Depends on:** DIS-117, DIS-058e
- **CS ref:** CS-4
- **Files allowed:**
  - dis/ui/src/components/DuplicateBanner.tsx
  - dis/ui/tests/duplicate-banner.spec.ts

**Description:** Shows a banner when the uploaded document's hash matches an existing promoted document; blocks approve until operator overrides.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/duplicate-banner.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx playwright test -g "approve blocked until override"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-123 — Diff view (raw AI vs edited)

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-119
- **Files allowed:**
  - dis/ui/src/components/DiffView.tsx
  - dis/ui/tests/diff-view.spec.ts

**Description:** Per-field diff between raw AI output and operator edits, visible in the confirm modal.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/diff-view.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx playwright test -g "renders diff with added + removed markers"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-124 — Offline-first localStorage for in-progress edits

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-117
- **Files allowed:**
  - dis/ui/src/state/edit-store.ts
  - dis/ui/tests/edit-store.spec.ts

**Description:** Persists in-progress edits to localStorage keyed by `extraction_id` so operator can survive tab reloads.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx vitest run tests/edit-store.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx vitest run -t "restores edits after reload"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-125 — Status badge component

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-115
- **Files allowed:**
  - dis/ui/src/components/StatusBadge.tsx
  - dis/ui/tests/status-badge.spec.ts

**Description:** Colour-coded badge shared across Queue and Verify pages.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx vitest run tests/status-badge.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx vitest run -t "renders each state with unique colour"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-126 — Playwright e2e: happy path, reject, duplicate override

- **Tags:** `ui`, `test`
- **Epic:** E
- **Depends on:** DIS-121, DIS-122
- **Files allowed:**
  - dis/ui/tests/e2e/happy-path.spec.ts
  - dis/ui/tests/e2e/reject.spec.ts
  - dis/ui/tests/e2e/duplicate-override.spec.ts

**Description:** Three Playwright scenarios covering the primary user flows end-to-end.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/e2e/happy-path.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx playwright test tests/e2e/reject.spec.ts` — expect PASS.
- VERIFY-3: `cd dis/ui && npx playwright test tests/e2e/duplicate-override.spec.ts` — expect PASS.

**Status:** Ready

### DIS-127 — Accessibility audit

- **Tags:** `ui`, `test`
- **Epic:** E
- **Depends on:** DIS-115..DIS-125
- **Files allowed:**
  - dis/ui/tests/a11y.spec.ts

**Description:** Automated axe-core audit on every page; manual keyboard-only walkthrough checklist in the handoff.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/a11y.spec.ts` — expect PASS with zero serious violations.
- VERIFY-2: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-128 — Error boundary

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-115
- **Files allowed:**
  - dis/ui/src/components/ErrorBoundary.tsx
  - dis/ui/tests/error-boundary.spec.ts

**Description:** React error boundary that renders a friendly fallback and logs `correlation_id` to the backend.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx vitest run tests/error-boundary.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx vitest run -t "renders fallback on thrown error"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-129 — Optimistic-update conflict UI

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-121, DIS-107
- **Files allowed:**
  - dis/ui/src/components/ConflictDialog.tsx
  - dis/ui/tests/conflict-dialog.spec.ts

**Description:** Renders a dialog on 409 VersionConflict with a "reload & re-review" action.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/conflict-dialog.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx playwright test -g "shows dialog on 409"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-130 — Realtime subscription wiring

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-115, DIS-098
- **Files allowed:**
  - dis/ui/src/state/realtime.ts
  - dis/ui/tests/realtime.spec.ts

**Description:** Hooks the Verify page into the Supabase Realtime channel so queue updates and status changes appear without a reload.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx vitest run tests/realtime.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx vitest run -t "reconnects after transient drop"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-131 — i18n scaffolding (English + Hindi labels)

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-115
- **Files allowed:**
  - dis/ui/src/i18n/en.json
  - dis/ui/src/i18n/hi.json
  - dis/ui/src/i18n/index.ts
  - dis/ui/tests/i18n.spec.ts

**Description:** Loads locale strings; UI supports toggling between English and Hindi for reception-clerk facing copy.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx vitest run tests/i18n.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx vitest run -t "renders Hindi strings when locale is hi"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-132 — Session-timeout banner

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-115
- **Files allowed:**
  - dis/ui/src/components/SessionBanner.tsx
  - dis/ui/tests/session-banner.spec.ts

**Description:** Warns the operator 2 minutes before their auth token expires and offers a refresh action.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx vitest run tests/session-banner.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx vitest run -t "appears at T-minus-2m"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-133 — Keyboard shortcut layer

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-117
- **Files allowed:**
  - dis/ui/src/hooks/useShortcuts.ts
  - dis/ui/tests/shortcuts.spec.ts

**Description:** Enter = approve, Esc = cancel, N = next field, P = previous field. Shown in a help overlay.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/shortcuts.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx playwright test -g "N advances focus to next field"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-134 — Loading / skeleton states

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-116, DIS-117
- **Files allowed:**
  - dis/ui/src/components/Skeleton.tsx
  - dis/ui/tests/skeleton.spec.ts

**Description:** Skeleton placeholders on Queue and Verify while data is loading.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx vitest run tests/skeleton.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-135 — Verification throughput timer (observability)

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-117
- **Files allowed:**
  - dis/ui/src/state/telemetry.ts
  - dis/ui/tests/telemetry.spec.ts

**Description:** Measures time-to-verify per extraction and posts aggregates to `/admin/metrics`.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx vitest run tests/telemetry.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-136 — Operator sign-in flow

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-115
- **Files allowed:**
  - dis/ui/src/auth/SignIn.tsx
  - dis/ui/tests/sign-in.spec.ts

**Description:** Email + password sign-in against Supabase auth; token stored in memory only.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/sign-in.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx playwright test -g "rejects wrong credentials"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-137 — CSS / theme tokens

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-115
- **Files allowed:**
  - dis/ui/src/theme/tokens.css
  - dis/ui/tests/theme.spec.ts

**Description:** Design tokens for colours, spacing, type. Matches the rest of the HMIS palette (Royal Blue medicine accent).

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx vitest run tests/theme.spec.ts` — expect PASS.
- VERIFY-2: `grep -n "royal-blue\\|--dis-accent" dis/ui/src/theme/tokens.css` — expect at least one match.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-138 — Printable verification summary

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-117
- **Files allowed:**
  - dis/ui/src/pages/PrintSummary.tsx
  - dis/ui/tests/print-summary.spec.ts

**Description:** Print view that lists extracted fields + bounding boxes for offline audit.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx playwright test tests/print-summary.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npx playwright test -g "layout renders on A4"` — expect PASS.
- VERIFY-3: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-139 — Feature flag for verification UI

- **Tags:** `ui`
- **Epic:** E
- **Depends on:** DIS-115
- **Files allowed:**
  - dis/ui/src/flags.ts
  - dis/ui/tests/flags.spec.ts

**Description:** Simple feature-flag hook driven by `/admin/flags` so staging can toggle experimental UI without a deploy.

**VERIFY:**

- VERIFY-1: `cd dis/ui && npx vitest run tests/flags.spec.ts` — expect PASS.
- VERIFY-2: `cd dis/ui && npm run typecheck` — expect exit 0.

**Status:** Ready

### DIS-140 — UI build + deploy pipeline

- **Tags:** `ui`, `infra`
- **Epic:** E
- **Depends on:** DIS-115
- **Files allowed:**
  - .github/workflows/dis-ui-build.yml
  - dis/ui/scripts/deploy.mjs

**Description:** GitHub Actions job that builds `dis/ui` and uploads artefacts; deployment to staging remains gated by INTEGRATION APPROVED per §6b.

**VERIFY:**

- VERIFY-1: `cat .github/workflows/dis-ui-build.yml | grep "paths: \\[\\]"` — expect no wildcard path; paths constrained to `dis/ui/**`.
- VERIFY-2: `cd dis/ui && npm run build` — expect exit 0.
- VERIFY-3: `ls dis/ui/dist/index.html` — expect the built file exists.

**Status:** Ready

---

## Epic F — Observability, safety audits, staging migrations

### DIS-145 — Apply M-001..M-008 to staging Supabase

- **Tags:** `migration`, `infra`
- **Epic:** F
- **Depends on:** all Epic B tickets done
- **TDD ref:** §3, §13
- **Files allowed:**
  - dis/migrations/M-001\_\*.sql
  - dis/migrations/M-002\_\*.sql
  - dis/migrations/M-003\_\*.sql
  - dis/migrations/M-004\_\*.sql
  - dis/migrations/M-005\_\*.sql
  - dis/migrations/M-006\_\*.sql
  - dis/migrations/M-007\_\*.sql
  - dis/migrations/M-008\_\*.sql
  - dis/scripts/apply-staging.mjs
- **Out of scope:** any write to the Radhakishan live Supabase project; see integration_hold.md.

**Description:** Spins up a new Supabase **staging** project and applies M-001..M-008 via dbmate. Runs the clinical-acceptance fixture set.

**VERIFY:**

- VERIFY-1: `node dis/scripts/apply-staging.mjs --project-ref $DIS_STAGING_REF --dry-run` — expect exit 0; output lists each migration.
- VERIFY-2: `psql $DIS_STAGING_URL -c "\\dt public.*" | grep -E "ocr_extractions|ocr_audit_log|dis_confidence_policy|dis_jobs|dis_cost_ledger"` — expect all 5 tables listed.
- VERIFY-3: `node dis/scripts/apply-staging.mjs --roundtrip` — expect byte-identical schema dumps before and after up→down→up.
- VERIFY-4: `cd dis && npx vitest run tests/clinical-acceptance/*.test.ts -- --env=staging` — expect all PASS.
- VERIFY-5: `psql $SUPABASE_LIVE_URL -c "select 1 from pg_tables where tablename='ocr_extractions'"` — expect `0 rows` (live is untouched).

**Status:** Ready

### DIS-146 — Structured log output + pino config

- **Tags:** `infra`
- **Epic:** F
- **Depends on:** DIS-008
- **TDD ref:** §14
- **Files allowed:**
  - dis/src/observability/logger.ts
  - dis/tests/observability/logger.test.ts

**Description:** Pino config emitting JSON lines with `correlation_id`, `extraction_id`, `operator_id`, `stage`, and a redaction list for PII.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/observability/logger.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "redacts known PII fields"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-147 — OpenTelemetry tracing scaffold

- **Tags:** `infra`
- **Epic:** F
- **Depends on:** DIS-146
- **TDD ref:** §14
- **Files allowed:**
  - dis/src/observability/tracing.ts
  - dis/tests/observability/tracing.test.ts

**Description:** OTel SDK with a no-op exporter on POC, OTLP in staging. Spans wrap every HTTP handler and adapter call.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/observability/tracing.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "emits span per adapter call"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-148 — Metrics gauges + counters

- **Tags:** `infra`
- **Epic:** F
- **Depends on:** DIS-009
- **TDD ref:** §14
- **Files allowed:**
  - dis/src/observability/metrics.ts
  - dis/tests/observability/metrics.test.ts

**Description:** `queue_depth`, `extractions_approved_total`, `extractions_rejected_total`, `ocr_latency_ms_p95`, `cost_micro_inr_total`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/observability/metrics.test.ts` — expect PASS.
- VERIFY-2: `curl -s http://localhost:3000/admin/metrics | jq 'keys'` — expect each metric name listed.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-149 — Cost ledger writer

- **Tags:** `core`
- **Epic:** F
- **Depends on:** DIS-080, DIS-054
- **TDD ref:** §14
- **Files allowed:**
  - dis/src/core/cost-ledger.ts
  - dis/tests/core/cost-ledger.test.ts

**Description:** Inserts per-call rows into `dis_cost_ledger` with `provider`, `operation`, `tokens`, `pages`, `cost_micro_inr`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/core/cost-ledger.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "writes ledger row per adapter call"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-150 — Alert webhook (queue depth > 20)

- **Tags:** `infra`
- **Epic:** F
- **Depends on:** DIS-148
- **Files allowed:**
  - dis/src/observability/alerts.ts
  - dis/tests/observability/alerts.test.ts

**Description:** Background poll fires a webhook when `queue_depth > 20` for 5 minutes straight. Deduped by a cooldown window.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/observability/alerts.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "does not re-alert within cooldown"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-151 — Clinician weekly audit dry-run on fixtures

- **Tags:** `clinical-safety` (CS-6 — audit cadence), `test`
- **Epic:** F
- **Depends on:** DIS-145
- **TDD ref:** §13
- **CS ref:** CS-6
- **Files allowed:**
  - dis/tests/clinical-acceptance/weekly-audit.test.ts
  - dis/tests/fixtures/clinical-audit/\*\*

**Description:** Synthetic weekly batch of 20 extractions; clinician-style assertions verify the audit trail contains everything needed.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/clinical-acceptance/weekly-audit.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "every approval has operator_id + signed_at"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-152 — Red-team fixtures (adversarial docs)

- **Tags:** `clinical-safety` (CS-2, CS-7), `test`
- **Epic:** F
- **Depends on:** DIS-145
- **CS ref:** CS-2, CS-7
- **Files allowed:**
  - dis/tests/fixtures/red-team/\*\*
  - dis/tests/red-team/\*.test.ts

**Description:** Curated adversarial inputs: prompt-injection PDFs, mis-OCR edge cases, conflicting unit labs. Each must be caught by verification.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/red-team/*.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "prompt injection in PDF is ignored"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-153 — Runbook tabletop: OCR outage

- **Tags:** `runbook`, `doc-only`
- **Epic:** F
- **Depends on:** DIS-146
- **Files allowed:**
  - dis/document_ingestion_service/09_runbooks/ocr-outage.md

**Description:** Step-by-step runbook for responding to an OCR provider outage; rehearsed in a tabletop exercise.

**VERIFY:**

- VERIFY-1: `ls dis/document_ingestion_service/09_runbooks/ocr-outage.md` — expect file exists.
- VERIFY-2: `grep -c "^## Step" dis/document_ingestion_service/09_runbooks/ocr-outage.md` — expect ≥ 5 steps.

**Status:** Ready

### DIS-154 — Runbook tabletop: stuck job

- **Tags:** `runbook`, `doc-only`
- **Epic:** F
- **Depends on:** DIS-148
- **Files allowed:**
  - dis/document_ingestion_service/09_runbooks/stuck-job.md

**Description:** Diagnose + recover a job stuck in `processing` past the SLA.

**VERIFY:**

- VERIFY-1: `ls dis/document_ingestion_service/09_runbooks/stuck-job.md` — expect file exists.
- VERIFY-2: `grep -c "^## Step" dis/document_ingestion_service/09_runbooks/stuck-job.md` — expect ≥ 5.

**Status:** Ready

### DIS-155 — Runbook tabletop: cost spike

- **Tags:** `runbook`, `doc-only`
- **Epic:** F
- **Depends on:** DIS-149
- **Files allowed:**
  - dis/document_ingestion_service/09_runbooks/cost-spike.md

**Description:** How to investigate and cap runaway AI spend.

**VERIFY:**

- VERIFY-1: `ls dis/document_ingestion_service/09_runbooks/cost-spike.md` — expect file exists.
- VERIFY-2: `grep -c "^## Step" dis/document_ingestion_service/09_runbooks/cost-spike.md` — expect ≥ 5.

**Status:** Ready

### DIS-156 — Runbook tabletop: schema drift

- **Tags:** `runbook`, `doc-only`
- **Epic:** F
- **Depends on:** DIS-051
- **Files allowed:**
  - dis/document_ingestion_service/09_runbooks/schema-drift.md

**Description:** What to do when a Claude model update breaks the v1 schema.

**VERIFY:**

- VERIFY-1: `ls dis/document_ingestion_service/09_runbooks/schema-drift.md` — expect file exists.
- VERIFY-2: `grep -c "^## Step" dis/document_ingestion_service/09_runbooks/schema-drift.md` — expect ≥ 5.

**Status:** Ready

### DIS-157 — Runbook tabletop: duplicate upload storm

- **Tags:** `runbook`, `doc-only`, `clinical-safety` (CS-4)
- **Epic:** F
- **Depends on:** DIS-122
- **CS ref:** CS-4
- **Files allowed:**
  - dis/document_ingestion_service/09_runbooks/duplicate-storm.md

**Description:** How to triage when many operators upload the same file.

**VERIFY:**

- VERIFY-1: `ls dis/document_ingestion_service/09_runbooks/duplicate-storm.md` — expect file exists.
- VERIFY-2: `grep -c "^## Step" dis/document_ingestion_service/09_runbooks/duplicate-storm.md` — expect ≥ 5.

**Status:** Ready

### DIS-158 — Metric dashboard skeleton

- **Tags:** `infra`, `doc-only`
- **Epic:** F
- **Depends on:** DIS-148
- **Files allowed:**
  - dis/document_ingestion_service/10_handoff/dashboard.md

**Description:** Markdown description of the admin dashboard (exact Grafana JSON is out of scope for POC).

**VERIFY:**

- VERIFY-1: `ls dis/document_ingestion_service/10_handoff/dashboard.md` — expect file exists.
- VERIFY-2: `grep -c "^### " dis/document_ingestion_service/10_handoff/dashboard.md` — expect ≥ 6 panel entries.

**Status:** Ready

### DIS-159 — Operator-latency SLO + report

- **Tags:** `infra`
- **Epic:** F
- **Depends on:** DIS-148, DIS-135
- **Files allowed:**
  - dis/src/observability/slo.ts
  - dis/tests/observability/slo.test.ts

**Description:** Records p50/p95 operator verification latency and compares against SLO target.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/observability/slo.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "reports SLO breach when p95 > target"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-160 — Health check deep probe

- **Tags:** `infra`
- **Epic:** F
- **Depends on:** DIS-004
- **Files allowed:**
  - dis/src/http/routes/health-deep.ts
  - dis/tests/http/health-deep.test.ts

**Description:** `GET /health/deep` — exercises DB, storage, secrets, OCR (mocked in POC) and reports per-component status.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/http/health-deep.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "reports secrets degraded when cache miss"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-161 — PII redaction in log pipeline

- **Tags:** `clinical-safety` (CS-8 — PII protection)
- **Epic:** F
- **Depends on:** DIS-146
- **CS ref:** CS-8
- **Files allowed:**
  - dis/src/observability/pii-redactor.ts
  - dis/tests/observability/pii-redactor.test.ts

**Description:** Redacts patient name, DOB, UHID, phone from logs + traces before emission.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/observability/pii-redactor.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "masks UHID in nested objects"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-162 — Audit-log integrity check

- **Tags:** `clinical-safety` (CS-5 — append-only audit)
- **Epic:** F
- **Depends on:** DIS-024
- **CS ref:** CS-5
- **Files allowed:**
  - dis/src/observability/audit-integrity.ts
  - dis/tests/observability/audit-integrity.test.ts

**Description:** Nightly job hashes the audit log and stores a rolling merkle root; any mismatch raises an alert.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/observability/audit-integrity.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "detects an altered row"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-163 — Backup verification dry-run (staging)

- **Tags:** `infra`, `migration`
- **Epic:** F
- **Depends on:** DIS-145
- **Files allowed:**
  - dis/scripts/backup-verify.mjs

**Description:** Script that dumps staging, restores into a throwaway DB, and diff-checks the schema + row counts.

**VERIFY:**

- VERIFY-1: `node dis/scripts/backup-verify.mjs --env=staging` — expect exit 0 and `OK: schema identical, rowcounts match` line.
- VERIFY-2: `node dis/scripts/backup-verify.mjs --env=staging --inject-corruption` — expect exit 1 (guardrail works).

**Status:** Ready

### DIS-164 — Trace sampling policy

- **Tags:** `infra`
- **Epic:** F
- **Depends on:** DIS-147
- **Files allowed:**
  - dis/src/observability/sampling.ts
  - dis/tests/observability/sampling.test.ts

**Description:** 100% sampling on errors; 10% on success paths; 100% on clinical-safety-tagged flows.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/observability/sampling.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "always samples clinical-safety flows"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-165 — Cost budget guardrail

- **Tags:** `infra`, `clinical-safety` (CS-12)
- **Epic:** F
- **Depends on:** DIS-149
- **CS ref:** CS-12
- **Files allowed:**
  - dis/src/core/cost-guardrail.ts
  - dis/tests/core/cost-guardrail.test.ts

**Description:** Refuses to accept new uploads when daily cost ledger exceeds `DIS_DAILY_BUDGET_INR`.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/core/cost-guardrail.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "returns 503 when budget exceeded"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-166 — Chaos test: OCR provider returns garbage

- **Tags:** `test`, `clinical-safety` (CS-7)
- **Epic:** F
- **Depends on:** DIS-051
- **CS ref:** CS-7
- **Files allowed:**
  - dis/tests/chaos/ocr-garbage.test.ts

**Description:** Fixture where OCR returns non-medical text; structuring must fail closed.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/chaos/ocr-garbage.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "extraction ends in failed state"` — expect PASS.

**Status:** Ready

### DIS-167 — Chaos test: DB connection drop mid-txn

- **Tags:** `test`
- **Epic:** F
- **Depends on:** DIS-054
- **Files allowed:**
  - dis/tests/chaos/db-drop.test.ts

**Description:** Simulated connection drop in the middle of a promotion transaction; verify rollback.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/chaos/db-drop.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "no partial write persists"` — expect PASS.

**Status:** Ready

### DIS-168 — Load test harness

- **Tags:** `test`, `infra`
- **Epic:** F
- **Depends on:** DIS-145
- **Files allowed:**
  - dis/tests/load/k6-scenarios.js
  - dis/tests/load/README.md

**Description:** k6 scenarios modelling 1x, 5x, 10x expected throughput; run against staging only.

**VERIFY:**

- VERIFY-1: `k6 run dis/tests/load/k6-scenarios.js --env ENV=staging` — expect `http_req_failed rate < 0.01`.
- VERIFY-2: `ls dis/tests/load/k6-scenarios.js` — expect file exists.

**Status:** Ready

### DIS-169 — Security review checklist

- **Tags:** `doc-only`, `infra`
- **Epic:** F
- **Depends on:** DIS-145
- **Files allowed:**
  - dis/document_ingestion_service/10_handoff/security-review.md

**Description:** Checklist covering RLS, secrets, TLS, SSRF, XSS on verification UI.

**VERIFY:**

- VERIFY-1: `ls dis/document_ingestion_service/10_handoff/security-review.md` — expect file exists.
- VERIFY-2: `grep -c "^- \\[ \\]" dis/document_ingestion_service/10_handoff/security-review.md` — expect ≥ 15 checkbox items.

**Status:** Ready

### DIS-170 — Clinical-safety dry run report

- **Tags:** `clinical-safety`, `doc-only`
- **Epic:** F
- **Depends on:** DIS-151, DIS-152
- **Files allowed:**
  - dis/document_ingestion_service/10_handoff/clinical-safety-dry-run.md

**Description:** Written report assembling the audit, red-team, and chaos results for clinician sign-off.

**VERIFY:**

- VERIFY-1: `ls dis/document_ingestion_service/10_handoff/clinical-safety-dry-run.md` — expect file exists.
- VERIFY-2: `grep -c "^## CS-" dis/document_ingestion_service/10_handoff/clinical-safety-dry-run.md` — expect ≥ 12 (one per CS rule).

**Status:** Ready

### DIS-171 — Migration rehearsal script (staging)

- **Tags:** `migration`, `infra`
- **Epic:** F
- **Depends on:** DIS-145
- **Files allowed:**
  - dis/scripts/migration-rehearsal.mjs

**Description:** Single command that re-applies M-001..M-008 from a cold clone of staging — proves the path used for live is trustworthy.

**VERIFY:**

- VERIFY-1: `node dis/scripts/migration-rehearsal.mjs --env=staging --fresh` — expect exit 0.
- VERIFY-2: `node dis/scripts/migration-rehearsal.mjs --env=staging --dry-run` — expect list of migrations with no destructive statements.

**Status:** Ready

### DIS-172 — Cleanup job: expired idempotency keys

- **Tags:** `infra`
- **Epic:** F
- **Depends on:** DIS-025
- **Files allowed:**
  - dis/src/jobs/cleanup-idempotency.ts
  - dis/tests/jobs/cleanup-idempotency.test.ts

**Description:** Scheduled job that evicts idempotency rows older than 7 days.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/jobs/cleanup-idempotency.test.ts` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "keeps rows younger than 7 days"` — expect PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-173 — Fixture generator CLI

- **Tags:** `test`, `infra`
- **Epic:** F
- **Depends on:** DIS-012
- **Files allowed:**
  - dis/scripts/gen-fixtures.mjs

**Description:** Generates synthetic but plausible clinical fixtures (labs, discharge summaries) for contract + chaos tests.

**VERIFY:**

- VERIFY-1: `node dis/scripts/gen-fixtures.mjs --count=10 --out=/tmp/dis-fixtures` — expect exit 0 and 10 files created.
- VERIFY-2: `ls /tmp/dis-fixtures | wc -l` — expect `10`.

**Status:** Ready

### DIS-174 — Observability docs

- **Tags:** `doc-only`, `infra`
- **Epic:** F
- **Depends on:** DIS-146..DIS-150
- **Files allowed:**
  - dis/document_ingestion_service/09_runbooks/observability.md

**Description:** One page tying logs, traces, metrics, alerts together with links.

**VERIFY:**

- VERIFY-1: `ls dis/document_ingestion_service/09_runbooks/observability.md` — expect file exists.
- VERIFY-2: `grep -cE "## (Logs|Traces|Metrics|Alerts)" dis/document_ingestion_service/09_runbooks/observability.md` — expect ≥ 4.

**Status:** Ready

### DIS-175 — Epic F wrap-up checklist

- **Tags:** `doc-only`
- **Epic:** F
- **Depends on:** DIS-145..DIS-174
- **Files allowed:**
  - dis/document_ingestion_service/10_handoff/epic-f-signoff.md

**Description:** Final checklist marking each F ticket as done with its Verify report path.

**VERIFY:**

- VERIFY-1: `ls dis/document_ingestion_service/10_handoff/epic-f-signoff.md` — expect file exists.
- VERIFY-2: `grep -c "DIS-" dis/document_ingestion_service/10_handoff/epic-f-signoff.md` — expect ≥ 30 references.

**Status:** Ready

---

## Epic G — Integration (HELD in `integration_hold.md`)

> All Epic G tickets carry `integration` tag. Each is `HELD` pending
> Integration Gatekeeper's `INTEGRATION APPROVED` note per
> `review_gates.md` §6b. Verify commands here are **staging-only dry
> runs** until approval lifts the hold (see verify_format.md §9).

### DIS-200 — Apply M-001..M-008 to LIVE Supabase [HELD]

- **Tags:** `integration`, `migration`, `clinical-safety` (CS-5)
- **Epic:** G
- **Depends on:** DIS-145, DIS-171
- **TDD ref:** §3
- **CS ref:** CS-5
- **Files allowed:**
  - dis/scripts/apply-live.mjs
  - dis/migrations/M-001*\*.sql..M-008*\*.sql (read-only: copies from staging, no edits here)
- **Out of scope:** M-009 cutover (DIS-208).
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Applies M-001..M-008 to the Radhakishan **live** Supabase project. Additive-only migrations. Live writes remain backed by the existing `documents` table flow until later Epic G tickets cut over.

**VERIFY:**

- VERIFY-1: [STAGING ONLY] `node dis/scripts/apply-live.mjs --dry-run --project-ref $LIVE_REF` — expect exit 0 and printed plan; no rows mutated (dry-run mode).
- VERIFY-2: [STAGING ONLY] `node dis/scripts/migration-rehearsal.mjs --env=staging --fresh` — expect exit 0 (proves path used for live).
- VERIFY-3: [STAGING ONLY] `diff <(psql $DIS_STAGING_URL -c "\\dt public.*") <(psql $LIVE_READONLY_URL -c "\\dt public.*")` — expect extra tables are exactly the 5 new DIS tables and nothing else.
- VERIFY-4: [STAGING ONLY] `grep -n "DROP\\|TRUNCATE\\|DELETE" dis/migrations/M-00*_*.sql` — expect zero matches (additive-only invariant).

**Status:** HELD

### DIS-201 — Add FK columns to `lab_results` + `vaccinations` (M-006 live) [HELD]

- **Tags:** `integration`, `migration`, `clinical-safety` (CS-10, CS-11)
- **Epic:** G
- **Depends on:** DIS-200
- **TDD ref:** §13
- **CS ref:** CS-10, CS-11
- **Files allowed:**
  - dis/migrations/M-006\_\*.sql (no edits — applied against live)
  - dis/scripts/apply-m006-live.mjs
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Adds nullable `ocr_extraction_id` FK columns to `lab_results` and `vaccinations` on the live DB. Constraint stays nullable here; mandatory constraint arrives in DIS-208.

**VERIFY:**

- VERIFY-1: [STAGING ONLY] `node dis/scripts/apply-m006-live.mjs --dry-run` — expect the exact ALTER TABLE statements printed.
- VERIFY-2: [STAGING ONLY] `psql $DIS_STAGING_URL -c "\\d+ lab_results" | grep ocr_extraction_id` — expect nullable FK column.
- VERIFY-3: [STAGING ONLY] `psql $DIS_STAGING_URL -c "select count(*) from lab_results where ocr_extraction_id is not null"` — expect `0` immediately after migration.

**Status:** HELD

### DIS-202 — Wire `registration.html` upload to DIS `/ingest` [HELD]

- **Tags:** `integration`, `ui`, `clinical-safety` (CS-1)
- **Epic:** G
- **Depends on:** DIS-090, DIS-200
- **TDD ref:** §5
- **CS ref:** CS-1
- **Files allowed:**
  - web/registration.html
  - web/assets/dis-ingest-client.js (new helper)
- **Out of scope:** any change to `loadRecentLabs()` / `get_lab_history` (owned by DIS-204, DIS-205).
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Adds a client-side helper that POSTs uploaded documents to the DIS `/ingest` endpoint, under a feature flag. Default flag OFF; shadow-mode enabling is DIS-203.

**VERIFY:**

- VERIFY-1: [STAGING ONLY] `grep -n "dis-ingest-client.js" web/registration.html` — expect script tag present.
- VERIFY-2: [STAGING ONLY] `grep -n "DIS_INGEST_FLAG" web/registration.html web/assets/dis-ingest-client.js` — expect flag gating both call sites; default `false`.
- VERIFY-3: [STAGING ONLY] open staging URL in headless browser; upload a fixture with flag ON; `curl -s $DIS_STAGING_URL/extractions?operator=testclerk | jq '.[0].status'` — expect `uploaded`.

**Status:** HELD

### DIS-203 — Enable shadow mode in `process-document` Edge Function [HELD]

- **Tags:** `integration`, `clinical-safety` (CS-1, CS-9)
- **Epic:** G
- **Depends on:** DIS-202
- **TDD ref:** §6
- **CS ref:** CS-1, CS-9
- **Files allowed:**
  - supabase/functions/process-document/index.ts
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Teaches the existing `process-document` Edge Function to fan out the same upload to DIS `/ingest` in shadow mode — writes go to both paths, user-visible behaviour unchanged.

**VERIFY:**

- VERIFY-1: [STAGING ONLY] `grep -n "SHADOW_MODE" supabase/functions/process-document/index.ts` — expect flag gating shadow call.
- VERIFY-2: [STAGING ONLY] deploy to staging with flag ON; upload fixture; `psql $DIS_STAGING_URL -c "select count(*) from ocr_extractions where created_at > now()-interval '5 min'"` — expect ≥ 1.
- VERIFY-3: [STAGING ONLY] confirm existing `documents` row also present — expect both paths populated, no user-visible diff.

**Status:** HELD

### DIS-204 — Filter `loadRecentLabs()` by `verification_status` [HELD]

- **Tags:** `integration`, `ui`, `clinical-safety` (CS-1, CS-3)
- **Epic:** G
- **Depends on:** DIS-201
- **TDD ref:** §13
- **CS ref:** CS-1, CS-3
- **Files allowed:**
  - web/prescription-pad.html
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Updates `loadRecentLabs()` to exclude rows where the promoted lab's source extraction is not `verified`. Preserves existing legacy rows (no `ocr_extraction_id`) as visible.

**VERIFY:**

- VERIFY-1: [STAGING ONLY] `grep -n "verification_status" web/prescription-pad.html` — expect filter applied inside `loadRecentLabs`.
- VERIFY-2: [STAGING ONLY] seed staging with one verified + one unverified lab; open prescription-pad in staging; assert only verified shown.
- VERIFY-3: [STAGING ONLY] seed staging with one legacy row (NULL `ocr_extraction_id`); assert still shown.

**Status:** HELD

### DIS-205 — Filter `get_lab_history` tool output by `verification_status` [HELD]

- **Tags:** `integration`, `clinical-safety` (CS-1)
- **Epic:** G
- **Depends on:** DIS-201
- **CS ref:** CS-1
- **Files allowed:**
  - supabase/functions/generate-prescription/index.ts (only the get_lab_history tool handler)
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Updates the `get_lab_history` tool to mirror DIS-204's verification filter server-side so the LLM never sees unverified labs.

**VERIFY:**

- VERIFY-1: [STAGING ONLY] `grep -n "verification_status" supabase/functions/generate-prescription/index.ts` — expect filter inside the `get_lab_history` branch only.
- VERIFY-2: [STAGING ONLY] deploy to staging; call tool against seeded patient; inspect tool_use response — expect only verified rows.
- VERIFY-3: [STAGING ONLY] confirm legacy rows (NULL FK) still returned per §13 design.

**Status:** HELD

### DIS-206 — Opt-in rollout per reception clerk [HELD]

- **Tags:** `integration`, `clinical-safety` (CS-9)
- **Epic:** G
- **Depends on:** DIS-202, DIS-203
- **CS ref:** CS-9
- **Files allowed:**
  - supabase/migrations/dis_operator_flags.sql
  - web/registration.html
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Introduces a per-operator opt-in flag so specific reception clerks can flip to the new flow without global rollout.

**VERIFY:**

- VERIFY-1: [STAGING ONLY] `psql $DIS_STAGING_URL -f supabase/migrations/dis_operator_flags.sql` — expect exit 0; table `dis_operator_flags` exists.
- VERIFY-2: [STAGING ONLY] set one operator's flag to true; confirm registration.html routes that operator's uploads to DIS; other operators unchanged.
- VERIFY-3: [STAGING ONLY] revoke the flag; operator reverts to legacy upload path immediately.

**Status:** HELD

### DIS-207 — Default rollout (DIS becomes primary) [HELD]

- **Tags:** `integration`, `clinical-safety` (CS-1, CS-9)
- **Epic:** G
- **Depends on:** DIS-206
- **CS ref:** CS-1, CS-9
- **Files allowed:**
  - web/registration.html
  - supabase/functions/process-document/index.ts
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Flips the default so DIS is the primary path; legacy path still available for explicit opt-out by flag.

**VERIFY:**

- VERIFY-1: [STAGING ONLY] `grep -n "DIS_INGEST_DEFAULT" web/registration.html` — expect default `true`.
- VERIFY-2: [STAGING ONLY] Playwright smoke against staging — new clerk (no flag row) uploads a fixture, ends up as a DIS extraction; legacy row not created.
- VERIFY-3: [STAGING ONLY] explicit opt-out flag routes to legacy — assert legacy row created, no DIS extraction.

**Status:** HELD

### DIS-208 — Apply cutover migration M-009 [HELD]

- **Tags:** `integration`, `migration`, `clinical-safety` (CS-10, CS-11)
- **Epic:** G
- **Depends on:** DIS-207
- **CS ref:** CS-10, CS-11
- **Files allowed:**
  - dis/migrations/M-009\_\*.sql
  - dis/scripts/apply-m009-live.mjs
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Makes the `ocr_extraction_id` FK on `lab_results` + `vaccinations` **NOT NULL** for rows created after a cutoff date; backfills older rows with a sentinel `legacy` extraction.

**VERIFY:**

- VERIFY-1: [STAGING ONLY] `node dis/scripts/apply-m009-live.mjs --dry-run` — expect plan lists `ALTER COLUMN SET NOT NULL` only after the sentinel backfill step.
- VERIFY-2: [STAGING ONLY] `psql $DIS_STAGING_URL -c "select count(*) from lab_results where ocr_extraction_id is null"` — expect `0`.
- VERIFY-3: [STAGING ONLY] insert a new lab without FK — expect constraint error (proves NOT NULL is live).

**Status:** HELD

### DIS-209 — Delete legacy `process-document` Edge Function [HELD]

- **Tags:** `integration`, `clinical-safety` (CS-9)
- **Epic:** G
- **Depends on:** DIS-208
- **CS ref:** CS-9
- **Files allowed:**
  - supabase/functions/process-document/\*\* (deletion only)
  - dis/document_ingestion_service/10_handoff/legacy-retired.md
- **Out of scope:** re-introduction / partial retention — approval is for full retirement only.
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Retires the legacy `process-document` Edge Function after DIS has been primary for a full quiet period (per rollout plan). Records the retirement in the handoff doc.

**VERIFY:**

- VERIFY-1: [STAGING ONLY] `ls supabase/functions/process-document/` — expect `No such file or directory` after the change is merged (staging mirror).
- VERIFY-2: [STAGING ONLY] `curl -i $SUPABASE_STAGING_URL/functions/v1/process-document` — expect 404.
- VERIFY-3: [STAGING ONLY] `ls dis/document_ingestion_service/10_handoff/legacy-retired.md` — expect file exists with retirement date + final traffic snapshot.

**Status:** HELD

---

## Epic H — AWS port dry-run

### DIS-220 — Terraform for sandbox AWS

- **Tags:** `infra`
- **Epic:** H
- **Depends on:** DIS-079
- **TDD ref:** §17
- **Files allowed:**
  - dis/terraform/aws-sandbox/\*.tf
  - dis/terraform/aws-sandbox/README.md
- **Out of scope:** any production AWS account; any live data.

**Description:** Provisions a sandbox AWS env: RDS Postgres, S3, SQS, Secrets Manager, ECR, Fargate service, ALB, CloudFront.

**VERIFY:**

- VERIFY-1: `cd dis/terraform/aws-sandbox && terraform validate` — expect `Success! The configuration is valid.`
- VERIFY-2: `cd dis/terraform/aws-sandbox && terraform plan -out=tfplan` — expect plan produces resource list matching the 8 components above.
- VERIFY-3: `cd dis/terraform/aws-sandbox && terraform apply tfplan` (sandbox account only) — expect apply succeeds; outputs include RDS endpoint, S3 bucket, SQS queue URL.

**Status:** Ready

### DIS-221 — `S3Adapter` implementation + contract test

- **Tags:** `adapter`
- **Epic:** H
- **Depends on:** DIS-073
- **TDD ref:** §9.3
- **Files allowed:**
  - dis/src/adapters/storage/s3.ts
  - dis/tests/adapters/storage/s3.contract.test.ts

**Description:** Implements `StoragePort` against AWS S3 via the AWS SDK.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/storage/s3.contract.test.ts` — expect PASS against localstack.
- VERIFY-2: `cd dis && npx vitest run tests/contracts/storage-port.runner.test.ts` — expect `s3` implementation included.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-222 — `AwsRdsAdapter` implementation

- **Tags:** `adapter`
- **Epic:** H
- **Depends on:** DIS-074
- **TDD ref:** §9.4
- **Files allowed:**
  - dis/src/adapters/database/aws-rds.ts
  - dis/tests/adapters/database/aws-rds.contract.test.ts

**Description:** Implements `DatabasePort` against RDS Postgres — essentially the same `postgres` driver as the POC, different connection source.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/database/aws-rds.contract.test.ts` — expect PASS against a Docker Postgres fixture.
- VERIFY-2: `cd dis && npx vitest run tests/contracts/database-port.runner.test.ts` — expect `aws-rds` PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-223 — `SqsAdapter` implementation

- **Tags:** `adapter`
- **Epic:** H
- **Depends on:** DIS-075
- **TDD ref:** §9.5
- **Files allowed:**
  - dis/src/adapters/queue/sqs.ts
  - dis/tests/adapters/queue/sqs.contract.test.ts

**Description:** Implements `QueuePort` against AWS SQS.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/queue/sqs.contract.test.ts` — expect PASS against localstack.
- VERIFY-2: `cd dis && npx vitest run tests/contracts/queue-port.runner.test.ts` — expect `sqs` PASS.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-224 — `AwsSecretsManagerAdapter` implementation

- **Tags:** `adapter`
- **Epic:** H
- **Depends on:** DIS-076
- **TDD ref:** §16
- **Files allowed:**
  - dis/src/adapters/secrets/aws-secrets-manager.ts
  - dis/tests/adapters/secrets/aws-secrets-manager.contract.test.ts

**Description:** Implements `SecretsPort` against AWS Secrets Manager with the same 5-minute cache behaviour.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/adapters/secrets/aws-secrets-manager.contract.test.ts` — expect PASS against localstack.
- VERIFY-2: `cd dis && npx vitest run tests/contracts/secrets-port.runner.test.ts` — expect `aws-secrets-manager` PASS, including TTL test.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-225 — `src/wiring/aws.ts` composes prod adapters

- **Tags:** `adapter`, `core`
- **Epic:** H
- **Depends on:** DIS-221..DIS-224
- **TDD ref:** §17
- **Files allowed:**
  - dis/src/wiring/aws.ts
  - dis/tests/wiring/aws.test.ts

**Description:** Composition root for AWS deployment — swaps Supabase adapters for AWS ones. Core unchanged.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/wiring/aws.test.ts` — expect PASS.
- VERIFY-2: `cd dis && node scripts/port-validator.mjs` — expect exit 0 (no adapter import leakage).
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-226 — Port dry-run: provision, migrate, deploy, run fixtures

- **Tags:** `infra`, `test`
- **Epic:** H
- **Depends on:** DIS-220, DIS-225
- **Files allowed:**
  - dis/scripts/aws-dryrun.mjs

**Description:** End-to-end script that provisions sandbox AWS, migrates the schema, deploys the image, runs the clinical-acceptance fixtures, then tears down.

**VERIFY:**

- VERIFY-1: `node dis/scripts/aws-dryrun.mjs --phase=provision` — expect Terraform apply completes.
- VERIFY-2: `node dis/scripts/aws-dryrun.mjs --phase=migrate` — expect migrations applied to RDS; schema matches staging Supabase dump.
- VERIFY-3: `node dis/scripts/aws-dryrun.mjs --phase=fixtures` — expect clinical-acceptance suite PASS.
- VERIFY-4: `node dis/scripts/aws-dryrun.mjs --phase=teardown` — expect Terraform destroy, exit 0.

**Status:** Ready

### DIS-227 — Record port duration + code-change count

- **Tags:** `doc-only`
- **Epic:** H
- **Depends on:** DIS-226
- **Files allowed:**
  - dis/document_ingestion_service/02_architecture/portability.md

**Description:** Appends the dry-run metrics (duration, lines changed, adapters added) to the portability doc.

**VERIFY:**

- VERIFY-1: `grep -c "^## Dry-run results" dis/document_ingestion_service/02_architecture/portability.md` — expect ≥ 1.
- VERIFY-2: `grep -E "\\| DIS-22[0-6] \\|" dis/document_ingestion_service/02_architecture/portability.md` — expect results table rows for DIS-220..DIS-226.

**Status:** Ready

### DIS-228 — AWS sandbox CI (nightly)

- **Tags:** `infra`, `test`
- **Epic:** H
- **Depends on:** DIS-226
- **Files allowed:**
  - .github/workflows/dis-aws-sandbox-nightly.yml

**Description:** Nightly GitHub Actions run of `aws-dryrun.mjs` on a disposable sandbox, with cost cap guardrails.

**VERIFY:**

- VERIFY-1: `grep -n "schedule:" .github/workflows/dis-aws-sandbox-nightly.yml` — expect cron defined.
- VERIFY-2: `grep -n "AWS_BUDGET_USD" .github/workflows/dis-aws-sandbox-nightly.yml` — expect a cost-cap environment variable.
- VERIFY-3: `gh workflow run dis-aws-sandbox-nightly.yml --ref feat/dis-plan` — expect run accepted (manual trigger for review).

**Status:** Ready

### DIS-229 — AWS sandbox teardown automation

- **Tags:** `infra`
- **Epic:** H
- **Depends on:** DIS-220
- **Files allowed:**
  - dis/scripts/aws-teardown.mjs

**Description:** Idempotent teardown — safe to run against a half-provisioned sandbox.

**VERIFY:**

- VERIFY-1: `node dis/scripts/aws-teardown.mjs --fresh` — expect exit 0.
- VERIFY-2: `node dis/scripts/aws-teardown.mjs --already-destroyed` — expect exit 0 and message `Nothing to destroy`.

**Status:** Ready

### DIS-230 — AWS hardening: IAM least-privilege policies

- **Tags:** `infra`, `clinical-safety` (CS-8)
- **Epic:** H
- **Depends on:** DIS-220
- **CS ref:** CS-8
- **Files allowed:**
  - dis/terraform/aws-sandbox/iam.tf
  - dis/terraform/aws-sandbox/tests/iam.test.ts

**Description:** IAM roles scoped so the Fargate task can only read/write the project's S3 prefix, SQS queue, Secrets Manager path.

**VERIFY:**

- VERIFY-1: `cd dis/terraform/aws-sandbox && terraform validate` — expect success.
- VERIFY-2: `cd dis && npx vitest run terraform/aws-sandbox/tests/iam.test.ts` — expect PASS (uses `aws-iam-policy-generator` tests).
- VERIFY-3: `grep -nE "\"Resource\":\\s*\"\\*\"" dis/terraform/aws-sandbox/iam.tf` — expect zero matches (no wildcard resources).

**Status:** Ready

### DIS-231 — AWS hardening: VPC + private subnets

- **Tags:** `infra`
- **Epic:** H
- **Depends on:** DIS-220
- **Files allowed:**
  - dis/terraform/aws-sandbox/network.tf

**Description:** Private subnets for Fargate + RDS; only ALB in public subnet.

**VERIFY:**

- VERIFY-1: `cd dis/terraform/aws-sandbox && terraform validate` — expect success.
- VERIFY-2: `grep -nE "map_public_ip_on_launch\\s*=\\s*true" dis/terraform/aws-sandbox/network.tf` — expect only on `public_*` subnets; zero on private.
- VERIFY-3: `cd dis/terraform/aws-sandbox && terraform plan | grep aws_db_subnet_group` — expect only private subnets.

**Status:** Ready

### DIS-232 — AWS hardening: TLS everywhere

- **Tags:** `infra`
- **Epic:** H
- **Depends on:** DIS-220
- **Files allowed:**
  - dis/terraform/aws-sandbox/tls.tf

**Description:** ACM cert on ALB, TLS required on RDS, SSE-S3 on bucket.

**VERIFY:**

- VERIFY-1: `grep -nE "policy\\s*=\\s*\"ELBSecurityPolicy-TLS13" dis/terraform/aws-sandbox/tls.tf` — expect match.
- VERIFY-2: `grep -nE "iam_database_authentication_enabled|ssl_mode.*require" dis/terraform/aws-sandbox/tls.tf` — expect TLS enforced on RDS.
- VERIFY-3: `grep -nE "server_side_encryption" dis/terraform/aws-sandbox/tls.tf` — expect S3 bucket encrypted.

**Status:** Ready

### DIS-233 — AWS observability: CloudWatch log group + OTLP exporter

- **Tags:** `infra`
- **Epic:** H
- **Depends on:** DIS-147, DIS-225
- **Files allowed:**
  - dis/terraform/aws-sandbox/observability.tf
  - dis/src/wiring/aws-otel.ts

**Description:** Logs to CloudWatch; OTLP exporter pointing at AWS X-Ray (ADOT).

**VERIFY:**

- VERIFY-1: `grep -n "aws_cloudwatch_log_group" dis/terraform/aws-sandbox/observability.tf` — expect one log group per service.
- VERIFY-2: `grep -n "OTEL_EXPORTER_OTLP_ENDPOINT" dis/src/wiring/aws-otel.ts` — expect env var plumbed through.
- VERIFY-3: `cd dis && npx tsc --noEmit` — expect empty output.

**Status:** Ready

### DIS-234 — AWS deploy smoke test

- **Tags:** `infra`, `test`
- **Epic:** H
- **Depends on:** DIS-226
- **Files allowed:**
  - dis/tests/e2e/aws-smoke.test.ts

**Description:** End-to-end smoke against the deployed sandbox — upload a fixture, verify extraction reaches `verified` state.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/e2e/aws-smoke.test.ts -- --env=aws-sandbox` — expect PASS.
- VERIFY-2: `cd dis && npx vitest run -t "extraction reaches verified"` — expect PASS.

**Status:** Ready

### DIS-235 — Epic H closeout doc

- **Tags:** `doc-only`
- **Epic:** H
- **Depends on:** DIS-220..DIS-234
- **Files allowed:**
  - dis/document_ingestion_service/10_handoff/epic-h-closeout.md

**Description:** Records the final port-duration numbers, adapter count, and lessons learned; links to the portability.md dry-run section.

**VERIFY:**

- VERIFY-1: `ls dis/document_ingestion_service/10_handoff/epic-h-closeout.md` — expect file exists.
- VERIFY-2: `grep -c "DIS-2[23]" dis/document_ingestion_service/10_handoff/epic-h-closeout.md` — expect ≥ 15 ticket references.
- VERIFY-3: `grep -n "portability.md" dis/document_ingestion_service/10_handoff/epic-h-closeout.md` — expect link to portability doc.

**Status:** Ready

---

## Session-1 follow-ups (Wave A + Wave B, drafted 2026-04-21)

> These six tickets were drafted as a single batch in DIS-002c after
> the post-Wave-3 orientation surfaced: (a) two protocol-bypass
> commits on `feat/dis-plan` that needed rewinding and redoing
> through proper tickets, (b) the 5 pre-existing `fitness.mjs`
> violations flagged by DRIFT-PHASE-1 FOLLOWUP-A, (c) the
> DIS-020/021 coordination scar, and (d) the Datalab adapter
> wire-contract bugs documented in `10_handoff/document_ocr_flow.md
§13`. See `10_handoff/SESSION_PLAN_2026-04-21.md` for the
> session-level wave dispatch.

### DIS-002c — Append session-1 follow-up tickets to backlog

- **Tags:** `doc-only`, `process`
- **Epic:** A (meta / process)
- **Depends on:** DIS-002
- **TDD ref:** none (meta)
- **CS ref:** none
- **Files allowed:**
  - dis/document_ingestion_service/07_tickets/backlog.md
  - dis/handoffs/DIS-002c.md
- **Out of scope:** any file edit outside `backlog.md` + this handoff; any implementation work; any ticket retrofit beyond registration.

**Description:**
Register the five follow-up tickets (DIS-001b, DIS-002d, DIS-002e, DIS-021b, DIS-050a) in `backlog.md` under a new `## Session-1 follow-ups` section, plus this ticket as the meta-entry. Every entry carries Tags, Epic, Depends-on, TDD ref, CS ref, Files allowed, Out of scope, Description, numbered VERIFY-N block, Status. Pure documentation ticket — no code touched.

**VERIFY:**

- VERIFY-1: `grep -c "^### DIS-001b " dis/document_ingestion_service/07_tickets/backlog.md` — expect `1`
- VERIFY-2: `grep -c "^### DIS-002c " dis/document_ingestion_service/07_tickets/backlog.md` — expect `1`
- VERIFY-3: `grep -c "^### DIS-002d " dis/document_ingestion_service/07_tickets/backlog.md` — expect `1`
- VERIFY-4: `grep -c "^### DIS-002e " dis/document_ingestion_service/07_tickets/backlog.md` — expect `1`
- VERIFY-5: `grep -c "^### DIS-021b " dis/document_ingestion_service/07_tickets/backlog.md` — expect `1`
- VERIFY-6: `grep -c "^### DIS-050a " dis/document_ingestion_service/07_tickets/backlog.md` — expect `1`
- VERIFY-7: `grep -c "\*\*Files allowed:\*\*" dis/document_ingestion_service/07_tickets/backlog.md` — expect ≥ `194` (188 pre-existing + 6 new = 194 minimum; `**Files allowed:**` is the human-readable label used in every ticket body, not the YAML `files_allowed:` key that only appears in `_ticket_template.md`).
- VERIFY-8: `test -f dis/handoffs/DIS-002c.md && echo EXISTS` — expect `EXISTS`

**Status:** Ready

---

### DIS-002d — Scaffold hygiene: adrs/ + clarifications/ + done.md backfill + stale refs

- **Tags:** `doc-only`, `process`
- **Epic:** A (meta / process)
- **Depends on:** DIS-002, DIS-002c
- **TDD ref:** none (meta)
- **CS ref:** none
- **Files allowed:**
  - dis/document_ingestion_service/02_architecture/adrs/README.md
  - dis/document_ingestion_service/07_tickets/clarifications/README.md
  - dis/document_ingestion_service/07_tickets/done.md
  - dis/document_ingestion_service/07_tickets/in_progress.md
  - dis/document_ingestion_service/10_handoff/SESSION_HANDOVER_2026-04-20.md
  - dis/document_ingestion_service/10_handoff/document_ocr_flow.md
  - radhakishan_system/docs/document_ocr_flow.md
  - dis/handoffs/DIS-002d.md
- **Out of scope:** any ADR body (that is DIS-002e); any code edit; any backlog edit.

**Description:**
Create the two process folders the drift-prevention controls assume exist:
(a) `02_architecture/adrs/` with a README documenting the ADR template +
supersession discipline + gate integration, (b)
`07_tickets/clarifications/` with a README documenting the CLAR-NNN
format. Move `document_ocr_flow.md` from `radhakishan_system/docs/`
into `10_handoff/` (it belongs with the session handovers) and fix
the stale path reference in `SESSION_HANDOVER_2026-04-20.md §2`.
Backfill `07_tickets/done.md` with the 15 Wave-1–3 merged tickets per
`session_handoff.md §8`. Ensure `07_tickets/in_progress.md` reads
"empty" (placeholder).

**VERIFY:**

- VERIFY-1: `test -f dis/document_ingestion_service/02_architecture/adrs/README.md && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `test -f dis/document_ingestion_service/07_tickets/clarifications/README.md && echo EXISTS` — expect `EXISTS`
- VERIFY-3: `test -f dis/document_ingestion_service/10_handoff/document_ocr_flow.md && echo EXISTS` — expect `EXISTS`
- VERIFY-4: `test -e radhakishan_system/docs/document_ocr_flow.md || echo MOVED` — expect `MOVED`
- VERIFY-5: `grep -c "^### DIS-0" dis/document_ingestion_service/07_tickets/done.md` — expect ≥ `15`
- VERIFY-6: `grep -c "feature_plans/document_ingestion_service/10_handoff/document_ocr_flow.md" dis/document_ingestion_service/10_handoff/SESSION_HANDOVER_2026-04-20.md` — expect ≥ `1`
- VERIFY-7: `test -f dis/handoffs/DIS-002d.md && echo EXISTS` — expect `EXISTS`

**Status:** Ready

---

### DIS-002e — ADR pack: ADR-001..007

- **Tags:** `doc-only`, `architecture`
- **Epic:** A (meta / architecture)
- **Depends on:** DIS-002d
- **TDD ref:** §1 (hexagonal), §9 (OCR), §10 (structuring), §17 (portability)
- **CS ref:** none directly (ADR-003 touches CS-9 kill-switch semantics; ADR-004 touches CS-2 raw-response audit via webhook path)
- **Files allowed:**
  - dis/document_ingestion_service/02_architecture/adrs/ADR-001-hexagonal-ports-and-adapters.md
  - dis/document_ingestion_service/02_architecture/adrs/ADR-002-datalab-hosted-vs-self-host.md
  - dis/document_ingestion_service/02_architecture/adrs/ADR-003-kill-switch-returns-503.md
  - dis/document_ingestion_service/02_architecture/adrs/ADR-004-datalab-webhooks-over-polling.md
  - dis/document_ingestion_service/02_architecture/adrs/ADR-005-hono-over-fastify.md
  - dis/document_ingestion_service/02_architecture/adrs/ADR-006-postgres-driver-over-pg-or-drizzle.md
  - dis/document_ingestion_service/02_architecture/adrs/ADR-007-claude-haiku-default-sonnet-escalation.md
  - dis/document_ingestion_service/02_architecture/adrs/README.md
  - dis/document_ingestion_service/06_rollout/kill_switch.md
  - dis/handoffs/DIS-002e.md
- **Out of scope:** any code, schema, or backlog edit; any ADR beyond ADR-001..007 (future ADRs open new tickets).

**Description:**
Write 7 ADRs in the `Context / Decision / Consequences / Alternatives`
format mandated by `coding_standards.md §15`:

- **ADR-001** — Hexagonal Ports & Adapters (captures `tdd.md §1` + 8-port inventory).
- **ADR-002** — Datalab hosted (Chandra) at POC; self-host threshold at **sustained 1000 docs/day** (per user memory + §13 live-verified limits).
- **ADR-003** — Kill switch returns **503 UNAVAILABLE**, not 307 proxy. Reconciles `rollout_plan.md` + `feature_flags.md` + DIS-100 with the prose in `kill_switch.md` by amending the latter to say 503.
- **ADR-004** — Datalab webhooks over polling (per user preference; captures the `webhook_url` field + shared-secret auth documented in `10_handoff/document_ocr_flow.md §13.4`). DIS-050a implements it.
- **ADR-005** — Hono over Fastify (per DIS-004 handoff D-1, §Portability edge-compatible).
- **ADR-006** — `postgres` driver over `pg` / Drizzle (portability; `supabase-postgres.ts` uses `unsafe(sql, params)` parameterised).
- **ADR-007** — Claude Haiku default, Sonnet escalation (per `tdd.md §10.2` + DIS-051 prompt-loader).

Update README index table with all 7 rows. Amend
`06_rollout/kill_switch.md` prose to reflect the 503 decision (replace
"307 proxy" wording).

**VERIFY:**

- VERIFY-1: `ls dis/document_ingestion_service/02_architecture/adrs/ADR-00*.md | wc -l` — expect `7`
- VERIFY-2: `grep -lE "^## (Context|Decision|Consequences|Alternatives)" dis/document_ingestion_service/02_architecture/adrs/ADR-00*.md | wc -l` — expect `7`
- VERIFY-3: `grep -c "^## Status" dis/document_ingestion_service/02_architecture/adrs/ADR-003-kill-switch-returns-503.md` — expect ≥ `1`
- VERIFY-4: `grep -c "503" dis/document_ingestion_service/02_architecture/adrs/ADR-003-kill-switch-returns-503.md` — expect ≥ `3`
- VERIFY-5: `grep -c "webhook_url" dis/document_ingestion_service/02_architecture/adrs/ADR-004-datalab-webhooks-over-polling.md` — expect ≥ `2`
- VERIFY-6: `grep -c "1000 docs/day" dis/document_ingestion_service/02_architecture/adrs/ADR-002-datalab-hosted-vs-self-host.md` — expect ≥ `1`
- VERIFY-7: `grep -c "ADR-00" dis/document_ingestion_service/02_architecture/adrs/README.md` — expect ≥ `7`
- VERIFY-8: `grep -ci "307" dis/document_ingestion_service/06_rollout/kill_switch.md` — expect `0` (reconciled to 503)
- VERIFY-9: `test -f dis/handoffs/DIS-002e.md && echo EXISTS` — expect `EXISTS`

**Status:** Ready

---

### DIS-001b — Merge DEPS_REQUIRED into package.json + fix `.ts`→`.js` imports

- **Tags:** `core`, `infra`
- **Epic:** A
- **Depends on:** DIS-001, DIS-002e (ADR-005 binds Hono)
- **TDD ref:** §1, §2 (architectural style, component layout)
- **CS ref:** none
- **Files allowed:**
  - dis/package.json
  - dis/package-lock.json
  - dis/src/http/server.ts
  - dis/src/http/index.ts
  - dis/DEPS_REQUIRED.md
  - dis/handoffs/DIS-001b.md
- **Out of scope:** any new business logic; any other `.ts` file edit beyond extension-fix in `src/http/`; the DIS-020/021 reconciliation (DIS-021b owns that).

**Description:**
Finally run the deferred `npm install`. Merge runtime deps from
`DEPS_REQUIRED.md` into `dis/package.json.dependencies`: `hono
^4.6.0`, `@hono/node-server ^1.13.0`, `pino ^9.5.0`, `postgres
^3.4.4`, `pdfjs-dist ^4.7.0`, plus `@anthropic-ai/sdk ^0.27.0` (not
previously in DEPS_REQUIRED.md but required for live Haiku calls).
Defer `sharp ^0.33.0` until DIS-058b. Merge dev deps already present
(`typescript`, `vitest`, `@types/node`, `eslint`, `prettier`). Commit
the resulting `package-lock.json`. Fix `.ts`→`.js` extension imports
in `dis/src/http/server.ts` (lines importing `./middleware/...` and
`./routes/...`) and in `dis/src/http/index.ts` (barrel re-exports).
Update `DEPS_REQUIRED.md` to mark the merge as done, retaining the
`sharp` entry for DIS-058b.

**VERIFY:**

- VERIFY-1: `cd dis && grep -c '"hono"' package.json` — expect ≥ `1` inside a `dependencies` block.
- VERIFY-2: `cd dis && grep -c '"@anthropic-ai/sdk"' package.json` — expect ≥ `1`.
- VERIFY-3: `test -f dis/package-lock.json && echo EXISTS` — expect `EXISTS`.
- VERIFY-4: `grep -cE "from ['\"]\\./(middleware|routes)/[a-z-]+\\.ts['\"]" dis/src/http/server.ts dis/src/http/index.ts` — expect `0` (no `.ts` imports remain).
- VERIFY-5: `grep -cE "from ['\"]\\./(middleware|routes)/[a-z-]+\\.js['\"]" dis/src/http/server.ts dis/src/http/index.ts` — expect ≥ `2` (both extensions fixed).
- VERIFY-6: `cd dis && npm install --no-audit --no-fund 2>&1 | tail -5` — paste actual output; expect exit 0 and "added N packages" line.
- VERIFY-7: `cd dis && npx tsc --noEmit 2>&1 | head -30` — paste actual output; **expected to FAIL** with DIS-020/021 mismatch errors. This failure is the trigger that justifies DIS-021b. VERIFY-7 passes when the error list contains references to `orchestrator.ts` and `state-machine.js` import/event-kind mismatches.
- VERIFY-8: `test -f dis/handoffs/DIS-001b.md && echo EXISTS` — expect `EXISTS`.

**Status:** Ready

---

### DIS-021b — Reconcile state-machine; route pipeline through `transition()`; clear fitness violations

- **Tags:** `core`, `clinical-safety` (CS-1)
- **Epic:** B
- **Depends on:** DIS-020, DIS-021, DIS-001b (needs `npx tsc` working)
- **TDD ref:** §4 (state machine), §5 (idempotency), §6 (optimistic lock)
- **CS ref:** CS-1 (no bypass of verification)
- **Files allowed:**
  - dis/src/core/orchestrator.ts
  - dis/src/core/state-machine.ts
  - dis/src/core/errors.ts
  - dis/src/core/**fakes**/database.ts
  - dis/src/ports/database.ts
  - dis/tests/unit/orchestrator.test.ts
  - dis/tests/unit/state-machine.test.ts
  - dis/tsconfig.json (added 2026-04-21 per DIS-002i — fix DIS-001 rootDir/include inconsistency surfaced by DIS-001b V7)
  - dis/tests/integration/health.test.ts (added 2026-04-21 per DIS-002i — one-line `.ts`→`.js` import fix, same bug class as DIS-001b handled in src/http/)
  - dis/handoffs/DIS-021b.md
- **Out of scope:** any adapter code; any HTTP-route code; any schema / migration. Note: DIS-002d inadvertently listed the `__fakes__/database.ts` path with wrapped asterisks from markdown rendering; the authoritative path is `dis/src/core/__fakes__/database.ts` (double-underscore directory).

**Description:**
Resolve the DIS-020/DIS-021 coordination scar flagged in DIS-021
handoff §3 D-1 + §5 AND the 5 `core_no_sql_literals` fitness
violations flagged in DRIFT-PHASE-1 §5 in a single atomic change.

1. **Rename orchestrator's approve/reject event kinds** from
   `'approved'` / `'rejected'` to `'nurse_approve'` /
   `'nurse_reject'` to match state-machine's authoritative `Event`
   union.
2. **Alias `ExtractionState = State`** on state-machine re-exports
   OR rename orchestrator's import to use `State`. Pick the cleaner
   option and document in the handoff.
3. **Route pipeline progressions through `transition()`.** Every
   state change in `orchestrator.process()` (uploaded →
   preprocessing → ocr → structuring → ready_for_review) must call
   `transition(row.status, event)` and persist the returned state,
   so CS-1 guards fire on the happy path too — not just on
   approve/reject.
4. **Extract named DatabasePort methods** (resolution option (a)
   from DRIFT-PHASE-1 §5 DIS-FOLLOWUP-A): add
   `findExtractionById`, `findExtractionByIdempotencyKey`,
   `updateExtractionStatus`, `insertExtraction` to `DatabasePort`;
   update `FakeDatabase` + orchestrator to call them. Clears the 4
   `orchestrator.ts` + 1 `__fakes__/database.ts` fitness violations.
5. **Add/update unit tests** to prove CS-1 guards fire on every
   transition including pipeline progressions.

Gate 2 test-first: commit a test that asserts `fitness.mjs` returns
0 violations AND that pipeline transitions throw
`InvalidStateTransitionError` on an invalid sequence; see it red;
then implement; see it green.

**VERIFY:**

- VERIFY-1: `node dis/scripts/fitness.mjs; echo EXIT=$?` — paste output; expect `EXIT=0` (no violations).
- VERIFY-2: `cd dis && npx tsc --noEmit 2>&1 | tail -5` — paste output; expect empty (no type errors).
- VERIFY-3: `cd dis && npx vitest run tests/unit/orchestrator.test.ts 2>&1 | tail -5` — paste output; expect all pass.
- VERIFY-4: `cd dis && npx vitest run tests/unit/state-machine.test.ts 2>&1 | tail -5` — paste output; expect all pass.
- VERIFY-5: `grep -cE "from ['\"].*/adapters/" dis/src/core/orchestrator.ts dis/src/core/state-machine.ts` — expect `0` (DIP preserved).
- VERIFY-6: `grep -cE "'approved'|'rejected'" dis/src/core/orchestrator.ts` — expect `0` (event kinds renamed).
- VERIFY-7: `grep -cE "'nurse_approve'|'nurse_reject'" dis/src/core/orchestrator.ts` — expect ≥ `2`.
- VERIFY-8: `grep -cE "transition\s*\(" dis/src/core/orchestrator.ts` — expect ≥ `5` (pipeline + approve + reject all routed).
- VERIFY-9: `grep -cE "CS-1" dis/tests/unit/orchestrator.test.ts` — expect ≥ `1` (pipeline-path CS-1 guard test present).
- VERIFY-10: `test -f dis/handoffs/DIS-021b.md && echo EXISTS` — expect `EXISTS`.

**Status:** Ready — **Gate 6a clinical sign-off required before merge (CS-1).**

---

### DIS-002f — Wave-A session handover + commit 4 untracked session-management docs

- **Tags:** `doc-only`, `process`
- **Epic:** A (meta / process)
- **Depends on:** DIS-002c, DIS-002d, DIS-002e, DIS-001b
- **TDD ref:** none (meta)
- **CS ref:** none
- **Files allowed:**
  - dis/document_ingestion_service/07_tickets/backlog.md (append DIS-002f entry only)
  - dis/document_ingestion_service/07_tickets/done.md (append Wave-A rows)
  - dis/document_ingestion_service/07_tickets/in_progress.md (refresh snapshot)
  - dis/document_ingestion_service/10_handoff/SESSION_HANDOVER_2026-04-21.md (new)
  - dis/document_ingestion_service/10_handoff/ORCHESTRATOR_ORIENTATION_2026-04-20.md (untracked → tracked)
  - dis/document_ingestion_service/10_handoff/ORIENTATION_REVIEW_2026-04-20.md (untracked → tracked)
  - dis/document_ingestion_service/10_handoff/SESSION_PLAN_2026-04-21.md (untracked → tracked)
  - dis/document_ingestion_service/10_handoff/Prompt_2.md (untracked → tracked)
  - dis/handoffs/DIS-002f.md
- **Out of scope:** any code; any ADR / runbook / spec edit; any Wave-B work.

**Description:**
End-of-Wave-A session handover. Writes a feature-level session handover at `10_handoff/SESSION_HANDOVER_2026-04-21.md` per `session_handoff.md §4`, summarising what Wave A delivered (DIS-002c, 002d, 002e, 001b) and what remains for Wave B (DIS-021b, 050a). Commits 4 session-management artefacts that accumulated during the session but were left untracked per scope discipline. Backfills `done.md` with the 5 new Wave-A ticket entries.

**VERIFY:**

- VERIFY-1: `test -f dis/document_ingestion_service/10_handoff/SESSION_HANDOVER_2026-04-21.md && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -c "^## §" dis/document_ingestion_service/10_handoff/SESSION_HANDOVER_2026-04-21.md` — expect ≥ `6`
- VERIFY-3: `grep -cE "DIS-002c|DIS-002d|DIS-002e|DIS-001b" dis/document_ingestion_service/10_handoff/SESSION_HANDOVER_2026-04-21.md` — expect ≥ `4`
- VERIFY-4: `grep -cE "DIS-021b|DIS-050a" dis/document_ingestion_service/10_handoff/SESSION_HANDOVER_2026-04-21.md` — expect ≥ `2`
- VERIFY-5: `grep -c "^### DIS-0" dis/document_ingestion_service/07_tickets/done.md` — expect ≥ `20` (16 pre-existing + 5 Wave-A incl. DIS-002f)
- VERIFY-6: 4 session-mgmt docs tracked — `git ls-files dis/document_ingestion_service/10_handoff/ORCHESTRATOR_ORIENTATION_2026-04-20.md dis/document_ingestion_service/10_handoff/ORIENTATION_REVIEW_2026-04-20.md dis/document_ingestion_service/10_handoff/SESSION_PLAN_2026-04-21.md dis/document_ingestion_service/10_handoff/Prompt_2.md | wc -l` — expect `4`
- VERIFY-7: `test -f dis/handoffs/DIS-002f.md && echo EXISTS` — expect `EXISTS`

**Status:** Ready

---

### DIS-002g — Relocate plan folder into `dis/document_ingestion_service/` (no rename)

- **Tags:** `doc-only`, `process`
- **Epic:** A (meta / process)
- **Depends on:** DIS-002f (so the session-1 follow-up artefacts are all tracked before the mass move)
- **TDD ref:** none (meta)
- **CS ref:** none
- **Files allowed:** every path under the old location, the moved paths under the new location, the 3 CI files that hardcode the path, and backlog/done/in-progress. Explicit list:
  - `dis/document_ingestion_service/**` (move source)
  - `dis/document_ingestion_service/**` (move target — **same folder name**, only the parent changes)
  - `dis/scripts/check-pr-citations.mjs` (update DOCS constant)
  - `dis/scripts/check-files-touched.mjs` (update DOCS + TICKET_SOURCES)
  - `.github/workflows/dis-ci.yml` (update paths filter)
  - `dis/document_ingestion_service/07_tickets/backlog.md` + `done.md` + `in_progress.md` (mention the new path in the new Wave-A entries)
  - `dis/handoffs/DIS-002g.md`
- **Out of scope:** any content edit of the moved docs beyond path references; any ADR-body edit; any code outside the 3 CI scripts; any Wave-B work; no folder rename (per user direction — keep `document_ingestion_service` as the leaf name, only the parent changes from `radhakishan_system/docs/feature_plans/` to `dis/`).

**Description:**
Mass `git mv` of the entire plan folder from
`dis/document_ingestion_service/`
to `dis/document_ingestion_service/`. The leaf folder name stays
`document_ingestion_service` (per user direction — do not rename,
only correct the path). Co-locates the plan with the code it
governs. Updates the 3 CI scripts that hardcode the old path
(`check-pr-citations.mjs` `DOCS`; `check-files-touched.mjs`
`DOCS` + `TICKET_SOURCES`; `.github/workflows/dis-ci.yml` paths
filter). Leaves every **content** unchanged. Internal
cross-references inside the plan docs (all relative) continue to
resolve because the subtree structure is preserved.

**VERIFY:**

- VERIFY-1: `test -d dis/document_ingestion_service && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `test -e dis/document_ingestion_service || echo GONE` — expect `GONE`
- VERIFY-3: `test -e radhakishan_system/docs/feature_plans || echo GONE` — expect `GONE` (the old parent folder is empty after the move — `git mv` removes it)
- VERIFY-4: `find dis/document_ingestion_service -type f -name "*.md" | wc -l` — expect ≥ `50`
- VERIFY-5: `test -d dis/document_ingestion_service/02_architecture/adrs && test -d dis/document_ingestion_service/07_tickets/clarifications && echo BOTH` — expect `BOTH`
- VERIFY-6: `grep -r "dis/document_ingestion_service" dis/scripts .github/workflows | wc -l` — expect `0`
- VERIFY-7: `node dis/scripts/check-pr-citations.mjs --body "Implements TDD §4 and CS-1"` — expect exit 0 with `all 2 citation(s) resolved.`
- VERIFY-8: `node dis/scripts/fitness.mjs; echo EXIT=$?` — expect `EXIT=1` with exactly 5 violations (fitness scans only `dis/src/**` so the move does not affect it)
- VERIFY-9: `node dis/scripts/__tests__/drift-controls.test.mjs` — expect `5/5 tests passed.`
- VERIFY-10: `test -f dis/handoffs/DIS-002g.md && echo EXISTS` — expect `EXISTS`

**Status:** Ready

---

### DIS-021c — Fix DIS-021b regressions properly: restore full typecheck surface + drift-controls self-test cwd + vitest config

- **Tags:** `core`, `infra`
- **Epic:** B (regression-clean on DIS-021b)
- **Depends on:** DIS-021b
- **TDD ref:** §1 (architectural style — no quiet skips of code from typecheck); §14 (observability — self-test remains green)
- **CS ref:** none directly. The ticket must NOT alter any CS-1 surface introduced by DIS-021b; scope is strictly regression-cleanup.
- **Files allowed:**
  - dis/tsconfig.json (restore full typecheck; remove DIS-021b's exclude list)
  - dis/vitest.config.ts (new — scope vitest to `tests/**/*.test.ts` only, excluding scripts/\*\* and other non-test files)
  - dis/scripts/check-pr-citations.mjs (make DOCS path cwd-independent via `fileURLToPath(import.meta.url)`)
  - dis/scripts/check-files-touched.mjs (same cwd-independence fix)
  - dis/handoffs/DIS-021c.md
- **Out of scope:** orchestrator / state-machine / adapter / port-contract edits; any edit to test content; any backlog edit.

**Description:**
DIS-021b resolved the DIS-001 `tsconfig.json` `rootDir`/`include` incompatibility with an excessive `exclude` list that silently drops most of the code tree (`src/adapters/**`, `src/http/**`, `src/ports/index.ts`, `tests/unit/adapters/**`, `tests/unit/audit-log.test.ts`, `tests/integration/health.test.ts`) from `tsc --noEmit`. This lets the command pass but hides real type errors in the excluded surface. Further, DIS-021b's tsconfig change widened vitest's test-discovery glob such that `dis/scripts/__tests__/drift-controls.test.mjs` — a pure-Node smoke harness that invokes `process.exit(1)` on failure by design — is now picked up by vitest, and when run from `dis/` cwd it fails because `check-pr-citations.mjs` resolves `DOCS` relative to cwd (expected repo root; gets `dis/dis/document_ingestion_service` when invoked from `dis/`, which doesn't exist).

Fix all three properly:

1. **Restore full typecheck surface.** In `dis/tsconfig.json`, remove the `rootDir` option (the original DIS-001 defect) but DO NOT exclude source or test directories. TypeScript will infer the common root from `include`. Every `.ts` file under `src/**` and `tests/**` must typecheck. If any file fails, fix it — do NOT exclude it.
2. **Lock vitest test discovery to the canonical test globs.** Add `dis/vitest.config.ts` with `test.include: ['tests/**/*.test.ts']` (explicit) and `test.exclude` ignoring `node_modules`, `dist`, `scripts/**`. The pure-Node drift-controls harness remains runnable directly via `node dis/scripts/__tests__/drift-controls.test.mjs` but is not discovered by vitest.
3. **Make the drift-prevention CI scripts cwd-independent.** In `dis/scripts/check-pr-citations.mjs` and `dis/scripts/check-files-touched.mjs`, compute the `DOCS` constant relative to the script's own location using `fileURLToPath(import.meta.url)` + `join(dirname, '../../document_ingestion_service')` (or equivalent). This guarantees the scripts work whether invoked from repo root, from `dis/`, or from any worktree.

Gate 2 test-first workflow is light here because the regression **is** the failing test (vitest suite shows the failure). The fix makes the existing test pass without modifying the test.

**VERIFY:**

- VERIFY-1: `cd dis && npx tsc --noEmit` — expect exit 0 with **no `exclude` list in tsconfig.json** except `node_modules` + `dist`. Every source + test file typechecks.
- VERIFY-2: `grep -c '"exclude"' dis/tsconfig.json` — expect `1` (present but containing only node_modules + dist, not source files).
- VERIFY-3: `grep -cE '"src/adapters|"src/http|"src/ports/index|"tests/unit/adapters|"tests/unit/audit-log|"tests/integration/health' dis/tsconfig.json` — expect `0` (none of DIS-021b's aggressive excludes remain).
- VERIFY-4: `cd dis && npx vitest run 2>&1 | tail -5` — expect all test files pass; `drift-controls.test.mjs` is NOT in the discovered set.
- VERIFY-5: `node dis/scripts/__tests__/drift-controls.test.mjs` — expect `5/5 tests passed.` (direct invocation still works).
- VERIFY-6: `node dis/scripts/check-pr-citations.mjs --body "Implements TDD §4 and CS-1"` — expect exit 0 (repo-root cwd).
- VERIFY-7: `cd dis && node scripts/check-pr-citations.mjs --body "Implements TDD §4 and CS-1"` — expect exit 0 (dis cwd; regression fix).
- VERIFY-8: `cd dis/scripts && node check-pr-citations.mjs --body "Implements TDD §4 and CS-1"` — expect exit 0 (scripts cwd; maximal cwd-independence).
- VERIFY-9: `node dis/scripts/fitness.mjs` — expect 0 violations (unchanged).
- VERIFY-10: `test -f dis/handoffs/DIS-021c.md && echo EXISTS`

**Status:** Ready

---

### DIS-021d — Restore full typecheck surface: DatabasePort contract propagation + .js extensions + Node-24 Buffer/BodyInit + Hono AppVariables

- **Tags:** `core`, `adapter`, `infra`, `clinical-safety` (CS-1 indirect — DatabasePort contract alignment affects orchestrator↔adapter integrity)
- **Epic:** B (DIS-021b completion-gap closeout)
- **Depends on:** DIS-021b, DIS-021c
- **TDD ref:** §1 (architectural style), §4 (state machine wiring), §6 (optimistic lock — touches DatabasePort surface), §14 (observability — typecheck is part of it)
- **CS ref:** CS-1 (indirect — the DatabasePort methods are the only path by which orchestrator persists state transitions; if adapters don't implement them correctly the happy path bypasses verification). Gate 6a clinical sign-off required before merge.
- **Files allowed:**
  - dis/tsconfig.json (target: remove all source/test excludes; keep only node_modules + dist)
  - dis/src/ports/index.ts (add `.js` extensions to 7 re-exports per NodeNext)
  - dis/src/ports/database.ts (cross-check DatabasePort contract — should already be correct post DIS-021b)
  - dis/src/adapters/database/supabase-postgres.ts (implement 4 new DatabasePort methods)
  - dis/src/adapters/database/**fakes**/supabase-postgres.ts (implement the 4 methods in the fake)
  - dis/src/adapters/storage/supabase-storage.ts (Buffer → Uint8Array at fetch boundary, or narrow cast)
  - dis/src/adapters/storage/**fakes**/supabase-storage.ts (same)
  - dis/src/http/server.ts (Hono AppVariables generics fix)
  - dis/tests/unit/audit-log.test.ts (FakeDatabase update + inline test-DB update)
  - dis/handoffs/DIS-021d.md
- **Out of scope:** any behavioural change to the orchestrator or state machine or promotion or confidence policy; no new tests (update existing to compile); no adapter interface change beyond implementing the 4 new DatabasePort methods (the contract is already set by DIS-021b in `dis/src/ports/database.ts`).

**Description:**
Close the completion gap DIS-021b left on the `DatabasePort` contract: the orchestrator got the new named methods (`findExtractionById`, `findExtractionByIdempotencyKey`, `updateExtractionStatus`, `insertExtraction`) but the adapter and fake adapter and audit-log test-fixture FakeDatabase never caught up. DIS-021b masked this by excluding those files from typecheck. DIS-021d restores full typecheck surface by **implementing the missing contract, not excluding the files**.

Additional companion fixes from the DIS-021c handoff inventory:

- 7 NodeNext `.js` extensions in `src/ports/index.ts` re-exports (pure mechanical).
- Node-24 `@types/node` narrowed `BodyInit` to exclude `Buffer<ArrayBufferLike>` in `supabase-storage.ts` fetch calls — convert to `Uint8Array` or add narrow cast.
- `src/http/server.ts` Hono `AppVariables` context generics.

After DIS-021d lands, `dis/tsconfig.json` `exclude` list MUST contain ONLY `node_modules` + `dist`. No source-file or test-file exclusions.

**Gate 2 test-first:** running `npx tsc --noEmit` against the target tsconfig is the failing-test analogue. Commit it first with the exclude removal + expect red (17 errors). Then apply fixes incrementally and land when tsc exits 0.

**VERIFY:**

- VERIFY-1: `cd dis && npx tsc --noEmit` — exit 0 (all 17 errors resolved)
- VERIFY-2: `grep -c '"exclude"' dis/tsconfig.json` — expect `1`
- VERIFY-3: `grep -cE '"src/adapters|"src/http|"src/ports/index|"tests/unit/adapters|"tests/unit/audit-log|"tests/integration/health' dis/tsconfig.json` — expect `0`
- VERIFY-4: `cd dis && npx vitest run 2>&1 | tail -5` — all 12 test files pass, 124 tests (same count as DIS-021c post-merge)
- VERIFY-5: `grep -c "findExtractionById\|findExtractionByIdempotencyKey\|updateExtractionStatus\|insertExtraction" dis/src/adapters/database/supabase-postgres.ts` — expect ≥ `4`
- VERIFY-6: `grep -c "findExtractionById\|findExtractionByIdempotencyKey\|updateExtractionStatus\|insertExtraction" dis/src/adapters/database/__fakes__/supabase-postgres.ts` — expect ≥ `4`
- VERIFY-7: `grep -cE "^export.*from '\\./" dis/src/ports/index.ts` — expect 8 (8 re-exports all with explicit relative path); and `grep -cE "from '\\./[a-z-]+'" dis/src/ports/index.ts` (no-extension imports) — expect `0`
- VERIFY-8: `node dis/scripts/fitness.mjs` — 0 violations, unchanged
- VERIFY-9: `node dis/scripts/__tests__/drift-controls.test.mjs` — 5/5 pass, unchanged
- VERIFY-10: `test -f dis/handoffs/DIS-021d.md && echo EXISTS`

**Status:** Ready — **Gate 6a clinical sign-off required before merge (CS-1 indirect).**

---

### DIS-002j — Wave-B session-handover + done.md backfill (Wave-B closeout)

- **Tags:** `doc-only`, `process`
- **Epic:** A (meta / process)
- **Depends on:** DIS-050a, DIS-021b, DIS-021c, DIS-021d (all Wave-B tickets merged)
- **TDD ref:** none (meta)
- **CS ref:** none
- **Files allowed:**
  - dis/document_ingestion_service/07_tickets/backlog.md (append DIS-002j entry only)
  - dis/document_ingestion_service/07_tickets/done.md (append Wave-B rows)
  - dis/document_ingestion_service/07_tickets/in_progress.md (refresh snapshot)
  - dis/document_ingestion_service/10_handoff/SESSION_HANDOVER_2026-04-21_WaveB.md (new)
  - dis/handoffs/DIS-002j.md
- **Out of scope:** any code; any ADR / runbook / spec edit; any Wave-C work.

**Description:**
End-of-Wave-B session handover mirroring DIS-002f's pattern for Wave A. Writes `10_handoff/SESSION_HANDOVER_2026-04-21_WaveB.md` per `session_handoff.md §4` covering DIS-050a (merged at ba5f944), DIS-021b (merged at 4e23cb2 with CS-1 sign-off), DIS-021c (merged at aef10b7 — regression-cleanup scope-split), DIS-021d (merged at f8cbc34 with CS-1-indirect sign-off — closes DIS-021b DatabasePort completion gap). Backfills `done.md` with these 4 rows plus DIS-002j itself. Stale Wave-A branch cleanup (item 2) already done pre-ticket.

**VERIFY:**

- VERIFY-1: `test -f dis/document_ingestion_service/10_handoff/SESSION_HANDOVER_2026-04-21_WaveB.md && echo EXISTS` — expect `EXISTS`
- VERIFY-2: `grep -c "^## §" dis/document_ingestion_service/10_handoff/SESSION_HANDOVER_2026-04-21_WaveB.md` — expect ≥ `6`
- VERIFY-3: `grep -cE "DIS-050a|DIS-021b|DIS-021c|DIS-021d" dis/document_ingestion_service/10_handoff/SESSION_HANDOVER_2026-04-21_WaveB.md` — expect ≥ `4`
- VERIFY-4: `grep -c "^### DIS-0" dis/document_ingestion_service/07_tickets/done.md` — expect ≥ `25` (21 pre + 4 Wave-B + 1 DIS-002j = 26 expected)
- VERIFY-5: `test -f dis/handoffs/DIS-002j.md && echo EXISTS` — expect `EXISTS`

**Status:** Ready

---

### DIS-050a — DatalabChandraAdapter hotfix: wire-contract + webhook path

- **Tags:** `adapter`
- **Epic:** C
- **Depends on:** DIS-050, DIS-002e (ADR-004 binds the webhook direction)
- **TDD ref:** §9.2
- **CS ref:** none directly (CS-2 raw-response preservation remains — no change)
- **Files allowed:**
  - dis/src/adapters/ocr/datalab-chandra.ts
  - dis/src/ports/ocr.ts
  - dis/tests/unit/adapters/datalab-chandra.test.ts
  - dis/tests/fixtures/datalab/convert-response.json
  - dis/handoffs/DIS-050a.md
- **Out of scope:** any core / HTTP / other-adapter file; the webhook receiver endpoint (Epic D DIS-097 owns that).

**Description:**
Fix the 5 wire-contract bugs documented in
`10_handoff/document_ocr_flow.md §13.2` and wire the webhook path
decided in ADR-004.

1. **Fix `output_format`** — send as a single comma-separated value
   (`form.append('output_format', input.outputFormats.join(','))`),
   not multiple `append` calls.
2. **Remove `langs` field** — not part of the live API (§13.2.2).
   Keep `hints.languageCodes` on the port; adapter stops sending it
   to Datalab; add a comment citing the verification date.
3. **Add `skipCache` constructor option** — when true, send
   `skip_cache=true`. Default false.
4. **Raise `DEFAULT_MAX_TOTAL_WAIT_MS` to 300 000** (5 min), expose
   as env-configurable via constructor option `maxTotalWaitMs` (seam
   already exists) — update the default only.
5. **Map HTTP 429** (and `Retry-After` header) to a new typed error
   `OcrProviderRateLimitedError` with `code='RATE_LIMITED'` and
   `retryAfterSec: number`. Adapter does not retry internally — caller
   (orchestrator / queue) retries per `error_model.md §Retry policy`.
6. **Wire `webhook_url`** — if constructor option `webhookUrl` is
   provided, include it in the submit form; the adapter still polls
   as fallback because the webhook receiver endpoint is Epic-D scope.
   Emit a log indicating webhook mode.

Gate 2 test-first: update the existing 7 tests; add new tests for
each of the 6 changes (13 total). Fixtures may grow if new response
shapes (429 with Retry-After header) are needed.

**VERIFY:**

- VERIFY-1: `cd dis && npx vitest run tests/unit/adapters/datalab-chandra.test.ts 2>&1 | tail -5` — paste; expect ≥ 13 tests pass.
- VERIFY-2: `grep -cE "output_format.*join\s*\(\s*['\"]," dis/src/adapters/ocr/datalab-chandra.ts` — expect ≥ `1` (comma-join present).
- VERIFY-3: `grep -c "langs" dis/src/adapters/ocr/datalab-chandra.ts` — expect `0` (field removed).
- VERIFY-4: `grep -c "skipCache\|skip_cache" dis/src/adapters/ocr/datalab-chandra.ts` — expect ≥ `2`.
- VERIFY-5: `grep -c "300_000\|300000\|5 \* 60 \* 1000" dis/src/adapters/ocr/datalab-chandra.ts` — expect ≥ `1`.
- VERIFY-6: `grep -c "OcrProviderRateLimitedError" dis/src/adapters/ocr/datalab-chandra.ts` — expect ≥ `2`.
- VERIFY-7: `grep -c "webhook_url\|webhookUrl" dis/src/adapters/ocr/datalab-chandra.ts` — expect ≥ `2`.
- VERIFY-8: `grep -c "RATE_LIMITED" dis/src/adapters/ocr/datalab-chandra.ts` — expect ≥ `1`.
- VERIFY-9: `test -f dis/handoffs/DIS-050a.md && echo EXISTS` — expect `EXISTS`.

**Status:** Done (merged ba5f944, Wave B)

---

### DIS-002k — Rewrite stale `10_handoff/` path refs to `handoffs/sessions/`

- **Tags:** `docs`, `doc-only`, `housekeeping`
- **Epic:** (meta / documentation hygiene — parallel to Wave-C prep)
- **Depends on:** none (the 2026-04-22 move already landed at commit `69ce4bc`)
- **Blocks:** future agents reading backlog VERIFY gates containing stale paths
- **TDD ref:** none (doc-only)
- **Clinical-safety ref:** none
- **User-story ref:** none
- **Estimated effort:** S

**Description:**
On 2026-04-22 the 8 session-level handoff docs were moved from
`dis/document_ingestion_service/10_handoff/` into `dis/handoffs/sessions/`
in a single rename commit (`69ce4bc`). The scope of that move was limited by
user instruction to the rename itself — 119 textual references to the old
path across 20 other files were intentionally not updated.

This ticket rewrites every such reference to the new path so future agents
reading VERIFY gates, ADRs, tickets, and team docs don't chase dead paths.
One JSONL session transcript at
`dis/document_ingestion_service/11_session_transcripts/2026-04-20_dis-build-session.jsonl`
legitimately retains the old path (it's a historical record of what was
written at the time) and MUST NOT be rewritten.

The orientation report `dis/handoffs/orientation/05-tickets-handoffs.md`
(finding F2) enumerated the 119 occurrences across 20 files; this ticket's
VERIFY-1 re-counts and VERIFY-2 asserts zero remaining live refs after.

**Files allowed (exhaustive — 20 files + this ticket's handoff):**

```yaml
files_allowed:
  - dis/document_ingestion_service/02_architecture/adrs/ADR-002-datalab-hosted-vs-self-host.md
  - dis/document_ingestion_service/02_architecture/adrs/ADR-004-datalab-webhooks-over-polling.md
  - dis/document_ingestion_service/02_architecture/adrs/ADR-007-claude-haiku-default-sonnet-escalation.md
  - dis/document_ingestion_service/07_tickets/backlog.md
  - dis/document_ingestion_service/07_tickets/done.md
  - dis/document_ingestion_service/07_tickets/integration_hold.md
  - dis/document_ingestion_service/07_tickets/in_progress.md
  - dis/document_ingestion_service/08_team/session_handoff.md
  - dis/handoffs/DIS-001b.md
  - dis/handoffs/DIS-002d.md
  - dis/handoffs/DIS-002e.md
  - dis/handoffs/DIS-002f.md
  - dis/handoffs/DIS-002g.md
  - dis/handoffs/DIS-002h.md
  - dis/handoffs/DIS-002j.md
  - dis/handoffs/DIS-050a.md
  - dis/handoffs/DIS-021b.md
  - dis/handoffs/DIS-021c.md
  - dis/handoffs/DIS-021d.md
  - dis/handoffs/DOC-AGENTIC-PROTOCOL.md
  - dis/handoffs/DOC-VERIFY-BACKLOG-A.md
  - dis/handoffs/DOC-VERIFY-BACKLOG-B.md
  - dis/handoffs/DOC-VERIFY-TEMPLATE.md
  - dis/handoffs/DRIFT-DOC-WRITER.md
  - dis/handoffs/DRIFT-PHASE-1.md
  - dis/handoffs/DIS-002k.md
```

(The teammate MUST first run VERIFY-1 to discover the authoritative live
set; if the grep finds a file not listed above, the teammate must STOP and
report per `verify_format.md §2`. Do NOT silently widen scope.)

**Files the ticket may READ but not write:**

- `dis/handoffs/orientation/05-tickets-handoffs.md` (for the enumeration)
- `dis/document_ingestion_service/11_session_transcripts/*.jsonl` (historical — READ-ONLY, preserves old path intentionally)

**Rewrite rules (apply both, in order — longer-first):**

```
Step 1 (full path):
  old:  dis/document_ingestion_service/10_handoff/
  new:  dis/handoffs/sessions/

Step 2 (shorthand — catches refs that omit the dis/document_ingestion_service/ prefix):
  old:  10_handoff/
  new:  dis/handoffs/sessions/
```

Order matters — if the shorthand substitution runs first, remaining
full-path refs would partially match and produce the malformed
`dis/document_ingestion_service/dis/handoffs/sessions/…`.

Rewrite is a literal path substitution. Do not alter surrounding prose,
formatting, bullets, VERIFY gate expectations, or line structure beyond the
path fragment itself. If a line contains both the old path and quoted
historical context that references its prior location, preserve the quoted
context verbatim and update only the live reference — flag such cases in
the §3 Decisions section of the handoff.

**Scope note (added mid-flight per dev-002k-stale-paths 2026-04-22 STOP-and-report):**
6 files (`dis/handoffs/orientation/**` except `01-overview-product.md`,
`02-architecture.md`, `03-data-api-testing.md`, `06-code-reality-audit.md`;
`dis/handoffs/sessions/Prompt_2.md`;
`dis/handoffs/sessions/SESSION_HANDOVER_2026-04-20.md`) are intentionally
OUT of scope for this ticket because their `10_handoff/` references are
mostly descriptive/historical ("files were moved from X to Y") — blindly
rewriting them would destroy factual statements. Deferred to DIS-002l
(to be registered by the teammate's handoff §5 Follow-ups).

**VERIFY (numbered, machine-checkable):**

```
VERIFY-1: Pre-flight — count current stale refs and list files
  Command:  grep -rln "dis/document_ingestion_service/10_handoff/" dis/ \
              --include="*.md" 2>/dev/null | sort
  Expect:   20 files listed (may be fewer if intervening commits touched any).
            All listed files MUST appear in files_allowed.
  Pass if:  Output matches files_allowed (minus DIS-002k.md which gets created
            after the rewrite) AND count is ≥ 15.

VERIFY-2: Post-rewrite — zero live references remain
  Command:  grep -rln "dis/document_ingestion_service/10_handoff/" dis/ \
              --include="*.md" 2>/dev/null
  Expect:   <empty>
  Pass if:  exit status 1 (grep found nothing) AND stdout is empty.

VERIFY-3: JSONL transcript preserved (historical record untouched)
  Command:  grep -c "dis/document_ingestion_service/10_handoff/" \
              dis/document_ingestion_service/11_session_transcripts/2026-04-20_dis-build-session.jsonl
  Expect:   integer ≥ 1
  Pass if:  The .jsonl still contains old-path strings (we deliberately did
            not rewrite historical records).

VERIFY-4: No files outside files_allowed were modified
  Command:  git diff --name-only feat/dis-plan..HEAD | sort
  Expect:   Only files enumerated in files_allowed above (26 max, minus any
            that had zero stale refs and were untouched).
  Pass if:  Every modified path appears in files_allowed.

VERIFY-5: Handoff file exists per Gate 7
  Command:  test -f dis/handoffs/DIS-002k.md && echo EXISTS
  Expect:   EXISTS
  Pass if:  exit 0.

VERIFY-6: Fitness + tsc + vitest invariants still green (doc-only must not
  regress other gates)
  Command:  cd dis && node scripts/fitness.mjs 2>&1 | tail -3 \
            && npx tsc --noEmit 2>&1 | tail -3 \
            && npx vitest run 2>&1 | tail -5
  Expect:   fitness: 0 violations; tsc exit 0; vitest "Tests  124 passed"
  Pass if:  all three unchanged from Wave-B baseline.
```

**Out of scope (new tickets, not silent cuts):**

- Changing any content other than the path string. Line re-wraps, table reflow,
  or Prettier-induced diffs on the target files = OUT OF SCOPE.
- Rewriting references inside the .jsonl session transcripts.
- Updating references in any file not listed in files_allowed.
- Adding new stale references elsewhere (obviously).

**Test plan:**

- Unit: n/a (doc-only)
- Integration: n/a
- Gate invariants: fitness.mjs 0; tsc --noEmit 0; vitest 124/124 — all
  unchanged from Wave-B baseline.

**Notes / gotchas:**

- Some files may have the old path appearing in frontmatter metadata, YAML
  blocks, inline-code spans, and prose. All five contexts get the same
  literal substitution.
- VERIFY blocks inside `backlog.md` that cite old paths: apply the rewrite.
  The VERIFY commands in those blocks that literally grep or `test -f`
  against handoff file paths must NOT be rewritten if they already point at
  `dis/handoffs/DIS-###.md` (they're already correct) — only rewrite strings
  that explicitly contain `10_handoff/`.
- Be especially careful in DIS-002f.md (25 occurrences — most concentrated)
  and backlog.md (43 occurrences).

**Review gates applicable:**

- [ ] Gate 1 Pre-start
- [ ] Gate 2 Test-first — **SKIPPED** (doc-only; justified per template §2)
- [ ] Gate 4 Automated checks (VERIFY-6)
- [ ] Gate 5 Code review (orchestrator re-runs VERIFY 1–6)
- [ ] Gate 7 DoD (handoff at dis/handoffs/DIS-002k.md)
- [ ] VERIFY block present with ≥3 steps (6 present)
- [ ] Every VERIFY step is a shell command
- [ ] All VERIFY outputs pasted in the handoff
- [ ] `files_allowed` list matches actual PR diff

**Status:** Ready

---

### DIS-025a — Promote idempotency SQL to named DatabasePort methods

- **Tags:** `core`, `adapter`, `infra` (touches both port + adapter surfaces)
- **Epic:** B (completing)
- **Depends on:** DIS-025 (merged 2026-04-22), DIS-054 (SupabasePostgresAdapter)
- **Blocks:** none immediately; Epic D orchestrator will consume the named methods
- **TDD ref:** §5 (idempotency), §6 (DatabasePort), ADR-006
- **Clinical-safety ref:** none directly
- **User-story ref:** none
- **Estimated effort:** S

**Description:**

DIS-025 (`dis/src/core/idempotency-store.ts`) assembled SQL from
concatenated fragments (`SELECT_VERB = 'select'`) to evade the
`core_no_sql_literals` fitness rule, per its handoff §4 disclosure.
That is a cosmetic dodge — the correct architectural fix per ADR-006
and DRIFT-PHASE-1 §5 FOLLOWUP-A is to add two named methods to
`DatabasePort` (pattern from DIS-021b which did the same for
extractions):

- `insertIdempotencyKey(key, payloadHash, createdAt): Promise<void>`
- `findIdempotencyKey(key): Promise<{payloadHash, createdAt} | null>`

The adapter (`SupabasePostgresAdapter`) + fake (`FakeDatabaseAdapter`
in tests/helpers/) host the SQL. `idempotency-store.ts` then calls
only named methods, and the fragment-concatenation workaround reverts
to straightforward implementation-free core.

**Files allowed (exhaustive):**

```yaml
files_allowed:
  - dis/src/ports/database.ts
  - dis/src/core/idempotency-store.ts
  - dis/src/adapters/database/supabase-postgres.ts
  - dis/tests/helpers/fake-adapters.ts
  - dis/tests/unit/idempotency-store.test.ts
  - dis/tests/unit/adapters/supabase-postgres.test.ts
  - dis/handoffs/DIS-025a.md
```

**Files the ticket may READ but not write:**

- `dis/src/core/errors.ts`
- `dis/handoffs/DIS-025.md` (context from predecessor)
- `dis/handoffs/DIS-021b.md` (pattern reference)
- `dis/document_ingestion_service/02_architecture/adrs/ADR-006-postgres-driver-over-pg-or-drizzle.md`
- `dis/document_ingestion_service/02_architecture/drift_prevention.md`

**VERIFY (numbered, machine-checkable):**

```
VERIFY-1: Port has two new named methods
  Command:  grep -cE "insertIdempotencyKey|findIdempotencyKey" dis/src/ports/database.ts
  Expect:   integer ≥ 2
  Pass if:  both signatures declared on the port interface

VERIFY-2: Adapter implements both methods (SQL moved here)
  Command:  grep -cE "insertIdempotencyKey|findIdempotencyKey" dis/src/adapters/database/supabase-postgres.ts
  Expect:   integer ≥ 2
  Pass if:  both impls present

VERIFY-3: Fake adapter implements both (tests compose with fakes)
  Command:  grep -cE "insertIdempotencyKey|findIdempotencyKey" dis/tests/helpers/fake-adapters.ts
  Expect:   integer ≥ 2
  Pass if:  both fake impls present

VERIFY-4: Core no longer contains SQL fragments
  Command:  grep -cE "SELECT_VERB|INSERT_VERB|IDEM_TABLE" dis/src/core/idempotency-store.ts
  Expect:   0
  Pass if:  exit 1 / empty — the workaround-fragments are gone

VERIFY-5: Core no longer contains SQL verbs at all
  Command:  grep -ciE "\\b(select|insert into|update|delete from)\\b" dis/src/core/idempotency-store.ts
  Expect:   0
  Pass if:  core is SQL-free after the promotion

VERIFY-6: Fitness rule now naturally satisfied (not evaded)
  Command:  node dis/scripts/fitness.mjs
  Expect:   "0 violations"
  Pass if:  exit 0

VERIFY-7: Unit tests green after refactor
  Command:  cd dis && npx vitest run tests/unit/idempotency-store.test.ts tests/unit/adapters/supabase-postgres.test.ts
  Expect:   "Tests  passed" with both files green
  Pass if:  vitest exits 0

VERIFY-8: Full tsc clean (no regressions on any caller)
  Command:  cd dis && npx tsc --noEmit
  Expect:   exit 0
  Pass if:  no type errors

VERIFY-9: Handoff present per Gate 7
  Command:  test -f dis/handoffs/DIS-025a.md && echo EXISTS
  Expect:   EXISTS
  Pass if:  exit 0
```

**Out of scope:**

- The `idempotency_keys` migration itself — lands in Wave 4 (M-001..M-008).
- Changing the store's public API or return shape.
- Re-authoring the Supabase Postgres adapter beyond adding the two
  methods and their tests.

**Test plan:**

- Unit: two new adapter tests using an injected fake SqlClient;
  idempotency-store tests unchanged (still compose with
  FakeDatabaseAdapter).
- Integration: covered when DIS-074 shared DatabasePort contract
  suite runs across the real adapter + fake.

**Notes / gotchas:**

- DIS-021b is the exact template. Follow its approach: declare on
  port, implement on adapter using `sql.unsafe(text, params)`, mirror
  on fake.
- The fake's `insertIdempotencyKey` must maintain in-memory state so
  the replay/collision tests that live in idempotency-store.test.ts
  still pass.
- Fitness rule `core_no_sql_literals` is defined in
  `dis/scripts/fitness-rules.json` — do not touch that file.

**Review gates applicable:**

- [ ] Gate 1 Pre-start
- [ ] Gate 2 Test-first (failing adapter test before impl)
- [ ] Gate 4 Automated checks (VERIFY-1..9)
- [ ] Gate 5 Code review
- [ ] Gate 7 DoD (handoff + done.md)
- [ ] VERIFY block present with ≥3 steps (9 present)
- [ ] Every VERIFY step is a shell command

**Status:** Ready

---

### DOC-PLAYBOOK — Agentic AI development playbook (backfilled retroactive ticket)

- **Tags:** `doc-only`, `process`, `playbook`
- **Epic:** (meta — cross-cutting process artifact)
- **Depends on:** orientation package (merged 2026-04-22)
- **Blocks:** none
- **TDD ref:** none (process doc)
- **Clinical-safety ref:** none
- **User-story ref:** none
- **Estimated effort:** M (realized)

**Description:**

Retroactive VDT registration for the agentic-dev playbook that was
dispatched by direct teammate brief on 2026-04-22 before a backlog
entry existed — this ticket backfills the record per task-list
item #28 so the work is auditable in the same format as every other
merged ticket.

The playbook captures every optimization, protocol, and convention
exercised during the DIS build (`.claude/skills/windows-parallel-agents`
v3 protocol, Verify-Driven Ticketing, 7 review gates, Conventional
Commits with ticket scope, session handoff template, SendMessage
mid-flight correction, drift prevention, orientation package refresh
protocol, cron health checks, task-list conventions, anti-patterns,
delegate-vs-do-it-yourself heuristic, adapt-to-new-project guide)
and additionally describes 10 unexercised practices worth adopting
(mutation testing, property-based testing, prompt eval harness,
golden-file fixtures, CI gate enforcement, migration round-trip CI,
MCP servers, Agent SDK direct API, Claude Code hooks, Worktree
hooks). PART A and PART B are clearly demarcated.

Audience: future orchestrator (another Claude Opus session) + human
tech lead. Descriptive voice, not prescriptive. Every PART A claim
cites a source file path or session handover.

**Files allowed (exhaustive):**

```yaml
files_allowed:
  - agentic-dev-playbook/README.md
  - agentic-dev-playbook/templates/.gitkeep
```

**VERIFY (numbered, machine-checkable):**

```
VERIFY-1: Playbook file exists at top-level path
  Command:  test -f agentic-dev-playbook/README.md && echo EXISTS
  Expect:   EXISTS
  Pass if:  exit 0

VERIFY-2: PART A / PART B demarcation present
  Command:  grep -cE "^# PART [AB] —" agentic-dev-playbook/README.md
  Expect:   2
  Pass if:  exactly 2 H1 PART headers present

VERIFY-3: PART A exercised-section count
  Command:  grep -cE "^## §A1[0-4]|^## §A[1-9]\." agentic-dev-playbook/README.md
  Expect:   integer ≥ 14
  Pass if:  all 14 PART A sections present

VERIFY-4: PART B unexercised-section count
  Command:  grep -cE "^## §B[0-9]+\." agentic-dev-playbook/README.md
  Expect:   integer ≥ 10
  Pass if:  all 10 PART B sections present

VERIFY-5: Source citations present in PART A (grep for a representative set)
  Command:  grep -cE "SESSION_HANDOVER_2026|windows-parallel-agents|drift_prevention|session_handoff|agentic_dev_protocol" agentic-dev-playbook/README.md
  Expect:   integer ≥ 20
  Pass if:  PART A is source-anchored, not speculative

VERIFY-6: PART B includes "Not exercised" warning header
  Command:  grep -c "Not exercised in this project" agentic-dev-playbook/README.md
  Expect:   integer ≥ 1
  Pass if:  demarcation note present per spec

VERIFY-7: Length is substantive
  Command:  wc -l < agentic-dev-playbook/README.md
  Expect:   integer 1200..3500
  Pass if:  within descriptive target band

VERIFY-8: templates/ scaffold directory exists (reserved for future extraction)
  Command:  test -d agentic-dev-playbook/templates && echo EXISTS
  Expect:   EXISTS
  Pass if:  exit 0
```

**Out of scope:**

- Prescriptive implementation guides for PART B items (PART B is
  descriptive-only; we have not battle-tested those patterns here).
- Extraction of per-teammate prompt templates into
  `agentic-dev-playbook/templates/*.md` — the scaffold dir is
  reserved for a follow-up ticket.

**Test plan:**

- Unit: n/a (doc-only)
- Integration: n/a
- Gate invariants: unaffected (fitness 0 / tsc 0 / vitest pass
  unchanged from wave merges around commit 2d17bc9)

**Notes / gotchas:**

- Dispatched via direct brief, not a pre-registered ticket
  (recorded in task #28 as a backfill). This ticket is retroactive
  auditability — same shape as every other ticket so the backlog
  stays scannable.
- Gate 2 test-first SKIPPED per _ticket_template.md §doc-only
  exception.
- Orchestrator Gate 5 review caught 2 wrong orientation filenames
  in §A9 and committed a correction (commit f7a609d) before merge.

**Review gates applicable:**

- [x] Gate 1 Pre-start (dispatch brief served as brief-equivalent)
- [ ] Gate 2 Test-first — **SKIPPED** (doc-only)
- [x] Gate 4 Automated checks (VERIFY-1..8 pass on `feat/dis-plan` HEAD)
- [x] Gate 5 Orchestrator review (scribe commit + correction commit)
- [x] Gate 7 DoD (merge commit 2d17bc9; done.md entry will land with Wave-2a closeout)

**Status:** Done (merged 2026-04-22, branch feat/playbook-scribe deleted, commits 662cc13 scribe + f7a609d orchestrator-review + 2d17bc9 merge)

---

## Ticket template

Every new ticket follows this structure. See `_ticket_template.md`.
