# API Contracts — REST, Async Generation Jobs, SSE Streaming

> **Status:** Authoritative TARGET-STATE rebuild specification. Build to **this**, not to the live `web/` + Supabase Edge-Function prototype (anon-key `fetch()` straight from `<script>`, one synchronous `POST /functions/v1/generate-prescription`, `Access-Control-Allow-Origin: *`). Where this document and an upstream study report disagree, this document wins; where it disagrees with a **verified API fact**, the file author flags it.
>
> **Scope of this file.** The single deepest treatment of the **external HTTP contract** of the rebuilt system: REST resource model, the **async generation job API** (`POST …/generations → 202 {job_id}` + `GET /jobs/{id}` polling fallback), the **SSE streaming endpoint** (`GET /jobs/{id}/events`), authentication/authorization, versioning, idempotency, the canonical error envelope, and **how the frontend drives speculative + streamed generation** end-to-end. It is the *wire-level* companion to its siblings: `../02_architecture/latency_ux_architecture.md` owns the *timing/interaction* design these endpoints serve; `../02_architecture/backend_services.md` owns the *service decomposition* behind the gateway; `../02_architecture/frontend_architecture.md` owns the *client ports* (`GenerationPort`, `DataAccessPort`, `RealtimePort`) that consume this contract; `../05_ai/*` (when present) owns prompt/tool internals; `../03_data/schema_design.md` owns the `prescribing.rx_generation_jobs` / `prescription_drafts` / `ops.outbox` tables this API projects; `../09_engineering_discipline/quality_gates_ci.md` owns the OpenAPI-diff CI gate. This file does not re-derive those; it specifies the **contract** they hang off and cites them where depth lives.
>
> **Foundation (real, on-branch).** The hexagonal TypeScript skeleton on `origin/feat/dis-plan` under `dis/` is the canonical template. This contract reuses its HTTP patterns 1:1 and names the exact files: the **error envelope** (`dis/src/http/middleware/error-envelope.ts` → `HttpError` + `errorEnvelope()`), the **idempotency middleware** (`dis/src/http/middleware/idempotency.ts`, mandatory `Idempotency-Key` on state-changing methods), the **correlation-id middleware**, the **`StatusChannel`** in-process pub/sub (`dis/src/http/realtime/status-channel.ts`), the **thin route module** convention (`dis/src/http/routes/ingest.ts`, `process-job.ts`), and the **Postgres job queue** (`dis/migrations/M004_dis_jobs.sql`). The clinical brain (`dose-engine.ts`, `compute_doses`, three-tier severity, `prescription_audit`) is on `origin/sprint-2-saved`.

---

## 0. The contract in one paragraph

The rebuilt system exposes **one HTTP surface** behind a Hono API Gateway (`/v1/...`), **OpenAPI 3.1 is the single source of truth** (diffed against live routes in CI — `09_engineering_discipline/quality_gates_ci.md`), and the surface is shaped by one rule: **synchronous CRUD over REST resources; everything that can exceed a few hundred milliseconds is an async job.** Prescription generation — the 50–150 s tool-using Claude loop that today blows the 150 s Edge wall — becomes `POST /v1/visits/{visitId}/generations → 202 {job_id, status:"queued"}` plus a durable read-model row in `prescribing.rx_generation_jobs`; progress is delivered as **Server-Sent Events** on `GET /v1/generations/{jobId}/events` (with `GET /v1/generations/{jobId}` polling as the no-SSE fallback). **Every request carries `Authorization: Bearer <JWT>` and returns `X-Correlation-Id`; every state-changing request carries a mandatory `Idempotency-Key`; every error is the canonical `{error:{code,message,correlation_id,retryable,...}}` envelope.** Authn is Supabase-issued JWT (portable to any OIDC IdP) carrying `role ∈ {reception,nurse,doctor,service,admin}` and `facility_id`; authz is the gateway-set Postgres session vars (`app.role/app.facility_id/app.doctor_id`) that drive real RLS (`dis/M008` pattern) — **the anon key never reaches a clinical schema.** Versioning is URL-major (`/v1`) plus per-resource optimistic concurrency via a `version` integer (→ `409 VERSION_CONFLICT`). The frontend never holds the doctor on a request: it **speculatively** fires generations from the auto-saved note during the consult and **streams** the chosen draft, so the click-to-review wait is perceptibly zero.

---

## 1. Design principles (the rules every endpoint obeys)

| # | Principle | Why | Realization |
|---|---|---|---|
| **A1** | **Resource-oriented REST for CRUD, jobs for compute.** Anything that can exceed ~500 ms or call an LLM/external gateway is a *job resource* (`202 + job_id`), never a blocking request. | The 150 s Edge wall (504/546 at exactly 150,000 ms) is the root flaw; no request-bound timeout can host a multi-round streaming agent loop. | §3 REST, §4 jobs, §5 SSE. |
| **A2** | **OpenAPI 3.1 is the source of truth.** Handlers, client types, and fakes are generated/validated from it; CI fails on drift. | Eliminates the prototype's hand-rolled, undocumented `fetch` calls. | `09_engineering_discipline/quality_gates_ci.md`; `openapi.yaml` in repo root of the service. |
| **A3** | **Thin HTTP, fat core.** A route validates headers/shape, maps to a command, and serializes the result. No business logic, no SQL, no `fetch` to a vendor in a route (`core_no_fetch` fitness rule). | Matches `dis/` `routes/ingest.ts`: validate → orchestrator → serialize. | §3.0, §10. |
| **A4** | **Mandatory idempotency on writes.** Every `POST/PUT/PATCH/DELETE` requires `Idempotency-Key`; replays return the original result, not a duplicate. | Fixes the prototype's 3× `raw_dictation` write and makes "click Generate twice" safe. | §2.4, `dis/idempotency.ts`. |
| **A5** | **One error envelope, stable codes, `correlation_id` everywhere.** `{error:{code,message,correlation_id,retryable,details?}}`; `code` is UPPER_SNAKE and machine-stable. | Replaces the prototype's `{error: e.message}` string blobs; lets clients branch on `retryable`. | §8, `dis/error-envelope.ts`. |
| **A6** | **Humans and AI are symmetric callers.** A speculative background trigger, a doctor's click, and a future autonomous AI agent all `POST` the **same** generation endpoint with the same body; only `trigger` differs. | Enables AI-first as an additive subscriber, not a rewrite (`09 command-bus` seam). | §4.1 `trigger` enum. |
| **A7** | **Least-PII over the wire to the model boundary; no PII in URLs, logs, or QR.** IDs in paths are opaque UUIDs, not UHIDs; `get_previous_rx`/visit-summary stay PII-stripped (typed boundary). | DPDP child-data + NABH; the prototype put UHID in tool args and a forgeable 6-char hash in the QR URL. | §6, §7, `08_security`. |
| **A8** | **Versioned, additive evolution.** URL-major `/v1`; new fields are optional and additive; removals/renames require `/v2`. Deprecations announced via `Sunset` header. | A hardcoded dated model string broke prod once; the contract must never break a deployed client silently. | §9. |

