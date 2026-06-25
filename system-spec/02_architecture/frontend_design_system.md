# Frontend Design System & UI/UX Architecture

> **Status:** Target-state rebuild specification. Build to THIS, not to the current `web/*.html` prototype.
> **Scope:** Frontend architecture, component library, design tokens, bilingual (English + Hindi/Devanagari) rendering, the 4-row + SVG-pictogram prescription, A4 print, accessibility, tablet ergonomics, voice UX, and streaming/loading states.
> **Authority:** Where this file disagrees with the prototype `web/` pages, this file wins. Where it disagrees with the TARGET-ARCHITECTURE DIGEST, the digest wins. The prototype is read-only reference for *what to preserve verbatim* (tokens, 4-row block, pictogram SVGs, print spacing, VAD voice loop, safety UX) — never for architecture.
> **Sibling docs:** Backend decomposition, DB schema, AI orchestration, ABDM/FHIR, and security live in their own `02_architecture/` / `03_data/` / `06_ai/` files. The TDD/eval operating model lives in `09_engineering_discipline/`. This file does not duplicate them; it consumes their ports.

---

## 1. Design Philosophy & Non-Negotiables

The frontend is held to the **same engineering standard as the backend**: hexagonal, ports/adapters, container/presentational split, state behind abstractions, command-bus + CQRS, design tokens (never inline styles), and a single canonical renderer for every artifact. The prototype's ~21,000 lines of duplicated inline CSS/JS across 8 self-contained HTML files is the anti-pattern being deleted.

### 1.1 Load-bearing UX invariants (must survive the rebuild)

| Invariant | Why it is non-negotiable |
|---|---|
| **Doctor perceived wait ≈ 0** to a reviewable prescription | The 150s Edge wall-clock + cosmetic spinner is the root product flaw. Speculative background generation + streaming + review-first open replace it. |
| **Every drug line is doctor-reviewed and signed** — never auto-finalized | Clinical-safety invariant (§9 of digest). An AI draft is `pending_review` until a human `SignOff` command. |
| **AI never produces a number that reaches paper** | The deterministic `DoseEngine` is the sole arithmetic authority. The UI binds dose controls to the engine, not to AI output. |
| **No colour-only status** | WCAG 2.2 AA + rubber-stamp-risk mitigation. Every safety state carries icon + text + colour. |
| **Pictograms are never icon-only** | Each icon is paired with Hindi + English text (false-confidence risk for low-literacy guardians). |
| **`esc()` on every dynamic value** | XSS discipline, preserved as the design-system's safe-render primitive. |
| **Bilingual fidelity** | English + Hindi (Devanagari, Noto Sans Devanagari) on every patient-facing line; inline SVG only, no external image dependencies. |

### 1.2 Architectural principles applied to the frontend

- **Container/presentational split.** Presentational components are pure functions of props (testable in isolation, no I/O). Containers wire ports, dispatch commands, and subscribe to query projections.
- **State behind abstractions.** No component imports a vendor SDK or calls `fetch`. All I/O flows through client-side **ports** (§4). The `anon-key + raw fetch` pattern in the prototype is forbidden.
- **Command-bus + CQRS on the client** (§5). Every mutation is a `Command` dispatched to one bus; reads come from cached query projections. This is the symmetric-actor seam that lets an autonomous AI agent join later as an additive subscriber.
- **Design tokens, not inline styles** (§3). Colour code (`blue=meds, red=investigations, black=else`) is encoded as semantic tokens.
- **One canonical renderer per artifact.** The duplicate `printRx` (pad) / `renderRx` (output station) is collapsed into a single `<PrintDocument>` (§7).

---

## 2. Frontend Stack & Project Layout

### 2.1 Stack (decisive)

| Concern | Choice | Rationale |
|---|---|---|
| Framework | **React 18 + TypeScript (strict)** SPA | Component model, mature a11y tooling, matches `dis/ui` direction. Boring, well-supported. |
| Build | **Vite** | Fast HMR, first-class TS, simple static output for GitHub Pages / Cloud-Run static serve. |
| Routing | **React Router** (hash or history; history if served from app origin) | 3-stage workflow + lookup + print station are distinct routes. |
| State | **Zustand** stores wrapped behind ports + a typed command/event bus | Minimal, no boilerplate, testable. The store is the *implementation detail behind* the bus, never imported by presentational components. |
| Server state / cache | **TanStack Query** for read projections (formulary, patients, std-Rx) | Caching, dedup, background refetch; reads only. Writes go through the command bus. |
| Forms | **React Hook Form + Zod resolvers** | Shared Zod DTOs with backend; validation parity. |
| Styling | **CSS custom properties (tokens) + CSS Modules** (or Tailwind preset mapped to the same tokens) | Tokens are the contract; the styling engine is swappable. |
| Streaming | Native **`EventSource` (SSE)** behind `RealtimePort` | Realtime WebSocket was removed for IO cost; SSE / status-row poll is the notify channel (digest §2/§3). |
| Voice | **MediaRecorder + Web Audio VAD** behind `TranscriptionPort` (dual-engine) | Port verbatim from prototype's VAD loop. |
| QR | **Client-side QR render** (e.g. `qrcode` lib) — no `api.qrserver.com` | No PHI in a QR URL; signed payload only (digest §7). |
| i18n | **Lightweight key-based dictionary** (`en` / `hi`) + Devanagari number/word maps from `DoseEngine` | UI chrome is bilingual-capable; clinical bilingual strings come from the engine, not the UI. |
| Test | **Vitest + React Testing Library + Playwright** (e2e), **axe-core** (a11y), Lighthouse CI | Fakes-only component suites <1s; a11y and print are gated. |

