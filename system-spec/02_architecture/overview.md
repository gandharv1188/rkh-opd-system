# 02 · Architecture Overview — Target-State System Map

> **Status:** Authoritative target-state design. Build to **this**, not to the live `web/` + Supabase Edge-Function prototype. Where this document and an upstream study report disagree, this document wins; where it disagrees with a verified API fact, the file author flags it.
>
> **Scope of this file:** The end-to-end component/service map — frontend, backend services, database, AI, integrations — plus the off-edge compute model and the request/generation flows that justify it. Sibling files own depth: `04_database/` the full DDL, `05_ai/` the prompt/tool internals, `06_api/` the OpenAPI contract, `07_integrations/` ABDM/FHIR, `08_security/` RLS/DPDP, `09_engineering_discipline/` the TDD/eval operating model. This file is the spine they hang off.

---

## 0. The one paragraph that constrains everything

A pediatric OPD prescription system where **the doctor's perceived wait to a reviewable prescription is ~0**, the **deterministic dose engine is the sole arithmetic authority** (the AI selects drugs and regimens and narrates; it never computes a number that reaches paper), and **humans and AI are symmetric actors** on one command/event bus, so an autonomous "AI-drafts-then-doctor-signs" mode is an *additive subscriber*, not a rewrite. Everything else — bilingual + pictogram print, ABDM/FHIR, NABH auditability, DPDP child-data compliance — hangs off a hexagonal, port/adapter, config-driven core that is portable from Supabase to AWS by an environment flip (`DIS_STACK=supabase|aws`). The system is TDD- and eval-gated; clinical safety is enforced as **code** (a pure state machine plus a staging/clinical separation), not as prompt text.

---

## 1. Architectural style (decisive)

**Hexagonal (Ports & Adapters) + event-driven core, organized as DDD bounded contexts in one monorepo.** This is not aspirational — the foundation already exists on `origin/feat/dis-plan` under `dis/` (typecheck-clean Hono service, `postgres` driver, dbmate migrations, 8 ports with `__fakes__` peers, Zod env, fitness-rules CI). We copy that skeleton wholesale and extend it to every context.

Three reinforcing patterns:

| Pattern | What it buys | Where it lives |
|---|---|---|
| **Ports & Adapters** | Vendor portability (Supabase → AWS), test isolation (fakes-only core suites < 1s), and a single composition root | `core/`, `ports/`, `adapters/`, `wiring/` |
| **CQRS-lite + Command/Event Bus** | Symmetric human/AI actors, optimistic UI, dedup (kills the 3× `raw_dictation` write), audit-by-construction | `core/command-bus`, `ops.outbox`, CQRS read models |
| **Staging → Promotion (DDD anti-corruption)** | Clinical-safety invariant: AI/OCR output is `pending_review` until a human `SignOff`; identical fail-closed gate for drafts and OCR | `core/state-machine.ts`, `core/promotion.ts` |

**Why hexagonal and not layered MVC:** the explicit, non-negotiable goal is cloud-and-vendor portability and machine-checkable safety boundaries. Ports are the contract; adapters change when the environment changes; **core never does** — and CI enforces it (a model-ID string in business code, a `fetch()` in `core/`, or raw SQL outside an adapter is a merge blocker).

### 1.1 Repository layout (the monorepo template)

```
src/
  core/        pure TS — no fetch, no fs, no SQL, no adapter imports (CI-enforced)
               state-machine · command-bus · dose-engine · growth-engine ·
               promotion · confidence-policy · env.schema · audit-log ·
               idempotency-store · error-envelope · content-hash
  ports/       interfaces only (the narrow waist) — no adapter imports
               DatabasePort · StoragePort · QueuePort · SecretsPort ·
               ModelPolicyPort · ClinicalKnowledgePort · DosingPort ·
               GrowthEnginePort · RealtimePort · FhirCompositionPort ·
               AbdmGatewayPort · CryptoBoxPort · SignaturePort
  adapters/    vendor edge; each has a __fakes__/ peer
               database/{supabase-postgres,aws-rds} · storage/{supabase,s3} ·
               queue/{pg-cron,sqs} · secrets/{supabase,aws} ·
               model/anthropic · abdm/nrces · ...
  http/        Hono router + middleware + SSE relay (thin)
  workers/     off-edge long-running compute (generation, FHIR, ABDM)
  wiring/      the ONLY composition root that picks adapters by env
ui/            Vite + TS SPA (component-based; ports mirror the server)
```

### 1.2 Fitness rules (CI merge-blockers)

Extend `dis/scripts/fitness-rules.json` (6 rules verified on-branch) to every context:

- `core_no_adapter_imports`, `ports_no_adapter_imports` — DIP boundary.
- `core_no_fetch`, `core_no_xhr` — no network I/O in core.
- `core_no_sql_literals` — SQL belongs at the adapter boundary only.
- `supabase_sdk_only_in_supabase_adapters`, `aws_sdk_only_in_aws_adapters` — vendor SDK containment.
- **`core_no_model_id_literals` (new)** — no `claude-*` / `us.anthropic.*` string in business code. *Rationale: a hardcoded dated model retired and broke production. The model lives behind `ModelPolicyPort` config only.*

