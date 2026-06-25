# Backend Service Decomposition

> **Status:** TARGET-STATE rebuild specification. Build to this, not to the current
> `web/` + Supabase Edge Function prototype. The prototype's synchronous,
> 150-second-capped Edge Function is the single largest architectural defect this
> document replaces.
>
> **Foundation:** The hexagonal TypeScript skeleton on `origin/feat/dis-plan` (`dis/`)
> is the canonical template. It is typecheck-clean, has 8 ports + `__fakes__`, a pure
> `core/` enforced by CI fitness rules, dbmate migrations with rollbacks, a Postgres
> job queue (`dis_jobs`, `M004`), portable RLS (`M008`), an append-only audit log
> (`M002`), and a Hono HTTP layer with correlation-id / idempotency / kill-switch /
> error-envelope middleware. Every service in this document is a hexagon built to
> that template. Where this document and an upstream study report disagree, this
> document wins.
>
> **Companion documents.** Database target schema and migration: `03_data/` (referenced
> here, not duplicated). AI orchestration internals: `02_architecture/ai_orchestration.md`.
> AI prompt/tool **substance** (tool `input_schema` + condensed outputs, rebuilt
> `core_prompt.md` + cache-prefix layout, clinical references registry, worked
> examples/golden cases): the **`05_ai/`** layer. API/SSE/ABDM contracts: `04_api/` +
> `05_integration/`. Engineering discipline (TDD/eval gates, OpenAPI-as-truth, review
> gates): the `09_engineering_discipline/` suite — this document defines *what* is
> gated, not the runner.

---

## 0. The headline problem, restated as an architecture requirement

The prototype runs the Claude tool-use loop *inside* a Supabase Edge Function:

```
supabase/functions/generate-prescription/index.ts
  ├─ model hardcoded:  "claude-sonnet-4-6"     (line ~711, ~832)
  ├─ tool loop:        for (round = 1..MAX_TOOL_LOOPS) { fetch(api.anthropic.com) }
  ├─ abort budget:     setTimeout(() => controller.abort(), 90_000)
  └─ wall clock:       Edge Function HARD limit 150_000 ms → 504 / 546
```

Generation takes 50–150 s. The 90 s internal abort and the 150 s platform wall
clock are *workarounds for a platform that was never meant to host a long-running
agentic loop*. Evidence: `console-log.md:15-16` shows 546 responses at exactly
150,000 ms.

**The architecture requirement that follows:** long-running AI compute MUST run on
an off-edge, uncapped, long-lived worker — never an Edge Function. Every other
decision in this document (the job queue, the command bus, the SSE relay, the
speculative-draft state machine) exists to deliver the headline UX promise:

> **The doctor's perceived wait to a reviewable prescription is ~0, and the draft
> is ALWAYS doctor-reviewed and signed — never auto-finalized.**

When the latency budget is no longer 150 s, every timeout/budget/fallback hack from
`sprint-2-saved` is deleted, not ported.

---

## 1. Service map (bounded contexts, one monorepo)

Nine bounded contexts, each a hexagon (`core / ports / adapters / __fakes__`). They
deploy as **three runtime processes** sharing one repo, one Postgres, one event bus:

```
                          ┌───────────────────────────────────────────────┐
                          │            COMMAND BUS  /  EVENT BUS           │
                          │   (the symmetric-actor seam — §10)            │
                          └───────────────────────────────────────────────┘
                                 ▲              ▲                 ▲
        commands ────────────────┘              │                 └──── events
                                                │
  ┌──────────────────────┐    ┌────────────────────────────┐   ┌─────────────────────┐
  │  PROCESS A           │    │  PROCESS B                 │   │  PROCESS C          │
  │  API Gateway (Hono)  │    │  Generation Worker(s)      │   │  Integration Worker │
  │  holds SSE conns     │    │  off-edge, uncapped        │   │  ABDM / FHIR        │
  │  validate→enqueue→202│    │  Claude tool-use loop      │   │  event-driven       │
  └──────────────────────┘    └────────────────────────────┘   └─────────────────────┘
        │  CQRS reads                  │  pulls jobs                  │  outbox/inbox
        ▼                              ▼                              ▼
  ┌───────────────────────────────────────────────────────────────────────────────┐
  │                          Postgres (DDD schemas — see §5 / doc 05)              │
  │  catalog · clinical · prescribing · identity · abdm · ops                     │
  │  + ops.jobs (queue)  + ops.outbox/inbox  + prescribing.rx_generation_jobs     │
  └───────────────────────────────────────────────────────────────────────────────┘
```

| # | Bounded context | Process | Hexagon owns | Net-new vs `dis/` |
|---|---|---|---|---|
| 1 | **API Gateway** | A | correlation-id, idempotency, error-envelope, kill-switch, rate-limit, CORS, auth/JWT→RLS session, SSE relay, 202 enqueue | Extend `dis/src/http/*` (already has all middleware) |
| 2 | **Registration & Patient** | A (cmd) → handler | patients, visits, UHID allocation, allergies, neonatal activation, DPDP guardian consent | New context, `dis/` template |
| 3 | **Clinical Capture** | A (cmd) → handler | vitals, growth z-scores (`GrowthEnginePort`), labs, vaccinations (IAP/NHM) | New; growth engine is a sealed pure module |
| 4 | **Document Ingestion** | A + B | OCR → staged `ocr_extractions` → `promotion.ts` gate | **Adopt `dis/` as-is** — already built |
| 5 | **Generation Worker** ★ | **B** | off-edge tool-use loop, `RequestGeneration`, streaming events, `rx_generation_jobs` read model, `prescription_drafts` | **The critical path.** Net-new worker process |
| 6 | **Job Queue & Realtime/Notify** | A + B | Postgres queue (POC) → SQS (prod), SSE relay, status projection, outbox dispatch | Extend `dis/` `QueuePort` + `StatusChannel` |
| 7 | **ABDM Service** | C | anti-corruption around ABDM gateway; 6 new ports | New context (see doc 07) |
| 8 | **Dose-Engine Service** ★ | in-proc (B + client) | sealed pure `DoseEnginePort`; AI proposes, engine recomputes & caps | Port `dose-engine.ts` (745 LOC) into `core/` |
| 9 | **Print/Output** | A | deterministic 4-row + SVG renderer; signed-QR verify endpoint | New; `SignaturePort` ES256 |

