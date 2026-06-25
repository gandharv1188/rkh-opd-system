# North Star — Radhakishan Pediatric OPD Prescription System (Rebuild)

> **Status:** Target-state specification. Build to THIS, not to the current `web/` + Supabase-Edge-Function prototype.
> **Scope:** The complete system — frontend, backend services, database, AI generation, integrations, security, deployment.
> **Authority:** This document is the apex of the `system-spec/` tree. Where it disagrees with any study report or the live prototype, this document wins. Where it disagrees with a *verified API fact*, the file author flags it for resolution rather than silently complying.
> **Foundation (real, on-branch):** the hexagonal TypeScript skeleton at `origin/feat/dis-plan:dis/` (Hono, `postgres` driver, dbmate, 8 ports + `__fakes__`, Zod env, fitness-rules CI) and the clinical brain at `origin/sprint-2-saved` (`supabase/functions/_shared/dose-engine.ts`, the `compute_doses` tool, three-tier severity, `prescription_audit`, 37 doctor-ratified decisions). We **extend** these; we do not start from a blank page.
> **Out of scope here:** the TDD/eval operating model, review gates, drift prevention, and OpenAPI-as-truth runner — those live in `09_engineering_discipline/`. This document defines *what* must be true; that suite defines *how it is enforced*.

---

## 1. Vision (load-bearing, one paragraph)

A pediatric OPD prescription system where **the doctor's perceived wait to a reviewable prescription is approximately zero**, the **deterministic dose engine is the sole arithmetic authority** (the AI selects drugs and regimens and narrates the clinical reasoning, but never computes a number that reaches paper), and **humans and AI are symmetric actors** on one command/event bus — so an autonomous "AI-drafts-then-doctor-signs" mode becomes an *additive subscriber*, not a rewrite. Everything else — bilingual + pictogram print, ABDM/FHIR R4, NABH auditability, DPDP child-data compliance — hangs off a hexagonal, port/adapter, config-driven core that is portable from Supabase to AWS by an environment flip. The system is **test-driven and eval-gated**: clinical safety is enforced as *code* — a pure state machine plus a hard staging/clinical separation — not as prompt text that a model might ignore.

This vision rests on one diagnosis of the current prototype and one bet on the fix.

**The diagnosis.** Prescription generation runs *synchronously inside a Supabase Edge Function* with a hard 150-second wall-clock. Generation legitimately takes 50–150 s (multi-round Claude tool-use loop). The result is the production failure captured in `console-log.md:15–16` — `generate-prescription` returning **HTTP 546 at exactly 150,000 ms** — and doctors watching a spinner for up to five minutes. The edge function papered over this with timeout budgets, completeness-retry budgets, and same-model fallbacks (`generate-prescription/index.ts` lines ~689–694, 1014–1187). Those workarounds exist *only* to survive the edge wall; they are deleted in the rebuild.

**The bet.** Move generation **off-edge** to a long-running worker, and **start generating speculatively from the doctor's auto-saved note during the consult** so that by the time the doctor clicks **Generate**, a fresh draft usually already exists. Stream everything. The draft is always doctor-reviewed and signed — speculation changes *when* the compute happens, never *whether* a human approves.

---

## 2. Why this exists (the problem we are killing)

The current prototype (`web/` = 8 self-contained HTML files, ~21k lines of duplicated inline JS/CSS; `supabase/functions/`; `radhakishan_system/`) does many right things and is a viable proof of concept. As a production clinical system it has eleven structural flaws, each of which this rebuild closes by construction:

| # | Flaw in prototype | Consequence | Where it is fixed |
|---|---|---|---|
| 1 | Generation runs in a 150s-capped Edge Function | 504/546 timeouts; doctor waits ≤5 min | §5 off-edge worker + §6 speculative generation |
| 2 | AI is asked to do dose arithmetic (or copy it loosely) | A wrong number can reach paper | §7 sealed `DoseEnginePort`, byte-for-byte server recheck |
| 3 | Hardcoded dated model id (`claude-sonnet-4-6`) in business code | A model retirement broke prod | §8 `ModelPolicyPort` + `core_no_model_id_literals` CI rule |
| 4 | Client-side `MAX(seq)+1` UHID allocation | ID-collision race under concurrency | §9 server-side `SECURITY DEFINER` counter |
| 5 | Blanket `authenticated_full_access` over an anon key | DPDP/NABH/CERT-In liability; anon key reaches clinical data | §9 real per-role RLS + JWT; §10 |
| 6 | No append-only audit; signed Rx mutable | No tamper-evidence, no NABH traceability | §9 append-only `ops.audit_log` + `rx_versions` |
| 7 | App-only consistency between prescriptions and visits | Orphaned/mismatched Rx possible | §9 composite FK `(visit_id, patient_id)` |
| 8 | Two divergent print renderers (`printRx`/`renderRx`) | Print drift between pad and station | §4 single canonical `<PrintDocument>` |
| 9 | Raw `fetch` + anon key inside every HTML page | No anti-corruption seam; vendor lock-in | §4 client ports; §11 |
| 10 | Forgeable 6-char client-salt QR hash | Prescription tamper / forgery | §12 `SignaturePort` ES256 JWS |
| 11 | Destructive `drop table … cascade` migration DDL | Data-loss risk on deploy | §9 forward-only dbmate, `.rollback.sql`, abort-on-duplicate |

