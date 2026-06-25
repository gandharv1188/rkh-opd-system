# Glossary — Radhakishan Pediatric OPD Rx System (Target-State Rebuild)

> **Status:** Normative. This is the single, controlled vocabulary for the
> entire rebuild — frontend, backend services, database, AI generation,
> integrations, security, and ops.
>
> **Binding rule.** Every file-authoring agent, every code symbol, every test
> name, every commit message, every ADR, and every API field **MUST** use these
> exact terms. **No synonyms.** If a needed concept is missing, add it here in a
> dedicated PR — do not coin an ad-hoc term elsewhere. Where this glossary and an
> upstream study report disagree, **this glossary (aligned to the Target-Architecture
> Digest) wins**; flag the contradiction only if it conflicts with a verified API fact.
>
> **How to read the tables.** Each entry is `Term → Definition`. **Bold** terms
> are the canonical spelling. `code_font` denotes an exact identifier (file,
> column, symbol, env var, state, event, or model id) that MUST be reproduced
> verbatim. The right-most column of the architecture tables names the
> authoritative source artifact so an author can verify against real code.

---

## 0. Reading conventions and abbreviations

| Convention | Meaning |
| --- | --- |
| **Digest** | The *Target-Architecture Digest* — the load-bearing design brief this glossary serves. The build targets the Digest, **not** the current `web/` + Edge-Function prototype. |
| **Prototype** | The current shipped system: 8 single-file HTML pages under `web/`, Supabase Edge Functions, and `radhakishan_system/`. Port-from-then-retire; never the build target. |
| **`dis/` foundation** | The hexagonal TypeScript service on branch `origin/feat/dis-plan` under `dis/`. The structural template for the whole rebuild (ports/adapters/`__fakes__`, Hono, `postgres` driver, dbmate, fitness rules, state machine). |
| **Clinical brain** | The clinical logic on branch `origin/sprint-2-saved`: `dose-engine.ts`, the `compute_doses` tool, three-tier severity, and the 37 doctor-ratified decisions. |
| **MUST / MUST NOT / SHOULD** | RFC-2119 force. **MUST** = merge-blocking invariant; **SHOULD** = strong default, deviation needs an ADR. |
| `RKH` | Radhakishan Hospital, Jyoti Nagar, Kurukshetra, Haryana — NABH-accredited pediatric & neonatal hospital. |
| `OPD` | Out-Patient Department — the walk-in consultation setting this system serves. |

---

## 1. Product, workflow, and actors

| Term | Definition |
| --- | --- |
| **OPD Rx System** | The complete product: registration → nurse vitals → doctor prescription pad → print, plus patient lookup, ABDM/FHIR, and NABH compliance. The subject of this spec. |
| **3-stage workflow** | The clinical pipeline: **(1) Reception** (registration), **(2) Nurse station** (vitals/anthropometry), **(3) Doctor OPD** (prescription pad → sign-off → print). Each stage is a distinct role with distinct write scopes. |
| **Reception** | Stage 1. Registers the patient, captures demographics, allergies, labs, neonatal data, vaccination history, external records, and the visit's chief complaints; captures **guardian consent** (DPDP). |
| **Nurse station** | Stage 2. Captures vitals and anthropometry: weight, height, head circumference (HC), MUAC, temperature, HR, RR, SpO₂. |
| **Doctor OPD** / **Prescription pad** | Stage 3. The doctor reviews context, dictates/types a clinical note, triggers generation, reviews the **Draft**, edits, and signs off; print auto-opens. |
| **Print Station** | The standalone output surface (current prototype `prescription-output.html`). In the rebuild it shares the **single** `<PrintDocument>` renderer with the pad — the duplicate `printRx`/`renderRx` is collapsed to one. |
| **Patient lookup** | Read-only search across patients/visits/prescriptions by name, UHID, guardian, or token. |
| **Actor** | Any entity that issues a **Command**: `reception`, `nurse`, `doctor`, `service` (a worker), `admin`, or a future **AI agent**. Humans and AI are **symmetric actors** (see §9). |
| **Doctor (signing clinician)** | Dr. Lokender Goyal (MD Pediatrics; HMC Reg. HN 21452; PMC 23168) — the only actor who may issue a `SignOff` command. AI never signs. |
| **Guardian** | The parent/legal guardian whose consent authorizes processing a child's data. Nearly every patient is a child <18, so guardian consent is the norm, not the exception (DPDP). |

---

## 2. Domain — patient, visit, identity