---

## 2. Off-edge compute model (the headline fix)

### 2.1 The flaw being designed out

The prototype runs the Claude tool-use loop **synchronously inside a Supabase Edge Function** capped at a hard 150 s wall clock. Generation takes 50–150 s; logs show `504`/`546` at exactly `150,000 ms` (`origin/main:supabase/functions/generate-prescription/index.ts` — `AbortController` at 120 s line 501, hardcoded `claude-sonnet-4-6` line 518; `console-log.md` shows the live `HTTP 546`). Doctors wait up to ~5 minutes. Every timeout/budget/fallback workaround in `sprint-2-saved` exists only to survive this wall and is **deleted** in the rebuild.

### 2.2 The model: long-running worker, not the edge

```
┌──────────────────────────────────────────────────────────────────────────┐
│  COMPUTE PLATFORM (one Dockerfile; runs anywhere — Node 20 + Hono)         │
│                                                                            │
│  POC:  Hono container on Fly.io / Render   (long-lived; holds SSE)         │
│  PROD: Google Cloud Run (60-min request timeout, scale-to-zero, clean SSE) │
│         → AWS Fargate/Lambda by DIS_STACK=aws flip                          │
│                                                                            │
│  Job queue:  Postgres queue (pg-cron/pgmq, the dis/ M004 pattern)  POC     │
│              → SQS  (DIS_STACK=aws)                                 PROD    │
└──────────────────────────────────────────────────────────────────────────┘

Supabase remains ONLY: Postgres · Auth (real JWT) · Storage buckets.
Edge Functions, if kept at all, are thin signed-webhook receivers that
validate → enqueue → 202, plus SSE relays. They NEVER host the tool loop.
```

**Decisive stack** (anchored on `dis/`): Node 20 + **Hono** (portable Node/Deno/Bun/Lambda; ADR-005); TypeScript strict; **`postgres` (porsager) driver, no ORM** (schema lives only in migrations, ADR-006); **dbmate** forward + `.rollback.sql` migrations (CI verifies up→down→up + pg_dump diff); **Zod** (env + DTOs) + **Ajv** (clinical JSON payloads/formulary); **pino** + correlation IDs + PII redactor; **vitest** fakes-only core suites.

### 2.3 Why a persistent worker is mandatory, not optional

The Anthropic SDK **refuses non-streaming requests above ~16K `max_tokens`** (estimated > 10-minute wall clock). Prescription generation needs `max_tokens` ≈ 16000+ and therefore **must stream**. A 150 s edge function cannot hold a streaming, multi-round tool loop to completion. The worker can: it pulls a job from the durable queue, runs `client.messages.stream(...)` with `.get_final_message()` for timeout-protected completion, and emits domain events on a per-job channel.

---

## 3. End-to-end component / service map

### 3.1 The whole system at a glance

