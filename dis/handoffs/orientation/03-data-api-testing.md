---
report: 03-data-api-testing
last_refreshed: 2026-04-22
source_commit: 69ce4bc
source_paths:
  - dis/document_ingestion_service/03_data/
  - dis/document_ingestion_service/04_api/
  - dis/document_ingestion_service/05_testing/
covered_files:
  - 03_data/data_model.md
  - 03_data/migrations.md
  - 04_api/openapi.yaml
  - 04_api/error_model.md
  - 05_testing/test_strategy.md
  - 05_testing/clinical_acceptance.md
  - 05_testing/verify_format.md
  - 05_testing/fixtures.md
  - 05_testing/integration_tests.md
  - 05_testing/unit_tests.md
report_owner: data-api-test-reviewer
confidence:
  data_model: high
  migrations: high
  retention: medium
  api_contract: high
  error_model: high
  idempotency: high
  test_strategy: high
  clinical_acceptance: high
  fixtures: high
---

## What changed since last refresh

(Empty on first write.)

## Executive summary

**Data.** DIS introduces five new `dis_` / `ocr_` tables (`ocr_extractions`, `ocr_audit_log`, `dis_confidence_policy`, `dis_jobs`, `dis_cost_ledger`) plus additive nullable columns (`ocr_extraction_id`, `verification_status`, `verified_by`, `verified_at`) on `lab_results` and `vaccinations`. The staging table `ocr_extractions` is the single source of truth for a document's lifecycle (10-valued status enum, optimistic `version`, raw + validated + verified JSONB payloads, cost + latency counters). Append-only `ocr_audit_log` is enforced via BEFORE UPDATE/DELETE triggers. All FKs are `ON DELETE RESTRICT`; clinical rows are never deleted (CS-2). Retention is indefinite for clinical + audit + cost, 30 days for completed jobs. RLS is Supabase-style and ports to AWS. Migrations M-001..M-009 are additive + reversible, with M-009 the only cutover and only applied post-rollout.

**API.** Single OpenAPI 3.1 surface (`openapi.yaml`) with nine paths under `/dis/v1`: signed-URL issuance, ingest, list/get/approve/reject/retry extractions, admin metrics, and an internal worker endpoint. Auth is bearer for clients and an `x-worker-token` apikey for `/internal/process-job`. Errors follow one envelope with stable `code`, `retryable` flag, and `request_id` + `correlation_id`. Idempotency is header-driven (`Idempotency-Key` UUID) on `/ingest`, `/approve`, `/reject`; the server dedupes retries. Optimistic concurrency on approve/reject via `version`.

**Testing.** Four-layer pyramid (unit ~70% / integration ~22% / clinical ~6% / E2E smoke ~2%) with hard CI gates and per-directory coverage floors. CS-1..CS-12 each bind to a specific named test file. A 20-fixture clinical acceptance suite with golden files and weekly clinician audit gates rollout advancement. Verify reports (Given/When/Then + literal command output) are the mandatory Gate-7 artefact per ticket.

# PART 1 — DATA (03_data)

## Data model

Reference file: `dis/document_ingestion_service/03_data/data_model.md`.

### New tables

| Table | Purpose | Key columns | Key constraints | Relationships |
|---|---|---|---|---|
| `ocr_extractions` | Staging table; the lifecycle record for every uploaded document | `id uuid PK`, `idempotency_key uuid UNIQUE`, `patient_id text`, `visit_id uuid`, `status text`, `routing_path text`, `schema_version int`, `raw_ocr_response jsonb`, `raw_structured_response jsonb`, `structured jsonb`, `verified_structured jsonb`, `confidence_summary jsonb`, `policy_decision jsonb`, `version int`, `correlation_id uuid`, `tokens_in/out bigint`, `cost_micro_inr bigint`, `latency_ms_total int` | `status` CHECK in 10-value set (`uploaded`, `preprocessing`, `ocr`, `structuring`, `ready_for_review`, `auto_approved`, `verified`, `promoted`, `rejected`, `failed`); `routing_path` CHECK in 5-value set; UNIQUE on `idempotency_key` | FK `patient_id → patients(id)` RESTRICT; FK `visit_id → visits(id)` RESTRICT |
| `ocr_audit_log` | Append-only forensic log of every state change and edit | `id bigserial PK`, `extraction_id uuid`, `event_type text`, `actor_type text`, `actor_id text`, `from_state text`, `to_state text`, `field_path text`, `before_value jsonb`, `after_value jsonb`, `correlation_id uuid` | `actor_type` CHECK in (`user`, `system`); BEFORE UPDATE trigger `trg_ocr_audit_log_no_update` raises; BEFORE DELETE trigger `trg_ocr_audit_log_no_delete` raises | FK `extraction_id → ocr_extractions(id)` RESTRICT |
| `dis_confidence_policy` | Versioned JSONB rules controlling auto-approval | `id uuid PK`, `version int`, `enabled boolean`, `rules jsonb`, `activated_by text`, `activated_at timestamptz`, `deactivated_at timestamptz` | Only one row with `deactivated_at IS NULL` is active (single-active invariant, test-enforced) | — |
| `dis_jobs` | POC queue backing (Supabase only; replaced by SQS on AWS) | `id bigserial PK`, `topic text`, `payload jsonb`, `available_at timestamptz`, `attempts int`, `max_attempts int`, `locked_until timestamptz`, `locked_by text`, `last_error text`, `completed_at timestamptz` | Partial index `idx_dis_jobs_ready` on `(topic, available_at) WHERE completed_at IS NULL` | — |
| `dis_cost_ledger` | Append-only finance ledger in micro-rupees | `id bigserial PK`, `extraction_id uuid`, `provider text`, `operation text`, `tokens_in/out bigint`, `pages int`, `cost_micro_inr bigint`, `correlation_id uuid` | `operation` free-text but conventionally `ocr`/`structuring` (not a CHECK constraint — gap, see Drift) | FK `extraction_id → ocr_extractions(id)` ON DELETE SET NULL (softer than the rest) |

Full DDL at `03_data/data_model.md:13-152`.

### `ocr_extractions` column reference

Complete column list with type, nullability, and purpose (`data_model.md:13-63`):

| Column | Type | Null | Purpose |
|---|---|---|---|
| `id` | uuid | no (PK, `default gen_random_uuid()`) | Primary key |
| `idempotency_key` | uuid | no (UNIQUE) | Per-request dedupe key supplied by client |
| `patient_id` | text | no (FK patients.id RESTRICT) | Scoping |
| `visit_id` | uuid | yes (FK visits.id RESTRICT) | Nullable — patient may upload without an open visit |
| `uploader_id` | text | yes | Operator who submitted (text for POC; future FK) |
| `source_storage_key` | text | no | Path in storage bucket |
| `source_content_hash` | text | no | SHA-256 of original bytes — duplicate detector input |
| `document_category` | text | no | `lab_report` / `discharge_summary` / etc. |
| `document_date` | date | yes | Extracted from document |
| `status` | text | no | 10-value CHECK enum; lifecycle |
| `routing_path` | text | yes | 5-value CHECK enum or null |
| `ocr_provider` | text | yes | e.g., `datalab` |
| `ocr_provider_version` | text | yes | For reproducibility |
| `structuring_provider` | text | yes | e.g., `anthropic-haiku` |
| `structuring_provider_version` | text | yes | Model version string |
| `schema_version` | int | no (default 1) | ClinicalExtraction schema version |
| `raw_ocr_response` | jsonb | yes | CS-2 preserved forever |
| `raw_ocr_markdown` | text | yes | Client-facing markdown copy |
| `raw_ocr_blocks` | jsonb | yes | Block list from Chandra JSON |
| `raw_structured_response` | jsonb | yes | Unvalidated LLM response(s) |
| `structured` | jsonb | yes | Validated ClinicalExtraction |
| `verified_structured` | jsonb | yes | Nurse-edited version |
| `confidence_summary` | jsonb | yes | `{field_path: confidence}` |
| `policy_decision` | jsonb | yes | `{auto_approved: bool, rule_results: [...]}` |
| `version` | int | no (default 1) | Optimistic lock |
| `verified_by` | text | yes | Actor who approved |
| `verified_at` | timestamptz | yes | Approval timestamp |
| `rejected_reason_code` | text | yes | One of 5-value enum |
| `rejected_reason_note` | text | yes | Free text |
| `promoted_at` | timestamptz | yes | Promotion timestamp |
| `promotion_result` | jsonb | yes | `{labs_inserted, skips, ...}` |
| `error_code` | text | yes | Upper-snake code on failure |
| `error_detail` | text | yes | Detail string |
| `tokens_in`, `tokens_out` | bigint | default 0 | Cost accounting |
| `cost_micro_inr` | bigint | default 0 | Micro-rupees (10^-6 INR) |
| `latency_ms_total` | int | yes | End-to-end timing |
| `correlation_id` | uuid | no | Pipeline-wide ID |
| `created_at`, `updated_at` | timestamptz | no (default now()) | — |

### Status lifecycle (10-value enum)

Derived from `ocr_extractions.status` CHECK (`data_model.md:23-26`) and transition tests in `unit_tests.md` §2.

| Status | Meaning | Typical next | Terminal? |
|---|---|---|---|
| `uploaded` | Bytes landed in storage, extraction record created | `preprocessing` (scan/image path) or `structuring` (native-text path) | No |
| `preprocessing` | HEIC→JPEG, deskew, perspective, CLAHE, blank/dup drop, resize | `ocr` | No |
| `ocr` | Datalab OCR in progress | `structuring` | No |
| `structuring` | Haiku structuring in progress | `ready_for_review` or `failed` (schema-invalid x3) | No |
| `ready_for_review` | Awaiting nurse decision | `verified`, `rejected`, `auto_approved` (if policy enabled) | No |
| `auto_approved` | Confidence-policy admitted without human review | `promoted` | No (intermediate; CS-7 + CS-1) |
| `verified` | Nurse approved (possibly edited) | `promoted` | No (intermediate) |
| `promoted` | Rows written to `lab_results` / `vaccinations`; `visits.attached_documents` patched | — | **Yes** |
| `rejected` | Nurse rejected with reason_code | — | **Yes** (CS-5 permanent) |
| `failed` | Pipeline error (OCR unavailable, schema invalid x3, etc.) | Retry creates a **new** extraction (DIS-US-003); `failed` preserved for audit | **Yes** |

Invalid transitions (tested in `state-machine.test.ts`):

- `uploaded → ocr` (must go through `preprocessing`).
- `rejected → verified` (CS-5).
- `promoted → rejected` (CS-5).
- `failed → uploaded` (retry is a new row, not a reset).

### Audit-log event types (`data_model.md:73`)

Free-text column but conventionally one of: `state_transition`, `field_edit`, `approve`, `reject`, `retry`, `override`, `kill_switch`. Tested via `audit-log.test.ts` and `kill_switch.test.ts`.

### Existing-table modifications

| Table | Added columns | Backfill | Purpose |
|---|---|---|---|
| `lab_results` | `ocr_extraction_id uuid` (FK RESTRICT), `verification_status text` CHECK in (`verified`, `ai_extracted`, `auto_approved`, `manual`), `verified_by text`, `verified_at timestamptz` | legacy `source='manual' → 'manual'`; `source='ai_extracted' → 'ai_extracted'`; `source='upload' → 'verified'` (`data_model.md:170-174`) | Traceability + verification status gate for CS-12 |
| `vaccinations` | Same four columns, same CHECK values | Inferred same pattern (not explicit in file) | Traceability |
| `visits.attached_documents` JSONB | Optional per-entry keys: `ocr_summary`, `ocr_extraction_id`, `ocr_verification_status` | JSONB is additive — no migration required beyond application writes | UI breadcrumb to extraction |

### Dedupe indexes (CS-11)

- `uniq_lab_dedupe` UNIQUE on `lab_results (patient_id, test_name, test_date, coalesce(value_numeric::text, value))` — `data_model.md:166-168`.
- `uniq_vax_dedupe` UNIQUE on `vaccinations (patient_id, vaccine_name, date_given, coalesce(dose_number, 0))` — `data_model.md:184-185`.

### Indexes on `ocr_extractions`

`idx_ocr_ext_patient`, `idx_ocr_ext_visit`, `idx_ocr_ext_status`, `idx_ocr_ext_created (created_at desc)`, `idx_ocr_ext_hash` (`data_model.md:59-63`). Covers the four common query shapes: by patient, by visit, by queue depth, by recency, by duplicate detection.

### RLS

Supabase-style, written to be portable (`data_model.md:207-221`):

- SELECT policy `extractions_read`: `service|admin|nurse` OR `app.patient_id = patient_id`.
- INSERT policy `extractions_insert`: `service` only.
- UPDATE policy `extractions_update`: `service|nurse|admin`.
- **No DELETE policy** — rows are never deleted (CS-2).

### Foreign-key topology

```
patients ──┬── ocr_extractions
visits   ──┘
ocr_extractions ── ocr_audit_log        (RESTRICT)
ocr_extractions ── dis_cost_ledger      (SET NULL — asymmetric)
ocr_extractions ── lab_results          (ocr_extraction_id, RESTRICT)
ocr_extractions ── vaccinations         (ocr_extraction_id, RESTRICT)
```

All `ON DELETE RESTRICT` except `dis_cost_ledger.extraction_id` (SET NULL, preserves finance archive if extraction deleted admin-side). Source: `data_model.md:235-247`.

## Migrations

Reference: `03_data/migrations.md`. Tooling: `dbmate` or `node-pg-migrate`. Every migration has a matching `.rollback.sql` and both are round-trip tested in CI.