---

## 2. Cross-cutting request/response conventions

These apply to **every** endpoint unless stated otherwise, and are implemented as ordered Hono middleware in the gateway (mirrors `dis/src/http/middleware/*`).

### 2.1 Base URL, content type, encoding

- **Base:** `https://api.rx.radhakishanhospital.com/v1` (prod) / per-env. The static SPA on GitHub Pages calls this origin only.
- **Content type:** `application/json; charset=utf-8` for all bodies except binary uploads (`POST /documents`, which streams the raw octet-stream with `X-Filename`, per `dis/ingest.ts`).
- **SSE:** `text/event-stream` (§5).
- **Dates:** RFC 3339 UTC (`2026-06-25T09:14:03Z`). **Money:** integer micro-INR (`cost_micro_inr`), never floats.

### 2.2 Standard request headers

| Header | Required | Purpose |
|---|---|---|
| `Authorization: Bearer <JWT>` | Always (except `/health`) | Authn; carries `role`, `facility_id`, `sub` (user id), `doctor_id?`. §6. |
| `Idempotency-Key: <uuid-v4>` | All `POST/PUT/PATCH/DELETE` | Dedupe; missing → `400 IDEMPOTENCY_KEY_REQUIRED` (`dis/idempotency.ts`). §2.4. |
| `If-Match: "<version>"` | Optimistic writes (`PATCH`/`PUT` of mutable rows) | Optimistic concurrency; mismatch → `409 VERSION_CONFLICT`. §9.2. |
| `X-Correlation-Id: <uuid>` | Optional (client may supply) | If absent, gateway mints one; always echoed back. §2.3. |
| `Accept: text/event-stream` | SSE only | Selects the streaming representation on `/events`. |
| `Last-Event-ID: <n>` | SSE reconnect | Resume a stream after drop (§5.4). |

### 2.3 Standard response headers

| Header | On | Purpose |
|---|---|---|
| `X-Correlation-Id` | Every response | Cross-reference logs/traces; equals `error.correlation_id` on failures. |
| `ETag: "<version>"` | Every mutable resource read | Feeds the client's next `If-Match`. |
| `Location` | `201`/`202` | The created/job resource URL (e.g. `/v1/generations/{jobId}`). |
| `Retry-After` | `429`, `503` | Backoff hint (seconds). |
| `Sunset` / `Deprecation` | Deprecated endpoints | §9.3. |

### 2.4 Idempotency semantics (decisive)

Ported from `dis/src/http/middleware/idempotency.ts`, upgraded from the stub to the persistent store backed by `ops.idempotency`:

1. Middleware gates on method: `GET/HEAD/OPTIONS` pass through; `POST/PUT/PATCH/DELETE` **require** `Idempotency-Key` (non-empty) → else `400 IDEMPOTENCY_KEY_REQUIRED`.
2. The store keys on `(facility_id, route, idempotency_key)`. On first use it records `request_hash` + the eventual response. A **replay with the same key and same body** returns the **stored response verbatim** (same status, body, `correlation_id` of the original) with `Idempotency-Replayed: true`.
3. A replay with the **same key but a different body hash** → `422 IDEMPOTENCY_KEY_REUSED`.
4. Keys expire after 24 h. Generation jobs additionally dedupe on `content_hash` (§4.3) so two identical speculative triggers collapse to one job even with different keys.

### 2.5 Pagination, filtering, sorting (collections)

Cursor-based, opaque, stable:

```
GET /v1/patients?facility=<implicit-from-jwt>&q=arjun&limit=25&cursor=eyJvIjoxMjV9
→ 200
{
  "data": [ { …patient summary… } ],
  "page": { "next_cursor": "eyJvIjoxNTB9", "has_more": true, "limit": 25 }
}
```

- `limit` default 25, max 100.
- Filtering is per-resource allow-listed (`q` free-text on indexed columns; `status=`, `date_from=`/`date_to=`). **No arbitrary PostgREST `or=(...)` passthrough** — the prototype exposed raw filter injection over the anon key; the gateway translates a fixed query grammar to parameterized `sql` (no SQL literals in core, `core_no_sql_literals`).
- Sorting: `sort=-created_at` (prefix `-` = desc), allow-listed columns only.

---

## 3. REST resource model (synchronous CRUD)

The surface mirrors the DDD bounded contexts (`03_data/schema_design.md`). One table = roughly one resource; sub-resources nest under their aggregate root. **All IDs in paths are opaque UUIDs**; the human UHID/receipt/token are *fields*, never path segments (A7).

### 3.0 Resource map

