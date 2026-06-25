# Error Model & Handling

> **Status:** Target-state rebuild specification. Build to this, not to the
> current `web/` + Supabase-Edge prototype.
> **Scope:** One canonical error model spanning frontend (Vite/TS SPA),
> backend (Hono off-edge services + workers), database (Postgres/dbmate),
> and AI generation (Claude tool-use loop). This document is normative — the
> HTTP middleware (`http/middleware/error-envelope.ts`, `error-handler.ts`),
> the core builder (`core/error-envelope.ts`), and the OpenAPI 3.1 contract
> (`04_api/openapi.yaml`) MUST conform to it, and CI diffs them against it.
>
> **The load-bearing invariant of this entire document:**
> **No error path may ever yield a silent wrong prescription.** Every failure
> degrades to one of exactly three observable outcomes — (a) a correct
> prescription, (b) a prescription explicitly flagged `REVIEW REQUIRED` /
> `severity: high` with the affected lines marked, or (c) a visible, named
> error with a recovery action. There is no fourth outcome. A drug whose dose
> cannot be deterministically computed is **omitted with a red stub**, never
> rendered with an AI-guessed number.
>
> **Spelling note (C3).** Where this document writes the words "`REVIEW REQUIRED`"
> it means the **display label**. The stored/wire `overall_status` value is the
> single UPPER_SNAKE token **`REVIEW_REQUIRED`** (DB CHECK, API, SSE, audit — see
> `03_data/schema_design.md §6.5`, `04_api/api_contracts.md §4.7`); the space form
> is never stored or sent. Gate severity is `severity_final ∈ {none, moderate, high}`.

---

## 0. Design principles (decisive)

| # | Principle | Consequence in this spec |
|---|-----------|--------------------------|
| P1 | **One envelope everywhere.** | Identical JSON shape for 4xx, 5xx, kill-switch, and worker-job failures. Clients write one parser. |
| P2 | **Stable machine code + human message are separate fields.** | `error.code` (UPPER_SNAKE) is the contract; `error.message` is for humans and may change. Clients branch on `code`, never on `message`. |
| P3 | **Errors are typed at the boundary, mapped at the edge.** | Domain throws typed errors (`VersionConflictError`, `DoseMismatchError`, …). A single Hono `onError` handler maps type → status → envelope. Handlers never hand-roll JSON. |
| P4 | **Fail closed on clinical safety, fail soft on infrastructure.** | A confidence/dose/state-machine failure → block + flag (closed). An OCR-provider blip → retry in background + read-only access preserved (soft). |
| P5 | **Retryability is a server-asserted field, not client guesswork.** | `error.retryable` is computed server-side from the error type. Clients honour it; they never invent their own retry rules. |
| P6 | **Generation never blocks on a wall clock.** | Generation is an async job on an off-edge worker. The 150 s Edge wall-clock failure class (`504/546 @ 150,000ms`) is structurally deleted. Timeouts become *job-level* `GENERATION_TIMEOUT` events, surfaced as recoverable UI states — never an infinite spinner. |
| P7 | **Every error carries correlation.** | `correlation_id` (pipeline-wide) + `request_id` (per-request) on every envelope and every log line. Cross-service tracing is free. |
| P8 | **No PII in any error.** | Messages, `details`, and logs reference `patient_id`/`visit_id`/`job_id` (UUIDs) only — never name, UHID, DOB, or guardian phone. The `esc()`/redactor discipline applies to error rendering too. |

---

## 1. The canonical envelope

Every non-2xx HTTP response and every terminal job-failure event carries
exactly this shape. No endpoint is exempt.

```jsonc
{
  "error": {
    "code": "UPPER_SNAKE",          // P2 — stable, machine-readable, enumerated in §5
    "message": "Short human-readable sentence.",  // safe, PII-free, may change
    "details": { /* optional, structured, code-specific — see §5 */ },
    "retryable": true,              // P5 — server-asserted
    "request_id": "uuid",           // server-assigned, one per HTTP request
    "correlation_id": "uuid",       // P7 — pipeline-wide, crosses gateway→worker→AI→DB
    "clinical_safety": {            // present ONLY on generation/dose/promotion errors
      "severity": "high",           // "high" | "moderate" — drives the sign-off gate
      "affected": ["AMOXICILLIN"],  // drug generic names or field paths the doctor must check
      "action": "manual_dose"       // see §6.4 enum
    }
  }
}
```

**Field contract**