| Mig | Title | Effect | Impact | Env gating |
|---|---|---|---|---|
| M-001 | Create `ocr_extractions` | New staging table + 5 indexes | Non-breaking | All |
| M-002 | Create `ocr_audit_log` + triggers | Append-only enforcement via BEFORE UPDATE/DELETE triggers | Non-breaking | All |
| M-003 | Create `dis_confidence_policy` | Seeds row with `enabled=false` (CS-7 default-off) | Non-breaking | All |
| M-004 | Create `dis_jobs` | POC queue | Non-breaking | **Only when `DIS_STACK=supabase`** (`migrations.md:26`) |
| M-005 | Create `dis_cost_ledger` | Append-only finance log | Non-breaking | All |
| M-006 | Add columns to `lab_results`, `vaccinations` | Nullable FK + verification columns + backfill of `verification_status` from legacy `source` | Non-breaking; backfill embedded in migration | All |
| M-007 | Add dedupe indexes | `uniq_lab_dedupe`, `uniq_vax_dedupe` with dry-run duplicate check that **aborts and prints duplicates if any exist** | Non-breaking if clean; may abort | All |
| M-008 | RLS policies | Adds policies on `ocr_extractions` and relations | Non-breaking (existing policies retained) | All |
| M-009 | **Cutover** — FK mandatory on new rows via CHECK constraint `lab_results_extraction_or_source` | `check (ocr_extraction_id is not null or verification_status in ('manual','verified'))` — enforces that any new ai_extracted/auto_approved row must carry an extraction FK | **Cutover; applied only after feature-flag default rollout** (`migrations.md:51-59`) | All |

### Reversibility (`migrations.md:62-73`)

- M-001..M-005 rollback: `DROP TABLE … CASCADE`.
- M-006: `ALTER TABLE … DROP COLUMN …`.
- M-007: `DROP INDEX …`.
- M-008: `DROP POLICY …`.
- M-009: `DROP CONSTRAINT …`.

### CI guardrails (`migrations.md:87-95`)

- Schema-drift detector: live vs migrated diff via `pg_dump --schema-only`.
- Forward + backward + forward: up, down, up with schema match at each step.
- Data-safety test: realistic legacy fixture loaded; all rows must satisfy new constraints after M-006 and M-009.

### Execution

POC: `dbmate -d dis/document_ingestion_service/03_data/migrations up` (`migrations.md:80`). Prod on AWS: same command, different `DATABASE_URL` — migration set is identical.

Runbook: `09_runbooks/migration_incident.md` (referenced `migrations.md:99-100`).

## Retention + privacy

| Data class | Retention | Rationale |
|---|---|---|
| `ocr_extractions` | Indefinite | Clinical record (CS-2) — `data_model.md:227` |
| `ocr_audit_log` | Indefinite | Forensic trail (CS-6) — `data_model.md:228` |
| `dis_jobs` | 30 days after `completed_at` | Operational only — `data_model.md:229` |
| `dis_cost_ledger` | Indefinite; may roll up monthly after 1 year | Finance archive — `data_model.md:230-231` |
| Fixtures | In-repo, private; `_retired/` archive folder | Test assets (`fixtures.md` §8) |

### PII handling

- Logs record `patient_id` only — no name, no UHID — per error_model.md:73.
- RLS scopes `nurse` sessions by `app.patient_id` setting so cross-patient reads return zero rows (tested by `rls.cs8.test.ts`).
- Fixtures are pair-reviewed (QA + clinical reviewer) with a mandatory `fixture.meta.yaml` anonymization block; pre-commit hook runs a naive PII detector (Indian name prefixes, 10-digit mobile regex, 12-digit Aadhaar regex, production UHID prefix) — `fixtures.md:117-124`.
- Raw fixture policy: never copy from `documents` bucket directly; redact on a clean workstation first (`fixtures.md:128-130`).
- PHI exposure incident path: `09_runbooks/phi_exposure.md` (`fixtures.md:124-125`).

## Data-layer gaps / drift

1. **`dis_cost_ledger.operation` has no CHECK constraint** while similar enumerated columns elsewhere do. `data_model.md:146` comments `-- 'ocr' | 'structuring'` but the DDL does not enforce it. Risk: free-text drift in finance reporting.
2. **Asymmetric FK behaviour on cost_ledger** — `ON DELETE SET NULL` vs RESTRICT everywhere else (`data_model.md:142`). Intentional (finance survives extraction deletion) but undocumented rationale; could be a silent data-loss vector if admin deletes extractions incautiously.
3. **`vaccinations` backfill rule not stated** — `data_model.md:176-186` only explicitly specifies `lab_results` backfill rules. `vaccinations` gets the same columns but the `verification_status` backfill mapping is not written. Assumed same as `lab_results`, not verified.
4. **`dis_weekly_audit` table referenced but not defined** — `clinical_acceptance.md:103-104` writes weekly audit results to `dis_weekly_audit`, flagged "new; see data_model for future migration". No such migration exists. Gap: clinician audit log has no persistent home yet.
5. **`uploader_id text` (not FK)** — acknowledged as "text for POC; later FK to users" (`data_model.md:18`). Will need M-010 at minimum.
6. **`ocr_extractions.source_content_hash` has no uniqueness constraint** — duplicate detection is at approve-time via warning, not at schema. That is intentional (a duplicate upload still creates its own extraction; see CS-4 / DIS-US-015) but mildly surprising; worth documenting inline.

# PART 2 — API (04_api)

## OpenAPI surface

Reference: `04_api/openapi.yaml` (295 lines, OpenAPI 3.1.0, server `https://{host}/dis/v1`, default host `ecywxuqhnlkjtdshpcbc.functions.supabase.co`).

### Paths

| Method | Path | operationId | Purpose | Auth | Request schema | Response schema | Error codes (explicit in spec) |
|---|---|---|---|---|---|---|---|
| POST | `/uploads/signed-url` | `createSignedUploadUrl` | Issue a signed URL for direct-to-storage upload | bearerAuth | `SignedUrlRequest` (filename, content_type, size_bytes ≤ 20 MB, patient_id, visit_id, category) | `SignedUrlResponse` (url, fields, storage_key) | — (relies on global envelope) |
| POST | `/ingest` | `ingest` | Submit an uploaded document for ingestion | bearerAuth + `Idempotency-Key` header (uuid, required) | `IngestRequest` (storage_key, patient_id, visit_id, category, filename, content_type, doc_date?) | `IngestResponse` (extraction_id, status, correlation_id) — 201 | 409 duplicate idempotency, 415 unsupported media |
| GET | `/extractions` | `listExtractions` | List extractions with filters | bearerAuth | query: `status` (10-value enum), `patient_id`, `limit` (1–200, default 50), `cursor` | `ExtractionList` (items, next_cursor) | — |
| GET | `/extractions/{id}` | `getExtraction` | Get one extraction | bearerAuth | path: `id` uuid | `Extraction` (id, status, version, patient_id, visit_id, document_category, structured, verified_structured, confidence_summary, raw_ocr_markdown, raw_ocr_blocks, source_storage_key, created_at, updated_at) | 404 |
| POST | `/extractions/{id}/approve` | `approveExtraction` | Approve (optionally with edits) | bearerAuth + `Idempotency-Key` header | `ApproveRequest` (version required, verified_structured?, override_duplicates default false) | `PromotionSummary` (labs_inserted/skipped, vax_inserted/skipped, document_patched) | 409 version conflict or invalid state |
| POST | `/extractions/{id}/reject` | `rejectExtraction` | Reject | bearerAuth + `Idempotency-Key` header | `RejectRequest` (version, reason_code enum `[illegible, wrong_patient, not_medical, duplicate, other]`, reason_note?) | 200 (no schema body) | 409 cannot reject from current state |
| POST | `/extractions/{id}/retry` | `retryExtraction` | Retry a failed extraction by creating a new one | bearerAuth | path: `id` | `IngestResponse` — 201 | — |
| GET | `/admin/metrics` | `getMetrics` | Service-role metrics | bearerAuth (role-gated) | — | 200, no schema pinned | — (spec is silent; 403 implied by role gate — tested in `admin_metrics.test.ts`) |
| POST | `/internal/process-job` | `processJob` | Worker endpoint — not called from browser | **workerAuth** (`x-worker-token` apikey header) | — | 204 | — |

### Per-path detail

#### `POST /uploads/signed-url` (`openapi.yaml:16-32`)

- Operation: `createSignedUploadUrl`.
- Auth: `bearerAuth`.
- Request `SignedUrlRequest`: `filename`, `content_type`, `size_bytes ≤ 20 971 520` (20 MB hard cap), `patient_id`, `visit_id` (uuid), `category`.
- Response `SignedUrlResponse`: `url` (URI), `fields` (free-form object for presigned POST fields), `storage_key`.
- No Idempotency-Key — issuing a signed URL is naturally idempotent from the client's perspective (re-request yields a fresh URL that points to the same eventual `storage_key` if the client passes one; otherwise a new key).
- Error surface: 400 `INVALID_ARGUMENT` (missing fields / bad category), 401 `UNAUTHENTICATED`, 413 `PAYLOAD_TOO_LARGE` (size > 20 MB), 415 `UNSUPPORTED_MEDIA_TYPE`.

#### `POST /ingest` (`openapi.yaml:34-58`)

- Operation: `ingest`.
- Auth: `bearerAuth` + **required** `Idempotency-Key` header (uuid).
- Request `IngestRequest`: `storage_key`, `patient_id`, `visit_id` (uuid), `category`, `filename`, `content_type`, optional `doc_date` (date).
- Response 201 `IngestResponse`: `extraction_id` (uuid), `status` (10-value enum but typed as `string` in spec — drift), `correlation_id` (uuid).
- Documented errors: 409 (duplicate idempotency key), 415 (unsupported media type).
- Undocumented but required by tests: 503 `UNAVAILABLE` under kill-switch, 201 with async pipeline continuation.

#### `GET /extractions` (`openapi.yaml:60-96`)

- Operation: `listExtractions`.
- Query: `status` enumerates 10 values (`uploaded, preprocessing, ocr, structuring, ready_for_review, auto_approved, verified, promoted, rejected, failed`); `patient_id` free string; `limit` 1–200 default 50; `cursor` opaque string.
- Response: `ExtractionList { items: Extraction[], next_cursor?: string }`.
- Cursor pagination — `next_cursor=null` signals end.

#### `GET /extractions/{id}` (`openapi.yaml:98-114`)

- Operation: `getExtraction`.
- Path: `id` uuid.
- Response `Extraction`: `id`, `status` (string — enum drift), `version` (int), `patient_id`, `visit_id`, `document_category`, `structured` (object), `verified_structured` (nullable object), `confidence_summary`, `raw_ocr_markdown` (nullable), `raw_ocr_blocks` (array of objects), `source_storage_key`, `created_at`, `updated_at`.
- **Missing field:** `warnings[]` — required by duplicate-detection integration test (`integration_tests.md:75-76`) and red-team F17 UI assertion (`clinical_acceptance.md:155-158`) but absent from the schema.
- 404 when not found.

#### `POST /extractions/{id}/approve` (`openapi.yaml:116-141`)

- Operation: `approveExtraction`.
- Auth: `bearerAuth` + required `Idempotency-Key` header.
- Path: `id` uuid.
- Request `ApproveRequest`: `version` int (required, optimistic lock), `verified_structured` (optional object — if omitted, AI output used as-is), `override_duplicates` bool default false.
- Response 200 `PromotionSummary`: `labs_inserted`, `labs_skipped`, `vax_inserted`, `vax_skipped`, `document_patched` (bool — whether `visits.attached_documents` JSONB was updated).
- 409: version conflict OR invalid state transition. `VERSION_CONFLICT` details carry current `version`; `INVALID_STATE_TRANSITION` applies to rejected/promoted/failed sources.
- 422 (not in spec but implied by `error_model`): `VALIDATION_FAILED` on `verified_structured` with `details.errors: [{field_path, rule, message}]`.

#### `POST /extractions/{id}/reject` (`openapi.yaml:143-165`)

- Operation: `rejectExtraction`.
- Auth: `bearerAuth` + required `Idempotency-Key`.
- Request `RejectRequest`: `version` required, `reason_code` enum in `[illegible, wrong_patient, not_medical, duplicate, other]`, optional `reason_note`.
- 200 no body, 409 cannot reject from current state.
- Rejection is permanent (CS-5) — no re-approval path.

#### `POST /extractions/{id}/retry` (`openapi.yaml:167-181`)

- Operation: `retryExtraction`.
- Auth: `bearerAuth` (no Idempotency-Key required — **gap**: double-click risk).
- No request body.
- Response 201: new `IngestResponse` (new `extraction_id`; original preserved for audit per CS-2).

#### `GET /admin/metrics` (`openapi.yaml:183-189`)

- Operation: `getMetrics`.
- Auth: `bearerAuth` but gated to service role at the handler level (integration test `admin_metrics.test.ts` asserts anon → 403).
- Response 200 — **no schema declared** (gap). Integration test asserts queue depth + latency.

#### `POST /internal/process-job` (`openapi.yaml:191-199`)

- Operation: `processJob`.
- Auth: `workerAuth` (`x-worker-token` apikey header).
- Response 204 (no content).
- Not callable from browser; consumed by queue worker (SQS on AWS, `dis_jobs` on Supabase).

### Security schemes (`openapi.yaml:202-209`)

- `bearerAuth`: HTTP bearer (unspecified JWT issuer in the spec — assumed Supabase JWT for POC).
- `workerAuth`: `x-worker-token` apikey header; scoped to `/internal/process-job`.

### Request/response schema notes