★ = the two services where a defect reaches paper. They get the strictest gates
(§8 dose-engine golden parity; §10 fail-closed sign-off invariant).

### Why three processes, not nine microservices

This is a single-hospital pediatric OPD doing tens of consults a day, not a
fan-out platform. Nine network-separated services would add operational surface
(nine deploys, nine sets of secrets, distributed-tracing tax) for zero throughput
benefit. **Bounded contexts are enforced as code modules + Postgres schemas + the
command bus, not as separate deployables.** The split into three *processes* is
driven by exactly one axis that matters here — **liveness**:

- **Process A** must answer in milliseconds and hold long-lived SSE connections.
- **Process B** runs minutes-long uncapped AI compute and must scale independently.
- **Process C** does fire-and-forget integration work that must never block sign-off.

Each can scale to zero / scale out on its own dimension. If throughput ever demands
it, any context can be extracted to its own deployable *without a rewrite* because
it already only talks through ports and the bus (open/closed).

---

## 2. Concrete stack (decisive — anchored on `dis/`)

| Concern | Choice | Rationale / source |
|---|---|---|
| Runtime | **Node 20** | One Dockerfile, portable Node/Bun/Lambda. Not Deno (Edge-only). |
| HTTP | **Hono** | `dis/` `ADR-005` (Hono over Fastify). `createServer()` returns a fresh app per call → test isolation. |
| Language | **TypeScript, strict** | CI fitness rules depend on it. |
| DB driver | **`postgres` (porsager)** — parameterized `sql`, no ORM | `dis/` `ADR-006`. Schema lives only in migrations. No Drizzle/Prisma. |
| Migrations | **dbmate**, forward + `.rollback.sql` | CI verifies up→down→up + `pg_dump` schema diff. `dis/migrations/M001–M008`. |
| Validation | **Zod** (env + DTOs) + **Ajv** (clinical JSON / formulary) | `dis/src/core/env.schema.ts`, `dis/src/core/schema/ajv.ts`. |
| Logging | **pino** + correlation IDs + PII redactor | `dis/src/core/logger.ts`. |
| Tests | **vitest**; fakes-only core suites < 1 s | `dis/src/core/__fakes__/`. |
| AI SDK | **`@anthropic-ai/sdk`**, streaming (`messages.stream` → `.finalMessage()`) | doc 06; never raw fetch in business code. |

### Hexagonal layout (copy `dis/` wholesale)

```
src/
  core/       pure TS — no fetch, no fs, no SQL, no adapter imports   (CI-enforced)
  ports/      interfaces only — the narrow waist; no adapter imports
  adapters/   vendor edge; each has a __fakes__/ peer
  http/       Hono router + middleware + SSE relay (thin)
  wiring/     the ONLY composition root that picks adapters by env (DIS_STACK)
  workers/    off-edge long-running compute (generation, FHIR, ABDM)
```

### Fitness rules (CI merge-blockers — extend `dis/scripts/fitness-rules.json`)

`dis/` already enforces six. Extend to every context and add two:

```jsonc
// existing in dis/scripts/fitness-rules.json:
"core_no_adapter_imports", "ports_no_adapter_imports",
"core_no_fetch", "core_no_xhr", "core_no_sql_literals",
"supabase_sdk_only_in_supabase_adapters", "aws_sdk_only_in_aws_adapters"

// ADD:
{ "name": "core_no_model_id_literals",
  "glob": "src/core/**/*.ts",
  "forbidden_pattern": "claude-[a-z0-9.-]+",
  "message": "model IDs live behind ModelPolicyPort — a dated string in business code retired prod (see §6, doc 06)" },
{ "name": "core_no_arithmetic_in_generation",
  "glob": "src/contexts/generation/core/**/*.ts",
  "forbidden_pattern": "\\b(parseFloat|parseInt|Math\\.round|toFixed)\\b",
  "message": "the dose engine is the sole arithmetic authority — generation core must not compute a dosing number (§8)" }
```

> **Why `core_no_model_id_literals` is load-bearing:** a hardcoded dated model
> string is exactly the failure that broke prod the day this rebuild was scoped.
> The prototype hardcodes `claude-sonnet-4-6` in the Edge Function tool loop. The
> only place a model ID may appear is the `ModelPolicyPort` config object resolved
> at the composition root.

### Compute platform — ranked, decisive

| Stage | Gateway (A) | Worker (B/C) | Queue | Notify |
|---|---|---|---|---|
| **POC** | Hono container on **Fly.io / Render** (long-lived, holds SSE) | same container, separate worker entrypoint, pulls from Postgres queue | **Postgres** (`ops.jobs`, pgmq / `pg_cron` adapter) — the `dis/` `M004` pattern | **SSE** + status-row poll |
| **Prod** | **Google Cloud Run** (60-min request timeout, scale-to-zero, clean SSE) — the boring default | Cloud Run job / Fly persistent worker | → **SQS** by `DIS_STACK=aws` flip | SSE; Fly persistent holder only if always-warm SSE needed |

