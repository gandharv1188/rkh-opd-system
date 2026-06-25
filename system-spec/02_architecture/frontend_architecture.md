# Frontend Architecture — Radhakishan Pediatric OPD Rx System (Target-State Rebuild)

> **Status:** Normative. This is the single source of truth for the rebuilt **frontend** — framework, component model, routing, state, data fetching, the **streaming generation client**, the **speculative-generation trigger**, offline/resilience, performance, and the per-surface builds (pad / registration / print / lookup).
>
> **Binding rule.** The build targets the [TARGET-ARCHITECTURE DIGEST] and is consistent with `00_overview/glossary.md`. Where this file and an upstream study report disagree, the **Digest wins**. Flag a contradiction only if it conflicts with a verified API fact. Vocabulary is exactly the glossary's — **no synonyms**.
>
> **Scope fence.** This file owns the **client**. It does **not** re-specify backend service decomposition (`backend_services.md`), the target DB schema (`03_data/`), AI orchestration internals (`ai_orchestration.md`), the API/SSE contract surface (`04_api/`), or the TDD/eval operating model (`09_engineering_discipline/`). It **consumes** their contracts and states where the seam sits.
>
> **RFC-2119 force.** **MUST** = merge-blocking invariant. **MUST NOT** = forbidden. **SHOULD** = strong default; deviation needs an ADR. `code_font` = an exact identifier to reproduce verbatim.

---

## 0. The one-paragraph thesis

The frontend is a **component-based SPA** that holds the same engineering line as the backend: **hexagonal seams, command-bus + CQRS, container/presentational split, design tokens, and a centralized config/secrets boundary**. No component ever touches a vendor (Supabase, Anthropic, ABDM, `api.qrserver.com`) directly — every external interaction passes a **client-side port** (an anti-corruption seam). The headline frontend deliverable is the **latency experience**: by the time the doctor clicks **Generate**, a fresh **speculative draft** — triggered in the background off the auto-saved note — usually already exists, so review opens at ~0 ms; when it does not, a **streaming** client renders the prescription progressively (diagnosis → meds → safety) over **SSE**, and a hard client deadline degrades to retry/manual-edit — **never an infinite spinner**. Humans and the (future) AI agent are **symmetric actors**: every mutation is a `Command` on one client bus, so going AI-first later is an additive subscriber, not a rewrite. The deterministic **dose engine is the sole arithmetic authority** on the client too: the `<DoseAdjuster>` binds to the pure engine; the AI proposes drugs/regimens with **no numeric fields**.

---

## 1. What we are replacing, and why a framework (decisive)

### 1.1 The prototype's frontend failure modes (port-from, then retire)

The shipped client is **8 single-file HTML pages, ~21,500 lines** of duplicated inline JS/CSS (`web/prescription-pad.html` alone is **7,810 lines**). Verified pathologies this rebuild **MUST** eliminate:

| # | Prototype pathology | Evidence | Target-state fix |
|---|---|---|---|
| F-1 | **Synchronous, blocking generation** with a **cosmetic** progress rotator | `prescription-pad.html` `generatePrescription()` (≈4843–4980): a single `await fetch(.../generate-prescription)` with a hard-coded `msgs[]` `setInterval` rotator that is **unrelated to real progress** | Async job + **SSE stream** of real domain events; `<GenerationProgress>` reflects actual `ToolInvoked` / `DraftDelta`. §6 |
| F-2 | **150 s edge wall-clock** surfaced to the doctor as a 5-min wait / 504-546 | Digest §2; `console-log.md:15-16` | Off-edge worker (backend) + **speculative pre-generation** so perceived wait ≈ 0. §5–§6 |
| F-3 | **Duplicate print renderer** — `printRx()` (pad ≈6682) and `buildRxHtml()` (`prescription-output.html` ≈690–1073) are near-identical, drift-prone copies, with a **hard-coded doctor** baked into the output page | output page line ≈710 hard-codes "Dr. Lokender Goyal" | **One** `<PrintDocument>` canonical A4 renderer shared by pad + print station. §10.3 |
| F-4 | **Raw `fetch` + hard-coded anon key** in components; helper `q()` scattered across every page | every page | One `DataAccessPort` adapter; no key/URL/model literal in any component. §3, §4 |
| F-5 | **3× `raw_dictation` write** / dedup absence; autosave logic re-implemented per page | autosave block ≈3905–3964 | Command-bus dedup + a single `SaveNote` command. §7, §9 |
| F-6 | **No state abstraction** — DOM is the store; `selectedPatient`, `rxData`, `_patientLoadId` are module globals mutated in place | pad globals | Typed client store behind a `Store`/`Query` seam; CQRS reads. §4 |
| F-7 | **XSS-by-default** mitigated only by hand-called `esc()` on every interpolation | `esc()` everywhere | Framework auto-escaping + `esc()` retained as the design-system **safe-render primitive** for the one unavoidable `innerHTML` path (print). §8, §11 |
| F-8 | **Voice/VAD, dose-engine, labs/IAP constants** duplicated or DOM-coupled | voice ≈4298–4560; dose integ ≈5103–6003; `registration.html` `COMMON_LABS`/`IAP_SCHEDULE` | Ports + shared component library + shared constant modules. §3, §10 |

### 1.2 Framework choice — **React 19 + TypeScript (strict) on Vite 6** (decisive)

We adopt a real component framework. The candidates and the call:

