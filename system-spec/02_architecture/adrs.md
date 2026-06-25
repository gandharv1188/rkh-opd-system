# 02 · Architecture Decision Records (ADRs)

> **Status:** Authoritative target-state decisions for the complete OPD-system rebuild (frontend + backend + database + AI). Build to **these**, not to the live `web/` + Supabase Edge-Function prototype. Where an ADR here disagrees with an upstream study report, this file wins; where it disagrees with a verified API fact, the file author flags it.
>
> **Scope:** This file records the *load-bearing* architecture decisions — the ones that, if reopened, force a rewrite. Each ADR follows the canonical shape (**Context → Decision → Consequences → Alternatives considered**) and is decisive: a single chosen option, not a survey. Per-component depth lives in siblings: `overview.md` (the component/service spine), `backend_services.md`, `frontend_architecture.md`, `frontend_design_system.md`, and the numbered suites (`04_database/`, `05_ai/`, `06_api/`, `07_integrations/`, `08_security/`, `09_engineering_discipline/`).
>
> **Lineage:** These extend — they do not replace — the eight foundation ADRs already on-branch under `dis/document_ingestion_service/02_architecture/adrs/` (ADR-001 hexagonal, ADR-005 Hono, ADR-006 `postgres` driver, ADR-007 Haiku-default/Sonnet-escalation, etc.). The Document Ingestion Service (DIS) is the *proven exemplar* of this style; the ADRs below promote its patterns to the whole system and add the prescription-specific decisions DIS never had to make (off-edge generation, dose-engine separation, command bus, ABDM/FHIR, model policy).

---

## How to read this file

| Field | Meaning |
|---|---|
| **Status** | `Accepted` (build to it), `Accepted — supersedes X`, or `Proposed`. All ADRs below are **Accepted** unless noted. |
| **Context** | The forces in play — the prototype flaw, the constraint, the upstream evidence. Verifiable, not aspirational. |
| **Decision** | One chosen option, stated imperatively. No hedging. |
| **Consequences** | What this buys, what it costs, what it commits us to. Both signs. |
| **Alternatives considered** | The roads not taken, and the disqualifying reason for each. |

### ADR index