| Field | Required | Source | Notes |
|-------|----------|--------|-------|
| `code` | always | error type → `core/error-envelope.ts` mapping | UPPER_SNAKE; CI-enforced enum (§5). |
| `message` | always | typed error's caller-safe message | Unknown errors collapse to `"Internal server error."` — never leak stack/raw message. |
| `details` | optional | per-code (§5) | Structured context for programmatic handling. |
| `retryable` | always | `defaultRetryable(status)` overridden per type | `true` for 5xx/429/502/504; `false` for 4xx except 429. |
| `request_id` | always | gateway middleware | New UUID per request. |
| `correlation_id` | always | `AsyncLocalStorage` scope; defaults to `"unknown"` sentinel, never null | Set at request entry; propagated to worker via job row + SSE. |
| `clinical_safety` | conditional | generation / dose / promotion contexts only | Its presence is the machine signal that a clinician decision is required. |

**Builder authority.** `toEnvelope(err, correlationId?)` in
`core/error-envelope.ts` is the single non-HTTP builder (queue workers,
audit sinks, background jobs). The HTTP edge adds `retryable`, `request_id`,
and `status` via the `onError` handler. The two MUST agree on `code` for a
given error type — a contract test asserts this.

---

## 2. Error taxonomy (categories)

Eight top-level categories. Every thrown value in the system maps to exactly
one. The category determines the *handling strategy*, not just the status
code.

| Cat | Name | Examples | Default disposition |
|-----|------|----------|---------------------|
| **C1** | **Validation / client input** | malformed body, bad params, schema-invalid edit | 4xx, **not retryable**, surfaced inline on the offending field. |
| **C2** | **Authn / authz** | missing JWT, wrong role for action | 401/403, not retryable, route to login or "insufficient permission". |
| **C3** | **State / concurrency** | optimistic-lock clash, invalid state transition, idempotency conflict | 409, **not retryable** (client must reload first), re-GET + re-render. |
| **C4** | **Resource** | patient/visit/job/extraction not found | 404, not retryable. |
| **C5** | **Upstream provider** | Claude API 5xx/429/overload, ABDM gateway, OCR provider, Storage | 502/504/429, **retryable**, background retry + graceful degradation. |
| **C6** | **Clinical-safety gate** *(the critical one)* | dose mismatch, formulary miss, missing weight, confidence-below-threshold, AI refusal | **Never a hard fail to the doctor.** Degrade to a *flagged* draft (severity high) + omitted stub. Blocks sign-off, not viewing. |
| **C7** | **Infrastructure / internal** | DB down, unhandled exception, queue unreachable | 500/503, retryable, alert, kill-switch eligible. |
| **C8** | **Capacity / lifecycle** | rate limit, payload too large, kill-switch active, maintenance | 429/413/503, retryable-after, honour `Retry-After`. |

**The taxonomy rule that matters most:** an error in **C5** (an upstream/AI
failure) must NEVER be allowed to *masquerade* as a successful generation.
When the AI path fails or is forced into a degraded mode, the result is
re-categorised into **C6** (a flagged, safety-gated draft) — see §6. C5 alone
never reaches paper unflagged.

---

## 3. HTTP & stream semantics

### 3.1 HTTP status mapping

| Status | Code (canonical) | Category | When | Retryable |
|--------|------------------|----------|------|-----------|
| 400 | `INVALID_ARGUMENT` | C1 | Malformed body/params. | no |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | C1 | Write without `Idempotency-Key`. | no |
| 401 | `UNAUTHENTICATED` | C2 | Missing/invalid JWT. | no |
| 403 | `FORBIDDEN` | C2 | Authenticated, wrong role (reception ≠ doctor sign-off). | no |
| 403 | `CONSENT_REQUIRED` | C2 | AI-assisted generation requested with no active `ai_assisted_rx` guardian consent (fail-closed, C6). | no |
| 404 | `NOT_FOUND` (+ `PATIENT_NOT_FOUND`, `VISIT_NOT_FOUND`, `JOB_NOT_FOUND`) | C4 | Resource absent. | no |
| 409 | `VERSION_CONFLICT` | C3 | Optimistic lock failed; `details` carries current version/status. | no |
| 409 | `INVALID_STATE_TRANSITION` | C3 | e.g. sign a `superseded` draft. | no |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | C3 | Same key, different body. | no |
| 413 | `PAYLOAD_TOO_LARGE` | C8 | Upload > 20 MB. | no |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | C1 | Extension off allowlist. | no |
| 422 | `VALIDATION_FAILED` | C1 | Shape-valid but domain-invalid; `details.errors[]`. | no |
| 429 | `RATE_LIMITED` | C8 | Per-operator / global throttle; `Retry-After`. | **yes** |
| 500 | `INTERNAL` | C7 | Unhandled. Alerts. | yes |
| 502 | `UPSTREAM_FAILED` | C5 | Claude/ABDM/OCR returned an error; `details.provider`. | **yes** |
| 503 | `KILL_SWITCH_ACTIVE` / `UNAVAILABLE` | C8 | Emergency stop or maintenance; `Retry-After`. | yes (later) |
| 504 | `UPSTREAM_TIMEOUT` | C5 | Provider exceeded timeout. | **yes** |