### 2.2 Hexagonal frontend layout (mirrors `dis/` discipline)

```
ui/
  src/
    design/            # tokens, theme, primitives — NO business logic, NO ports
      tokens.css       #   the single source of design tokens
      primitives/      #   <Button> <Field> <Pill> <Icon> <Sheet> ...
    components/        # presentational, pure(props) → JSX. NO fetch, NO ports.
      medicine/        #   <MedicineCard> <DoseAdjuster> <PictogramSidebar>
      prescription/    #   <PrescriptionReview> <SafetyPanel> <SignoffGate>
      patient/         #   <PatientHeaderStrip> <VitalsPanel> <GrowthTrend> <LabPills> <VaxChecklist>
      capture/         #   <DictationPad> <SectionChips>
      print/           #   <PrintDocument>  (THE canonical A4 renderer)
      shared/          #   <QrBlock> <StreamingStatus> <ProvenanceBadge>
    containers/        # wire ports + commands; one per workflow surface
      ReceptionContainer, NurseContainer, PadContainer,
      PrintStationContainer, LookupContainer
    ports/             # interfaces only — the client anti-corruption seams
      DataAccessPort, GenerationPort, TranscriptionPort, ConfigPort,
      PrintPort, RealtimePort, EventBus, CommandBus
    adapters/          # vendor edge; each has a __fakes__/ peer
      data/supabase-rest.ts        + __fakes__/
      generation/sse-generation.ts + __fakes__/
      transcription/dual-engine.ts + __fakes__/
      realtime/sse.ts              + __fakes__/
      config/env-config.ts
      print/browser-print.ts
    bus/               # CommandBus + EventBus impl + dose-engine binding
    state/             # zustand stores = query projections (read models)
    domain/            # shared Zod DTOs, command/event types, dose-engine (pure, ported verbatim)
    i18n/              # en.ts, hi.ts, devanagari maps
    app/               # router, providers, composition root (wiring)
```

**Frontend fitness rules** (CI merge-blockers, mirroring `dis/scripts/fitness-rules.json`):

| Rule | Enforces |
|---|---|
| `components_no_fetch` | No `fetch`/`XMLHttpRequest`/`EventSource` inside `components/` or `design/`. |
| `components_no_port_imports` | Presentational components receive data via props/callbacks, not ports. |
| `components_no_vendor_imports` | No `@supabase/*`, no `anthropic`, no model strings in `components/`. |
| `no_model_id_literals` | No `claude-*` string anywhere in `ui/` (model lives in `ConfigPort`). |
| `no_inline_color_literals` | No hex colours outside `design/tokens.css` (lint rule). |
| `single_print_renderer` | Only `components/print/PrintDocument` may emit the A4 layout. |
| `esc_on_dynamic_html` | `dangerouslySetInnerHTML` is forbidden except in a reviewed allowlist that routes through `esc()`. |

---

## 3. Design System: Tokens

Tokens are the contract. They are ported from the prototype's verified `:root` (prescription-pad.html lines 7–28) and promoted to semantic names. **Colour code as tokens: `blue = medicines, red = investigations, black = everything else`** is a hard rule with a CI lint.

### 3.1 Primitive (raw) tokens

```css
/* design/tokens.css — :root primitives */
:root {
  /* Palette (verbatim from prototype, promoted) */
  --c-blue-900:#1e3a6b;  --c-blue-600:#2d5aa0;  --c-blue-50:#e8edf8;
  --c-green-800:#1a5c35; --c-green-50:#e8f4ed;
  --c-red-800:#8b1a1a;   --c-red-50:#fdf0f0;
  --c-amber-800:#7a4a00; --c-amber-50:#fef8e8;
  --c-ink-900:#1a1a14;   --c-ink-700:#3d3d30;  --c-ink-400:#7a7a60;
  --c-paper:#f8f7f1;     --c-paper-card:#ffffff; --c-paper-sunk:#eeeadb;
  --c-line:rgba(26,26,20,.10); --c-line-strong:rgba(26,26,20,.18);

  /* Radii / rhythm */
  --r-sm:6px; --r-md:10px; --r-lg:14px;
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-6:24px;

  /* Type */
  --font-ui: system-ui, "Segoe UI", Roboto, sans-serif;
  --font-serif: Georgia, "Noto Serif", serif;        /* hospital wordmark */
  --font-deva: "Noto Sans Devanagari", sans-serif;    /* ALL Hindi text */
  --fs-100:11px; --fs-200:13px; --fs-300:14px; --fs-400:17px; --fs-500:20px;
  --lh-tight:1.3; --lh-base:1.5; --lh-loose:1.7;

  /* Elevation / motion */
  --shadow-1:0 1px 2px rgba(26,26,20,.06);
  --shadow-2:0 4px 16px rgba(26,26,20,.12);
  --dur-fast:120ms; --dur-base:200ms; --ease:cubic-bezier(.2,.7,.2,1);

  /* Touch (tablet-first, §10) */
  --touch-min:44px;       /* WCAG 2.2 AA min target */
  --touch-comfortable:56px;
}
```