- `SignedUrlRequest.size_bytes` hard cap: `maximum: 20971520` (20 MB). Matches error_model `PAYLOAD_TOO_LARGE` (413).
- `Extraction` payload intentionally omits `raw_ocr_response` (large JSON) and `raw_structured_response` (kept server-side for audit only; CS-2). Clients see `raw_ocr_markdown` and `raw_ocr_blocks` convenience copies only.
- `ApproveRequest.verified_structured` is free-form object. JSON Schema validation of edits happens server-side (error code `VALIDATION_FAILED` with `details.errors[]`).
- `RejectRequest.reason_code` enum is fixed — five values — and constrains downstream audit.

## Error model

Reference: `04_api/error_model.md`.

### Envelope (`error_model.md:7-18`)

```jsonc
{
  "error": {
    "code": "UPPER_SNAKE",
    "message": "Human-readable short message.",
    "details": { /* optional structured context */ },
    "retryable": true | false,
    "request_id": "uuid",        // per-request
    "correlation_id": "uuid"     // pipeline-wide
  }
}
```

### HTTP status mapping (`error_model.md:22-36`)

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | Malformed request |
| 401 | `UNAUTHENTICATED` | Missing or invalid auth |
| 403 | `FORBIDDEN` | Insufficient role |
| 404 | `NOT_FOUND` | Extraction / patient / visit missing |
| 409 | `CONFLICT` | Idempotency collision, version mismatch, invalid state |
| 413 | `PAYLOAD_TOO_LARGE` | > 20 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Extension not on allowlist |
| 422 | `VALIDATION_FAILED` | Shape OK, domain rules fail |
| 429 | `RATE_LIMITED` | Throttle |
| 500 | `INTERNAL` | Unhandled |
| 502 | `UPSTREAM_FAILED` | OCR/structuring provider error; `details.provider` |
| 503 | `UNAVAILABLE` | Kill switch or maintenance |
| 504 | `UPSTREAM_TIMEOUT` | Provider timeout |

### Specific error codes (`error_model.md:40-60`)

**4xx:** `INVALID_ARGUMENT`, `MISSING_IDEMPOTENCY_KEY`, `IDEMPOTENCY_KEY_CONFLICT`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `VERSION_CONFLICT`, `INVALID_STATE_TRANSITION`, `DUPLICATE_DOCUMENT` (with `details.prior_extraction_id`), `PATIENT_NOT_FOUND`, `VISIT_NOT_FOUND`, `VALIDATION_FAILED` (with `details.errors: [{field_path, rule, message}]`).

**5xx:** `OCR_PROVIDER_UNAVAILABLE` (with `details.provider`, `details.retry_after_sec`), `OCR_PROVIDER_TIMEOUT`, `STRUCTURING_PROVIDER_FAILED`, `STRUCTURING_SCHEMA_INVALID`, `PROMOTION_FAILED` (with `details.reason`), `INTERNAL`.

### Correlation IDs

- `request_id` — server-assigned per request.
- `correlation_id` — pipeline-wide; stamped on `ocr_extractions`, every `ocr_audit_log` row, and every `dis_cost_ledger` row; asserted stable across port calls within one ingestion by `orchestrator.test.ts` §1 #10 (`unit_tests.md:39`).

### Error code → status → retryable → client action matrix

Consolidated from `error_model.md:38-85`.

| Code | Status | Retryable | `details` keys | Client action |
|---|---|---|---|---|
| `INVALID_ARGUMENT` | 400 | no | — | Fix request |
| `MISSING_IDEMPOTENCY_KEY` | 400 (implied) | no | — | Add header |
| `UNAUTHENTICATED` | 401 | no | — | Refresh token |
| `FORBIDDEN` | 403 | no | — | Request role |
| `NOT_FOUND` | 404 | no | — | — |
| `PATIENT_NOT_FOUND` | 404 | no | — | — |
| `VISIT_NOT_FOUND` | 404 | no | — | — |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | no | — | Use new key |
| `VERSION_CONFLICT` | 409 | no | current version | Re-GET, re-render, re-submit |
| `INVALID_STATE_TRANSITION` | 409 | no | — | Reload extraction |
| `DUPLICATE_DOCUMENT` | 409 | no | `prior_extraction_id` | Show warning; approve with `override_duplicates:true` |
| `PAYLOAD_TOO_LARGE` | 413 | no | — | Resize / split |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | no | — | Convert |
| `VALIDATION_FAILED` | 422 | no | `errors: [{field_path, rule, message}]` | Fix edit |
| `RATE_LIMITED` | 429 | yes | — | Backoff |
| `INTERNAL` | 500 | yes | — | Backoff + alert |
| `UPSTREAM_FAILED` | 502 | yes | `provider` | Backoff |
| `OCR_PROVIDER_UNAVAILABLE` | 502/5xx | yes | `provider`, `retry_after_sec` | Background retry; UI shows "AI reader temporarily unavailable" |
| `STRUCTURING_PROVIDER_FAILED` | 502 | yes | — | Backoff |
| `STRUCTURING_SCHEMA_INVALID` | 5xx | no (after N=3 retries) | — | Surfaces as `status=failed`; `POST /retry` |
| `PROMOTION_FAILED` | 500 | yes | `reason` | Re-approve |
| `UNAVAILABLE` | 503 | yes | — | Wait / fall back to legacy |
| `OCR_PROVIDER_TIMEOUT` | 504 | yes | — | Backoff |
| `ALL_PAGES_BLANK` | (gap — not in spec) | no | — | Re-scan (per F20 fixture) |

### Retry policy (`error_model.md:63-67`)

- `retryable: true` for 5xx, 429, 502, 504.
- Client SHOULD retry with exponential backoff: base 1 s, factor 2, cap 30 s, jitter ±20%, reusing same `Idempotency-Key`.
- Server MUST deduplicate retries via the idempotency key.

### Logging (`error_model.md:71-74`)

Every response logs: `method, path, status, duration_ms, request_id, correlation_id, error.code (if any)`. No PII — `patient_id` only.

### Client behaviours (`error_model.md:77-85`)

- `VERSION_CONFLICT` → re-GET, re-render, re-submit. Never auto-retry.
- `DUPLICATE_DOCUMENT` → warning banner (DIS-US-015). Approval requires `override_duplicates: true`.
- `OCR_PROVIDER_UNAVAILABLE` → UI message "AI reader is temporarily unavailable — we'll retry in the background." Background job retries per policy.

## Idempotency rules

- **Endpoints requiring `Idempotency-Key` header** (uuid): `/ingest`, `/extractions/{id}/approve`, `/extractions/{id}/reject` (openapi.yaml:38-42, 125-128, 153-156).
- **Not required on**: `/uploads/signed-url`, `/extractions/{id}/retry`, GETs, `/admin/metrics`, `/internal/process-job`.
- **Key derivation**: client-generated UUID. Server persists on `ocr_extractions.idempotency_key` with UNIQUE constraint (`data_model.md:15`).
- **Retry semantics**:
  - Same key + identical body → return original result (same `extraction_id`, same `PromotionSummary`).
  - Same key + different body → 409 `IDEMPOTENCY_KEY_CONFLICT`.
  - Tested in `integration_tests.md` §5 `idempotency.test.ts` and `unit_tests.md` §1 `orchestrator.test.ts` tests 1–3.
- **Optimistic lock** on approve/reject: `ApproveRequest.version` / `RejectRequest.version` required; `VERSION_CONFLICT` (409) on mismatch. See `unit_tests.md` §2 state-machine and `integration_tests.md` §6 `version_conflict.test.ts`.

## API gaps / drift

1. **`/admin/metrics` has no response schema in OpenAPI** (`openapi.yaml:183-189`). Integration test `admin_metrics.test.ts` (`integration_tests.md:177`) asserts content — queue depth + latency — but the spec is unconstrained. `pnpm openapi:lint` won't catch drift here.
2. **`DIS_KILL_SWITCH` 503 path is in integration tests but not in OpenAPI.** `integration_tests.md` §7 describes `POST /ingest` → 503 `UNAVAILABLE` and an optional 307 to legacy. Neither 503 nor the fallback is declared on the `/ingest` response map. Drift risk.
3. **`warnings[]` on `GET /extractions/{id}` body** is required by duplicate-detection scenario (`integration_tests.md` §3 step 3: `{code:'DUPLICATE_DOCUMENT', prior_extraction_id}`) but `components.schemas.Extraction` has no `warnings` field (`openapi.yaml:271-287`).
4. **`/internal/process-job` returns 204 only** in spec, no error shapes for worker failures. Retry / poison-message behaviour implicit.
5. **`error_model.md` uses `CONFLICT` as the label for 409** but specific codes (`IDEMPOTENCY_KEY_CONFLICT`, `VERSION_CONFLICT`, `INVALID_STATE_TRANSITION`, `DUPLICATE_DOCUMENT`) are the actual values returned. The mapping table (`error_model.md:27`) collapses these under one row; reviewers may misread it as a single code.
6. **`PATIENT_NOT_FOUND`, `VISIT_NOT_FOUND`** listed in error codes (`error_model.md:50`) but `/ingest` in OpenAPI only documents 409 and 415. 404 handling is undocumented at the path level.
7. **`MISSING_IDEMPOTENCY_KEY`** listed in error codes but no status mapping is shown — implied 400 `INVALID_ARGUMENT`; could be more explicit.
8. **`VALIDATION_FAILED` 422 is not mentioned on `/approve`** even though `ApproveRequest.verified_structured` is the natural locus.
9. **`/extractions/{id}/retry` takes no body** but the text says retry "creates a new one" with the same bytes — no re-upload. Spec is silent on whether a new `Idempotency-Key` is required for this endpoint; integration `retry_audit.test.ts` (`integration_tests.md:177`) doesn't call it out either.
10. **`Extraction.status` is typed `string`**, not the 10-value enum used on `/extractions?status=…`. Drift between list filter enum and object schema.

# PART 3 — TESTING (05_testing)

## Test strategy

Reference: `05_testing/test_strategy.md`.

### Guiding principles (`test_strategy.md:7-23`)

1. TDD enforced at ticket level. CI rejects implementation PRs whose linked test ticket has no `[RED]` commit.
2. Pure core, dirty edges. Core uses fakes only; adapters tested against their ports + live sandboxes.
3. Every CS-1..CS-12 has a canonical test file (table §7).
4. Fixtures first-class.
5. Cloud-portable tooling (Vitest/Jest + supertest + testcontainers). No Deno-only APIs.

### Pyramid (`test_strategy.md:28-32`)

| Layer | Tooling | Target share | Blocks merge |
|---|---|---|---|
| Unit (pure core + fakes) | Vitest | ~70% | Yes |
| Integration (real adapters → testcontainers-postgres + provider sandboxes/fakes) | Vitest + supertest + testcontainers | ~22% | Yes |
| Clinical acceptance (fixture + golden + human sign-off) | Vitest + golden-file diff | ~6% | Yes (dataset snapshot) |
| E2E UI smoke (Playwright on verification UI) | Playwright | ~2% | Yes (happy path + reject only) |

### Coverage floors (`test_strategy.md:40-47`)

| Path | Statements | Branches | Notes |
|---|---|---|---|
| `src/core/**` | ≥ 90% | ≥ 85% | Pure logic — no excuses |
| `src/adapters/**` (non-network) | ≥ 80% | ≥ 70% | Router, preprocessor |
| `src/adapters/ocr/**`, `src/adapters/structuring/**` | ≥ 70% | ≥ 60% | Network boundary |
| `src/http/**` | ≥ 80% | ≥ 70% | Thin handlers |
| `web/verification-ui/**` | smoke only | — | Playwright |

Gate: `vitest run --coverage` fails the build if any directory drops.

### TDD mechanics (`test_strategy.md:51-60`)

- Every implementation ticket has a `test_ticket` field.
- PR template checkbox: "failing test committed before impl commit".
- `scripts/assert-tdd-order.sh` fails the PR if the first test file touching an impl area is introduced after the first impl file.
- Clinical-safety tickets: `[RED][CS-##]` then `[GREEN][CS-##]` commit subjects.

### Fake strategy (`test_strategy.md:67-80`)

| Port | Fake | Behaviour |
|---|---|---|
| `OcrPort` | `FakeOcrAdapter` | Canned `OcrResult` per fixture key; inject errors + latency |
| `StructuringPort` | `FakeStructuringAdapter` | Canned `ClinicalExtraction`; schema-invalid mode |
| `StoragePort` | `InMemoryStorageAdapter` | Map-backed; signed-URL simulation |
| `DatabasePort` | `TestcontainersPostgresAdapter` (integration) + `FakeDatabaseAdapter` (unit) | — |
| `QueuePort` | `SyncQueueAdapter` | Executes jobs inline |
| `SecretsPort` | `EnvSecretsAdapter` | Reads `process.env` |
| `FileRouterPort` | Real impl | Pure logic, no fake |
| `PreprocessorPort` | Real impl + `FakePreprocessor` pass-through for orchestrator tests | — |

Fakes share the `// port-version: N` marker with real adapters; mismatch fails `tests/assert-fake-parity.test.ts`.

### CI gate order (`test_strategy.md:86-104`)

1. `pnpm lint` (incl. `no-restricted-imports` blocking `adapters/*` from `core/*`).
2. `pnpm typecheck` (strict TS).
3. `pnpm test:unit --coverage` (§3 thresholds).
4. `pnpm test:integration` (testcontainers postgres; provider fakes default; `CI_USE_LIVE_PROVIDERS=1` unlocks sandbox nightly).
5. `pnpm test:clinical` (fixture golden files).
6. `pnpm migrate:roundtrip` (up/down/up clean).
7. `pnpm openapi:lint` (spec valid + `supertest-openapi` response validation).
8. `pnpm security:scan` (secret scanner + dep audit).
9. `pnpm test:e2e:smoke` (Playwright happy + reject).

