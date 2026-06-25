# AI Orchestration — Target-State Rebuild Specification

> **Scope.** This document is the production-grade target-state design for the **Generation bounded context** of the rebuilt Radhakishan pediatric OPD prescription system: the AI Rx-generation pipeline end to end — model strategy and centralized config, tool-use / progressive disclosure, prompt caching, streaming, fallbacks and timeouts, the dose-engine separation boundary, token/latency budgets, and generation observability.
>
> Build to **this**, not to the current `web/` + Edge-Function prototype. Where this spec and the upstream prototype disagree, this spec wins. It is consistent with, and subordinate to, the TARGET-ARCHITECTURE DIGEST §1–§10; this is the §6 "AI Orchestration" expansion with the latency design (§2) and command-bus seam (§9) wired in.
>
> **Status:** TARGET STATE. **Authority for model/API facts:** the `claude-api` skill (verified this session, 2026-06). **Non-negotiable safety invariant:** the deterministic dose engine is the sole arithmetic authority; the AI never computes a number that reaches paper, and every AI draft is `pending_review` until a human `SignOff`.

---

## 0. Why this is being rebuilt (the load-bearing flaw)

The prototype runs the Claude tool-use loop **synchronously inside a Supabase Edge Function with a hard 150 s wall-clock**. Generation takes 50–150 s; logs show `504`/`546` at exactly `150,000 ms`. Doctors wait up to five minutes and frequently see an infinite spinner. Every "speed hack" in the prototype exists only to survive that wall:

| Prototype symptom (current `supabase/functions/generate-prescription/index.ts`) | Root cause | Target-state fix |
|---|---|---|
| `model: "claude-sonnet-4-6"` **hardcoded** at the API call site (line 518) | No central model config → the model retirement that broke prod | `ModelPolicyPort` config object; CI rule `core_no_model_id_literals` (§3) |
| `thinking: { type: "disabled" }`, `output_config: { effort: "low" }` | Trading correctness for latency to beat 150 s | Off-edge worker absorbs latency → `claude-opus-4-8`, `effort:"high"`, adaptive thinking (§3) |
| `AbortController` aborting the whole loop at `120_000 ms` | The 150 s ceiling | Persistent worker; deadlines become UX states, not request kills (§6) |
| `extractJSON()` regex slicing `{ … }` out of free text | No structured-output contract | `output_config.format` + Ajv schema validation (§4.4) |
| `singleShotFallback()` re-sending the full skill on loop failure | Loop failures = edge timeouts | Streaming + model-tier downgrade fallback (§6); same-model single-shot retired |
| `max_tokens: 8192` | Edge couldn't afford more | `max_tokens` ≥ 16000, streaming mandatory (§5) |
| `MAX_TOOL_LOOPS = 10` + repeated-call guard, logged via `console.log` | Survival guard, not observability | Typed, audited loop-cap events to `generation_events` (§7) |

**The fix is structural, not parametric:** move the tool-use loop **off-edge** onto a long-lived Hono/Cloud-Run worker pulling from a durable Postgres queue, drive it with **speculative background generation + streaming**, and make every clinical-safety property a state-machine invariant rather than prompt text.

---

## 1. Target latency design — perceived wait ≈ 0

Four compounding mechanisms. The headline metric is **doctor perceived wait to a reviewable draft**, target ≈ 0, with a hard rule: **never an infinite spinner, and the draft is ALWAYS doctor-reviewed and signed (never auto-finalized)**.

```
                         ┌────────────────────────────────────────────────────────┐
   Doctor's note         │            GENERATION WORKER (off-edge, Hono/Cloud-Run) │
   autosaves (debounced) │                                                          │
        │                │   pull job ──► tool-use loop (streaming)                 │
        ▼                │     │           client.messages.stream(...)              │
  DraftNoteUpdated ──────┼──►  │           ├─ get_standard_rx (ICD-10 first)        │
  (CommandBus)           │  pg │           ├─ get_formulary  (condensed)            │
        │ debounce       │ queue           ├─ get_previous_rx / get_lab_history     │
        │ + content-hash │     │           ├─ get_reference  (StoragePort)          │
        ▼                │     │           └─ compute_doses  (DoseEnginePort, pure) │
  speculative RequestGeneration            │                                        │
        │                │     └─ emits domain events ──► ops.outbox ──► SSE relay  │
   Doctor clicks Generate│                                                          │
        │                └───────────────────────────────┬──────────────────────────┘
        ▼                                                 │ SSE: GenerationStarted,
   if speculative hash == current note hash:              │ ToolInvoked, DraftDelta,
       open review at 0 ms ("draft — confirm" badge)      │ GenerationCompleted/Failed
   else: "regenerating from your latest note…" inline ◄───┘
```

### 1.1 Off-edge persistent worker
The Claude tool-use loop runs on a **long-lived Node 20 + Hono worker** (the `dis/` `workers/` layer), pulling from a durable Postgres queue (`ops.jobs`, the `dis/` `M004_dis_jobs` pattern: `topic`/`payload`/`status`/`attempts`/`locked_until`/`locked_by` + partial index on ready jobs). This single change deletes the `504`/`546`-at-150 s class. **Delete every timeout/budget/fallback workaround** carried over from the edge prototype — they only existed to survive the wall.