### 3.2 Semantic tokens (the colour-code contract)

```css
:root {
  /* THE clinical colour code — never bypass */
  --sem-med:        var(--c-blue-900);   /* medicines  */
  --sem-med-bg:     var(--c-blue-50);
  --sem-investig:   var(--c-red-800);    /* investigations */
  --sem-investig-bg:var(--c-red-50);
  --sem-default:    var(--c-ink-900);    /* everything else */

  /* Safety severity (three-tier, from sprint-2-saved) — colour + always paired with icon+text */
  --sev-high-fg:var(--c-red-800);   --sev-high-bg:var(--c-red-50);
  --sev-mod-fg:var(--c-amber-800);  --sev-mod-bg:var(--c-amber-50);
  --sev-ok-fg:var(--c-green-800);   --sev-ok-bg:var(--c-green-50);

  /* Surfaces / text */
  --bg-app:var(--c-paper); --bg-surface:var(--c-paper-card); --bg-sunk:var(--c-paper-sunk);
  --fg-primary:var(--c-ink-900); --fg-secondary:var(--c-ink-700); --fg-muted:var(--c-ink-400);
  --border:var(--c-line); --border-strong:var(--c-line-strong);

  /* Provenance (AI vs clinician) — §8 */
  --prov-ai-accent:var(--c-blue-600);
  --prov-edit-accent:var(--c-green-800);
}
```

### 3.3 Token governance

- **Light theme is canonical** (clinical print fidelity). A high-contrast theme overrides only `--fg-*`, `--bg-*`, `--border*` and must keep the clinical colour code distinguishable without colour (icon+text always present).
- **Print tokens are frozen** (§7.4). Print never reads screen surface tokens; it has its own `@media print` token block matched byte-for-byte to the prototype's verified spacing.
- A **Storybook** (or Ladle) instance renders every primitive and component in both languages and both themes; visual-regression snapshots gate token changes.

---

## 4. Client Ports (anti-corruption seams)

No component touches a vendor directly. Each port is an interface with a real adapter and a `__fakes__` peer for sub-second tests. Ports mirror the digest §3 list.

```ts
// ports/DataAccessPort.ts — the ONLY Supabase/REST seam
export interface DataAccessPort {
  getPatient(uhid: string): Promise<PatientDTO>;
  searchPatients(q: string): Promise<PatientSummaryDTO[]>;
  getTodayQueue(): Promise<VisitSummaryDTO[]>;
  getFormulary(names: string[]): Promise<FormularyDrugDTO[]>;
  getStandardRx(icd10: string, name?: string): Promise<StandardRxDTO[]>;
  getGrowthHistory(patientId: string): Promise<GrowthPointDTO[]>;
  getLabHistory(patientId: string): Promise<LabResultDTO[]>;
  getVaxStatus(patientId: string): Promise<VaxRecordDTO[]>;
  getPreviousRx(patientId: string): Promise<PreviousRxDTO[]>;   // PII-stripped at the API
}

// ports/GenerationPort.ts — streaming, states are the contract (digest §2)
export type GenerationState =
  | 'idle' | 'streaming' | 'ready' | 'stale' | 'error' | 'timeout';

export interface GenerationPort {
  /** Click | speculative | AI-agent — indistinguishable. Returns a job handle. */
  request(cmd: RequestGenerationCommand, signal: AbortSignal): Promise<JobHandle>;
  /** Subscribe to a job's domain-event stream (SSE under the hood). */
  subscribe(jobId: string, on: (e: GenerationEvent) => void): Unsubscribe;
  state(jobId: string): GenerationState;
}

export type GenerationEvent =
  | { type:'GenerationStarted'; jobId:string }
  | { type:'ToolInvoked'; jobId:string; tool:string }
  | { type:'DraftDelta'; jobId:string; patch:RxPatch }        // progressive render
  | { type:'GenerationCompleted'; jobId:string; draft:RxDraftDTO; speculative:boolean }
  | { type:'GenerationFailed'; jobId:string; code:string; retryable:boolean };

// ports/TranscriptionPort.ts — dual-engine VAD (AI primary, Web Speech fallback)
export interface TranscriptionPort {
  start(onPartial:(t:string)=>void, onFinal:(t:string)=>void): Promise<void>;
  stop(): Promise<void>;
  readonly engine: 'ai' | 'web' | null;
  readonly available: boolean;
}

// ports/ConfigPort.ts — centralized URL/key/MODEL (NO hardcoded model anywhere)
export interface ConfigPort {
  apiBaseUrl: string;
  supabaseUrl: string;
  publishableKey: string;     // never the service-role key
  facilityId: string;
  // model id is resolved server-side via ModelPolicyPort; the client NEVER names a model
  featureFlags: Readonly<Record<string, boolean>>;
}

// ports/RealtimePort.ts — SSE / status-row projection
export interface RealtimePort {
  subscribeStatus(jobId:string, on:(s:JobStatusRow)=>void): Unsubscribe;
}

// ports/PrintPort.ts — abstracts the browser print/PDF path
export interface PrintPort {
  printDocument(node: PrintDocumentModel): Promise<void>;
  toPdfBlob(node: PrintDocumentModel): Promise<Blob>;   // for storage upload
}
```