| Option | Verdict | Reasoning |
|---|---|---|
| **Keep vanilla HTML/JS** | **Rejected** | F-1…F-8 are structural consequences of no component model, no type system, no test seam. Non-negotiable to keep. |
| **React 19 + TS + Vite** | **CHOSEN** | (1) **Boring, well-supported** — the Digest's stated bias and the lowest-risk hire/maintenance path in India. (2) **Aligns with `dis/ui`** convention (Digest §3: "match `dis/ui`"). (3) First-class **streaming/concurrent** primitives (`useSyncExternalStore`, transitions) fit SSE-driven progressive render. (4) Mature **a11y** tooling (axe, Testing Library) for the WCAG 2.2 AA gate. (5) Auto-escaping kills F-7 by default. |
| Svelte / SolidJS | **Rejected** | Smaller ecosystem; the streaming/store ergonomics gain is marginal versus the staffing-risk and `dis/`-alignment cost. "Prefer boring." |
| Next.js / SSR | **Rejected** | No SEO need; the app is an **authenticated internal SPA** behind login. SSR adds an unneeded server tier and complicates the GitHub-Pages-class static hosting story. A **static SPA + off-edge API** is the right shape. |

**Locked stack (frontend):**

| Concern | Choice | Note |
|---|---|---|
| Language | TypeScript, **strict** | Same bar as `dis/`. No `any` in committed code (lint-enforced). |
| Build / dev | **Vite 6** | Fast HMR, ESM, env-var injection, code-splitting per route. |
| UI lib | **React 19** | Concurrent features for streaming. |
| Routing | **TanStack Router** (type-safe) or React Router 7 | Type-safe loaders; see §3. |
| Server-state | **TanStack Query v5** | Cache, dedup, retry, stale-time — wrapped behind ports (§4). |
| Client-state / bus | **Zustand** stores + a thin **`CommandBus`** (§9) | No Redux ceremony; the bus is the CQRS write path. |
| Forms / validation | **react-hook-form + Zod** | Same Zod schemas shared with backend DTOs where possible. |
| Styling | **CSS variables (design tokens) + CSS Modules** | No utility-class soup; tokens are normative (§8). Devanagari + print rules need real CSS, not inline. |
| Tests | **Vitest + React Testing Library + Playwright** | Unit (fakes), component, and e2e. |
| a11y CI | **axe-core + Lighthouse CI** (≥90) | Merge gate (§8.4). |

**Hosting.** Static bundle on **GitHub Pages** (custom domain `rx.radhakishanhospital.com`, `web/CNAME` preserved) **or** any static CDN — the SPA talks only to the off-edge API over HTTPS. The anon-key-in-HTML era ends: the SPA authenticates via **Supabase Auth JWT** (§5.2, §11) and the **service-role key never reaches the client**.

---

## 2. Layering — hexagonal on the client (the same discipline as `dis/`)

The frontend mirrors `dis/`'s three containment boundaries. The Digest's fitness rules apply by analogy; we add **client-specific** machine-checkable rules.

```
src/
  app/            composition root: providers, router, port wiring (the ONLY place adapters are chosen)
  routes/         route modules (lazy) — one per surface (pad, registration, print, lookup, formulary, ...)
  features/       feature slices: a bounded UI context (prescribe, register, print, lookup)
    prescribe/
      components/      presentational (dumb) — props in, events out, no I/O
      containers/      smart — wire store + commands + ports to presentational
      commands/        command handlers (write path)
      queries/         query objects (read path, CQRS)
      machine/         client view of the rx state machine
  components/     cross-feature presentational library (design-system components)
  ports/          INTERFACES ONLY — DataAccessPort, GenerationPort, TranscriptionPort, ConfigPort,
                  PrintPort, RealtimePort, EventBus/CommandBus, SignaturePort(client-verify), QrPort
  adapters/       vendor edge; each port has a real adapter + a __fakes__/ peer
    data-access/supabase-rest.ts        (+ __fakes__/)
    generation/sse-client.ts            (+ __fakes__/)
    transcription/ai-transcribe.ts, web-speech.ts (dual-engine)
    realtime/sse.ts, status-poll.ts
    config/env-config.ts
    print/browser-print.ts
    qr/client-qrcode.ts
  domain/         PURE TS shared with backend by contract: dose-engine, growth-engine, types, tokens
    dose-engine.ts        (the 745-line port — single source of arithmetic truth)
    growth-engine.ts      (z-scores; deterministic)
    rx-state-machine.ts   (pure transition(); mirrors server states)
  store/          Zustand stores + CommandBus + EventBus impl
  styles/         tokens.css (design tokens), print.css, devanagari
  test/           fakes, fixtures, golden parity vectors (JS↔TS dose)
```

### 2.1 Client fitness rules (CI merge-blockers — extend `dis/scripts/fitness-rules.json`)

| Rule | Glob | Forbidden | Rationale |
|---|---|---|---|
| `components_no_fetch` | `src/components/**`, `src/features/**/components/**` | `\bfetch\s*\(`, `XMLHttpRequest`, `\.supabase` | Presentational layer does no I/O — F-4. |
| `components_no_vendor_import` | `src/components/**` | `@supabase`, `@anthropic`, `api.qrserver.com` | Vendors live only behind adapters. |
| `no_model_id_literals` | `src/**` | `claude-[a-z0-9.\-]+` | No dated model id in client — the retirement-broke-prod class. Digest §9. |
| `no_hardcoded_supabase_key` | `src/**` (excl. `adapters/config/**`) | `eyJ[A-Za-z0-9_\-]{20,}` (JWT-shaped) | Keys come from `ConfigPort`, never inline. |
| `domain_is_pure` | `src/domain/**` | `fetch`, `document`, `window`, `localStorage`, SQL | `dose-engine`/`growth-engine`/state-machine are pure — testable, server-shareable. |
| `ports_no_adapter_import` | `src/ports/**` | `from ['\"].*\/adapters\/` | Ports are the narrow waist (mirrors `dis/` `ports_no_adapter_imports`). |
| `wiring_only_in_app` | `src/**` (excl. `src/app/**`) | direct adapter construction (`new .*Adapter(`) | Composition happens once, in `app/`. |

