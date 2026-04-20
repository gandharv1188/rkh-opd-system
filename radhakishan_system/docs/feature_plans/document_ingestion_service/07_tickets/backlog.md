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
- **Depends on:** none
- **TDD ref:** §1, §2 (architectural style, component layout)
- **Description:** Create `dis/` root directory with the layout in `adapters.md`. Add `package.json` (Node 20 ESM), `tsconfig.json`, `.nvmrc`, `.gitignore`, `Dockerfile` skeleton, `README.md`. No dependencies installed beyond TypeScript + Hono.
- **Acceptance criteria:**
  1. `dis/package.json` declares `type: "module"`, Node engine 20, scripts: `build`, `test`, `lint`, `typecheck`.
  2. `dis/tsconfig.json` strict mode on.
  3. `dis/src/core/`, `dis/src/ports/`, `dis/src/adapters/`, `dis/src/http/`, `dis/src/wiring/`, `dis/tests/` directories exist with `.gitkeep`.
  4. `npm run typecheck` exits 0.
  5. `dis/README.md` links back to `feature_plans/document_ingestion_service/`.
- **Out of scope:** any business logic, any adapter code.
- **Files touched:** only under `dis/`.

### DIS-002 — CI workflow

- **Tags:** `infra`
- **Depends on:** DIS-001
- **TDD ref:** §14 (observability), §17 (portability)
- **Description:** GitHub Actions workflow that runs on PRs targeting `feat/dis-*` branches — lint, typecheck, test, Docker build.
- **Acceptance criteria:**
  1. `.github/workflows/dis-ci.yml` exists.
  2. Triggers on paths `dis/**`.
  3. Matrix over Node 20 only.
  4. Secret scan step (gitleaks).
  5. Port validator (script that greps for `import .* from '.*/adapters/'` inside `src/core/` or `src/ports/` — fails if any found).
- **Out of scope:** deploy steps, AWS wiring.

### DIS-003 — Port interface stubs

- **Tags:** `core`, `test`
- **Depends on:** DIS-001
- **TDD ref:** §1, §9.1, §10.1
- **Description:** Create 8 empty port interface files with only JSDoc and type signatures from the TDD. Add a `ports/index.ts` re-export. No implementations.
- **Acceptance criteria:**
  1. `dis/src/ports/{ocr,structuring,storage,database,queue,secrets,file-router,preprocessor}.ts` exist.
  2. Each file's contents match the interface in TDD §9.1 / §10.1 / `adapters.md`.
  3. `dis/src/ports/index.ts` re-exports every port type.
  4. Typecheck passes.
- **Out of scope:** any implementation, any adapter.

### DIS-004 — Health endpoint

- **Tags:** `core`, `infra`
- **Depends on:** DIS-001
- **TDD ref:** §3
- **Description:** Minimal Hono server with `GET /health` → `{status: 'ok', version}`. No port usage, no adapters.
- **Acceptance criteria:**
  1. `dis/src/http/server.ts` boots on `PORT=3000`.
  2. `dis/tests/integration/health.test.ts` starts server, GETs /health, asserts 200 + `{status: 'ok'}`.
  3. Dockerfile builds; `docker run` answers health check.

### DIS-005..DIS-015 — remaining foundations

- DIS-005 — Hono routing convention + error-envelope middleware (§15, error_model.md).
- DIS-006 — JSON schema validator utility (Ajv wrapper) + the `clinical_extraction.v1.json` schema file.
- DIS-007 — OpenAPI YAML copied into `dis/openapi.yaml` as the canonical source; CI validates.
- DIS-008 — Structured logger (pino) + correlation-id middleware.
- DIS-009 — Metrics stub (in-memory counters; endpoint at `/admin/metrics`).
- DIS-010 — Env var loader with schema validation (zod).
- DIS-011 — Port validator script (CI).
- DIS-012 — Test harness utilities (fake adapter factory).
- DIS-013 — Storybook-like fixture loader for tests.
- DIS-014 — Idempotency key middleware (skeleton).
- DIS-015 — `dis/CHANGELOG.md` seeded.

---