- **POC compute:** Hono container on **Fly.io / Render** (long-lived, holds SSE), queue via pg-cron/pgmq adapter.
- **Prod:** **Google Cloud Run** (60-min request timeout, scale-to-zero, clean SSE) — the boring default; queue → **SQS** by a `DIS_STACK=aws` env flip.
- Supabase keeps Postgres, Auth (real JWT), Storage. Edge Functions, **if kept at all**, are thin signed-webhook receivers that `validate → enqueue → 202` — never the tool-loop host.

### 1.2 Speculative / background generation
The doctor's note already autosaves (debounced) to `visits.raw_dictation`. Each meaningful save and each section-chip change is a `DraftNoteUpdated` command on the bus → a debounced worker speculatively (re)generates a draft keyed by a **content hash** of `{ note, patient_context_version, selected_sections, schedule (NHM|IAP) }`. **Last-write-wins:** a newer hash supersedes the in-flight run (`superseded` job state). By the time the doctor clicks **Generate**, a fresh `draft_ready` keyed to the current hash usually already exists → review-first open at 0 ms.

> **Debounce policy:** speculative trigger fires `min 4 s` after the last keystroke AND only when the note delta is "meaningful" (a new drug token, a diagnosis/ICD token, a chip change, or ≥ 40 new chars) — not on every character. This bounds speculative API spend; see §5 budgets.

### 1.3 Streaming end-to-end
The worker uses `client.messages.stream(...)` with `.get_final_message()` (`.finalMessage()`) for timeout-protected completion, and emits domain events on a per-job channel: `GenerationStarted`, `ToolInvoked`, `DraftDelta`, `GenerationCompleted`, `GenerationFailed`. The Pad subscribes by `job_id` and renders progressively (diagnosis → meds appear → safety panel). This replaces the prototype's cosmetic `msgs[]` rotator with **real progress**.

### 1.4 Async job + notify + review-first UX
Click Generate → if the speculative hash matches the current note, **open review at 0 ms** with a subtle "draft — confirm" badge while any residual delta streams; if stale, show "regenerating from your latest note…" inline. The `GenerationPort` exposes states `idle | streaming | ready | stale | error | timeout`, an `AbortController` on every request, exponential-backoff retry, and a **hard client deadline → degraded UI** (retry / manual edit / single-shot) — **never an infinite spinner**.

**Notify channel:** SSE per `job_id` (Realtime WebSocket was removed for IO cost). SSE is primary; a short-interval status-row poll (`prescribing.rx_generation_jobs.status`) is the fallback when SSE drops. This is the `RealtimePort` (§3).

---

## 2. Centralized model strategy & config (no hardcoded dated models)

**The retirement that broke prod is a config failure, not a model failure.** Model identity lives behind **one `ModelPolicyPort`** — a config object resolved at boot from validated env. **No `claude-*` string ever appears in business code**, enforced by a CI fitness rule.

### 2.1 `ModelPolicyPort` (the anti-corruption seam around the model vendor)

```ts
// src/ports/model-policy.ts  — interface only, no adapter imports, no model literals
export type GenerationTask =
  | 'prescription'        // correctness-critical, streamed
  | 'visit_summary'       // bounded ~250-word summary
  | 'ocr_structuring'     // document ingestion (dis/ context)
  | 'drug_lookup';        // format/lookup only

export interface ModelChoice {
  readonly model: string;                 // resolved at the edge of the system, never literal in core
  readonly effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  readonly thinking: { type: 'adaptive' } | { type: 'disabled' };
  readonly maxTokens: number;
  readonly stream: boolean;
  readonly downgradeTo?: GenerationTask['']; // tier-downgrade target task key (resolves to another ModelChoice)
}

export interface ModelPolicyPort {
  /** Primary choice for a task. */
  choose(task: GenerationTask): ModelChoice;
  /** Next-cheaper tier for overload/5xx/timeout fallback (§6). null = no further downgrade. */
  downgrade(current: ModelChoice): ModelChoice | null;
}
```

The **only** place model id strings exist is a config map loaded by the `wiring/` composition root from `env.schema.ts` (Zod). Rotating a model = changing one env value / config row; no code change, no redeploy of business logic.

### 2.2 Per-task model policy (verified IDs/pricing, `claude-api` skill 2026-06)

| Task | Model (config key) | Effort / Thinking | `max_tokens` | Stream | Rationale |
|---|---|---|---|---|---|
| **Prescription generation** | `claude-opus-4-8` ($5/$25 per MTok, 1M ctx, 128K out) | `effort:"high"`, `thinking:{type:"adaptive"}` | **16000+** | **Yes (mandatory)** | Correctness-sensitive. Speculative async absorbs latency → the prototype's Sonnet+`effort:low` speed hack is unnecessary. Opus 4.8 under-reaches for tools by default → prescriptive "Call this when…" tool descriptions + a search-first nudge (§4.5). `max_tokens` ≥ 16000 ⇒ **must stream** (SDK refuses non-streaming above ~16K). |
| **Visit summary** | `claude-haiku-4-5` ($1/$5) — or `claude-sonnet-4-6` | `effort:"low"` | 1024 | No | Bounded ~250-word summary for returning patients. PII-stripped input. |
| **OCR structuring** | `claude-haiku-4-5` default → escalate to `claude-sonnet-4-6` on low-confidence / schema-invalid | per `dis/` ADR-007 | 4096 | No | Reuse the `dis/` document-ingestion structuring pattern unchanged. |
| **Drug / protocol lookup** | `claude-haiku-4-5` | `effort:"low"` | 2048 | No | Format/normalize only; deterministic. |