The mojibake in the formulary/protocol JSON (`â€"` em-dash corruption), duplicate ICD-10 protocols, the 3× duplicate `raw_dictation` write, and the cosmetic spinner that lies about progress are all symptoms of the same root cause: **business logic, vendor calls, and presentation are entangled with no ports between them.** The rebuild's organizing principle is to separate them.

---

## 3. Goals and non-goals

### 3.1 Goals (in priority order)

1. **Perceived-zero wait** to a reviewable prescription draft, with **no infinite spinner** — ever — under any failure mode.
2. **Deterministic clinical arithmetic.** Every dose, volume, drop count, and cap on the printed Rx is computed by the pure dose engine and re-verified server-side; the AI contributes *no numbers*.
3. **Doctor always in the loop.** No prescription is finalized without an explicit human `SignOff` command. This is a clinical-safety invariant, not a UX preference.
4. **Portability by config.** Supabase today, AWS tomorrow, by flipping `DIS_STACK` — zero business-logic changes, adapter-layer only.
5. **Auditability and compliance.** Every generation is a replayable event stream; NABH Digital Health 2nd-ed + DPDP Act 2023 (with 2025 Rules) child-data obligations are met by design.
6. **Symmetric human/AI actors.** A future autonomous mode is an additive bus subscriber, not a rewrite.
7. **Single source of truth per concern.** One print renderer, one dose engine, one growth engine, one config/secrets path, one schema (in migrations).

### 3.2 Non-goals (explicitly out of scope for this rebuild)

- **Not** a general hospital information system / IPD / billing / pharmacy inventory. OPD pediatric prescribing only.
- **Not** an autonomous prescriber. The AI drafts; a licensed doctor signs. (The architecture *permits* AI-first later, but enabling it is a separate, gated decision.)
- **Not** keeping Supabase Edge Functions as the tool-loop host. If retained at all, they are thin `validate → enqueue → 202` webhook receivers and SSE relays.
- **Not** an ORM. Schema lives only in migrations (dbmate); access via parameterized `postgres` `sql` (ADR-006).
- **Not** ABDM M3 (HIU consumption) in the first cut — M1 (ABHA at registration) then M2 (HIP push) ship first; M3 is deferred.
- **Not** a re-litigation of the discipline/eval framework — see `09_engineering_discipline/`.

---

## 4. Architecture at a glance

The system is one repository of **bounded-context hexagons**, each `core/ports/adapters/__fakes__`, all mutations flowing through a single **CommandBus → EventBus**. Long-running compute lives off-edge in workers pulling from a durable queue. The browser holds no secrets and touches no vendor directly.

```
                         ┌──────────────────────── BROWSER (Vite + TS SPA) ────────────────────────┐
                         │  Components (container/presentational) over CLIENT PORTS:                 │
                         │  DataAccessPort · GenerationPort · TranscriptionPort · ConfigPort         │
                         │  PrintPort · RealtimePort · CommandBus/EventBus                           │
                         │  No raw fetch. No anon key in components. No model id anywhere.            │
                         └───────────────┬───────────────────────────────────┬──────────────────────┘
                                         │ REST (CRUD, Idempotency-Key)       │ SSE  GET /jobs/{id}/events
                                         ▼                                    ▲
        ┌──────────────────────── API GATEWAY (Hono, off-edge: Cloud Run / Fly.io) ─────────────────────┐
        │ correlation-id · idempotency · error-envelope · kill-switch(503) · rate-limit · JWT→app.role  │
        │                         COMMANDBUS  ──emits──►  EVENTBUS  ──►  OUTBOX                          │
        └───┬──────────┬───────────┬────────────┬────────────┬───────────┬───────────┬──────────┬───────┘
            │          │           │            │            │           │           │          │
            ▼          ▼           ▼            ▼            ▼           ▼           ▼          ▼
      Registration  Clinical   Document     GENERATION     Job        ABDM       Dose-      Print/
      & Patient     Capture    Ingestion    WORKER         Queue &    Service    Engine     Output
      (visits,UHID) (vitals,   (dis/ as-is: (off-edge      Realtime   (anti-     Service    (one A4
                    growth,    OCR→staged   tool-loop,     (PG queue  corruption (sealed    renderer,
                    labs,vax)  ocr_extract) streams events)→SQS prod) /FHIR/JWS) pure)      QR verify)
            │          │           │            │            │           │           │          │
            └──────────┴───────────┴────────────┴────────────┴───────────┴───────────┴──────────┘
                                         │  postgres driver (sql / sql.unsafe), no ORM
                                         ▼
   ┌─────────────────────────── POSTGRES (Supabase today → RDS tomorrow) ───────────────────────────┐
   │ DDD schemas: catalog · clinical · prescribing · identity · abdm · ops                           │
   │ Per-role RLS via current_setting('app.role'/'app.doctor_id'/'app.facility_id') · append-only    │
   │ audit · server-side ID counters · composite FKs · dbmate forward + .rollback.sql                │
   └─────────────────────────────────────────────────────────────────────────────────────────────────┘
            ▲                              ▲                                    ▲
   Supabase Auth (real JWT)      Supabase Storage / S3 (skill .md, docs)   SecretsPort (Supabase→AWS SM)
```