```
                          ┌───────────────────────────────────────────────┐
                          │                FRONTEND (SPA)                  │
                          │   Vite + TS · components · design tokens       │
                          │                                                │
  Reception ─┐            │  <PatientHeaderStrip> <VitalsPanel>            │
  Nurse ─────┤  3-stage   │  <DictationPad> <SectionChips>                 │
  Doctor ────┤  OPD flow  │  <MedicineCard> <DoseAdjuster> <SafetyPanel>   │
  Print ─────┘            │  <PrescriptionReview> <PrintDocument>          │
                          │  <GrowthTrend> <LabPills> <VaxChecklist>       │
                          │  <QrBlock> <SignoffGate>                       │
                          │                                                │
                          │  Client ports (anti-corruption seams):         │
                          │  DataAccessPort · GenerationPort · ConfigPort  │
                          │  TranscriptionPort · PrintPort · RealtimePort  │
                          │  CommandBus / EventBus                         │
                          └───────────────┬───────────────────────────────┘
                                          │ HTTPS (REST + 202-jobs) · SSE
                          ┌───────────────▼───────────────────────────────┐
                          │             API GATEWAY (Hono)                 │
                          │  correlation-id · idempotency · error-envelope │
                          │  kill-switch (503) · rate-limit · CORS-locked  │
                          │  JWT → app.role/app.doctor_id/app.facility_id  │
                          └───────────────┬───────────────────────────────┘
                                          │  CommandBus → EventBus
        ┌────────────┬────────────┬───────┴──────┬─────────────┬───────────┐
        ▼            ▼            ▼              ▼             ▼           ▼
 ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌─────────┐ ┌──────────┐
 │Registration│ │Clinical  │ │Document  │ │ GENERATION │ │  ABDM   │ │ Print/   │
 │& Patient   │ │Capture   │ │Ingestion │ │  WORKER    │ │ Service │ │ Output   │
 │            │ │          │ │(dis/ OCR)│ │(off-edge)  │ │         │ │          │
 │UHID alloc  │ │vitals    │ │OCR→staged│ │tool loop · │ │FHIR R4 ·│ │4-row+SVG │
 │allergies   │ │growth z  │ │promotion │ │stream ·    │ │ABHA ·   │ │renderer ·│
 │neonatal    │ │labs/vax  │ │gated     │ │speculative │ │HIP push │ │QR verify │
 │DPDP consent│ │          │ │          │ │            │ │         │ │          │
 └─────┬──────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘ └────┬────┘ └────┬─────┘
       │             │            │             │             │           │
       └─────────────┴────────────┴──────┬──────┴─────────────┴───────────┘
                                         ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  SHARED PURE CORE (no IO):  DoseEnginePort · GrowthEnginePort ·          │
   │  state-machine.transition() · CommandBus · ClinicalKnowledgePort tools   │
   └──────────────────────────────────────┬──────────────────────────────────┘
                                          ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  DATA + PLATFORM                                                          │
   │  Postgres (DDD schemas: catalog · clinical · prescribing · identity ·    │
   │            abdm · ops)  ·  Job queue (pg-cron→SQS)  ·  Outbox             │
   │  Storage buckets (skill · prescriptions · documents)  ·  Secrets (port)  │
   └──────────────────────────────────────┬──────────────────────────────────┘
                                          ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  EXTERNAL                                                                 │
   │  Claude API (ModelPolicyPort) · ABDM Gateway (CM/HIP/HIU) · NRCeS FHIR    │
   └─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Backend bounded contexts (one repo, each a hexagon)

Every context is `core/ports/adapters/__fakes__`; every action flows through the **CommandBus → EventBus**. The CommandBus is the single most important net-new construct — `dis/` ships the state-machine and event pieces but no general bus; we build it.

| # | Context | Responsibility | Key ports | Notes / source-of-truth discipline |
|---|---|---|---|---|
| 1 | **API Gateway** | Transport, cross-cutting middleware | — | `createServer()` returns a fresh instance per call (test isolation). `Idempotency-Key` mandatory on writes. Error envelope `{error:{code,message,correlation_id,retryable}}`. Kill-switch → 503 on writes. CORS locked to GitHub-Pages origin, not `*`. |
| 2 | **Registration & Patient** | patients, visits, UHID, allergies, neonatal auto-activation, DPDP guardian consent | `DatabasePort` | **Server-side UHID/receipt/token allocation** (kills the client `MAX(seq)+1` race). |
| 3 | **Clinical Capture** | vitals, growth z-scores, labs, vaccinations (IAP/NHM mutual exclusion) | `GrowthEnginePort`, `DatabasePort` | Growth z-scores computed by a **deterministic** engine — same source-of-truth discipline as dosing. |
| 4 | **Document Ingestion** | OCR → staged `ocr_extractions`, gated promotion | `OcrPort`, `StructuringPort`, `StoragePort` | Adopt `dis/` as-is. Never direct-writes clinical tables; the single `promotion.ts` command behind a confidence gate. |
| 5 | **Generation Worker** | the critical path — off-edge tool loop, streaming, speculative draft | `ModelPolicyPort`, `ClinicalKnowledgePort`, `DosingPort`, `QueuePort`, `RealtimePort` | `RequestGeneration` from doctor click OR speculative trigger OR future AI agent — **symmetric**. Writes `rx_generation_jobs` read model + `prescription_drafts`. |
| 6 | **Job Queue & Realtime/Notify** | durable queue, SSE relay, status projection, outbox dispatch | `QueuePort`, `RealtimePort` | Postgres queue (POC) → SQS (prod). SSE or short-interval status-row poll is the notify channel (Realtime WebSocket removed for IO cost). |
| 7 | **ABDM Service** | anti-corruption around the ABDM gateway | `AbdmGatewayPort`, `FhirCompositionPort`, `CryptoBoxPort`, `SignaturePort` | Event-driven: `PrescriptionSigned` → async handlers. Sign-off never blocks on it. |
| 8 | **Dose-Engine Service** | the sealed arithmetic authority | `DoseEnginePort` | Pure, zero DOM/IO. AI proposes; engine validates/recomputes; mismatch → `REVIEW REQUIRED`. |
| 9 | **Print / Output** | the single canonical A4 renderer + signed-QR verify endpoint | `PrintPort`, `SignaturePort` | Eliminates the duplicate `printRx`/`renderRx`. |

### 3.3 Frontend architecture

**Component-based SPA (Vite + TS; React or equivalent — match `dis/ui`).** Replaces the 8 single-file HTML pages and ~21k lines of duplicated inline JS/CSS. Container/presentational split; **state behind abstractions** (a typed client-side store is the command-bus analog); **no raw `fetch` + anon-key in components**.

**Client ports (anti-corruption seams — no component touches a vendor directly):**

| Port | Contract |
|---|---|
| `DataAccessPort` | one Supabase/REST adapter; all reads/writes go through it |
| `GenerationPort` | streaming with states `idle | streaming | ready | stale | error | timeout`; `AbortController` on every request; exponential-backoff retry; hard client deadline → degraded UI, **never an infinite spinner** |
| `TranscriptionPort` | dual-engine VAD: AI transcribe primary, Web Speech fallback (`en-IN`) |
| `ConfigPort` | centralized URL/key/**MODEL** — no hardcoded model anywhere on the client |
| `PrintPort` | drives the single `<PrintDocument>` renderer |
| `RealtimePort` | SSE / status-row subscription by `job_id` |
| `EventBus` / `CommandBus` | every mutation is a command → audit, optimistic UI, dedup, symmetric-actor layer |

**CQRS on the client:** every mutation (`SaveNote`, `AdjustDose`, `AddMedicine`, `GiveVaccination`, `SignOff`) is a command. Reads go through cached query objects. This fixes the 3× `raw_dictation` write and is the seam the autonomous AI layer plugs into later.

**Safety UX (ported verbatim from `sprint-2-saved`'s `prescription-pad.html`, re-homed into components):** missing-weight prompt at Generate (persists); preterm corrected/chronological age pre-computed **on the client** (AI does no arithmetic); `applySignoffGate()` (high severity → Sign disabled until ack; moderate → caution banner; re-applied after any edit so high→edit→save can't bypass); inline allergy-safe-alternative; `renderOmittedStubs()` red stubs for formulary misses. Provenance: AI-generated lines visually distinct from clinician edits; "AI-assisted, doctor-reviewed" line on the printed Rx.

**Design system (tokens, not inline styles):** colour code as tokens — **blue = meds, red = investigations, black = else**. Preserved invariants: 4-row bilingual medicine block (R1 GENERIC CAPS(conc) / R2 English / R3 Devanagari / R4 inline-SVG pictogram sidebar sunrise-sun-sunset-moon + dose-qty + food/duration); A4 print spacing (margins 12 mm 10 mm, body 12 px/1.5, med r1 14 px / r2–r3 12 px, emergency 2-col, centered hospital header, NABH badge); Noto Sans Devanagari; **inline SVG only**; sticky headers. **a11y:** WCAG 2.2 AA, Lighthouse ≥ 90, no colour-only status (mitigates rubber-stamp risk). **Tablet:** touch targets, dose slider, and voice are first-class.

---

## 4. AI orchestration map

The `Generation` bounded context owns all model interaction behind ports.

### 4.1 Centralized model policy (no dated string in business code)

Model strategy lives behind one **`ModelPolicyPort`** config object; CI rule `core_no_model_id_literals` enforces it. Verified current IDs/pricing (claude-api skill, 2026-06):

| Model | ID | Input $/MTok | Output $/MTok | Context | Max output |
|---|---|---|---|---|---|
| Claude Opus 4.8 | `claude-opus-4-8` | $5.00 | $25.00 | 1M | 128K |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | $3.00 | $15.00 | 1M | 64K |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1.00 | $5.00 | 200K | 64K |

**Per-task policy:**

| Task | Model | Effort / thinking | Rationale |
|---|---|---|---|
| Prescription generation | `claude-opus-4-8` | `output_config.effort:"high"`, `thinking:{type:"adaptive"}` | Correctness-sensitive. Speculative async absorbs latency, so the old Sonnet+`effort:low` speed hack is unnecessary. Opus 4.8 under-reaches for tools by default → add prescriptive "Call this when…" trigger text to tool descriptions + a search-first nudge. `max_tokens` ≈ 16000+ → **MUST stream**. |
| Visit summary | `claude-haiku-4-5` (or sonnet-4-6) | `effort:"low"` | Bounded ~250-word summary. |
| OCR structuring | `claude-haiku-4-5` default, escalate to `claude-sonnet-4-6` on low-confidence/schema-invalid | per `dis/` ADR-007 | Reuse the existing pattern. |
| Drug/protocol lookup | `claude-haiku-4-5` | `effort:"low"` | Format/lookup only. |

### 4.2 Verified API surface (do not regress)

- Opus 4.8 takes `thinking:{type:"adaptive"}` **only** — `budget_tokens`, `temperature`, `top_p`, `top_k` all return **400**. `effort` lives inside `output_config`.
- **Streaming is mandatory** for large `max_tokens` — the SDK refuses non-streaming above ~16K. Use `client.messages.stream(...)` + `.get_final_message()`.
- No assistant prefill (use structured outputs `output_config.format`).
- `stop_reason:"refusal"` must be checked before reading `content[0]`.

### 4.3 Prompt caching (independent, biggest cost + TTFT win)

Render order `tools → system → messages`. Freeze tool defs (deterministic order) + skill `core_prompt.md` + pre-embedded NABH block; place `cache_control:{type:"ephemeral"}` on the last system block. Volatile content (note, allergies, `patient_id`, tool results) goes **after** the breakpoint. **No timestamps/UUIDs in the prefix.** Pre-warm with `max_tokens:0` on worker boot. Opus 4.8 minimum cacheable prefix = **4096 tokens** (the skill prompt clears it). Audit `usage.cache_read_input_tokens` is non-zero across requests.

### 4.4 Tool-use / progressive disclosure (behind `ClinicalKnowledgePort`)

Keep the 5-tool design with parallel `Promise.all` execution. DatabasePort-backed adapters: `get_formulary` (with `condenseDrugForAI()` token-stripping), `get_standard_rx` (ICD-10-first), `get_previous_rx` (PII-stripped — a **typed boundary**, not ad-hoc `.map`), `get_lab_history`. StoragePort-backed: `get_reference`. Each gets a `__fake__`. Pre-embed NABH to save a round. Add the **`compute_doses`** tool from `sprint-2-saved` (LLM batches all drugs, passes full `dosing_bands`, copies engine output **verbatim**). Consider `strict:true` tools + structured outputs against the `core_prompt.md` JSON schema to retire the brittle `extractJSON` regex.

### 4.5 Dose-engine separation (the open/closed safety boundary)

**AI never does arithmetic.** Port `dose-engine.ts` (745-line pure TS on `sprint-2-saved`; exports `computeDose`, `parseIngredients`, `calculateBSA`, `roundToUnit`, `buildCalcString`, `FREQ_EN/HI`, `HINDI_DROPS/ML/TABLETS/UNITS`, typed `ComputeDoseParams`/`ComputeDoseResult`) into `core/` as the pure `DoseEnginePort`. The AI proposes med + regimen with **no numeric fields**; the engine recomputes mg/ml/drops from concentration + band + weight/BSA, rebuilds R2/R3 bilingual + pictogram, applies per-ingredient max-single/max-daily caps and therapeutic-range checks; the server re-checks **byte-for-byte** (no tolerance — reject the 20% client override); any mismatch → `REVIEW REQUIRED`. **TDD gate (mandatory before trust): golden JS↔TS parity fixtures** (≥ 20 cases — syrups round 0.5 ml / drops 0.1 ml / tablets 0.25; caps; bilingual strings). `sprint-2-saved` ships the TS port **without** fixtures; closing that gap is a release blocker.

### 4.6 Streaming + fallbacks (production-grade)

Worker `client.messages.stream` → domain events. Fallback = **model-tier downgrade** Opus 4.8 → Sonnet 4.6 on overload/5xx/timeout via `ModelPolicyPort`, with a `stop_reason:"refusal"` guard before reading `content[0]`, and backoff+jitter on 429/5xx. For same-model provider failover, a Bedrock/Vertex secondary path is the safest. **Never silently downgrade the clinical model class without flagging.** Keep loop-cap and repeated-tool-call guards, promoted to typed, audited events.

---

## 5. Request & generation flows

### 5.1 The latency design — four compounding mechanisms

Target: **perceived wait ≈ 0**, never an infinite spinner, draft **always** doctor-reviewed/signed (never auto-finalized — clinical-safety invariant).

1. **Off-edge persistent worker.** The tool loop runs on the Hono/Cloud-Run worker pulling from the durable queue — not in a 150 s function. Kills the `504/546-at-150,000 ms` failure class.
2. **Speculative / background generation from the auto-saved note.** Each meaningful debounced save (and each section-chip change) is a `DraftNoteUpdated` command → a debounced background worker speculatively (re)generates a draft keyed by a **content hash of `{note, patient_context_version, selected_sections}`**. Last-write-wins: a newer hash cancels/supersedes the in-flight run. By the time the doctor clicks **Generate**, a fresh `draft_ready` usually exists → instant review-first open.
3. **Streaming end-to-end.** The worker emits `GenerationStarted · ToolInvoked · DraftDelta · GenerationCompleted · GenerationFailed`. The pad subscribes by `job_id` (SSE) and renders progressively (diagnosis → meds → safety). Real progress replaces the cosmetic `msgs[]` rotator.
4. **Async job + notify + review-first UX.** Click Generate → if the speculative hash matches the current note, **open review at 0 ms** with a subtle "draft — confirm" badge while a background delta streams; if stale, show "regenerating from your latest note…" inline.

### 5.2 Speculative-then-confirm generation flow

```
Doctor pad      CommandBus    GenerationWorker    Claude(stream)   DB(rx_jobs/drafts)   SSE/Pad
   │                │               │                  │                 │                │
   │ types note     │               │                  │                 │                │
   │─autosave(debounced)──▶ DraftNoteUpdated ─────────────────────────────────────────────▶ (status: Editing→Saving→Saved)
   │                │──content_hash─▶│                  │                 │                │
   │                │               │─INSERT rx_generation_jobs(queued, speculative=true, hash)─▶│
   │                │               │─pull job─────────▶│                 │                │
   │                │               │─messages.stream──▶│                 │                │
   │                │               │◀─GenerationStarted│                 │                │
   │                │               │◀─ToolInvoked(get_formulary, ...)    │                │
   │                │               │  [compute_doses → DoseEnginePort recompute, byte-exact] │
   │                │               │◀─DraftDelta ──────│                 │                │
   │                │               │─UPDATE job(streaming) + prescription_drafts ──────────▶│
   │                │               │◀─GenerationCompleted (stop_reason guarded)            │
   │                │               │─UPDATE job(draft_ready) + ops.outbox event───────────▶│
   │                │               │                  │                 │──notify(job_id)─▶│ (badge: draft ready)
   │ click GENERATE │               │                  │                 │                │
   │──RequestGeneration─▶│ hash matches current note? ──────────────────────────────────────▶│
   │                │   YES → open review at 0ms (draft — confirm)                          │
   │                │   NO  → mark superseded; enqueue fresh job; "regenerating…" inline    │
   │ review · edit  │──AdjustDose / AddMedicine ─▶ DoseEnginePort recompute (client, no AI math)
   │ SignOff (gate) │──SignOff ─▶ state-machine.transition(draft_ready → signed) ───────────▶│
   │                │               │─PrescriptionSigned ─▶ ABDM/FHIR async handlers (non-blocking)
   │ print auto-opens (single <PrintDocument> renderer)                                     │