| Resource | Path | Context | Notes |
|---|---|---|---|
| Patients | `/v1/patients`, `/v1/patients/{id}` | `clinical` | UHID minted server-side (§3.2). |
| Visits | `/v1/patients/{id}/visits`, `/v1/visits/{id}` | `clinical` | The OPD encounter; composite `(visit_id, patient_id)` integrity. |
| Vitals | `/v1/visits/{id}/vitals` | `clinical` | Nurse-station anthropometry; growth z-scores computed by deterministic `GrowthEnginePort`, not the client. |
| Lab results | `/v1/patients/{id}/labs`, `/v1/visits/{id}/labs` | `clinical` | Structured COMMON_LABS entry. |
| Vaccinations | `/v1/patients/{id}/vaccinations` | `clinical` | IAP/NHM mutual exclusivity enforced server-side. |
| Growth records | `/v1/patients/{id}/growth` | `clinical` | Read model of WAZ/HAZ/WHZ/HCZ. |
| Documents | `/v1/visits/{id}/documents` (binary `POST`) | `clinical`/DIS | Upload → DIS OCR staging (`dis/ingest.ts` shape). |
| **Generations (jobs)** | `/v1/visits/{id}/generations`, `/v1/generations/{jobId}`, `/v1/generations/{jobId}/events` | `prescribing` | **§4, §5 — the async heart.** |
| Drafts | `/v1/generations/{jobId}/draft`, `/v1/visits/{id}/draft` | `prescribing` | The reviewable `pending_review` prescription. |
| Prescriptions | `/v1/prescriptions`, `/v1/prescriptions/{id}` | `prescribing` | Signed, immutable; edits → `rx_versions`. |
| Sign-off | `POST /v1/drafts/{id}/signoff` | `prescribing` | The human gate (command). §4.7. |
| Formulary | `/v1/formulary`, `/v1/formulary/{generic}` | `catalog` | Read-mostly; governed KB. |
| Standard Rx | `/v1/standard-prescriptions?icd10=` | `catalog` | ICD-10-first lookup. |
| Concepts | `/v1/concepts?system=ICD10&q=` | `catalog` | Terminology spine. |
| Visit summary (job) | `/v1/visits/{id}/summary` (`POST` job + `GET`) | `prescribing`/AI | Returning-patient AI summary; small, may be sync-with-timeout or a short job. |
| FHIR / ABDM | `/v1/prescriptions/{id}/fhir`, `/v1/abdm/...` | `abdm` | Off-edge, event-driven; §7. |
| QR verify | `GET /v1/verify/{receipt}` | `prescribing` | Read-only, signature-verifying, **no PHI in URL**; §7.3. |

### 3.1 Representative shapes — Patient

`POST /v1/patients` (reception):

```jsonc
// Request — note: NO client-side UHID; the server mints it.
{
  "given_name": "Arjun",
  "family_name": "Sharma",
  "sex": "M",                             // API form is 'M' | 'F' | 'O' (C2); the DB adapter maps to/from the DB's lowercase tokens ('male'|'female'|'other'). This is the only place sex strings are translated (anti-corruption seam) — no other code branches on them.
  "dob": "2024-11-02",
  "guardian_name": "Sunita Sharma",
  "guardian_phone": "+91XXXXXXXXXX",
  "known_allergies": ["penicillin"],
  "guardian_consent": {                  // DPDP child-data — distinct from ABDM consent
    "version": "notice-v1",
    "granted": true,
    "granted_at": "2026-06-25T09:10:00Z",
    "method": "verbal-in-person"
  }
}
```

```jsonc
// 201 Created  · Location: /v1/patients/9f2c…   · ETag: "1"
{
  "id": "9f2c8e1a-…",                    // opaque UUID — used in all subsequent paths
  "uhid": "RKH-25260600042",             // server-minted, UNIQUE business key (§3.2)
  "given_name": "Arjun", "family_name": "Sharma", "sex": "M",
  "dob": "2024-11-02", "age_days": 235,
  "is_neonatal": false,                  // server-derived (DOB < 90d) — client does NO arithmetic
  "known_allergies": ["penicillin"],
  "facility_id": "rkh-kkr",
  "version": 1,
  "created_at": "2026-06-25T09:14:03Z",
  "updated_at": "2026-06-25T09:14:03Z"
}
```

### 3.2 Server-side identifier allocation (kills the `MAX(seq)+1` race)

The prototype computed UHID/receipt/token on the **client** via `SELECT max(seq)` then `+1` — a lost-update race under concurrent reception. **Deleted.** The API never accepts a client-supplied UHID/receipt/token; the create handler calls the `SECURITY DEFINER` counter functions (`clinical.next_uhid()`, `clinical.next_receipt_no()`, `clinical.next_token_no()`, `prescribing.next_rx_receipt()` — `03_data/schema_design.md §4`) under a row lock and returns the minted value. Format guard `^RKH-\d{11}$` is a belt-and-braces CHECK.

### 3.3 Representative shapes — Visit (the generation root)

`POST /v1/patients/{id}/visits` → `201` with `{ id, token_no, receipt_no, chief_complaints, vitals?, version, … }`.