### 2.3 Verified API-surface facts (do not regress)

- **Opus 4.8 / 4.7 take `thinking:{type:"adaptive"}` only.** `thinking:{type:"enabled", budget_tokens:N}` → **400**. `temperature` / `top_p` / `top_k` → **400** (removed). Steer with prompting + `effort`.
- **`effort` lives inside `output_config`**, not top-level. Values `low|medium|high|xhigh|max`; default `high`.
- **No assistant prefill** on Opus 4.6+/Fable 5 → use structured outputs (`output_config.format`) to constrain JSON, never a prefill.
- **Streaming is mandatory for large `max_tokens`** — the SDK refuses non-streaming requests above ~16K. Use `client.messages.stream(...).get_final_message()` for timeout-protected completion even when consuming the final message whole.
- **`stop_reason: "refusal"` guard** — check `stop_reason` before reading `content[0]`; `stop_details` is `null` unless refusal.

### 2.4 CI fitness rule — `core_no_model_id_literals`

Extends the `dis/` `scripts/fitness-rules.json` set (which already enforces `core_no_adapter_imports`, `ports_no_adapter_imports`, `core_no_fetch`, `core_no_xhr`, `core_no_sql_literals`, `supabase_sdk_only_in_supabase_adapters`). Merge-blocking:

```json
{
  "name": "core_no_model_id_literals",
  "description": "Business code must not hardcode a Claude model id; resolve via ModelPolicyPort.",
  "glob": "src/{core,http,workers,adapters}/**/*.ts",
  "glob_exclude": ["src/adapters/model/**", "src/wiring/**"],
  "forbidden_pattern": "claude-(opus|sonnet|haiku|fable|mythos)-",
  "message": "No hardcoded model id in business code — use ModelPolicyPort (spec §2)."
}
```

> This rule, on the prototype, would have failed `index.ts:518` and prevented the production breakage outright.

---

## 3. Generation bounded context — ports & composition

The Generation context is a hexagon (`core / ports / adapters / __fakes__`), copied wholesale from the `dis/` skeleton. Every action enters through the **CommandBus** and produces **Events**; the worker is a symmetric subscriber (§9).

### 3.1 Ports (the narrow waist — interfaces only, no adapter imports)

| Port | Responsibility | Adapters | `__fake__` |
|---|---|---|---|
| `ModelPolicyPort` | Resolve model/effort/thinking/maxTokens per task; tier-downgrade (§2) | config-backed | static map |
| `GenerationPort` | Stream a generation; expose states `idle\|streaming\|ready\|stale\|error\|timeout`; `AbortController` per request | Anthropic SDK adapter | canned event stream |
| `ClinicalKnowledgePort` | The 5 tools: `get_formulary`, `get_standard_rx`, `get_previous_rx`, `get_lab_history`, `get_reference` | `DatabasePort`/`StoragePort`-backed | fixture rows |
| `DoseEnginePort` | Pure deterministic dose computation (the safety boundary, §4.6) | the 745-line TS port, zero IO | golden fixtures |
| `DatabasePort` | Parameterized SQL only; RLS session vars; read models + audit writes | `postgres` (porsager) / Supabase / RDS | in-memory |
| `StoragePort` | Skill `.md` reference files | Supabase Storage / S3 | fixture files |
| `QueuePort` | Durable job pull/ack/nack; `superseded`; retries | pg-cron/pgmq → SQS | array queue |
| `RealtimePort` | SSE per `job_id` + status-row projection | SSE relay | event emitter |
| `SecretsPort` | `ANTHROPIC_API_KEY` etc.; never client-reachable | Supabase secrets → AWS Secrets Manager | env |
| `ObservabilityPort` | `generation_events` / `prescription_audit` / `ops.cost_ledger` writes (§7) | DB-backed | recorder |

### 3.2 Wiring (the only composition root)
`src/wiring/` is the single place adapters are chosen by env (`DIS_STACK`, `DIS_MODEL_POLICY`, `DIS_OCR_PROVIDER`). `core/` is CI-fenced from `fetch`, SQL literals, adapter imports, and model literals.

### 3.3 Env schema (Zod, fail-fast at boot) — extends `dis/` `env.schema.ts`

```ts
// adds to the dis/ baseSchema:
RKH_GEN_MODEL_RX:        z.string().min(1),   // resolved model id for 'prescription'
RKH_GEN_MODEL_SUMMARY:   z.string().min(1),
RKH_GEN_MODEL_LOOKUP:    z.string().min(1),
RKH_GEN_MODEL_OCR:       z.string().min(1),
RKH_GEN_MAX_TOKENS_RX:   z.coerce.number().int().min(16000).default(16000),
RKH_GEN_EFFORT_RX:       z.enum(['high','xhigh','max']).default('high'),
RKH_GEN_LOOP_CAP:        z.coerce.number().int().positive().default(8),
RKH_GEN_HARD_DEADLINE_MS:z.coerce.number().int().positive().default(180000), // worker, not edge
RKH_GEN_SPECULATIVE:     booleanFromString,   // feature-flag the speculative path
ANTHROPIC_API_KEY:       z.string().min(1),
```