`ConfigPort` is loaded once at boot from a Zod-validated config (fail-fast). The hardcoded dated model that broke prod is structurally impossible: no model id exists in `ui/`.

---

## 5. Client Command-Bus + CQRS (the symmetric-actor seam)

Every mutation is a `Command` with a uniform shape; results are domain `Event`s; reads are CQRS projections. This (a) gives free audit + optimistic UI + dedup (fixes the **3× `raw_dictation` write**), and (b) makes a future autonomous AI actor an additive subscriber — not a rewrite.

```ts
// bus/commands.ts
export type Command =
  | { kind:'SaveNote'; visitId:string; text:string }
  | { kind:'UpdateSectionChips'; visitId:string; sections:SectionId[] }
  | { kind:'RequestGeneration'; visitId:string; trigger:'click'|'speculative'|'agent' }
  | { kind:'AdjustDose'; lineId:string; params:DoseAdjustParams }
  | { kind:'AddMedicine'; visitId:string; drug:DrugRef }
  | { kind:'RemoveMedicine'; lineId:string }
  | { kind:'GiveVaccination'; visitId:string; vaccineId:string }
  | { kind:'SignOff'; draftId:string; doctorAck:boolean }
  | { kind:'Print'; draftId:string };

export interface CommandBus {
  dispatch(cmd: Command & { idempotencyKey: string; correlationId: string }): Promise<void>;
}
export interface EventBus {
  publish(e: DomainEvent): void;
  subscribe(on:(e:DomainEvent)=>void): Unsubscribe;
}
```

### 5.1 Dedup & autosave (kills the 3× write)

`SaveNote` is **debounced (one trailing dispatch per quiescent window) and content-hashed**: if the trimmed text hash equals the last persisted hash, the command is dropped *before* it reaches `DataAccessPort`. The prototype's debounced-3s save is preserved; the disabled 30s interval stays disabled (it was 19.7% of all DB writes). The bus, not the textarea handler, owns dedup, so every save path (autosave, blur, clear-patient, sign-off) is deduplicated uniformly.

### 5.2 Speculative generation trigger (the latency headline)

Each meaningful `SaveNote` and each `UpdateSectionChips` *also* emits a `DraftNoteUpdated` domain event. A debounced client subscriber computes a **content hash of `{note, patient_context_version, selected_sections}`** and dispatches a **speculative** `RequestGeneration` (trigger `'speculative'`) to the worker. Last-write-wins: a newer hash supersedes the in-flight run. By the time the doctor clicks **Generate**, a fresh `draft_ready` keyed to the current hash usually exists → the review opens at 0 ms (§11.2).

### 5.3 Client state machine (mirrors `dis/` `transition()`)

The pad's draft lifecycle is a pure reducer; invalid transitions throw and are never committed:

```
note_captured → generating → streaming → draft_ready → doctor_editing → signed → printed
                                                   ↘ superseded   ↘ failed
```

`SignOff` is the only transition from `draft_ready`/`doctor_editing` to `signed`, and it is gated by `<SignoffGate>` (§6.6). An autonomous agent reaches `signed` only by emitting the *same* `SignOff` command — identical fail-closed gating.

---

## 6. Component Library

Built once, shared between the pad and print station. Each is presentational (pure props) unless suffixed *Container*. Naming follows digest §3.

### 6.1 Inventory