> The `domain/dose-engine.ts` rule is the frontend half of the **clinical-safety invariant**: the engine cannot accidentally acquire I/O and drift from the byte-for-byte server recompute.

---

## 3. Component architecture

### 3.1 Container / presentational split (mandatory)

- **Presentational** (`components/`, `features/*/components/`): pure render. Props in, callbacks out. **No** store access, **no** ports, **no** I/O. Trivially snapshot/RTL-testable. Auto-escaped; the **only** sanctioned raw-HTML path is `<PrintDocument>` (§10.3), which uses the `esc()` primitive.
- **Container** (`features/*/containers/`): selects from stores, dispatches commands, subscribes to ports, maps domain → presentational props. Thin; logic lives in commands/queries/domain.

### 3.2 The shared component library (build once; pad and print station share)

Ported from `prescription-pad.html` and re-homed as typed, isolated components. Each ships a Storybook-style fixture and RTL tests.

| Component | Responsibility | Ported from |
|---|---|---|
| `<PatientHeaderStrip>` | UHID, name, age (+ **corrected** age chip for preterm — computed client-side, §3.4), sex, weight, guardian | pad header / meta |
| `<VitalsPanel>` | nurse-captured vitals (W/H/HC/MUAC/temp/HR/RR/SpO₂), read-only on pad | pad |
| `<DictationPad>` | textarea + voice toggle + autosave indicator + **speculative trigger** | pad ≈3905, ≈4298 |
| `<SectionChips>` | toggle Rx sections; each change is a `DraftNoteUpdated` input (§6.2) | pad `getSelectedSections()` |
| `<MedicineCard>` | the **4-row bilingual block** + pictogram sidebar + per-card actions | pad ≈5103 |
| `<DoseAdjuster>` | form/concentration/band controls bound to the **pure dose engine** | pad ≈5103–6003 |
| `<PrescriptionReview>` | full draft review: meds, investigations, advice, safety | pad `renderReview()` |
| `<PrintDocument>` | **THE** canonical A4 renderer (eliminates F-3) | pad `printRx` ≈6682 + output `buildRxHtml` ≈690 |
| `<GrowthTrend>` | weight/height history + trend arrows + WAZ | pad `loadGrowthTrend` |
| `<LabPills>` | flagged recent labs from `lab_results` | pad `loadRecentLabs` |
| `<VaxChecklist>` | IAP/NHM schedule, age-gated, overdue labels (mutually exclusive schedules) | `registration.html` `IAP_SCHEDULE` |
| `<QrBlock>` | client-rendered QR of the **signed JWS** verify URL (no PHI in URL; drop `api.qrserver.com`) | verify flow; Digest §7 |
| `<SafetyPanel>` | severity (three-tier), allergy alerts, omitted-formulary red stubs | pad `renderOmittedStubs`, severity |
| `<SignoffGate>` | the `applySignoffGate()` ack logic as a component (§3.3) | pad `applySignoffGate()` |
| `<GenerationProgress>` | **real** streamed progress (replaces the cosmetic rotator) | net-new (§6.3) |

### 3.3 Safety UX components (port verbatim from `sprint-2-saved`, re-home into components)

These are **clinical-safety surfaces**, not cosmetics. Behaviour is normative:

- **Missing-weight prompt** at `RequestGeneration`: if weight absent, block and prompt; the prompt **persists** until resolved (no silent generation without weight).
- **`<SignoffGate>`**: high severity → **Sign disabled** until an explicit ack checkbox; moderate → caution banner; **re-apply after any edit** so a `high → edit → save` path cannot bypass the gate. The gate logic is a pure predicate (`canSignOff(draft, acks): boolean`) tested in isolation.
- **Allergy-safe alternative** inline on the affected `<MedicineCard>`.
- **`renderOmittedStubs()`** → red stubs for formulary misses (the drug the AI named but the formulary lacks — never silently dropped).
- **Provenance**: AI-generated lines are **visually distinguished** from clinician edits (status **never colour-only** — §8.4), and the printed Rx carries an **"AI-assisted, doctor-reviewed"** line. Each `<MedicineCard>` tracks `origin: 'ai' | 'clinician'` and flips to `clinician` on edit.

### 3.4 Client-side arithmetic that the AI MUST NOT do

Two computations are **pre-computed on the client** (the AI does zero arithmetic that reaches paper):

1. **Preterm age** — `correctedAge` vs `chronologicalAge` computed in `domain/` from DOB + GA, passed as context. (Preterms: **corrected** for growth/development, **chronological** for vaccinations — glossary rule.)
2. **Dose math** — the `<DoseAdjuster>` calls `domain/dose-engine.ts` `computeDose(...)`. The AI proposes `{drug, regimen}` with **no numeric fields**; the engine fills mg/ml/drops, rebuilds R2/R3 bilingual strings + the pictogram, and applies caps. The **server re-checks byte-for-byte** (no tolerance) — the client engine exists for instant adjust UX, not as the authority. A **golden JS↔TS parity fixture set** (`test/dose-parity/*.json`, ≥20 cases) gates both ports.

---

## 4. Routing, state, and data fetching

### 4.1 Routing

**Type-safe, lazy-loaded routes** — one route module per OPD surface. Each route is **role-gated** (§11): the JWT's `app.role` claim decides visibility.