**Status discipline.** `2xx` only for genuine success. A *degraded* generation
that produced a flagged draft is **`200 OK` with a `clinical_safety` block in
the body of the job result** — it succeeded as a *job* (a reviewable draft
exists); the safety flag is a payload concern, not an HTTP error. A generation
that produced *nothing reviewable* is a job in state `failed`, surfaced via SSE
and the job-status endpoint as an error envelope.

### 3.2 Async-job semantics (the generation path)

Generation is **not** a synchronous request. It is:

```
POST /v1/visits/{id}/generate           → 202 Accepted { job_id, status: "queued" }
GET  /v1/jobs/{job_id}                   → 200 { status, draft?, error? }   (poll fallback)
GET  /v1/jobs/{job_id}/events            → text/event-stream (SSE, primary)
```

- `POST …/generate` is **idempotent on `content_hash`** of
  `{note, patient_context_version, selected_sections}`. A duplicate request
  (or a speculative background run that matches) returns `202` with the
  **existing** `job_id` — it does not start a second run. (Kills the 3×
  duplicate-write class.)
- The endpoint **always returns fast** (`202`). It never holds a connection
  open for compute. This is the structural fix for the 150 s wall clock (P6).

### 3.3 SSE (streaming) semantics

The pad subscribes to `GET /v1/jobs/{job_id}/events`. The worker emits domain
events on a per-job channel (modelled on `http/realtime/status-channel.ts`):

| SSE `event:` | `data` payload | Meaning |
|--------------|----------------|---------|
| `generation.started` | `{job_id, model_id, speculative}` | Worker picked up the job. |
| `generation.tool` | `{tool, round}` | A `ClinicalKnowledgePort` tool was invoked (replaces the cosmetic `msgs[]` rotator). |
| `generation.delta` | `{section, text}` | Streamed partial (diagnosis → meds → safety render progressively). |
| `generation.completed` | `{job_id, severity, omitted[]}` | Draft ready; `severity` & `omitted` drive the sign-off gate. |
| `generation.failed` | the **full error envelope** (§1) | Terminal failure; client shows the degraded UI (§4.4). |
| `generation.superseded` | `{job_id, superseded_by}` | A newer note hash cancelled this run; client switches subscription. |

**SSE failure semantics (decisive):**
- The SSE stream is a *notification channel*, not the source of truth. If the
  stream drops (network, proxy idle-timeout), the client reconnects with
  `Last-Event-ID`; on repeated failure it falls back to polling
  `GET /v1/jobs/{job_id}` every 2 s. **An SSE disconnect is never an error
  state for the prescription** — the job continues on the worker.
- `generation.failed` carries the *same envelope* as an HTTP error so the
  client has one error-rendering path for both transports.
- Heartbeat comment (`:keepalive`) every 15 s so proxies don't reap the
  connection; absence of heartbeat for 45 s → client treats the stream as dead
  and switches to poll (not to "error").

---

## 4. Retry, timeout & backoff policy

### 4.1 Client → server (HTTP)

```
retryable === true  →  exponential backoff:
    base = 1 s, factor = 2, cap = 30 s, jitter = ±20%, max attempts = 5
    REUSE the same Idempotency-Key on every retry   (server dedups)
retryable === false →  do NOT auto-retry. Surface the recovery action (§7).
```

- Honour `Retry-After` (seconds) when present (429, 503) — it overrides the
  backoff schedule for the first wait.
- Every client request carries an `AbortController`; a hard **client deadline
  of 8 s** for synchronous CRUD calls. Past the deadline → degraded UI
  (retry / manual), **never an infinite spinner** (P6).

### 4.2 Server → upstream (Claude, ABDM, OCR, Storage)