## Epic B — Core business logic

### DIS-020 — State machine (pure)

- **Tags:** `core`, `clinical-safety` (CS-1 — no bypass of verification)
- **Depends on:** DIS-003, DIS-006
- **TDD ref:** §4
- **Description:** Pure state machine accepting `(currentState, event) → nextState | ERROR`. Events: `upload`, `routed_native`, `routed_scan`, `preprocessed`, `ocr_complete`, `structured`, `policy_auto_approved`, `nurse_approve`, `nurse_reject`, `promoted`, `fail`.
- **Acceptance criteria:**
  1. `dis/src/core/state-machine.ts` exports pure function.
  2. Valid transitions match TDD §4 diagram exactly.
  3. Invalid transitions throw `InvalidStateTransitionError`.
  4. Unit tests cover 100% of branches — a test per valid and invalid edge.

### DIS-021 — Orchestrator (composed of state-machine + ports)

- **Tags:** `core`
- **Depends on:** DIS-020, DIS-003
- **TDD ref:** §4, §6
- **Description:** Class that accepts injected ports and runs one extraction end-to-end. Optimistic locking on approve. No network I/O — all ports are fakes in tests.
- **Acceptance criteria:**
  1. `dis/src/core/orchestrator.ts` exports `IngestionOrchestrator`.
  2. Constructor takes all 8 ports as dependencies.
  3. `ingest()`, `process()`, `approve()`, `reject()`, `retry()` methods implemented.
  4. Version conflict on approve throws `VersionConflictError`.
  5. Unit tests use `FakeOcrAdapter` etc.; no real I/O.

### DIS-022 — Confidence policy evaluator

- **Tags:** `core`, `clinical-safety` (CS-7)
- **Depends on:** DIS-003
- **TDD ref:** §12
- **Description:** Takes a structured extraction + a policy config + a block list, returns `{auto_approved: bool, rule_results: [...]}`. Default policy at launch: `enabled: false` → always returns `auto_approved: false`.
- **Acceptance criteria:**
  1. `dis/src/core/confidence-policy.ts` pure function.
  2. When `enabled: false`, always returns `auto_approved: false` regardless of confidence.
  3. Per-field rules evaluated independently; one field below threshold → whole extraction requires review.
  4. Policy version stamped on the decision.

### DIS-023 — Promotion service

- **Tags:** `core`, `clinical-safety` (CS-10, CS-11)
- **Depends on:** DIS-020, DIS-003
- **TDD ref:** §13
- **Description:** Takes a verified extraction, produces INSERTs for `lab_results` / `vaccinations` + PATCH for `visits.attached_documents`. CS-10: for `document_type=discharge_summary`, dedupe labs by `test_name_normalized` keeping latest `test_date`. CS-11: skip if `(patient_id, test_name, test_date, value_numeric)` already exists. Returns a transaction plan; does NOT execute the transaction itself (that's the database adapter's job).
- **Acceptance criteria:**
  1. `dis/src/core/promotion.ts` pure function returning `PromotionPlan`.
  2. Unit test: 7 TSB readings on a discharge summary → plan has exactly 1 lab insert.
  3. Unit test: same extraction run twice → second run's plan has 0 inserts (all skipped).
  4. Plan includes a list of skipped rows + reason for audit.

### DIS-024..DIS-045 — remaining core tickets

- DIS-024 — Audit log writer with append-only enforcement check.
- DIS-025 — Idempotency key handler (collision detection).
- DIS-026 — Version / optimistic-lock helper.
- DIS-027 — Content-hash utility (sha256 of file bytes).
- DIS-028 — Correlation ID generator + propagator.
- DIS-029 — Error envelope builder.
- DIS-030 — Schema validator for `ClinicalExtraction` (uses Ajv).
- DIS-031 — Structuring prompt management (load from `prompts/structuring.md`, version-stamp per call).
- DIS-032 — Cost calculator (tokens + pages → micro-INR).
- DIS-033 — Native-PDF text extractor (pdfjs-dist wrapper, pure utility).
- DIS-034..DIS-045 — test tickets: one per core module (integration between modules is tested here).

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