| Route | Surface | Primary role | Lazy chunk |
|---|---|---|---|
| `/` | Landing / nav cards | any | tiny |
| `/register` | Registration (reception + nurse) | `reception`, `nurse` | `registration` |
| `/pad` | Prescription Pad (doctor) | `doctor` | `prescribe` (largest) |
| `/print` | Print Station | `reception`, `doctor` | `print` |
| `/lookup` | Patient Lookup | all clinical | `lookup` |
| `/formulary`, `/standard-rx` | Catalog admin | `admin` | `catalog` |
| `/verify/:rxId` | Public Rx verify | unauthenticated (server-verified JWS) | `verify` |

Route **loaders** prefetch read models (patient context, formulary slice) through query objects so the surface paints with data, not spinners. The **pad route preloads** the prescribe chunk on hover/idle from the lookup result so the doctor's first interaction is instant.

### 4.2 State model — three tiers, each behind an abstraction (no DOM-as-store)

| Tier | Holds | Mechanism | CQRS role |
|---|---|---|---|
| **Server cache** | patients, visits, formulary, labs, drafts | **TanStack Query**, wrapped by `DataAccessPort` | **Read** (queries) |
| **Session/UI** | selected patient, active tab, pad text, section chips, gate acks | **Zustand** store per feature | local view state |
| **Generation** | per-job `state`, deltas, draft, error | **`GenerationPort`** state machine (§6) fed by SSE | **Read model** projection |

**Writes never mutate the cache directly.** Every mutation is a **command** (`SaveNote`, `AdjustDose`, `AddMedicine`, `GiveVaccination`, `SignOff`, `RequestGeneration`) dispatched to the **`CommandBus`** (§9), which invokes the appropriate port and emits an **`Event`**; query objects subscribe to events and invalidate/patch the cache. This is the client analogue of the server CommandBus→EventBus and is what makes the future AI actor additive.

### 4.3 Data fetching — `DataAccessPort` (one adapter, no scattered `fetch`)

```ts
// ports/data-access.ts  (INTERFACE ONLY)
export interface DataAccessPort {
  getPatientContext(id: PatientId): Promise<PatientContext>;   // patient + visit + summary + allergies
  searchPatients(q: string): Promise<PatientSummary[]>;        // name/UHID/guardian/token
  getFormularySlice(generics: string[]): Promise<FormularyEntry[]>;
  getRecentLabs(id: PatientId): Promise<LabResult[]>;
  getGrowthHistory(id: PatientId): Promise<GrowthRecord[]>;
  getVaxStatus(id: PatientId): Promise<VaxStatus>;
  saveNote(cmd: SaveNoteCommand): Promise<void>;               // idempotent, single-writer
  signOff(cmd: SignOffCommand): Promise<SignOffResult>;        // optimistic-lock (version) → 409 on conflict
  // ... all reads/writes the SPA needs; ONE place that knows the API base + auth header
}
```

- The **only** module that injects the base URL and the **JWT `Authorization` header** is `adapters/data-access/supabase-rest.ts`, configured by `ConfigPort`.
- **Optimistic concurrency**: writes carry the row `version`; a `409 VersionConflictError` (the `dis/` error code) surfaces as a "this record changed — reload" prompt, never a silent overwrite. This kills the prototype's last-write-wins clobber.
- **Idempotency**: every write sends an `Idempotency-Key` (UUID v4 per intent) — required by the gateway (`dis/` middleware), and the client de-dupes retries with the same key.

### 4.4 `ConfigPort` — the centralized config/secrets boundary

```ts
// ports/config.ts
export interface ConfigPort {
  apiBaseUrl(): string;
  supabaseUrl(): string;
  publishableKey(): string;     // publishable (anon) key ONLY for unauthenticated bootstrap; never service-role
  // NO model id, NO service-role key, NO ABDM secret EVER on the client
}
```

Values come from **Vite build-time env** (`import.meta.env.VITE_*`) validated by a **Zod schema at boot** (fail-fast, mirrors `dis/` `env.schema.ts`). **No** URL/key/model literal appears in any component — enforced by the `no_model_id_literals` / `no_hardcoded_supabase_key` fitness rules. The model id lives **only** on the backend `ModelPolicyPort`; the client never names a model.

---

## 5. The latency design on the client (the headline)

Target: **doctor perceived wait ≈ 0**; **never** an infinite spinner; the draft is **always** doctor-reviewed/signed (clinical-safety invariant — no auto-finalize). Four compounding client mechanisms, mirroring Digest §2:

### 5.1 Mechanism map (client responsibilities)

| Mechanism | Backend owns | **Frontend owns** |
|---|---|---|
| Off-edge worker | the persistent tool-loop worker | nothing — but the client **assumes** generation is async and never blocks on it |
| **Speculative generation** | debounced background re-gen keyed by content hash | **the trigger**: emit `DraftNoteUpdated` on meaningful autosave + chip change; compute/track the **content hash** (§6.2) |
| **Streaming** | emit `GenerationStarted/ToolInvoked/DraftDelta/Completed/Failed` | **subscribe by `job_id` over SSE** and render progressively (§6.3) |
| **Review-first UX** | `draft_ready` read model | **open review at 0 ms** if the speculative hash matches; else show "regenerating from your latest note…" inline (§6.4) |

### 5.2 Transport: **SSE**, not Realtime WebSocket (decisive)

The prototype's Supabase **Realtime WebSocket was removed for IO cost** (Digest §2; repo commit `perf(io)`). The rebuilt notify channel is **Server-Sent Events** from the off-edge worker (`GET /jobs/{id}/events`), with a **status-row short-poll** fallback when SSE is unavailable (corporate proxies, flaky mobile). The `RealtimePort` abstracts both:

```ts
// ports/realtime.ts
export interface RealtimePort {
  subscribeJob(jobId: JobId, onEvent: (e: GenerationEvent) => void): Unsubscribe;
  // adapter A: EventSource over GET /jobs/{id}/events
  // adapter B: poll GET /jobs/{id} status row every ~1.5s (fallback)
}
```

SSE is the right call: it is **one-directional server→client** (exactly our need), survives plain HTTP/2, needs no extra socket lifecycle, and carries the auth JWT as a query-signed short-lived token (the EventSource header limitation is handled by a one-time signed URL from the API). Authentication uses the Supabase Auth JWT (the anon-key-in-HTML model is retired).

---

## 6. The streaming generation client + speculative trigger (`GenerationPort`)

This is the most important net-new frontend construct. It replaces F-1 entirely.

### 6.1 `GenerationPort` — states and contract

```ts
// ports/generation.ts
export type GenState =
  | 'idle' | 'streaming' | 'ready' | 'stale' | 'error' | 'timeout';

export interface GenerationPort {
  /** Speculative or explicit. Returns a job handle; never throws on slow backend. */
  request(input: GenerationInput, opts: { speculative: boolean; signal: AbortSignal }): JobHandle;
  /** Subscribe to the per-job event stream (via RealtimePort under the hood). */
  observe(job: JobHandle): Observable<GenerationEvent>;
  /** Current snapshot for review-first open. */
  snapshot(job: JobHandle): { state: GenState; draft?: RxDraft; contentHash: string };
}
```

Contract invariants (contract-tested — `09_engineering_discipline/` owns the runner):

- **Every** `request` carries an `AbortController`; a newer content hash **aborts** the in-flight speculative run (last-write-wins).
- **Exponential backoff + jitter** on `429`/`5xx`; a **hard client deadline** (e.g. 90 s wall once *streaming has begun without progress*) flips to `timeout` → degraded UI (**retry / manual edit / single-shot**), **never** an infinite spinner.
- `error` and `timeout` are **terminal-but-recoverable**: the doctor can always retry or hand-author. The **`SignoffGate` still applies** to any resulting draft.

### 6.2 The speculative trigger (off the auto-saved note)

The doctor's note already autosaves debounced to `visits.raw_dictation`. We make **each meaningful save and each section-chip change** a `DraftNoteUpdated` command:

```
<DictationPad> onInput
  → debounce(3s)  → SaveNote command (DataAccessPort.saveNote)         // persistence
  → debounce(N s) → DraftNoteUpdated command (GenerationPort.request)  // speculation
```

- **Content hash** keys the speculation: `sha256({ note, patient_context_version, selected_sections })` (the `dis/` `content-hash.ts` `sha256` pattern, computed client-side via WebCrypto `crypto.subtle.digest`). Identical hash ⇒ **no new request** (dedup; the prototype's 3× write class never recurs). A newer hash ⇒ the previous `AbortController.abort()` fires and a fresh speculative `request` starts.
- **Debounce discipline** (cost control): speculation fires on a **longer** debounce than autosave (e.g. 6–8 s of quiet, or an explicit chip change), and is **rate-limited** (max in-flight = 1 per visit; trailing-edge only). This bounds token spend while still usually having a fresh draft ready at click time.
- **Privacy/PII**: the trigger sends only what the backend's PII-stripped boundary expects; the client never logs the note to console (the prototype's `console.log("Prompt sent to AI…")` is **removed** — §11).

### 6.3 Progressive rendering (`<GenerationProgress>` + streamed sections)

`observe(job)` yields domain events; the container maps them to UI with React transitions so the pad stays responsive:

| Event | UI effect |
|---|---|
| `GenerationStarted` | progress bar → "Reading note…"; cancel button armed |
| `ToolInvoked{name}` | **real** step label ("Fetching formulary…", "Looking up protocol…") — replaces the cosmetic `msgs[]` rotator |
| `DraftDelta{section, patch}` | render **section-by-section**: diagnosis appears → `<MedicineCard>`s stream in → `<SafetyPanel>` resolves last |
| `GenerationCompleted{draft, usage}` | finalize; run `applySignoffGate()`; record provenance + `cache_read_input_tokens` to the audit read model |
| `GenerationFailed{reason}` | `error` state → degraded UI (§6.1) |

Because meds stream in as `<MedicineCard>`s, the doctor starts reviewing the diagnosis and first drug **while** later drugs are still arriving — perceived latency collapses even on a cold (non-speculative) run.

### 6.4 Review-first open (the 0 ms path)

On `RequestGeneration` (the doctor clicks **Generate**):

```
hashNow = sha256({note, ctxVersion, sections})
snap = GenerationPort.snapshot(job)
if snap.state === 'ready' && snap.contentHash === hashNow:
    openReview(snap.draft)                       // 0 ms; subtle "draft — confirm" badge
elif snap.state === 'streaming' && snap.contentHash === hashNow:
    openReview(partial); attach stream            // partial now, deltas fill in
else: // stale or idle
    request({speculative:false}); show "regenerating from your latest note…" inline
```

The **"draft — confirm"** badge makes provenance explicit: a speculative draft is visibly *pre-generated and pending the doctor's confirmation*, never silently presented as finished.

---

## 7. Offline / resilience

The OPD runs on imperfect hospital Wi-Fi; the client must degrade gracefully, never lose a note, and never silently corrupt a record.

### 7.1 Layered resilience