| Upstream | Trigger to retry | Policy | Ceiling |
|----------|------------------|--------|---------|
| Claude API | 429, 500–599, `overloaded_error`, network/abort | backoff base 1 s, factor 2, jitter ±20% | 4 attempts, then degrade (§6.5) |
| Claude — `stop_reason: "refusal"` | — | **do NOT retry blindly**; guard before reading `content[0]`; route to flagged-draft / manual (§6.5) | — |
| ABDM gateway | 5xx, timeout | backoff; durable via `abdm_outbox` | retried until TTL; sign-off never blocks on it |
| OCR provider | 5xx, poll-timeout | background-job retry | per job `attempts` cap |
| Storage | 5xx, timeout | 3 attempts | then `UPSTREAM_FAILED` |
| Postgres | transient (`40001` serialization, conn reset) | 3 attempts, 50 ms→200 ms | then `INTERNAL` + alert |

### 4.3 Timeout budgets

| Boundary | Timeout | On expiry |
|----------|---------|-----------|
| Sync CRUD HTTP (client) | 8 s | abort → degraded UI |
| Sync CRUD (server handler) | 10 s | `504 UPSTREAM_TIMEOUT` if DB/upstream stalls |
| **Generation job (worker)** | **soft 180 s, hard 300 s** | emit `generation.failed` `GENERATION_TIMEOUT`; **no wall-clock kill** — the worker owns the clock, not a 150 s Edge limit |
| Single Claude streaming call | 120 s (via SDK `.get_final_message()`) | abort that call → model-tier fallback or degrade (§6.5) |
| Per tool-use round | 30 s | abort round → loop guard → degrade |
| SSE heartbeat | 15 s emit / 45 s client-side dead | client → poll fallback |
| ABDM/FHIR async handler | 60 s soft | retry via outbox; never blocks sign-off |

**Deleted on rebuild:** every timeout/budget/fallback workaround that existed
*only* to survive the 150 s Edge wall (`generate-prescription/index.ts`
`timeoutMs=90_000`, the 35 s-retry-budget arithmetic, the `mode:
"fallback-single-shot"` shortcut as a *latency* hack). The fallback *behaviour*
(model-tier downgrade, completeness retry) is **kept** but re-homed as
deliberate degradation policy (§6.5), not as a clock-survival hack.

### 4.4 Idempotency (the dedup backbone)

- `Idempotency-Key` header is **mandatory on every write** (POST/PUT/PATCH/
  DELETE). Absent → `400 IDEMPOTENCY_KEY_REQUIRED`.
- Same key + same body → return the original result (replay).
- Same key + **different** body → `409 IDEMPOTENCY_KEY_CONFLICT`.
- Stored in `ops.idempotency` (UNIQUE on key) with `ON CONFLICT` resolution,
  per `core/idempotency-store.ts`. Generation additionally keys on
  `content_hash` so speculative + explicit Generate collapse to one job.

---

## 5. Error code catalogue (the enum)

CI rejects any `error.code` not in this table (enum drift gate). Codes are
grouped by category from §2.

### 5.1 C1 — Validation / input (4xx, not retryable)

| Code | Status | `details` |
|------|--------|-----------|
| `INVALID_ARGUMENT` | 400 | `{ field?, reason }` |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | — |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | `{ received, allowed[] }` |
| `PAYLOAD_TOO_LARGE` | 413 | `{ max_bytes, received_bytes }` |
| `VALIDATION_FAILED` | 422 | `{ errors: [{ field_path, rule, message }] }` |

### 5.2 C2 — Authn / authz

| Code | Status | `details` |
|------|--------|-----------|
| `UNAUTHENTICATED` | 401 | — |
| `FORBIDDEN` | 403 | `{ required_role, actor_role }` |
| `CONSENT_REQUIRED` | 403 | `{ purpose: "ai_assisted_rx" }` |

> **`CONSENT_REQUIRED` (C6).** AI-assisted generation (`RequestGeneration` /
> `POST …/generations`, *every* `trigger` incl. speculative/agent) is blocked
> fail-closed unless the patient has an active `ai_assisted_rx` guardian consent
> (`consent_given = true AND withdrawn_at IS NULL`). Withdrawal blocks new
> generations immediately and cancels in-flight speculative jobs. Distinct from
> `opd_care` processing consent (SEC-7) and ABDM sharing consent — three separate
> gates. Not retryable. (`03_data/schema_design.md §5.2`, `04_api/api_contracts.md §4.1`.)

### 5.3 C3 — State / concurrency (409, not retryable)

| Code | Status | `details` |
|------|--------|-----------|
| `VERSION_CONFLICT` | 409 | `{ resource, resource_id, expected_version, current_version, current_status }` |
| `INVALID_STATE_TRANSITION` | 409 | `{ from, event }` |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | `{ key }` |

### 5.4 C4 — Resource (404, not retryable)