```

**`GenerationPort` state contract** (frontend): `idle | streaming | ready | stale | error | timeout`, with an `AbortController` per request and a hard client deadline → degraded UI (retry / manual edit / single-shot). Contract-tested in `09_engineering_discipline/`.

### 5.3 OCR ingestion flow (reused from `dis/`)

```
Browser    /ingest    Storage   Queue   Orchestrator   OCR   Structuring   DB(staged)
  │ signed-url ▶│        │        │          │          │         │            │
  │ PUT file ───┼───────▶│        │          │          │         │            │
  │ POST /ingest│─INSERT ocr_extractions(uploaded)─────────────────────────────▶│
  │             │─enqueue▶│        │          │          │         │            │
  │◀ 201 {id}   │        │─run job▶│─route→preprocess→OCR→structure→policy────────▶│
  │             │        │        │          │─UPDATE status=ready_for_review───▶│
  │             │        │        │          │─publish realtime ────────────────▶│
  │◀ "ready_for_review" badge                                                    │
  │ nurse approve ─▶ /approve ─▶ promotion.ts (confidence gate) ─▶ clinical tables (CS-10/11 guards)
```

The clinical-safety invariant is identical for OCR and AI drafts: staging row is `pending_review` until a human approval command; `promotion.ts` is the **only** path into clinical tables; the pure `transition(state, event)` rejects (and never persists) invalid transitions.

---

## 6. Command-bus / symmetric-actor seam

Every mutating action — doctor edit, nurse approve, system auto-approve, future AI agent — emits the **same `Command` shape** to one bus; results are domain `Event`s; read models are CQRS projections.

```
Actors (symmetric)              Bus                     Read models / sinks
  Doctor   ─┐                ┌─ CommandBus ─┐         ┌─ rx_generation_jobs (projection)
  Nurse    ─┤  Command  ───▶ │  validate    │ ──Event─▶ prescription_drafts
  System   ─┤                │  transition()│         │  ops.audit_log (append-only)
  AI agent ─┘                └──────────────┘         └─ ops.outbox → ABDM/FHIR handlers