The container **fails to boot** if any model env is unset — the model-retirement failure class becomes a boot-time error, never a runtime 500.

---

## 4. Tool-use / progressive disclosure

Keep the proven **5-tool progressive-disclosure design** (Claude fetches only the clinical knowledge it needs), but re-home every tool behind `ClinicalKnowledgePort` with a `__fake__` peer, execute independent tools in **parallel** (`Promise.all`), and add the deterministic `compute_doses` tool from `sprint-2-saved`.

> **Ownership split (orchestration vs substance).** This document owns *how the loop runs* — model policy, caching, streaming, fallback, and the dose-separation **mechanism**. The **content and contracts the loop carries** are owned by the **`05_ai/`** layer: the exact tool `input_schema` + condensed output shapes (`05_ai/tool_contracts.md`), the rebuilt `core_prompt.md` structure + cache-prefix byte layout + pre-embedded NABH block (`05_ai/prompt_system_design.md`), the 11 clinical references + `catalog.clinical_reference` registry (`05_ai/clinical_references.md`), and the worked examples / eval golden cases (`05_ai/worked_examples_and_golden_cases.md`). The `compute_doses` tool delegates to the TS `DoseEnginePort` (C5); its mandatory-when-`medicines[]`-non-empty rule is enforced server-side here (§4.6) and frozen as a contract in `05_ai/tool_contracts.md`.

### 4.1 Tool surface

| Tool | Backing port | Purpose & target-state changes |
|---|---|---|
| `get_standard_rx` | `DatabasePort` | **ICD-10-first** lookup of hospital protocols (`catalog.standard_prescriptions`, UNIQUE `(icd10, category, severity)`). Add `pg_trgm` fuzzy diagnosis-name fallback. |
| `get_formulary` | `DatabasePort` | Drug lookup with `condenseDrugForAI()` token-stripping (strips `indian_brands` ~77% of tokens, SNOMED metadata, null fields). Keep identity/dosing-bands/safety. |
| `get_previous_rx` | `DatabasePort` | PII-stripped past Rx — promote the ad-hoc `.map()` strip into a **typed boundary** (`PreviousRxView`) with no PII fields reachable. |
| `get_lab_history` | `DatabasePort` | Recent `lab_results` with flags; LOINC codes. |
| `get_reference` | `StoragePort` | On-demand `.md` clinical references (11 files). |
| **`compute_doses`** *(new)* | `DoseEnginePort` | **AI batches all drugs, passes full `dosing_bands`, copies engine output verbatim.** This is the arithmetic boundary (§4.6). |

### 4.2 Pre-embed NABH (saves a round)
The NABH compliance block is concatenated onto the cached system prompt at the edge (the prototype already does this with `references/nabh_compliance.md`). Claude never spends a tool round fetching it. This block sits **inside the cached prefix** (§5).

### 4.3 Parallel execution
On a `tool_use` stop, execute all tool blocks concurrently and return **all** `tool_result` blocks in a **single** user message (never split — splitting trains the model to stop making parallel calls). The prototype's `Promise.all` over tool blocks is correct and retained; promote the loop-cap and repeated-identical-call guards to **typed, audited events** (`LoopCapReached`, `RepeatedToolCallSuppressed`) rather than `console.warn`.

### 4.4 Structured outputs — retire `extractJSON`
Replace the brittle `extractJSON()` regex (slice between first `{` and last `}`) with:
- `output_config.format` = `{ type: "json_schema", schema: <prescription.v1.json> }` on the final generation turn, **and**
- **Ajv validation** of the returned JSON against `core/schema/prescription.v1.json` (the bilingual 4-row + pictogram + safety contract). Invalid → `GenerationFailed{reason: schema_invalid}` event + retry-once, never a silently malformed draft.
- `strict: true` on tools whose inputs must validate exactly.
- Structured outputs are **incompatible with citations and assistant prefill** — neither is used here, so this is clean.

### 4.5 Opus 4.8 tool-triggering tuning
Opus 4.8 is conservative about reaching for tools/subagents/memory by default. Counter it where it matters for clinical safety:
- **Prescriptive tool descriptions:** each tool's `description` states *when* to call it ("Call `get_standard_rx` whenever a diagnosis or ICD-10 code appears in the note"), not just what it does. Verified to give measurable should-call lift on 4.8.
- **Search-first nudge** in the system prompt: "When a drug or diagnosis is named, fetch formulary and protocol before composing — do not dose from memory."
- **Mandatory `compute_doses` invocation** when `medicines[]` is non-empty (enforced server-side, §4.6) — the prototype already asserts `tools_called.includes("compute_doses")`.

### 4.6 Dose-engine separation — the open/closed safety boundary

**THE AI NEVER DOES ARITHMETIC.** This is the system's primary clinical-safety invariant.

