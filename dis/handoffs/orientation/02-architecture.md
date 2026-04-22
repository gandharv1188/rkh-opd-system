---
report: 02-architecture
last_refreshed: 2026-04-22
source_commit: 69ce4bc
source_paths:
  - dis/document_ingestion_service/02_architecture/
covered_files:
  - path: dis/document_ingestion_service/02_architecture/tdd.md
    lines: 430
  - path: dis/document_ingestion_service/02_architecture/adapters.md
    lines: 128
  - path: dis/document_ingestion_service/02_architecture/coding_standards.md
    lines: 176
  - path: dis/document_ingestion_service/02_architecture/drift_prevention.md
    lines: 558
  - path: dis/document_ingestion_service/02_architecture/portability.md
    lines: 176
  - path: dis/document_ingestion_service/02_architecture/sequence_diagrams.md
    lines: 125
  - path: dis/document_ingestion_service/02_architecture/adrs/README.md
    lines: 85
  - path: dis/document_ingestion_service/02_architecture/adrs/ADR-001-hexagonal-ports-and-adapters.md
    lines: 135
  - path: dis/document_ingestion_service/02_architecture/adrs/ADR-002-datalab-hosted-vs-self-host.md
    lines: 134
  - path: dis/document_ingestion_service/02_architecture/adrs/ADR-003-kill-switch-returns-503.md
    lines: 141
  - path: dis/document_ingestion_service/02_architecture/adrs/ADR-004-datalab-webhooks-over-polling.md
    lines: 152
  - path: dis/document_ingestion_service/02_architecture/adrs/ADR-005-hono-over-fastify.md
    lines: 146
  - path: dis/document_ingestion_service/02_architecture/adrs/ADR-006-postgres-driver-over-pg-or-drizzle.md
    lines: 179
  - path: dis/document_ingestion_service/02_architecture/adrs/ADR-007-claude-haiku-default-sonnet-escalation.md
    lines: 178
# Total: 14 files, 2743 lines
report_owner: architecture-reviewer
confidence:
  tdd: high
  adrs: high
  portability: high
  drift_prevention: high
  coding_standards: high
---

## What changed since last refresh

(Empty on first write.)

## Executive summary

DIS is a **Hexagonal Ports & Adapters** service with a pure TypeScript core, eight named ports, and per-environment adapter sets. The composition root is `src/wiring/supabase.ts` (POC) or `src/wiring/aws.ts` (prod); `DIS_STACK=supabase|aws` selects at boot. Secondary pattern is **CQRS-lite**: staging (`ocr_extractions`) is the command side; clinical tables (`lab_results`, `vaccinations`) are the query side, crossed only by the named `promote` command. Portability thesis: `core/`, `ports/`, `http/routes/`, schemas, and prompts never change at port time; only wiring + adapters swap. The deployment artifact is a single Dockerfile image runnable on Supabase Edge Functions (or Fly.io/Render fallback) in POC and on ECS Fargate / Lambda in production (cite `portability.md:19-42`).

Seven accepted ADRs anchor the design:

- **ADR-001** — Hexagonal Ports & Adapters (architectural style).
- **ADR-002** — Datalab hosted Chandra at POC; self-host at sustained 1000 docs/day.
- **ADR-003** — Kill switch returns HTTP 503 (not 307 proxy) — reconciles a cross-doc conflict.
- **ADR-004** — Datalab webhooks over polling for OCR completion, polling retained as fallback.
- **ADR-005** — Hono as HTTP framework (not Fastify/Express), for runtime portability.
- **ADR-006** — `postgres` (porsager) as the Postgres driver; no ORM, no Supabase SDK in the DB adapter.
- **ADR-007** — Claude Haiku as default structuring LLM; Sonnet reserved for escalation.

Drift prevention runs in two phases: Phase 1 (Proposed) = PR citations, files-touched allowlist, architectural fitness functions, forbidden-token scan, orchestrator re-VERIFY sampling; Phase 2 (Staged) = spec-hash locking, anti-regression baselines, commit-message tokens, prompt version stamping, ADR-gated `// reason:` comments, handoff-diff audit.

## System diagram (ASCII)

From `tdd.md:29-48` and `sequence_diagrams.md`:

```
                ┌──────────────────────────────────────────────────────────┐
                │                       HTTP (Hono)                        │
                │  POST /ingest   GET /extractions/:id   POST /approve     │
                │  POST /reject   GET /extractions?q=    GET /admin/metrics│
                └────────────────────────────┬─────────────────────────────┘
                                             │
                                             ▼
          ┌─────────────────────────────────────────────────────────────┐
          │                          DIS CORE                            │
          │  (pure TS — no fetch, no SQL literals, no Supabase SDK)      │
          │                                                              │
          │  IngestionOrchestrator (state machine)                       │
          │  ConfidencePolicy        PromotionService                    │
          │  AuditLogger             FileRouter                          │
          └─┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬───────────┘
            │      │      │      │      │      │      │      │
            ▼      ▼      ▼      ▼      ▼      ▼      ▼      ▼
         OcrPort Struct Storage Database Queue Secrets FileRt Preproc
           │      │      │        │      │      │      │      │
   ┌───────┘      │      │        │      │      │      │      │
   ▼              ▼      ▼        ▼      ▼      ▼      ▼      ▼
Datalab       ClaudeHaiku Supabase  Supabase  pgcron Supabase Default Default
(default)     (default)   Storage / Postgres/ /SQS   secrets/ file-   (OpenCV
ClaudeVision  Sonnet      S3        AWS RDS          AWS SM   router  variant)
(fallback)    (escalate)
Onprem        (future)
(stub)

External services: Datalab /convert (HTTP); Anthropic API; Supabase REST /
S3 REST; Postgres TCP; SQS/pg_cron; Supabase Realtime / AppSync.
```

Cite: `tdd.md:27-48`, `adapters.md:7-69`, `portability.md:6-17`, `sequence_diagrams.md:6-42`.

## Ports (every port with one-line purpose)