| Code | Status | `details` |
|------|--------|-----------|
| `NOT_FOUND` | 404 | `{ resource }` |
| `PATIENT_NOT_FOUND` | 404 | `{ patient_id }` |
| `VISIT_NOT_FOUND` | 404 | `{ visit_id }` |
| `JOB_NOT_FOUND` | 404 | `{ job_id }` |

### 5.5 C5 — Upstream provider (5xx/429, retryable)

| Code | Status | `details` |
|------|--------|-----------|
| `UPSTREAM_FAILED` | 502 | `{ provider, upstream_status?, upstream_code? }` |
| `UPSTREAM_TIMEOUT` | 504 | `{ provider, timeout_ms }` |
| `AI_PROVIDER_OVERLOADED` | 502 | `{ provider: "anthropic", retry_after_ms? }` |
| `OCR_PROVIDER_UNAVAILABLE` | 502 | `{ provider, retry_after_sec }` |
| `OCR_PROVIDER_TIMEOUT` | 504 | `{ provider }` |
| `ABDM_GATEWAY_FAILED` | 502 | `{ stage }` *(async; does not block sign-off)* |

### 5.6 C6 — Clinical-safety gate (the safety enum)

These codes appear on **job results** (in the `clinical_safety` block, §6.4)
or on `generation.failed` events. They are **never** a silent failure.

| Code | Surfaced as | Meaning | Disposition |
|------|-------------|---------|-------------|
| `DOSE_MISMATCH` | flagged draft | AI-proposed number ≠ engine recompute (zero tolerance) | line → `REVIEW REQUIRED`, severity high |
| `DOSE_UNCOMPUTABLE` | omitted stub | engine returned `ok:false` (no band / no weight / capped-unsafe) | red stub, manual dose, severity high |
| `FORMULARY_MISS` | omitted stub | drug not in `catalog.formulary` | red stub, `not_in_formulary`, severity high |
| `WEIGHT_MISSING` | gate prompt | no weight → no weight-based dosing | block Generate until captured or doctor overrides explicitly |
| `CONFIDENCE_BELOW_THRESHOLD` | flagged draft | OCR/structuring/promotion below policy gate | fail-closed: no auto-promotion |
| `AI_REFUSAL` | degraded draft | `stop_reason: "refusal"` | route to manual; flag; never read `content[0]` |
| `AI_SCHEMA_INVALID` | degraded / fail | model JSON unparseable/non-conforming after N retries | strict-tools/structured-output should prevent; if it occurs → manual single-shot, flag |
| `GENERATION_INCOMPLETE` | flagged draft | completeness check found requested-but-missing meds | omitted stubs added, severity high |
| `MODEL_TIER_DOWNGRADED` | annotation | clinical model class was downgraded (Opus→Sonnet) under load | **always flagged** — never a silent class downgrade |

### 5.7 C7/C8 — Infra & capacity

| Code | Status | Category |
|------|--------|----------|
| `INTERNAL` | 500 | C7 |
| `RATE_LIMITED` | 429 | C8 |
| `KILL_SWITCH_ACTIVE` | 503 | C8 |
| `UNAVAILABLE` | 503 | C8 |
| `PROMOTION_FAILED` | 500 | C7 (`details.reason`) |

---

## 6. Graceful degradation — "never a silent wrong Rx"

This is the heart of the spec. It defines, for each failure of the generation
critical path, the **exact** degraded outcome — and proves it can never be (a)
silent or (b) a wrong number on paper.

### 6.1 The three-tier severity ladder (port from `sprint-2-saved`)

Every generation carries a server-computed `severity_server ∈ {none,
moderate, high}` and the sign-off gate (`applySignoffGate()`) binds to it:

| Severity | Trigger | Sign-off behaviour |
|----------|---------|--------------------|
| `none` | clean, engine-validated, complete | Sign enabled. |
| `moderate` | a caution (e.g. interaction note, near-cap dose) | Caution banner; Sign enabled. |
| `high` | any C6 event — dose mismatch, formulary/dose omission, fallback mode, model downgrade, schema-invalid | **Sign disabled** until the doctor ticks an explicit acknowledgement; re-applied after *any* edit (high→edit→save cannot bypass). |

**Re-apply rule (decisive):** the gate re-evaluates after every client
`AdjustDose` / `AddMedicine` / edit command. A high-severity draft that the
doctor edits does not silently drop to enabled — the gate recomputes against
the engine on the new content.

### 6.2 Dose-engine separation — the arithmetic firewall