`PATCH /v1/visits/{id}` (auto-save of the doctor's note — the **speculation trigger source**; see §4.2):

```jsonc
// Request  · Idempotency-Key: <uuid>  · If-Match: "7"
{ "raw_dictation": "8 mo, fever 3d, R ear pulling, TM bulging…" }
```

```jsonc
// 200 OK  · ETag: "8"
{
  "id": "…", "patient_id": "…",
  "raw_dictation": "8 mo, fever 3d…",
  "note_content_hash": "sha256:3a9f…",   // server-computed; the speculation key input (§4.3)
  "version": 8,
  "updated_at": "2026-06-25T09:22:10Z"
}
```

The composite-key integrity `(visit_id, patient_id)` the prototype enforced only in app code is now a DB composite FK; the API rejects a draft/prescription whose `patient_id` disagrees with its `visit_id` at `409 RESOURCE_CONFLICT` before the DB even sees it.

---

## 4. Async generation job API (the critical path)

This is the headline contract. It replaces the prototype's single synchronous `POST /functions/v1/generate-prescription` (which returned the finished prescription or died at 150 s) with a **fire-and-stream job model**: the click returns instantly; compute runs off-edge on a persistent worker pulling from the Postgres queue (`dis/M004` pattern → SQS on `DIS_STACK=aws`); progress streams over SSE; the result is a **`pending_review` draft** that a human must sign.

### 4.1 Create a generation — `POST /v1/visits/{visitId}/generations`

**Callers are symmetric (A6):** the doctor's explicit Generate click, the speculation policy's background trigger, and a future AI agent all hit this endpoint. They differ only in the `trigger` field and (for speculative) the `Prefer: respond-async, speculative` hint.

```jsonc
// Request  · Authorization: Bearer <doctor|service JWT>
//          · Idempotency-Key: <uuid>
{
  "trigger": "doctor_click",            // "doctor_click" | "speculative" | "agent"  (A6)
  "note_version": 8,                    // the visits.version the note was at — staleness guard
  "selected_sections": ["investigations","counselling","diet"],
  "rx_language": "bilingual",           // "bilingual" | "english" | "hindi"
  "options": { "include_vaccination_schedule": "IAP" }
  // NOTE: NO patient PII, NO formulary blob, NO allergies array in the body.
  //   - patient_id/allergies/labs are resolved server-side from visitId (least-PII, A7).
  //   - the worker fetches formulary/std-rx/refs via the progressive-disclosure tools (the 6 tool
  //     input_schemas + condensed outputs are frozen in 05_ai/tool_contracts.md, NOT here).
}
```

```jsonc
// 202 Accepted  · Location: /v1/generations/3b7e…  · X-Correlation-Id: …
{
  "job_id": "3b7e1f90-…",
  "status": "queued",                   // §4.4 state machine
  "speculative": false,
  "content_hash": "sha256:3a9f…7c",     // = hash({note, patient_context_version, selected_sections, rx_language})
  "events_url": "/v1/generations/3b7e1f90-…/events",   // SSE (§5)
  "poll_url":   "/v1/generations/3b7e1f90-…",          // fallback (§4.6)
  "created_at": "2026-06-25T09:22:11Z"
}
```

**Guardian-consent precondition (fail-closed, C6):** before any job is enqueued — **for every `trigger`, including `speculative` and `agent`** — the handler resolves `patient_id` server-side from `visitId` and asserts an **active `ai_assisted_rx` guardian consent** (a `clinical.guardian_consents` row with `consent_given = true AND withdrawn_at IS NULL`, served by `idx_consent_active`, `03_data §5.2`). If none exists, AI-assisted generation is **blocked**: `403 CONSENT_REQUIRED` (not retryable, `details:{ purpose:"ai_assisted_rx" }`). Withdrawal blocks new generations immediately and supersedes/cancels any in-flight speculative job for that patient. This `ai_assisted_rx` gate is distinct from `opd_care` processing consent and from ABDM sharing consent — three separate purposes, none substitutes for another.

**Speculative collapse (decisive):** if a `queued`/`generating`/`streaming` job already exists for this `visit_id` with the **same `content_hash`**, the endpoint returns `200` (not `202`) with that existing `job_id` — `Idempotency-Replayed: true` — instead of starting a second run (unique index `(visit_id, content_hash)` on the live jobs, `03_data §6.1`). A doctor clicking Generate on a note the speculation engine already pre-warmed therefore **adopts the in-flight or finished speculative job at 0 ms**.

### 4.2 Where the trigger comes from (the speculative loop)

The doctor's note auto-saves on a debounced `PATCH /v1/visits/{id}` (§3.3). The client's `EventBus` treats each meaningful save and each `SectionChips` change as a `DraftNoteUpdated` command; a debounced (≈1.5 s idle) client policy fires `POST …/generations` with `trigger:"speculative"`. The server computes the same `content_hash`, and **last-write-wins**: a newer hash supersedes the in-flight one (§4.5). The depth of *when/why* this fires lives in `../02_architecture/latency_ux_architecture.md §2 (M2)`; this contract only fixes the *wire shape* that makes it cheap and safe (idempotent, hash-collapsed).

### 4.3 The `content_hash` (the speculation + dedupe key)

```
content_hash = sha256( canonical_json({
  note:                    visits.raw_dictation,
  patient_context_version: max(patients.version, latest vitals/labs/vax version),
  selected_sections:       sorted,
  rx_language:             string
}) )
```

Computed **server-side** (the client's hint is advisory). It is the cache key for speculative collapse (§4.1), the supersede discriminator (§4.5), and an audit field on `rx_generation_jobs` and `prescription_audit`. **No timestamps/UUIDs feed the hash** — same input, same hash, so re-clicking an unchanged note is free.

### 4.4 Job state machine (read model + SSE event types)

The job's `status` is the read-model projection of the pure `prescribing` state machine (the `dis/` `transition()` discipline — invalid transitions throw and are never persisted; `09 command-bus` / `02 latency §6`). The states and the domain events that move them are the **contract for SSE consumers**:

```
queued ──GenerationStarted──▶ generating ──ToolInvoked*──▶ streaming
                                                              │
                          ┌─DraftDelta*────────────────────────┤
                          │                                     ▼
                          │                          ┌─ GenerationCompleted ─▶ draft_ready
                          └─ (newer hash) ───────────┼─ GenerationSuperseded ▶ superseded
                                                      └─ GenerationFailed ────▶ failed
```

| `status` | Meaning | Terminal? |
|---|---|---|
| `queued` | Enqueued, worker not yet started. | no |
| `generating` | Worker running the tool loop; `ToolInvoked` events flow. | no |
| `streaming` | Model emitting the prescription; `DraftDelta` events flow. | no |
| `draft_ready` | A complete `pending_review` draft exists (`prescription_drafts`). | **yes** |
| `superseded` | A newer-hash job replaced this one (note changed). | **yes** |
| `failed` | Unrecoverable error (after retries); `error` populated. | **yes** |

> **Clinical-safety invariant (non-negotiable, A6):** `draft_ready` is **`pending_review`**, never finalized. There is **no** `signed` status reachable from a generation job — signing is a *separate* human command (`POST /v1/drafts/{id}/signoff`, §4.7). The API has no path that turns model output into a signed prescription without a human actor.

### 4.5 Supersede semantics (last-write-wins)

When a newer-hash speculative `POST` arrives for the same visit, the server:
1. Creates the new job (`queued`).
2. Sends an internal cancel to the worker holding the older job (cooperative `AbortController`; the worker stops streaming, writes `status=superseded`, sets `superseded_by=<new job_id>`).
3. Emits `GenerationSuperseded` on the **old** job's SSE channel with `{ superseded_by, reason:"note_changed" }`, so a client still watching the old stream switches to the new `events_url` without a spinner.

### 4.6 Read job status — `GET /v1/generations/{jobId}` (polling fallback)

For clients without SSE (or as a belt-and-braces poll), the job is a normal readable resource:

```jsonc
// 200 OK
{
  "job_id": "3b7e…", "visit_id": "…", "status": "streaming",
  "speculative": false, "content_hash": "sha256:3a9f…7c",
  "progress": { "phase": "streaming", "tools_called": ["get_standard_rx","get_formulary"], "rounds": 2 },
  "draft_id": null,                     // populated when status=draft_ready
  "model": { "id": "<from ModelPolicyPort>", "tier": "primary" },  // resolved id, never a literal in source
  "usage": { "input_tokens": 9120, "output_tokens": 3110, "cache_read_input_tokens": 8704 },
  "cost_micro_inr": 41230,
  "latency_ms": 6820,
  "error": null,
  "version": 4, "updated_at": "2026-06-25T09:22:18Z"
}
```

Recommended client poll interval when SSE is unavailable: 1 s while non-terminal, with jitter; stop on a terminal `status`. (This is the "short-interval status-row poll" the Realtime-WebSocket removal left as the notify fallback — `02 latency §2 M4`.)

### 4.7 The draft and the sign-off gate

`GET /v1/generations/{jobId}/draft` (or `GET /v1/visits/{id}/draft` for the latest) returns the reviewable prescription. The shape is the **prescription draft JSON** — the rebuilt, dose-engine-authoritative version of the prototype's `generated_json` (`web/prescription-pad.html`): a `medicines[]` array of 4-row bilingual blocks, `safety`, `investigations`, `warning_signs`, `followup_days`, `admission_recommended`, `vaccinations`, provenance:

```jsonc
// 200 OK · ETag:"1"  — status: pending_review
{
  "draft_id": "…", "job_id": "3b7e…", "visit_id": "…", "patient_id": "…",
  "status": "pending_review",
  "diagnosis": { "text": "Acute Otitis Media", "icd10": "H66.90", "snomed_code": "3110003" },
  "medicines": [
    {
      "row1_en": "AMOXICILLIN (250mg/5ml)",       // GENERIC CAPS (conc) — R1
      "row2_en": "5 ml three times a day for 5 days",   // R2 — STRINGS FROM DOSE ENGINE, not the model
      "row3_hi": "५ मि.ली. दिन में तीन बार ५ दिन तक",      // R3 Devanagari — from engine
      "pictogram": { "times": ["morning","afternoon","night"], "qty": 5, "unit": "ml",
                     "food": "after_food", "duration_days": 5 },   // R4 SVG sidebar inputs
      "formulation": "suspension",
      "dose_engine": {                              // recompute provenance (open/closed safety boundary)
        "computed_by": "DoseEnginePort@2.1.0",
        "mg_per_kg_per_day": 40, "weight_kg": 8.2,
        "single_dose_mg": 109.3, "rounded_ml": 5.0, "rounding_rule": "syrup_0.5ml",
        "max_single_ok": true, "max_daily_ok": true, "within_therapeutic_range": true,
        "ai_proposed_numbers": false                // AI proposed drug+regimen, NOT numbers (A7/dose-sep)
      },
      "provenance": "ai_generated"                  // "ai_generated" | "clinician_edited" — drives UI distinction
    }
  ],
  "investigations": [ { "text": "—", "color": "red" } ],
  "safety": {
    "allergy_note": "NKDA",
    "interactions": "None",
    "overall_status": "REVIEW_REQUIRED",            // SAFE | REVIEW_REQUIRED  (UPPER_SNAKE stored/wire, C3; the space-form "REVIEW REQUIRED" is display-only)
    "severity": "moderate",                          // none | moderate | high
    "warnings": ["penicillin-class — confirm no prior reaction"]
  },
  "warning_signs": ["worsening ear pain","high fever >3d","neck stiffness"],
  "followup_days": 3, "admission_recommended": null,
  "vaccinations": { "schedule": "IAP", "due": [] },
  "provenance_line": "AI-assisted, doctor-reviewed",  // printed on the Rx
  "version": 1, "created_at": "2026-06-25T09:22:18Z"
}
```

**Sign-off** is the human command that promotes a draft to an immutable prescription:

```jsonc
// POST /v1/drafts/{draftId}/signoff
//   Authorization: Bearer <doctor JWT>  · Idempotency-Key: <uuid>  · If-Match: "<draft version>"
{
  "edits_applied": true,                 // did the doctor edit before signing?
  "signoff_ack": {                       // re-applied after ANY edit — high→edit→save cannot bypass
    "severity_acknowledged": "moderate",
    "weight_confirmed_kg": 8.2           // missing-weight gate must be satisfied server-side
  }
}
```

```jsonc
// 201 Created  · Location: /v1/prescriptions/c1d2…
{
  "id": "c1d2…", "rx_receipt": "RKH-RX-260625-014",
  "draft_id": "…", "visit_id": "…", "patient_id": "…",
  "signed_by": "<doctor_id>", "signed_at": "2026-06-25T09:24:40Z",
  "content_hash": "sha256:…",            // tamper-evidence on the signed Rx
  "jws_signature": "eyJhbGciOiJFUzI1Ni…", // ES256 — feeds the QR verify endpoint (§7.3)
  "status": "signed", "version": 1        // status is SYNTHETIC (C4): derived from row existence in prescribing.prescriptions, NOT a column. There is no `signed` value in any generation-job enum.
}
```

Server-side guards (fail-closed, NABH/clinical-safety): reject sign-off if `overall_status` is high-severity without `severity_acknowledged`, if weight is missing on a weight-based regimen, or if the draft was edited after the `If-Match` version (`409 VERSION_CONFLICT` → re-review). A signed prescription is **immutable** (append-only audit triggers, `dis/M002` pattern); a correction creates a new row in `prescribing.rx_versions`, never an UPDATE.

> **Prescription `status` is a computed/synthetic field (C4).** There is **no `status` column** on `prescribing.prescriptions` — membership in that table *is* the signed state, reachable only through this `SignOff` command. The API derives `status:"signed"` at serialization (`03_data §6.3`). The mutable lifecycle *before* signing lives on the draft (`pending_review | superseded | promoted | discarded`) and the job (§4.4); consequently no generation-job enum ever carries a `signed` value — the API has no path that turns model output into a signed Rx without this human command.

---

## 5. SSE / streaming endpoint

### 5.1 `GET /v1/generations/{jobId}/events`

```
GET /v1/generations/3b7e…/events
Accept: text/event-stream
Authorization: Bearer <JWT>
Last-Event-ID: 11           // optional — resume after reconnect (§5.4)
```

```
200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no       // disable proxy buffering so deltas flush immediately
```

**Why SSE, not WebSocket:** the Realtime WebSocket was removed for IO cost (`02 latency §2`); generation is **server→client only**, so SSE is the right, cheaper primitive (one HTTP response, native `EventSource`, auto-reconnect, works through the Cloud-Run 60-min request window). The gateway relays from the in-process `StatusChannel` (`dis/src/http/realtime/status-channel.ts`) + the worker's per-job event stream; on a multi-instance deploy the relay subscribes to `ops.outbox`/Postgres `LISTEN/NOTIFY` keyed by `job_id` so any instance can serve any job's stream.

### 5.2 Event frames (the wire contract)

Each frame is `id: <monotonic>`, `event: <type>`, `data: <json>`. The `event` types are exactly the domain events of §4.4:

```
id: 1
event: GenerationStarted
data: {"job_id":"3b7e…","status":"generating","content_hash":"sha256:3a9f…7c","model_tier":"primary"}

id: 2
event: ToolInvoked
data: {"tool":"get_standard_rx","args_redacted":{"icd10":"H66.90"},"round":1}

id: 3
event: ToolInvoked
data: {"tool":"get_formulary","args_redacted":{"drug_names":["AMOXICILLIN"]},"round":1}

id: 4
event: DraftDelta
data: {"path":"diagnosis","delta":{"text":"Acute Otitis Media","icd10":"H66.90"}}

id: 5
event: DraftDelta
data: {"path":"medicines[0]","delta":{"row1_en":"AMOXICILLIN (250mg/5ml)"}}

id: 11
event: GenerationCompleted
data: {"draft_id":"…","status":"draft_ready","overall_status":"REVIEW_REQUIRED","draft_url":"/v1/generations/3b7e…/draft"}
```

**Failure / supersede frames are terminal and explicit (never a silent hang):**

```
event: GenerationFailed
data: {"status":"failed","error":{"code":"MODEL_OVERLOADED","message":"upstream 529 after 3 retries","retryable":true},"correlation_id":"…"}

event: GenerationSuperseded
data: {"status":"superseded","superseded_by":"<new job_id>","events_url":"/v1/generations/<new>/events","reason":"note_changed"}
```

A `:keepalive` comment frame is sent every 15 s to defeat idle-proxy timeouts. The stream closes (`done`) after any terminal event.

**Streaming granularity decision:** `DraftDelta` carries **structured path-keyed deltas** (`{path, delta}`), not raw model token text. The worker uses `client.messages.stream(...)` (SDK `.get_final_message()` for timeout-protected completion) and parses the streaming JSON into typed draft fragments before emitting — so the client renders progressively (diagnosis → meds appear → safety) by patching a typed draft object, and never has to parse half-formed model tokens. This also keeps PII/secret leakage out of the stream (`args_redacted`, no raw tool payloads).

### 5.3 Authorization on the stream

The `Authorization` header is validated on connect; the JWT's `role`/`facility_id`/`doctor_id` must permit reading this job (same RLS predicate as `GET /generations/{id}`). A `doctor` may stream only jobs for visits in their facility. `EventSource` cannot set headers in some browsers; the client therefore uses a `fetch`-based SSE reader (or a short-lived signed stream token as `?stream_token=` minted by a prior authenticated call) — **never** the anon key, **never** a PII-bearing query string.

### 5.4 Reconnect & resume

On disconnect, the browser reconnects with `Last-Event-ID: <n>`. The relay replays buffered events with `id > n` (held in `ops.outbox` for the job's lifetime), then resumes live. If the job already reached a terminal state, the relay sends the single terminal frame and closes — so a client that reconnects after completion still learns the outcome without polling.

---

## 6. Authentication & authorization

### 6.1 Authn — JWT (portable)

- **Issuer:** Supabase Auth (POC) → any OIDC IdP (prod) behind a `SecretsPort`/`ConfigPort`-driven JWKS URL. The contract depends only on a **verified RS256/ES256 JWT**, not on Supabase specifics.
- **Required claims:** `sub` (user id), `role ∈ {reception,nurse,doctor,service,admin}`, `facility_id`, optional `doctor_id`, `exp`, `iat`. The gateway verifies signature + `exp` against cached JWKS; failure → `401 UNAUTHENTICATED`.
- **`service` role:** the off-edge worker and internal callers (`POST /internal/process-job`, `dis/process-job.ts` pattern) authenticate with a service JWT **plus** a constant-time-compared `X-Worker-Token` shared secret. Internal routes are never reachable from the public origin.
- **The anon key is retired from clinical paths.** It survives only for genuinely public, non-PHI reads (e.g. `/health`). No clinical schema is reachable with it (RLS, §6.3).

### 6.2 Authz — role × resource matrix (enforced twice: gateway + RLS)

| Action | reception | nurse | doctor | service | admin |
|---|:--:|:--:|:--:|:--:|:--:|
| Create/read patient, visit | ✅ | ✅ (read) | ✅ (read) | ✅ | ✅ |
| Write vitals/labs/vax | — | ✅ | ✅ | ✅ | ✅ |
| `POST …/generations` (doctor_click) | — | — | ✅ | — | ✅ |
| `POST …/generations` (speculative/agent) | — | — | — | ✅ | ✅ |
| Read/stream a generation | — | — | ✅ (own facility) | ✅ | ✅ |
| `POST /drafts/{id}/signoff` | — | — | ✅ | — | — |
| Read signed prescription | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Delete anything clinical** | ❌ | ❌ | ❌ | ❌ | ❌ |

There is **no DELETE policy** on any clinical/prescribing/audit table (`dis/M008`); the API exposes no hard-delete of clinical data. "Remove" is a soft `is_active=false` PATCH where the domain allows it.

### 6.3 The session-var bridge to RLS

At request start, after JWT verification, the gateway sets Postgres session vars on the connection (`SET LOCAL app.role = …, app.facility_id = …, app.doctor_id = …, app.patient_id = …`), exactly the `dis/` `setSessionVars` + `M008` pattern that runs **unchanged on Supabase and AWS RDS**. RLS policies (`current_setting('app.role', true) in (…)`) are the real enforcement floor — even a gateway bug cannot read across facilities. This is the single biggest DPDP/NABH/CERT-In fix over the prototype's blanket `authenticated_full_access`.

---

## 7. Integration endpoints — ABDM / FHIR / QR verify

These run **off-edge and event-driven** (`PrescriptionSigned` → async handlers); **sign-off never blocks on them** (`07 ABDM` digest).

### 7.1 FHIR bundle (job)

`POST /v1/prescriptions/{id}/fhir` → `202 {job_id}`; the worker builds the NRCeS R4 Bundle via the pure `FhirCompositionPort`/`NrcesR4Adapter` (data-in, no DB → no N+1 formulary re-fetch). `GET /v1/prescriptions/{id}/fhir` returns the stored bundle with `Bundle.signature`. A FHIR-validator CI gate (`09`) snapshot-validates the output.

### 7.2 ABDM (HIP-first)

`POST /v1/abdm/abha/verify`, `POST /v1/abdm/abha/create` (M1 — registration-time ABHA, V3 API). HIP push (`OPConsultation`/`Prescription`/`DiagnosticReport`/`ImmunizationRecord`) and `on-*` callbacks land on signed-webhook receiver routes that `validate JWS against ABDM CM JWKS + timestamp/nonce → enqueue → 202` (fail-closed); `abdm_outbox`/`abdm_inbox` give reliable delivery. The `AbdmGatewayPort`/`CryptoBoxPort` (Fidelius — Curve25519 Short-Weierstrass) / `SignaturePort` internals live in `07_integrations`; this file fixes only their **HTTP edge** (async, signed, enqueue-then-202).

### 7.3 QR verify (read-only, no PHI in URL)

`GET /v1/verify/{rx_receipt}` returns `{ valid: bool, signed_at, doctor, facility, jws_verified: bool }` — it **verifies the ES256 `jws_signature`** (§4.7) server-side and returns a minimal, non-PHI attestation. This replaces the prototype's forgeable 6-char client-salt hash and the external `api.qrserver.com` dependency; the QR encodes only the receipt + a verify URL, rendered client-side as inline SVG.

---

## 8. Error model (canonical envelope)

Every non-2xx response is the envelope from `dis/src/http/middleware/error-envelope.ts`:

```jsonc
{
  "error": {
    "code": "VERSION_CONFLICT",          // stable UPPER_SNAKE — clients branch on this
    "message": "visit was modified by another request",
    "correlation_id": "c0ffee…",         // == X-Correlation-Id
    "retryable": false,                  // 429/5xx default true; 4xx default false
    "details": { "expected_version": 8, "actual_version": 9 }  // optional, structured
  }
}
```

### 8.1 Status → code catalogue (representative; full list in `error_model.md`)

| HTTP | `code` | `retryable` | When |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | false | Zod/Ajv schema reject on body. |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | false | Write without `Idempotency-Key`. |
| 401 | `UNAUTHENTICATED` | false | Missing/invalid/expired JWT. |
| 403 | `FORBIDDEN` | false | Role lacks permission (incl. bad `X-Worker-Token`). |
| 403 | `CONSENT_REQUIRED` | false | `POST …/generations` (any `trigger`) for a patient lacking an active `ai_assisted_rx` guardian consent (C6); `details:{ purpose:"ai_assisted_rx" }`. |
| 404 | `NOT_FOUND` | false | Unknown id / RLS-masked row. |
| 409 | `VERSION_CONFLICT` | false | `If-Match` mismatch (optimistic lock). |
| 409 | `RESOURCE_CONFLICT` | false | Composite-key/state-machine violation (e.g. sign a superseded draft). |
| 413 | `PAYLOAD_TOO_LARGE` | false | Document upload over ceiling (`dis/ingest.ts`). |
| 415 | `UNSUPPORTED_MEDIA` | false | Disallowed upload content-type. |
| 422 | `IDEMPOTENCY_KEY_REUSED` | false | Same key, different body. |
| 429 | `RATE_LIMITED` | **true** | Gateway/model rate limit; `Retry-After` set. |
| 500 | `INTERNAL` | true | Unhandled. |
| 502 | `MODEL_PROVIDER_ERROR` | true | Upstream model 5xx after retries. |
| 503 | `KILL_SWITCH` / `SERVICE_UNAVAILABLE` | true | Writes disabled / draining. |
| 504 | `UPSTREAM_TIMEOUT` | true | Dependency timeout (**not** generation — generation never blocks a request). |

> **Generation never returns 504.** Because generation is a job, the only way the doctor sees "it's taking long" is a still-`streaming` SSE stream with live `DraftDelta`s, plus a **client-side hard deadline** that degrades to a retry/manual-edit/single-shot UI — never an infinite spinner (`02 latency §2 M4`). A `failed` job surfaces `GenerationFailed` with a `retryable` flag, not an HTTP 504.

### 8.2 Generation-specific failure semantics

Job `error` objects reuse the envelope `code`s above plus generation-specific ones surfaced in the `GenerationFailed` SSE frame and the `GET /generations/{id}.error` field: `MODEL_OVERLOADED` (529, retryable — triggers tier-downgrade Opus→Sonnet via `ModelPolicyPort`, **flagged** to the draft, never silent), `MODEL_REFUSAL` (`stop_reason:"refusal"` guard before reading content), `TOOL_LOOP_EXCEEDED` (loop cap, promoted to a typed audited event), `SCHEMA_INVALID` (draft failed Ajv conformance → retry/escalate). Every attempt — including retries and downgrades — writes one `prescription_audit` row (`meta_mode`, `stop_reason`, tokens, rounds, `tools_called[]`, `severity_*`, `duration_ms`), satisfying NABH traceability.

---

## 9. Versioning

### 9.1 URL-major

`/v1` in the path. A breaking change (field removal/rename, semantics change, status-code change) requires `/v2`; both run in parallel during a deprecation window. Additive changes (new optional fields, new endpoints, new enum values clients must tolerate) ship within `/v1`. **Clients MUST ignore unknown fields and tolerate new enum values** (forward-compatibility contract).

### 9.2 Resource versioning (optimistic concurrency)

Every mutable resource carries an integer `version` (`03_data` platform column), surfaced as `ETag: "<version>"` and required back as `If-Match` on optimistic writes. A stale write → `409 VERSION_CONFLICT` with `details.expected/actual` → the client refetches and re-applies (the draft re-review path, §4.7). This is the wire face of the DB's `VersionConflictError`.

### 9.3 Deprecation protocol

A deprecated endpoint returns `Deprecation: true` and a `Sunset: <RFC1123 date>` header for ≥90 days before removal; the OpenAPI spec marks it `deprecated: true` (CI tracks it). The `ModelPolicyPort` insulates the API from *model* version churn entirely — model ids never appear in the contract or in business code (`core_no_model_id_literals`), only as the resolved `model.id`/`model.tier` echo in job status (§4.6).

---

## 10. How the frontend drives speculative + streamed generation (the end-to-end sequence)

The SPA never touches a vendor or the anon key directly: components depend on `GenerationPort`, `DataAccessPort`, `RealtimePort`, `ConfigPort` (`02 frontend_architecture`). The `GenerationPort` state contract is `idle | streaming | ready | stale | error | timeout`, each request carries an `AbortController`, retries use backoff+jitter, and a hard client deadline degrades the UI — never an infinite spinner.

```
DOCTOR TYPES THE NOTE                         CLIENT                          GATEWAY / WORKER
─────────────────────                   ───────────────────            ──────────────────────────
keystrokes ──debounce 3s──▶ PATCH /v1/visits/{id} {raw_dictation}  ──▶ 200 {note_content_hash, version}
                                  │ EventBus: DraftNoteUpdated
                                  │ debounce ~1.5s idle
            (still typing) ──────▶ POST …/generations               ──▶ 202 {job_id:A, content_hash:H1}
                                  │   {trigger:"speculative",          │   (worker pulls queue, runs
                                  │    note_version, sections}         │    tool loop OFF-EDGE)
                                  │ open SSE A (background, no UI)   ◀── event: GenerationStarted / ToolInvoked…
                                  │
   edits note ──▶ PATCH (new hash H2) ──▶ POST …/generations         ──▶ 202 {job_id:B, content_hash:H2}
                                  │                                    │   job A → superseded (AbortController)
                                  │ SSE A ◀───────────────────────────── event: GenerationSuperseded {by:B}
                                  │ switch background SSE → B
                                  │                                  ◀── event: DraftDelta* (B) → draft_ready
                                  │ cache draft(B) keyed by H2
   ▼
DOCTOR CLICKS "GENERATE"          │ compute current hash = H2
                                  │ POST …/generations {trigger:"doctor_click", note_version}
                                  └──────────────────────────────────▶ 200 (NOT 202) {job_id:B} Idempotency-Replayed
                                    │  ← speculative collapse: same content_hash → adopt finished job B
   OPEN REVIEW AT ~0 ms ◀──────────┘  draft(B) already cached → <PrescriptionReview> renders instantly,
                                       subtle "draft — confirm" badge; if H2 were stale, show inline
                                       "regenerating from your latest note…" while DraftDelta streams.
   ▼
   review → edit (provenance flips ai_generated→clinician_edited; applySignoffGate re-applies)
   ▼
   POST /v1/drafts/{id}/signoff {signoff_ack} ──────────────────────▶ 201 {prescription, jws_signature}
   ▼ print (<PrintDocument>, the single canonical A4 renderer) ; FHIR/ABDM fire async (§7)
```

**The three behaviors that make perceived wait ≈ 0, expressed purely in this contract:**

1. **Speculative pre-warm** — the client `POST`s `trigger:"speculative"` from the auto-saved note *during* the consult, so a `draft_ready` for the current `content_hash` usually exists before the click.
2. **Idempotent collapse on click** — the click `POST`s the *same* endpoint; identical `content_hash` returns the existing job (`200`, replayed) instead of starting a new 50–150 s run → **review opens on the cached draft at ~0 ms.**
3. **Streamed fallback when not pre-warmed** — if the note changed since the last speculative run, the click adopts the in-flight `streaming` job and renders `DraftDelta`s progressively (diagnosis → meds → safety), with a hard client deadline → degraded retry UI, never an opaque spinner.

The sign-off gate is unconditional in all three paths: the draft is `pending_review` until the doctor's `POST …/signoff` — speculation and streaming change *when compute happens*, never *who decides* (A6, `02 latency §0`).

---

## 11. OpenAPI source-of-truth & CI gate (pointer)

The normative machine-readable contract is `openapi.yaml` (OpenAPI 3.1) in the gateway service. It is the **single source of truth**: route handlers are validated against it, the client `*Port` types and the `__fakes__` are generated from it, and CI runs an **OpenAPI-vs-routes diff** plus **contract tests for the `GenerationPort` state machine** and **SSE frame schemas** (`09_engineering_discipline/quality_gates_ci.md`, `evals_framework.md`). This markdown is the human-readable rationale and the representative shapes; on any disagreement, `openapi.yaml` + the contract tests win, and the file author flags the drift.

---

## 12. Summary — what changed from the prototype

| Concern | Prototype (delete) | Target contract (build) |
|---|---|---|
| Generation transport | sync `POST /functions/v1/generate-prescription`, dies at 150 s | `POST …/generations → 202 {job_id}` + SSE + poll fallback |
| Progress | cosmetic rotating `msgs[]` | real `GenerationStarted/ToolInvoked/DraftDelta/Completed` SSE frames |
| Auth | anon key in `<script>`, `CORS:*` | JWT roles + facility, RLS session-vars, CORS locked to the SPA origin |
| Idempotency | none (3× write bug) | mandatory `Idempotency-Key` + `content_hash` collapse |
| Errors | `{error: e.message}` | canonical `{error:{code,message,correlation_id,retryable,details}}` |
| Versioning | none | `/v1` URL-major + per-resource `version`/`If-Match` → `409` |
| IDs in URLs | UHID, PII in QR | opaque UUIDs; signed receipt; no PHI in URL/QR |
| Dose numbers from model | yes (mental math) | model proposes drug+regimen only; engine recomputes; `dose_engine` provenance in draft |
| Sign-off | implicit | explicit `POST /drafts/{id}/signoff` human-gate command; draft `pending_review` until then |
| Model id | hardcoded `claude-sonnet-4-6` (broke prod) | resolved by `ModelPolicyPort`; never a literal in contract or source |