No `--skip-tests`, no `--no-verify`.

### Non-functional targets (`test_strategy.md:133-138`)

| Target | Test |
|---|---|
| P50 `/ingest` < 1 s | k6 in `tests/perf/ingest.k6.ts`, nightly |
| P95 end-to-end < 90 s | Integration over 50 fixtures, p95 asserted |
| Kill-switch RTO < 5 min | `tests/integration/kill_switch.test.ts` |
| Cost ≤ ₹0.40/doc | `tests/clinical/cost_budget.test.ts` |

### Environments (`test_strategy.md:141-147`)

- **Local** — Vitest + testcontainers + fakes; no network.
- **CI sandbox** — GitHub runner + testcontainers + provider fakes (default). Nightly `live-providers` job uses Datalab + Anthropic sandbox keys.
- **Staging** — `dis-staging` Supabase project + real providers. Clinical acceptance runs here before each rollout stage bump.

## Clinical acceptance tests

Reference: `05_testing/clinical_acceptance.md`. Scope: "the human-in-the-loop layer" — the layer that verifies clinical correctness on realistic documents, not mechanics.

### CS-1..CS-12 → test mapping (`test_strategy.md:112-125`)

| CS | Short requirement | Test file | Test name |
|---|---|---|---|
| CS-1 | No unverified row in clinical tables | `tests/integration/promotion.cs1.test.ts` | `rejects promotion of pending_review extraction with 409` |
| CS-2 | Raw responses preserved forever | `tests/integration/audit_retention.cs2.test.ts` | `raw_ocr_response and raw_structured_response survive 6-month simulated clock` |
| CS-3 | Every clinical row → one extraction (FK) | `tests/integration/schema.cs3.test.ts` | `cannot delete extraction while lab_results references it` |
| CS-4 | Verified values not silently overwritten | `tests/integration/duplicate.cs4.test.ts` | `re-ingest same hash yields 2 extractions, 0 clinical mutations` |
| CS-5 | Reject is permanent | `tests/integration/state_machine.cs5.test.ts` | `approve on rejected extraction returns INVALID_STATE_TRANSITION` |
| CS-6 | Edits logged field-by-field | `tests/unit/audit-log.cs6.test.ts` | `two edited fields produce two field_edit audit rows with before/after` |
| CS-7 | Confidence gates explicit + default off | `tests/unit/confidence-policy.cs7.test.ts` | `default policy marks every extraction pending_review; enabling requires audit row` |
| CS-8 | PII stays within patient boundary | `tests/integration/rls.cs8.test.ts` | `nurse scoped to patient A reads zero rows for patient B` |
| CS-9 | Test-name normalization audited | `tests/unit/structuring.cs9.test.ts` | `raw test_name_raw preserved separately from test_name_normalized in raw_structured_response` |
| CS-10 | Discharge summary latest-only | `tests/unit/promotion.cs10.test.ts` | `7 TSB readings → 1 lab_results row with latest test_date` |
| CS-11 | Duplicate-row prevention | `tests/integration/promotion.cs11.test.ts` | `second promotion of same extraction inserts 0 rows, logs skip per row` |
| CS-12 | No OCR data reaches Rx generator unverified | `tests/integration/rx_filter.cs12.test.ts` | `get_lab_history returns 0 rows when only ai_extracted pending_review exists` |

Every such test must carry a `// CS-##` banner for grep audits.

### Fixture set (v1 minimum, `clinical_acceptance.md:17-38`)

Minimum 20 anonymized real documents. Stored in `dis/tests/fixtures/clinical/` per `fixtures.md`.

| # | Category | Document type | Challenge | Source |
|---|---|---|---|---|
| 1 | lab_report | CBC native PDF | baseline clean | local lab |
| 2 | lab_report | CBC scan, slight skew | deskew + OCR | real 5° tilt |
| 3 | lab_report | LFT, multi-column table | table extraction | real |
| 4 | lab_report | RFT Hindi header | multilingual OCR | real |
| 5 | lab_report | Handwritten lab slip | low-confidence | real |
| 6 | discharge_summary | Neonatal, 7 TSB readings | **CS-10 latest-only** | synthetic |
| 7 | discharge_summary | Adult, meds + diagnoses | medication extraction | anonymized |
| 8 | discharge_summary | Scan + smudge | adversarial red-team | synthetic |
| 9 | prescription | Typed with brand names | drug normalization | real |
| 10 | prescription | Handwritten English doctor scrawl | adversarial; likely reject | real |
| 11 | prescription | Handwritten Hindi Devanagari | adversarial multilingual | real |
| 12 | vaccination_card | IAP card, 8 doses | date extraction | real |
| 13 | vaccination_card | UIP card partial fill | missing fields | real |
| 14 | radiology | X-ray report native PDF | imaging findings | real |
| 15 | radiology | USG report scan | scan path | real |
| 16 | other | Diet chart | category handling | synthetic |
| 17 | adversarial | Wrong-patient report (name mismatch) | red-team | synthetic |
| 18 | adversarial | Mixed-patient (2 patients, 1 scan) | red-team | synthetic |
| 19 | adversarial | Blank + 1 readable | preprocessor drop | real |
| 20 | adversarial | All-blank upload | graceful failure | synthetic |

### Red-team adversarial assertions (`clinical_acceptance.md:152-167`)

- **F17 wrong-patient** — UI surfaces `patient_mismatch_suspected` warning via fuzzy-name check; canonical nurse action is reject with reason `wrong_patient`; test asserts no clinical rows written.
- **F18 mixed-patient** — No auto-split (non-goal); canonical action is reject with note.
- **F19 blank + 1 readable** — Preprocessor drops blank page, proceeds with 1. `dropped.blank=1` recorded. Labs extracted correctly.
- **F20 all-blank** — status `failed`, `error_code='ALL_PAGES_BLANK'`. Nurse sees suggested action "re-scan". No rows written anywhere.

### Golden-file pattern (`clinical_acceptance.md:46-71`)

Per fixture `F.pdf`:

```
tests/fixtures/clinical/F/
├── source/F.pdf
├── expected/raw_ocr_markdown.md        # lax diff
├── expected/structured.json            # THE golden (ClinicalExtraction v1)
├── expected/promotion.json             # {labs_inserted, labs_skipped, ...}
└── expected/ui_flags.json              # {confidence_badges, warnings}
```

- `structured.json` is the correct answer, not the model's output.
- Tolerances: `confidence ±0.05`; `test_name_raw` case-normalized; whitespace collapsed.
- Golden update requires PR labelled `golden-update`, clinical reviewer approval, and diff summary via `pnpm test:clinical --update-summary`.

### Test scenarios per fixture (`clinical_acceptance.md:72-87`)

1. Ingest via HTTP API.
2. Deep-equal `structured` to `expected/structured.json` (with tolerances).
3. Nurse approval simulated in **two modes**:
   - `approve_as_is` — expect promotion summary = golden.
   - `approve_with_canonical_edits` — apply `expected/canonical_edits.json` (if present); expect edits to land in `lab_results`.
4. Red-team fixtures → Playwright UI assertion of warning banner + reject path.

### Weekly clinician audit (`clinical_acceptance.md:89-113`)