```
   AI proposes:  drug + formulation + regimen + band selection  (NO numeric mg/ml/drops fields)
        │
        ▼  compute_doses tool  (worker, pure DoseEnginePort)
   DoseEngine.computeDose({ weightKg, heightCm?, ingredients, band, formulation }):
        ├─ recompute mg/ml/drops from concentration + band + weight/BSA
        ├─ apply per-ingredient max-single / max-daily caps + therapeutic-range checks
        ├─ round: syrups → 0.5 ml, drops → 0.1 ml, tablets → 0.25 tab
        └─ rebuild R2 (English) / R3 (Devanagari) bilingual rows + R4 pictogram codes
        │
        ▼  AI copies engine output VERBATIM into medicines[]
        │
        ▼  Server re-check (independent of the tool round)
   Re-run DoseEngine byte-for-byte over the final medicines[]:
        ├─ match  → overall_status = SAFE
        └─ mismatch (no tolerance; reject any 20% client override) → gate outcome:
             overall_status = REVIEW_REQUIRED  (UPPER_SNAKE, stored + wire),  severity_final = high
```

- **Port the 745-line `dose-engine.ts` into `core/` as the pure `DoseEnginePort`** — zero DOM, zero IO. Verified exports this session: `computeDose`, `parseIngredients`, `makeIngredient`, `calculateBSA`, `roundToUnit`, `isSolidForm`, `formatDoseDisplay`, `buildCalcString`, `FREQ_EN`/`FREQ_HI`, `HINDI_DROPS`/`HINDI_ML`/`HINDI_TABLETS`/`HINDI_UNITS`, `DROPS_PER_ML`, and typed `ComputeDoseParams`/`ComputeDoseResult`/`Ingredient`/`IngredientBand`/`IngredientDoseDetail`/`RoundResult`.
- **Source-of-truth split (canonical decision C5):** the **TS `DoseEnginePort` (in `core/`) is the runtime arithmetic authority** — every mg/ml/drop that reaches a draft, the server re-check, or paper comes from here. **`web/dose-engine.js` is the frozen legacy reference / parity oracle, NOT the runtime engine** — the runtime never calls it. It remains the doctor-validated baseline the TS port must match (project memory: *Rx dosing errors come from AI mental math, not the engine*), and the golden-parity gate (below) is what licenses trusting the TS port until the JS is retired.
- **6 dosing methods** preserved: weight-based, BSA, GFR-adjusted, fixed, infusion, age/GA-tier. NEVER exceed max dose.
- **Combo drugs:** dose by the **limiting ingredient**; check all ingredients' max doses (`is_limiting` flag).
- **Preterms:** corrected age for growth/development, chronological for vaccination — computed **client-side** before generation; the AI receives the computed values and does no age arithmetic.
- **GOLDEN-PARITY GATE (mandatory before the engine is trusted — canonical decision C5 / Part C):** **golden JS↔TS parity fixtures**, ≥ 20 cases in `evals/golden/dose_parity/*.fixture.json`. Each fixture's `ComputeDoseParams` is run through **both** `web/dose-engine.js` (the **oracle**) and the `core/` `DoseEnginePort` (the **runtime port**); the TS result MUST equal the JS result **byte-for-byte, zero tolerance**, field-by-field across every output field (`vol`, `enD` R2 English, `hiD` R3 Devanagari, `calc`, `capped`, `warnings[]`, `volumeMl`, `volumeUnits`, `ingredientDoses[]`, and the pictogram codes). The coverage floor MUST include: syrup rounding → 0.5 ml, drops → 0.1 ml, tablets → ¼ tab (0.25), max-single cap clamp, max-daily cap clamp, weight-based + BSA + GFR-adjusted methods, combo-drug limiting ingredient (`ingredientDoses[].is_limiting`), bilingual R2/R3 strings, and preterm corrected-age vs chronological. Any divergence FAILS the dedicated required CI check **`ci/dose-parity`** → merge blocked, engine NOT trusted in generation. `sprint-2-saved` ships the TS port **without** fixtures — closing that gap is a release blocker for the Generation context. The runner is owned by `09_engineering_discipline/testing_strategy.md`; the eval M2 oracle (`09_engineering_discipline/evals_framework.md`) imports `web/dose-engine.js` by design (the oracle, never the TS port — importing the TS port would make the test tautological). **Why zero tolerance:** the server re-check rejects any non-engine number with zero tolerance, so the two engines must be held to the same zero tolerance or the oracle and runtime could silently disagree — a 0.5 ml vs 0.6 ml drift is exactly the silent dosing error this architecture exists to prevent.

---

## 5. Prompt caching, token & latency budgets

### 5.1 Prompt caching (independent of the latency fix; biggest cost + TTFT win)

Render order is `tools → system → messages` and caching is a **prefix match** — any byte change in the prefix invalidates everything after it.