| Term | Definition |
| --- | --- |
| **Patient** | A person with a longitudinal record. Identified internally by a `uuid` surrogate PK and externally by the **UHID** business key. |
| **UHID** | Unique Health Identifier. Format `RKH-<FY4><MM2><SEQ5>` — `RKH-` then exactly **11 digits**; regex `^RKH-\d{11}$`. `FY4` = the **4-digit Indian financial-year code** (April-anchored, e.g. `2526` for FY 2025-26), `MM2` = month `01`–`12`, `SEQ5` = monthly sequence zero-padded to 5. Example `RKH-25260600042` (FY 2526, month 06, seq 00042). The legacy 9-digit `RKH-YYMM#####` gloss is **retired** (a 2-digit year is ambiguous across the April FY boundary). A **UNIQUE business column**, never a primary key. Allocated **server-side** (see **server-side ID allocation**) — never the prototype's client `MAX(seq)+1`. |
| **Token number** (`token_no`) | Per-day, per-facility queue number for a visit. Server-allocated like UHID. |
| **Receipt number** (`receipt_no`) | Server-allocated unique financial/visit receipt identifier. UNIQUE business column. |
| **Visit** | One encounter for one patient: vitals, chief complaints, diagnoses, clinical note, `raw_dictation`, and an AI `visit_summary`. Bound by `(visit_id, patient_id)`; a prescription's `(visit_id, patient_id)` MUST reference a real visit via a **composite FK**. |
| **Chief complaint** | The presenting problem(s) captured at reception, free-text + structured. |
| **Visit summary** | An AI-generated (~250-word) clinical summary for returning patients, produced at registration and stored on the visit. PII-stripped before the model sees inputs. |
| **Returning patient** | A patient with prior visits; the system surfaces previous Rx, growth trend, labs, and a visit summary. |
| **Neonatal chip / Neonatal mode** | A UI/state flag that auto-activates for **age < 90 days**, **GA < 37 weeks**, or **birth weight < 2.5 kg**. Reveals neonatal fields (GA, birth weight, time of birth) and changes downstream age logic. |
| **GA** | Gestational age (weeks), captured for neonates/preterms. |
| **Preterm** | Born < 37 weeks GA. Uses **corrected age** for growth/development and **chronological age** for vaccinations (see below). |
| **Corrected age** | Chronological age minus weeks of prematurity. Used for **growth and developmental** assessment of preterms. **Computed client-side** — the AI does no age arithmetic. |
| **Chronological age** | Actual age since birth. Used for **vaccination scheduling** even in preterms. |

---

## 3. Domain — clinical content, dosing, vaccination

| Term | Definition |
| --- | --- |
| **Formulary** | The governed drug knowledge base — ~530 drugs. `generic_name` UNIQUE. JSONB holds polymorphic `formulations`, `dosing_bands`, `renal_bands`, `interactions`; the dose-engine-critical fields also exist as validated columns/CHECKs and are enforced by an **Ajv** `formulary.v1.json` schema in CI and at write time. |
| **Standard prescription** / **Protocol** | One of ~446 ICD-10-keyed treatment protocols (`first_line_drugs`, `second_line_drugs`, `investigations`, `counselling`, `warning_signs`, `monitoring_parameters`, etc.). UNIQUE on `(icd10, category, severity)`. Looked up **ICD-10-first**, diagnosis name as fallback (fuzzy via `pg_trgm`). |
| **`doctor_selected_protocol`** | The block, present only when the doctor enabled Standard Rx, that authorizes the AI to add a protocol's first-line drugs the doctor did not name (each flagged "AI suggestion from standard protocol — verify with doctor"). Absent ⇒ AI prescribes **only** drugs the doctor explicitly wrote. |
| **Dose engine** | The deterministic, pure-TypeScript **sole arithmetic authority** for all dosing math. **Runtime authority = the TS `DoseEnginePort`** in `core/` (745-LOC port, `dose-engine.ts`); every mg/ml/drop that reaches a draft, a server re-check, or paper comes from it (C5). **`web/dose-engine.js` is the frozen legacy reference / parity oracle only** — never invoked in the new runtime path; the golden-parity gate keeps the two byte-identical until the JS is retired. No DOM, no I/O, no network. AI **never** computes a number that reaches paper. |
| **`computeDose`** | The dose engine's primary function. Inputs `ComputeDoseParams` → outputs `ComputeDoseResult` (`vol`, `enD` English dose, `hiD` Hindi dose, `calc` string, `capped`, `volumeMl`, `ingredientDoses[]`, `warnings[]`). Copied **verbatim** into the prescription — never reworded or re-rounded. |
| **`compute_doses` (tool)** | The AI tool (from `sprint-2-saved`) that batches all drugs in one call, passes full `dosing_bands`, and returns engine output the model copies verbatim. AI **MUST** call it before emitting `medicines[]`. |
| **Dosing band** | A `dosing_bands[]` entry: `{ ingredient, snomed_code, ingredient_doses[], max_single_mg, max_daily_mg }`. The engine resolves the limiting ingredient internally. |
| **6 dosing methods** | `weight`, `bsa` (body-surface-area), `gfr` (renal-adjusted), `fixed`, `infusion`, `age` (age/GA-tier). The engine MUST NOT exceed a max dose. |
| **Rounding rules** | Syrups → 0.5 mL; drops → 0.1 mL; tablets → ¼ tab. Server re-checks **byte-for-byte** (no tolerance — a 20% client override is rejected). |
| **Max-dose check / cap** | Per-ingredient `max_single_mg` / `max_daily_mg` ceiling. Exceeded ⇒ `capped:true` ⇒ `overall_status` escalates to `REVIEW_REQUIRED`. |
| **`overall_status`** | The safety-gate verdict on a prescription: `overall_status ∈ {'SAFE','REVIEW_REQUIRED'}` — **UPPER_SNAKE, underscore, everywhere stored and on the wire** (DB CHECK, API, SSE, audit) (C3). The space-form **"REVIEW REQUIRED" is a display label only**, never a stored or transmitted value. |
| **Golden parity fixtures** | The mandatory TDD gate: ≥20 cases proving the TS port is byte-identical to `web/dose-engine.js` (rounding, caps, bilingual strings). The TS port ships **without** them on `sprint-2-saved`; closing this gap is a precondition of trusting the engine. |
| **4-row medicine block** | The canonical printed medicine layout, all in Royal Blue: **R1** = GENERIC NAME IN CAPS (concentration); **R2** = English dosing; **R3** = Hindi/Devanagari dosing; **R4** = inline-SVG **pictogram** sidebar. |
| **Pictogram** | Inline-SVG dosing icons (sunrise/sun/sunset/moon time-of-day + dose-quantity + food/duration). For low-literacy patients. **Every icon is paired with Hindi+English text** (never icon-only). Inline SVG only — no external images. |
| **Colour coding** | Token-driven, not inline styles: **blue = medicines**, **red = investigations**, **black = everything else**. Status MUST NOT be colour-only (a11y). |
| **Growth engine** | The deterministic `GrowthEnginePort` computing WHO z-scores — same source-of-truth discipline as dosing; AI does no growth arithmetic. |
| **Z-scores** (`WAZ`/`HAZ`/`WHZ`/`HCZ`) | Weight-for-age / Height-for-age / Weight-for-height / Head-circumference-for-age WHO standard deviations. Stored in `growth_records`. |
| **Anthropometry** | Body measurements captured at the nurse station: weight, height, HC, MUAC. |
| **MUAC** | Mid-Upper-Arm Circumference — a malnutrition screen. |
| **Lab result** | A structured `lab_results` row: `test_name`, `value`, `unit`, `flag`, `test_category`, plus `loinc_code` / `snomed_code`. **COMMON_LABS** = 39 pediatric tests in 4 categories (Hematology, Biochemistry, Microbiology, Imaging) with auto-unit/auto-flag. |
| **IAP / NHM vaccination** | Two mutually exclusive immunization schedules: **IAP 2024 (ACVIP)** and **NHM-UIP** (government). Haryana specifics: PCV + Rotavirus free, no JE. **IAP_SCHEDULE** = 13 age-based milestones, birth–12 yr. |
| **NABH compliance** | National Accreditation Board for Hospitals standards (Digital Health 2nd ed., Sep 2025). Mandatory NABH block on every prescription; pre-embedded in the prompt to save a tool round. |