| Port               | File                    | Purpose                                         | POC adapter               | Prod adapter                            | ADR        |
| ------------------ | ----------------------- | ----------------------------------------------- | ------------------------- | --------------------------------------- | ---------- |
| `OcrPort`          | `ports/ocr.ts`          | Image/PDF → markdown + blocks + raw response    | `DatalabChandraAdapter`   | `DatalabChandraAdapter` (same HTTP API) | ADR-001/002/004 |
| `StructuringPort`  | `ports/structuring.ts`  | Markdown → `ClinicalExtraction v1` JSON         | `ClaudeHaikuAdapter`      | same                                    | ADR-001/007 |
| `StoragePort`      | `ports/storage.ts`      | Object store put/get + signed URLs              | `SupabaseStorageAdapter`  | `S3Adapter`                             | ADR-001    |
| `DatabasePort`     | `ports/database.ts`     | Parameterised Postgres access + tx + session    | `SupabasePostgresAdapter` | `AwsRdsAdapter`                         | ADR-001/006 |
| `QueuePort`        | `ports/queue.ts`        | Background job enqueue + consumer loop          | `PgCronAdapter`           | `SqsAdapter`                            | ADR-001    |
| `SecretsPort`      | `ports/secrets.ts`      | Secret retrieval (5-min cache)                  | `SupabaseSecretsAdapter`  | `AwsSecretsManagerAdapter`              | ADR-001    |
| `FileRouterPort`   | `ports/file-router.ts`  | Native-PDF vs scan vs office dispatch           | `DefaultFileRouter`       | same                                    | ADR-001    |
| `PreprocessorPort` | `ports/preprocessor.ts` | Deskew/perspective/dedupe/resize/CLAHE pipeline | `DefaultPreprocessor`     | `OpenCvPreprocessor` variant            | ADR-001    |

Cite: `adapters.md:71-82`, `tdd.md:11-17`.

## Adapters (every adapter with status)

| Adapter                    | Implements port   | Status (per ADR / handoff refs)                                    | Tickets            | ADR    |
| -------------------------- | ----------------- | ------------------------------------------------------------------ | ------------------ | ------ |
| `DatalabChandraAdapter`    | `OcrPort`         | Live (POC + prod). Polling-first today; webhook switch in DIS-050a | DIS-050/050a       | 002, 004 |
| `ClaudeVisionAdapter`      | `OcrPort`         | Fallback; live behind `DIS_OCR_PROVIDER=claude`                    | DIS-052            | 002    |
| `OnpremChandraAdapter`     | `OcrPort`         | Stub only; reserved interface for self-host phase                  | DIS-062            | 002    |
| `ClaudeHaikuAdapter`       | `StructuringPort` | Live default; retry-once on schema-invalid (DIS-051)               | DIS-051/051-followup | 007  |
| `ClaudeSonnetAdapter`      | `StructuringPort` | Deferred — per-extraction escalation path; flag-flip usable today  | future             | 007    |
| `SupabaseStorageAdapter`   | `StoragePort`     | Live (POC). Uses REST + plain `fetch` (DIS-053)                    | DIS-053            | 001    |
| `S3Adapter`                | `StoragePort`     | Planned (Epic F port)                                              | Epic F             | 001    |
| `SupabasePostgresAdapter`  | `DatabasePort`    | Live; `postgres` driver indirected via `setPostgresDriverLoader`   | DIS-054 / DIS-021b | 006    |
| `AwsRdsAdapter`            | `DatabasePort`    | Planned (Epic F port) — same SQL surface                           | Epic F             | 006    |
| `PgCronAdapter`            | `QueuePort`       | Partial (ticketed); `pg_cron` + `pg_net` dispatch                  | DIS-097            | 001    |
| `SqsAdapter`               | `QueuePort`       | Planned                                                            | Epic F             | 001    |
| `SupabaseSecretsAdapter`   | `SecretsPort`     | Live                                                               | —                  | 001    |
| `AwsSecretsManagerAdapter` | `SecretsPort`     | Planned                                                            | Epic F             | 001    |
| `DefaultFileRouter`        | `FileRouterPort`  | Planned; router decision tree in `tdd.md §7`                       | DIS-020-ish        | 001    |
| `DefaultPreprocessor`      | `PreprocessorPort`| Planned; pipeline in `tdd.md §8`                                   | Epic B/C           | 001    |

Fake peers (`__fakes__/<Name>Adapter`) are mandatory per `adapters.md:91-128` for every adapter.

## ADRs — one subsection per ADR

### ADR-001: Hexagonal Ports & Adapters architecture

- **Status:** Accepted (cite `adrs/ADR-001-hexagonal-ports-and-adapters.md:3`).
- **Context.** DIS must (a) prevent OCR-derived rows reaching clinical tables without verification/auto-approval gate, and (b) port Supabase → AWS in one working day with zero business-logic rewrites (`ADR-001:9-17`). Source docs bound: `tdd.md §1`, `adapters.md §Ground rules`, `portability.md §Three containment boundaries`, `coding_standards.md §2`, `01_product/clinical_safety.md` CS-1..CS-12.
- **Decision.** Adopt Hexagonal with eight named ports (OCR, Structuring, Storage, Database, Queue, Secrets, FileRouter, Preprocessor); every adapter swappable by configuration; composition root is `src/wiring/{supabase,aws}.ts` (`ADR-001:35-55`).
- **Consequences.** Enforced by `dis/scripts/fitness.mjs` rules `core_no_adapter_imports`, `ports_no_adapter_imports`, `supabase_sdk_only_in_supabase_adapters`, `aws_sdk_only_in_aws_adapters`, `core_no_fetch`, `core_no_sql_literals`. Every adapter must have a fake. Easier: provider/cloud swaps, sub-1s core unit suite, new adapter = config flag. Harder: no quick prototypes in core; port-version bump is a breaking change needing an ADR + all-adapter update in one PR.
- **Cross-refs.** TDD §1, §17; `adapters.md`; `portability.md`; `coding_standards.md §2`; drift Control 3 (fitness); `01_product/clinical_safety.md` CS-1..CS-12; ADR-002/004/005/006/007 all layer on top.
- **Drift note.** `ADR-001:69-71` flags **5 pre-existing `core_no_sql_literals` violations** in `orchestrator.ts` + `__fakes__/database.ts`, resolved by DIS-021b (extract named `DatabasePort` methods). Until DIS-021b merges, the ADR is aspirational in those five spots. ADR-006 Follow-up also cites DIS-021b.

### ADR-002: Datalab hosted Chandra at POC; self-host at sustained 1000 docs/day