**Supabase keeps:** Postgres, Auth (real JWT), Storage buckets. **Supabase Edge
Functions, if kept at all,** are thin signed-webhook receivers that `validate →
enqueue → 202` and SSE relays — **never the tool-loop host.** The whole point of
this rebuild is that the 150 s wall clock no longer governs generation.

---

## 3. API Gateway service (process A)

The Gateway is a thin Hono app. It does **no business logic** — it validates,
authenticates, scopes the DB session for RLS, turns HTTP requests into commands on
the bus, returns `202 {job_id}` for async work, and relays SSE. The `dis/`
`createServer()` factory is the template.

### Middleware stack (order matters — `dis/src/http/server.ts`)

```
1. correlation-id      tag every request; flows into logs, events, error envelopes, DB rows
2. cors                LOCKED to the GitHub-Pages origin (rx.radhakishanhospital.com) — never "*"
3. auth/jwt            verify Supabase JWT → extract role/doctor_id/facility_id claims
4. db-session-scope    SET app.role / app.doctor_id / app.facility_id  (drives RLS — §5, dis/ M008)
5. kill-switch         503 on writes when active (dis/ ADR-003, CS-9)
6. rate-limit          429 per-operator burst
7. idempotency         Idempotency-Key MANDATORY on writes (dis/ middleware/idempotency.ts)
8. routes              feature mounts (RouteModule pattern, dis/src/http/router.ts)
9. error-envelope      onError → { error:{ code, message, correlation_id, retryable } }
```

The prototype's anon-key-in-every-page model is replaced: the **anon key never
touches clinical schemas**, and the **service-role key is never reachable from a
client function**. Auth produces a JWT; the Gateway translates its claims into
Postgres session variables that RLS policies read (`current_setting('app.role')`).

### Error envelope (the one contract every caller depends on)

Ported from `dis/src/core/error-envelope.ts` / `dis/src/http/middleware/error-envelope.ts`:

```jsonc
// HTTP body for any non-2xx
{ "error": {
    "code": "VERSION_CONFLICT",          // UPPER_SNAKE, derived from the typed error class name
    "message": "version conflict on rx_draft 0e1...: current=4",
    "correlation_id": "req_018Ee...",    // always present, even on 500
    "retryable": false } }
```

`VersionConflictError` → `409 VERSION_CONFLICT` carrying the current persisted
version so the client reloads without a second round trip (the `dis/`
`OrchestratorError` / `VersionConflictError` pattern, generalized to every context).

### Route shape

| Method | Path | Returns | Notes |
|---|---|---|---|
| `POST` | `/patients`, `/visits`, `/vitals`, `/labs`, `/vaccinations` | `201` + resource | Each is a command on the bus; `Idempotency-Key` required. |
| `POST` | `/visits/{id}/note` | `204` | `DraftNoteUpdated` command (autosave; debounced client-side, deduped server-side — fixes the 3× `raw_dictation` write). |
| `POST` | `/generate` | **`202 { job_id }`** | `RequestGeneration` command → Generation Worker. Never blocks. |
| `GET` | `/jobs/{id}/events` | **SSE stream** | per-job channel: `GenerationStarted`, `ToolInvoked`, `DraftDelta`, `GenerationCompleted`, `GenerationFailed`. |
| `GET` | `/jobs/{id}` | `200 { status }` | status-row poll fallback for SSE. |
| `POST` | `/prescriptions/{id}/signoff` | `201` | `SignOff` command — the fail-closed human gate (§10). |
| `GET` | `/verify/{receipt}` | `200` | signed-QR verify; read-only; no PHI in QR URL (`SignaturePort`, doc 07). |

OpenAPI 3.1 is the source of truth, diffed against routes in CI (owned by the
`09_engineering_discipline/` suite). Full surface in doc 07.

---

## 4. Generation Worker service (process B) — the critical path

This is the service that kills the 150 s flaw. It is an **off-edge, long-lived,
horizontally-scalable worker** that pulls jobs from the durable queue and runs the
Claude tool-use loop with **no wall-clock cap.**

### 4.1 Internal hexagonal layering

```
src/contexts/generation/
  core/                         pure — no fetch, no SQL, no model-id literals, NO arithmetic
    generation.statemachine.ts  transition(state, event) — the safety spine (§10)
    content-hash.ts             hash({ note, patient_context_version, selected_sections })
    speculation-policy.ts       last-write-wins: newer hash supersedes in-flight run
    draft-assembler.ts          composes the draft from AI proposals + engine output
    severity-policy.ts          three-tier severity (port from sprint-2-saved)
  ports/
    GenerationPort              states: idle|streaming|ready|stale|error|timeout
    ModelPolicyPort             per-task model+effort config (no dated string here)
    ClinicalKnowledgePort       the 5 tools: get_formulary/get_standard_rx/get_previous_rx/
                                get_lab_history/get_reference  (+ compute_doses delegates to DoseEnginePort)
                                — tool input_schema + condensed output shapes frozen in 05_ai/tool_contracts.md
    DoseEnginePort              sealed pure recompute (§8)
    DatabasePort, StoragePort, QueuePort, SecretsPort   (shared with dis/)
  adapters/
    anthropic/                  messages.stream(...) → domain events;  __fakes__/ peer
    knowledge/                  DatabasePort/StoragePort-backed tool adapters; each has a __fake__
  workers/
    generation.worker.ts        queue consumer entrypoint (the off-edge process)
```