| Component | Props (abbrev.) | Notes |
|---|---|---|
| `<PatientHeaderStrip>` | `patient, visit, allergies` | Sticky. UHID, name, age (+ corrected age if preterm), sex, weight. Allergy chips in `--sev-high`. |
| `<VitalsPanel>` | `vitals, editable` | Weight/height/HC/MUAC/temp/HR/RR/SpO2. Nurse-editable; doctor read-only. Missing-weight badge. |
| `<DictationPad>` | `value, onChange, voiceState` | Textarea + `<VoiceButton>` + autosave indicator + speculative trigger. Auto-grow. |
| `<SectionChips>` | `sections, selected, onToggle` | Multi-select chips; toggling re-keys the speculative hash. |
| `<MedicineCard>` | `line, severity, onAdjust, editable` | THE 4-row + pictogram block (§6.2). |
| `<DoseAdjuster>` | `line, bands, onCompute` | Slider/radios bound to the pure `DoseEngine` — never to AI numbers (§6.3). |
| `<PictogramSidebar>` | `pictogram` | Inline-SVG time/dose/food icons; icon + Hindi + English (§6.4). |
| `<PrescriptionReview>` | `draft, severity, provenance` | Streaming-aware review surface (§11.3). |
| `<SafetyPanel>` | `checks` | Allergy / interaction / max-dose / overall status; no colour-only. |
| `<SignoffGate>` | `severity, acked, onAck, onSign` | High → Sign disabled until ack; re-applied after every edit (§6.6). |
| `<PrintDocument>` | `model` | The single canonical A4 renderer (§7). |
| `<GrowthTrend>` | `points` | Weight/height history + trend arrows + WAZ. |
| `<LabPills>` | `labs` | Flagged results from `lab_results`; flag = icon+text+colour. |
| `<VaxChecklist>` | `schedule, given, dueAt` | IAP/NHM mutually exclusive; OVERDUE labels age-based. |
| `<QrBlock>` | `signedPayload` | Client-rendered QR of the signed (JWS) payload — no PHI URL. |
| `<StreamingStatus>` | `state, phase, partial` | Real progress, replaces the cosmetic rotator (§11). |
| `<ProvenanceBadge>` | `source` | AI-generated vs clinician-edited marker (§8). |

### 6.2 `<MedicineCard>` — the 4-row bilingual block (verbatim structure preserved)

The 4-row medicine format is a **domain rule**, ported structurally from the prototype:

| Row | Content | Token |
|---|---|---|
| **R1** | `GENERIC NAME IN CAPS (concentration)` | `--sem-med`, `--fs-300`/14px, weight 700 |
| **R2** | English dosing line | `--sem-med`, `--fs-200`/13px |
| **R3** | Hindi (Devanagari) dosing line | `--sem-med`, `--font-deva`, `--fs-200` |
| **R4** | Pictogram sidebar (inline SVG) | `--sem-med`, right rail, `width≈120px` |

```tsx
// components/medicine/MedicineCard.tsx (presentational)
export function MedicineCard({ line, severity, editable, onAdjust }: MedicineCardProps) {
  return (
    <article className="med-card" data-severity={severity} aria-label={line.genericCaps}>
      <div className="med-body">
        <h3 className="med-r1">{esc(line.genericCaps)} <span className="conc">({esc(line.concentration)})</span></h3>
        <p className="med-r2" lang="en">{esc(line.englishDose)}</p>
        <p className="med-r3" lang="hi">{esc(line.hindiDose)}</p>
        {severity !== 'ok' && <SeverityFlag severity={severity} reason={line.safetyReason} />}
        {editable && <DoseAdjuster line={line} bands={line.bands} onCompute={onAdjust} />}
      </div>
      <PictogramSidebar pictogram={line.pictogram} />  {/* R4 */}
    </article>
  );
}
```

R1–R3 are produced by the `DoseEngine` (`buildCalcString`, `FREQ_EN/HI`, `HINDI_*` maps), **not** by the AI and **not** by the UI. The card is a pure renderer of engine output.

### 6.3 `<DoseAdjuster>` — bound to the engine, never to AI

The slider/radios change *inputs* (weight, form, strength, frequency, duration); on every change the container calls the pure `DoseEngine.computeDose(...)` and re-renders R2/R3/R4 from the result. **The AI's proposed regimen carries no numeric fields**; if an AI number ever appears, the engine recomputes and a mismatch raises `REVIEW REQUIRED`. Rounding rules are the engine's (`roundToUnit`: syrups 0.5 ml, drops 0.1 ml, tablets 0.25). The UI displays, it never computes.

### 6.4 `<PictogramSidebar>` — inline SVG, never icon-only

Ported verbatim from the prototype's `DOSE_SVG` set (sunrise/sun/sunset/moon, spoon/drop/pill, lightning-PRN, food) and `TIME_LABELS` Devanagari map. **Every icon is paired with text in both scripts** (false-confidence mitigation, digest §8). Structure:

- Scheduled: time-icon row (each icon + Devanagari label) → dose icon + display → duration (`X दिन`) → food (`भोजन के बाद` / `खाली पेट`).
- PRN: lightning + `ज़रूरत पर` → dose → `≤N×/दिन`.

Icons map to USP/FIP-validated pictogram intent; a local comprehension test is a NABH quality artifact (owned by the clinical/compliance doc). SVGs are inline strings rendered through a vetted allowlist (no `dangerouslySetInnerHTML` on dynamic content).

### 6.5 `<SafetyPanel>` & severity rendering (no colour-only)

Three-tier severity (`high | moderate | ok`, from `sprint-2-saved`) renders as **icon + text + colour** everywhere:

| Severity | Icon | Text | Token |
|---|---|---|---|
| high | ⛔ (filled octagon) | "REVIEW REQUIRED" | `--sev-high-*` |
| moderate | ⚠ (triangle) | "Caution" | `--sev-mod-*` |
| ok | ✓ (check) | "Safe" | `--sev-ok-*` |

Allergy conflicts show an inline allergy-safe-alternative; formulary misses render `renderOmittedStubs()`-style red stubs.