The AI proposes drug + regimen with **no numeric fields**. The pure
`DoseEnginePort` (`computeDose` / `parseIngredients` / `roundToUnit`) computes
every mg/ml/drop. Then:

```
engine.computeDose(...) → ComputeDoseResult { vol, enD, hiD, calc,
                                              capped, warnings[], ok? }
```

- **`ok:false`** (no band, no weight, capped-unsafe) → drug routed to
  `omitted_medicines[]` with a typed `reason` → **red stub on the Rx**, never a
  number. (`DOSE_UNCOMPUTABLE` / `FORMULARY_MISS`.)
- **`capped:true`** (engine clamped to max single/daily) → kept, but
  `warnings[]` surfaced, severity ≥ moderate.
- **Server re-check is byte-for-byte.** The worker recomputes and compares to
  whatever reached the draft; **any** divergence (including a client-side
  override) → `DOSE_MISMATCH`, severity high, line flagged `REVIEW REQUIRED`.
  There is **no tolerance band** — a 20 % client override is rejected, not
  averaged.
- **TDD gate:** golden JS↔TS parity fixtures (≥20 cases: syrup 0.5 ml / drops
  0.1 ml / tablet 0.25 rounding, single/daily caps, bilingual strings) must
  pass before the engine is trusted in any path. No fixtures → engine is not
  wired into generation.

This is why a wrong number *cannot* reach paper: the only numbers on the Rx
come from the deterministic engine, and the only way a non-engine number could
appear is caught by the byte-for-byte re-check and flagged.

### 6.3 Per-failure degradation matrix

| Failure (where) | Detected by | Degraded outcome | Silent-wrong-Rx prevented because… |
|-----------------|-------------|------------------|------------------------------------|
| Weight missing | client pre-Generate check | persistent prompt; weight-based meds blocked | no weight → engine can't compute → no guessed number |
| Drug not in formulary | `get_formulary` miss | omitted stub, red, `not_in_formulary`, severity high | drug rendered as a stub the doctor must complete, not dosed from AI memory |
| Engine `ok:false` | `compute_doses` tool | omitted stub, severity high | engine refuses → no number emitted |
| AI vs engine mismatch | server byte-check | line flagged `REVIEW REQUIRED`, severity high | divergent number never trusted |
| AI refusal (`stop_reason:"refusal"`) | guard before `content[0]` | degraded draft → manual entry, flagged | no content read from a refusal frame |
| AI schema-invalid after retries | Ajv/structured-output check | manual single-shot; if still invalid → `generation.failed` | malformed JSON never parsed into meds |
| Completeness gap | post-gen diff (requested vs emitted) | requested-but-missing drugs → omitted stubs, severity high | doctor sees what's missing |
| Claude 5xx/overload | upstream guard | retry → model-tier downgrade (flagged) → `generation.failed` | downgrade flagged; total failure visible, not blank |
| Worker timeout (≥300 s) | worker hard deadline | `generation.failed` `GENERATION_TIMEOUT` | UI shows retry/manual, not a spinner |
| OCR/structuring fail | confidence-policy fail-closed | `auto_approved=false` → human review | nothing auto-promoted below threshold |
| DB / promotion fail | txn rollback | `PROMOTION_FAILED`, nothing partially written | append-only audit + composite FK prevent half-states |

### 6.4 The `clinical_safety` block (the machine signal)

When degradation occurs, the job result (200) or `generation.failed` event
carries:

```jsonc
"clinical_safety": {
  "severity": "high",                 // drives applySignoffGate()
  "affected": ["AMOXICILLIN", "PARACETAMOL"],  // generic names | field paths
  "action": "manual_dose",            // enum below
  "codes": ["DOSE_UNCOMPUTABLE", "FORMULARY_MISS"]  // the §5.6 codes that fired
}
```

`action` enum: `manual_dose` (doctor fills the omitted line) | `review_line`
(check a flagged line) | `capture_weight` | `acknowledge` (tick the high-sev
gate) | `retry_generation` | `none`.

### 6.5 Fallback ladder (deliberate, flagged — not a silence)

```
1. Stream from Opus 4.8 (effort:high, adaptive thinking).
2. On 429/5xx/overload/timeout → backoff+jitter, up to 4 attempts (same model).
3. Persistent overload → MODEL_TIER_DOWNGRADE to Sonnet 4.6 via ModelPolicyPort
   → severity forced to ≥ high, clinical_safety.codes += MODEL_TIER_DOWNGRADED,
   a printed line notes the assist was downgraded. NEVER silent.
4. Same-model provider failover (Bedrock/Vertex) preferred over class downgrade
   when available (keeps Opus).
5. Completeness retry (if requested meds missing AND budget remains) → re-run
   once with explicit "include all requested drugs" nudge.
6. All paths exhausted → emit generation.failed (GENERATION_TIMEOUT / AI_*),
   surface retry + manual-entry. The doctor always lands on a usable, honest
   state — a flagged draft or an explicit failure, never a confident-looking
   wrong Rx.
```