The `core/` here imports **only ports**. The Anthropic SDK lives behind
`adapters/anthropic/`. The dose engine lives behind `DoseEnginePort`. The model ID
lives behind `ModelPolicyPort`. This is the same DIP discipline as the `dis/`
`IngestionOrchestrator`, applied to generation.

### 4.2 Responsibilities & boundaries

| Responsibility | In this service | Explicitly NOT here |
|---|---|---|
| Run the Claude tool-use loop (parallel `Promise.all` tool execution) | ✅ | — |
| Stream deltas as domain events | ✅ | — |
| Recompute every dosing number via `DoseEnginePort` | ✅ (delegates) | computing the number itself (lives in dose engine §8) |
| Write `prescribing.rx_generation_jobs` read model + `prescription_drafts` | ✅ | finalizing/signing a prescription (only a human `SignOff` does — §10) |
| Speculatively (re)generate from the auto-saved note | ✅ | deciding clinical content authority (the doctor does) |
| FHIR bundle / ABDM push | ❌ (event-driven, process C) | — |

**Hard boundary:** the worker produces a draft in state `draft_ready`. It can never
emit `signed`. Sign-off is a separate human command routed through the state
machine (§10). This is the clinical-safety invariant, enforced as code, not prose.

**Consent precondition (canonical decision C6, fail-closed).** `RequestGeneration` is
**blocked at the command boundary — before any job is enqueued** — unless the patient
has an active `purpose='ai_assisted_rx'` guardian consent (`clinical.guardian_consents`
row with `consent_given = true AND withdrawn_at IS NULL`); otherwise the command fails
`403 CONSENT_REQUIRED`. The **speculative trigger is gated identically**, so a
withdrawn-consent patient never has an AI draft sitting in `prescription_drafts`;
withdrawal supersedes/cancels in-flight speculative jobs immediately. This `ai_assisted_rx`
gate is distinct from the `opd_care` consent (clinical processing at registration) and
the ABDM consent artefacts (health-data sharing) — three purposes, three gates, none
substitutes for another.

### 4.3 The four compounding latency mechanisms

**(1) Off-edge persistent worker.** The loop runs here, not in a 150 s function.
This single change deletes the 504/546-at-150,000 ms class. Delete every
timeout/budget/fallback workaround from `sprint-2-saved` — they only existed to
survive the wall.

**(2) Speculative / background generation from the auto-saved note.** The doctor's
note already autosaves (debounced) to `visits.raw_dictation`. Treat each meaningful
save and each section-chip change as a `DraftNoteUpdated` command → a debounced
background worker speculatively (re)generates a draft keyed by a **content hash** of
`{ note, patient_context_version, selected_sections }`. Last-write-wins: a newer
hash supersedes the in-flight run (`speculation-policy.ts`). By the time the doctor
clicks **Generate**, a fresh `draft_ready` usually already exists → review-first at
~0 ms.

**(3) Streaming end-to-end.** The worker uses `client.messages.stream(...)` and
`.finalMessage()` for timeout-protected completion (verified SDK behavior: the SDK
refuses non-streaming above ~16K `max_tokens`, and prescription generation runs at
`max_tokens` ~16000+, so streaming is mandatory). It emits a per-job event channel
the pad subscribes to by `job_id`. Real progress (diagnosis → meds → safety)
replaces the cosmetic `msgs[]` rotator.

**(4) Async job + notify + review-first UX.** Click Generate → if the speculative
hash matches the current note, **open review at 0 ms** with a subtle "draft —
confirm" badge while a background delta streams; if stale, show "regenerating from
your latest note…" inline. The `GenerationPort` exposes `idle | streaming | ready |
stale | error | timeout`, an `AbortController` on every request, exponential-backoff
retry, and a **hard client deadline → degraded UI (retry / manual edit /
single-shot), never an infinite spinner.**

### 4.4 Worker job loop (durable, idempotent, leased)

The queue is the `dis/` `dis_jobs` pattern (`M004`): `topic / payload / status /
attempts / locked_until / locked_by` + partial index on ready jobs. The worker:

```
loop forever:
  job = queue.lease("generate", lockSec, workerId)      // SKIP LOCKED, atomic claim
  if job is null: backoff; continue
  hash = job.content_hash
  if hash != latest_hash_for(visit):                    // speculation superseded
    state = transition(state, { kind: "superseded" });  persist;  ack;  continue
  emit GenerationStarted(job_id)
  stream = anthropic.stream(buildRequest(...))          // tools→system→messages; cache breakpoint after system
  for delta in stream:
    if delta.tool_use:        emit ToolInvoked;   results = Promise.all(tools)   // parallel
    if delta.text:            emit DraftDelta(delta)
  final = stream.finalMessage()
  draft = draft-assembler(final, recomputed_via DoseEnginePort)   // AI does NO math
  state = transition(state, { kind: "draft_ready" });  persist read model + draft
  emit GenerationCompleted(job_id)
  ack(job)