---

## 4. Architecture — hexagonal core, ports, adapters

| Term | Definition | Source artifact |
| --- | --- | --- |
| **Hexagonal architecture** | Ports-and-adapters. Pure **core** depends only on **ports** (interfaces); **adapters** implement ports at the vendor edge; **wiring** is the only composition root. Copy `dis/` wholesale. | `dis/.../adrs/ADR-001-hexagonal-ports-and-adapters.md` |
| **Core** (`src/core/`) | Pure TypeScript business logic: **no `fetch`, no `fs`, no SQL, no adapter imports** (all CI-enforced). | `dis/src/core/` |
| **Port** (`src/ports/`) | An interface — "the narrow waist." Ports import no adapters. Defines a capability the core needs (e.g., `DatabasePort`). | `dis/src/ports/database.ts`, `…/storage.ts`, etc. |
| **Adapter** (`src/adapters/`) | A concrete port implementation at the vendor edge; each has a `__fakes__/` peer for tests. | `dis/src/adapters/database/supabase-postgres.ts` |
| **`__fakes__`** | In-memory adapter doubles used by fakes-only core test suites (run <1s, no I/O). | `dis/src/core/__fakes__/`, `dis/src/adapters/**/__fakes__/` |
| **Wiring** (`src/wiring/`) | The **single** composition root that selects adapters by env (`DIS_STACK`). The only place that knows which vendor is live. | (new; modeled on `dis/` wiring) |
| **HTTP layer** (`src/http/`) | Thin Hono router + middleware + SSE relay. No business logic. | `dis/src/http/{server,router,routes}` |
| **Workers** (`src/workers/`) | Off-edge long-running compute (generation, FHIR, ABDM). Pull from the durable queue. | (new) |
| **Bounded context** | A DDD module owning a model and a Postgres schema. The 9 contexts: API Gateway, Registration & Patient, Clinical Capture, Document Ingestion, Generation Worker, Job Queue & Realtime, ABDM, Dose-Engine, Print/Output (§4 of Digest). | — |
| **Anti-corruption layer (ACL)** | A boundary that translates a vendor's model (Anthropic, ABDM, OCR provider, Supabase) into the core's own types, so vendor churn never leaks inward. | — |
| **DIP** | Dependency Inversion Principle — core depends on port abstractions, not concrete adapters. The reason `core_no_adapter_imports` exists. | `coding_standards.md §2` |
| **Fitness rule** | A machine-checkable, **merge-blocking** architecture constraint. The rebuild extends `dis/scripts/fitness-rules.json` to every context. | `dis/scripts/fitness-rules.json` |
| `core_no_adapter_imports` | Fitness rule: `core/**` MUST NOT import from `adapters/`. | fitness-rules.json |
| `ports_no_adapter_imports` | Fitness rule: `ports/**` MUST NOT import from `adapters/`. | fitness-rules.json |
| `core_no_fetch` / `core_no_xhr` | Fitness rules: core MUST NOT perform network I/O. | fitness-rules.json |
| `core_no_sql_literals` | Fitness rule: core MUST NOT contain raw SQL. | fitness-rules.json |
| `supabase_sdk_only_in_supabase_adapters` / `aws_sdk_only_in_aws_adapters` | Fitness rules: a vendor SDK is restricted to that vendor's adapter modules. | fitness-rules.json |
| `core_no_model_id_literals` | **New** fitness rule: no `claude-*` model-id string may appear in business code — model selection lives only in `ModelPolicyPort` config (see §6). | (new) |