**Hard rule:** the clinical model *class* is never downgraded silently. A
Sonnet-generated Rx where Opus was policy is always severity-high and visibly
annotated. (This is the open/closed safety boundary: speed optimisations live
*behind* the flag, never *under* it.)

### 6.6 Kill-switch (CS-9 emergency stop)

`KILL_SWITCH_ACTIVE` (503 + `Retry-After`) short-circuits **writes only**;
reads pass through so clinicians keep read-only record access. Body uses the
canonical envelope. Backed by `ops` flag; per `http/middleware/kill-switch.ts`.

---

## 7. User messaging (frontend)

Messaging is part of the contract — a named error with no recovery action is a
spec violation. The SPA renders errors through one `<ErrorBoundary>` +
`useError(code)` mapping (no raw `fetch` error strings in components, P-frontend).

### 7.1 Code → user message → action map

| Code | User-facing message | Visible action | Tone |
|------|---------------------|----------------|------|
| `VERSION_CONFLICT` | "This record changed since you opened it. Reloading the latest version." | auto re-GET + re-render; **never auto-submit** | neutral |
| `WEIGHT_MISSING` | "Enter the child's weight to calculate weight-based doses." | focus weight field; Generate stays blocked | blocking, calm |
| `FORMULARY_MISS` / `DOSE_UNCOMPUTABLE` | "{DRUG} isn't in the formulary / can't be auto-dosed — please enter the dose manually." | red stub editor inline | warning |
| `DOSE_MISMATCH` | "Dose for {DRUG} needs your review before signing." | jump to flagged line; Sign disabled until ack | warning |
| `MODEL_TIER_DOWNGRADED` | "AI assist ran in reduced mode — please verify every dose before signing." | severity-high banner; ack required | warning |
| `GENERATION_TIMEOUT` / `AI_PROVIDER_OVERLOADED` | "The AI draft is taking longer than usual." | **Retry** + **Write manually** buttons; no spinner | calm |
| `OCR_PROVIDER_UNAVAILABLE` | "The AI reader is temporarily unavailable — we'll retry in the background." | background retry badge | calm |
| `RATE_LIMITED` | "Too many requests — retrying shortly." | countdown from `Retry-After` | calm |
| `KILL_SWITCH_ACTIVE` | "New prescriptions are paused for maintenance. Existing records are still viewable." | read-only mode | neutral |
| `FORBIDDEN` | "You don't have permission for this action." | none / contact admin | neutral |
| `INTERNAL` | "Something went wrong on our side. The team has been alerted." | Retry; `request_id` shown small for support | neutral |

### 7.2 Messaging rules

- **Never show a stack trace, raw upstream body, or `code` string as the
  primary message.** Show the human sentence; show `request_id` in fine print
  for support cross-reference.
- **No colour-only status** (WCAG 2.2 AA): every severity carries an icon +
  text label, not just red/blue. (Mitigates the rubber-stamp risk.)
- **Provenance on degraded drafts:** AI-generated lines are visually
  distinguished from clinician edits; the printed Rx carries "AI-assisted,
  doctor-reviewed", and downgraded/fallback runs add an explicit note.
- **Speculative-draft staleness** is a *state*, not an *error*: if the live
  note hash ≠ the ready draft's hash, show "regenerating from your latest
  note…" inline — never an error envelope.

---

## 8. Logging & observability

Every response and every job transition logs (pino, structured, PII-redacted):

```
{ method, path, status, duration_ms, request_id, correlation_id,
  error_code?, job_id?, patient_id?, model_id?, severity? }
```

- **PII redactor is mandatory** (P8): `patient_id`/`visit_id`/`job_id` only —
  never name, UHID, DOB, guardian phone, or note text.
- **Generation auditability (NABH + clinical-safety):** every attempt writes
  one `prescribing.prescription_audit` row — `meta_mode`, `stop_reason`,
  `tools_called[]`, `requested/emitted/omitted/added`, `severity_*`,
  `warnings[]`, `model_id` actually used, tokens, `cache_read_input_tokens`,
  `duration_ms`. This replaces heuristic `console.log` and *is* the
  error-forensics trail. Retries/fallbacks each get a row.