- **Freeze the prefix:** deterministic tool definitions (stable order, sorted), the skill `core_prompt.md`, and the **pre-embedded NABH block** all sit before the breakpoint. `cache_control: { type: "ephemeral" }` on the **last system block**.
- **Volatile content AFTER the breakpoint:** the clinical note, known allergies, `patient_id`, and all `tool_result` blocks.
- **NO silent invalidators in the prefix:** no `Date.now()`, no UUIDs, no per-request IDs, no unsorted `JSON.stringify`, no conditional system sections. (The prototype is already close — it concatenates a stable core + NABH — but the rebuild makes the freeze a tested invariant.)
- **Minimum cacheable prefix on Opus 4.8 = 4096 tokens** — the skill prompt clears this comfortably.
- **Pre-warm** with a `max_tokens: 0` request on worker boot (and on an interval only if traffic gaps exceed the 5-min TTL) — places the cache write on the system prompt block, not on a placeholder user turn.
- **Audit:** `usage.cache_read_input_tokens` must be non-zero across repeated generations. Recorded to `prescription_audit` (§7); a zero-read alert means a silent invalidator regressed into the prefix.

### 5.2 Token budgets

| Lever | Target | Mechanism |
|---|---|---|
| Cached prefix (system + tools + NABH) | ~6–10K tokens, **cache-read** (~0.1× cost) after first call | ephemeral cache, frozen prefix |
| `get_formulary` result per drug | minimized | `condenseDrugForAI()` (strips ~83% — `indian_brands`, SNOMED, nulls) |
| `get_previous_rx` result | clinical-only | typed PII-stripped `PreviousRxView` |
| Output | ≥ 16000 `max_tokens`, streamed | never truncate a draft mid-medicine |
| Speculative spend ceiling | debounce ≥ 4 s + meaningful-delta gate (§1.2); last-write-wins cancels in-flight | bounds background API cost |

Cost per generation is recorded as integer **micro-INR** in `ops.cost_ledger` and on `prescribing.rx_generation_jobs.cost` (§7) — computed from `usage` × the per-MTok rate for the model actually used (Opus 4.8 = $5 in / $25 out).

### 5.3 Latency budgets

| Phase | Target | Notes |
|---|---|---|
| **Doctor perceived wait (speculative hit)** | **≈ 0 ms** | review opens on a pre-generated `draft_ready` keyed to the current note hash |
| Perceived wait (stale → regenerate) | TTFT-bounded; first `DraftDelta` ≤ ~3 s | streaming shows diagnosis/meds progressively |
| Worker end-to-end generation | 50–150 s acceptable (off-edge; no wall) | absorbed by speculation + streaming |
| Hard client deadline | `RKH_GEN_HARD_DEADLINE_MS` (default 180 s) → degraded UI | retry / manual edit / single-shot; **never infinite spinner** |
| Worker job lease | `locked_until` > expected worst case; `superseded` cancels stale speculative runs | queue semantics, not request timeouts |

> **Critical inversion vs prototype:** latency is no longer a *request* constraint (150 s edge wall) — it is a *UX state*. The worker may take as long as correctness needs; the doctor never blocks on it because the draft is usually already there.

---

## 6. Streaming, fallbacks & timeouts (production-grade)

### 6.1 Streaming loop (replaces the same-model single-shot)
The worker drives `client.messages.stream(...)` and translates SDK stream events into domain events on the per-job channel:

```
SDK stream event           →  domain event (ops.outbox → SSE)
message_start              →  GenerationStarted { job_id, model, effort }
content_block_start (text) →  (begin DraftDelta accumulation)
content_block_delta        →  DraftDelta { job_id, text_chunk }       // progressive render
tool_use block             →  ToolInvoked { job_id, tool, input_summary }   // real progress
message_delta (stop_reason)→  (record stop_reason; guard 'refusal')
final message              →  GenerationCompleted { job_id, draft, usage }  // via .get_final_message()
error / abort / deadline   →  GenerationFailed { job_id, reason, retryable }
```

Use `.get_final_message()` / `.finalMessage()` for timeout-protected completion even when the worker consumes the whole message — do **not** hand-roll a `new Promise()` around `.on()` events.

### 6.2 Fallback ladder (model-tier downgrade — replaces same-model single-shot retry)

```
Opus 4.8 (prescription) ──overload(529)/5xx/timeout──► Sonnet 4.6  ──same──► (flag + degraded UI)
        │                                                    │
        │ 429 → backoff + jitter, retry same model           │ stop_reason:"refusal" → guard before content[0],
        │ (SDK auto-retries 408/409/429/5xx ×2)              │   surface refusal, do NOT silently retry same prompt
        ▼                                                    ▼
   ModelPolicyPort.downgrade(current)  ◄────────────────────┘
```

- **Tier downgrade** Opus 4.8 → Sonnet 4.6 on overload/5xx/timeout, **via `ModelPolicyPort.downgrade()`** — never a model literal at the call site.
- **`stop_reason: "refusal"` guard** before reading `content[0]` (empty `content` on pre-output refusal).
- **Backoff + jitter** on 429/5xx (SDK auto-retries 408/409/429/5xx with exponential backoff, default 2 retries; extend via `max_retries` only if needed).
- **Same-model provider failover** (for provider-side outages, not policy refusals): a **Bedrock / Vertex secondary path** is the safest because it keeps the *same* clinical model class. Use the platform client class (`AnthropicBedrockMantle` / `AnthropicVertex`), not a `base_url` override.
- **Clinical-model-class guard:** **never silently downgrade the clinical model class without flagging.** A Sonnet-served prescription draft carries a `model_downgraded` flag surfaced in the review UI and recorded in `prescription_audit.meta_mode`.
- Keep loop-cap and repeated-tool-call guards, but as **typed audited events** (§4.3), not survival hacks.