- **Status:** Accepted (`ADR-002:3`).
- **Context.** OCR is the only build-vs-buy call in the pipeline. POC volume ~20 docs/day; Datalab costs ~$25 flat + $0.45-0.60 metered at this volume; self-hosting GPU costs $200-400/month (`ADR-002:9-31`). Sources: `10_handoff/document_ocr_flow.md §12-13`, memory `project_chandra_inflection_point.md`.
- **Decision.** (1) Use Datalab hosted `/api/v1/convert mode=accurate` (Chandra) through Phase 4. (2) Defer self-hosting until sustained 1000 docs/day for 60 consecutive days. (3) Keep `OcrPort` provider-agnostic; `OnpremChandraAdapter.stub` reserves the interface (DIS-062).
- **Consequences.** `DatalabChandraAdapter` (DIS-050) reads `DATALAB_API_KEY` via `SecretsPort`, preserves raw response byte-identically (CS-2). DIS-050a raises max wait 120s → 300s. 429 → `RATE_LIMITED` retryable. Harder: PHI crosses third-party; Datalab not HIPAA-equivalent for IN (risk accepted at POC); outage exposure mitigated by `ClaudeVisionAdapter` (DIS-052) + kill switch (ADR-003).
- **Cross-refs.** ADR-001 (port), ADR-003 (kill switch), ADR-004 (webhooks refine wire pattern), `tdd.md §9`, `09_runbooks/provider_outage.md`, `dis_cost_ledger` / DIS-149.
- **Drift note.** Threshold trigger produces a successor ADR `ADR-002-self-host-switchover`. As of 2026-04-22 no drift; POC volume still << 1000/day.

### ADR-003: Kill switch returns HTTP 503 (not 307 proxy to legacy)

- **Status:** Accepted; reconciles cross-doc inconsistency (`ADR-003:3-5`).
- **Context.** Five sources disagreed: `06_rollout/rollout_plan.md`, `06_rollout/feature_flags.md §2`, `07_tickets/backlog.md` DIS-100 all said 503; `09_runbooks/kill_switch.md` said 307 proxy; `04_api/error_model.md` already had `UNAVAILABLE` (503) as a first-class retryable code (`ADR-003:9-28`).
- **Decision.** On `DIS_KILL_SWITCH=true`, write endpoints return **HTTP 503 UNAVAILABLE** with `Retry-After` + `{code: UNAVAILABLE, retryable: true}`. GETs still succeed (so nurses can drain queue). DIS itself does not proxy to legacy — clients fall back. `06_rollout/kill_switch.md` amended to replace the 307 prose; un-flip ritual unchanged (`ADR-003:32-47`).
- **Consequences.** Enforced by DIS-100 (middleware, VERIFY asserts 503 on writes, 200 on GETs, Retry-After header) and DIS-108 (integration test, 503 within one request after flip). Easier: separation of concerns, client-side fallback explicit, testing local, observability one service. Harder: clients implement fallback themselves (already the case during Phase 0-1); on-call runbook needs "503 is expected on flip" note.
- **Cross-refs.** `04_api/error_model.md` UNAVAILABLE; `06_rollout/{rollout_plan,feature_flags,kill_switch}.md`; `09_runbooks/kill_switch.md`; TDD §18 (RTO ≤5 min).
- **Drift note.** ADR explicitly lists `06_rollout/kill_switch.md` as needing prose amendment. If the amendment hasn't landed in the referenced file, that is an in-flight drift item; verification outside this report's scope.

### ADR-004: Datalab webhooks over polling for OCR completion

- **Status:** Accepted; refines ADR-002 wire pattern (`ADR-004:3-5`).
- **Context.** `DatalabChandraAdapter` (DIS-050) polls `request_check_url` with exp backoff (1s→10s cap, 120s total). `document_ocr_flow.md §13.4` confirmed Datalab supports `webhook_url`. Payload `{request_id, request_check_url, webhook_secret}`. Retries on 5xx/timeouts ≤30s. Shared-secret auth plaintext in body; HTTPS required; handlers must be idempotent (`ADR-004:9-34`).
- **Decision.** Switch adapter to webhook-first, polling-fallback. (1) Submit includes `webhook_url` to an internal DIS endpoint. (2) Polling continues with raised 300s budget (DIS-050a). (3) Receiver endpoint lands as extension of DIS-097 in Epic D; passing no `webhookUrl` option keeps polling-only (allows DIS-050a to merge ahead of DIS-097) (`ADR-004:37-55`).
- **Consequences.** Enforced by DIS-050a (adapter adds `webhookUrl` + `form.append('webhook_url', …)`; VERIFY-7 asserts `webhook_url` in source), DIS-097-extended (receiver with shared-secret validation + idempotency + `dis_jobs` update). Integration tests: webhook-first happy, poll-fallback, duplicate-delivery idempotency. Easier: completion-latency floor drops from ~10s → sub-second; bandwidth savings; provider retry semantics added. Harder: second failure surface (mitigated by polling fallback + idempotent receiver); public reachability of webhook receiver (Supabase Edge already public; AWS ALB satisfies); shared-secret rotation becomes 4th secret; plaintext secret (HTTPS mandatory; mismatch = probe, log).
- **Cross-refs.** ADR-002 (wire pattern); `09_runbooks/key_rotation.md` needs note once DIS-097-extended lands; `04_api/error_model.md` (`OcrProviderError`, `OcrProviderTimeoutError`, new `OcrProviderRateLimitedError`). CS-2 preserved because webhook path still fetches final body from `request_check_url` before declaring complete.
- **Drift note.** ADR-004 explicitly notes DIS-097-extended lands in Epic D; until then webhook receiver is not wired. `key_rotation.md` note deferred to DIS-097 handoff per `ADR-004:147-152`.

### ADR-005: Hono as HTTP framework (not Fastify / Express)