on error:  state = transition(state, { kind: "fail", reason });  emit GenerationFailed;  retry-or-dead
```

Every transition goes through the pure `transition()` function — invalid transitions
throw and are NEVER persisted, even on the failure path (the `dis/`
`IngestionOrchestrator.process()` failure-path pattern, where the `fail` target is
itself computed through `transition()`).

### 4.5 Scaling

- **POC:** 1 worker. Postgres `SKIP LOCKED` lease prevents double-pickup.
- **Prod:** N workers on Cloud Run, scale on queue depth. Idempotency key + content
  hash make double-delivery harmless (a duplicate job whose hash is stale is
  `superseded`; a duplicate with the same hash returns the existing draft).
- Prompt caching (doc 06) cuts per-call cost and TTFT: render order `tools →
  system → messages`; `cache_control:{type:"ephemeral"}` on the last system block;
  volatile content (note, allergies, patient_id, tool results) AFTER the breakpoint;
  no timestamps/UUIDs in the prefix. **Opus 4.8 minimum cacheable prefix = 4096
  tokens** (the skill `core_prompt.md` clears it). Pre-warm with `max_tokens:0` on
  worker boot. Audit `usage.cache_read_input_tokens != 0`.

---

## 5. Dose-Engine service (process: in-process port) — the open/closed safety boundary

**AI NEVER does arithmetic. The deterministic engine is the sole authority for any
number that reaches paper.** This is enforced three ways: the `core_no_arithmetic_in_generation`
fitness rule (§2), the `DoseEnginePort` seam, and a byte-for-byte server recheck.

> **Source-of-truth split (canonical decision C5).** The **runtime arithmetic
> authority is the pure TS `DoseEnginePort` (ported into `core/`)** — every mg/ml/drop
> that reaches a draft, the server re-check, or paper comes from there. **`web/dose-engine.js`
> is the frozen legacy reference / parity oracle, NOT the runtime engine** — the runtime
> never calls it. It is the doctor-validated baseline the TS port must match (project
> memory: *Rx dosing errors come from AI mental math, not the engine*), and the
> golden-parity gate (§5.3) is what licenses trusting the TS port until the JS is retired.

### 5.1 Port the verified engine into `core/`

`origin/sprint-2-saved:supabase/functions/_shared/dose-engine.ts` is a 745-line pure
TS port. Its public surface (verified this session) becomes the `DoseEnginePort`:

```ts
// ports/dose-engine.ts  — pure, zero DOM, zero IO
export interface DoseEnginePort {
  computeDose(p: ComputeDoseParams): ComputeDoseResult;   // the entry point
}
// re-exported pure helpers (verified signatures):
//   parseIngredients(formulation) : Ingredient[]
//   calculateBSA(weightKg, heightCm) : number | null
//   roundToUnit(...) : RoundResult
//   buildCalcString(...) , formatDoseDisplay(...)
//   FREQ_EN / FREQ_HI , HINDI_DROPS / HINDI_ML / HINDI_TABLETS / HINDI_UNITS

