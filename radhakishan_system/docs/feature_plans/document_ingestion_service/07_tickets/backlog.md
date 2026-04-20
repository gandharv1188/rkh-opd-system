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
- **Depends on:** DIS-003, DIS-010 (env loader)
- **TDD ref:** §9.2, docs `04_api/openapi.yaml` external provider section
- **Description:** Implements `OcrPort` against Datalab's hosted API. Submits to `POST /api/v1/convert` with `output_format=markdown,json`, mode `accurate`. Polls `GET /convert-result-check/{id}` with exponential backoff (1s → 10s, max 120s). Preserves the full raw response.
- **Acceptance criteria:**
  1. Contract test against a static fixture (pre-recorded response) — parses markdown + blocks correctly.
  2. Integration test against the sandbox API with **one** real PDF, paid out of the $5 credit.
  3. Raw response stored verbatim on the returned `OcrResult.rawResponse`.
  4. Cost recorded in `OcrResult.costMicroINR`.
  5. Timeout after 120s polling → throws `OcrProviderTimeoutError`.
  6. Uses `DATALAB_API_KEY` from Secrets Adapter only (never hardcoded).

### DIS-051 — ClaudeHaikuAdapter

- **Tags:** `adapter`
- **Depends on:** DIS-003, DIS-030 (schema validator), DIS-031 (prompt loader)
- **TDD ref:** §10
- **Description:** Implements `StructuringPort`. Sends Markdown + prompt to Claude Haiku, expects JSON matching `clinical_extraction.v1.json` schema. On schema failure, retries once with `strict: true` cue; if still fails, falls back to `ClaudeSonnetAdapter` (if configured) or throws `StructuringSchemaInvalidError`.
- **Acceptance criteria:**
  1. Contract test with canned Datalab markdown + canned Haiku response.
  2. Live test against the Anthropic API with one fixture.
  3. Schema validation runs on every response.
  4. On drift, retry is observable in logs.

### DIS-052 — ClaudeVisionAdapter (fallback)

- **Tags:** `adapter`
- **Depends on:** DIS-003
- **TDD ref:** §9.2
- **Description:** Implements `OcrPort` by calling Anthropic's Vision API — mirrors current `process-document` behavior. Used when `DIS_OCR_PROVIDER=claude`.
- **Acceptance criteria:**
  1. Output shape matches TDD §9.1 `OcrResult`.
  2. Fixture test against the same inputs as DatalabChandraAdapter; output shapes differ but contract is the same.

### DIS-053..DIS-085 — remaining adapter tickets

- DIS-053 — SupabaseStorageAdapter (`putObject`, `getObject`, `getSignedUploadUrl`, `getSignedDownloadUrl`, `deleteObject`).
- DIS-054 — SupabasePostgresAdapter (query + transaction helpers — no Supabase SDK inside core).
- DIS-055 — SupabaseSecretsAdapter (5-min cache per TDD §16).
- DIS-056 — PgCronAdapter (`enqueue` → INSERT on `dis_jobs`).
- DIS-057 — DefaultFileRouter (TDD §7 decision tree).
- DIS-058 — DefaultPreprocessor:
  - DIS-058a — container normalization (HEIC/WebP → JPEG).
  - DIS-058b — deskew.
  - DIS-058c — perspective correction.
  - DIS-058d — blank-page detection.
  - DIS-058e — duplicate-page detection.
  - DIS-058f — resize + CLAHE + JPEG encode.
  - DIS-058g — page-count cap.
- DIS-059 — Native-PDF text path adapter (uses DIS-033 utility).
- DIS-060 — OfficeWordAdapter (mammoth).
- DIS-061 — OfficeSheetAdapter (xlsx).
- DIS-062 — OnpremChandraAdapter.stub.ts (compiles, throws `NotImplemented`).
- DIS-063..DIS-085 — fake peers for every adapter + contract test suite shared across implementations.

---

## Epic D — Orchestration layer

### DIS-090 — POST /ingest

- **Tags:** `core`, `test`
- **Depends on:** DIS-021, DIS-053, DIS-055
- **TDD ref:** §3, §5
- **Description:** Route handler that accepts the upload, stores the extraction row in `uploaded` state, enqueues a process job, returns `{extraction_id}`.
- **Acceptance criteria:**
  1. Returns 201 with `extraction_id` + `correlation_id`.
  2. Idempotency-Key required; same key returns same row.
  3. Content-type validation → 415.
  4. File size > `DIS_MAX_UPLOAD_MB` → 413.

### DIS-091 — GET /extractions/:id

- **Tags:** `core`
- **Depends on:** DIS-054
- **TDD ref:** §3
- **Description:** Returns the full extraction row for the verification UI. RLS-enforced.
- **Acceptance criteria:**
  1. Returns extraction with `raw_ocr_markdown`, `raw_ocr_blocks`, `structured`, `verified_structured` (if set), `confidence_summary`, `version`.
  2. RLS denies cross-patient reads.

### DIS-092..DIS-110 — remaining orchestration tickets