- **Status:** Accepted; formalises DIS-004 handoff D-1 retroactively (`ADR-005:3-5, 30-33`).
- **Context.** Framework choice affects portability (Supabase Edge Functions → AWS Fargate), test ergonomics (no real port needed), bundle size, ecosystem. Sources: `tdd.md §3`, `portability.md §Runtime compatibility` (names Hono explicitly), `coding_standards.md §1`, `dis/handoffs/DIS-004.md §3 D-1`. Wave-3 code already uses Hono (`src/http/server.ts`, `routes/health.ts`, `middleware/correlation-id.ts`) (`ADR-005:9-33`).
- **Decision.** `hono ^4.6.0` + `@hono/node-server ^1.13.0`. Future AWS: Hono on Fargate (same Node adapter) or `@hono/aws-lambda` (no code change, wiring-only) (`ADR-005:36-48`).
- **Consequences.** Enforced by DIS-001b (`package.json` adds deps), `src/http/server.ts` constructs typed `new Hono<{ Variables: AppVariables }>()`, `createServer()` returns fresh instance, `start(port)` uses `serve({ fetch: app.fetch })`. Fitness rule `core_no_fetch` keeps Hono confined to `http/`. Easier: test ergonomics (`app.fetch(request)` sync or `start(0)`), runtime portability (Node/Deno/Bun/CF Workers/Lambda), typed context (`c.get('correlationId')`), small surface (~100KB). Harder: smaller middleware ecosystem (mitigated — our 5 middlewares are native Hono few-liners); less familiar to Express devs (mitigated by Fetch-API shape).
- **Cross-refs.** OpenAPI 3.1 remains source of truth (`coding_standards.md §10`) — Hono doesn't auto-generate; `dis/openapi.yaml` (DIS-007). Error envelope (DIS-005). State machine (DIS-020) lives in `core/` with zero HTTP dep.
- **Drift note.** ADR retroactively formalises code already landed. Rejected alternatives: Fastify, Express, Hapi/Koa, raw `http`, Oak (Deno-only). No follow-ups.

### ADR-006: `postgres` (porsager) as the Postgres driver; no `pg`, no Drizzle, no Supabase SDK in core

- **Status:** Accepted; formalises DIS-054 driver choice (`ADR-006:3-5, 33-38`).
- **Context.** `DatabasePort` needs a driver. Sources: `tdd.md §6` (optimistic locking via parameterised UPDATE), `coding_standards.md §6 A03` (parameterised only), §7 (no vendor extensions), `portability.md §Database portability` (same adapter file Supabase Postgres + AWS RDS), DIS-054 handoff `§Driver wiring`, `src/adapters/database/supabase-postgres.ts` already has `setPostgresDriverLoader` indirection. DIS-021b about to extract named methods (`ADR-006:9-35`).
- **Decision.** `postgres ^3.4.4`. Four binding rules: (1) imported only by `src/adapters/database/supabase-postgres.ts` (+ future AWS equivalent); (2) uses `sql.unsafe(text, params)` form (not tagged templates) to match port contract `(sql, params: readonly unknown[])`; (3) module-level import indirected via `setPostgresDriverLoader` for hermetic tests; wiring layer calls once at boot; (4) **No ORM** — no Drizzle/Prisma/TypeORM; schema in `dis/migrations/`; queries SQL strings + positional params.
- **Consequences.** Enforced by DIS-054 (adapter), DIS-021b (named methods `findExtractionById`, `findExtractionByIdempotencyKey`, `updateExtractionStatus`, `insertExtraction` — resolves the 5 pre-existing `core_no_sql_literals` violations), `dis/scripts/fitness-rules.json` rule, `package.json` lists `postgres` and not `pg`/Drizzle. Easier: parameterised by construction; same file Supabase + RDS; hermetic unit tests (7 pass without real PG); pool reuse internal. Harder: no typed query builder (mitigated by named methods); `query<T>` doesn't validate shape (mitigated by Ajv at boundary per DIS-030); Supabase PostgREST features absent by design (Storage uses REST+fetch in DIS-053, Realtime in DIS-098 via own port).
- **Cross-refs.** ADR-001 (port layer), `coding_standards §6 A03` / §7, `portability.md`, DIS-054 handoff, DIS-021b, DIS-074 (Shared `DatabasePort` contract test suite will exercise parameterised-only invariant). Transactions via `sql.begin(fn)` preserve BEGIN/COMMIT/ROLLBACK + session scope. `setSessionVars` emits `SET LOCAL` with identifier regex validation `^[a-z_][a-z0-9_.]*$/i`. `DatabaseConnectionError` wraps driver errors.
- **Drift note.** 5 `core_no_sql_literals` violations in `orchestrator.ts` + `__fakes__/database.ts` are **current** — ADR-006 + ADR-001 both flag DIS-021b as the resolution. Until DIS-021b merges, the architectural rule is not fully enforced.

### ADR-007: Claude Haiku as default structuring LLM; Sonnet reserved escalation

- **Status:** Accepted (`ADR-007:3`).
- **Context.** Structuring stage converts OCR markdown → `ClinicalExtraction v1` JSON (`tdd.md §10, §11`). Pricing: Sonnet 4 ~$3 in/$15 out per 1M; Haiku 4.5 ~1/5 cost (`10_handoff/document_ocr_flow.md §12.4-12.5`). Quality matters (CS-1 risk: wrong value in correct order = rubber-stamp risk); cost matters at 1000 docs/day.
- **Decision.** `claude-haiku-4-5` default; Sonnet reserved for per-extraction escalation on low confidence. (1) `DIS_STRUCTURING_PROVIDER=haiku`; `ClaudeHaikuAdapter`; retry-once on schema-invalid; second failure → `StructuringSchemaInvalidError` → extraction `failed` → `retry()` creates new extraction. (2) Future `ClaudeSonnetAdapter` deferred — aggregated Haiku `confidence` below threshold triggers resubmit to Sonnet, orchestrator takes higher-confidence result. **Not yet built.** (3) No automatic escalation at launch; operator can globally flip via flag during incident (`09_runbooks/provider_outage.md §Schema drift`).
- **Consequences.** Enforced by DIS-051 (adapter, retry-once, typed error, prompt version stamped from frontmatter, cost at 83/416 µINR per token — placeholder pending DIS-032 cost-calculator cleanup), flag default `haiku` (`feature_flags.md §6`). Easier: per-document cost ≤ ₹0.40 target (TDD §18) with headroom (DIS-165 budget guardrail); Haiku latency keeps P95 <60s; flag-flip fallback; schema validation same both providers. Harder: Haiku on handwritten-noisy can miss fields (mitigated — Chandra handles vision; Haiku sees clean markdown; red-team DIS-152); normalisation mistakes carry clinical risk (mitigated — CS-9 `test_name_raw` preserved alongside `test_name_normalized` per prompt rules 2+4); prompt brittleness (mitigated — `prompts/structuring.md` versioned frontmatter, content-hashed per drift Control 8 when implemented).
- **Cross-refs.** ADR-001 (StructuringPort); CS-2 (raw response preserved byte-identical regardless of provider); `ClinicalExtraction v1` schema invariant; DIS-051-followup (Ajv full schema validation replacing required-keys check); DIS-166 (Epic F chaos: structuring fails closed on garbage); future Sonnet-escalation ticket not yet in backlog.
- **Drift note.** ADR cost rates (83/416 µINR per token) are placeholders pending DIS-032. Automatic escalation is "future ticket (not yet in backlog)" — a named-but-unfiled item, mild drift.