export interface ComputeDoseParams {            // verified shape
  method?: "weight"|"bsa"|"fixed"|"gfr"|"infusion"|"age";
  weight?: number; bsa?: number; heightCm?: number;
  sliderValue?: number; isPerDay?: boolean; frequency?: number;
  ingredients?: Ingredient[]; form?: string; outputUnit?: string;
  dropsPerMl?: number; ingredientBands?: IngredientBand[];
}
export interface ComputeDoseResult {            // verified shape
  vol: string; enD: string; hiD: string; calc: string; capped: boolean; fd: string;
  volumeMl: number; volumeUnits: number; ingredientDoses: IngredientDoseDetail[]; warnings: string[];
}
```

### 5.2 How the boundary works

1. The AI proposes a medicine + regimen with **no numeric fields** — only drug name,
   method, frequency, and which formulation.
2. The Generation Worker calls `DoseEnginePort.computeDose(...)`, which recomputes
   mg/ml/drops from concentration + dosing band + weight/BSA, rebuilds the bilingual
   R2/R3 strings + pictogram payload, and applies per-ingredient max-single / max-daily
   caps and therapeutic-range checks.
3. The **server re-checks the engine output byte-for-byte** before persisting — **no
   tolerance.** A client that submits a 20%-overridden dose is rejected.
4. Any mismatch → the draft's `overall_status` is set to `REVIEW_REQUIRED` (UPPER_SNAKE,
   stored + wire; the space-form "Review required" is display-only — canonical decision C3)
   and the sign-off gate engages.

The `compute_doses` tool from `sprint-2-saved` is retained: the LLM batches all
drugs, passes full `dosing_bands`, and copies the engine output verbatim. The
defensive `_normalizeDosingBand` normalizer (handles the case where the model passes
a single `ingredient_doses` sub-row instead of the full outer band) is ported too.

### 5.3 GOLDEN-PARITY GATE — the JS↔TS sync contract (mandatory before trust)

`sprint-2-saved` ships the TS port **without parity fixtures.** Close that gap with
the **golden JS↔TS parity gate** (canonical decision C5 / Part C) — the mechanism that
lets the system trust the TS `DoseEnginePort` as runtime authority while keeping the
doctor-validated `web/dose-engine.js` as the **oracle**:

```
GIVEN  ≥ 20 frozen fixtures in  evals/golden/dose_parity/*.fixture.json
WHEN   each fixture's ComputeDoseParams is run through BOTH
         - web/dose-engine.js   (the ORACLE)        → resultJS
         - core/ DoseEnginePort (the RUNTIME port)  → resultTS
THEN   resultTS MUST equal resultJS  byte-for-byte, zero tolerance, field-by-field:
         vol · enD (R2 English) · hiD (R3 Devanagari) · calc · capped · warnings[] ·
         volumeMl · volumeUnits · ingredientDoses[] · pictogram codes
       ANY divergence → ci/dose-parity FAILS → merge blocked, engine NOT trusted.
```

Coverage floor MUST include: syrup rounding → 0.5 ml, drops → 0.1 ml, tablets → ¼ tab
(0.25), max-single cap clamp, max-daily cap clamp, weight-based + BSA + GFR-adjusted
methods, combo-drug limiting ingredient (`ingredientDoses[].is_limiting`), bilingual
R2/R3 strings, and preterm corrected-age vs chronological. This is a CI merge-blocker
(required check **`ci/dose-parity`** under branch protection on `main`) and a release
blocker for the Generation context. **Why byte-for-byte, no tolerance:** the server
re-check (§5.2) rejects any non-engine number with zero tolerance, so the two engines
must be held to the same zero tolerance or oracle and runtime could silently disagree.
The runner is owned by `09_engineering_discipline/testing_strategy.md`; `evals_framework.md`
references it as the M2 oracle's integrity guarantee, and the eval scorer imports
`web/dose-engine.js` by design (the **oracle** — never the TS port, which would make the
test tautological). The same parity discipline applies to the `GrowthEnginePort`
(WHO z-scores) in the Clinical Capture context.

---

## 6. Job Queue & Realtime/Notify service

### 6.1 Queue — portable, POC→prod by env flip

The queue is the `dis/` `M004` table on POC, SQS in prod, both behind one
`QueuePort` (`dis/src/ports/queue.ts`, verified):

```ts
export interface QueuePort {
  enqueue(topic: string, payload: QueuePayload, opts?: { delaySec?: number }): Promise<{ messageId: string }>;
  startConsumer(topic: string, handler: (payload: unknown) => Promise<void>): Promise<void>;
}
```

`ops.jobs` (POC) carries `topic / payload(jsonb) / status(pending|running|done|
failed|dead) / attempts / max_attempts / locked_until / locked_by / last_error` with
a partial index on ready jobs — exactly `dis/migrations/M004_dis_jobs.sql`. The
`DIS_STACK=aws` flip swaps the adapter to SQS at the composition root; **no call site
changes** (the `dis/` `wiring/supabase.ts` vs `wiring/aws.ts` pattern). The SQL
migration `M004` is skipped on AWS (the wrapper filters it).

### 6.2 Realtime/Notify — SSE, not WebSocket

The prototype's Supabase Realtime WebSocket was removed for IO cost (commit
`1d80756`). The notify channel is **SSE** (per-`job_id`) with a **status-row poll
fallback**. The in-process fan-out is the `dis/` `StatusChannel` (an
`EventEmitter`-backed publish/subscribe, verified):

```ts
// dis/src/http/realtime/status-channel.ts — generalize the event shape to generation
interface GenerationEvent {
  type: "GenerationStarted"|"ToolInvoked"|"DraftDelta"|"GenerationCompleted"|"GenerationFailed";
  job_id: string; visit_id: string; correlation_id?: string; payload?: unknown; timestamp: string;
}
```

The Gateway's `GET /jobs/{id}/events` SSE handler subscribes to the channel filtered
by `job_id` and writes SSE frames. The **SSE handler code never changes** between POC
and prod — it subscribes to the **`RealtimePort`**; only the adapter the composition
root picks changes (canonical decision C7, the env-flip portability invariant).

**POC (single process):** in-memory `StatusChannel`.
**PROD (multi-instance, the canonical design):** the worker writes the domain event to
`ops.outbox` **in the same transaction** as the job-state change (transactional
outbox); a relay issues `NOTIFY 'rx_job_<job_id>'`; whichever gateway instance holds
that job's SSE connection is `LISTEN`ing on that channel and forwards. On Cloud Run
(N gateway instances) a doctor's SSE connection can land on any instance, so this
shared bus is what stops the stream silently stalling when worker-instance-B produces
an event for an SSE connection on gateway-instance-A. The **`NOTIFY` payload carries
only `{ job_id, event_id, type }`** (Postgres `NOTIFY` has an ~8 KB limit and is not
the data plane); the SSE relay reads the full frame from `ops.outbox` **by
`event_id`**, keeping PII / large deltas out of the `NOTIFY` channel. `ops.outbox` is
the durable backbone for **both** the live `NOTIFY` and the `Last-Event-ID` replay, so
an event is never lost on a worker/gateway crash and any instance can serve any job's
stream. **Reserved alternative:** a Redis pub/sub adapter behind the same
`RealtimePort` (only if `NOTIFY` fan-out or payload limits bite at scale) — swapped by
wiring, not by handler edits. Degrades to the status-row poll if `NOTIFY` is
unavailable.

### 6.3 Outbox / event dispatch

Domain events are written to `ops.outbox` in the same transaction as the read-model
update (transactional outbox), then a dispatcher relays them to:
- the SSE/notify channel (doctor's pad), and
- downstream subscribers (the ABDM service's `PrescriptionSigned` handler).

This is what makes ABDM/FHIR generation **event-driven and off the sign-off path**
(§7): sign-off writes `PrescriptionSigned` to the outbox and returns; the integration
worker picks it up asynchronously.

---

## 7. ABDM Service (process C) — anti-corruption around the gateway

Off-edge, event-driven, **never blocks sign-off.** `PrescriptionSigned` →
async handlers build the FHIR bundle and push to ABDM. Full contracts in doc 07;
the service-decomposition view:

| Port (new) | Responsibility |
|---|---|
| `FhirCompositionPort` (`NrcesR4Adapter`) | NRCeS R4 builders take **data, not a DB** (kills the prototype's N+1 formulary re-fetch). |
| `AbdmGatewayPort` | session/auth, `on-*` callbacks, `pushHealthInformation`, consent. Verify inbound JWS against ABDM CM JWKS + timestamp/nonce — fail closed. |
| `CryptoBoxPort` | **Fidelius — Curve25519 Short-Weierstrass, NOT libsodium Montgomery.** Plaintext gated behind a double-locked sandbox flag. |
| `SignaturePort` | ES256 JWS — replaces the forgeable 6-char client-salt QR hash. `verify.html` calls a read-only server endpoint; no PHI in the QR URL; QR rendered client-side. |

Reliability: `abdm.outbox` / `abdm.inbox` tables for at-least-once callbacks. The
context is its own process so a slow/unavailable ABDM gateway cannot stall the OPD
workflow. Sequencing: M1 (ABHA at registration) → M2 (HIP push) first; M3 (HIU)
deferred. Prereqs (HFR ID + HPR ID) live in config/secrets, **not source** — the
prototype's baked-in `HOSPITAL.hfr_id=""` is removed.

---

## 8. Inter-service contracts

Three contract surfaces, each machine-checkable:

### 8.1 Command bus contract (intra-process, typed)

Every mutating action — doctor edit, nurse approve, system auto-approve, future AI
agent — emits the **same `Command` envelope** to one bus. Commands are validated
against Zod schemas at the boundary; results are domain `Event`s.

```ts
interface Command<K extends string, P> {
  kind: K;                       // "RequestGeneration" | "SignOff" | "DraftNoteUpdated" | ...
  payload: P;                    // Zod-validated DTO
  actor: Actor;                  // { type: "human"|"ai_agent"|"system", id, role }
  facility_id: string;
  idempotency_key: string;       // required on every write
  correlation_id: string;
  occurred_at: string;           // ISO 8601
}
interface Event<K extends string, P> { /* same envelope, past-tense kind */ }
```

`RequestGeneration` (from click | speculative trigger | future AI agent) and
`DraftNoteUpdated` (autosave) are **indistinguishable commands** to the worker — that
symmetry is what makes AI-first an additive subscriber, not a rewrite (§10).

### 8.2 HTTP / SSE contract (inter-tier, OpenAPI 3.1)

The Gateway↔client contract is OpenAPI 3.1, diffed against routes in CI. Async
generation is `POST /generate → 202 {job_id}`; SSE is `GET /jobs/{id}/events`. Every
write requires `Idempotency-Key`; every response carries `correlation_id`. Full
surface in doc 07.

### 8.3 Port contracts (hexagon seams, fakes-tested)

Every port has a `__fake__` peer used in core test suites (< 1 s, no IO). A port's
contract is its TypeScript interface plus a shared contract-test suite run against
both the real adapter and the fake (the `dis/` `__fakes__` discipline). The
load-bearing ones:

| Port | Contract guarantee |
|---|---|
| `DoseEnginePort` | pure, deterministic; golden JS↔TS parity fixtures (§5.3) |
| `GenerationPort` | state contract: only the legal `idle→streaming→ready/stale/error/timeout` transitions; AbortController honored |
| `ClinicalKnowledgePort` | `get_previous_rx` is **PII-stripped at a typed boundary**, not an ad-hoc `.map` |
| `ModelPolicyPort` | returns `{ model, effort, thinking }` per task; **no dated string in business code** |
| `DatabasePort` | parameterized SQL only; `setSessionVars` scopes RLS per transaction (`dis/` verified) |
| `QueuePort` | at-least-once; lease semantics; JSON-serializable payloads |

---

## 9. The Command Bus + CQRS seam (the single most important net-new construct)

`dis/` has the state-machine + event pieces (`state-machine.ts`, `StatusChannel`,
the outbox-style status projection) but **no general command bus.** Build it. It is
the spine of the symmetric-actor design.

### 9.1 Shape

```
            ┌──────────────┐   dispatch    ┌───────────────┐   transition()   ┌─────────────┐
 Actor ───▶ │ CommandBus   │ ────────────▶ │ CommandHandler│ ───────────────▶ │ state-machine│
 (human|AI| │ - validate   │               │ (per context) │  (pure, throws   │ (pure spine) │
  system)   │ - idempotency│               │               │   on illegal)    └─────────────┘
            │ - audit-in   │               └───────┬───────┘                         │
            └──────────────┘                       │ emit                            │ persist
                                                   ▼                                 ▼
                                            ┌──────────────┐   project    ┌────────────────────┐
                                            │  EventBus    │ ───────────▶ │ CQRS read models    │
                                            │  + outbox    │              │ rx_generation_jobs, │
                                            └──────────────┘              │ status rows, drafts │
                                                                          └────────────────────┘