### 4.1 The three structural rules (enforced in CI, not by convention)

1. **The hexagon.** `core/` is pure TypeScript — **no `fetch`, no `fs`, no SQL literals, no adapter imports**. `ports/` are interfaces only. `adapters/` are the vendor edge, each with a `__fakes__/` peer. `wiring/` is the only composition root that picks adapters by env. (Copy `dis/`'s layout wholesale.)
2. **The bus.** Every mutating action — doctor edit, nurse approval, system auto-approval, *future AI agent* — emits the **same `Command` shape** to one bus; results are domain `Event`s; reads are CQRS projections. This is the single most important net-new construct. `dis/` has the state-machine and event pieces; the general bus is built fresh.
3. **The fitness functions.** CI merge-blockers extend `dis/scripts/fitness-rules.json` across all contexts: `core_no_adapter_imports`, `ports_no_adapter_imports`, `core_no_fetch`, `core_no_xhr`, `core_no_sql_literals`, `supabase_sdk_only_in_supabase_adapters`, `aws_sdk_only_in_aws_adapters`, **plus the new `core_no_model_id_literals`** (no `claude-*` string in business code — flaw #3 can never recur).

```
src/
  core/       pure TS — no fetch, no fs, no SQL, no adapter imports (CI-enforced)
  ports/      interfaces only (the narrow waist) — no adapter imports
  adapters/   vendor edge; each has a __fakes__/ peer
  http/       Hono router + middleware + SSE relay (thin)
  wiring/     the ONLY composition root that picks adapters by env
  workers/    off-edge long-running compute (generation, FHIR, ABDM)
```

---

## 5. Off-edge compute (the foundational decision)

**Runtime:** Node 20 + Hono (one Dockerfile, runs anywhere — Node/Deno/Bun/Lambda). **NOT Supabase Edge Functions for any long-running compute** — the 150 s wall-clock is the root flaw, and no amount of budget-juggling survives a 50–150 s generation.

| Concern | Decision |
|---|---|
| Language | TypeScript, strict |
| HTTP | Hono (ADR-005) |
| DB driver | `postgres` (porsager) — parameterized `sql`/`sql.unsafe`; **no ORM** (ADR-006). Schema only in migrations. |
| Migrations | dbmate; forward + `.rollback.sql`; CI verifies up→down→up + `pg_dump` schema-diff |
| Validation | Zod (env + DTOs) + Ajv (JSON-schema for clinical/formulary payloads) |
| Logging | pino + correlation IDs + PII redactor |
| Tests | vitest; fakes-only core suites (<1 s) |
| Queue (POC) | Postgres queue (pgmq / `pg-cron` adapter) — the `dis/` `M004_dis_jobs` pattern: topic/payload/status/attempts/`locked_until`/`locked_by` + partial index on ready jobs |
| Queue (prod) | SQS, by `DIS_STACK=aws` flip |

**Compute platform — ranked, decisive:**

- **POC:** the Hono container on **Fly.io / Render** (long-lived process that can hold SSE connections), worker pulling from the Postgres queue.
- **Prod / headroom:** **Google Cloud Run** is the boring default — 60-min request timeout, scale-to-zero, clean SSE. Queue → **SQS** by the `DIS_STACK` flip. Reserve Fly persistent workers only when always-warm SSE holders are genuinely required.
- **Supabase remains:** Postgres, Auth (real JWT), Storage buckets. Edge Functions, *if kept at all*, are thin signed-webhook receivers (`validate → enqueue → 202`) and SSE relays — never the tool-loop host.

---

## 6. The latency design (the headline — four compounding mechanisms)

**Target: perceived wait ≈ 0, never an infinite spinner, and the draft is ALWAYS doctor-reviewed and signed** (never auto-finalized — clinical-safety invariant).

1. **Off-edge persistent worker.** The Claude tool-use loop runs on the Hono/Cloud-Run worker pulling from the durable queue — not in a 150 s-capped function. This single change kills the 504/546-at-150,000 ms. Every timeout/budget/completeness-retry/fallback workaround from `sprint-2-saved` is deleted; they existed only to survive the edge wall.

2. **Speculative / background generation from the auto-saved note.** The doctor's note already auto-saves (debounced) to `visits.raw_dictation`. Each meaningful save — and each section-chip change — becomes a `DraftNoteUpdated` command on the bus → a debounced background worker speculatively (re)generates a draft keyed by a **content hash of `{note, patient_context_version, selected_sections}`**. Last-write-wins: a newer hash cancels/supersedes the in-flight speculative run. By the time the doctor clicks **Generate**, a fresh `draft_ready` usually already exists → review opens instantly.

3. **Streaming end-to-end.** The worker uses `client.messages.stream(...)` (SDK `.get_final_message()` for timeout-protected completion) and emits domain events — `GenerationStarted`, `ToolInvoked`, `DraftDelta`, `GenerationCompleted`, `GenerationFailed` — on a per-job channel. The pad subscribes by `job_id` (SSE — the Realtime WebSocket was removed for IO cost; SSE or a short-interval status-row poll is the notify channel) and renders progressively: diagnosis → meds appear → safety panel. Real progress replaces the cosmetic message rotator.

4. **Async job + notify + review-first UX.** Click **Generate** → if the speculative hash matches the current note, **open review at 0 ms** with a subtle "draft — confirm" badge while a background delta streams; if stale, show "regenerating from your latest note…" inline. The `GenerationPort` exposes states `idle | streaming | ready | stale | error | timeout`, an `AbortController` on every request, exponential-backoff retry, and a **hard client deadline → degraded UI (retry / manual edit / single-shot), never an infinite spinner.**

**Prompt caching (independent, and the biggest cost + time-to-first-token win).** Render order `tools → system → messages`. Freeze tool defs (deterministic order) + the skill `core_prompt.md` + a pre-embedded NABH block; place `cache_control:{type:"ephemeral"}` on the last system block. All volatile content (note, allergies, `patient_id`, tool results) goes **after** the breakpoint. **No timestamps or UUIDs in the prefix.** Pre-warm with `max_tokens:0` on worker boot. Opus 4.8's minimum cacheable prefix is **4096 tokens** — the skill prompt clears it. Audit `usage.cache_read_input_tokens` is non-zero.

```
 t0  doctor dictates  ──► autosave ──► DraftNoteUpdated(hash A) ──► speculative run A starts
 t1  doctor edits     ──► autosave ──► DraftNoteUpdated(hash B) ──► run A superseded, run B starts
 t2  run B streams: GenerationStarted → ToolInvoked × n → DraftDelta… → GenerationCompleted
 t3  doctor clicks GENERATE ──► hash matches B ──► REVIEW OPENS AT 0 ms (draft already ready)
 t4  doctor reviews, adjusts a dose (DoseEngine recompute) ──► SignOff ──► print
```

---

## 7. The clinical-safety spine (dose engine + state machine + staging)

Two non-negotiable boundaries make this a clinical-grade system rather than a chatbot with a print button.

### 7.1 The dose engine is the sole arithmetic authority

`web/dose-engine.js` is correct and is the source of truth; **the AI's role is drug/regimen selection and narration, never arithmetic** (this is a project memory: dosing errors come from AI mental math, not the engine). The 745-line pure TS port already exists at `origin/sprint-2-saved:supabase/functions/_shared/dose-engine.ts` with verified signatures:

- `computeDose(params: ComputeDoseParams): ComputeDoseResult` — six dosing methods (`weight | bsa | fixed | gfr | infusion | age`), per-ingredient `maxSingleDoseMg`/`maxDailyDoseMg` caps, bilingual `enD`/`hiD` output, `capped`/`warnings` flags.
- `parseIngredients`, `makeIngredient`, `calculateBSA`, `roundToUnit`, `isSolidForm`, `formatDoseDisplay`, `buildCalcString`.
- Bilingual constant maps `HINDI_DROPS/ML/TABLETS/UNITS`, `FREQ_EN/FREQ_HI`, `DROPS_PER_ML = 20`.

**The contract:** the AI proposes a medicine + regimen with **no numeric fields**. The engine recomputes mg/ml/drops from concentration + dosing band + weight/BSA, rebuilds the R2/R3 bilingual strings and the pictogram, applies per-ingredient max-single and max-daily caps plus therapeutic-range checks, and the **server re-checks byte-for-byte** (no tolerance — a 20% client override is rejected). Any mismatch flags `REVIEW REQUIRED`. Rounding rules are fixed: syrups → 0.5 ml, drops → 0.1 ml, tablets → ¼ tab. Preterm corrected/chronological age is pre-computed on the **client** (AI does no arithmetic there either).

**TDD gate (mandatory before the engine is trusted):** golden **JS ↔ TS parity fixtures** — ≥20 cases covering rounding (syrups/drops/tablets), caps, and bilingual strings. `sprint-2-saved` ships the TS port *without* fixtures; closing that gap is a precondition to wiring the engine into generation.

### 7.2 The state machine is the safety spine

A pure `transition(state, event)` function (the `dis/` `state-machine.ts` pattern) governs the prescription lifecycle. **Invalid transitions throw and are never persisted; even failure paths route through `transition()`.** Exhaustiveness is compiler-enforced (`assertNever`).

```
note_captured → generating → streaming → draft_ready → doctor_editing → signed → printed
                                                  └────────► superseded
                          (any stage) ───────────────────► failed
```

**Clinical-safety invariant (CS-mirror):** a draft — speculative, doctor-clicked, or AI-agent-originated — is `pending_review` until a human `SignOff` command. This is identical fail-closed gating to the OCR `promotion.ts` boundary in `dis/`: no OCR-derived row reaches a clinical table without verification or a documented auto-approval gate. The prescribing context inherits that discipline exactly.

### 7.3 Staging / clinical separation

Document ingestion is adopted from `dis/` **as-is**: OCR → **staged** `ocr_extractions`, never a direct write to clinical tables; promotion happens only through the single `promotion.ts` command behind a confidence gate. The principle generalizes: AI-derived data is *staged and provenance-tagged* until a human (or a documented gate) promotes it.

---

## 8. AI orchestration (centralized, anti-corruption, eval-gated)

The `Generation` bounded context wraps the model vendor behind one `ModelPolicyPort` (a config object — **no dated model string in business code**, enforced by `core_no_model_id_literals`). Current verified ids/pricing (claude-api skill, 2026-06): `claude-opus-4-8` ($5/$25 per MTok, 1M ctx, 128K out), `claude-sonnet-4-6` ($3/$15), `claude-haiku-4-5` ($1/$5).

| Task | Model | Effort / Thinking | Rationale |
|---|---|---|---|
| Prescription generation | `claude-opus-4-8` | `output_config.effort:"high"`, `thinking:{type:"adaptive"}` | Correctness-sensitive; speculative async absorbs latency, so the old Sonnet + `effort:low` speed hack is unnecessary. Opus 4.8 under-reaches for tools by default → prescriptive "Call this when…" trigger text + a search-first nudge. `max_tokens` ~16000+ → **MUST stream.** |
| Visit summary | `claude-haiku-4-5` (or sonnet-4-6) | `effort:"low"` | Bounded ~250-word summary. |
| OCR structuring | `claude-haiku-4-5` default → escalate `claude-sonnet-4-6` on low-confidence/schema-invalid | per `dis/` ADR-007 | Reuse the pattern. |
| Drug / protocol lookup | `claude-haiku-4-5` | `effort:"low"` | Format/lookup only. |

**Verified API facts (do not regress).** Opus 4.8 accepts `thinking:{type:"adaptive"}` only — `budget_tokens`, `temperature`, `top_p`, `top_k` all return 400. `effort` lives inside `output_config`. No assistant prefill (use structured outputs). The SDK refuses non-streaming above ~16K `max_tokens`. *(If a file author finds these contradicted by a live API check, flag rather than comply.)*

**Tool-use / progressive disclosure.** Keep the 5-tool design, executed in parallel via `Promise.all`, behind a `ClinicalKnowledgePort`: `get_formulary` (with `condenseDrugForAI()` token-stripping), `get_standard_rx` (ICD-10-first), `get_previous_rx` (PII-stripped at a *typed boundary*, not an ad-hoc `.map`), `get_lab_history` — DatabasePort-backed; `get_reference` — StoragePort-backed. Each gets a `__fake__`. Pre-embed NABH (saves a round). Add the `compute_doses` tool from `sprint-2-saved` (the LLM batches all drugs, passes full `dosing_bands`, copies engine output verbatim). Prefer `strict:true` tools + structured outputs (`output_config.format` against the `core_prompt.md` JSON schema) to retire the brittle `extractJSON` regex.

**Streaming + fallbacks (production-grade).** Worker `client.messages.stream` → domain events. Fallback = **model-tier downgrade** Opus 4.8 → Sonnet 4.6 on overload/5xx/timeout via `ModelPolicyPort`, with a `stop_reason:"refusal"` guard before reading `content[0]`, backoff + jitter on 429/5xx. For same-model provider failover, a Bedrock/Vertex secondary path is safest. **Never silently downgrade the clinical model class without flagging it on the audit record.** Keep loop-cap and repeated-tool-call guards, but promote them to typed, audited events.

**Auditability.** Every generation attempt (incl. retries/fallback) writes one `prescription_audit` row: `meta_mode`, `stop_reason`, tokens, rounds, `tools_called[]`, requested/emitted/omitted/added counts, `severity_*`, `warnings[]`, `duration_ms`, **and the model id+version actually used**. This is the NABH/clinical-safety traceability record — it replaces heuristic `console.log`.

---

## 9. Database (target schema + migration of live data, in brief)

DDD bounded-context Postgres schemas — **`catalog`** (formulary, standard_prescriptions, terminology concepts), **`clinical`** (patients, visits, vitals, lab_results, growth_records, vaccinations, dev_screenings), **`prescribing`** (rx_drafts, prescriptions, safety_checks, rx_versions, rx_generation_jobs), **`identity`** (practitioners, users, roles, facility), **`abdm`** (care_contexts, consent_artefacts, fhir_bundles, outbox, inbox), **`ops`** (jobs, cost_ledger, audit_log, idempotency, outbox).

Every mutable table carries `id uuid PK` (surrogate), `created_at`, `updated_at`, `version int` (optimistic lock → 409 `VersionConflictError`), `correlation_id`, `facility_id` (multi-site + RLS scope). UHID/receipt are **UNIQUE business columns, not PKs**. The decisive fixes:

- **Server-side ID allocation** — `clinical.uhid_counter(fy_code, month, last_seq)` via `UPDATE … RETURNING` under row lock behind a `SECURITY DEFINER` function (kills flaw #4); same for receipt/token.
- **Real RLS + JWT** — portable `current_setting('app.role' / 'app.doctor_id' / 'app.facility_id')` set at request start (the `dis/` `M008` pattern that runs on Supabase *and* RDS). Roles: `reception`, `nurse`, `doctor`, `service`, `admin`. **No DELETE policy** on clinical/audit tables; anon key never touches clinical schemas.
- **Append-only audit** — `ops.audit_log` with BEFORE UPDATE/DELETE triggers that raise (the `dis/` `M002` pattern); signed Rx immutable, edits → new `prescribing.rx_versions` rows, content hash for tamper-evidence.
- **Async generation state** — `prescribing.rx_generation_jobs` (`status queued|generating|streaming|draft_ready|superseded|failed`, idempotency_key UNIQUE, correlation_id, speculative bool, content_hash, tokens, micro-INR cost int, latency_ms) + `ops.outbox` + the ported `prescription_audit`.
- **Composite FK** `(visit_id, patient_id) REFERENCES visits(id, patient_id)` (flaw #7).
- **Terminology integrity** — `catalog.concepts(system ∈ ICD10/SNOMED/LOINC, code, display)` with FKs; `standard_prescriptions` UNIQUE `(icd10, category, severity)`; codes validated on write; `pg_trgm` GIN for fuzzy diagnosis→protocol matching.
- **Formulary as a governed KB** — keep JSONB for genuinely polymorphic `dosing_bands`/`formulations`, add the validated columns/CHECKs the dose engine relies on + an Ajv `formulary.v1.json` enforced in CI and at write time, with verified-vs-placeholder provenance.

**Migration of live data is forward-only, reversible, abort-on-duplicate** — baseline = `sprint-2-saved`'s `20260428000000_baseline_from_live.sql`: stand up target schemas empty → ETL-clean the formulary/std-Rx JSON (fix `â€"` mojibake, dedupe ICD-10, split verified/placeholder, map free-text codes to `concepts`) → backfill clinical with `verification_status='legacy'` → generate uuid surrogates retaining UHID as business key → dry-run dedupe → reconcile `prescriptions.patient_id` drift against `visits` *before* adding the composite FK → cutover migration making constraints mandatory only after rollout. The full schema, DDL, and migration sequence live in the `05_data/` chapter; this section fixes the invariants, not the column list.

---

## 10. Measurable success criteria

These are the acceptance bars. Each is machine-checkable; the runner that enforces them is owned by `09_engineering_discipline/`.

### 10.1 Doctor perceived-wait ≈ 0

| Metric | Target | How measured |
|---|---|---|
| **p50 perceived wait** (Generate-click → reviewable draft visible) | **< 1 s** | client timer, click → first review render; hot path = speculative hash hit |
| **p95 perceived wait** | **< 3 s** | same; covers stale-hash regeneration with streamed first delta |
| **Speculative hit rate** (draft already `draft_ready` at click) | **≥ 80%** | `rx_generation_jobs.speculative` + content_hash match at click time |
| **Time-to-first-streamed-delta** (cold, stale-hash path) | **< 2.5 s** | first `DraftDelta` event after `RequestGeneration` |
| **Infinite spinners** | **0** | every `GenerationPort` flow hits a terminal state ≤ hard client deadline → degraded UI |
| **Prompt-cache read hit** on generation calls | **> 0 tokens, ≥ 90% of calls** | `usage.cache_read_input_tokens` audited per call |

### 10.2 Reliability

| Metric | Target |
|---|---|
| Generation worker availability (job reaches a terminal state) | **≥ 99.5%** monthly |
| HTTP 5xx/504/546 on the generation path | **0** at the 150,000 ms wall (the failure mode is structurally removed) |
| Job at-least-once delivery; no lost generation request | **100%** (durable queue + outbox + idempotency key) |
| Duplicate side-effects from retries (e.g., 3× `raw_dictation`) | **0** (CommandBus dedup + `Idempotency-Key`) |
| Migration safety: every forward migration reverses cleanly | up→down→up + schema-diff green in CI |
| Recovery from worker crash mid-generation | job re-leased and re-run within `locked_until`; no orphaned `generating` rows |

### 10.3 Clinical safety

| Metric | Target |
|---|---|
| AI-computed numbers reaching paper | **0** — engine is sole arithmetic authority; server re-checks byte-for-byte |
| Dose-engine JS↔TS parity (golden fixtures, ≥20 cases) | **100% pass**, a precondition to trusting the engine |
| Prescriptions finalized without a human `SignOff` | **0** (state-machine invariant; invalid transitions throw) |
| Severity-gated sign-off bypass (high→edit→save) | **0** — gate re-applied after every edit |
| Allergy / interaction / max-dose violations on signed Rx | **0** flagged-and-ignored without explicit doctor acknowledgement |
| Generation eval over the frozen pediatric fixture set | dosing within rounding rules · NABH fields present · no PII leakage · JSON-schema conformant · safety invariants hold |
| OCR-derived rows in clinical tables without verification/gate | **0** (staging boundary) |

### 10.4 Compliance & security

| Metric | Target |
|---|---|
| PII/PHI sent to the model | **0** — typed PII-stripping boundary on `get_previous_rx`/visit-summary |
| Anon key reaching clinical schemas | **0** — per-role RLS, anon scoped out |
| Secrets in client/logs/URLs/commits | **0** — `SecretsPort`, PII redactor, secret-scan in CI |
| Guardian consent captured at registration (every child <18) | **100%** of registrations (timestamped, plain-language, withdrawal path) |
| Generation events fully replayable for audit | **100%** (`prescription_audit` + event stream + model id/version) |
| QR tamper-evidence | ES256 JWS verified server-side; no PHI in QR URL; client-rendered QR |

---

## 11. Guiding principles

These are the decision rules. When a design choice is ambiguous, apply them in order.

1. **Separation of concerns, enforced by ports.** Business logic, vendor calls, and presentation are never entangled. `core/` is pure; vendors live behind ports with fakes. If you cannot test it with a fake in <1 s, the seam is in the wrong place.
2. **Dependency inversion + anti-corruption layers.** The core depends on interfaces, never on Supabase, Anthropic, ABDM, or the DOM. Every vendor (model, ABDM gateway, OCR, crypto, storage) is wrapped — so a model retirement, a cloud migration, or an ABDM API change is an adapter swap, not a rewrite. (Flaw #3 is the cautionary tale: one hardcoded dated model id broke production.)
3. **Open/closed via the command bus.** Humans and AI are *symmetric actors*. New behavior — speculative drafting today, autonomous AI-first tomorrow — is an additive subscriber that emits the same commands and consumes the same events. Never a rewrite.
4. **Determinism for anything that can be deterministic.** Arithmetic (dosing), z-scores (growth), ID allocation, age computation, and rounding are deterministic engines — not AI, not client guesses. The AI is reserved for genuinely generative judgment (drug/regimen selection, narration), and even then a human signs.
5. **Fail closed, always.** Invalid state transitions throw and are never persisted. Unverified AI/OCR data stays staged. Missing weight blocks dose computation. A model refusal or timeout degrades to retry/manual/single-shot — never to a wrong answer and never to an infinite spinner.
6. **Centralized configuration and secrets.** One `env.schema.ts` (Zod, fail-fast on boot), one `ConfigPort`, one `ModelPolicyPort`, one `SecretsPort`. No URL, key, or model id is hardcoded anywhere — client or server.
7. **Boring technology over clever.** Postgres queue before Kafka; SSE before bespoke WebSocket; `postgres` driver before an ORM; Cloud Run before a custom orchestrator. Choose the well-supported option a small team can operate.
8. **Auditability as a first-class output.** Every command is an event; every generation is a replayable stream recording inputs, each tool call, the model used, token usage, and sign-off. This satisfies NABH and clinical-safety traceability and is *the* debugging primitive — not `console.log`.
9. **Single source of truth per concern.** One print renderer, one dose engine, one growth engine, one schema (in migrations), one composition root. Duplicates (the two print renderers, the 3× write) are bugs by definition.
10. **Test-driven and eval-driven, gated by machines.** A failing test precedes implementation; golden fixtures gate the dose engine; a frozen pediatric eval set gates generation; fitness functions block merges that violate the hexagon. The discipline framework owns the *how* (`09_engineering_discipline/`); this document owns the *what is gated*.
11. **Privacy and child-data dignity by design.** Every patient is effectively a child under DPDP. No PII to the model, guardian consent captured at the door, the healthcare exemption respected as scope-limited to care delivery (no secondary/analytics/marketing use), and the dual breach clocks (CERT-In 6 h, DPB 72 h) wired into the runbook.
12. **Accessibility and comprehension are clinical safety.** WCAG 2.2 AA, Lighthouse ≥ 90, no colour-only status (rubber-stamp risk), and every pictogram paired with Hindi + English text (never icon-only — false-confidence risk). For a low-literacy patient population, a misread instruction is a clinical error.

---

## 12. What "done" looks like (the end-to-end story)

- A reception clerk registers BHAWNA (9 months, 6.07 kg) — the server allocates `RKH-26270500017` atomically (no client race), guardian consent is captured, and any uploaded discharge summary lands in `ocr_extractions` as `pending_review`, never directly in clinical tables.
- The nurse records weight, height, HC, temp, HR, SpO₂; growth z-scores are computed by the deterministic growth engine.
- The doctor opens the pad and dictates: "viral fever, syrup Combiflam 2.5 ml 8-hourly × 5 days…". Each autosave fires `DraftNoteUpdated`; a speculative generation runs in the background on the off-edge worker, streaming events. The note is edited once; the in-flight run is superseded by a fresh hash.
- The doctor clicks **Generate.** The speculative hash matches → **review opens at 0 ms** with a "draft — confirm" badge. The 4-row bilingual medicine blocks render (R1 GENERIC CAPS (conc) blue / R2 English / R3 Devanagari / R4 inline-SVG pictogram sunrise-sun-sunset-moon + dose-qty + food/duration), investigations in red, everything else in black. Every number came from the dose engine; the server re-checked it byte-for-byte.
- The doctor nudges one dose with the slider — the engine recomputes, the safety gate re-applies. A high-severity interaction would disable **Sign** until acknowledged. The doctor signs (`SignOff` command). The Rx becomes immutable; any later edit creates a new `rx_versions` row.
- Print auto-opens — the single canonical A4 renderer, NABH badge, "AI-assisted, doctor-reviewed" line, a client-rendered QR carrying an ES256 JWS (no PHI in the URL). `verify.html` validates it against a read-only server endpoint.
- Off-edge and event-driven, `PrescriptionSigned` triggers the ABDM/FHIR handlers — an NRCeS R4 bundle is built by a pure adapter (no N+1 re-fetch) and pushed to the HIP. Sign-off never blocked on it.
- The whole generation is replayable from the `prescription_audit` row and event stream: the note in, every `ToolInvoked`, the exact model id+version, token usage, the draft, and the sign-off. If anyone ever challenges the prescription, the full pipeline is reproducible.
- When the team ports to AWS, the same services spin up on ECS/Cloud Run with S3 and RDS by flipping `DIS_STACK` — zero changes to the dose engine, the state machine, the command bus, the safety gates, or the frontend.

---

### Key file references (branch-qualified)

- **Foundation** (`origin/feat/dis-plan`): `dis/src/ports/{database,storage,queue,secrets,structuring,ocr,...}.ts`; `dis/src/core/{orchestrator,state-machine,promotion,confidence-policy,env.schema,idempotency-store,error-envelope,audit-log,...}.ts`; `dis/src/http/{server,router,middleware/*,realtime/status-channel,routes/*}.ts`; `dis/scripts/fitness-rules.json` (6 enforced rules); `dis/migrations/M001–M008` (each with `.rollback.sql`); ADR-001/003/005/006/007/008; `clinical_safety.md` CS-1..CS-12; and `dis/document_ingestion_service/00_overview/north_star.md` (this document's structural template).
- **Clinical brain** (`origin/sprint-2-saved`): `supabase/functions/_shared/dose-engine.ts` (745-line pure port; `computeDose`/`parseIngredients`/`calculateBSA`/`roundToUnit`/`buildCalcString`, `FREQ_EN/HI`, `HINDI_*`); `supabase/functions/generate-prescription/index.ts` (the `compute_doses` tool + three-tier severity — *and* the 150 s flaw at ~689–694, hardcoded `claude-sonnet-4-6` at 711/832); `radhakishan_system/skill/core_prompt.md`; migrations `20260428000000_baseline_from_live.sql`, `20260428001000_prescription_audit.sql`, `20260428002000_pg_trgm.sql`; docs `13-ai-architecture-research.md`, `15-decisions-2026-04-28.md`, `16-implementation-plan.md`.
- **Prototype** (port-from, then retire): `web/prescription-pad.html` (generate, dose-engine integ, `printRx`, autosave, voice), `web/dose-engine.js` (port verbatim), `web/prescription-output.html` (duplicate renderer — collapse to one), `web/registration.html` (COMMON_LABS, IAP_SCHEDULE), `console-log.md:15–16` (the 546-at-150,000 ms evidence).
- **IO / indexes**: `origin/fix/io-indexes:radhakishan_system/scripts/migration_io_indexes.sql`; `radhakishan_system/docs/system/10-index-proposal.md`.

---

*This is the north star. Every other document in `system-spec/` is a more detailed view of one facet of it; none may contradict it without flagging the contradiction here first.*