| Layer | Mechanism | Failure it covers |
|---|---|---|
| **Note durability** | every keystroke buffered to `localStorage` (`rx-draft-{visitId}`, the prototype's pattern, kept); `SaveNote` retried with backoff; on reconnect, replay unsynced note | tab crash, transient network, edge timeout |
| **Command outbox** | unsynced commands queued in IndexedDB with their `Idempotency-Key`; flushed on reconnect; server idempotency de-dupes replays | offline mutations, double-submit |
| **Read cache** | TanStack Query `staleTime` + persisted cache for patient context & formulary | brief disconnects mid-consult |
| **Generation degradation** | `GenerationPort` `error`/`timeout` → retry / manual-author; the doctor can **always** write the Rx by hand | worker outage, model overload |
| **Service Worker (PWA)** | cache the app shell + static formulary slice; **app boots offline**; writes queue | venue Wi-Fi drop |
| **Connectivity banner** | non-colour-only "Working offline — changes will sync" indicator | user awareness (no silent data loss) |

### 7.2 Conflict & idempotency rules (resilience MUST-nots)

- A queued write **MUST** carry its original `Idempotency-Key`; replays **MUST NOT** create duplicates (server-enforced; client guarantees stable keys).
- A signed prescription is **immutable**; an offline edit attempt on a signed Rx is **rejected client-side** before it reaches the outbox (mirrors the server append-only rule).
- Optimistic UI for `SaveNote`/`AdjustDose` is allowed; **`SignOff` is never optimistic** — it requires a confirmed server round-trip with the current `version` (no offline sign-off of a clinical document).

---

## 8. Design system (tokens, not inline styles)

The prototype's identity (bilingual 4-row block, pictograms, A4 print spacing, sticky headers, Royal-Blue medicines) is **preserved**, but expressed as **tokens + CSS Modules**, never inline-styled strings.

### 8.1 Colour tokens (the clinical colour code is normative)

| Token | Value (Royal-Blue family) | Meaning |
|---|---|---|
| `--color-medicine` | Royal Blue | **Medicines** (R1–R4 of every `<MedicineCard>`) |
| `--color-investigation` | Red | **Investigations / labs ordered** |
| `--color-default` | Black/Ink | Everything else |
| `--color-flag-high` / `--moderate` / `--ok` | red / amber / green | Severity — **always paired with text + icon**, never colour-only |

### 8.2 The 4-row bilingual medicine block (preserve exactly)

- **R1**: `GENERIC NAME IN CAPS (concentration)` — Royal Blue.
- **R2**: English dosing.
- **R3**: Hindi (Devanagari, **Noto Sans Devanagari**).
- **R4**: inline-**SVG** pictogram sidebar — sunrise/sun/sunset/moon time-of-day + dose-qty (pills/spoon/drops) + food/duration in Hindi.
- **Inline SVG only — no external images.** Every pictogram **MUST** be paired with Hindi+English text (never icon-only — false-confidence risk; Digest §8).

### 8.3 Print tokens (A4) — preserve the comfortable spacing

`@page` margins **12 mm 10 mm**, body **12 px / line-height 1.5**, medicine R1 **14 px** / R2–R3 **12 px**, emergency grid **2 columns**, centred hospital header ("Radhakishan Hospital" + Devanagari + NABH badge). These are tokens in `styles/print.css`, consumed by the single `<PrintDocument>`.

### 8.4 Accessibility (merge gate)

- **WCAG 2.2 AA**; **Lighthouse ≥ 90** (a11y + best-practices) in CI.
- **No colour-only status** — every severity/provenance signal carries text + icon (directly mitigates the verification UI's rubber-stamp risk).
- **Tablet-first**: touch targets ≥ 44 px, the **dose slider** and **voice toggle** are first-class touch controls.
- Keyboard-navigable `<SignoffGate>`; focus management on view switches; `aria-live` on `<GenerationProgress>` so streamed steps are announced.

---

## 9. CommandBus + CQRS + symmetric-actor seam (client)

Every mutating action — doctor edit, nurse approve, future AI agent — emits the **same `Command` shape** to one client bus; results are domain `Event`s; reads are CQRS projections. This is the client mirror of the server bus and is what makes AI-first additive.

```ts
// store/command-bus.ts
export interface Command<T = unknown> {
  type: CommandType;            // 'SaveNote' | 'AdjustDose' | 'AddMedicine' | 'GiveVaccination'
                                // | 'SignOff' | 'RequestGeneration' | 'DraftNoteUpdated'
  payload: T;
  actor: { kind: 'human' | 'ai'; id: string; role: Role };  // <- symmetry lives here
  correlationId: string;
  idempotencyKey: string;
}
export interface CommandBus { dispatch<T>(cmd: Command<T>): Promise<void>; }
export interface EventBus  { publish(e: DomainEvent): void; subscribe(t: EventType, h: Handler): Unsubscribe; }
```

- **Audit**: every command is logged to the audit read model with its actor — satisfies NABH traceability on the client side.
- **Dedup**: `SaveNote`/`DraftNoteUpdated` carry the content hash; identical hash ⇒ no-op (fixes the 3× write).
- **Optimistic UI**: commands can patch the store before the server confirms (except `SignOff`).
- **Symmetry**: `RequestGeneration` is **indistinguishable** whether it came from the **Generate** click, the **speculative** trigger, or a future **AI agent** — only `actor.kind` differs. The **clinical-safety invariant** holds in the client too: an AI-originated draft is `pending_review` until a **human `SignOff`** command. Going AI-first is an **additive subscriber** that emits `RequestGeneration` + (eventually) `SignOff` — **no UI rewrite**.

### 9.1 Client view of the rx state machine (pure, mirrors server)

`domain/rx-state-machine.ts` is a pure `transition(state, event)` (the `dis/` `state-machine.ts` pattern — invalid transitions **throw** and are never rendered). The client states track the server's:

```
note_captured → generating → streaming → draft_ready → doctor_editing → signed → printed
                                                  ↘ superseded   ↘ failed
```

The UI **derives** from the machine; it never sets ad-hoc booleans. `superseded` (a newer speculative hash won) and `failed`/`timeout` are first-class so the UI always has a defined, safe state to render.

---

## 10. Per-surface builds

### 10.1 Prescription Pad (`/pad`) — the critical surface

**Composition:** `<PatientHeaderStrip>` · `<VitalsPanel>` · `<GrowthTrend>` · `<LabPills>` · `<VaxChecklist>` · `<DictationPad>` (+ `<SectionChips>`) · `<GenerationProgress>` · `<PrescriptionReview>` (= `<MedicineCard>` × n + `<DoseAdjuster>` + `<SafetyPanel>`) · `<SignoffGate>` · `<PrintDocument>`.

**Flow (target):**
1. Select patient (combo box: name/UHID/guardian/token) → loaders hydrate context, growth, labs, vax.
2. Doctor types/dictates → `<DictationPad>` autosaves (`SaveNote`) **and** fires `DraftNoteUpdated` (speculative). `<GenerationProgress>` may quietly indicate a draft is warming.
3. Click **Generate** → §6.4 review-first: 0 ms if speculative hash matches, else streamed.
4. Review/edit `<MedicineCard>`s; `<DoseAdjuster>` recomputes via the **pure engine**; `<SafetyPanel>` + `<SignoffGate>` re-evaluate after **every** edit.
5. **Sign off** (`SignOff` command, version-checked) → vaccinations `given_today` saved → `<PrintDocument>` opens.
6. Re-selecting a "done" patient **auto-loads** the saved, **read-only** prescription.

**Decisive change vs prototype:** the doctor **never** watches a 50–150 s spinner; generation is async, speculative, and streamed; the dose engine — not the AI — owns every number on paper.

### 10.2 Registration (`/register`) — reception + nurse

**Composition** (section order preserved): Demographics → Visit Details → Chief Complaints → **Neonatal** (auto-shows when DOB < 90 d / GA < 37 wk / BW < 2.5 kg — a pure predicate component) → Allergies → Vitals (nurse) → **Vaccination** (`<VaxChecklist>`, age-gated, IAP/NHM mutually exclusive) → **Labs** (`<LabEntry>` over `COMMON_LABS` — 39 tests, 4 categories, auto-unit + auto-flag, LOINC-coded) → **Documents** (upload to the `documents` bucket via signed URL).

- `COMMON_LABS` and `IAP_SCHEDULE` become **shared typed constant modules** (`domain/`), not page-local arrays (kills F-8 duplication). Returning patients see prior labs as **read-only pills**.
- **Server-side ID allocation**: UHID / receipt / token are **never** computed client-side (the prototype's `MAX(seq)+1` race is deleted) — the client calls the server's `SECURITY DEFINER` counter and renders the returned id.
- **DPDP guardian consent** captured here (timestamped, plain-language notice, withdrawal path) — a first-class `<GuardianConsent>` component, distinct from ABDM consent.
- On save for a **returning** patient, the backend generates the AI **visit summary** asynchronously; the client shows it when ready (no blocking).

### 10.3 Print Station (`/print`) and `<PrintDocument>` (collapse the duplicate)

- **One** renderer: `<PrintDocument>` (presentational, takes a fully-resolved `RxDraft` + facility/doctor context as **props**, never a DB handle). It replaces both `printRx()` and `prescription-output.html`'s `buildRxHtml()` — **F-3 resolved**.
- The print station auto-loads **today's approved Rx** from the API, supports search/filter by patient/UHID/Rx-ID, and renders **identical** output to the pad (same component ⇒ no drift).
- Output carries: centred hospital header + NABH badge, the **signed-QR** `<QrBlock>` (client-rendered from a **JWS** verify URL — no PHI in the URL, no `api.qrserver.com`), and the **"AI-assisted, doctor-reviewed"** provenance line.
- Browser print API (`@page` rules); the `esc()` primitive guards the one sanctioned `dangerouslySetInnerHTML` path used for the print DOM.

### 10.4 Patient Lookup (`/lookup`)

- `<PatientSearch>` (debounced, server-side `pg_trgm` fuzzy match) → `<PatientResult>` cards → drill-in to history, prior Rx tabs, labs, growth, vax.
- Reuses `<GrowthTrend>`, `<LabPills>`, `<VaxChecklist>`, `<MedicineCard>` (read-only mode) — **zero** bespoke renderers.
- Deep-links into `/pad?patient=…` (preloading the prescribe chunk) and `/print`.

### 10.5 Catalog admin (`/formulary`, `/standard-rx`)

Lower-traffic admin surfaces (530 drugs / 446 protocols). Componentized tables + edit forms (`react-hook-form + Zod`, validated against the **`formulary.v1.json`** Ajv schema the dose engine relies on), behind the `admin` role. Import flows talk to the backend ingestion endpoints, not direct DB.

---

## 11. Security & privacy (client responsibilities)

| Control | Rule |
|---|---|
| **No service-role key / model id / ABDM secret on the client** | enforced by fitness rules; `ConfigPort` exposes only publishable bootstrap config. |
| **Auth** | Supabase Auth **JWT**; the SPA attaches it via `DataAccessPort` only. The blanket-anon-key-in-HTML model is **retired**. |
| **Role-gating** | routes and component visibility derive from the JWT `app.role` claim (`reception`/`nurse`/`doctor`/`admin`); the server's **RLS** is the real boundary — the client gate is UX, not security. |
| **No PII to console / logs / URLs** | the prototype's `console.log("Prompt sent to AI…")` and note dumps are **removed**; QR carries a signed verify URL with **no PHI**. |
| **`esc()` safe-render primitive** | retained for the single print `innerHTML` path; everywhere else React auto-escapes. |
| **Signed-Rx integrity** | the client renders a **JWS-signed** QR; `/verify/:rxId` calls a **read-only server endpoint** (no PHI in the QR URL) — replaces the forgeable 6-char client-salt hash. |
| **DPDP child-data** | guardian consent captured + surfaced; no secondary-use analytics from the client. |

---

## 12. Performance budget & verification

| Metric | Budget | How |
|---|---|---|
| First load (pad, warm CDN) | LCP < 2.5 s | route-level code-split; preload prescribe chunk on lookup hover |
| **Perceived wait to reviewable Rx** | **≈ 0 ms** (speculative hit) / progressive (cold) | §5–§6; **never** an infinite spinner |
| Bundle (initial) | < 250 KB gzip app shell | tree-shaking; lazy routes; inline SVG (no image weight) |
| Lighthouse a11y + best-practices | **≥ 90** | CI gate |
| Re-render cost on `DraftDelta` | no full-pad re-render | section-keyed components + `useSyncExternalStore` selectors |
| Dose-adjust latency | < 16 ms (one frame) | pure synchronous `computeDose` — no network in the slider |

**Verification (the discipline suite owns the runner; this file states *what* is gated):**
- `GenerationPort` **state-contract tests** (all `GenState` transitions; abort-on-newer-hash; deadline → `timeout`).
- **Dose-engine golden JS↔TS parity** (≥20 cases; rounding syrups 0.5 ml / drops 0.1 ml / tablets 0.25; caps; bilingual strings) — gates the client engine against the server before either is trusted.
- **Component a11y** (axe) on every presentational component; **Playwright** e2e for the four surfaces incl. the **review-first 0 ms** path and the **`SignoffGate` cannot be bypassed** invariant.
- **Fitness rules** (§2.1) as merge-blockers.

---

## 13. Decisions ledger (frontend)

| # | Decision | Status |
|---|---|---|
| FE-1 | React 19 + TS strict on Vite 6 (boring, `dis/ui`-aligned) | **Accepted** |
| FE-2 | Static SPA + off-edge API; **no SSR** | **Accepted** |
| FE-3 | **SSE** primary realtime, status-poll fallback; **no** Realtime WebSocket (IO cost) | **Accepted** |
| FE-4 | Speculative generation triggered off autosave, keyed by **content hash**, abort-on-supersede | **Accepted** |
| FE-5 | One `<PrintDocument>`; delete the duplicate renderer | **Accepted** |
| FE-6 | Client **CommandBus + CQRS**; symmetric human/AI actor in `Command.actor` | **Accepted** |
| FE-7 | Pure `domain/dose-engine.ts` as the only client arithmetic authority; AI numeric-free | **Accepted** |
| FE-8 | `ConfigPort` centralizes config; **no model id / service-role key in client** | **Accepted** |
| FE-9 | PWA service worker + IndexedDB command outbox for offline resilience | **Accepted** |
| FE-10 | Design tokens (no inline styles); 4-row bilingual block + A4 print spacing preserved; WCAG 2.2 AA / Lighthouse ≥ 90 | **Accepted** |

---

### Cross-references

- `00_overview/glossary.md` — controlled vocabulary (states, ports, model ids).
- `02_architecture/backend_services.md` — service decomposition, the off-edge worker, server CommandBus.
- `02_architecture/ai_orchestration.md` — `ModelPolicyPort`, streaming, dose-engine separation.
- `03_data/` — `rx_generation_jobs`, `prescription_drafts`, RLS, server-side counters.
- `04_api/` — REST + **SSE** `GET /jobs/{id}/events` + `POST /generate → 202` contract (OpenAPI 3.1).
- `09_engineering_discipline/` — TDD/eval runner, review gates, golden-parity fixtures.

### Source artifacts grounding this spec

- Prototype (port-from, retire): `web/prescription-pad.html` (generate ≈4843–4980 [cosmetic rotator + blocking fetch], autosave ≈3905–3964, dose integ ≈5103–6003, voice ≈4298–4560, `printRx` ≈6682), `web/prescription-output.html` (`buildRxHtml` ≈690–1073 — duplicate renderer), `web/registration.html` (`COMMON_LABS` ≈2616, `IAP_SCHEDULE` ≈1221), `web/dose-engine.js`, `web/verify.html`.
- `dis/` foundation (`origin/feat/dis-plan`): `dis/src/core/state-machine.ts`, `dis/src/core/content-hash.ts`, `dis/src/core/env.schema.ts`, `dis/src/http/realtime/status-channel.ts`, `dis/src/ports/*`, `dis/src/wiring/{supabase,aws}.ts`, `dis/scripts/fitness-rules.json`, `02_architecture/{portability.md, sequence_diagrams.md}`, ADR-005 (Hono), ADR-006 (postgres driver).
- Clinical brain (`origin/sprint-2-saved`): `supabase/functions/_shared/dose-engine.ts`, `compute_doses` tool, three-tier severity, `prescription_audit`.

[TARGET-ARCHITECTURE DIGEST]: ../../  "Target-Architecture Digest — the load-bearing design brief; wins on conflict."