```

The generation flow makes the symmetry concrete: `DraftNoteUpdated` (autosave) and `RequestGeneration` (click | speculative | AI agent) are **indistinguishable commands** → worker → events → `rx_generation_jobs` + `prescription_drafts`.

**Clinical-safety invariant (CS-1/CS-7 analog):** an AI draft is `pending_review` until a human `SignOff` command — identical fail-closed gating to OCR `promotion.ts`. The pure `state-machine.ts` `transition(state, event)` is the safety spine: invalid transitions throw and are **never** persisted; even failure paths route through `transition()`.

**State machine for prescribing:**

```
note_captured ─▶ generating ─▶ streaming ─▶ draft_ready ─▶ doctor_editing ─▶ signed ─▶ printed
                     │              │            │
                     └──────────────┴────────────┴─▶ superseded  (newer content hash)
                     └──────────────┴────────────┴─▶ failed      (audited, never finalized)
```

**Going AI-first later = an additive subscriber** that emits `RequestGeneration` + `SignOff` autonomously — **no rewrite**.

---

## 7. Data + integration surfaces (map only; depth in sibling files)

### 7.1 Database — DDD bounded-context schemas

`04_database/` owns the full DDL. The target Postgres is organized as schemas, not one flat namespace:

| Schema | Tables (representative) |
|---|---|
| `catalog` | `formulary` (530 drugs, governed + Ajv-validated), `standard_prescriptions` (446 protocols, UNIQUE `(icd10,category,severity)`, `pg_trgm` GIN on `diagnosis_name`), `concepts` (ICD10/SNOMED/LOINC) |
| `clinical` | `patients`, `visits`, `vitals`, `lab_results`, `growth_records`, `vaccinations`, `dev_screenings`, `uhid_counter` |
| `prescribing` | `rx_drafts`, `prescriptions`, `safety_checks`, `rx_versions`, **`rx_generation_jobs`**, `prescription_audit` |
| `identity` | `practitioners` (doctors, + `hpr_id`), `users`, `roles`, `facility` |
| `abdm` | `care_contexts`, `consent_artefacts`, `fhir_bundles`, `abdm_outbox`, `abdm_inbox` |
| `ops` | `jobs`, `cost_ledger`, `audit_log`, `idempotency`, `outbox` |

Cross-cutting rules baked into the map: every mutable table carries `id uuid PK`, `created_at`, `updated_at`, `version int` (optimistic lock → 409 `VersionConflictError`), `correlation_id`, `facility_id`. UHID/receipt are **UNIQUE business columns, not PKs**. Composite FK `(visit_id, patient_id) REFERENCES visits(id, patient_id)` so the DB enforces the prescriptions↔visits consistency the prototype enforced only in app code. **Real RLS** via `current_setting('app.role'/'app.doctor_id'/'app.facility_id')` set from JWT at request start (the `dis/` M008 pattern; portable to RDS). **NO DELETE policy** on clinical/audit tables; append-only `ops.audit_log` with BEFORE UPDATE/DELETE triggers that raise.

### 7.2 API surface

REST for CRUD; **async jobs** for generation (`POST /generate → 202 {job_id}`); **SSE** `GET /jobs/{id}/events` for streamed deltas + completion. OpenAPI 3.1 is source-of-truth, diffed against routes in CI. Every write requires `Idempotency-Key`; every response carries `correlation_id`. (Full contract in `06_api/`.)

### 7.3 ABDM / FHIR integration

Port the strong 1680-LOC NRCeS R4 builders into a **pure `FhirCompositionPort` adapter** (`NrcesR4Adapter`) — takes data, not a DB (kills the N+1 formulary re-fetch); add DocumentReference + Composition narrative + `Bundle.signature` + a FHIR-validator CI gate. New ports: `AbdmGatewayPort` (session/auth, `on-*` callbacks, `pushHealthInformation`, consent); `CryptoBoxPort` (**Fidelius — Curve25519 Short-Weierstrass, NOT libsodium Montgomery**; plaintext behind a double-locked sandbox flag); `SignaturePort` (ES256 JWS — replaces the forgeable 6-char client-salt QR hash; `verify.html` calls a read-only server endpoint, no PHI in the QR URL, QR rendered client-side — drop `api.qrserver.com`). Sequencing: **M1 ABHA-at-registration → M2 HIP push** (OPConsultation/Prescription/DiagnosticReport/ImmunizationRecord) first; defer M3 HIU. Prereqs: HFR + HPR IDs to config/secrets (the baked-in `HOSPITAL.hfr_id=""` is a blocker). All ABDM/FHIR runs **off-edge, event-driven** (`PrescriptionSigned` → async); sign-off never blocks on it. (Depth in `07_integrations/`.)

### 7.4 Security / compliance surfaces (map only)

Secrets via `SecretsPort` (Supabase secrets POC → AWS Secrets Manager prod); `ANTHROPIC_API_KEY` / service-role key **never** in client, logs, URLs, or commit messages. Real RLS + JWT replaces the blanket-policy-over-anon-key (the single biggest DPDP/NABH/CERT-In liability). DPDP guardian consent captured at registration (timestamped, plain-language, withdrawal path) — distinct from ABDM consent artefacts. No PII to the model (typed PII-stripping boundary in `get_previous_rx`/visit-summary). Every generation is an auditable event stream (`prescription_audit`) recording command-in, each `ToolInvoked`, the **model id+version actually used**, token usage, final draft, sign-off. (Depth in `08_security/`.)

---

## 8. Portability model (Supabase → AWS by env flip)

Three containment boundaries; only one changes at port time (verified pattern from `dis/portability.md`):

| Layer | Changes at port time? | Contents |
|---|---|---|
| **Pure core** | No | `core/`, `ports/`, `http/routes`, schemas, prompts, dose-engine, state-machine |
| **Thin wiring** | Once per stack | `wiring/supabase.ts` vs `wiring/aws.ts`, selected by `DIS_STACK` |
| **Adapters** | Added/removed to match the stack | drop `SupabaseStorageAdapter`, add `S3Adapter`; `pg-cron` → `sqs`; etc. |

| Concern | POC (Supabase) | Prod (AWS) |
|---|---|---|
| Compute | Hono container on Fly.io/Render | Cloud Run / ECS Fargate (Lambda for short ingest) |
| Object storage | Supabase Storage | S3 |
| Database | Supabase Postgres | RDS Postgres 16 |
| Background jobs | `pg-cron`/pgmq Postgres queue | SQS + consumer |
| Secrets | Supabase project secrets | AWS Secrets Manager |
| Realtime notify | SSE / status-row poll | SSE / SNS→WebSocket |
| Auth | Supabase Auth (JWT) | Cognito |

A single `Dockerfile` produces the image that runs in all three. RLS policies use the generic `current_setting('app.*')` pattern so the **same policy file runs on Supabase and RDS**.

---

## 9. Build order (architecture-level; the discipline suite owns the runner)

1. **Config/secrets centralization** — `env.schema.ts` (Zod, fail-fast boot), `ModelPolicyPort`, `ConfigPort`; remove ALL hardcoded URLs/keys/models from client + functions. *Unblocks the model-retirement failure class.*
2. **Adopt the `dis/` skeleton** as the monorepo template (ports/adapters/__fakes__, fitness rules, Hono middleware, dbmate, state-machine).
3. **Port-ify dose-engine + growth-engine** as pure `core/` modules; land golden JS↔TS parity fixtures **before** trusting either.
4. **Build the CommandBus** + the speculative-draft state machine + streaming `GenerationPort` — the headline deliverable, modeled 1:1 on `ocr_extractions` staging + `transition()` + realtime.
5. **DB migration** — baseline (`sprint-2-saved` pg_dump) → ETL-clean (mojibake, dedupe ICD-10, verified vs placeholder, map codes to `concepts`) → backfill `legacy` → uuid+UHID-business-key → dedupe abort-on-duplicate → reconcile `prescriptions.patient_id` drift → cutover (FKs/constraints mandatory). Add `rx_generation_jobs`, `prescription_audit`, `rx_versions`, `pg_trgm`, server-side counters, per-role RLS, append-only audit.
6. **Frontend rebuild** — one print renderer, componentized pad, sprint-2 safety UX, design tokens, a11y.
7. **ABDM/FHIR off-edge** — pure `NrcesR4Adapter`, `AbdmGatewayPort` + auth, `CryptoBoxPort` (Fidelius), `SignaturePort` QR.
8. **Shadow rollout** — run speculative generation in shadow, diff against legacy Edge output; feature-flag ladder (`ENABLED → SHADOW → OPT_IN_OPERATORS → *`) + kill-switch before cutover.

> **Discipline boundary.** This file defines *what* the architecture is and *what* is gated (dose-engine golden parity, generation eval over a frozen pediatric fixture set, FHIR snapshot validation, `GenerationPort` state-contract tests, no-PII-leakage). The TDD/eval operating model, review gates, and CI runner are owned by `09_engineering_discipline/` — not duplicated here.

---

## 10. Key source references (branch-qualified)

- **Foundation** (`origin/feat/dis-plan`): `dis/src/ports/{database,storage,queue,secrets,structuring,ocr,...}.ts`; `dis/src/core/{orchestrator,state-machine,promotion,confidence-policy,env.schema,idempotency-store,error-envelope,audit-log,...}.ts`; `dis/src/http/{server,router,middleware/*,realtime/status-channel,routes/*}.ts`; `dis/src/wiring/{supabase,aws}.ts`; `dis/scripts/fitness-rules.json`; `dis/migrations/M001–M008` (+ `.rollback.sql`); ADR-005 (Hono), ADR-006 (postgres driver), ADR-007 (Haiku default / Sonnet escalation); `dis/.../portability.md`, `sequence_diagrams.md`, `tdd.md`.
- **Clinical brain** (`origin/sprint-2-saved`): `supabase/functions/_shared/dose-engine.ts` (745-line pure port); `supabase/functions/generate-prescription/index.ts` (`compute_doses`, three-tier severity); `radhakishan_system/skill/core_prompt.md`; migrations `20260428000000_baseline_from_live.sql`, `20260428001000_prescription_audit.sql`, `20260428002000_pg_trgm.sql`, `20260502000000_stdrx_trgm_index.sql`; `docs/13-ai-architecture-research.md`, `15-decisions-2026-04-28.md`, `16-implementation-plan.md`.
- **Prototype** (port-from, then retire) — `web/prescription-pad.html` (generate region; dose-engine integration; `printRx`; autosave; voice), `web/dose-engine.js` (port verbatim), `web/prescription-output.html` (duplicate renderer — collapse to one), `web/registration.html` (`COMMON_LABS`, `IAP_SCHEDULE`), `supabase/functions/generate-prescription/index.ts` (the 150 s flaw: tool loop ~500–613, `AbortController` 120 s line 501, hardcoded model line 518), `console-log.md` (`546` evidence).
- **Index recs / IO** — `origin/fix/io-indexes:radhakishan_system/scripts/migration_io_indexes.sql`.