```

### 9.2 What it buys (each a concrete prototype defect it fixes)

| CQRS/command-bus property | Prototype defect it fixes |
|---|---|
| Every mutation is a validated, deduped command | the **3× `raw_dictation` write** (no dedup today) |
| Commands carry an `actor` of type human/ai/system | enables AI-first as an additive subscriber (no rewrite) |
| Reads go through cached query objects | scattered `fetch()` + anon-key reads in 21k lines of inline JS |
| Every command-in is audited | heuristic `console.log` traceability replaced by an event stream (NABH + clinical-safety traceability) |
| Optimistic UI / dedup | duplicate sign-off, double-generate races |

### 9.3 The state machine is the safety spine

The pure `transition(state, event)` (the `dis/` `state-machine.ts` pattern) governs
the prescription lifecycle:

```
note_captured → generating → streaming → draft_ready → doctor_editing → signed → printed
                                    └──────────► superseded
              └──────────────────────────────► failed
```

Invalid transitions **throw and are NEVER persisted**, even on failure paths — every
path, including errors, routes through `transition()`. The **clinical-safety
invariant**: an AI draft is `pending_review`/`draft_ready` until a human `SignOff`
command moves it to `signed`. This is identical fail-closed gating to the OCR
`promotion.ts` confidence gate (`dis/` CS-1 / CS-7): nothing is promoted/finalized
without an explicit verification step.

> **`signed` is a row insert, not a status update (canonical decision C4).** In this
> state-machine view `signed` is the terminal pre-print state, but it **materializes as
> a row INSERT into `prescribing.prescriptions`** — a prescription has **no `status`
> column**; row existence *is* the signed state (immutable; edits → `rx_versions`). The
> API's `status:"signed"` is a **synthetic/derived field** computed at serialization
> from row existence, never read from or written to a column. The mutable pre-sign
> lifecycle lives on the **draft** (`prescription_drafts.status`) and the **job**
> (`rx_generation_jobs.status`); **no job/draft enum ever carries a `signed` value** —
> exactly the invariant that no API path turns model output into a signed Rx without a
> human `SignOff`.

### 9.4 Going AI-first later = an additive subscriber, not a rewrite

Because humans and AI emit the *same* command envelope to the *same* bus, an
autonomous "AI-drafts-then-doctor-signs" mode is a new subscriber that emits
`RequestGeneration` (and, in a fully-autonomous future, `SignOff`) on its own. No
existing handler, port, or schema changes. The seam is the deliverable.

---

## 10. Cross-cutting: security, observability, deployment

**Security / RLS.** Real per-role RLS (`reception`, `nurse`, `doctor`, `service`,
`admin`) via `current_setting('app.role' / 'app.doctor_id' / 'app.facility_id')` set
from JWT at request start — the `dis/` `M008` pattern that runs on Supabase **and**
RDS. **No DELETE policy** on clinical/audit tables. Anon key never touches clinical
schemas; service-role key never client-reachable. Secrets via `SecretsPort`
(Supabase secrets POC → AWS Secrets Manager prod). No PII to the model — the
`get_previous_rx` / visit-summary PII-strip is a typed boundary, not an ad-hoc map.

**Observability / auditability.** Every generation is an event stream
(`generation_events` / `prescription_audit`, ported from `sprint-2-saved`) recording
command-in, each `ToolInvoked`, **the model id + version actually used**, token
usage, cost (micro-INR int), latency_ms, the final draft, and the sign-off — one row
per attempt incl. retries/fallback (`meta_mode`, `stop_reason`, `tools_called[]`,
`requested/emitted/omitted/added`, `severity_*`, `warnings[]`, `duration_ms`). This
satisfies NABH traceability and replaces heuristic console logs. Append-only
`ops.audit_log` with BEFORE UPDATE/DELETE triggers that raise (the `dis/` `M002`
pattern).

**Deployment.** One Dockerfile, three entrypoints (gateway / generation-worker /
integration-worker). POC: Fly.io / Render + Postgres queue. Prod: Cloud Run + SQS by
`DIS_STACK=aws` flip. dbmate forward-only migrations, CI-verified up→down→up. Shadow
rollout before cutover: run speculative generation in shadow, diff against legacy
Edge output; feature-flag ladder (`ENABLED → SHADOW → OPT_IN_OPERATORS → *`) +
kill-switch.

---

## 11. Key file references (absolute / branch-qualified)

- **Foundation (`origin/feat/dis-plan`):**
  - `dis/src/ports/{database,storage,queue,secrets,structuring,ocr,...}.ts`
  - `dis/src/core/{orchestrator,state-machine,promotion,confidence-policy,env.schema,idempotency-store,error-envelope,audit-log,...}.ts`
  - `dis/src/http/{server,router,middleware/*,realtime/status-channel,routes/*}.ts`
  - `dis/scripts/fitness-rules.json`; `dis/wiring/{supabase,aws}.ts`
  - `dis/migrations/M001–M008` (+ `.rollback.sql`); ADR-003 (kill-switch 503), ADR-005 (Hono), ADR-006 (postgres driver), ADR-007 (Haiku default + escalation)
- **Clinical brain (`origin/sprint-2-saved`):**
  - `supabase/functions/_shared/dose-engine.ts` (745-line pure port — `computeDose`/`parseIngredients`/`calculateBSA`/`roundToUnit`/`buildCalcString`, typed `ComputeDoseParams`/`ComputeDoseResult`)
  - `supabase/functions/generate-prescription/index.ts` (`compute_doses` tool, three-tier severity; **the 150 s flaw** — tool loop ~500-613, hardcoded `claude-sonnet-4-6` ~711/832, 90 s abort ~694)
  - `radhakishan_system/skill/core_prompt.md`; migrations `20260428001000_prescription_audit.sql`, `20260428002000_pg_trgm.sql`
- **Prototype to retire (`E:\…\radhakishan-prescription-system`):**
  - `supabase/functions/generate-prescription/index.ts` (the 150 s flaw)
  - `web/dose-engine.js` (frozen legacy reference / **parity oracle** — NOT the runtime engine; the runtime authority is the `core/` TS `DoseEnginePort`, C5. Parity-test the TS port against it byte-for-byte, §5.3)
  - `console-log.md:15-16` (546-at-150,000 ms evidence)