### 6.6 `<SignoffGate>` — re-applied after every edit

Ports `applySignoffGate()`: high severity → **Sign disabled** until an ack checkbox is ticked; moderate → caution banner (sign allowed); ok → sign enabled. **Critically, the gate re-evaluates after any edit**, so a `high → edit → save` sequence cannot bypass the ack. The gate is the only path to the `signed` state.

---

## 7. The Canonical A4 Print Document

There is **exactly one** print renderer, `<PrintDocument>`, consumed by both the pad and the print station. The prototype's duplicate `printRx` (pad) and `renderRx` (output station 690–1073) collapse into this single component. A CI fitness rule (`single_print_renderer`) forbids any other A4 emitter.

### 7.1 Document model (input)

`PrintDocumentModel` is a pure data structure (header, patient meta, complaints/history, diagnoses, medicines[], investigations[], advice, vaccinations, emergency block, NABH badge, signed-QR payload, provenance line). It is produced from the signed prescription read model — never from live DOM.

### 7.2 Layout (frozen spacing — verbatim from prototype)

| Property | Value |
|---|---|
| `@page` margins | `12mm 10mm` |
| Body font | 12 px / line-height 1.5 |
| Medicine R1 | 14 px; R2–R3 | 12 px |
| Emergency block | 2-column grid |
| Header | doctor (left, 30%) · **"Radhakishan Hospital" centered (40%)** + `राधाकिशन हस्पताल` + address + NABH badge · emergency numbers (right, 30%) |
| Info strip | Date+time · Rx ID · UHID (bold) |
| Colour code | meds blue, investigations red, else black |
| Fonts | Georgia serif wordmark; Noto Sans Devanagari for all Hindi |
| Images | inline SVG only |

### 7.3 Mandatory print elements

- **NABH-accredited badge** on every prescription (digest: NABH mandatory).
- **Signed QR block** (`<QrBlock>`): client-rendered QR of the **ES256 JWS** signed payload (no PHI in the QR URL; `verify.html` resolves via a read-only server endpoint). Replaces the forgeable 6-char client-salt hash and the `api.qrserver.com` dependency (digest §7).
- **Provenance line**: "AI-assisted, doctor-reviewed" (digest §3/§8).
- Preterm: corrected age shown alongside chronological where relevant (computed client-side, no AI arithmetic).

### 7.4 Print isolation

`@media print` reads only the frozen print token block (§3.3). Screen chrome (sticky headers, buttons, streaming status) is `display:none` in print. Print fidelity is gated by a Playwright print-to-PDF snapshot test (pixel-diff against a golden A4).

---

## 8. Provenance & Anti-Rubber-Stamp UX

The verification-UI rubber-stamp risk is mitigated structurally:

- **AI-generated lines are visually distinct** from clinician edits via `<ProvenanceBadge>` + a left accent rail (`--prov-ai-accent` vs `--prov-edit-accent`). Editing a line flips its provenance and re-runs the signoff gate.
- **No colour-only status** anywhere (icon + text + colour).
- The streaming review forces the doctor to watch the draft assemble (diagnosis → meds → safety), discouraging blind sign-off.
- Sign-off requires an explicit gesture; for high severity, an explicit ack checkbox.
- Every sign-off is a `SignOff` command on the bus → audited with the model id+version actually used, token usage, and the final draft (NABH traceability, digest §8).

---

## 9. Accessibility (WCAG 2.2 AA, Lighthouse ≥ 90)

| Area | Requirement |
|---|---|
| Contrast | All text ≥ 4.5:1 (≥ 3:1 large). Tokens pre-validated; CI contrast check on `tokens.css`. |
| Status semantics | **No colour-only** signalling — icon + text always accompany colour (severity, lab flags, save status). |
| Keyboard | Full operability: tab order, focus rings (visible, `:focus-visible`), no traps. Generate, Adjust, Sign reachable and operable by keyboard. |
| Targets | Min 44×44 px (`--touch-min`), 24 px min spacing (WCAG 2.2 *Target Size (Minimum)*). |
| ARIA / landmarks | Proper roles; `<main>`/`<header>`/`<nav>`; live regions for streaming (`aria-live="polite"`) and save status. |
| Language | `lang="en"` / `lang="hi"` on the respective lines so screen readers switch voice; Devanagari announced correctly. |
| Forms | Every field labelled; errors announced; Zod messages tied to inputs via `aria-describedby`. |
| Motion | `prefers-reduced-motion` disables the streaming shimmer/animations. |
| Gating in CI | **axe-core** in component tests + **Lighthouse CI** ≥ 90 (a11y) as a merge gate. |

---

## 10. Tablet Ergonomics (first-class, not an afterthought)

The pad is used on a tablet at the OPD desk; touch, the dose slider, and voice are first-class.