| # | Decision | Anchors / supersedes |
|---|---|---|
| [ADR-101](#adr-101) | Off-edge long-running compute (Hono container/Cloud Run), **not** Supabase Edge Functions, for generation | Kills the 150 s wall-clock 504/546 |
| [ADR-102](#adr-102) | Async job + streaming + speculative background generation → perceived wait ≈ 0 | The headline UX decision |
| [ADR-103](#adr-103) | Hexagonal TS + Hono + `postgres` (porsager) + dbmate; no ORM | Extends DIS ADR-001/005/006 |
| [ADR-104](#adr-104) | Frontend = component-based SPA (Vite + TS/React) with client-side ports; retire 8 single-file HTML pages | Replaces ~21k LOC inline JS/CSS |
| [ADR-105](#adr-105) | Dose-engine is a sealed pure `core/` module; the AI never computes a number that reaches paper | Clinical-safety invariant |
| [ADR-106](#adr-106) | All model config behind one `ModelPolicyPort`; per-task model policy; `core_no_model_id_literals` CI rule | A hardcoded dated model retired and broke prod |
| [ADR-107](#adr-107) | DDD bounded-context Postgres schemas; migrations-only; server-side ID allocation; real RLS; append-only audit | Fixes the 11 critical schema flaws |
| [ADR-108](#adr-108) | ABDM/FHIR generation off-edge & event-driven; pure `FhirCompositionPort`; JWS-signed QR (drop forgeable hash) | Decouples from sign-off |
| [ADR-109](#adr-109) | Service boundaries = bounded contexts as modules in one monorepo (modular monolith), not microservices | Avoids premature distribution |
| [ADR-110](#adr-110) | A single CommandBus → EventBus; humans and AI are symmetric actors | Makes "AI-first" an additive subscriber |

---

<a id="adr-101"></a>
## ADR-101 — Off-edge long-running compute for prescription generation

**Status:** Accepted — supersedes the prototype's synchronous Edge-Function tool loop.

### Context

The prototype runs the Claude tool-use loop **inside a Supabase Edge Function** (`supabase/functions/generate-prescription/index.ts`, loop at ~L500–613, `MAX_TOOL_LOOPS = 10`). Edge Functions enforce a **hard 150 s wall-clock limit**. Real generations take **50–150 s** (Opus-class reasoning + multiple progressive-disclosure tool round-trips + dose computation), so they routinely hit the ceiling. The failure is in the logs, not theoretical:

```
generate-prescription:1  Failed to load resource: the server responded with a status of 546 ()
prescription-pad.html:5101 Prescription generation error: Generation failed (HTTP 546)
```

`546` / `504` fire at exactly `150,000 ms`. To survive the wall, the prototype accreted timeout/budget/fallback workarounds (same-model single-shot fallback, loop caps tuned for the wall, a cosmetic `msgs[]` spinner) — complexity that exists *only* because of the wall. Doctors wait up to five minutes and sometimes get nothing.

A second, structural problem: Edge Functions hold the **service-role pathway and the `ANTHROPIC_API_KEY`** in a place that also serves the browser, and they cannot hold a long-lived SSE/streaming connection cleanly.

### Decision

Move all long-running compute **off the edge** to a **long-lived Node 20 + Hono container** (the `workers/` tier of the hexagon). Generation, FHIR-bundle building, and ABDM pushes run there, pulling from a **durable Postgres job queue** (the DIS `M004_dis_jobs` pattern: `topic / payload / status / attempts / locked_until / locked_by` + a partial index on ready jobs), exactly mirroring DIS's off-edge worker model (DIS ADR-002).

- **POC platform:** the Hono container on **Fly.io / Render** — long-lived, holds SSE, pulls from a Postgres queue (`pg-cron`/pgmq adapter).
- **Production / headroom:** **Google Cloud Run** (60-minute request timeout, scale-to-zero, clean SSE/streaming) is the boring default; the queue flips to **SQS** by setting `DIS_STACK=aws`. The compute platform is a wiring choice, not a code change.
- **Supabase remains** the system of record (Postgres, Auth/JWT, Storage). **Edge Functions, if kept at all,** are reduced to thin signed-webhook receivers that `validate → enqueue → 202` and SSE relays — **never** the tool-loop host.

Delete every timeout/budget/single-shot-fallback workaround that existed solely to survive the wall.

### Consequences

- **Kills the 504/546-at-150,000 ms failure class outright.** Generation length is now bounded by clinical correctness, not by an infrastructure ceiling.
- **Enables ADR-102** (streaming + speculative generation): a persistent worker can hold SSE, run `client.messages.stream(...)`, and emit domain events for the duration of a real generation.
- **Portability preserved:** off-edge does not mean off-Supabase — Postgres/Auth/Storage stay; only *compute* relocates, and it relocates again (Fly → Cloud Run → Lambda) by an env flip because it lives behind `QueuePort`/`SecretsPort` adapters.
- **Cost/ops:** we now run (and pay for) a container or Cloud Run service and a queue worker; we accept that in exchange for correctness. Scale-to-zero on Cloud Run keeps idle cost near zero for a single-hospital POC.
- **Secrets boundary improves:** `ANTHROPIC_API_KEY` and the service-role key live only in the worker tier (behind `SecretsPort`), never in a browser-reachable function (see ADR-106, `08_security/`).
- **Commitment:** the worker tier is now a first-class deployable with its own health checks, kill-switch (503 on writes, DIS ADR-003), and observability.

### Alternatives considered

| Option | Why rejected |
|---|---|
| **Keep Edge Functions, raise/parallelize work to fit 150 s** | The wall is non-negotiable on Supabase; "fit it in" is exactly the workaround pile we're deleting. A correctness-sensitive Opus generation cannot be guaranteed under 150 s. |
| **Edge Function that returns 202 and a *second* Edge Function polls** | Still caps each step at 150 s, still can't hold SSE, doubles the moving parts, and leaves the API key on the edge. |
| **Browser calls Claude directly (no backend)** | Leaks `ANTHROPIC_API_KEY` to the client; no server-side dose recompute, audit, or PII-stripping boundary; clinically and legally untenable. |
| **Serverless functions with longer limits (Vercel/AWS Lambda 15 min)** | Acceptable as a *future* `DIS_STACK` target, but Lambda's cold starts and SSE ergonomics are worse than a warm container for the interactive review-first flow. We keep Lambda reachable via the same `QueuePort`/wiring, not as the default. |

---

<a id="adr-102"></a>
## ADR-102 — Async jobs + streaming + speculative background generation (perceived wait ≈ 0)

**Status:** Accepted.

### Context

Even off-edge (ADR-101), a *synchronous* "click Generate → wait 60–120 s → see result" flow leaves the doctor staring at a spinner. The north-star UX constraint is **the doctor's perceived wait to a reviewable prescription is ≈ 0**, while preserving the **clinical-safety invariant that every draft is doctor-reviewed and signed — never auto-finalized**.

Two facts make a near-zero perceived wait achievable without cutting clinical corners:

1. The doctor's note **already auto-saves** (debounced) to `visits.raw_dictation` during the consult (prototype `prescription-pad.html` L3905–3964) — there is signal *before* the click.
2. The Claude SDK supports **streaming** (`client.messages.stream(...)` → `.get_final_message()`), and large `max_tokens` (~16 000+ for a full bilingual prescription) **must** stream anyway — the SDK refuses non-streaming requests above ~16 K to avoid HTTP timeouts.

### Decision

Combine four compounding mechanisms, all riding the command/event bus (ADR-110):

1. **Async job + notify.** `POST /generate → 202 {job_id}`; the worker (ADR-101) processes it; the client subscribes to a per-job channel. Generation state is a first-class read model: `prescribing.rx_generation_jobs` with status `queued | generating | streaming | draft_ready | superseded | failed`, plus `idempotency_key` (UNIQUE), `correlation_id`, `speculative` (bool), `content_hash`, token counts, `cost_micro_inr` (int), `latency_ms`.
2. **Speculative / background generation from the auto-saved note.** Each meaningful autosave and each section-chip change emits a `DraftNoteUpdated` command. A debounced background worker **speculatively (re)generates** a draft keyed by a **content hash of `{note, patient_context_version, selected_sections}`**. Last-write-wins: a newer hash supersedes the in-flight run (`status='superseded'`). By the time the doctor clicks **Generate**, a fresh `draft_ready` usually already exists.
3. **End-to-end streaming.** The worker streams and emits domain events on the per-job channel: `GenerationStarted`, `ToolInvoked`, `DraftDelta`, `GenerationCompleted`, `GenerationFailed`. The Pad subscribes by `job_id` and renders progressively (diagnosis → meds appear → safety). Real progress replaces the cosmetic rotator.
4. **Review-first UX with a typed `GenerationPort` state contract.** On click: if the speculative hash matches the current note, **open review at 0 ms** with a subtle "draft — confirm" badge while a background delta streams; if stale, show "regenerating from your latest note…" inline. `GenerationPort` exposes states `idle | streaming | ready | stale | error | timeout`, an `AbortController` per request, exponential-backoff retry, and a **hard client deadline → degraded UI** (retry / manual edit / single-shot) — **never** an infinite spinner.

**Transport:** **SSE** (`GET /jobs/{id}/events`) is the notify channel, plus a short-interval status-row poll as fallback. (Realtime WebSocket was removed for IO cost; see commit `1d80756 perf(io)`.)

**Independent cost+TTFT lever — prompt caching.** Render order `tools → system → messages`; freeze tool defs (deterministic order) + `core_prompt.md` + a pre-embedded NABH block; put `cache_control:{type:"ephemeral"}` on the **last system block**; volatile content (note, allergies, `patient_id`, tool results) goes **after** the breakpoint. No timestamps/UUIDs in the prefix. Pre-warm with `max_tokens:0` on worker boot. **Opus 4.8's minimum cacheable prefix is 4096 tokens** (the skill prompt clears it). Audit `usage.cache_read_input_tokens` is non-zero.

### Consequences

- **Perceived wait collapses** to near-zero on the common path (note settled before click → speculative `draft_ready` already present).
- **The invariant holds:** speculative or not, a draft is `pending_review` until a human `SignOff` command (ADR-105, ADR-110). Speculation changes *when* compute runs, never *whether* a human signs.
- **Cost discipline required:** speculative regeneration on every autosave would be expensive; the content-hash + last-write-wins + debounce keep it to roughly one generation per *settled* note, and prompt caching makes re-runs ~10× cheaper on the cached prefix.
- **New schema + observability surface:** `rx_generation_jobs` and `ops.outbox` (event dispatch) are now load-bearing; the audit trail captures `speculative`, `content_hash`, tokens, and cost per attempt (ADR-107).
- **Streaming is mandatory, not optional:** `max_tokens ~16 000+` forces it; the `GenerationPort` state machine and abort/retry/deadline logic are non-negotiable client code.
- **Failure is always graceful:** the hard client deadline guarantees a degraded-but-usable UI; "infinite spinner" becomes an impossible state by construction.

### Alternatives considered

| Option | Why rejected |
|---|---|
| **Synchronous request/response (even off-edge)** | Doctor still waits 60–120 s per click; wastes the pre-click signal already sitting in `raw_dictation`. |
| **Generate only on click, but stream** | Better than a spinner, but still a cold 60–120 s; speculation is what makes it feel instant. |
| **Auto-finalize the speculative draft to save a click** | Violates the clinical-safety invariant; a generated prescription must be reviewed and signed by a clinician. Non-negotiable. |
| **Polling only (no SSE)** | Works as a fallback and is the IO-cheap baseline, but loses progressive token rendering; we keep it *as* the fallback, not the primary. |
| **Realtime WebSocket for notify** | Removed for IO cost (`1d80756`); SSE + status-row poll deliver the same UX at a fraction of the DB IO. |

---

<a id="adr-103"></a>
## ADR-103 — Stack: hexagonal TypeScript + Hono + `postgres` (porsager) + dbmate; no ORM

**Status:** Accepted — extends DIS ADR-001, ADR-005, ADR-006 to the whole system.

### Context

The rebuild's two hardest non-functional requirements are **vendor/cloud portability** (Supabase → AWS by an env flip) and **machine-checkable safety boundaries** (the AI must not do arithmetic; clinical writes must be gated). The DIS service on `origin/feat/dis-plan` already proves a stack that delivers both: a typecheck-clean Hono service, `postgres` driver, dbmate migrations, eight ports each with a `__fakes__/` peer, Zod-validated env, and a fitness-rules CI that *merge-blocks* violations. We adopt it wholesale rather than re-derive it.

### Decision

**Runtime/language:** Node 20 + **Hono** (one Dockerfile; portable across Node/Deno/Bun/Lambda), TypeScript `strict`.
**DB driver:** **`postgres` (porsager)** — parameterized `sql` / `sql.unsafe`; **no ORM** (no Drizzle, no Prisma). Schema lives **only** in migrations.
**Migrations:** **dbmate**, forward `.sql` + a paired `.rollback.sql` (the DIS `M001–M008` convention); CI verifies up→down→up and a `pg_dump` schema-diff.
**Validation:** **Zod** (env + DTOs) + **Ajv** (JSON-schema for clinical payloads / the formulary contract).
**Logging:** **pino** + correlation IDs + a PII redactor. **Tests:** **vitest**; fakes-only `core/` suites run < 1 s.

**Hexagonal layout (copy `dis/` wholesale; bounded contexts as modules):**

```
src/
  core/      pure TS — no fetch, no fs, no SQL, no adapter imports (CI-enforced)
  ports/     interfaces only (the narrow waist) — no adapter imports
  adapters/  vendor edge; each has a __fakes__/ peer
  http/      Hono router + middleware + SSE relay (thin)
  wiring/    the ONLY composition root that picks adapters by env (DIS_STACK)
  workers/   off-edge long-running compute (generation, FHIR, ABDM)
ui/          Vite + TS SPA (component-based; client ports mirror server ports)
```

**Fitness rules (CI merge-blockers; extend `dis/scripts/fitness-rules.json`):** `core_no_adapter_imports`, `ports_no_adapter_imports`, `core_no_fetch`, `core_no_xhr`, `core_no_sql_literals`, `supabase_sdk_only_in_supabase_adapters`, `aws_sdk_only_in_aws_adapters`, **plus the new `core_no_model_id_literals`** (no `claude-*` / `us.anthropic.*` string in business code — ADR-106).

### Consequences

- **Portability is structural, not promised:** `core` and `ports` never reference a vendor; `wiring` is the only place adapters are chosen by `DIS_STACK`. Switching Supabase→RDS is a wiring + adapter change, with CI proving `core` stayed clean.
- **Safety boundaries are enforced by CI, not by reviewers' attention:** a `fetch()` in `core/`, raw SQL outside an adapter, or a `claude-*` literal in business code is a *merge blocker*. (See ADR-105, ADR-106.)
- **No ORM means schema authority is unambiguous** (migrations only) and the dose-engine path stays free of an ORM's lazy-loading or type-coercion surprises. Cost: hand-written `sql` and explicit row mappers — accepted as the price of zero magic on a clinical write path.
- **Fast feedback:** fakes-only `core` suites under 1 s keep TDD tight (DIS proves this).
- **Commitment:** every new bounded context must ship as a hexagon with ports + `__fakes__` and must pass the same fitness rules — no exceptions, or the portability/safety guarantees rot.

### Alternatives considered

| Option | Why rejected |
|---|---|
| **Drizzle / Prisma ORM** | Re-introduces a schema source competing with migrations; ORM type-coercion and lazy loading are exactly what we don't want on a clinical write path; DIS ADR-006 already chose `postgres` for this reason. |
| **NestJS / heavyweight DI framework** | Imposes a framework-shaped architecture and decorators where a thin Hono router + an explicit composition root is clearer and more portable. |
| **Fastify instead of Hono** | DIS ADR-005 already evaluated this; Hono's portability across Node/Deno/Bun/Lambda wins for the "flip the stack" requirement. |
| **Knex/raw `pg`** | `postgres` (porsager) gives safer tagged-template parameterization and better ergonomics than `pg`; Knex is a query-builder ORM-lite we don't need. |
| **Go / Rust backend** | The clinical brain (`dose-engine.ts`, 745 lines) and the DIS foundation are TypeScript; a rewrite buys nothing and discards a verified, typecheck-clean codebase. |

---

<a id="adr-104"></a>
## ADR-104 — Frontend: component-based SPA with client-side ports; retire the single-file HTML pages

**Status:** Accepted — supersedes the 8 self-contained HTML pages.

### Context

The prototype is **8 single-file HTML pages** with ~21k lines of duplicated inline JS/CSS, raw `fetch()` + a hardcoded anon key in every page, and **two divergent print renderers** (`prescription-pad.html#printRx` L6682 and `prescription-output.html#renderRx` L690–1073) that must stay byte-identical but drift. Dynamic data is injected with hand-rolled `esc()` calls. There is no state abstraction, no component reuse, and no way to make the doctor's UI a *symmetric actor* on the command bus (ADR-110) because there is no bus on the client.

### Decision

Rebuild the UI as a **component-based SPA (Vite + TypeScript; React or the equivalent matching `ui/`)** with a strict **container/presentational** split and **all vendor access behind client-side ports** — no component ever touches Supabase or `fetch` directly.

**Client ports (anti-corruption seams):** `DataAccessPort` (one Supabase/REST adapter), `GenerationPort` (streaming; states from ADR-102), `TranscriptionPort` (dual-engine VAD: AI-transcribe primary, Web Speech fallback), `ConfigPort` (centralized URL / key / **MODEL** — no hardcoded model anywhere; ADR-106), `PrintPort`, `EventBus` / `CommandBus` (the client analog of ADR-110), `RealtimePort` (SSE / status-row).

**Components (build once, share between pad and print station):** `<PatientHeaderStrip>`, `<VitalsPanel>`, `<DictationPad>` (textarea + voice + autosave + speculative trigger), `<SectionChips>`, `<MedicineCard>` (4-row + pictogram + dose-adjust), `<DoseAdjuster>` (slider/radios bound to the pure `DoseEngine`), `<PrescriptionReview>`, **`<PrintDocument>` (THE single canonical A4 renderer — eliminates the duplicate `printRx`/`renderRx`)**, `<GrowthTrend>`, `<LabPills>`, `<VaxChecklist>`, `<QrBlock>`, `<SafetyPanel>`, `<SignoffGate>`.

**Client CQRS / command bus:** every mutation (`SaveNote`, `AdjustDose`, `AddMedicine`, `GiveVaccination`, `SignOff`) is a command → audit, optimistic UI, dedup (**fixes the 3× `raw_dictation` write**), and the symmetric AI-actor layer. Reads go through cached query objects.

**Design system = tokens, not inline styles** (full spec in `frontend_design_system.md`): colour as tokens (**blue = meds, red = investigations, black = else**); the 4-row bilingual medicine block (R1 GENERIC CAPS(conc) / R2 English / R3 Devanagari / R4 inline-SVG pictogram sidebar); A4 print spacing preserved (margins 12 mm 10 mm, body 12 px/1.5, med r1 14 px / r2-r3 12 px, emergency 2-col, centered hospital header, NABH badge); Noto Sans Devanagari; **inline SVG only (no external images)**; sticky headers. **a11y: WCAG 2.2 AA, Lighthouse ≥ 90, no colour-only status** (the rubber-stamp risk). **Tablet:** touch targets, the dose slider, and voice are first-class.

**Safety UX ported verbatim from `sprint-2-saved` `prescription-pad.html`, re-homed into components:** missing-weight prompt at Generate; preterm corrected/chronological age **pre-computed on the client** (AI does no arithmetic); `applySignoffGate()` (high severity → Sign disabled until ack checkbox; moderate → caution banner; **re-applied after any edit** so high→edit→save can't bypass); inline allergy-safe alternative; `renderOmittedStubs()` red stubs for formulary misses; provenance — AI-generated lines visually distinct from clinician edits, and an "AI-assisted, doctor-reviewed" line on the printed Rx.

`esc()` is preserved as the design system's safe-render primitive.

### Consequences

- **One print renderer** ends the byte-drift class of bugs; the printed A4 is defined once.
- **The doctor's UI becomes a symmetric actor:** every action is a command, so the autonomous AI layer (ADR-110) plugs in without a UI rewrite.
- **Testable, reviewable UI:** components + ports enable component tests and Lighthouse/a11y gates; the prototype's inline-everything pages had none.
- **Migration cost is real:** ~21k LOC of inline logic must be ported into components — but the safety UX is *ported verbatim*, not re-invented, which de-risks the clinical behavior.
- **Build tooling added** (Vite, bundler, component framework) where the prototype shipped raw HTML to GitHub Pages; the deploy target may move from GitHub Pages to a static-bundle host, but the live app remains a static SPA talking to the backend ports.

### Alternatives considered

| Option | Why rejected |
|---|---|
| **Keep self-contained HTML, refactor in place** | Can't eliminate the duplicate print renderer or introduce a client command bus without a framework; inline `fetch` + anon key stays a liability; no component reuse. |
| **Server-rendered pages (SSR)** | The app is an interactive, offline-tolerant, print-heavy clinical pad; an SPA with local state and streaming review fits far better than round-tripping to a server per interaction. |
| **Web Components (no framework)** | Viable but loses the ecosystem (testing, state libs) and the team velocity of a mainstream framework; the design-token + container/presentational split is cleaner in React-class tooling. |
| **Svelte/Vue instead of React** | Acceptable; the decision is "match `ui/`'s chosen framework" — the *architecture* (ports, container/presentational, command bus, design tokens) is framework-agnostic and is what this ADR fixes. |

---

<a id="adr-105"></a>
## ADR-105 — Dose-engine is a sealed pure module; the AI never computes a number that reaches paper

**Status:** Accepted — this is the system's central clinical-safety invariant.

### Context

Dosing errors in the prototype came from **AI mental math**, not from the engine: `web/dose-engine.js` is correct and is the source of truth (memory: `project_dose_engine_is_source_of_truth`). The `sprint-2-saved` branch already ports this to a **745-line pure-TS module** (`supabase/functions/_shared/dose-engine.ts`) exporting `computeDose`, `parseIngredients`, `calculateBSA`, `roundToUnit`, `buildCalcString`, `formatDoseDisplay`, the bilingual maps (`FREQ_EN/HI`, `HINDI_DROPS/ML/TABLETS/UNITS`), and typed `ComputeDoseParams`/`ComputeDoseResult`. It also ships a `compute_doses` tool that lets the LLM batch all drugs through the engine and copy the output **verbatim**. The gap: **no golden parity fixtures** exist to prove the TS port matches the JS original.

A pediatric prescription is the highest-stakes artifact in the system. The open/closed safety boundary must be **structural**, not a prompt instruction the model might ignore.

### Decision

Port `dose-engine.ts` into **`core/` as the sealed pure `DoseEnginePort`** — **zero DOM, zero IO, no fetch, no SQL** (enforced by the `core_no_fetch` / `core_no_sql_literals` fitness rules). The contract:

1. **The AI proposes med + regimen with NO numeric fields.** It selects the drug, formulation, frequency, and duration; it narrates. It supplies *no* mg/ml/drops/tablet count.
2. **The engine computes every number.** From concentration + dosing band + weight/BSA it recomputes mg/ml/drops, rebuilds the R2/R3 bilingual strings and the pictogram, applies per-ingredient **max-single** and **max-daily** caps and therapeutic-range checks, and rounds (syrups → 0.5 ml, drops → 0.1 ml, tablets → ¼ tab).
3. **The server re-checks byte-for-byte.** A `DosingPort` anti-corruption recompute runs on the worker; **no tolerance** — a 20 % client override is rejected. Any mismatch → flag `REVIEW REQUIRED`.
4. **TDD gate (mandatory before trust):** **golden JS↔TS parity fixtures (≥ 20 cases)** covering rounding (syrups/drops/tablets), caps, therapeutic-range edges, and bilingual strings. This closes the `sprint-2-saved` gap and is a merge blocker (`09_engineering_discipline/`).

The same source-of-truth discipline applies to growth z-scores via a deterministic `GrowthEnginePort` (WAZ/HAZ/WHZ/HCZ) — the AI never computes a z-score either.

### Consequences

- **The AI cannot put a wrong number on paper** — structurally, because it never emits one. This is the single most important safety property in the system.
- **`REVIEW REQUIRED` is a real, earned state**, not advisory: any AI/engine/server disagreement surfaces to the `<SafetyPanel>` and gates `SignOff` (ADR-104 `applySignoffGate`).
- **Determinism enables exhaustive testing:** the engine is pure, so golden fixtures + property tests fully characterize it; the eval suite can assert "dosing within rounding rules" over a frozen pediatric fixture set.
- **The `compute_doses` tool stays** as the AI↔engine bridge, but the engine — not the model — is authoritative; the model copies engine output verbatim and routes failures to `omitted_medicines[]`.
- **Cost:** writing and maintaining the golden parity fixtures, and keeping the JS original and TS port in lockstep until the JS page is retired. Accepted — the fixtures *are* the trust.

### Alternatives considered

| Option | Why rejected |
|---|---|
| **Let the AI compute doses with strong prompt guardrails** | This is the prototype's failure mode; prompts are not a safety boundary. Disqualified by the memory note and the live error class. |
| **AI computes, engine only validates (advisory)** | Still lets a wrong number reach the review screen and risks rubber-stamping; the engine must *produce* the number, not merely check it. |
| **Engine in an adapter / service call** | Adds IO and a failure mode to the single most safety-critical computation; a pure `core/` module is faster, deterministic, and trivially testable. Network on the dose path is unacceptable. |
| **Trust the TS port without parity fixtures** | The `sprint-2-saved` state — and exactly the gap we must close. "It looks the same" is not a clinical guarantee. |

---

<a id="adr-106"></a>
## ADR-106 — All model configuration behind one `ModelPolicyPort`; per-task model policy; ban model-ID literals in business code

**Status:** Accepted.

### Context

**A hardcoded dated model string retired and broke production.** The prototype hardcodes the model inside the Edge Function (`generate-prescription/index.ts` ~L518). When a dated model ID is deprecated, every call site 404s. Beyond that single failure: model selection, effort/thinking config, fallback policy, and pricing assumptions are scattered, so cost and behavior are unauditable and un-tunable.

Verified current Claude facts (claude-api skill, June 2026) the policy must encode:

| Model | ID | Input / Output $ per MTok | Context | Notes |
|---|---|---|---|---|
| Claude Opus 4.8 | `claude-opus-4-8` | $5 / $25 | 1M (128K out) | Correctness-sensitive default for generation. |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | $3 / $15 | 1M (64K out) | Tier-downgrade fallback; summaries. |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 | 200K (64K out) | Lookup/format; OCR-structuring default. |

API surface facts that constrain the policy (do not regress): Opus 4.8 takes **`thinking:{type:"adaptive"}` only** (`budget_tokens` → 400; `temperature`/`top_p`/`top_k` → 400); `effort` lives **inside `output_config`** (`low|medium|high|max`, default `high`); **no assistant prefill** (use structured outputs); **streaming is mandatory** above ~16 K `max_tokens`; **prompt-cache minimum prefix is 4096 tokens on Opus 4.8** (2048 on Sonnet 4.6 / Haiku 4.5). Opus 4.8 **under-reaches for tools by default** → tool descriptions must carry prescriptive "Call this when…" triggers.

### Decision

Put **all** model configuration behind **one `ModelPolicyPort`** — a config object, never a literal in business code — and enforce it with the new CI fitness rule **`core_no_model_id_literals`** (no `claude-*` / `us.anthropic.*` string outside the model adapter). Per-task policy:

| Task | Model | Effort / Thinking | Rationale |
|---|---|---|---|
| **Prescription generation** | `claude-opus-4-8` | `output_config.effort:"high"`, `thinking:{type:"adaptive"}` | Correctness-sensitive; speculative async (ADR-102) absorbs latency, so the old Sonnet+low-effort speed hack is unnecessary. Add "Call this when…" triggers to tool descriptions + a search-first nudge (Opus 4.8 under-reaches). `max_tokens ~16 000+` → **MUST stream**. |
| **Visit summary** | `claude-haiku-4-5` (or `sonnet-4-6`) | `effort:"low"` | Bounded ~250-word summary. |
| **OCR structuring** | `claude-haiku-4-5` default → escalate to `claude-sonnet-4-6` on low-confidence / schema-invalid | per DIS ADR-007 | Reuse the proven pattern. |
| **Drug/protocol lookup** | `claude-haiku-4-5` | `effort:"low"` | Format/lookup only. |

**Fallback = model-tier downgrade**, not same-model retry: Opus 4.8 → Sonnet 4.6 on overload/5xx/timeout, **with a `stop_reason:"refusal"` guard before reading `content[0]`**, backoff+jitter on 429/5xx. A clinical model-class downgrade is **always flagged**, never silent. For same-model provider failover, a Bedrock/Vertex secondary path is the safest. The port also owns prompt-caching placement (ADR-102) and per-call token/cost accounting written to the audit trail.

### Consequences

- **The model-retirement failure class is eliminated:** swapping a deprecated ID is a one-line config change behind the port, and `core_no_model_id_literals` guarantees no stray literal survives.
- **Cost and behavior become auditable and tunable per task** — the policy table is the single place to reason about $/quality tradeoffs, and every call records the model + version actually used.
- **API-fact regressions are designed out:** the port encodes "adaptive-only / no sampling params / must-stream / prompt-cache breakpoint" so an engineer can't accidentally send `budget_tokens` to Opus 4.8 (a 400).
- **Fallback is principled:** tier-downgrade preserves *availability* while *flagging* any clinical model-class change, satisfying both uptime and safety review.
- **Commitment:** new LLM call sites must go through `ModelPolicyPort`; adding a task means adding a policy row, not a literal.

### Alternatives considered

| Option | Why rejected |
|---|---|
| **Hardcoded dated model strings (status quo)** | Caused the production outage this ADR exists to prevent. |
| **A single global model for everything** | Wastes money on lookups (Opus for a 250-word summary) or under-powers generation (Haiku for dosing reasoning); per-task policy is the right granularity. |
| **Same-model single-shot fallback (prototype)** | Existed only to survive the 150 s wall (ADR-101) and doesn't help on overload/refusal; tier-downgrade-with-flag is the principled replacement. |
| **Auto-downgrade clinical model silently to cut cost** | Unacceptable on a clinical path — any model-class change on a prescription must be flagged and auditable. |

---

<a id="adr-107"></a>
## ADR-107 — DDD bounded-context Postgres schemas; migrations-only; server-side IDs; real RLS; append-only audit

**Status:** Accepted — supersedes the prototype's flat, client-trusting schema.

### Context

The prototype schema has eleven critical flaws, the load-bearing ones being: **client-side ID allocation** (`MAX(seq)+1` UHID race), a **blanket `authenticated_full_access` RLS policy over an anon key** (no real authorization; the single biggest DPDP/NABH/CERT-In liability), **no append-only audit / no immutability** on signed prescriptions, **app-only enforcement of the prescriptions↔visits relationship** (no composite FK), **no async generation state**, free-text terminology codes, and a **destructive monolith migration** (`drop table … cascade`). It also carries mojibake (`â€"` em-dash corruption) in formulary/std-Rx JSON. DIS already proves the fixes on-branch (M002 append-only-audit triggers, M006 `legacy` backfill convention, M007 abort-on-duplicate, M008 portable RLS via `current_setting`).

### Decision

Model the database as **DDD bounded-context Postgres schemas**, migrations-only (dbmate; ADR-103), with the safety properties baked into DDL:

- **Schemas:** `catalog` (formulary, standard_prescriptions, terminology `concepts`), `clinical` (patients, visits, vitals, lab_results, growth_records, vaccinations, dev_screenings), `prescribing` (rx_drafts, prescriptions, safety_checks, rx_versions, rx_generation_jobs, prescription_audit), `identity` (practitioners, users, roles, facility), `abdm` (care_contexts, consent_artefacts, fhir_bundles, outbox, inbox), `ops` (jobs, cost_ledger, audit_log, idempotency, outbox).
- **Every mutable table:** `id uuid` surrogate PK, `created_at`, `updated_at`, `version int` (optimistic lock → 409 `VersionConflictError`), `correlation_id`, `facility_id` (multi-site + RLS scope). **UHID/receipt are UNIQUE business columns, not PKs.**
- **Server-side ID allocation** (kills the client-side race): `clinical.uhid_counter(fy_code, month, last_seq)` via `UPDATE … RETURNING` under row lock, exposed through a `SECURITY DEFINER` function. Same for receipt/token. **Delete all client-side allocation.**
- **Real RLS** (replaces the blanket anon-key policy): portable `current_setting('app.role' / 'app.doctor_id' / 'app.facility_id')` set from the JWT at request start (the DIS M008 pattern — runs on Supabase *and* RDS). Roles: `reception`, `nurse`, `doctor`, `service`, `admin`. **NO DELETE policy** on clinical/audit tables. The anon key never touches clinical schemas.
- **Append-only audit + immutability:** `ops.audit_log` with BEFORE UPDATE/DELETE triggers that raise (DIS M002). Signed prescriptions immutable; edits → new rows in `prescribing.rx_versions`; a content hash on the signed Rx for tamper-evidence.
- **Async generation state:** `prescribing.rx_generation_jobs` (ADR-102) + `prescription_audit` (one row per generation attempt incl. retries/fallback: `meta_mode`, `stop_reason`, tokens, rounds, `tools_called[]`, requested/emitted/omitted/added, `severity_*`, `warnings[]`, `duration_ms`; ported from `sprint-2-saved`) + `ops.outbox`.
- **Composite FK** `(visit_id, patient_id) REFERENCES visits(id, patient_id)` so the DB — not app code — enforces prescription↔visit consistency.
- **Terminology integrity:** `catalog.concepts(system ∈ ICD10/SNOMED/LOINC, code, display)` with FKs from drugs/diagnoses/labs; `standard_prescriptions` UNIQUE `(icd10, category, severity)`; codes validated on write; **`pg_trgm` GIN** on `standard_prescriptions.diagnosis_name` for fuzzy matching.
- **Formulary as a governed, contract-tested KB:** keep JSONB for genuinely polymorphic `dosing_bands`/`formulations`, but add the validated columns/CHECKs the dose engine relies on + an **Ajv `formulary.v1.json`** enforced in CI and at write time; six-eye review provenance (verified vs placeholder).
- **Forward-only migrations only** — never the `drop table … cascade` the prototype ships.

**Migration of current data (forward-only, reversible, abort-on-duplicate):** baseline from `sprint-2-saved`'s `20260428000000_baseline_from_live.sql` → ETL-clean the JSON (fix mojibake, dedupe ICD-10, split verified/placeholder, map free-text codes to `concepts`) → backfill clinical with `verification_status='legacy'` (DIS M006) → uuid surrogates retaining UHID as business key → dry-run dedupe abort-on-duplicate (DIS M007) → reconcile `prescriptions.patient_id` drift against `visits` before adding the composite FK → cutover making FKs/constraints mandatory only after rollout (DIS M009). Roll in the justified `fix/io-indexes:migration_io_indexes.sql` (verify no dupes vs baseline). 530 drugs / 446 protocols stay as idempotent seed scripts.

### Consequences

- **The biggest compliance liability is gone:** real per-role RLS over a JWT replaces blanket-anon access; the anon key can no longer read clinical data. (Detail in `08_security/`.)
- **Data integrity moves into the database:** server-side counters end the UHID race; the composite FK ends prescription↔visit drift; append-only triggers make signed prescriptions tamper-evident and audit complete — all enforced by the DB, not hopeful app code.
- **Generation is observable and billable:** `rx_generation_jobs` + `prescription_audit` give per-attempt traceability (model used, tokens, cost, severity, tools) that satisfies NABH and feeds the eval suite.
- **Migration is safe and reversible:** the `legacy` backfill + abort-on-duplicate + late-cutover sequence means we never destroy live data and can roll back at each step.
- **Cost:** more schemas, more constraints, an ETL pass for mojibake/dedup, and the discipline of migrations-only — accepted as the price of a clinical-grade datastore.

### Alternatives considered

| Option | Why rejected |
|---|---|
| **Keep the flat schema + blanket RLS** | The central DPDP/NABH/CERT-In liability; client-trusting and unauditable. Non-starter for patient data. |
| **Single `public` schema, no bounded contexts** | Loses the DDD seams that make ownership, RLS scoping, and the ABDM/clinical separation legible; bounded-context schemas are cheap and clarifying. |
| **App-layer authorization instead of RLS** | A single missed check leaks PHI; RLS enforces at the row, survives a buggy query, and is portable (Supabase + RDS) via `current_setting`. |
| **Soft-delete / mutable signed prescriptions** | Violates NABH auditability and tamper-evidence; immutability + `rx_versions` is the only defensible model for a signed clinical record. |
| **Big-bang destructive migration (prototype's `drop … cascade`)** | Risks live patient data with no rollback; forward-only + `legacy` backfill + late cutover is the safe path DIS already proves. |

---

<a id="adr-108"></a>
## ADR-108 — ABDM/FHIR generation off-edge & event-driven; pure `FhirCompositionPort`; JWS-signed QR

**Status:** Accepted.

### Context

The prototype has a strong R4 builder (`generate-fhir-bundle`, ~1680 LOC) but it is **coupled to the DB** (re-fetches the formulary per call → N+1) and the **QR verification hash is forgeable** (a 6-char client salt; `verify.html` trusts client-rendered data, and the QR URL leaks PHI via `api.qrserver.com`). ABDM work is also blocked on baked-in placeholders (`HOSPITAL.hfr_id=""`). FHIR/ABDM generation must never block clinical sign-off, and the gateway must be treated as a hostile external dependency.

### Decision

**ABDM/FHIR generation runs off-edge and event-driven** (ADR-101): `PrescriptionSigned` → async handlers build and push; **sign-off never blocks on it**. Concretely:

- Port the NRCeS R4 builders into a **pure `FhirCompositionPort` adapter (`NrcesR4Adapter`)** that **takes data, not a DB** — kills the N+1 — and add DocumentReference + Composition narrative + `Bundle.signature` + a FHIR-validator CI gate.
- New ports: **`AbdmGatewayPort`** (session/auth, `on-*` callbacks, `pushHealthInformation`, consent), **`CryptoBoxPort`** (**Fidelius — Curve25519 Short-Weierstrass, NOT libsodium Montgomery**; plaintext gated behind a double-locked sandbox flag), **`SignaturePort`** (**ES256 JWS** — replaces the forgeable client-salt hash; `verify.html` calls a read-only server endpoint, **no PHI in the QR URL**, QR rendered client-side — drop `api.qrserver.com`).
- Real gateway request-auth: verify JWS against the **ABDM CM JWKS** + timestamp/nonce — **fail closed**. `abdm_outbox`/`abdm_inbox` for reliable callbacks.
- **Sequencing:** **M1 (ABHA at registration, V3 API) → M2 (HIP push: OPConsultation / Prescription / DiagnosticReport / ImmunizationRecord) first**; **defer M3 (HIU)**.
- **Prereqs to config/secrets (not source):** HFR ID + HPR ID (the baked-in `HOSPITAL.hfr_id=""` is a release blocker; it moves behind `SecretsPort`/`ConfigPort`).

### Consequences

- **Sign-off latency is decoupled from ABDM:** a slow or down gateway can never delay the doctor; bundles build and push asynchronously off the `PrescriptionSigned` event.
- **The N+1 is gone:** a pure `FhirCompositionPort` takes already-loaded data, so bundle building is fast, deterministic, and unit-testable with fakes.
- **QR is no longer forgeable:** ES256 JWS + a read-only server verify endpoint replaces the client-salt hash, and PHI leaves the QR URL entirely — closing a real privacy hole.
- **Crypto correctness is explicit:** the `CryptoBoxPort` enforces Fidelius (Curve25519 **Short-Weierstrass**, not Montgomery) — a subtle interop trap called out so an implementer can't reach for libsodium by default.
- **Reliable callbacks:** `abdm_outbox`/`abdm_inbox` give at-least-once delivery and an audit trail for the gateway's async `on-*` callbacks.
- **Cost/scope:** ABDM is sequenced (M1→M2, defer M3) so we ship value (ABHA + HIP push) before the heavier HIU consent flows; HFR/HPR onboarding is a real external prerequisite, now surfaced as config, not buried in source.

### Alternatives considered

| Option | Why rejected |
|---|---|
| **Synchronous FHIR/ABDM at sign-off (prototype shape)** | Couples clinical latency to an external gateway; a gateway hiccup blocks the doctor. Unacceptable. |
| **Keep the DB-coupled bundle builder** | The N+1 formulary re-fetch makes it slow and hard to test; a pure data-in adapter is faster and unit-testable. |
| **Keep the 6-char client-salt QR hash** | Forgeable and leaks PHI in the URL; ES256 JWS + server verify is the only defensible scheme for a clinical QR. |
| **libsodium/Montgomery for the crypto box** | Wrong curve form for ABDM Fidelius interop (Short-Weierstrass Curve25519); would silently fail against the gateway. |
| **Build HIU (M3) first** | HIU consent flows are heavier and less immediately valuable than ABHA-at-registration + HIP push; sequencing M1→M2 first delivers compliance value sooner. |

---

<a id="adr-109"></a>
## ADR-109 — Service boundaries: bounded contexts as modules in one monorepo (modular monolith), not microservices

**Status:** Accepted.

### Context

The system has clear DDD seams — Registration/Patient, Clinical Capture, Document Ingestion, Generation, Job Queue/Realtime, ABDM, Dose-Engine, Print/Output — and a natural temptation to deploy each as a separate service. But this is a **single-hospital POC** with one small team; premature distribution would add network hops, distributed-transaction pain, and ops overhead for no scaling benefit. DIS already demonstrates that a bounded context can live as a clean hexagon *inside* one repo and still be independently testable and (later) extractable.

### Decision

Organize the backend as **bounded contexts = modules in one monorepo (a modular monolith)**: each context is its own hexagon (`core` / `ports` / `adapters` / `__fakes__`), all cross-context interaction flows through the **CommandBus → EventBus** (ADR-110), and the **only** out-of-process split is **the off-edge worker tier** (ADR-101) for long-running compute. The nine contexts:

1. **API Gateway (Hono):** correlation-id, idempotency (`Idempotency-Key` mandatory on writes), error-envelope `{error:{code,message,correlation_id,retryable}}`, kill-switch (503 on writes; DIS ADR-003), rate-limit, CORS **locked to the GitHub-Pages origin, not `*`**; `createServer()` returns a fresh instance per call (test isolation).
2. **Registration & Patient:** patients, visits, UHID `RKH-<FY4><MM2><SEQ5>` (regex `^RKH-\d{11}$`, 4-digit FY code), demographics, allergies, neonatal auto-activation, DPDP guardian-consent capture.
3. **Clinical Capture:** vitals, growth z-scores via `GrowthEnginePort`, labs, vaccinations (IAP/NHM mutual exclusivity).
4. **Document Ingestion:** DIS adopted as-is — OCR → **staged** `ocr_extractions`, never direct-write to clinical tables; promotion via the single `promotion.ts` command behind a confidence gate.
5. **Generation Worker (critical path):** off-edge tool-use loop; `RequestGeneration` from doctor click OR speculative trigger OR future AI agent (symmetric); streams events; writes `rx_generation_jobs` + `prescription_drafts`; hosts `ClinicalKnowledgePort` tools and the `DosingPort` recompute.
6. **Job Queue & Realtime/Notify:** Postgres queue (POC) → SQS (prod); SSE relay + status-row projection; outbox dispatch.
7. **ABDM Service:** anti-corruption around the gateway (ADR-108 ports).
8. **Dose-Engine Service:** the sealed pure `DoseEnginePort` (ADR-105) — AI proposes, engine recomputes, server re-checks, mismatch → `REVIEW REQUIRED`.
9. **Print/Output:** the deterministic 4-row + SVG renderer and the signed-QR verify endpoint.

Boundaries are drawn so that **any context can later be extracted to its own service** by promoting its bus interaction to a network call — the seams are real even though the deploy unit is one.

### Consequences

- **No premature distribution:** one deploy unit + one worker tier means no distributed transactions, no inter-service network failure modes, and far less ops surface for a single-site POC.
- **Seams are real, not cosmetic:** because every cross-context call goes through the bus and each context is a self-contained hexagon with fakes, extraction to a microservice later is mechanical, not a rewrite.
- **Test isolation by construction:** `createServer()` per call + fakes-only core suites keep tests fast and independent (DIS proves this).
- **The gateway is the single choke point** for idempotency, error-envelope, correlation-id, kill-switch, rate-limit, and CORS — applied uniformly instead of per-page like the prototype.
- **Commitment:** contexts must not reach into each other's tables or core; cross-context coupling is a bus message or it's a bug. CI fitness rules + code review enforce the boundary.

### Alternatives considered

| Option | Why rejected |
|---|---|
| **Microservices per context now** | Network hops, distributed transactions, and ops cost with zero scaling benefit at single-hospital volume; the off-edge worker is the only split that earns its keep. |
| **One undifferentiated app (no bounded contexts)** | Loses the DDD seams that make ownership, RLS scoping (ADR-107), and the symmetric-actor bus (ADR-110) legible; re-creates the prototype's tangle. |
| **Serverless-function-per-endpoint** | Re-introduces the edge constraints (ADR-101) and fragments cross-cutting concerns (idempotency, audit) across dozens of functions. |
| **Separate the dose engine into its own service** | Adds network on the most safety-critical, latency-sensitive computation; it belongs in `core/` as a pure module (ADR-105), not behind a wire. |

---

<a id="adr-110"></a>
## ADR-110 — A single CommandBus → EventBus; humans and AI are symmetric actors

**Status:** Accepted — this is the seam that makes "AI-first" an additive layer, not a rewrite.

### Context

The product's strategic bet is that an autonomous **"AI-drafts-then-doctor-signs"** mode should be an *additive subscriber*, not a second system. That only works if **every mutating action — doctor edit, nurse approve, system auto-approve, future AI agent — has the same shape**. DIS already has the state-machine and event pieces (`core/state-machine.ts`'s pure `transition(state, event)` that throws on invalid transitions and is never persisted on a bad path) but **no general command bus yet** — building it is the single most important net-new construct.

### Decision

Introduce **one CommandBus → EventBus** as the spine of every mutation, on both server (`core/command-bus`) and client (ADR-104):

- **Every mutating action emits the same `Command` shape** to one bus; results are domain `Event`s; read models are **CQRS projections**.
- **The generation flow is actor-agnostic:** `DraftNoteUpdated` (autosave) and `RequestGeneration` (click | speculative | AI agent) are **indistinguishable commands** → worker → events → `rx_generation_jobs` + `prescription_drafts`. The worker cannot tell — and must not care — whether a human or an agent issued the command.
- **Clinical-safety invariant:** an AI draft is `pending_review` until a human `SignOff` command — **identical fail-closed gating to OCR `promotion.ts`** (DIS CS-1/CS-7).
- **The pure `state-machine.ts` `transition(state, event)` is the safety spine:** invalid transitions throw and are **NEVER persisted**; even failure paths route through `transition()`. States: `note_captured → generating → streaming → draft_ready → doctor_editing → signed → printed` (+ `superseded`, `failed`).
- **Going AI-first later = an additive subscriber** that emits `RequestGeneration` + `SignOff` autonomously — **no rewrite**.
- **Bus benefits accrue everywhere:** audit-by-construction (every command is a logged event), optimistic UI, and **dedup that fixes the 3× `raw_dictation` write**.

### Consequences

- **AI-first is a feature flag, not a project:** because human and agent commands are identical, enabling autonomous drafting is adding a subscriber that emits the same commands — the existing pipeline, safety gate, and audit trail apply unchanged.
- **Safety is enforced by a pure function, not by discipline:** `transition()` is total, throws on invalid input, and never persists a bad transition — the same property DIS already relies on. An AI draft *cannot* reach `signed` without a human `SignOff` command.
- **Audit and dedup come for free:** every state change is a command→event pair, so the audit log (ADR-107) is complete by construction and the duplicate-write bugs of the prototype are deduplicated at the bus.
- **CQRS read models** (e.g. `rx_generation_jobs`, today's-patients) are projections off the event stream, decoupling read shapes from write models.
- **Cost/discipline:** the command bus is genuine net-new infrastructure (command envelopes, an event store/outbox, projections) and every mutation must go through it — a `prescriptions` row written by a stray `INSERT` outside the bus is a bug that breaks audit and the symmetric-actor guarantee. Code review + the audit triggers (ADR-107) backstop this.

### Alternatives considered

| Option | Why rejected |
|---|---|
| **Direct service calls / CRUD per action (prototype)** | No uniform shape for actions → an AI actor needs its own parallel pathway → "AI-first" becomes a rewrite. Also no audit-by-construction, hence the 3× write bug. |
| **Bolt an AI agent onto the existing UI later** | Without a command bus the agent must replicate the UI's mutation logic and safety gates — duplicated, divergent, and dangerous. The whole point of this ADR is to make that unnecessary. |
| **Event sourcing for the entire datastore** | Full event sourcing is heavier than needed; we use a CQRS-lite command/event bus + outbox over a relational system of record (ADR-107), which gives audit and symmetry without rebuilding all reads as fold-over-events. |
| **A workflow/orchestration engine (Temporal, etc.)** | Over-engineered for a single-hospital POC; the pure `transition()` state machine + Postgres queue + outbox deliver durable, auditable state transitions with far less operational weight. |

---

## Cross-cutting invariants (what every ADR above must keep true)

These are the non-negotiables the ten decisions jointly guarantee; reopening any ADR must preserve all of them:

1. **The AI never computes a number that reaches paper** (ADR-105) — and never computes a z-score, a corrected age, or a UHID either (ADR-104 client pre-compute, ADR-107 server allocation).
2. **Every draft is doctor-reviewed and signed; nothing auto-finalizes** (ADR-102, ADR-110).
3. **`core/` stays pure** — no fetch, no SQL, no adapter imports, no model-ID literals — and CI proves it on every merge (ADR-103, ADR-106).
4. **The anon key never touches clinical schemas; authorization is real RLS over a JWT** (ADR-107).
5. **Clinical sign-off never blocks on an external dependency** (ABDM/FHIR is async; ADR-108).
6. **Humans and AI emit identical commands** so the autonomous mode is additive (ADR-110).
7. **The whole thing flips Supabase → AWS by `DIS_STACK`** because vendor code lives only in adapters chosen at the wiring root (ADR-103, ADR-101).