### 6.3 Timeouts → states, not request kills
The 120 s `AbortController` that killed the whole loop is **deleted**. Replacements:
- Per-request `AbortController` on each SDK call (transport-level, generous).
- Worker job lease (`locked_until`) bounds a stuck job; on lease expiry another worker reclaims or marks `failed`.
- Client `RKH_GEN_HARD_DEADLINE_MS` → the `GenerationPort` `timeout` state → degraded UI (retry / manual edit / single-shot). **No path ends in an infinite spinner.**

---

## 7. Generation observability (replaces heuristic console.logs)

Every generation is an **auditable event stream**, satisfying NABH traceability and clinical-safety review. Two layers:

### 7.1 `generation_events` (event-sourced, per command/event)
Append-only. One row per domain event (`GenerationStarted`, `ToolInvoked`, `DraftDelta` summarized, `GenerationCompleted`, `GenerationFailed`, `LoopCapReached`, `ModelDowngraded`). Records `command_in`, each `ToolInvoked`, the **model id + version actually used**, token usage, the final draft reference, and the eventual `SignOff`. This is the NABH "who/what/when" record and replaces every prototype `console.log`.

### 7.2 `prescription_audit` (one row per generation attempt — port from `sprint-2-saved`)
Port the existing table, **dropping `anon_full_access`** in favor of per-role RLS (§8). Columns (verified from `20260428001000_prescription_audit.sql`):

| Column | Meaning |
|---|---|
| `attempt_number` | 1 = first, 2 = auto-retry / downgrade |
| `meta_mode` | `tool-use` \| `streaming` \| `fallback-downgrade` |
| `stop_reason` | `end_turn` \| `max_tokens` \| `tool_use` \| `refusal` |
| `input_tokens` / `output_tokens` | usage; basis for `cost` micro-INR |
| `rounds` | tool-use loop rounds consumed |
| `tools_called[]` | e.g. `{get_formulary, get_standard_rx, compute_doses}` |
| `requested_meds[]` / `emitted_meds[]` / `omitted_meds(jsonb)` / `added_meds[]` | completeness audit (omission/addition rate) |
| `severity_server` / `severity_ai` / `severity_final` | three-tier severity (`high`/`moderate`/`low`), final = max |
| `warnings[]` | e.g. `completeness_mismatch`, `devanagari_missing`, `cache_zero_read`, `compute_doses_missing` |
| `verifier_flags(jsonb)` | reserved for the eval verifier |
| `duration_ms` | end-to-end worker duration |

### 7.3 Read model & cost ledger
`prescribing.rx_generation_jobs` (the schema half of the latency fix): `status (queued|generating|streaming|draft_ready|superseded|failed)`, `idempotency_key UNIQUE`, `correlation_id`, `speculative bool`, `content_hash`, `tokens`, `cost` (micro-INR int), `latency_ms`. `ops.cost_ledger` aggregates per-day spend by model + task. `ops.outbox` carries event-driven dispatch (SSE relay + status projection).

### 7.4 Dashboards (the metrics this enables)
Omission/addition rate, cache-read ratio (silent-invalidator alarm), severity distribution, model-downgrade frequency, p50/p95 worker latency, speculative-hit ratio (how often the doctor opens at 0 ms), cost per generation. These replace the prototype's grep-the-logs workflow.

---

## 8. Security, PII & compliance (generation-specific)

- **No PII to the model.** Preserve PII-stripping in `get_previous_rx` and visit-summary as a **typed boundary** (`PreviousRxView`), not an ad-hoc `.map`. The clinical note may contain PII only as the doctor typed it; the system adds none (no name/UHID interpolation into the cached prefix).
- **`ANTHROPIC_API_KEY` via `SecretsPort`** — never in client, logs, URLs, or commit messages; never in a client-reachable function. The prototype's edge function reads `Deno.env.get("ANTHROPIC_API_KEY")` server-side; the rebuild keeps the key strictly on the worker.
- **Real RLS replaces `anon_full_access`** on `prescription_audit` / `generation_events` — `current_setting('app.role')` set from JWT at request start (`dis/` `M008` pattern). Roles `reception | nurse | doctor | service | admin`; **NO DELETE** on audit tables; append-only triggers (BEFORE UPDATE/DELETE raise).
- **`esc()` discipline** preserved as the design-system safe-render primitive for any AI-generated text surfaced in the UI (XSS).
- **Provenance on paper:** AI-generated lines are visually distinguished from clinician edits; an **"AI-assisted, doctor-reviewed"** line prints on every Rx. NABH compliance block mandatory on every prescription.

---

## 9. Symmetric-actor seam (AI-first as an additive layer)

The generation flow is wired so an autonomous "AI-drafts-then-doctor-signs" mode is a **subscriber, not a rewrite**:

- `DraftNoteUpdated` (autosave) and `RequestGeneration` (doctor click | speculative trigger | **future AI agent**) are **indistinguishable commands** on the bus → the worker → events → `rx_generation_jobs` + `prescription_drafts`.
- **Clinical-safety invariant (fail-closed):** an AI draft is `pending_review` until a human `SignOff` command — identical gating to the OCR `promotion.ts` (CS-1/CS-7). The pure `state-machine.ts` `transition(state, event)` is the safety spine: invalid transitions **throw and are never persisted**; even failure paths route through `transition()`.
- **Consent precondition (canonical decision C6, fail-closed):** `RequestGeneration` is **blocked at the command boundary** unless the patient has an active `purpose='ai_assisted_rx'` guardian consent (`clinical.guardian_consents` row with `consent_given = true AND withdrawn_at IS NULL`); otherwise the command fails `403 CONSENT_REQUIRED` before any job is enqueued. The **speculative trigger is gated identically** — a withdrawn-consent patient never has an AI draft sitting in `prescription_drafts`; withdrawal supersedes/cancels in-flight speculative jobs. This is distinct from `opd_care` (clinical-processing) and ABDM (sharing) consents.
- **Signed is a row insert, not a status update (canonical decision C4):** the `signed` state below is the **state-machine** view; it **materializes as a row INSERT into `prescribing.prescriptions`** (a prescription has no `status` column — row existence *is* the signed state; the API's `status:"signed"` is synthetic). No job/draft enum ever carries a `signed` value.
- **Generation state machine:**
  ```
  note_captured → generating → streaming → draft_ready → doctor_editing → signed → printed
                       └──────────────► superseded (newer content hash)
                       └──────────────► failed (schema_invalid | deadline | refusal)
  draft_ready/doctor_editing → (edit) → applySignoffGate re-evaluated  // high→edit→save cannot bypass
  ```
- Going AI-first later = an additive subscriber that emits `RequestGeneration` + `SignOff` autonomously. The arithmetic boundary (§4.6) and the human-sign-off invariant hold unchanged.

---

## 10. Acceptance criteria (eval-gated; the discipline suite owns the runner)

This context is **TDD + eval-gated**. The `09_engineering_discipline/` suite owns the operating model; this spec defines **WHAT is gated**:

1. **Dose-engine golden parity (C5 / Part C)** — ≥ 20 JS↔TS fixtures pass **byte-for-byte, zero tolerance** (rounding, caps, therapeutic ranges, bilingual R2/R3 strings, GFR/BSA/weight methods, combo limiting-ingredient, preterm corrected-age). Oracle = `web/dose-engine.js`; runtime port = `core/` `DoseEnginePort`. Required check `ci/dose-parity`; release blocker for the Generation context until green.
2. **Generation eval over a frozen pediatric fixture set** — for each case: dosing within rounding rules, all NABH fields present, no PII leakage to the model, JSON-schema (`prescription.v1.json`, frozen by `05_ai/`) conformance, safety invariants (`compute_doses` called when `medicines[]` non-empty; mismatch → `overall_status = REVIEW_REQUIRED`).
3. **`GenerationPort` state-contract tests** — `idle→streaming→ready`, stale→regenerate, error/timeout→degraded; no infinite-spinner path reachable.
4. **Caching audit** — `cache_read_input_tokens` non-zero on the second identical-prefix call; a regressed silent invalidator fails CI.
5. **Config audit** — `core_no_model_id_literals` green; boot fails on any unset model env (model-retirement class cannot reach runtime).
6. **Fallback/refusal tests** — overload → tier-downgrade flagged; `stop_reason:"refusal"` handled before `content[0]`; clinical model class never silently downgraded.

---

### Key source references (absolute / branch-qualified)

- Prototype (the 150 s flaw, port-from then retire): `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\supabase\functions\generate-prescription\index.ts` — hardcoded model `index.ts:518`, `thinking:disabled`/`effort:low` 519–520, `AbortController` 120 s `index.ts:500–501`, tool-use loop 485–613, `extractJSON` 662–682, `singleShotFallback` 617–658, 5-tool defs 56–151, `condenseDrugForAI` 176–241.
- Clinical brain (`origin/sprint-2-saved`): `supabase/functions/_shared/dose-engine.ts` (745-line pure TS port; exports verified §4.6); `supabase/functions/generate-prescription/index.ts` (`compute_doses` tool def line 165, three-tier severity, `compute_doses_called` assertion); `supabase/migrations/20260428001000_prescription_audit.sql` (audit table schema §7.2).
- Foundation (`origin/feat/dis-plan`): `dis/scripts/fitness-rules.json` (6 enforced rules — extend with `core_no_model_id_literals`); `dis/src/core/state-machine.ts` (`transition()` total/throwing pattern §9); `dis/src/ports/database.ts` (RLS session-var contract §8); `dis/src/core/env.schema.ts` (Zod fail-fast boot §3.3); `dis/migrations/M004` (job queue), `M008` (RLS).
- Skill / config: `radhakishan_system/skill/core_prompt.md` (cached system prefix §5.1; rebuilt structure owned by `05_ai/prompt_system_design.md`); `web/dose-engine.js` (frozen legacy reference / parity oracle for golden parity §4.6 — **not** the runtime engine; runtime authority is the `core/` TS `DoseEnginePort`, C5).
- Authority for model/API facts: `claude-api` skill (Opus 4.8 `claude-opus-4-8`, adaptive-thinking-only, `effort` in `output_config`, streaming-mandatory > ~16K, prompt-caching prefix rules, refusal guard) — verified this session, 2026-06.