- **Touch targets** ≥ `--touch-min` (44 px), primary actions (Generate, Sign, Voice) at `--touch-comfortable` (56 px).
- **`<DoseAdjuster>` slider** is the primary dose-input affordance on tablet — large thumb, snap to engine-rounded steps, numeric chip echoes the value; radios for frequency.
- **Reachability:** primary CTAs anchored within thumb reach (bottom action bar on narrow/portrait); sticky header stays for context.
- **Responsive layout:** the prototype's `max-width:860px` app column becomes a responsive grid — single column ≤ 768 px (portrait), two-pane (note | review) ≥ 1024 px (landscape).
- **Input ergonomics:** large tap chips for `<SectionChips>` and `<VaxChecklist>`; on-screen-keyboard-aware scrolling so the autosave indicator and Generate stay visible.
- **No hover-only affordances** — every hover action has a tap/focus equivalent.
- **Voice is one tap** from the dictation pad (§12).

---

## 11. Streaming & Loading States (perceived wait ≈ 0)

This replaces the cosmetic `load-msg`/ring spinner and the 150s synchronous wait. Real domain events drive the UI.

### 11.1 `GenerationPort` state contract

States: `idle | streaming | ready | stale | error | timeout` (digest §2/§3). Every request carries an `AbortController`; there is a **hard client deadline** → degraded UI (retry / manual edit / single-shot), **never an infinite spinner**. Retries use exponential backoff + jitter.

### 11.2 Review-first open (the headline)

On **Generate** click, the container compares the current note's content hash to the speculative job's hash:

| Condition | UX |
|---|---|
| Speculative hash **matches** current note | **Open `<PrescriptionReview>` at 0 ms** with a subtle "draft — confirm" badge; a background delta may still stream in. |
| Speculative draft **stale** (note changed) | Show inline "regenerating from your latest note…" and stream the fresh draft into the review as deltas arrive. |
| No speculative draft yet | Stream from scratch with the progressive renderer (§11.3). |

### 11.3 Progressive streaming render

`<StreamingStatus>` + `<PrescriptionReview>` subscribe by `job_id` (SSE via `RealtimePort`) and render domain events progressively — **diagnosis appears → medicines appear one by one → safety panel resolves**. `ToolInvoked` events surface a quiet "checking formulary / standard protocol / labs…" line (real progress, not a fake rotator). `DraftDelta` patches are applied incrementally; `GenerationCompleted` finalizes and runs the signoff gate.

### 11.4 Loading-state matrix

| State | UI |
|---|---|
| `idle` | Generate enabled; if a speculative draft is warming, a faint "draft warming…" hint. |
| `streaming` | Skeleton med-cards fill in; `aria-live` announces phase; cancel available. |
| `ready` | Full review; signoff gate applied. |
| `stale` | Inline "your note changed — regenerating" banner over the prior draft. |
| `error` | Inline error envelope (`{code, message, correlation_id, retryable}`); actions: Retry / Edit note / Single-shot. |
| `timeout` | Hard-deadline degraded UI: Retry (backoff) / Manual edit; never a hanging spinner. |

### 11.5 Optimistic UI for mutations

Bus commands apply optimistically (e.g. `AdjustDose` updates the card immediately, then reconciles on the engine/server event). Failures roll back with a non-colour-only toast carrying the `correlation_id`.

---

## 12. Voice UX

Ported verbatim from the prototype's VAD loop, re-homed behind `TranscriptionPort` (dual-engine, AI primary + Web Speech fallback).

### 12.1 Engine selection & fallback

- **Primary:** AI transcription (server-side STT) for accuracy on Hinglish clinical dictation.
- **Fallback:** Web Speech API (`en-IN`) when AI fails; failure is **sticky** within a session (`aiTranscribeFailed`) to avoid thrashing.
- The port exposes `engine: 'ai' | 'web' | null` so the UI can badge which is active.

### 12.2 Cost-optimized capture (verbatim parameters)

| Param | Value | Purpose |
|---|---|---|
| Persistent mic stream | one `getUserMedia` for the session | no per-chunk re-acquisition |
| VAD threshold | energy 25 (0–255) | suits OPD ambient noise |
| Silence send | 1500 ms pause | natural sentence boundary |
| Max chunk | 15 000 ms | cap even if still speaking |
| Min blob | 4000 bytes | drop silence-only blobs |
| `getUserMedia` constraints | echoCancellation, noiseSuppression, autoGainControl, 16 kHz | clean audio, low bandwidth |

### 12.3 Voice UX behaviour

- **One-tap** mic toggle on `<DictationPad>`; large target (`--touch-comfortable`).
- Live recording indicator (pulsing dot + "AI"/"Web" badge); partial transcripts stream into the textarea.
- Final transcript appends to the note → triggers a debounced `SaveNote` → which triggers speculative generation (§5.2). **Speaking during the consult warms the draft.**
- Permission-denied / no-mic states show an inline, non-colour-only message and gracefully fall back to typing.
- `aria-live` announces recording start/stop for screen-reader users.

---

## 13. Workflow Surfaces (containers)

The 3-stage OPD workflow maps to containers that wire ports + dispatch commands; presentational components are reused across them.