- Every Monday, stratified sample of 10 extractions from previous week in `{verified, auto_approved, promoted}`: 5 lab reports, 3 discharge summaries, 1 prescription, 1 vaccination card.
- Each scored `CORRECT | MINOR_ERROR | MAJOR_ERROR`.
- Results → `dis_weekly_audit` table (migration TBD — see gap #4 in Data gaps).

**Pass criteria (rolling 4-week):**
- ≥ 95% `CORRECT`.
- 0 `MAJOR_ERROR` before default rollout; ≤ 1 per 100 in steady state.
- Any `MAJOR_ERROR` → P1 ticket. If it changed a doctor's decision → fire `09_runbooks/` incident runbook.

**Escalation:** Two `MAJOR_ERROR` in one week → automatic pause on rollout advancement.

### Operational metric SLAs (`clinical_acceptance.md:117-125`)

| Metric | Green | Yellow | Red |
|---|---|---|---|
| Edit rate (extractions with any edit / verified) | < 30% | 30–50% | > 50% |
| Reject rate (rejected / terminal) | < 10% | 10–20% | > 20% |
| Verified-but-wrong (audit MAJOR_ERROR / audited) | 0% | < 1% | > 1% |
| Time-to-verification P95 (`verified_at - created_at`) | < 4 h | 4–8 h | > 8 h |
| Queue depth max (`pending_review`) | < 20 | 20–50 | > 50 |

Dashboards query `ocr_extractions`, `ocr_audit_log`, `dis_cost_ledger` via `09_runbooks/metrics_queries.sql`.

### Sign-off (`clinical_acceptance.md:131-149`)

- **Responsible:** QA Lead (fixtures, runs suite).
- **Accountable:** Clinical Reviewer (signs off each fixture set + weekly audit).
- **Consulted:** Tech Lead.
- **Informed:** PM, Ops.

Rollout advancement unlocked only when: all fixtures pass; weekly audit passes; no open P1 clinical-safety ticket. Artifact: PR titled `clinical-acceptance: week YYYY-Www signed off`.

### Regression guard (`clinical_acceptance.md:170-177`)

Before any structuring-prompt change or adapter swap: full fixture suite runs; any green→red flip without a `golden-update` PR is a hard block. Benchmark report `{fixture, pre, post, delta, clinical impact}` attached to the change PR.

## Verify format

Reference: `05_testing/verify_format.md`. The DoD Gate-7 artefact.

### Purpose (`verify_format.md:9-18`)

- TDD proves code matches tests; **Verify proves the ticket matches its acceptance criteria** with evidence the reviewer can re-run.
- Verify ≠ "tests pass". A ticket can have green tests and still fail Verify.

### Report shape (`verify_format.md:20-52`)

Per ticket, in the same `dis/handoffs/DIS-###.md` as the session handoff:

```markdown
## Verify Report

### AC-1: <verbatim acceptance criterion text>

**Given** <starting state>
**When** <action>
**Then** <expected observable outcome>

**How verified:**
- Command: `<exact shell command>`
- Expected output: `<literal or regex>`
- Actual output:
<paste of actual output>
- Artifact: `<path/to/log or commit SHA>`

**Status:** PASS | FAIL | N/A (explain)
```

Every AC gets one block. No criterion may be missing. PASS requires all three of Command, Expected, Actual filled in.

### What counts as evidence (`verify_format.md:58-72`)

- Shell command re-runnable by reviewer (include `cd dis/ && npm test …`).
- Vitest test names with paths (`health.test.ts:42`).
- Commit SHA.
- Structured log excerpts with correlation IDs.
- Schema: `psql -c "\d+ table_name"` / migration up/down transcripts.
- HTTP: `curl -i …` with headers + body pasted.
- Types: `npx tsc --noEmit` output (empty = pass).
- Lint: `npm run lint`.
- Screenshots for UI tickets under `dis/handoffs/assets/DIS-###/…`.

### What does NOT count (`verify_format.md:74-83`)

- "Looks correct to me."
- "Code matches the spec."
- Paraphrased test output.
- "See the diff."
- Tests that exist but were not run.
- Tests run with `.skip` or `.only`.

### Rules

- **Given/When/Then rigor** — Given reproducible; When a single atomic action; Then observable (`verify_format.md:87-105`).
- **N/A** must include a one-sentence explanation (`verify_format.md:109-112`).
- **Doc-only tickets** still need Verify — evidence is `ls path`, link-fetch, `grep "^## Section"` (`verify_format.md:114-122`).
- **Clinical-safety tickets** (CS-1..CS-12) need an extra "Clinical evidence" row (fixture, clinician assertion, commit hash) plus `CLINICAL APPROVED` by the clinical reviewer in the PR thread (`verify_format.md:124-135`).
- **Integration-tagged tickets** (`07_tickets/integration_hold.md`) run Verify in staging, not prod. Each block must declare `**Environment:** STAGING` (`verify_format.md:137-146`).

### Workflow (`verify_format.md:148-155`)

1. Agent implements.
2. Agent writes Verify **by actually running each command**.
3. Agent commits Verify as part of final commit.
4. Reviewer re-runs a sample — any discrepancy = Gate 5 failure.

### Enforcement (`verify_format.md:192-198`)

- PR template checkbox: "Verify report reviewed: YES/NO".
- Gate 7 DoD adds `[ ] Verify report present, all ACs PASS/N/A with evidence pasted.`
- Reviewer re-runs ≥ 20% of commands; 100% for clinical-safety and integration tickets.
- Retrofit: pre-Verify tickets get `docs(DIS-###): retroactive Verify report` commit.

### Minimal good example (`verify_format.md:157-179`)

```markdown
### AC-1: `dis/package.json` declares "type": "module"
**Given** Fresh clone, branch `feat/dis-001-scaffold`, at repo root.
**When** `cat dis/package.json | grep '"type"'`.
**Then** output contains `"type": "module"`.
- Command: `cat dis/package.json | grep '"type"'`
- Expected output: `  "type": "module",`
- Actual output:
    "type": "module",
- Artifact: commit 4cabf87
**Status:** PASS
```

## Fixtures

Reference: `05_testing/fixtures.md`. Binding. PHI-sensitive.

### Location (`fixtures.md:11-50`)

```
dis/tests/fixtures/
├── preproc/          # preprocessor unit tests
│   ├── tilt_5deg.jpg, perspective.jpg, blank.png
│   ├── dup_a.jpg, dup_b.jpg  (near-duplicate pair)
├── routing/          # file-router unit tests
│   ├── native_text.pdf, scan.pdf, image.jpg, office.docx, office.xlsx
├── ocr/              # recorded OCR responses
│   └── datalab_recorded/<fixture_id>/{request.json, response.json, meta.json}
├── structuring/      # recorded structuring responses
│   └── haiku_recorded/<fixture_id>/{prompt.md, response.json, meta.json}
└── clinical/         # clinical acceptance suite
    └── <fixture_id>/
        ├── source/<file>
        ├── expected/{structured.json, promotion.json, ui_flags.json, canonical_edits.json?}
        └── fixture.meta.yaml
```

Tests use `FIXTURES_DIR = tests/fixtures` — ad-hoc paths blocked by lint rule.

### Naming (`fixtures.md:52-60`)

- Kebab-case, descriptive, **no PHI** — e.g., `lab-cbc-native-pdf-01`.
- Globally unique in `clinical/`. Numeric `-NN` suffix for variants.
- Never encode patient initials, DOB, UHIDs, or hospital names in filenames.

### Metadata (`fixtures.md:62-82`)

Every clinical fixture has `fixture.meta.yaml`:

```yaml
id: lab-cbc-native-pdf-01
category: lab_report
source: internal_anonymized | synthetic | vendor_sample
original_language: en
challenge_tags: [native_text, table_extraction]
cs_coverage: []                # CS-## relevance
added_by: qa@radhakishanhospital
added_at: 2026-04-20
anonymization:
  method: manual_pdf_redaction | synthetic_generation | overlay
  verified_by: clinical_reviewer@...
  verified_at: 2026-04-20
notes: |
  Free text describing redactions.
```

`scripts/validate-fixture-meta.ts` lints every meta; missing/invalid = build fail.

### Anonymization (`fixtures.md:89-104`)

- Patient name → `TEST PATIENT NN` or redacted.
- Guardian → redacted.
- DOB → shifted, year within ±2 of original.
- UHID/MR → `TEST-UHID-####`.
- Phone, email, address → redacted.
- Doctor signature → redacted or `TEST DOCTOR`.
- Barcode/QR → re-encoded safely or blurred.
- Hospital name/logo → `TEST HOSPITAL` watermark.
- **Clinical values (Hb, WBC, drugs, doses) preserved verbatim** — that is the signal.

Every redaction is pair-reviewed (QA runs, clinical reviewer audits + signs `anonymization.verified_by`).

### Storage + PHI guard (`fixtures.md:115-125`)

- Repo-hosted (private repo).
- Pre-commit hook `scripts/fixtures-guard.sh` OCRs new fixtures and blocks commit on hits for: common Indian name prefixes, 10-digit mobile regex, 12-digit Aadhaar regex, production UHID prefix.
- PHI leak detected in `main` → `09_runbooks/phi_exposure.md` fires.
- **Never copy directly from `documents` bucket.** Export → redact on clean workstation → verify → commit.

### Add procedure (`fixtures.md:132-148`)

1. Open ticket `fixture: add <id>` in `07_tickets/` with category, challenge, CS-## relevance, source.
2. Place redacted file under `source/<file>`.
3. Write `fixture.meta.yaml`.
4. Run suite with `--capture-goldens` to generate `expected/structured.json`.
5. **Manually review every value** — the golden is the correct answer, not the model's answer.
6. Add `expected/promotion.json` and `expected/ui_flags.json`.
7. PR labelled `fixture-add`; clinical reviewer approval required.

### Update procedure (`fixtures.md:150-162`)

Allowed reasons: schema version bump; model migration (with clinical approval); bug fix in a golden. PR labelled `golden-update`; table of diffs in description; clinical reviewer `APPROVED` comment.

### Golden helper (`fixtures.md:167-177`)

```ts
// dis/tests/helpers/golden.ts
export async function assertGolden(id: string, actual: ClinicalExtraction): Promise<void> {
  const expected = await readGolden(id);
  const normalised = normalise(actual);
  expect(normalised).toStrictEqualWithTolerance(expected, {
    numericTolerance: { 'labs.*.confidence': 0.05 },
    ignorePaths: ['provider_version'],
  });
}
```

Rules: goldens are the correct answer (not the model's); diffs print by field-path; failing golden halts CI; fix is `update code | file bug | open golden-update PR` — never silently update.

### Lifecycle (`fixtures.md:189-196`)

- `active` — referenced by ≥ 1 test.
- `retired` — archived under `tests/fixtures/_retired/<id>/` with meta note.
- `quarantined` — under review (PHI leak suspicion); test is `test.skip(..., 'quarantined')`; CI ratchet tracks count (can decrease, not increase).

### Minimum coverage floor (`fixtures.md:200-208`)

At all times: 5 lab reports (2 native PDF, 2 scans, 1 handwritten); 3 discharge summaries (1 neonatal CS-10, 1 adult, 1 adversarial); 2 prescriptions (1 typed, 1 handwritten); 2 vaccination cards (1 IAP, 1 UIP); 2 radiology reports; 4 adversarial. Enforced by `scripts/fixtures-coverage.ts`.

### Synthetic generation (`fixtures.md:211-220`)

For scenarios hard to source (e.g., CS-10 7-reading TSB), synthetic PDFs via LaTeX/HTML in `tests/fixtures/_generators/`. Each generator: deterministic by seed; source committed alongside fixture; `source: synthetic` in meta; clinical approval of plausibility still required.

## Unit tests

Reference: `05_testing/unit_tests.md`. Pure `dis/src/core/`, fakes only, < 5 s total.

File layout (`unit_tests.md:11-21`):

```
dis/tests/unit/
├── orchestrator.test.ts
├── state-machine.test.ts
├── confidence-policy.test.ts
├── promotion.test.ts
├── audit-log.test.ts
├── file-router.test.ts
├── preprocessor.test.ts
└── structuring.test.ts       # covers CS-9
```

### orchestrator.test.ts (`unit_tests.md:25-39`, TDD §4 + §5)

Purpose: `IngestionOrchestrator` glues ports together and drives `ocr_extractions.status` transitions. All ports injected as fakes.

| # | Test name | Ref |
|---|---|---|
| 1 | `creates extraction in status=uploaded on fresh Idempotency-Key` | TDD §5 |
| 2 | `returns existing extraction on duplicate Idempotency-Key with identical payload` | TDD §5 |
| 3 | `returns IDEMPOTENCY_KEY_CONFLICT when same key is reused with a different payload hash` | error_model |
| 4 | `routes native_text path: uploaded → structuring → ready_for_review` | TDD §7 |
| 5 | `routes ocr_scan path: uploaded → preprocessing → ocr → structuring → ready_for_review` | TDD §7, §8 |
| 6 | `records latencyMs and cost_micro_inr on every port call into dis_cost_ledger fake` | TDD §14 |
| 7 | `surfaces OCR_PROVIDER_UNAVAILABLE and parks extraction in status=failed with retryable=true` | error_model |
| 8 | `does not transition to ready_for_review until structuring returns schema-valid JSON` | TDD §11 |
| 9 | `respects DIS_KILL_SWITCH=1 by returning 503 UNAVAILABLE before any port call` | DIS-US-032 |
| 10 | `correlation_id is stable across all port calls within one ingestion` | TDD §14 |

### state-machine.test.ts (`unit_tests.md:42-54`, TDD §4)

Pure transition table. No ports.

| # | Test | Ref |
|---|---|---|
| 1 | `uploaded → preprocessing is valid` | TDD §4 |
| 2 | `uploaded → ocr is invalid (must go through preprocessing)` | TDD §4 |
| 3 | `ready_for_review → verified is valid` | DIS-US-012 |
| 4 | `ready_for_review → rejected is valid` | DIS-US-014 |
| 5 | `rejected → verified throws InvalidStateTransition` | CS-5 |
| 6 | `promoted → rejected throws InvalidStateTransition` | CS-5 |
| 7 | `failed → uploaded is invalid (retry creates new extraction, not reset)` | DIS-US-003 |
| 8 | `every transition emits an event payload {from, to, actor, at}` | CS-6 |
| 9 | `auto_approved is reachable only when confidence policy enabled=true` | CS-7 |
| 10 | `terminal states (verified, rejected, promoted, failed) have no outbound edges except audit reads` | CS-5 |

### confidence-policy.test.ts (`unit_tests.md:56-69`, CS-7, TDD §12)

Policy evaluator. Policy JSON inline.

| # | Test | Ref |
|---|---|---|
| 1 | `default policy (enabled=false) returns {auto_approve:false} for every extraction` | CS-7 |
| 2 | `enabled=true policy with labs.auto_approve_if=confidence>=0.95 approves a 0.97 labs-only extraction` | TDD §12 |
| 3 | `mixed extraction (labs 0.97, medications 0.8) returns auto_approve:false because medications rule is false` | TDD §12 |
| 4 | `rule referencing unknown field_path raises PolicyEvaluationError (never silently approves)` | CS-7 |
| 5 | `policy change without actor_id is rejected` | CS-7 |
| 6 | `evaluator returns per-field rule_results for audit storage in policy_decision column` | CS-7 |
| 7 | `activating a new policy deactivates the previous one (single-active invariant)` | data_model |
| 8 | `block_type guard: labs rule requires block_type='table'; non-table input → not auto-approved` | TDD §12 |
| 9 | `enabled policy with empty rules array → auto_approve:false` | CS-7 |
| 10 | `policy evaluator is pure (same input → same decision object, deep-equal)` | TDD §1 |

### promotion.test.ts (`unit_tests.md:71-85`, CS-10 + CS-11 + TDD §13)

`PromotionService` with in-memory fake database.

| # | Test | Ref |
|---|---|---|
| 1 | `CS-10: discharge_summary with 7 TSB readings across 7 dates → 1 row with max(test_date)` | CS-10 |
| 2 | `CS-10: dedupe is by test_name_normalized, not test_name_raw` | CS-9, CS-10 |
| 3 | `CS-10: lab_report (not discharge_summary) does NOT dedupe — all rows promoted` | CS-10 |
| 4 | `CS-11: second run of same extraction inserts 0 rows, audit log shows one skip per prior row` | CS-11 |
| 5 | `CS-11: duplicate check key is (patient_id, test_name, test_date, value_numeric)` | CS-11 |
| 6 | `CS-11: two different values for same (patient,test,date) both insert (not considered duplicate)` | CS-11 |
| 7 | `promotion runs in a single transaction — one invalid row fails all` | TDD §13 |
| 8 | `on transaction failure, extraction returns to ready_for_review with error_code=PROMOTION_FAILED` | TDD §13 |
| 9 | `promotion_result JSON records {labs_inserted, labs_skipped, vax_inserted, vax_skipped}` | DIS-US-012 |
| 10 | `rejected extraction cannot be promoted (guard before transaction even starts)` | CS-5 |
| 11 | `promotion sets lab_results.ocr_extraction_id and verification_status='verified'` | CS-1, CS-3 |

### audit-log.test.ts (`unit_tests.md:87-100`, CS-6 + TDD §14)

`AuditLogger` and its append-only invariant.

| # | Test | Ref |
|---|---|---|
| 1 | `append-only: insert succeeds, update throws (simulated trigger from fake DB)` | CS-6 |
| 2 | `append-only: delete throws` | CS-6 |
| 3 | `state_transition event writes {from_state, to_state, actor}` | TDD §4 |
| 4 | `field_edit event: editing {labs[0].value_numeric: 11 → 11.2} writes one row with before/after JSON` | CS-6 |
| 5 | `field_edit: editing two fields writes exactly two rows in the same transaction` | CS-6 |
| 6 | `approve event is preceded by N field_edit events where N = count of edits` | CS-6 |
| 7 | `reject event requires reason_code; missing code throws` | DIS-US-014 |
| 8 | `override event is written when approve has override_duplicates=true` | DIS-US-015 |
| 9 | `correlation_id on the audit row matches the correlation_id on the extraction` | TDD §14 |
| 10 | `actor_type='system' is used for auto_approved and promotion-time skips` | CS-7, CS-11 |

### file-router.test.ts (`unit_tests.md:102-115`, TDD §7)

Pure decision-tree tests. Input `{filename, contentType, sampleBytes}`.

| # | Test | Ref |
|---|---|---|
| 1 | `pdf with embedded text ≥ 100 chars/page avg → routing_path=native_text` | TDD §7 |
| 2 | `pdf with ink but < 100 chars/page avg → routing_path=ocr_scan` | TDD §7 |
| 3 | `jpeg → routing_path=ocr_image` | TDD §7 |
| 4 | `heic → routing_path=ocr_image (normalization happens in preprocessor, not router)` | TDD §8 |
| 5 | `docx → routing_path=office_word` | TDD §7 |
| 6 | `xlsx → routing_path=office_sheet` | TDD §7 |
| 7 | `csv → routing_path=office_sheet` | TDD §7 |
| 8 | `zip → throws UnsupportedMediaType (415)` | non_goals §6 |
| 9 | `dcm → throws UnsupportedMediaType` | non_goals §6 |
| 10 | `extension allowlist bypass attempt: file named .pdf but MIME=application/zip → 415` | TDD §16 |
| 11 | `threshold configurable via env DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE=250` | TDD §7 |

### preprocessor.test.ts (`unit_tests.md:117-133`, TDD §8)

Each step tested independently against synthetic fixtures in `tests/fixtures/preproc/`.

| # | Test | Ref |
|---|---|---|
| 1 | `heic → jpeg conversion preserves pixel count ±1%` | TDD §8.1 |
| 2 | `multi-frame tiff → N jpeg buffers, one per frame` | TDD §8.1 |
| 3 | `deskew: 5° tilted fixture rotates to within ±1°` | TDD §8.2 |
| 4 | `perspective correction: four-corner fixture warps to a rectangle; aspect ratio preserved` | TDD §8.3 |
| 5 | `blank-page detection: all-white page dropped; dropped count recorded` | TDD §8.4 |
| 6 | `duplicate-page detection: pHash distance ≤ 5 → second page dropped` | TDD §8.5 |
| 7 | `resize cap: 4000×3000 input → max 1920 longest side, aspect preserved` | TDD §8.6 |
| 8 | `CLAHE contrast enhancement: low-contrast fixture histogram widens by ≥ 20%` | TDD §8.7 |
| 9 | `jpeg encode quality=85; output file size ≤ 70% of 95-quality baseline` | TDD §8.8 |
| 10 | `page-count cap: 51-page input → rejects with PAYLOAD_TOO_LARGE before OCR call` | TDD §8.9 |
| 11 | `emits PreprocessedDocument with dropped={blank:N, duplicate:M} + original_page_count` | TDD §8 |

### structuring.test.ts (`unit_tests.md:135-148`, CS-9, TDD §10–§11)

Structuring adapter seam and schema validation.

| # | Test | Ref |
|---|---|---|
| 1 | `valid Haiku response parses into ClinicalExtraction and passes JSON Schema v1` | TDD §11 |
| 2 | `missing required document_type → STRUCTURING_SCHEMA_INVALID` | TDD §11 |
| 3 | `CS-9: test_name_raw "Hb" + test_name_normalized "Hemoglobin" both stored in raw_structured_response` | CS-9 |
| 4 | `CS-9: verified_structured edit to normalized name does NOT mutate raw_structured_response` | CS-9, CS-2 |
| 5 | `confidence field outside [0,1] → validation error with field_path=labs[0].confidence` | TDD §11 |
| 6 | `schema_version stored on the extraction matches the schema file used` | TDD §11 |
| 7 | `retry-on-invalid: first response invalid, second valid → extraction reaches ready_for_review; both raw responses recorded` | TDD §10 |
| 8 | `after 3 invalid responses → status=failed, error_code=STRUCTURING_SCHEMA_INVALID` | error_model |
| 9 | `providerVersion is recorded on the extraction row` | TDD §10 |
| 10 | `structuring prompt version id is stamped on every call (audit)` | TDD §10 |

### Conventions (`unit_tests.md:152-160`)

- Full-English sentence test names, present tense.
- Every file starts with `// CS-## | DIS-US-### | TDD §X` banner.
- No `it.skip`, no `test.only` on main.
- `toStrictEqual` only (never `toEqual`).
- Fakes from `dis/src/adapters/*/__fakes__/`.

## Integration tests

Reference: `05_testing/integration_tests.md`. Harness under `dis/tests/integration/` with `testcontainers-postgres`, `migrate.ts` running `03_data/migrations.md` SQL, `seed-patient.ts`, `http-client.ts` (supertest). Tests start from migrated + seeded DB; transaction rollback where possible, else TRUNCATE cascade.

### Scenarios

| Test | Spec refs | Covers |
|---|---|---|
| `happy_path_pdf.test.ts` | DIS-US-001, 011, 012; CS-1, CS-3 | Upload → poll → approve → `lab_results.ocr_extraction_id=X`, `verification_status='verified'`; status `promoted`; audit log has state transitions + approve event |
| `reject_path.test.ts` | DIS-US-014; CS-5 | Reject with `reason_code=illegible`; zero clinical rows; subsequent approve → 409 `INVALID_STATE_TRANSITION`; audit `reject` event |
| `duplicate_document.test.ts` | DIS-US-015; CS-4, CS-11 | Same hash → 2 extractions; X2 body has `warnings[]` with `{code:'DUPLICATE_DOCUMENT', prior_extraction_id: X1}`; approve without override → 409; with override → 200 but row count unchanged (CS-11 row guard even after doc-level override); `override` audit |
| `discharge_latest_only.test.ts` | CS-10 | 7 TSB readings → 1 row with `max(test_date)`; summary `labs_inserted=1, labs_skipped=6`; 6 system-actor skip audit entries with reason `discharge_latest_only_dedupe` |
| `idempotency.test.ts` | TDD §5 | Same key + body → same extraction_id; same key + different body → 409; only one row; approve idempotent by key |
| `version_conflict.test.ts` | TDD §6 | Client A approve `v=1` → v=2; Client B approve `v=1` → 409 `VERSION_CONFLICT` with current version in details |
| `kill_switch.test.ts` | DIS-US-032 | `DIS_KILL_SWITCH=1` → 503 `UNAVAILABLE`; optional `DIS_KILL_SWITCH_ROUTE_TO_LEGACY=1` → 307 to legacy; `kill_switch` audit event |
| `provider_outage.test.ts` 8.a | error_model, risk table | Fake OCR 503 every call → extraction eventually `failed`, `error_code='OCR_PROVIDER_UNAVAILABLE'`, `retryable=true`; retry creates new extraction, preserves original |
| `provider_outage.test.ts` 8.b | — | Structuring JSON drift: 2 invalid, 1 valid → ready_for_review; all 3 responses logged; `dis_cost_ledger` has 3 structuring ops |
| `confidence_default_off.test.ts` | CS-7 | Default policy → never `auto_approved`; enabling requires audit row; after enable, same fixture → `auto_approved` + `verification_status='auto_approved'`, `verified_by='system'`; deactivate → back to pending_review |
| `rls_patient_isolation.test.ts` | CS-8 | Session `app.role='nurse'`, `app.patient_id='P1'` → cannot see P2 rows; admin sees both; nurse insert into `ocr_extractions` fails (service-only policy) |

### Scenario details

#### 1. `happy_path_pdf.test.ts` — DIS-US-001, 011, 012, CS-1, CS-3 (`integration_tests.md:38-56`)

Upload → review → approve → `lab_results` present.

1. `POST /uploads/signed-url` with lab-report PDF → 200, `storage_key` returned.
2. `PUT` bytes of `tests/fixtures/lab_reports/cbc_native_pdf.pdf` to signed URL.
3. `POST /ingest` with `Idempotency-Key=K1` → 201, `extraction_id=X`, `status ∈ {uploaded, preprocessing, structuring}`.
4. Poll `GET /extractions/X` until `status=ready_for_review` (60 s timeout).
5. Assert `raw_ocr_response`, `raw_structured_response`, `structured.labs.length > 0` all present.
6. `POST /extractions/X/approve` with `version=1` → 200, `PromotionSummary.labs_inserted ≥ 1`.
7. Direct `lab_results` query: every inserted row has `ocr_extraction_id=X`, `verification_status='verified'`, `verified_by` non-null.
8. `ocr_extractions.status='promoted'`, `promoted_at` set, `version=2`.
9. `ocr_audit_log` contains ≥ 1 `state_transition` to `verified`, 1 `approve` event, N `state_transition` events matching the path.

#### 2. `reject_path.test.ts` — DIS-US-014, CS-5 (`integration_tests.md:60-68`)

1. Ingest to `ready_for_review`.
2. `POST /extractions/X/reject` with `reason_code=illegible`, `version=1` → 200.
3. `ocr_extractions.status='rejected'`, `rejected_reason_code='illegible'`.
4. Zero `lab_results` rows linked to X.
5. Subsequent approve → 409 `INVALID_STATE_TRANSITION`.
6. `ocr_audit_log` has `reject` event with `actor_id` and `reason_code`.

#### 3. `duplicate_document.test.ts` — DIS-US-015, CS-4, CS-11 (`integration_tests.md:72-82`)

1. Ingest fixture F1 → verify → promote; capture `lab_results` row count = C1.
2. Ingest same bytes (same `source_content_hash`) with new `Idempotency-Key=K2`.
3. Extraction X2 created; `GET /extractions/X2` body carries `warnings[]` with `{code:'DUPLICATE_DOCUMENT', prior_extraction_id: X1}`.
4. Approve X2 without `override_duplicates` → 409 `DUPLICATE_DOCUMENT`.
5. Approve X2 with `override_duplicates=true` → 200.
6. `lab_results` row count is still C1 — CS-11 row-level guard prevails even when doc-level override is set.
7. `ocr_audit_log` shows `override` event on X2.

#### 4. `discharge_latest_only.test.ts` — CS-10 (`integration_tests.md:86-94`)

1. Ingest `tests/fixtures/discharge_summaries/neonate_tsb_7_readings.pdf` with 7 TSB entries over 7 dates.
2. Approve with `version=1`, no edits.
3. Exactly **one** `lab_results` row for TSB for that patient.
4. Row's `test_date = max(dates)`; `value_numeric` matches latest-dated entry.
5. Promotion summary: `labs_inserted=1`, `labs_skipped=6`.
6. 6 `system`-actor skip audit entries with reason `discharge_latest_only_dedupe`.

#### 5. `idempotency.test.ts` — TDD §5 (`integration_tests.md:98-104`)

1. `POST /ingest` K + body B → 201, `extraction_id=X`.
2. Same K + identical B → 201, same `extraction_id=X`, no new row.
3. Same K + different body B' (different `storage_key`) → 409 `IDEMPOTENCY_KEY_CONFLICT`.
4. Only one row in `ocr_extractions` for K.
5. Approve replay with same key → second call returns same `PromotionSummary`; `lab_results` unchanged after replay.

#### 6. `version_conflict.test.ts` — TDD §6 (`integration_tests.md:108-113`)

1. Ingest to `ready_for_review`; `version=1`.
2. Client A approves `version=1` → 200; `version=2`.
3. Client B approves `version=1` (stale) → 409 `VERSION_CONFLICT`; details include current `version`.
4. No duplicate rows in `lab_results`.

#### 7. `kill_switch.test.ts` — DIS-US-032 (`integration_tests.md:117-123`)

1. Set `DIS_KILL_SWITCH=1`.
2. `POST /ingest` → 503 `UNAVAILABLE` with fallback-to-legacy body.
3. (Optional) with `DIS_KILL_SWITCH_ROUTE_TO_LEGACY=1` → server returns 307 to legacy path.
4. Unset var → `POST /ingest` → 201 normal.
5. Kill-switch activation logged to `ocr_audit_log` with `event_type='kill_switch'`.

#### 8. `provider_outage.test.ts` — error_model + risk table (`integration_tests.md:127-144`)

**8.a — Datalab outage → failed extraction**

1. Fake OCR adapter returns 503 every call.
2. `POST /ingest` → 201 (accepted; async pipeline).
3. Polling `GET /extractions/X` → eventually `status=failed`, `error_code='OCR_PROVIDER_UNAVAILABLE'`, `retryable=true`.
4. `POST /extractions/X/retry` → 201, creates new extraction X', preserving X for audit.

**8.b — Structuring JSON-drift recovery**

1. Fake structuring adapter: first 2 calls invalid, 3rd valid.
2. Extraction reaches `ready_for_review`.
3. `raw_structured_response` is either an array-like log with 3 entries OR a list under `structuring_attempts[]` (**drift — pick one**).
4. `dis_cost_ledger` shows 3 structuring operations.

#### 9. `confidence_default_off.test.ts` — CS-7 (`integration_tests.md:148-155`)

1. Seed `dis_confidence_policy` with factory default (`enabled=false`).
2. Ingest any fixture → reaches `ready_for_review`, never `auto_approved`, regardless of confidence.
3. Zero rows in `lab_results` at this point.
4. Activate policy (`enabled=true`, simple rule) via service-role call; audit row written.
5. Re-ingest same fixture → `auto_approved`; rows appear in `lab_results` with `verification_status='auto_approved'`, `verified_by='system'`.
6. Deactivate → next extraction again `pending_review`.

#### 10. `rls_patient_isolation.test.ts` — CS-8 (`integration_tests.md:158-166`)

1. Seed patients P1, P2; create extractions E1/P1, E2/P2.
2. Open DB session as `app.role='nurse'`, `app.patient_id='P1'`.
3. `SELECT * FROM ocr_extractions WHERE id=E2` → 0 rows.
4. `SELECT * FROM ocr_extractions WHERE id=E1` → 1 row.
5. Session as `app.role='admin'` sees both.
6. Nurse INSERT into `ocr_extractions` fails (only service may insert).

### Additional (shorter) scenarios (`integration_tests.md:172-179`)

- `office_word.test.ts` — docx routing + diagnoses.
- `office_sheet.test.ts` — xlsx routing + labs table.
- `large_file.test.ts` — 25 MB → 413 `PAYLOAD_TOO_LARGE` at signed-url stage.
- `page_cap.test.ts` — 60-page PDF rejected (TDD §8.9).
- `retry_audit.test.ts` — DIS-US-003, retry logs include operator ID + timestamp.
- `admin_metrics.test.ts` — service role returns queue depth + latency; anon token → 403.
- `rx_filter.cs12.test.ts` — CS-12 `get_lab_history` returns 0 rows when only `ai_extracted pending_review` rows exist.

### Execution matrix (`integration_tests.md:181-189`)

| Scenario | Real Datalab | Real Anthropic |
|---|---|---|
| All PR-time | No | No |
| Nightly `live-providers` | Yes (sandbox key) | Yes (sandbox key) |

Cost capped by CI budget check.

### Data hygiene (`integration_tests.md:192-196`)

- Every test creates `patient_id = 'TEST-<uuid>'` — no shared state.
- `tests/fixtures/` paths deterministic per `fixtures.md`.
- Serial within a file, parallel across files (Vitest default).

## Testing gaps / drift

1. **`dis_weekly_audit` table** referenced by clinician-audit workflow (`clinical_acceptance.md:103-104`) but has no corresponding row in `03_data/data_model.md` or migration entry. Gap: audit results currently have no persistent schema.
2. **`ALL_PAGES_BLANK` error code** appears in `clinical_acceptance.md:166` (fixture 20) but is not listed in `04_api/error_model.md`'s enumerated codes. Add to server error taxonomy.
3. **`patient_mismatch_suspected` warning code** required by F17 red-team assertion (`clinical_acceptance.md:158`) — not declared in openapi `Extraction.warnings` schema (in fact, `warnings` itself is undocumented — see API gap #3).
4. **`raw_structured_response` array-vs-object drift** — `integration_tests.md:143-144` says "`raw_structured_response` column is an array-like log … OR a list stored under `structuring_attempts[]`". Either shape is allowed, which means clients/tests cannot assert a stable schema. Pick one.
5. **CS-12 "no OCR data reaches Rx generator"** — integration test `rx_filter.cs12.test.ts` asserts the filter on `get_lab_history`, but there's no documented contract on the edge function side (this repo's `supabase/functions/generate-prescription` was not inspected in source folders); risk of drift between test expectation and real edge-function implementation. Worth a cross-reference in the test to the edge-function commit SHA.
6. **Retry test for `/extractions/{id}/retry`** (`integration_tests.md:177`) does not cover idempotency — retry endpoint has no `Idempotency-Key` in OpenAPI, but double-clicking the retry button could produce duplicate extractions.
7. **E2E layer is Playwright-based but no concrete test files enumerated** — `test_strategy.md:33` lists "Playwright against verification UI" as a layer but `05_testing/` contains no test-list. Red-team fixtures F17–F20 imply UI scripts exist; their file paths are not documented here.
8. **Coverage floor for `src/http/**` (80/70)** doesn't mention error-path coverage specifically. Error handlers are easy misses.
9. **Live-provider nightly job cost cap** mentioned (`integration_tests.md:188`) but the actual budget figure is not stated here (it is ₹0.40/doc per `test_strategy.md:137` but that is per-doc, not per-job aggregate).
10. **`PROMOTION_FAILED` return path** — `unit_tests.md:83` says "extraction returns to ready_for_review with error_code=PROMOTION_FAILED". But the state machine in `unit_tests.md` §2 doesn't list a `promoted → ready_for_review` (or any → ready_for_review) transition from a promotion failure. State machine may need a `promoting → ready_for_review` edge explicitly; current enum doesn't include `promoting` as a distinct status.

# COMMON SECTIONS

## Cross-references observed

- **From 03_data into 02_architecture.** `data_model.md:204-221` RLS is written "Supabase-style … generic so it ports", explicitly matching the port/adapter abstraction in `02_architecture/adapters.md`.
- **From 05_testing into 02_architecture.** `test_strategy.md:5, 15-16, 64` repeatedly cites `02_architecture/adapters.md §Fakes` and `§9 Fakes` as binding. Port-version markers enforced by `tests/assert-fake-parity.test.ts`.
- **From 05_testing into 07_tickets.** Every ticket has a `test_ticket` field per `test_strategy.md:52`. `07_tickets/integration_hold.md` governs staging-only Verify runs per `verify_format.md:137-146`. `07_tickets/` also hosts `fixture: add <id>` tickets per `fixtures.md:134`.
- **From 05_testing into 01_product.** CS-1..CS-12 map to `01_product/clinical_safety.md` (not inspected in this report); DIS-US-### map to `01_product/user_stories.md`. These are the load-bearing links that drive the CS table in `test_strategy.md §7`.
- **From 05_testing into 08_team.** RACI cited in `clinical_acceptance.md:7, 132` and `verify_format.md:133` for clinical reviewer sign-off.
- **From 05_testing into 06_rollout.** Rollout stage advancement gated by clinical acceptance per `test_strategy.md:145-147` and `clinical_acceptance.md:9`, pointing at `06_rollout/rollout_plan.md`.
- **From 05_testing into 09_runbooks.** `09_runbooks/metrics_queries.sql` (`clinical_acceptance.md:128`), `09_runbooks/phi_exposure.md` (`fixtures.md:125`), `09_runbooks/migration_incident.md` (`migrations.md:99`).
- **From 04_api into 03_data.** `error_model.md` error codes map 1:1 to the 10-value `status` enum on `ocr_extractions` and the `INVALID_STATE_TRANSITION` guard.

## Drift, gaps, contradictions (CRITICAL)

Ranked. Clinical safety > API contract > fixtures > cosmetic.

1. **CLINICAL SAFETY — `dis_weekly_audit` table missing**: the rolling clinician audit that gates rollout advancement has no persistent home defined in `03_data/data_model.md`. Until a migration creates it, the audit is ephemeral (paper / spreadsheet). Fix: open a ticket, write M-010.
2. **CLINICAL SAFETY — `ALL_PAGES_BLANK` error code not in error taxonomy**: adversarial fixture F20 asserts this code but `error_model.md` does not list it. A client with strict error-code parsing would fall into the `INTERNAL` bucket and alert, incorrectly.
3. **CLINICAL SAFETY — CS-12 filter contract not anchored**: the CS-12 test (`rx_filter.cs12.test.ts`) asserts the generate-prescription path filters out unverified rows, but the contract lives in the edge function code outside this review. Test pins a behaviour without a doc anchor.
4. **API CONTRACT — `warnings[]` on `GET /extractions/{id}`** is required by duplicate-document (`integration_tests.md:76`) and red-team fixture F17 (`patient_mismatch_suspected`) but is absent from `components.schemas.Extraction` in `openapi.yaml`. `pnpm openapi:lint` won't catch client drift.
5. **API CONTRACT — `DIS_KILL_SWITCH` 503 undeclared on `/ingest`**: integration test requires it; spec lists only 201, 409, 415.
6. **API CONTRACT — `Extraction.status` typed `string`** but the query filter on `/extractions` enumerates 10 values. Enum drift risk.
7. **API CONTRACT — `raw_structured_response` shape ambiguous**: integration test §8.b accepts either array-like log OR `structuring_attempts[]`. Pick one and pin in the schema.
8. **API CONTRACT — `/admin/metrics` has no response schema**.
9. **API CONTRACT — 404s (`PATIENT_NOT_FOUND`, `VISIT_NOT_FOUND`) undocumented per-path** despite being enumerated in `error_model.md`.
10. **DATA — `vaccinations` backfill rule not specified** in `data_model.md`; inferred but not authoritative.
11. **DATA — `dis_cost_ledger.operation` has no CHECK** constraint despite being an enumerated concept; drift risk for finance reporting.
12. **DATA — `ocr_extractions.source_content_hash` not UNIQUE by design** — worth an inline comment so reviewers don't "fix" it.
13. **TESTING — E2E Playwright files not enumerated** in `05_testing/`; only the layer is named.
14. **TESTING — `promoting` status missing** — `unit_tests.md:83` promotion-failure test implies a transient status the data-model enum doesn't declare.
15. **TESTING — retry endpoint idempotency untested** — double-click risk on `/extractions/{id}/retry`.
16. **COSMETIC — `error_model.md` status table** shows single labels for 409 while specific codes are the actual returns; reviewers may misread.
17. **COSMETIC — `uploader_id text` POC shortcut** acknowledged but not ticketed with the future M-### needed.

## Idempotency key handling — concrete rules

`/ingest`, `/approve`, `/reject` all require an `Idempotency-Key` uuid header. Server implementation notes derived from tests:

1. On first receipt, server persists `(key, body_hash)` alongside the response.
2. On second receipt with same `(key, body_hash)` pair, server returns the original response (same HTTP status, same body).
3. On second receipt with same key but different `body_hash`, server returns 409 `IDEMPOTENCY_KEY_CONFLICT`.
4. Approve replay is safe: second call returns the same `PromotionSummary`; `lab_results` rows unchanged (idempotent at the DB level via `uniq_lab_dedupe` + `uniq_vax_dedupe` CS-11 indexes).
5. Reject replay: same shape.
6. Retry endpoint `/extractions/{id}/retry` has **no** idempotency header — gap identified above.
7. Keys are not expired in the POC; in prod, expiration policy TBD (gap — not documented in any of the three folders).

## Error-model mapping to `ocr_extractions.error_code`

When an extraction lands in `failed` status, `error_code` holds the same upper-snake string used in the API envelope. This gives forensic traceability: a client that received 502 with `OCR_PROVIDER_UNAVAILABLE` can later `GET /extractions/{id}` and see the same code on the row. Consistent vocabulary is a deliberate design choice (`error_model.md:54-59`).

## Raw-response contract

`ocr_extractions.raw_ocr_response` (full Chandra JSON) and `raw_structured_response` (full LLM response — possibly an array of attempts if retry-on-invalid fired) are CS-2 forever-retained. They are **intentionally not exposed** in the `Extraction` schema returned by `GET /extractions/{id}` — only the lightweight `raw_ocr_markdown` + `raw_ocr_blocks` convenience representations ship to the client. Rationale: full response payloads can run into megabytes; forensic access is via direct DB query with service role.

## Correlation ID propagation path

A single `correlation_id` (uuid) is stamped at the first orchestrator call and propagated through:

1. `ocr_extractions.correlation_id` (not-null column — `data_model.md:54`).
2. Every `ocr_audit_log.correlation_id` row (`data_model.md:81`). Unit test `audit-log.test.ts` #9 asserts parity.
3. Every `dis_cost_ledger.correlation_id` entry (`data_model.md:149`).
4. Every server log line (`error_model.md:73`).
5. Every error envelope (`error_model.md:16`).

Unit test `orchestrator.test.ts` #10 (`unit_tests.md:39`) asserts the correlation_id is stable across all port calls within one ingestion.

## Request-ID vs correlation-ID

- **`request_id`** — per HTTP request, server-assigned, for log grep at the edge. Does not survive into the async pipeline.
- **`correlation_id`** — pipeline-wide, stamped at ingest, survives retries (each retry creates a new extraction and therefore a new correlation_id, per CS-2 preservation of originals — worth noting: retries **do not** reuse the parent's correlation_id, so cross-retry traces require joining on `extraction_id` chain).

## Migration CI gate specifics (`migrations.md:87-95`)

The "forward + backward test" deserves call-out: migrations are run up, then down, then up again, with `pg_dump --schema-only` compared at each stop. Any byte-level drift in schema shape (column order, default expressions, constraint names) fails the gate. Practical consequence: rollback scripts cannot be lazy — they must restore the schema literally.

## `SignedUrlRequest` / `IngestRequest` field cross-check

Both payloads carry `patient_id`, `visit_id`, `category`, `filename`, `content_type`. `IngestRequest` additionally takes `storage_key` (returned by the signed-URL step) and an optional `doc_date`. `SignedUrlRequest` carries `size_bytes` (capped at 20 971 520 bytes = 20 MB; enforced in spec and error_model 413 `PAYLOAD_TOO_LARGE`). The redundancy is intentional: the ingest step cannot trust size_bytes reported at URL-issuance time (client could upload more), so final size enforcement happens at storage-bucket policy level plus re-validation during preprocessing (page-count cap at 50 pages per TDD §8.9; unit test `preprocessor.test.ts` #10 with a 51-page fixture).

## Category enum (inferred)

The `category` field on both `SignedUrlRequest` and `IngestRequest` is typed `string` but the clinical acceptance fixture set enumerates: `lab_report`, `discharge_summary`, `prescription`, `vaccination_card`, `radiology`, `other` (`clinical_acceptance.md:17-38`). Adversarial fixtures are still tagged by their true category. Server presumably validates against this set; the OpenAPI does not pin the enum — **minor drift**.

## Worker auth note

`/internal/process-job` is segregated behind `workerAuth` (`x-worker-token`). That token is not rotated by any migration or documented config path in this review set — likely lives in `supabase secrets` (POC) or AWS Secrets Manager (prod) and is rotated operationally per `09_runbooks/`. Not covered here.

## Jobs queue column reference (`data_model.md:118-133`)

Supabase-POC only (migration M-004 env-gated on `DIS_STACK=supabase`). On AWS this is replaced wholesale by SQS.

| Column | Type | Purpose |
|---|---|---|
| `id` | bigserial PK | — |
| `topic` | text NOT NULL | Job kind (`preprocess`, `ocr`, `structure`, `promote`) |
| `payload` | jsonb NOT NULL | `{extraction_id, ...}` |
| `available_at` | timestamptz default now() | Leased-after-now; enables delayed retries |
| `attempts` | int default 0 | Backoff counter |
| `max_attempts` | int default 5 | Poison-message threshold |
| `locked_until` | timestamptz | Lease expiry |
| `locked_by` | text | Worker instance id |
| `last_error` | text | For debugging |
| `created_at` | timestamptz default now() | — |
| `completed_at` | timestamptz | Set on terminal success |

Partial index: `idx_dis_jobs_ready` on `(topic, available_at) WHERE completed_at IS NULL`. Enables efficient `SELECT … FOR UPDATE SKIP LOCKED` leasing pattern (standard Postgres queue idiom).

Retention: 30 days after `completed_at` (`data_model.md:229`).

## Cost ledger column reference (`data_model.md:139-152`)

| Column | Type | Purpose |
|---|---|---|
| `id` | bigserial PK | — |
| `extraction_id` | uuid, FK ocr_extractions.id ON DELETE SET NULL | Soft FK — finance survives extraction deletion |
| `provider` | text | e.g., `datalab`, `anthropic` |
| `operation` | text (no CHECK — gap) | Conventionally `ocr` or `structuring` |
| `tokens_in`, `tokens_out` | bigint default 0 | LLM accounting |
| `pages` | int default 0 | OCR accounting |
| `cost_micro_inr` | bigint | Integer micro-rupees (10^-6 INR) to avoid float drift |
| `correlation_id` | uuid | Matches extraction |
| `created_at` | timestamptz default now() | — |

Index: `idx_cost_ledger_created` on `created_at` for finance reports.

## Confidence policy shape (`data_model.md:101-114`)

Stored in `dis_confidence_policy.rules jsonb`. Shape per `confidence-policy.test.ts` and TDD §12:

```jsonc
{
  "version": 3,
  "rules": [
    {
      "field_path": "labs",
      "block_type": "table",
      "auto_approve_if": { "confidence": { ">=": 0.95 } }
    },
    {
      "field_path": "medications",
      "auto_approve_if": { "confidence": { ">=": 0.92 } }
    }
  ]
}
```

Invariants:
- `enabled=false` at factory default (`migrations.md:22` M-003 seeds this).
- Only one row with `deactivated_at IS NULL` at any moment (single-active invariant — unit test #7).
- Activation writes an audit row (CS-7, tested by `confidence_default_off.test.ts` step 4).
- Unknown `field_path` raises `PolicyEvaluationError` (never silently approves — unit test #4).

## Audit-log column reference (`data_model.md:68-82`)

| Column | Type | Purpose |
|---|---|---|
| `id` | bigserial PK | — |
| `extraction_id` | uuid NOT NULL FK RESTRICT | Subject row |
| `event_type` | text NOT NULL | `state_transition | field_edit | approve | reject | retry | override | kill_switch` (by convention) |
| `actor_type` | text NOT NULL CHECK in (`user`, `system`) | Human vs auto-approve/skip |
| `actor_id` | text | User id or `system` |
| `from_state`, `to_state` | text | For state_transition events |
| `field_path` | text | For field_edit events (e.g., `labs[0].value_numeric`) |
| `before_value`, `after_value` | jsonb | For field_edit events |
| `note` | text | Free text (e.g., reason_note) |
| `correlation_id` | uuid | Cross-ref extraction |
| `created_at` | timestamptz default now() | — |

Index `idx_audit_ext` on `(extraction_id, created_at)` supports timeline queries. BEFORE UPDATE + BEFORE DELETE triggers enforce append-only (`data_model.md:87-97`).

## CS-## to data-model + API + test mapping

Every clinical-safety rule threads through all three pillars. Combined reference.

| CS | Data enforcement | API enforcement | Unit test | Integration test |
|---|---|---|---|---|
| CS-1 No unverified row in clinical tables | `lab_results.verification_status` CHECK; M-009 `lab_results_extraction_or_source` constraint; promotion requires `ocr_extraction_id` | Approve endpoint is the only promotion path; pending_review rejects promotion with 409 | `promotion.test.ts` #11 | `promotion.cs1.test.ts` |
| CS-2 Raw responses preserved forever | `ocr_extractions.raw_ocr_response`, `raw_structured_response`, `raw_ocr_markdown`, `raw_ocr_blocks` never nullified; no DELETE policy | — | `structuring.test.ts` #4 (edit doesn't mutate raw) | `audit_retention.cs2.test.ts` (6-month clock) |
| CS-3 Every clinical row → one extraction (FK) | `lab_results.ocr_extraction_id uuid REFERENCES ocr_extractions(id) ON DELETE RESTRICT`; same on `vaccinations` | — | `promotion.test.ts` #11 | `schema.cs3.test.ts` |
| CS-4 Verified values not silently overwritten | Doc-level duplicate detected by `source_content_hash`; UNIQUE only on `idempotency_key`, not hash | `DUPLICATE_DOCUMENT` 409; `override_duplicates:true` required to proceed | — | `duplicate.cs4.test.ts` |
| CS-5 Reject is permanent | `status='rejected'` terminal; CHECK enum does not permit outbound transitions | `INVALID_STATE_TRANSITION` 409 from approve after reject | `state-machine.test.ts` #5, #6, #10 | `state_machine.cs5.test.ts` |
| CS-6 Edits logged field-by-field | `ocr_audit_log` append-only triggers; `event_type='field_edit'` rows with `before_value` / `after_value` | `ApproveRequest.verified_structured` diffed against `structured` at approve time | `audit-log.test.ts` #4, #5, #6 | Implicit in `happy_path_pdf.test.ts` |
| CS-7 Confidence gates explicit + default off | `dis_confidence_policy.enabled` default false; single-active invariant on `deactivated_at IS NULL` | Activation via service-role only (not on public paths) | `confidence-policy.test.ts` #1, #4, #5, #7 | `confidence_default_off.test.ts` |
| CS-8 PII stays within patient boundary | RLS policy `extractions_read` scopes by `app.patient_id` | `bearerAuth` JWT carries role + patient context | — | `rls.cs8.test.ts` |
| CS-9 Test-name normalization audited | `raw_structured_response` stores `test_name_raw` + `test_name_normalized` separately | — | `structuring.test.ts` #3, #4 | Implicit in clinical acceptance fixtures 2–4 |
| CS-10 Discharge summary latest-only | Promotion service dedupes by `test_name_normalized` within `discharge_summary` docs; keeps `max(test_date)` | — | `promotion.test.ts` #1, #2, #3 | `discharge_latest_only.test.ts` |
| CS-11 Duplicate-row prevention | `uniq_lab_dedupe` UNIQUE index on `(patient_id, test_name, test_date, coalesce(value_numeric::text, value))`; same for `uniq_vax_dedupe` | — | `promotion.test.ts` #4, #5, #6 | `promotion.cs11.test.ts` |
| CS-12 No OCR data reaches Rx generator unverified | `verification_status` CHECK constraint on `lab_results` / `vaccinations`; `get_lab_history` filter | Out-of-scope (lives in generate-prescription Edge Function) | — | `rx_filter.cs12.test.ts` |

## Fixture-ID examples (kebab-case, no PHI)

From `fixtures.md:52-60` and `clinical_acceptance.md` v1 minimum set. Illustrative, not exhaustive.

| Category | Example ID | Purpose |
|---|---|---|
| lab_report | `lab-cbc-native-pdf-01` | Baseline CBC, no OCR needed |
| lab_report | `lab-cbc-scan-skew-01` | 5° tilt, deskew path |
| lab_report | `lab-lft-multi-column-01` | Table extraction |
| lab_report | `lab-rft-hindi-header-01` | Multilingual OCR |
| lab_report | `lab-handwritten-slip-01` | Low-confidence path |
| discharge_summary | `discharge-neonate-tsb-serial-01` | CS-10 7 readings |
| discharge_summary | `discharge-adult-meds-diag-01` | Medication + diagnosis extraction |
| discharge_summary | `discharge-smudge-adversarial-01` | Red-team |
| prescription | `rx-typed-brands-01` | Drug normalization |
| prescription | `rx-handwritten-english-01` | Likely-reject adversarial |
| prescription | `rx-handwritten-hindi-01` | Multilingual adversarial |
| vaccination_card | `vax-iap-8-doses-01` | Date extraction |
| vaccination_card | `vax-uip-partial-01` | Missing fields |
| radiology | `rad-xray-native-pdf-01` | Imaging findings |
| radiology | `rad-usg-scan-01` | Scan path |
| other | `other-diet-chart-01` | Category handling |
| adversarial | `adv-wrong-patient-01` | F17 red-team |
| adversarial | `adv-mixed-patient-01` | F18 red-team |
| adversarial | `adv-blank-plus-one-01` | F19 preprocessor drop |
| adversarial | `adv-all-blank-01` | F20 graceful failure |

## Coverage-floor gates in numeric form

Failing any value blocks merge (`test_strategy.md:40-49`).

| Path | Statement floor | Branch floor |
|---|---|---|
| `src/core/**` | 90% | 85% |
| `src/adapters/**` (non-network) | 80% | 70% |
| `src/adapters/ocr/**`, `src/adapters/structuring/**` | 70% | 60% |
| `src/http/**` | 80% | 70% |

Non-functional targets (`test_strategy.md:133-138`):

| Metric | Target | Test |
|---|---|---|
| P50 `/ingest` | < 1 s | `tests/perf/ingest.k6.ts`, nightly |
| P95 end-to-end | < 90 s | Integration over 50 fixtures |
| Kill-switch RTO | < 5 min | `kill_switch.test.ts` |
| Per-doc cost | ≤ ₹0.40 | `tests/clinical/cost_budget.test.ts` via `dis_cost_ledger` |

## Annotated flow narratives

### Happy-path lifecycle (native-text lab report)

1. Client requests signed URL: `POST /uploads/signed-url` → `{url, storage_key}`.
2. Client PUTs bytes directly to storage (no service-side bandwidth).
3. Client `POST /ingest` with `Idempotency-Key=K1`; server creates `ocr_extractions` row with `status='uploaded'`, unique on `idempotency_key`, stamps `correlation_id`, enqueues job.
4. Worker pulls job; file router classifies `routing_path='native_text'` (PDF ≥ 100 chars/page avg — `file-router.test.ts` #1). No preprocessing; skip OCR.
5. Status transitions `uploaded → structuring`. Haiku called; response validated against JSON Schema v1. On pass, `structured` column filled; `status='ready_for_review'`.
6. Confidence-policy evaluator runs. With default `enabled=false`, decision `{auto_approve:false}`, extraction parks at `ready_for_review`. Audit row `state_transition`.
7. Nurse opens verification UI, reviews `raw_ocr_markdown` against source, optionally edits `verified_structured`. Each field edit produces one `field_edit` audit row (CS-6).
8. Nurse clicks Approve: `POST /extractions/{id}/approve` with `Idempotency-Key=K2`, `version=1`, `verified_structured` (or empty for "as-is").
9. Server validates version (→ 409 `VERSION_CONFLICT` if stale), validates payload (→ 422 `VALIDATION_FAILED` if edits break schema), acquires row, transitions `ready_for_review → verified → promoted` inside a single DB transaction.
10. Promotion service inserts `lab_results` rows with `ocr_extraction_id`, `verification_status='verified'`, `verified_by`, `verified_at`. CS-11 dedupe index prevents exact duplicates; CS-10 caps discharge-summary values to latest date.
11. `visits.attached_documents` JSONB patched with `ocr_summary`, `ocr_extraction_id`, `ocr_verification_status`.
12. Returns `PromotionSummary`. `ocr_extractions.status='promoted'`, `version=2`, `promoted_at` set.
13. Audit log now contains: state transitions (`uploaded→preprocessing`—skipped on native-text—`→structuring→ready_for_review→verified→promoted`), N `field_edit` rows, one `approve` event.

### Failure-path variants

- **Schema-invalid 3x** → `status='failed'`, `error_code='STRUCTURING_SCHEMA_INVALID'`. Client sees `retryable=false` (after N retries internally); `POST /retry` creates a fresh extraction, originals preserved.
- **OCR provider down** → status eventually `failed`, `error_code='OCR_PROVIDER_UNAVAILABLE'`, `retryable=true`. Background retry policy.
- **Promotion txn fails** → rollback; `error_code='PROMOTION_FAILED'`. Extraction returns to `ready_for_review`. (State machine drift: no explicit `promoting` status — see gap #14.)
- **Duplicate document** → second extraction created (not blocked at ingest), `warnings[]` surfaced on `GET`, `approve` returns 409 `DUPLICATE_DOCUMENT` without `override_duplicates:true`. Even with override, row-level CS-11 guard prevents duplicate inserts.

### Kill-switch behaviour

`DIS_KILL_SWITCH=1` short-circuits every endpoint at the orchestrator (unit test `orchestrator.test.ts` #9) before any port call. `/ingest` returns 503 `UNAVAILABLE`. Optional `DIS_KILL_SWITCH_ROUTE_TO_LEGACY=1` returns 307 to the pre-DIS process-document Edge Function. Activation logged as `kill_switch` audit event on the previously-live extractions? — integration test §7 logs it once per activation.

### Confidence policy activation flow

1. Admin writes new row to `dis_confidence_policy` with `enabled=true`, `rules=[...]`, `activated_by`, `activated_at=now()`.
2. Single-active invariant: previous active row gets `deactivated_at=now()` — enforced at write time (unit test `confidence-policy.test.ts` #7).
3. Future extractions pass through evaluator; when decision `{auto_approve:true}`, status goes `ready_for_review → auto_approved → promoted` without nurse action. `verification_status='auto_approved'`, `verified_by='system'`, `actor_type='system'` on audit row (CS-7 + CS-11).
4. Deactivation: set `deactivated_at=now()` on active row. Defaults to factory-off path again.

## Glossary

- **DIS** — Document Ingestion Service (this subsystem).
- **ClinicalExtraction** — JSON Schema v1 payload produced by the structuring adapter; the validated form of a document's contents.
- **Golden file** — the correct answer for a fixture (`expected/structured.json`), not the model's output.
- **CS-##** — clinical-safety rule number 1..12 (see `01_product/clinical_safety.md`).
- **Verify report** — Gate-7 artefact per ticket; Given/When/Then + literal command output.
- **RED/GREEN commit** — TDD-order markers in commit subjects (`[RED][CS-##]` / `[GREEN][CS-##]`).

## Refresh instructions for next session

Re-read only changed files since `69ce4bc`. Run:

```
git log --name-only 69ce4bc..HEAD -- \
  dis/document_ingestion_service/03_data/ \
  dis/document_ingestion_service/04_api/ \
  dis/document_ingestion_service/05_testing/
```

- For `openapi.yaml` diffs: re-enumerate paths (method + operationId + auth + request + response + error codes).
- For `03_data/migrations.md` changes: append new migrations chronologically in the Migrations table; update the reversibility list.
- For `03_data/data_model.md` changes: refresh the per-table rows (purpose, key columns, constraints, relationships).
- For `04_api/error_model.md` changes: refresh the status mapping table and the 4xx/5xx code lists.
- For `05_testing/*.md` changes: refresh the CS-1..CS-12 mapping, fixture floor, pyramid percentages, and the per-file test enumerations.
- Bump `last_refreshed` and `source_commit` in the frontmatter.
- Rewrite "What changed since last refresh" at the top with a dated bullet list of diffs.