---

## 5. Architecture — command bus, events, CQRS, state machine

| Term | Definition | Source |
| --- | --- | --- |
| **Command** | An intent to mutate state, in one uniform shape, from **any** actor (doctor, nurse, system, AI agent). The single net-new construct vs `dis/`. Examples: `SaveNote`, `AdjustDose`, `AddMedicine`, `GiveVaccination`, `RequestGeneration`, `SignOff`. | §9 Digest |
| **CommandBus** | The single dispatcher every mutation flows through. Enables audit, optimistic UI, dedup (fixes the prototype's **3× `raw_dictation` write**), and the symmetric AI-actor layer. | (new) |
| **Event** | A domain fact emitted as a Command's result, e.g. `DraftNoteUpdated`, `GenerationStarted`, `ToolInvoked`, `DraftDelta`, `GenerationCompleted`, `GenerationFailed`, `PrescriptionSigned`. | §2, §9 Digest |
| **EventBus** | The publish channel for Events; read models and additive subscribers (incl. the future AI-first layer) consume from it. | (new) |
| **CQRS** | Command-Query Responsibility Segregation. Writes go through the CommandBus; reads go through cached **query objects** / **read models** (projections), e.g. `rx_generation_jobs`. | §3, §5 Digest |
| **Read model / Projection** | A query-optimized view built from the event stream (e.g. the job status row the pad polls/streams). | — |
| **State machine** | The pure `transition(state, event)` safety spine. Invalid transitions **throw and are NEVER persisted**; even failure paths route through `transition()`. | `dis/src/core/state-machine.ts` |
| **Rx generation states** | The state-machine view: `note_captured → generating → streaming → draft_ready → doctor_editing → signed → printed`, plus `superseded` and `failed`. **`signed` materializes as a row insert into `prescribing.prescriptions` via a human `SignOff` command — it is NOT a job-status value** (no generation-job enum carries `signed`; the API's `status:'signed'` is synthetic, derived from row existence; C4). The job enum is `queued|generating|streaming|draft_ready|superseded|failed|timeout`; the draft enum is `pending_review|superseded|promoted|discarded`. | §9 Digest |
| **Symmetric actors** | The principle that humans and AI emit the **same** Command shape. Going AI-first later = an additive subscriber that emits `RequestGeneration` + `SignOff` autonomously — **no rewrite**. | §9 Digest |
| **Clinical-safety invariant (CS)** | A non-negotiable, code-enforced rule (the `dis/` CS-1..CS-12 family). The headline one here: **an AI draft is `pending_review` until a human `SignOff`** — fail-closed, identical to OCR `promotion.ts` gating. | `dis/.../clinical_safety.md` |
| **Idempotency key** | A client-supplied `Idempotency-Key` **mandatory on every write**, deduplicating retried Commands. Backed by `ops.idempotency`. | `dis/src/http/middleware/idempotency.ts` |
| **Correlation ID** | A request-scoped id threaded through logs, events, error envelopes, and DB rows for end-to-end tracing. | `dis/src/core/correlation.ts` |
| **Error envelope** | The canonical error shape: `{ error: { code, message, correlation_id, retryable } }`. | `dis/src/core/error-envelope.ts` |
| **Version lock / optimistic lock** | Every mutable row carries `version int`; a stale write returns **409** `VersionConflictError`. | `dis/src/core/version-lock.ts` |
| **Outbox** | `ops.outbox` / `abdm.outbox` — durable rows guaranteeing event/callback dispatch (transactional outbox pattern). | §5, §7 Digest |
| **Kill switch** | A feature flag that returns **503 on writes**, routing traffic to safety/legacy. | `dis/.../ADR-003-kill-switch-returns-503.md` |

---

## 6. The latency design (the headline)

| Term | Definition |
| --- | --- |
| **Perceived wait ≈ 0** | The product north star: the doctor's felt time from click to a reviewable Draft is near zero — never an infinite spinner. Achieved by four compounding mechanisms below. |
| **The 150 s flaw** | The root defect being eliminated: prescription generation runs **synchronously inside a Supabase Edge Function** with a hard 150,000 ms wall-clock (logs show 504/546 at exactly 150,000 ms); generation takes 50–150 s, so doctors wait up to ~5 min. |
| **Off-edge compute** | The fix: the Claude tool-use loop runs on a **long-lived Hono/Cloud-Run worker** pulling from a durable queue — **not** in a 150 s-capped Edge Function. All edge timeout/budget/fallback workarounds are deleted. |
| **Speculative / background generation** | (Re)generating a Draft in the background from the auto-saved note **before** the doctor clicks Generate, keyed by a **content hash**. By click time a fresh `draft_ready` usually exists ⇒ instant review-first open. |
| **Content hash** | The cache key `hash({ note, patient_context_version, selected_sections })`. **Last-write-wins**: a newer hash supersedes/cancels an in-flight speculative run. | 
| **Review-first UX** | On Generate: if the speculative hash matches the current note, open the Draft **at 0 ms** with a "draft — confirm" badge; if stale, show "regenerating from your latest note…" inline. Never an infinite spinner. |
| **Streaming** | The worker uses `client.messages.stream(...)` (and `.get_final_message()` for timeout-safe completion) and emits per-job Events the pad renders progressively (diagnosis → meds → safety). Replaces the cosmetic `msgs[]` rotator. |
| **`GenerationPort` states** | The streaming contract: `idle | streaming | ready | stale | error | timeout`. Every request carries an `AbortController`, exponential-backoff retry, and a hard client deadline → degraded UI (retry / manual edit / single-shot), never an infinite spinner. |
| **Async job + 202** | `POST /generate` returns **202** with a `job_id`; the pad subscribes via SSE `GET /jobs/{id}/events`. |
| **Prompt caching** | Anthropic ephemeral prefix caching — the biggest cost+TTFT win. Render order `tools → system → messages`; `cache_control:{type:"ephemeral"}` on the last frozen system block; volatile content (note, allergies, `patient_id`, tool results) **after** the breakpoint. **No** timestamps/UUIDs in the prefix. Pre-warm with `max_tokens:0` on boot. Opus 4.8 min cacheable prefix = **4096 tokens**. Audit `usage.cache_read_input_tokens` ≠ 0. |
| **TTFT** | Time-To-First-Token — the latency metric prompt caching and streaming optimize. |

---

## 7. AI generation, model policy, and dose separation

| Term | Definition |
| --- | --- |
| **Generation (bounded context)** | The critical-path service hosting the off-edge tool-use loop, the `ClinicalKnowledgePort` tools, and the `DosingPort` recompute. |
| **`ModelPolicyPort`** | The **single** anti-corruption seam for model choice — a config object, no dated `claude-*` string in business code (enforced by `core_no_model_id_literals`). The fix for the model-retirement failure class (a hardcoded retired model broke prod). |
| `claude-opus-4-8` | The prescription-generation model. $5/$25 per MTok; 1M context; 128K output. Takes `thinking:{type:"adaptive"}` **only** (`budget_tokens` ⇒ 400); `temperature`/`top_p`/`top_k` ⇒ 400; `effort` lives inside `output_config`. `max_tokens` ~16000+ ⇒ **MUST stream**. |
| `claude-sonnet-4-6` | Mid-tier model ($3/$15). The **fallback tier** for prescription generation on overload/5xx/timeout, and an option for visit summary. (The prototype's `index.ts` hardcodes this as primary — the exact anti-pattern the rebuild removes.) |
| `claude-haiku-4-5` | Cheap/fast model ($1/$5). Default for **visit summary**, **OCR structuring** (escalate to Sonnet on low-confidence/schema-invalid), and **drug/protocol lookup**. |
| **Effort** | `output_config.effort` ∈ `low|high` — Opus runs `high` for generation; lookups/summaries run `low`. (Speculative async absorbs latency, so the old "Sonnet + effort:low" speed hack is unnecessary.) |
| **Adaptive thinking** | `thinking:{type:"adaptive"}` — the only thinking config Opus 4.8 accepts. |
| **Tool-use loop / progressive disclosure** | The agent loop where the model calls clinical tools on demand (parallel `Promise.all` execution) instead of pre-loading all knowledge. Keep the 5-tool design. |
| **The 5 tools** | `get_formulary` (with `condenseDrugForAI()` token-stripping), `get_standard_rx` (ICD-10-first), `get_previous_rx` (PII-stripped via a typed boundary), `get_lab_history`, `get_reference`. Plus `compute_doses` (§3). Each port-backed, each with a `__fake__`. The exact **`input_schema` given to Claude** and the **condensed output returned to the model** for all 6 tools are frozen in **`05_ai/tool_contracts.md`** (the authoritative tool-call wire contract). |
| **`ClinicalKnowledgePort`** | The port the DB/Storage-backed clinical tools live behind. |
| **Structured outputs / `strict:true` tools** | `output_config.format` against the `core_prompt.md` JSON schema — retires the brittle `extractJSON` regex. **No assistant prefill** (Opus 4.8 forbids it). |
| **Dose-engine separation** | The open/closed safety boundary: AI proposes med + regimen with **no numeric fields**; the engine recomputes mg/ml/drops, rebuilds R2/R3 + pictogram, applies caps; **server re-checks byte-for-byte**; mismatch ⇒ `overall_status='REVIEW_REQUIRED'`. |
| **Three-tier severity** | The gate safety grading: `severity_final ∈ {'none','moderate','high'}` (C3) — `none` → `moderate` (caution banner) → `high` (Sign disabled until ack). Tracked as `severity_client` and `severity_server`; the server can only escalate. (An audit-only `low` artifact maps to `none` at the gate.) |
| **`applySignoffGate()`** | The UX gate: high severity → Sign disabled until an ack checkbox; moderate → caution banner; **re-applied after any edit** so high→edit→save cannot bypass it. |
| **Model-tier downgrade (fallback)** | Production fallback = downgrade Opus 4.8 → Sonnet 4.6 via `ModelPolicyPort` on overload/5xx/timeout, with a `stop_reason:"refusal"` guard before reading `content[0]`, backoff+jitter on 429/5xx. **Never** silently downgrade the clinical model class without flagging. A Bedrock/Vertex same-model secondary is the safest provider failover. |
| **`prescription_audit`** | One row per generation **attempt** (incl. retries/fallback): `meta_mode`, `stop_reason`, tokens, rounds, `tools_called[]`, requested/emitted/omitted/added counts, `severity_*`, `warnings[]`, `duration_ms`. The NABH/clinical-safety traceability record. |
| **Generation eval** | The eval-gate over a frozen pediatric fixture set: dosing within rounding rules, NABH fields present, **no PII leakage**, JSON-schema conformance, safety invariants. The *runner* is owned by `09_engineering_discipline/`; this spec defines **what** is gated. |

---

## 8. Database, schemas, and migration

| Term | Definition | Source |
| --- | --- | --- |
| **Bounded-context schemas** | Postgres schemas mirroring DDD contexts: `catalog`, `clinical`, `prescribing`, `identity`, `abdm`, `ops`. | §5 Digest |
| **Surrogate PK** | Every mutable table has `id uuid PK` plus `created_at`, `updated_at`, `version int`, `correlation_id`, `facility_id`. UHID/receipt are UNIQUE **business** columns, not PKs. | §5 Digest |
| **Server-side ID allocation** | `clinical.uhid_counter(fy_code, month, last_seq)` advanced via `UPDATE … RETURNING` under row lock, exposed through a `SECURITY DEFINER` function. Kills the client `MAX(seq)+1` race. Same for `receipt_no`/`token_no`. | §5 Digest |
| **Composite FK** | `(visit_id, patient_id) REFERENCES visits(id, patient_id)` — the DB enforces prescriptions↔visits consistency the prototype only enforced in app code. | §5 Digest |
| **`rx_generation_jobs`** | The async-generation read model: `status (queued|generating|streaming|draft_ready|superseded|failed|timeout)` — **never `signed`** (signing is a separate human command that inserts a `prescribing.prescriptions` row; C4), `idempotency_key` UNIQUE, `correlation_id`, `speculative bool`, `content_hash`, tokens, `cost` (micro-INR int), `latency_ms`. | §5 Digest |
| **`rx_versions`** | Append-only edit history of a prescription. Signed Rx are **immutable**; edits create new rows, with a **content hash** for tamper-evidence. | §5 Digest |
| **`concepts` (terminology)** | `catalog.concepts(system ∈ ICD10|SNOMED|LOINC, code, display)` with FKs from drugs/diagnoses/labs. Codes validated on write. | §5 Digest |
| **Real RLS** | Row-Level Security driven by `current_setting('app.role' / 'app.doctor_id' / 'app.facility_id')` set from the JWT at request start — portable Supabase↔RDS. Roles: `reception`, `nurse`, `doctor`, `service`, `admin`. **No DELETE policy** on clinical/audit tables. The **anon key never touches clinical schemas**. Replaces the prototype's blanket `authenticated_full_access` over an anon key. | `dis/migrations/M008_rls_policies.sql` |
| **Append-only audit** | `ops.audit_log` with BEFORE UPDATE/DELETE triggers that **raise** — immutable history. | `dis/migrations/M002_ocr_audit_log.sql` |
| **dbmate** | The migration tool. **Forward-only**, each migration ships a `.rollback.sql`; CI verifies up→down→up + a `pg_dump` schema-diff. No ORM — schema lives **only** in migrations. | `dis/.../ADR-006-postgres-driver-over-pg-or-drizzle.md` |
| **`postgres` (porsager) driver** | The DB driver: parameterized `sql` / `sql.unsafe`. No Drizzle/Prisma. | `dis/.../ADR-006…` |
| **Baseline** | `20260428000000_baseline_from_live.sql` — the `pg_dump` of the live 14-table schema; the migration's source of truth. | `origin/sprint-2-saved` |
| **`verification_status='legacy'`** | The backfill convention marking data migrated from the prototype (vs `verified`/`auto_approved`/`pending_review`). | `dis/` M-006 |
| **Abort-on-duplicate** | The migration discipline: a dry-run dedupe that **aborts** rather than silently merging on conflict. | `dis/` M-007 |
| **Mojibake cleanup** | ETL step fixing character-corruption in the formulary/std-Rx JSON (e.g. `â€"` for an em-dash). | §5 Digest |
| **`pg_trgm`** | Trigram extension powering fuzzy `diagnosis_name → protocol` matching (GIN index on `standard_prescriptions.diagnosis_name`). | `…_pg_trgm.sql` |
| **Postgres job queue** | The POC durable queue (`dis_jobs`/pgmq pattern): `topic`, `payload`, `status`, `attempts`, `locked_until`, `locked_by`, partial index on ready jobs. Swapped for **SQS** by `DIS_STACK=aws`. | `dis/migrations/M004_dis_jobs.sql` |

---

## 9. Integrations — ABDM / FHIR / signing

| Term | Definition |
| --- | --- |
| **ABDM** | Ayushman Bharat Digital Mission — India's national health-data exchange. The system acts as both **HIP** and (later) **HIU**. |
| **ABHA** | Ayushman Bharat Health Account — the patient's national health id, verified/created at registration (V3 API). |
| **HIP** | Health Information Provider — the role that **pushes** records (OPConsultation, Prescription, DiagnosticReport, ImmunizationRecord) into ABDM. Milestone M2. |
| **HIU** | Health Information User — the role that **requests/receives** records via consent. Deferred (M3). |
| **Care context** | An ABDM linkage (`abdm.care_contexts`) tying a visit/prescription to a patient's ABHA for sharing. |
| **Consent artefact** | An ABDM `abdm.consent_artefacts` record — patient consent for health-data sharing. **Distinct** from DPDP **guardian consent** captured at registration. |
| **FHIR R4** | HL7 Fast Healthcare Interoperability Resources, release 4 — the bundle format ABDM consumes. |
| **NRCeS R4 profiles** | The India-specific FHIR profiles the bundle builder targets. |
| **`FhirCompositionPort` / `NrcesR4Adapter`** | The pure FHIR-bundle builder ported from the 1680-LOC `generate-fhir-bundle` — takes **data, not a DB** (kills the N+1 formulary re-fetch). Adds DocumentReference + Composition narrative + `Bundle.signature` + a FHIR-validator CI gate. |
| **`AbdmGatewayPort`** | The ACL around the ABDM gateway: session/auth, `on-*` callbacks, `pushHealthInformation`, consent. With `abdm_outbox`/`abdm_inbox` for reliable callbacks and real request-auth (verify JWS against ABDM CM **JWKS** + timestamp/nonce, **fail closed**). |
| **`CryptoBoxPort` (Fidelius)** | The encryption boundary for ABDM payloads — **Fidelius / Curve25519 Short-Weierstrass, NOT libsodium Montgomery**. Plaintext gated behind a double-locked sandbox flag. |
| **`SignaturePort`** | **ES256 JWS** signing — replaces the prototype's forgeable 6-char client-salt QR hash. `verify.html` calls a **read-only server endpoint**; no PHI in the QR URL; QR rendered client-side (drop `api.qrserver.com`). |
| **HFR ID / HPR ID** | Health Facility Registry id / Health Professional Registry id — ABDM prerequisites stored in **config/secrets**, never source (the baked-in `HOSPITAL.hfr_id=""` is a blocker). |
| **Off-edge, event-driven ABDM** | `PrescriptionSigned` → async handlers build & push FHIR. Sign-off **never blocks** on ABDM/FHIR. |

---

## 10. Security, PII, and compliance

| Term | Definition |
| --- | --- |
| **DPDP Act 2023 + Rules 2025** | India's Digital Personal Data Protection law (in force). Healthcare exemption covers routine care but is scope-limited to service delivery (no analytics/marketing/secondary use). |
| **Guardian consent** | The DPDP-mandated, timestamped, plain-language consent (with a withdrawal path) captured at registration because nearly every patient is a child <18. Distinct from ABDM consent artefacts. Carries a `purpose` — the two live purposes are `opd_care` (gates clinical *processing*) and **`ai_assisted_rx`** (gates AI generation). **AI-assisted prescription generation is blocked at the command boundary unless an active `ai_assisted_rx` consent exists** (`consent_given = true AND withdrawn_at IS NULL`); absence/withdrawal → `403 CONSENT_REQUIRED`, fail-closed, applying equally to a doctor click, a speculative trigger, and a future AI agent. Withdrawal cancels in-flight speculative jobs (C6). |
| **Breach runbook clocks** | On a personal-data breach: notify the **DPB** "without delay" + full report within **72 h**; affected principals within **72 h**; **and CERT-In within 6 h** — both clocks run. |
| **NABH Digital Health 2nd ed.** | The EMR compliance checklist (Sep 2025). The security/RLS/audit + ABDM work earns Silver→Gold. |
| **`SecretsPort`** | The secrets ACL: Supabase secrets (POC) → AWS Secrets Manager (prod). `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / service-role key **NEVER** in client, logs, URLs, or commit messages. |
| **Service-role key** | The privileged Supabase key — never in a client-reachable function. |
| **Anon key** | The public Supabase key — in the rebuild it **never touches clinical schemas** (real RLS + JWT instead). |
| **PII-stripping boundary** | The typed boundary in `get_previous_rx`/visit-summary ensuring **no PII reaches the model** (replaces ad-hoc `.map`). |
| **`esc()`** | The design-system's safe-render primitive — HTML-escapes every dynamic value before `innerHTML` insertion (XSS protection). Preserved as a component-level wrapper. |
| **WCAG 2.2 AA / Lighthouse ≥90** | The accessibility bar; **no colour-only status** (mitigates the verification UI's rubber-stamp risk). |
| **Provenance** | Visually distinguishing AI-generated lines from clinician edits, plus the printed "AI-assisted, doctor-reviewed" line — for auditability and false-confidence avoidance. |

---

## 11. Compute platform, deployment, and rollout

| Term | Definition |
| --- | --- |
| **Hono** | The web framework (one Dockerfile, runs Node/Deno/Bun/Lambda). Chosen over Edge Functions for any long-running compute. |
| **`createServer()`** | Factory returning a **fresh** Hono instance per call (test isolation). |
| **POC stack** | Supabase (Postgres + Auth + Storage) with the Hono container on **Fly.io / Render** holding SSE, plus a Postgres job queue. |
| **Prod stack** | **Google Cloud Run** (60-min request timeout, scale-to-zero, clean SSE) with **SQS** via `DIS_STACK=aws`. The boring default. |
| **`DIS_STACK`** | The env flag the wiring reads to pick the adapter set (`supabase` ↔ `aws`) — the portability switch. |
| **`env.schema.ts`** | The Zod env schema validated at boot (fail-fast). The home of centralized config. |
| **`ConfigPort`** | The client-side config seam (URL/key/MODEL) — no hardcoded URL, key, or model anywhere in components. |
| **OpenAPI 3.1** | The REST API source-of-truth, diffed against routes in CI. |
| **Shadow mode** | Running speculative generation in parallel with the legacy Edge output and **diffing**, before any user-visible cutover. |
| **Feature-flag ladder** | The rollout gate: `ENABLED → SHADOW → OPT_IN_OPERATORS → *`, with a kill-switch before cutover. |
| **Phased migration** | The decisive order (§10 Digest): (1) config/secrets centralization, (2) adopt the `dis/` skeleton, (3) port-ify dose+growth engines with golden parity fixtures, (4) build the CommandBus + speculative state machine + streaming `GenerationPort`, (5) DB migration, (6) frontend rebuild, (7) ABDM/FHIR off-edge, (8) shadow rollout. |

---

## 12. Frontend — components, ports, design system

| Term | Definition |
| --- | --- |
| **Component-based SPA** | The frontend: Vite + TS (React or equivalent, matching `dis/ui`). Replaces the 8 single-file HTML pages and ~21k lines of duplicated inline JS/CSS. |
| **Container/presentational split** | The mandated component pattern: containers wire data/Commands; presentational components are pure render. |
| **Client ports** | Anti-corruption seams so **no component touches a vendor directly**: `DataAccessPort`, `GenerationPort`, `TranscriptionPort` (dual-engine VAD), `ConfigPort`, `PrintPort`, `EventBus`/`CommandBus`, `RealtimePort` (SSE/status-row). |
| **`<PrintDocument>`** | THE single canonical A4 renderer (4-row + SVG) — eliminates the duplicate `printRx`/`renderRx`. Shared by pad and Print Station. |
| **Core components** | `<PatientHeaderStrip>`, `<VitalsPanel>`, `<DictationPad>` (textarea + voice + autosave + speculative trigger), `<SectionChips>`, `<MedicineCard>`, `<DoseAdjuster>` (bound to the pure dose engine), `<PrescriptionReview>`, `<GrowthTrend>`, `<LabPills>`, `<VaxChecklist>`, `<QrBlock>`, `<SafetyPanel>`, `<SignoffGate>`. |
| **Design tokens** | Centralized style values (colours, spacing, fonts) — **not inline styles**. Encode the blue/red/black colour code, the A4 print spacing (margins 12mm 10mm, body 12px/1.5, med r1 14px / r2-r3 12px), Noto Sans Devanagari, sticky headers. |
| **VAD / dual-engine transcription** | Voice-Activity-Detection dictation: AI transcribe primary, **Web Speech API** (`en-IN`, Chrome) fallback, behind `TranscriptionPort`. |
| **`renderOmittedStubs()`** | The red stubs shown for formulary misses (a drug the doctor named that the engine could not dose), so an omission is never silent. |

---

## 13. Branch / artifact map (where the truth lives)

| Reference | What it is |
| --- | --- |
| `origin/feat/dis-plan` → `dis/` | The hexagonal foundation: ports, core, adapters+`__fakes__`, Hono http, migrations M001–M008 (+`.rollback.sql`), `fitness-rules.json`, ADR-001/003/005/006/007/008, `clinical_safety.md` CS-1..CS-12. **The structural template.** |
| `origin/sprint-2-saved` | The clinical brain: `supabase/functions/_shared/dose-engine.ts`, `compute_doses` + three-tier severity in `generate-prescription/index.ts`, `core_prompt.md`, the `*_prescription_audit.sql` / `*_pg_trgm.sql` migrations, decisions `15-decisions-2026-04-28.md`. |
| `web/` (prototype) | Port-from-then-retire: `prescription-pad.html` (generate, dose-engine integ, `printRx`, autosave, voice), `dose-engine.js` (port **verbatim**), `prescription-output.html` (duplicate renderer — collapse to one), `registration.html` (`COMMON_LABS`, `IAP_SCHEDULE`). |
| `supabase/functions/generate-prescription/index.ts` | The **150 s flaw** and the **hardcoded model** anti-pattern the rebuild removes. |
| `origin/fix/io-indexes` → `migration_io_indexes.sql` | Justified IO indexes to fold into the migration (verify no dupes vs baseline). |

---

*End of glossary. Any new term enters here first.*