- DIS-092 — POST /extractions/:id/approve (optimistic lock, trigger promotion, return summary).
- DIS-093 — POST /extractions/:id/reject.
- DIS-094 — POST /extractions/:id/retry (creates new extraction; old preserved).
- DIS-095 — GET /extractions (queue listing with cursor pagination).
- DIS-096 — POST /uploads/signed-url.
- DIS-097 — POST /internal/process-job (worker dispatch).
- DIS-098 — Realtime status push (Supabase Realtime channel).
- DIS-099 — GET /admin/metrics.
- DIS-100 — Kill-switch check middleware (if flag set → 503 with redirect hint).
- DIS-101 — Error handler global middleware.
- DIS-102 — Rate limiter (per-operator).
- DIS-103..DIS-110 — integration tests per endpoint + a full end-to-end test.

---

## Epic E — Verification UI

### DIS-115 — UI scaffolding

- **Tags:** `ui`
- **Depends on:** DIS-004 (health endpoint exists so CORS config is testable)
- **Description:** Single-page app under `dis/ui/` — Vite + React + TypeScript OR static HTML (to be chosen via ADR-001). Shell layout: topbar, queue sidebar, main content area.
- **Acceptance criteria:**
  1. Lighthouse score ≥ 85 on blank page.
  2. Builds to static assets → served from DIS service (or separately via CDN).
  3. WCAG AA baseline checks pass.

### DIS-116..DIS-140

- DIS-116 — Queue page (`/verify/queue`) — lists pending extractions.
- DIS-117 — Detail / verification page (`/verify/:id`) — side-by-side.
- DIS-118 — PDF.js viewer component.
- DIS-119 — Field edit form with confidence badges.
- DIS-120 — Bounding-box overlay (when `bbox` present).
- DIS-121 — Approve / Reject flows with confirm.
- DIS-122 — Duplicate warning banner (CS-4).
- DIS-123 — Diff view (raw AI output vs edited).
- DIS-124 — Offline-first localStorage for in-progress edits.
- DIS-125 — Status badge component (shared).
- DIS-126 — Playwright e2e tests: happy path, reject, duplicate override.
- DIS-127..DIS-140 — accessibility, error boundary, optimistic-update conflict UI, etc.

---

## Epic F — Observability, safety audits, staging migrations

### DIS-145 — Apply M-001..M-008 to staging Supabase

- **Tags:** `migration`, `infra`
- **Depends on:** all Epic B tickets done
- **Description:** Spin up a Supabase **staging** project (new project, not Radhakishan live). Apply migrations via dbmate. Run clinical-acceptance fixture set.
- **Acceptance criteria:**
  1. Staging project has `ocr_extractions`, `ocr_audit_log`, `dis_confidence_policy`, `dis_jobs`, `dis_cost_ledger`.
  2. Migration round-trip test passes: up-down-up produces byte-identical schema.
  3. Clinical-acceptance suite passes on staging.
- **Does NOT touch:** the Radhakishan live Supabase project.

### DIS-146..DIS-175 — observability + safety

- DIS-146 — Structured log output format + pino config.
- DIS-147 — OpenTelemetry tracing (no-op exporter on POC; OTLP in prod).
- DIS-148 — Metrics gauges + counters.
- DIS-149 — Cost ledger writer.
- DIS-150 — Alert webhook (fires at queue depth > 20).
- DIS-151 — Clinician weekly audit dry-run on fixture data.
- DIS-152 — Red-team fixtures (adversarial docs).
- DIS-153..DIS-175 — runbook tabletop exercises, metric dashboards (optional — admin page is enough for POC).

---

## Epic G — Integration (HELD in `integration_hold.md`)

All of these carry `integration` tag and remain held.

- DIS-200 — Apply M-001..M-008 to LIVE Supabase. **HELD**.
- DIS-201 — Apply M-006 to LIVE (FK columns on `lab_results` / `vaccinations`). **HELD**.
- DIS-202 — Modify `registration.html` to POST to DIS. **HELD**.
- DIS-203 — Shadow-mode flag wiring. **HELD**.
- DIS-204 — Modify `loadRecentLabs()` filter. **HELD**.
- DIS-205 — Modify `get_lab_history` tool filter. **HELD**.
- DIS-206 — Opt-in per-operator rollout. **HELD**.
- DIS-207 — Default rollout. **HELD**.
- DIS-208 — Apply M-009 (FK constraint mandatory). **HELD**.
- DIS-209 — Remove legacy `process-document` Edge Function. **HELD**.

---

## Epic H — AWS port dry-run

- DIS-220 — Terraform for sandbox AWS (RDS, S3, SQS, Secrets Manager, ECR, Fargate, ALB, CloudFront).
- DIS-221 — `S3Adapter` implementation + contract test.
- DIS-222 — `AwsRdsAdapter` implementation (essentially the same SQL client as POC).
- DIS-223 — `SqsAdapter` implementation.
- DIS-224 — `AwsSecretsManagerAdapter` implementation.
- DIS-225 — `src/wiring/aws.ts` composes prod adapters.
- DIS-226 — Port dry-run: provision, migrate, deploy image, run fixtures.
- DIS-227 — Record port duration + code-change count → post to `02_architecture/portability.md` "Dry-run results" section.
- DIS-228..DIS-235 — hardening, CI for AWS sandbox, teardown automation.

---

## Ticket template

Every new ticket follows this structure. See `_ticket_template.md`.