| Surface | Container | Key components | Notes |
|---|---|---|---|
| **Reception** | `ReceptionContainer` | demographics form, allergies, neonatal auto-section, labs entry, vax checklist, documents | Section order: Demographics → Visit → Complaints → Neonatal → Allergies → Vitals → Vaccination → Labs → Documents. UHID/receipt/token allocated **server-side** (no client `MAX(seq)+1`). DPDP guardian-consent capture. |
| **Nurse** | `NurseContainer` (same route) | `<VitalsPanel editable>` | Weight/height/HC/MUAC/temp/HR/RR/SpO2. |
| **Doctor pad** | `PadContainer` | `<PatientHeaderStrip>`, `<VitalsPanel readonly>`, visit summary, `<GrowthTrend>`, `<LabPills>`, `<VaxChecklist>`, `<DictationPad>`, `<SectionChips>`, `<PrescriptionReview>`, `<SignoffGate>` | Speculative generation, streaming review, sign-off, print. Missing-weight prompt at Generate (persists). |
| **Print station** | `PrintStationContainer` | `<PrintDocument>` | Auto-loads today's approved Rx; search/filter; renders the **identical** canonical document. |
| **Patient lookup** | `LookupContainer` | search + history | Read projections only. |

Re-selecting a "done" patient auto-loads the saved (signed, read-only) prescription via the print read model.

---

## 14. Frontend Testing & Quality Gates

Owned in detail by `09_engineering_discipline/`; the frontend's machine-checkable contribution:

| Gate | Tool | Blocks merge on |
|---|---|---|
| Component unit (fakes only, <1s) | Vitest + RTL | presentational purity, render correctness |
| Port contract tests | Vitest | `GenerationPort` state contract, `DataAccessPort` shape |
| Dose binding parity | Vitest | `<DoseAdjuster>` re-render matches `DoseEngine` golden fixtures (no AI arithmetic leaks) |
| a11y | axe-core + Lighthouse CI | WCAG 2.2 AA, Lighthouse a11y ≥ 90 |
| Print fidelity | Playwright print-to-PDF | pixel-diff vs golden A4 (frozen spacing) |
| Bilingual render | snapshot | Devanagari present on every patient-facing line; `lang` attrs correct |
| Fitness rules | custom script (extends `dis/`) | `components_no_fetch`, `no_model_id_literals`, `single_print_renderer`, `no_inline_color_literals`, etc. |
| Visual regression | Storybook + snapshots | token/component drift in both languages + themes |

---

## 15. Migration of the Prototype (frontend)

| Prototype source | Disposition |
|---|---|
| `web/dose-engine.js` | **Port verbatim** into `domain/dose-engine` (pure, no DOM); becomes the binding for `<DoseAdjuster>`. |
| `:root` tokens (pad lines 7–28) | **Promoted** to semantic `tokens.css` (§3). |
| `DOSE_SVG` + `TIME_LABELS` + `HINDI_*` maps | **Ported verbatim** into `<PictogramSidebar>` / `domain`. |
| `printRx` (pad 6682) + `renderRx` (output 690–1073) | **Collapsed** into one `<PrintDocument>`. |
| Voice VAD loop (pad 4298–4560) | **Ported verbatim** behind `TranscriptionPort`. |
| Autosave (pad 3905–3964) | **Re-homed** behind the bus with content-hash dedup (kills 3× write; 30s interval stays off). |
| Safety UX: `applySignoffGate`, missing-weight prompt, omitted-stubs, allergy alt | **Ported** into `<SignoffGate>` / `<SafetyPanel>` / review. |
| `esc()` | **Preserved** as the design-system safe-render primitive. |
| Cosmetic `load-msg`/ring + 150s sync wait | **Deleted** — replaced by `GenerationPort` streaming states (§11). |
| Raw `fetch` + anon-key in pages | **Deleted** — all I/O behind `DataAccessPort`. |
| 8 single-file HTML pages | **Replaced** by the componentized SPA. |

---

### Appendix A — Component ⇄ Port dependency (text diagram)

```
[Presentational components] ── props only ──▶ pure(props)→JSX  (NO ports, NO fetch)
        ▲
        │ props / callbacks
[Containers] ──▶ CommandBus ──▶ DataAccessPort / GenerationPort / PrintPort
        │            │
        │            └──▶ EventBus ◀── RealtimePort (SSE)  ◀── worker domain events
        └──▶ Query projections (TanStack Query + zustand read models)
                     ▲
                     └── DoseEngine (pure) binds <DoseAdjuster> / <MedicineCard>
ConfigPort (boot, Zod-validated) supplies URLs/keys/flags — NO model id anywhere.
```

### Appendix B — Open questions (flag, do not resolve here)

1. **Styling engine:** CSS Modules vs Tailwind-preset-on-tokens — both satisfy the token contract; pick during scaffolding to match `dis/ui` if it materializes.
2. **i18n depth:** UI chrome bilingual scope (full Hindi UI vs English chrome + bilingual clinical output). Default decided here: English chrome, bilingual clinical output; revisit with the doctor.
3. **PDF generation locus:** browser print-to-PDF (client) vs server render for the storage copy — `PrintPort.toPdfBlob` abstracts both; choose per cost/fidelity in the print/output backend doc.