## Portability thesis (Supabase → AWS)

The single load-bearing idea (`portability.md:1-42`): DIS runs identically on Supabase POC and AWS prod because the **three containment boundaries** carve responsibility:

1. **Pure core** — `src/core`, `src/ports`, `src/http/routes`, `schemas/`, `prompts/`. Does NOT change at port time.
2. **Thin wiring** — `src/wiring/supabase.ts` vs `src/wiring/aws.ts`. Changes **once per stack**. `DIS_STACK` selects.
3. **Adapters** — added/removed to match stack. Drop `SupabaseStorageAdapter`, add `S3Adapter`.

### What is portable

- TypeScript Node 20 ESM core; no Node/Deno/Lambda-specific APIs outside adapters (`coding_standards.md §1`, `adapters.md:84-96`).
- Hono HTTP framework — Node, Deno, Bun, CF Workers, Lambda (ADR-005, `portability.md:47`).
- `postgres` driver over TCP — works identically against Supabase Postgres and AWS RDS (ADR-006, `portability.md:50-54`).
- Plain SQL migrations in `dis/migrations/` via `node-pg-migrate` or `dbmate` — **not** `supabase db push` (`portability.md:58-62`).
- `pgcrypto`, `pg_stat_statements`, `pg_trgm` only (both stacks) (`portability.md:68-72`).
- RLS via generic `current_setting('app.user_id')`, set from JWT claims in wiring (`portability.md:63-66`).
- Single Dockerfile image runs local, Fly.io/Render (POC preferred), or ECS Fargate / Lambda.

### What is not portable (and must change)

- Per-stack secrets backing (`SupabaseSecretsAdapter` vs `AwsSecretsManagerAdapter`).
- Queue (`pg_cron` + `pg_net` + `dis_jobs` table on Supabase; SQS + Lambda consumer on AWS).
- Realtime notify (Supabase Realtime via LISTEN/NOTIFY wrapper; AppSync subscriptions / SNS→WebSocket on AWS).
- Auth issuer (Supabase Auth JWT / Cognito).
- CDN for signed uploads (Supabase Storage signed URLs / CloudFront).
- Wiring files (`src/wiring/*.ts`).

### Leaks past the port boundary (noted in docs)

- **`StoragePort` signed-URL semantics:** Supabase returns public URLs directly; S3 returns pre-signed. Both satisfy the port contract shape (`portability.md:105-107`) — no leak in interface, but adapter code differs.
- **`PgCronAdapter` uses `pg_net`** — Supabase-specific extension, explicitly called out as stack-specific in `portability.md:74-76`. Acceptable because the adapter (not core) depends on it.
- **Supabase SDK imports:** confined to `adapters/storage/supabase-storage.ts`, `adapters/database/supabase-postgres.ts` (though ADR-006 actually routes DB through `postgres` driver not the SDK — verify in-code if/when reviewing), `adapters/secrets/supabase-secrets.ts`, `adapters/queue/pg-cron.ts` (`portability.md:50-54`).
- **Fitness rules** mechanically enforce "Supabase SDK only in supabase adapters" and "AWS SDK only in AWS adapters" (ADR-001 Consequences).

### Porting checklist (`portability.md:143-158`)

1. Terraform AWS resources (RDS, S3, SQS, Secrets Manager, ECR, Fargate, ALB, CloudFront).
2. `pg_dump` Supabase → `pg_restore` RDS.
3. `aws s3 cp` with manifest from Supabase Storage.
4. Set Fargate env: `DIS_STACK=aws`, provider keys, bucket names, queue URLs.
5. Deploy image from ECR.
6. Smoke test with clinical-acceptance fixtures.
7. DNS cutover (TTL reduced in advance).
8. Keep Supabase read-only 1 week as rollback target.

### Dry-run requirement (`portability.md:165-176`)

Before shipping DIS v1, execute the full checklist in a sandbox AWS account with clinical-acceptance tests. Target: **zero core changes**, ≤3 manual steps outside the script. **If the dry-run needs core changes, DIS is not shipped until refactored out.** This is Epic E ticket.

## Coding standards

`coding_standards.md` is 17 sections + enforcement note. The rules, with enforcement mode:

| § | Rule | Mechanical? |
| - | ---- | ----------- |
| 1 | TypeScript strict mode; no `// @ts-ignore` w/o comment+ticket; `any` needs `// reason: …`; discriminated unions + `assertNever`; Node 20 LTS ESM-only; Bun-compatible (no Node-specific APIs sans shim) | tsconfig strict ✓; `any` via eslint + drift Control 9 (Phase 2 — cites ADR) |
| 2 | SOLID; Hexagonal; 12-Factor; CQRS-lite (explicit `promote`); idempotency first; fail closed | fitness rules (Control 3) ✓; idempotency enforced by DB unique on `idempotency_key` |
| 3 | Folder by feature; barrel files at package boundaries; one public export; pure by default; immutability (`toSorted`/`toReversed`) | aspirational |
| 4 | Typed error classes; error envelope per `04_api/error_model.md`; no swallow; no `throw` for expected control flow (use `Result<T,E>`) | ESLint no-empty-catch; aspirational for Result discipline |
| 5 | Optimistic version lock every mutable row; no shared mutable module state; race-aware (tx or SELECT…FOR UPDATE) | TDD §6; DB schema enforces via `version INT` column |
| 6 | OWASP Top 10 — A01..A10 explicit; no custom crypto (`node:crypto` only); parameterised SQL; CSP/HSTS/COOP/COEP; `npm audit` blocks HIGH+; allowlist outbound hostnames | `npm audit` CI ✓; secret scanner CI; parameterised by ADR-006 |
| 7 | Postgres only; migrations only; `.rollback.sql` round-trip CI; `id UUID PK, created_at, updated_at, version, correlation_id`; append-only audit via trigger; FK `ON DELETE RESTRICT` for clinical; `snake_case` plural tables | migration round-trip CI ✓; trigger enforces append-only |
| 8 | `pino` structured logs + level; every line carries correlation_id/request_id/extraction_id; no `console.log`; metrics neutral interface; OTEL tracing; no PII in logs | drift Control 7 bans `console.log` ✓; PII scrub aspirational |
| 9 | TDD mandatory (Gate 2 fail-first); 80/15/5 pyramid; core ≥90% lines+branches; adapters ≥70%; no `NODE_ENV==='test'` branches in prod; fakes > mocks; property-based (`fast-check`); golden-file for schemas; clinical-acceptance in CI | coverage thresholds CI; drift Control 7 bans `.only`/`.skip` in src (test files exempt) |
| 10 | OpenAPI 3.1 source of truth; `/dis/v1/`; cursor pagination; consistent error envelope; Idempotency-Key mandatory | CI spec-diff ✓; error envelope middleware DIS-005 |
| 11 | Conventional Commits; scope = ticket; one ticket = one branch = one PR (squash); `feat/dis-###-<slug>`; PR references TDD §; no force-push to `main`/`feat/dis-plan`; Co-Authored-By trailer when agent committed | commit-lint CI; drift Control 1 (PR citations); Control 6 (Phase 2) forbidden commit tokens |
| 12 | Minimize deps; pinned; no AGPL/SSPL/non-OSI; `npm audit` HIGH+ blocks | CI ✓ |
| 13 | WCAG 2.2 AA; Lighthouse a11y ≥90; semantic HTML first; keyboard; contrast ≥4.5:1; no reliance on colour alone; SR labels | Lighthouse CI (aspirational) |
| 14 | Per-endpoint budget in TDD §18; CI fails P95 regress >10%; no N+1; no blocking sync I/O; streaming where reasonable | Control 5 (Phase 2) anti-regression baselines |
| 15 | JSDoc on every public fn — purpose/params/return/throws/TDD section; ADRs in `adrs/NNNN-title.md`; comments explain WHY | aspirational; Control 9 ADR-gated `// reason:` cites (Phase 2) |
| 16 | "Done" = AC evidence + tests green + docs updated + CHANGELOG + lint/typecheck/tests/audit green + Approved + Gate-6 sign-offs | review_gates.md Gate 7 DoD |
| 17 | `.eslintrc` (bans `any`, import boundaries via `eslint-plugin-boundaries`); tsconfig strict; CI lint/typecheck/test/audit/port-validator/spec-diff; pre-commit format+lint staged; PR template checklist — **violations are merge blockers, not style preferences** | end-to-end CI |

Key mechanical-vs-aspirational split:
- **Mechanical:** strict TS, fitness rules (Control 3), forbidden tokens (Control 7), `npm audit`, coverage thresholds, commit-lint, import-boundaries ESLint rule, spec-diff, migration round-trip.
- **Aspirational (reviewer-driven):** immutability by default (§3), `Result<T,E>` for expected failures (§4), PII scrubbing discipline (§8), WCAG AA (§13), JSDoc TDD-section refs (§15).

## Drift prevention

`drift_prevention.md` defines four flavours of drift (scope, spec, architectural, quality) and 11 controls in two phases.

### Phase 1 controls (apply now) — `drift_prevention.md §3`

| # | Control | Prevents | Enforced at gate |
| - | ------- | -------- | ---------------- |
| 1 | PR source-of-truth citation check — greps PR body for `implements TDD §X.Y`, `CS-##`, `DIS-US-###`, `coding_standards.md §N`; validates each against source file via GH Actions | Spec drift | Gate 4 |
| 2 | Files-touched allowlist — ticket frontmatter `files_allowed: [...]`; CI diff `origin/feat/dis-plan...HEAD` fails on out-of-allowlist adds/mods/deletes | Scope drift ("while I was here") | Gate 4 |
| 3 | Architectural fitness functions — `dis/scripts/fitness-rules.json` + walker. Rules: core !→ adapters; ports !→ adapters/core; core no `fetch(`/`http`/SQL literals; Supabase SDK only in supabase adapters; `pg`/`postgres`/`drizzle` only in database adapters; no `: any` without `// reason: …` | Architectural drift | Gate 4 |
| 7 | Forbidden-token scan — `TODO`, `FIXME`, `XXX`, `HACK`, `console.log`, `debugger`, `.only`, `.skip`, `xdescribe`, `xit` in `src/` (test files exempt). Allow-annotation `// lint-allow: TODO — ticket DIS-999`. CRLF normalized for Windows | Quality drift | Gate 4 |
| 10 | Orchestrator re-VERIFY sampling — Orchestrator re-runs 20% (100% for `clinical-safety`/`integration`/`breaking`) of the PR's VERIFY commands in a fresh worktree; diffs output against handoff; mismatch → Gate 5 fail | All four (safety-net) | Gate 5 |

### Phase 2 controls (staged) — `drift_prevention.md §4`

| # | Control | Prevents |
| - | ------- | -------- |
| 4 | Spec hash locking — at dispatch, hash cited TDD/CS sections; on merge re-hash; reject if diff. Prevents "agent updated the TDD to match implementation" | Spec drift (advanced) |
| 5 | Anti-regression baselines — `dis/metrics/baselines.json` (coverage + p95 latency + test count); CI fails on >10% regress | Quality drift (perf/coverage) |
| 6 | Forbidden commit-message tokens — block `probably`, `should be fine`, `temporarily`, `TODO later`, `HACK`, `will fix`, `quick fix` | Spec + quality |
| 8 | Prompt version stamping — every LLM call records `prompt_id` + `prompt_sha256`; DIS prompts content-addressed | Spec drift (LLM) |
| 9 | ADR-gated decisions — every `// reason: …` must cite `ADR-###` and CI checks ADR file exists | Spec + arch |
| 11 | Handoff diff audit — Orchestrator `git diff --name-only` against "Files touched" in `dis/handoffs/DIS-###.md`; unmentioned changes → re-open PR | Scope + quality |

### Failure-mode library (`drift_prevention.md §6`)

Twelve real agent failure modes mapped to controls. Bold are explicit limitations:

| # | Failure mode | Caught by |
| - | ------------ | --------- |
| F1 | Agent silently widens `any` escape hatch | C3 |
| F2 | Agent commits `.only` on a test | C7 |
| F3 | Agent pastes speculative VERIFY output never run | C10 |
| F4 | Agent edits TDD mid-feature to match impl | **Phase 2 C4** |
| F5 | "while I was here" refactors unrelated module | C2 |
| F6 | Core imports adapter for type-only reason | C3 |
| F7 | `TODO: handle error` in clinical-safety path | C7 |
| F8 | Claims `implements TDD §9.2` but §9.2 absent | C1 |
| F9 | **Agent lowers test assertion to make it pass** | **none (human only)** |
| F10 | New port method with no ADR + no version bump | C3 + Phase 2 C9 |
| F11 | p95 latency regresses 25% under plausible refactor | **Phase 2 C5** |
| F12 | **Correct-looking code that is subtly semantically wrong** | **none (tests + human)** |

§8 honestly enumerates what no control catches: subtle semantic bugs, mid-feature TDD edits (without C4), upstream provider drift (Datalab format change), long-lived-branch rot (rebase discipline only), agents colluding with weak tests (only independent reviewer breaks this — Gate 5).

### Rollout plan (`drift_prevention.md §7`)

1. Doc committed to `feat/dis-drift-prevention` for user review.
2. Architect PR adds `files_allowed:` to `07_tickets/_ticket_template.md`; adds 4 GH Actions workflows + 5 scripts; updates `review_gates.md` Gate 5 for Control 10.
3. First wave after merge (Epic B) runs full Phase 1; false positives tuned, not silenced.
4. Phase 2 controls filed as tickets, pulled only on incident justification or Epic F retrospective.

## Sequence diagrams

From `sequence_diagrams.md`, five flows. ASCII ladders in source; here are 2-3 line textual traces.

**Flow 1 — Upload → ready_for_review (scan path)** (`sequence_diagrams.md:6-42`): Browser gets signed upload URL from DIS; PUTs file to Storage; POSTs `/ingest` with key. DIS INSERTs extraction(status=uploaded), enqueues route, returns 201 with id. Worker runs: getObject → route (scan) → preprocess → status=ocr → `ocr.extract(pages)` (Datalab poll/webhook) → status=structuring → `structure(markdown)` → `policy.evaluate()` → status=ready_for_review → publish Realtime event; browser badge updates.

**Flow 2 — Nurse approval → promotion** (`sequence_diagrams.md:44-70`): Nurse UI GETs extraction, edits fields, POSTs `/approve {version, edits}`. DIS validates version (optimistic lock), calls `orchestrator.approve(id, edits)`: `SELECT … FOR UPDATE`, writes audit rows, status=verified, `promote.execute(verified)` → INSERT `lab_results` (with CS-10/CS-11 guards), INSERT `vaccinations`, PATCH `visits.attached_documents`, status=promoted. Returns `{promoted: {labs:N, vax:M}}`.

**Flow 3 — Native PDF fast-path (no OCR)** (`sequence_diagrams.md:72-92`): POST /ingest with key; INSERT(uploaded); worker getObject → router decides NATIVE_TEXT → `pdfjs.extractText` → markdownified text → status=structuring → `structure(text)` → status=ready_for_review. Same terminal state as OCR path, OCR stage skipped.

**Flow 4 — Kill switch activated** (`sequence_diagrams.md:94-107`): Admin `SET DIS_KILL_SWITCH=1`. Browser POST `/ingest` → DIS reads flag → returns 503 with Retry-After (per ADR-003; the diagram parenthetical still shows the rejected "OR proxies transparently" alternative — drift marker, see §Drift below). Browser falls back to legacy Edge Function.

**Flow 5 — Shadow mode (parallel, no user impact)** (`sequence_diagrams.md:109-125`): Browser POST `/process-document` → legacy runs Claude Vision → writes `lab_results` → returns. Legacy fires-and-forgets a copy to DIS; DIS runs full pipeline but writes to `ocr_extractions` ONLY — never clinical tables. Diffs logged for offline analysis.

## Cross-references observed

Load-bearing links from 02/ into sister dirs:

- **→ 00/**: (indirect) overview referenced by ADR context where relevant.
- **→ 01/** `clinical_safety.md` CS-1..CS-12: cited by ADR-001 Context, by TDD §5 (idempotency) + §13 (promotion guards) + §20 (what DIS deliberately does differently); `drift_prevention.md` §8 F7; `coding_standards.md §2` ("fail closed"). CS-1 (no OCR row in clinical tables without verification/auto-approval), CS-2 (raw response byte-identical preservation), CS-3/CS-6 (audit log), CS-7 (confidence policy default OFF), CS-9 (`test_name_raw` alongside `test_name_normalized`), CS-10/CS-11 (promotion dedupe + duplicate-row guard).
- **→ 04/** `openapi.yaml`, `error_model.md`: TDD §3 (endpoints), §15 (error envelope); ADR-003 (UNAVAILABLE code); ADR-004 (provider error taxonomy); `coding_standards §4, §10`.
- **→ 05/** `test_strategy.md`: `coding_standards §9`; `drift_prevention.md §9 References`.
- **→ 06/** `rollout_plan.md`, `feature_flags.md`, `kill_switch.md`: ADR-003 (reconciles 503 vs 307); ADR-007 (`feature_flags.md §6` structuring provider flag).
- **→ 07/** `backlog.md` + `_ticket_template.md`: `drift_prevention.md §3 Control 2` (template adds `files_allowed:`); ADR-002/004/005/006/007 all cite DIS-### tickets.
- **→ 08/** `review_gates.md`, `session_handoff.md`, `RACI.md`, `agentic_dev_protocol.md`: `drift_prevention.md §5` (gate composition); ADR README §Gate integration (6d breaking-change needs ADR).
- **→ 09/** `provider_outage.md`, `kill_switch.md`, `key_rotation.md`: ADR-002, ADR-003, ADR-004 (key_rotation note deferred to DIS-097 handoff).
- **→ 10/** `document_ocr_flow.md §12-13`: Datalab benchmarks + pricing + live platform constraints, Claude pricing — ADR-002, ADR-004, ADR-007 all cite.
- **→ handoffs/** `DIS-004.md`, `DIS-050.md`, `DIS-050a.md`, `DIS-051.md`, `DIS-054.md`, `DIS-097.md`: ADR-005 D-1 retroactive; ADR-004 wire pattern; ADR-006 driver choice; ADR-007 adapter behaviour.

## Drift, gaps, contradictions (CRITICAL)

Specific findings, with quote + cite:

### 1. Five pre-existing `core_no_sql_literals` violations — architectural aspiration

`ADR-001:69-71` and `ADR-006:70-73` both state: "5 pre-existing `core_no_sql_literals` violations in `orchestrator.ts` + `__fakes__/database.ts` are resolved in DIS-021b by extracting named `DatabasePort` methods." Until DIS-021b merges, the fitness rule is already in `fitness-rules.json` **and will fire on those files**. Either the rule is disabled for those paths (brittle exception) or the CI is currently red on them. Recommend the next session check `fitness-rules.json` for any `allowlist` entries for `core/orchestrator.ts` and `__fakes__/database.ts`, and verify DIS-021b status.

### 2. Kill-switch runbook prose may not match ADR-003 decision yet

`ADR-003:44-47` directs: "`06_rollout/kill_switch.md` prose is amended to replace the '307-proxy to legacy' description with the 503 decision." Flow 4 in `sequence_diagrams.md:104` still contains the parenthetical **"(reads flag, 503 w/ redirect hint OR proxies transparently)"** — the "OR proxies transparently" clause is the rejected 307 alternative. This is a direct in-doc drift: the ADR is Accepted but the sequence diagram still hedges. Next session should amend `sequence_diagrams.md` Flow 4 to drop "OR proxies transparently" and cite ADR-003.

### 3. `portability.md` Runtime compatibility cites the Postgres client as "`postgres`" but older paragraphs might drift

`portability.md:50-54` says "Postgres client: `postgres` (no Supabase-specific extensions used in queries)". ADR-006 is the formal record. No drift observed in 02/, but **`coding_standards.md §7`** says "No DB-specific vendor extensions that break portability" — consistent. `portability.md:74` explicitly excludes `pg_net` from "do not use" list only by saying "(only in the pg_cron adapter, which is stack-specific)". This is an acknowledged leak behind an adapter boundary; not drift.

### 4. Sonnet escalation is "declared successor" but unticketed

`ADR-007:51-60` describes Sonnet escalation (`ClaudeSonnetAdapter` + orchestrator escalation step + cost-ledger accounting) as "deferred to a later ticket." Follow-up section says "Future ticket (not yet in backlog) — Sonnet escalation." This is a named-but-unfiled feature. If the backlog later gains a DIS-### for it, ADR-007 should be amended to cite the ticket.

### 5. Cost rates in ADR-007 are placeholders

`ADR-007:73-74` cost accounting "83 / 416 µINR per token — placeholder pending the DIS-032 cost-calculator cleanup." DIS-165 budget guardrail depends on accurate rates. Drift risk: budget alerts based on placeholder numbers. Next session should check DIS-032 status and whether `ClaudeHaikuAdapter` costMicroINR math is still placeholder.

### 6. ADR index status column lacks ADR-003's reconciliation note

`adrs/README.md:55-63` index shows ADR-003 as "Accepted" with no marker that it reconciles an inconsistency. That's fine per format, but the index does not surface which ADRs supersede earlier text vs. add net-new decisions. Low severity; format convention.

### 7. Files-touched allowlist not yet in `_ticket_template.md`

`drift_prevention.md §7` rollout plan step 2 says Architect PR "Adds `files_allowed:` block to `07_tickets/_ticket_template.md`." As of this report's source commit, this is "Proposed." The Phase 1 controls are not yet live; a reader should not assume they are running. Next session should check `.github/workflows/dis-*.yml` existence and `_ticket_template.md` for `files_allowed`.

### 8. Webhook receiver endpoint not yet built

`ADR-004:53-55` explicitly notes "The webhook receiver endpoint is out of scope for DIS-050a (the adapter hotfix). It lands in Epic D as an extension of DIS-097." Until DIS-097-extended lands, the webhook path is configured but not consumed — adapter behaviour falls back to polling for any request where `webhookUrl` is not supplied by wiring. This is designed drift, not accidental, but worth flagging for operators reading the ADR out of order.

### 9. `adapters.md:90-94` says "core is pure TypeScript, no Supabase SDK, no AWS SDK, no `fs`, no `fetch`" — check against `drift_prevention.md §3 Control 3` rules

The fitness rules listed in `drift_prevention.md:220-232` include `core_no_fetch` and SQL-literal bans but do NOT explicitly enumerate "no `fs`". If `fs` in core is meant to be banned (per `adapters.md:88-89`), the fitness rule set should include it. Minor gap: aspirational in `adapters.md` without a corresponding rule.

### 10. Raw-response preservation contract (CS-2) depends on provider behaviour

ADR-002 Consequences state `rawResponse` is byte-identical (CS-2). ADR-004 reaffirms it for the webhook path. But `drift_prevention.md §8` calls out "upstream provider drift" as something no Phase-1 control catches — if Datalab silently changes the response envelope, the byte-identical stored `rawResponse` will still be "faithful" but the adapter's parsing of it against old code may break. This is an accepted limitation, not a contradiction.

## Refresh instructions for next session

> Re-read only files changed since commit `69ce4bc` in `source_paths`. Run:
> `git log --name-only 69ce4bc..HEAD -- dis/document_ingestion_service/02_architecture/`
> For each changed file, read it fully.
>
> If a new ADR was added: add a new H3 subsection under "ADRs" with Status/Context/Decision/Consequences/Cross-refs/Drift note. Update `adrs/README.md` index count in this report's Executive Summary.
>
> If an ADR was Superseded: mark the old subsection header with "- **Status:** Superseded by ADR-XXX" and write the new ADR's subsection. Do NOT delete the old subsection.
>
> If `tdd.md` grew a new §: update System diagram + Ports/Adapters tables + Sequence diagrams textual traces.
>
> If `drift_prevention.md` controls moved Phase 2 → Phase 1: update the tables in "Drift prevention" section.
>
> If findings in §"Drift, gaps, contradictions" were resolved (e.g. DIS-021b merged, sequence diagrams Flow 4 amended, `_ticket_template.md` gained `files_allowed`), move them from that section into "What changed since last refresh" with resolution notes.
>
> Bump `last_refreshed` and `source_commit` in frontmatter. Keep `covered_files` list complete — add any new files in `02_architecture/**`.