- **Append-only audit:** `ops.audit_log` BEFORE-UPDATE/DELETE triggers raise on
  mutation; error events are immutable evidence.
- **Alerting:** `INTERNAL`, `PROMOTION_FAILED`, sustained `AI_PROVIDER_*`, and
  any `DOSE_MISMATCH` rate spike page on-call. A `DOSE_MISMATCH` is a *latent
  bug* signal (engine drift), not just a per-patient flag.

---

## 9. Mapping reference (type → code → status)

The single `onError` handler implements exactly this. Any new domain error
adds a row here first (CI enum gate).

| Thrown type | `code` | Status | `retryable` | `clinical_safety`? |
|-------------|--------|--------|-------------|--------------------|
| `InvalidStateTransitionError` | `INVALID_STATE_TRANSITION` | 409 | no | — |
| `VersionConflictError` | `VERSION_CONFLICT` | 409 | no | — |
| `IdempotencyConflictError` | `IDEMPOTENCY_KEY_CONFLICT` | 409 | no | — |
| `MissingIdempotencyKeyError` | `IDEMPOTENCY_KEY_REQUIRED` | 400 | no | — |
| `ValidationError` (Zod/Ajv) | `VALIDATION_FAILED` | 422 | no | — |
| `UnsupportedMediaError` | `UNSUPPORTED_MEDIA_TYPE` | 415 | no | — |
| `PatientNotFoundError` / `VisitNotFoundError` / `JobNotFoundError` | `*_NOT_FOUND` | 404 | no | — |
| `UnauthenticatedError` / `ForbiddenError` | `UNAUTHENTICATED` / `FORBIDDEN` | 401 / 403 | no | — |
| `ConsentRequiredError` | `CONSENT_REQUIRED` | 403 | no | — |
| `UpstreamError` (provider 5xx) | `UPSTREAM_FAILED` | 502 | yes | — |
| `UpstreamTimeoutError` | `UPSTREAM_TIMEOUT` | 504 | yes | — |
| `AiOverloadedError` | `AI_PROVIDER_OVERLOADED` | 502 | yes | — |
| `DoseMismatchError` | `DOSE_MISMATCH` | (job 200) | no | **yes (high)** |
| `DoseUncomputableError` | `DOSE_UNCOMPUTABLE` | (job 200) | no | **yes (high)** |
| `FormularyMissError` | `FORMULARY_MISS` | (job 200) | no | **yes (high)** |
| `AiRefusalError` | `AI_REFUSAL` | (job 200/failed) | no | **yes (high)** |
| `ConfidenceBelowThresholdError` | `CONFIDENCE_BELOW_THRESHOLD` | (job) | no | **yes** |
| `GenerationTimeoutError` | `GENERATION_TIMEOUT` | (failed event) | yes | **yes** |
| `KillSwitchActiveError` | `KILL_SWITCH_ACTIVE` | 503 | yes | — |
| `PromotionFailedError` | `PROMOTION_FAILED` | 500 | yes | — |
| *unknown / any other* | `INTERNAL` | 500 | yes | — |

> Rows marked "(job …)" are **not HTTP errors** — the generation job
> *succeeded* in producing a reviewable, flagged draft (severity high). They
> reach the client through the job result body / SSE `generation.completed`,
> carry the `clinical_safety` block, and gate sign-off. This is the precise
> mechanism by which an arithmetic or formulary failure becomes a *visible,
> blocked* outcome rather than a silent wrong prescription.

---

## 10. Conformance gates (machine-checkable)

The `09_engineering_discipline/` suite owns the *runner*; this spec defines
*what* is gated:

1. **Envelope-shape contract test** — every route's error response validates
   against the §1 JSON schema; `code ∈` §5 enum.
2. **Builder agreement test** — `core/error-envelope.ts` and the HTTP handler
   emit the same `code` for each error type in §9.
3. **`retryable` correctness test** — asserts the §3.1 table per code.
4. **Dose-engine golden parity** (§6.2) — JS↔TS fixtures must pass before the
   engine is trusted; the byte-for-byte re-check has a dedicated mismatch test.
5. **Safety-invariant eval** — over a frozen pediatric fixture set: every
   omitted/mismatched/downgraded case produces `severity: high` and a
   sign-off-blocking gate; no fixture yields a numeric dose without engine
   provenance; no PII appears in any error/log.
6. **No-silent-downgrade test** — a forced Opus→Sonnet downgrade always sets
   `MODEL_TIER_DOWNGRADED` + severity high.
7. **OpenAPI diff** — `04_api/openapi.yaml` error responses match this catalogue.
