# Migration Roadmap — Prototype → Full System

> **Status:** Authoritative target-state **sequencing & execution plan** for the complete OPD-system rebuild (frontend + backend + database + AI). This file owns the *order of operations, the salvage inventory, the risk register, and the rollback strategy*. Build to **this**, not to the live `web/` + Supabase Edge-Function prototype. Where this roadmap disagrees with an upstream study report, this file wins; where it disagrees with a verified API fact, the file author flags it.
>
> **Scope boundary (read before you skim).** This document is the *conductor's score* — it decides **what is built in what order, and what we keep vs. retire**. It deliberately does **not** re-derive the deep designs that already live in siblings; it points to them and binds them into a phased plan:
> - The **latency design** (off-edge worker, speculative generation, SSE, the four mechanisms, sequence diagrams, the perceived-wait budget) lives in [`02_architecture/latency_ux_architecture.md`](../02_architecture/latency_ux_architecture.md).
> - The **table-by-table data migration** (expand/contract, backfill, dedupe, drift reconciliation, the DDL) lives in [`03_data/schema_migration.md`](../03_data/schema_migration.md) and [`03_data/schema_design.md`](../03_data/schema_design.md).
> - The **load-bearing decisions** (ADR-101…ADR-110) live in [`02_architecture/adrs.md`](../02_architecture/adrs.md).
> - The **TDD/eval operating model** (review gates, the eval runner, drift prevention, OpenAPI-as-truth) lives in [`09_engineering_discipline/`](../09_engineering_discipline/). This roadmap names **which gate blocks which phase**; it does not define the runner.
> - **Deployment topology & CI/CD** (Fly/Cloud Run, the Postgres-queue worker, secrets) live in [`07_deployment/infrastructure_cicd.md`](../07_deployment/infrastructure_cicd.md).
>
> **Lineage.** The plan is not greenfield. Two real branches are the substrate: `origin/feat/dis-plan` (the typecheck-clean hexagonal TS service under `dis/` — the *skeleton we copy*) and `origin/sprint-2-saved` (the 745-line pure dose engine, `compute_doses` tool, three-tier severity, `prescription_audit` migration, and 37 doctor-ratified decisions — the *clinical brain we port*). The migration is **mostly assembly and re-homing of proven parts**, not invention.

---

## How to read this file

| Field | Meaning |
|---|---|
| **Phase** | A shippable increment with its own acceptance gate. Phases are **ordered**; the order is load-bearing and justified in §3. |
| **Gate** | The machine-checkable condition that must be green before the phase is "done" and the next may start. Owned by `09_engineering_discipline/`; named here. |
| **Salvage** | An existing asset we *keep* (port verbatim, port-and-reshape, or seed-as-data). Catalogued in §2. |
| **Retire** | An existing asset we *delete* once its replacement is proven in shadow. The prototype is decommissioned, not patched. |
| **Rollback** | The pre-planned reverse path for the phase. Every phase has one before it starts (§6). |

---

## 0. The mandate, in one paragraph

We are migrating a **live, NABH-accredited, in-clinical-use** pediatric OPD system from a flawed prototype (8 single-file HTML pages + a synchronous Supabase Edge Function that dies at a 150 s wall) to a hexagonal, port/adapter, command-bus architecture where **the doctor's perceived wait to a reviewable prescription is ~0** and **the deterministic dose engine is the sole arithmetic authority**. The migration is **incremental and reversible**: every phase ships behind a feature flag, runs in **shadow** against the legacy path before any cutover, and has a pre-written rollback. We never run a destructive "drop-and-recreate" against a clinical database, and we never cut over a phase whose eval gate is red. The single non-negotiable sequencing decision — the spine of this entire roadmap — is that **the off-edge generation slice ships FIRST**, because it is the only change that stops doctors getting nothing after a five-minute wait, and because it can be delivered without touching the database schema or the frontend.

---

## 1. The live incident this plan is accountable to

This is not a theoretical re-architecture. The trigger is a reproduced, logged production failure.

**Evidence (from `console-log.md`, captured 2026-05-02 against the live project `ecywxuqhnlkjtdshpcbc`):**

```
prescription-pad.html:5035 Prompt sent to AI ... "clinical_note": "BHAWNA, 9 months 23 days, 6.07 kg ...
  Treatment Plan Syrup COmbiflam 2.5 ml 8 hourly for 5 days. Syrup Kofsooth 1.5 ml ...
  Syrup Allegra 2.5 ml 12 hourly ... Syrup Honda 2.5 ml 8 hourly for 3 days."
generate-prescription:1  Failed to load resource: the server responded with a status of 546 ()
prescription-pad.html:5101 Prescription generation error: Generation failed (HTTP 546)
```

A real patient (9-month-old, four syrups) produced an **HTTP 546** — Supabase's edge-runtime kill code — at the **150,000 ms** wall. The doctor saw an error and no prescription.

**Root-cause chain (each link is a phase target in this roadmap):**

| # | Cause | Where it lives in the prototype | Killed by |
|---|---|---|---|
| 1 | The Claude tool-use loop runs *inside* a Supabase Edge Function with a hard **150 s wall-clock**. | `supabase/functions/generate-prescription/index.ts` L485–613 (`toolUseLoop`), `MAX_TOOL_LOOPS = 10`. | **Phase 2** (off-edge worker). |
| 2 | Generation is **synchronous request/response** — the browser holds an open `fetch` for the whole 50–150 s; nothing is pre-computed during the consult. | `prescription-pad.html` `generatePrescription()` ~L4843–4980. | **Phase 4** (async job + speculative generation + SSE). |
| 3 | The model id is a **hardcoded dated string** (`"claude-sonnet-4-6"`, L518 & L637) with no central config — a model retirement breaks prod with no flip-switch. | `index.ts` L518, L637; anon key + URL hardcoded L14–16. | **Phase 1** (config/secrets centralization, `ModelPolicyPort`). |
| 4 | Survival hacks accreted *only* to beat the wall: same-model single-shot fallback, loop caps tuned to the ceiling, a cosmetic `msgs[]` spinner. | `singleShotFallback()` L617–658; `extractJSON` regex L662–682. | **Phases 2 & 4** (deleted, not ported). |
| 5 | The AI does dosing arithmetic in its head in the fallback path (`compute_doses` tool absent) → `row2_en` can disagree with `calc`. | `sprint-2-saved` fallback notes L1089–1099. | **Phase 3** (sealed dose engine + golden parity gate). |

**Accountability statement.** Phase 2 — by itself, with no schema or frontend change — converts the HTTP 546 into a delivered draft. That is why it is first. Everything after Phase 2 reduces *perceived* wait from "tolerable" to "~0" and pays down the structural debt the wall created.

---

## 2. Salvage inventory — what we keep, reshape, or retire

The most important discipline in this migration is honesty about what is already good. The prototype's **clinical knowledge and arithmetic are sound**; its **transport, persistence, and UI architecture are not**. We salvage aggressively at the value layer and retire ruthlessly at the plumbing layer.

### 2.1 Salvage class A — port **verbatim** (proven, pure, no I/O)

| Asset | Source (branch:path) | Destination | Why it survives untouched |
|---|---|---|---|
| **Dose engine** (745 LOC) — `computeDose`, `parseIngredients`, `calculateBSA`, `roundToUnit`, `buildCalcString`, `formatDoseDisplay`, `FREQ_EN/HI`, `HINDI_DROPS/ML/TABLETS/UNITS`, typed `ComputeDoseParams`/`ComputeDoseResult` | `origin/sprint-2-saved:supabase/functions/_shared/dose-engine.ts` | `core/dosing/` (pure module) | It is **the deterministic source of truth** (per `MEMORY.md`: "dose-engine is correct; Rx dosing errors come from AI mental math, not the engine"). Pure TS, zero DOM/IO → drops straight into `core/`. The *only* gap is missing JS↔TS golden fixtures — closed in Phase 3, **before** we trust it. |
| **`compute_doses` tool** (LLM batches all drugs, passes full `dosing_bands`, copies engine output verbatim) | `origin/sprint-2-saved:supabase/functions/generate-prescription/index.ts` L165+ | `Generation` context tool behind `ClinicalKnowledgePort` | Already enforces "AI copies, never computes." |
| **Three-tier severity** (`severity_server` / `severity_ai` / `severity_final = max(...)`) + `prescription_audit` telemetry shape | `origin/sprint-2-saved` `index.ts` + `20260428001000_prescription_audit.sql` | `prescribing.prescription_audit` (RLS upgraded) | The audit row is already the right shape for NABH traceability; only its blanket RLS policy is replaced (Phase 5). |
| **37 doctor-ratified clinical decisions** | `origin/sprint-2-saved:radhakishan_system/docs/15-decisions-2026-04-28.md` | Binding requirements input to evals | Domain truth signed off by Dr. Goyal — these are *requirements*, not code. |
| **4-row bilingual + SVG pictogram render logic** (R1 GENERIC CAPS(conc) / R2 English / R3 Devanagari / R4 inline-SVG sidebar) | `web/prescription-pad.html` `printRx()` ~L6682 | `<PrintDocument>` component (the **single** canonical A4 renderer) | The visual contract is correct and NABH-shaped; we collapse the *duplicate* renderer (`prescription-output.html` L690–1073) into one — see §2.3. |

### 2.2 Salvage class B — port **and reshape** (good logic, wrong coupling)

| Asset | Source | Reshape | Sibling that owns the detail |
|---|---|---|---|
| **5 progressive-disclosure tools** (`get_reference`, `get_formulary` w/ `condenseDrugForAI`, `get_standard_rx` ICD-10-first, `get_previous_rx` PII-strip, `get_lab_history`) | `index.ts` L40–468 | Promote behind `ClinicalKnowledgePort`; each becomes a DatabasePort/StoragePort-backed adapter with a `__fake__` peer. PII-strip becomes a *typed boundary*, not an ad-hoc `.map`. | `02_architecture/ai_orchestration.md` |
| **FHIR R4 NRCeS builders** (~1680 LOC) | `supabase/functions/generate-fhir-bundle/` | Pure `FhirCompositionPort` (`NrcesR4Adapter`) that takes *data, not a DB handle* (kills the N+1 formulary re-fetch); runs off-edge, event-driven on `PrescriptionSigned`. | `05_integration/` |
| **Skill prompt system** (`core_prompt.md`, 11 references, worked example) | `radhakishan_system/skill/` + Storage `website/skill/` | Freeze tool defs + skill prefix for prompt caching; pre-embed NABH block; volatile content after the cache breakpoint. | `02_architecture/ai_orchestration.md`, `latency_ux_architecture.md` §7 |
| **Registration domain data** (`COMMON_LABS` 39 tests `registration.html` L2616; `IAP_SCHEDULE` 13 milestones L1221) | `web/registration.html` | Extract to typed config consumed by `<VaxChecklist>` / `<LabPills>` components. | `02_architecture/frontend_architecture.md` |
| **Safety UX** (missing-weight prompt, preterm corrected/chronological age, `applySignoffGate()`, omitted-stub red rendering, `esc()`) | `web/prescription-pad.html` | Re-home into `<SafetyPanel>` / `<SignoffGate>` components; age arithmetic done **client-side** (AI does no arithmetic). | `02_architecture/frontend_design_system.md` |

### 2.3 Salvage class C — seed-as-data (content, not code)

| Asset | Source | Treatment |
|---|---|---|
| **530-drug formulary** + **446 ICD-10 protocols** + LOINC/SNOMED maps | `radhakishan_system/data/*.json` | Idempotent **seed scripts** against `catalog.*`. ETL-cleaned (mojibake `â€"`→em-dash, dedupe ICD-10, split verified vs. placeholder, map free-text codes to `catalog.concepts`). Detail in `03_data/schema_migration.md` §4.1, §7.3. |
| **Live patient/visit/clinical data** | Live DB (baseline = `sprint-2-saved:20260428000000_baseline_from_live.sql`) | Backfilled with `verification_status='legacy'`; uuid surrogates added, UHID retained as business key. Detail in `03_data/schema_migration.md` §4.3. |
| **Justified IO indexes** | `origin/fix/io-indexes:radhakishan_system/scripts/migration_io_indexes.sql` | Rolled into target migrations as `CREATE INDEX CONCURRENTLY` (verify no dupes vs. baseline). |

### 2.4 Retire — deleted once the replacement is shadow-proven

| Retired | Replaced by | Phase that retires it |
|---|---|---|
| 8 single-file HTML pages (~21k LOC duplicated inline JS/CSS) | Componentized Vite/TS SPA | Phase 6 |
| **Duplicate** print renderer (`prescription-output.html` `renderRx` L690–1073 vs. `prescription-pad.html` `printRx` L6682) | One `<PrintDocument>` | Phase 6 |
| Synchronous Edge-Function tool loop (`generate-prescription/index.ts`) | Off-edge Hono worker + Postgres queue | Phase 2 (legacy kept dark until Phase 8 cutover) |
| `singleShotFallback()`, the `msgs[]` cosmetic spinner, wall-tuned loop caps | Off-edge worker + SSE real progress + model-tier fallback | Phases 2 & 4 |
| `extractJSON()` regex JSON scraper | `strict:true` tools + `output_config.format` structured outputs | Phase 4 |
| Hardcoded URL/anon key/model literals in client + functions | `ConfigPort` / `ModelPolicyPort` / `SecretsPort` | Phase 1 |
| Blanket `anon_full_access` RLS over an anon key | Per-role RLS via `current_setting('app.role')` from JWT | Phase 5 |
| Forgeable 6-char client-salt QR hash + `api.qrserver.com` | ES256 JWS `SignaturePort`, client-rendered QR, server verify endpoint | Phase 7 |

---

## 3. The build order — and why this order, not another

The order below is **decisive**. It is chosen against three constraints, in priority order: **(1) stop patient harm fastest, (2) never block on an upstream phase you don't strictly need, (3) prove correctness before trusting automation.**

```
Phase 0  Decommission-safe baseline + flag harness  ─┐ (enablers; no behaviour change)
Phase 1  Config / secrets / ModelPolicyPort         ─┘
            │
Phase 2  OFF-EDGE GENERATION SLICE  ◀── ships FIRST after enablers (kills HTTP 546)
            │      (same DB, same frontend; legacy path stays as fallback)
Phase 3  Port dose-engine + growth-engine + golden parity GATE
            │
Phase 4  CommandBus + speculative-draft state machine + streaming GenerationPort
            │      (perceived wait → ~0)
Phase 5  DATABASE MIGRATION  (target schemas, server-side IDs, RLS, audit, composite FK)
            │
Phase 6  FRONTEND REBUILD  (componentized SPA, one print renderer, design tokens, a11y)
            │
Phase 7  ABDM / FHIR off-edge  (NrcesR4Adapter, AbdmGatewayPort, CryptoBox, JWS QR)
            │
Phase 8  SHADOW → CUTOVER → decommission prototype
```

### 3.1 The three ordering decisions that matter

**Decision A — Off-edge generation FIRST, ahead of DB and frontend.**
*Why:* It is the **only** change that converts the live HTTP 546 into a delivered prescription, and it can be shipped **without migrating the schema or rewriting a single HTML page**. The off-edge worker reads/writes the *existing* tables via the existing REST shape; the existing `prescription-pad.html` simply changes one `fetch` target (legacy edge URL → new `POST /generate` → `202 + job_id`). This decouples "stop the bleeding" from the much larger schema and frontend efforts, which can then proceed without time pressure. Putting the DB migration first would mean weeks of schema work while doctors keep getting 546s — unacceptable.

**Decision B — DB migration AFTER the latency fix, not before.**
*Why:* The latency fix (Phases 2 & 4) needs only **two new tables** (`rx_generation_jobs`, `ops.outbox`) and can carry the existing `prescriptions`/`visits` shape. The full schema migration (bounded-context schemas, server-side ID allocation, per-role RLS, composite FK, terminology integrity) is a *separate, riskier, reversibility-critical* operation on live clinical data. Sequencing it after the latency slice means it runs without an active patient-safety fire, and it inherits the now-proven off-edge worker as its write path.

**Decision C — Golden dose-engine parity BEFORE the speculative/AI automation that depends on it.**
*Why:* Phase 4 makes the system speculatively pre-generate drafts in the background. We must not let the engine auto-fill numbers onto paper until JS↔TS parity is proven byte-for-byte (`sprint-2-saved` ships the TS port *without* fixtures). Phase 3 lands ≥20 golden cases (rounding: syrups 0.5 ml / drops 0.1 ml / tablets 0.25; max-single/daily caps; bilingual strings) as a **merge-blocking gate**. Correctness is never traded for speed.

### 3.2 What can run in parallel

Phases are sequenced by *dependency*, not by *team*. With more than one workstream, these pairs are safely concurrent because they touch disjoint seams:

- **Phase 3** (pure engines + fixtures) ∥ **Phase 2** (worker transport) — engines are pure `core/`, the worker is `workers/`; they meet only at the tool boundary.
- **Phase 6** (frontend components) ∥ **Phase 5** (schema) — the frontend builds against the `DataAccessPort` interface; the adapter behind it is swapped at cutover.
- **Phase 7** (ABDM/FHIR) ∥ **Phase 6** — ABDM is an off-edge event subscriber on `PrescriptionSigned`; it does not block the pad.

> Parallelism on Windows uses git-worktree isolation per the `windows-parallel-agents` protocol — relevant to *how* we build, owned by `09_engineering_discipline/`.

---

## 4. The phases in detail

Each phase: **Goal → Deliverables → Gate → Salvage/Retire → Rollback.** DDL and UX depth are cross-referenced, not duplicated.

### Phase 0 — Decommission-safe baseline + flag harness *(enabler)*

- **Goal:** Make every subsequent change reversible *before* changing behaviour.
- **Deliverables:** (1) Adopt the `dis/` skeleton as the monorepo template (ports/adapters/`__fakes__`, Hono middleware, dbmate, state-machine, `fitness-rules.json`). (2) A **feature-flag ladder** with kill-switch: `ENABLED → SHADOW → OPT_IN_OPERATORS → *`. (3) Point-in-time backups verified restorable (`03_data/schema_migration.md` §6.3). (4) Extend `dis/scripts/fitness-rules.json` to all contexts; add `core_no_model_id_literals`.
- **Gate:** CI green on the empty skeleton (typecheck + all 6 fitness rules + the new model-id rule); a backup restore rehearsed on a throwaway branch DB.
- **Salvage:** `dis/` skeleton wholesale. **Retire:** nothing yet.
- **Rollback:** Trivial — no behaviour changed; delete the new repo scaffolding.

### Phase 1 — Config / secrets centralization + `ModelPolicyPort` *(enabler, unblocks the model-retirement failure class)*

- **Goal:** No hardcoded URL, key, or model string survives anywhere in client or server.
- **Deliverables:** `env.schema.ts` (Zod, fail-fast on boot — copy `dis/src/core/env.schema.ts`); `ConfigPort`, `SecretsPort` (Supabase secrets POC → AWS Secrets Manager prod), `ModelPolicyPort` (model id + effort/thinking per task, no dated literal in business code). Service-role key and `ANTHROPIC_API_KEY` removed from any client-reachable surface.
- **Gate:** `core_no_model_id_literals` passes (grep finds no `claude-*` in business code); boot fails loudly on any missing env var; secret-scan finds no keys in source/logs/history.
- **Salvage:** the model/effort *values* currently hardcoded (carried into the policy object). **Retire:** L14–16, L518, L637 literals in `index.ts`; anon key in all 8 HTML pages.
- **Rollback:** Revert the config module; the prototype's hardcoded values still work. Zero data risk.

### Phase 2 — Off-edge generation slice **(SHIPS FIRST — kills HTTP 546)**

- **Goal:** Convert the synchronous 150 s-capped edge loop into a durable off-edge job. **This phase alone delivers a prescription where the prototype delivered an error.**
- **Deliverables:** (1) Node 20 + Hono **worker** (`workers/generation`) hosting the tool-use loop, pulling from a **Postgres job queue** (the `dis/` `M004_dis_jobs` pattern: `topic/payload/status/attempts/locked_until/locked_by` + partial index on ready jobs). (2) `POST /generate → 202 {job_id}` thin API; the worker runs with **no 150 s ceiling** (Cloud Run = 60-min request timeout). (3) Two new tables only: `prescribing.rx_generation_jobs` (status read-model) + `ops.outbox` — *no other schema change*. (4) `prescription-pad.html` retargeted: one `fetch` → enqueue + short-interval **status-row poll** for the result (full SSE arrives in Phase 4). (5) The 5 tools (Class-B salvage) re-homed behind `ClinicalKnowledgePort`; `Promise.all` parallel execution preserved. (6) Delete `singleShotFallback`, the wall-tuned caps, the `msgs[]` spinner.
- **Gate:** The Phase-2 acceptance fixture — **the BHAWNA 4-syrup case from `console-log.md`** — completes end-to-end with `stop_reason:"end_turn"`, zero HTTP 546, and the legacy and new outputs diff-match in shadow (§8). `GenerationPort` contract test: never an infinite spinner.
- **Salvage:** tools, severity, `compute_doses`, `prescription_audit` (Class A/B). **Retire:** the edge tool loop (kept *dark* as fallback until Phase 8), fallback/spinner/regex hacks.
- **Rollback:** **Flip the flag back to the legacy edge URL.** The two new tables are additive (no destructive change); they can be left in place or dropped via their `.rollback.sql`. This is the cleanest rollback in the plan — the legacy path is untouched.

> Deep design: `02_architecture/latency_ux_architecture.md` §2.1 (M1 worker), §5.1 (`rx_generation_jobs`); ADR-101.

### Phase 3 — Port dose-engine + growth-engine + **golden parity GATE**

- **Goal:** Seal the arithmetic authority into `core/` and *prove* it before any automation trusts it.
- **Deliverables:** `dose-engine.ts` → `core/dosing/` as the pure `DoseEnginePort`; growth z-scores → deterministic `GrowthEnginePort` (same source-of-truth discipline). Server re-checks AI-proposed doses **byte-for-byte** (no tolerance — reject the 20 % client override); mismatch → `REVIEW REQUIRED`. **≥20 golden JS↔TS parity fixtures** as a merge-blocker.
- **Gate:** Golden parity fixtures green (the gate `sprint-2-saved` never had); `core_no_fetch`/`core_no_sql_literals` clean on the new modules.
- **Salvage:** `dose-engine.ts` verbatim (Class A). **Retire:** any AI mental-math path (already fenced by `compute_doses`).
- **Rollback:** Engines are pure and side-effect-free; revert the module. The worker falls back to the Phase-2 `compute_doses` behaviour. No data risk.

> Deep design: ADR-105; `02_architecture/ai_orchestration.md` (dose separation); gate owned by `09_engineering_discipline/`.

### Phase 4 — CommandBus + speculative-draft state machine + streaming `GenerationPort` *(perceived wait → ~0)*

- **Goal:** The headline UX deliverable. By the time the doctor clicks **Generate**, a fresh draft usually already exists.
- **Deliverables:** (1) Build the **CommandBus → EventBus** (the one net-new construct `dis/` lacks). (2) **Speculative generation:** each meaningful `raw_dictation` autosave / section-chip change emits a `DraftNoteUpdated` command → debounced background worker (re)generates a draft keyed by a **content hash** of `{note, patient_context_version, selected_sections}`; last-write-wins supersedes in-flight runs. (3) **End-to-end SSE** (`GET /jobs/{id}/events`) emitting `GenerationStarted / ToolInvoked / DraftDelta / GenerationCompleted / GenerationFailed`; the pad renders progressively. (4) The pure `transition(state, event)` state machine (copy `dis/src/core/state-machine.ts`) as the safety spine: `note_captured → generating → streaming → draft_ready → doctor_editing → signed → printed` (+ `superseded`, `failed`); invalid transitions throw and are never persisted. (5) `strict:true` tools + structured outputs retire `extractJSON`. (6) The **write-amplification fix** (debounce + dedup) collapses the 3× `raw_dictation` write.
- **Gate:** The **perceived-wait budget** in `latency_ux_architecture.md` §10 met on the fixture set; `GenerationPort` state contract tests pass (states: `idle | streaming | ready | stale | error | timeout`, AbortController on every request, hard client deadline → degraded UI, never an infinite spinner); state-machine exhaustiveness test green.
- **Salvage:** the autosave-to-`raw_dictation` mechanism (its events become commands). **Retire:** synchronous click→wait coupling.
- **Rollback:** Disable speculative generation via flag → falls back to Phase-2 on-click async generation (still off-edge, still no 546). The CommandBus is additive; reads continue to work.

> Deep design: `02_architecture/latency_ux_architecture.md` §2.2–2.5, §4 (sequence diagrams), §8 (sign-off); ADR-102, ADR-110.

### Phase 5 — Database migration *(the reversibility-critical phase)*

- **Goal:** Move live clinical data to the target bounded-context schemas, **forward-only and reversible**, with the 11 critical flaws fixed.
- **Deliverables (orchestrated by `03_data/schema_migration.md`, summarized here):** bounded-context schemas `catalog / clinical / prescribing / identity / abdm / ops`; **server-side ID allocation** (`clinical.uhid_counter` via `UPDATE … RETURNING` under row lock, `SECURITY DEFINER` — kills the client-side `MAX(seq)+1` race); **per-role RLS** via `current_setting('app.role'/'app.doctor_id'/'app.facility_id')` (the `dis/` `M008` pattern — portable Supabase↔RDS); **append-only `ops.audit_log`** with BEFORE UPDATE/DELETE triggers that raise (`dis/` `M002`); **composite FK** `(visit_id, patient_id) REFERENCES visits(id, patient_id)`; terminology integrity (`catalog.concepts`, `pg_trgm` fuzzy diagnosis match); formulary as a contract-tested KB (Ajv `formulary.v1.json`). Migration mechanics: **expand/contract**, baseline → ETL-clean → backfill `legacy` → uuid+UHID-business-key → **dedupe abort-on-duplicate** (`dis/` `M007`) → reconcile `prescriptions.patient_id` drift → cutover making FKs/constraints mandatory only after rollout.
- **Gate:** dbmate CI verifies **up → down → up + pg_dump schema-diff** for every migration; the integrity-validation SQL hard-asserts (no orphan FKs, no duplicate UHIDs, RLS deployed dark and tested); abort-on-duplicate dry-run is clean.
- **Salvage:** all live data (Class C), the IO indexes (`fix/io-indexes`), `prescription_audit`. **Retire:** blanket RLS, client-side ID allocation, any `drop table … cascade` monolith DDL.
- **Rollback:** Per-migration `.rollback.sql` (down path CI-verified) for in-flight rollback; for cutover, the **expand/contract** design means the old columns/tables remain readable until the contract step, so a cutover abort reverts reads to the legacy shape. Point-in-time restore is the last resort (`§6.3`). **No destructive step runs without a verified backup.**

> Deep design: `03_data/schema_migration.md` (whole file), `03_data/schema_design.md`; ADR-107.

### Phase 6 — Frontend rebuild

- **Goal:** Replace the 8 HTML pages with a componentized SPA held to the same architectural standard as the backend.
- **Deliverables:** Vite + TS SPA; client-side **ports** (`DataAccessPort`, `GenerationPort`, `TranscriptionPort` dual-engine VAD, `ConfigPort`, `PrintPort`, `EventBus`/`CommandBus`, `RealtimePort`); container/presentational split; **client-side CQRS command bus** (every mutation a command → audit, optimistic UI, dedup). Components: `<PatientHeaderStrip>`, `<DictationPad>`, `<MedicineCard>`, `<DoseAdjuster>` (bound to the pure engine), `<PrescriptionReview>`, **`<PrintDocument>`** (the *single* canonical A4 renderer — eliminate the duplicate), `<SafetyPanel>`, `<SignoffGate>`, `<VaxChecklist>`, etc. Design tokens (blue=meds / red=investigations / black=else); WCAG 2.2 AA; Lighthouse ≥90; no colour-only status; tablet-first touch + dose slider + voice.
- **Gate:** Lighthouse ≥90, a11y audit clean (no colour-only status — the rubber-stamp risk), `<PrintDocument>` snapshot matches the NABH-shaped output, component tests green.
- **Salvage:** print render logic, safety UX, registration domain data (Class A/B). **Retire:** 8 HTML pages, duplicate renderer, inline JS/CSS.
- **Rollback:** Serve the legacy GitHub-Pages HTML at the existing route behind the flag; the new SPA is deployed to a parallel path until `OPT_IN_OPERATORS → *`.

> Deep design: `02_architecture/frontend_architecture.md`, `frontend_design_system.md`; ADR-104.

### Phase 7 — ABDM / FHIR off-edge

- **Goal:** Decouple ABDM/FHIR from sign-off; fix the security gaps.
- **Deliverables:** pure `FhirCompositionPort`/`NrcesR4Adapter` (takes data, not a DB); `AbdmGatewayPort` (session/auth, `on-*` callbacks, push, consent) with real request-auth (verify JWS vs. ABDM CM JWKS, fail-closed); `CryptoBoxPort` (**Fidelius — Curve25519 Short-Weierstrass**); `SignaturePort` (ES256 JWS — replaces the forgeable 6-char QR hash; client-rendered QR, server verify endpoint, no PHI in URL); `abdm_outbox`/`abdm_inbox`. Sequencing M1 (ABHA at registration) → M2 (HIP push) first; M3 (HIU) deferred. Runs event-driven on `PrescriptionSigned` — **sign-off never blocks on it**.
- **Gate:** FHIR-validator CI gate green; JWS QR verifies against the server endpoint; HFR/HPR IDs present in config/secrets (the `HOSPITAL.hfr_id=""` blocker resolved).
- **Salvage:** the FHIR builders (Class B). **Retire:** forgeable QR hash, `api.qrserver.com` dependency, N+1 formulary re-fetch.
- **Rollback:** ABDM is an additive subscriber; disable the subscriber → core prescription flow is unaffected (it never depended on ABDM).

> Deep design: `05_integration/`; ADR-108.

### Phase 8 — Shadow → cutover → decommission

- **Goal:** Retire the prototype only after the new system is *proven equal-or-better* in production shadow.
- **Deliverables:** Run speculative/off-edge generation in **shadow** (live traffic generates both legacy and new outputs; diff and log, surface only legacy to the doctor). Advance the flag ladder `ENABLED → SHADOW → OPT_IN_OPERATORS → *`. Cut over context-by-context behind the kill-switch. Decommission the Edge Function, the 8 HTML pages, the blanket RLS.
- **Gate:** Shadow diff within tolerance over a rolling window; eval suite green (dose parity, NABH fields present, no PII leakage, JSON-schema conformance, safety invariants — `09_engineering_discipline/`); kill-switch rehearsed.
- **Rollback:** The flag ladder *is* the rollback — drop any context back one rung (`* → OPT_IN_OPERATORS → SHADOW`) instantly; the legacy path stays warm until the final decommission commit.

---

## 5. Phase → gate → dependency matrix

| Phase | Hard prerequisite | Blocking gate (owned by `09_…`) | Ships behind flag | Data-destructive? |
|---|---|---|---|---|
| 0 Baseline + flags | — | Skeleton CI + restore rehearsal | n/a | No |
| 1 Config / `ModelPolicyPort` | 0 | `core_no_model_id_literals`, secret-scan | n/a | No |
| 2 **Off-edge slice** | 1 | BHAWNA fixture e2e, no 546, shadow diff | Yes (legacy URL fallback) | No (additive tables) |
| 3 Dose/growth engines | 0 | **Golden JS↔TS parity** ≥20 cases | n/a (pure) | No |
| 4 CommandBus + speculative + SSE | 2, 3 | Perceived-wait budget, `GenerationPort` contract, state-machine exhaustiveness | Yes (speculative toggle) | No (additive) |
| 5 **DB migration** | 2 (worker write path) | dbmate up↔down↔up, integrity asserts, dedupe dry-run | Expand/contract dark | **Yes — gated by backup + rollback SQL** |
| 6 Frontend rebuild | 1; consumes 4’s `GenerationPort` | Lighthouse ≥90, a11y, `<PrintDocument>` snapshot | Yes (parallel route) | No |
| 7 ABDM / FHIR | 5 (schemas), 4 (`PrescriptionSigned`) | FHIR-validator, JWS verify | Yes (subscriber toggle) | No |
| 8 Shadow → cutover | all above | Shadow diff + full eval suite | The flag ladder itself | Decommission only after green |

---

## 6. Rollback strategy — every phase has a reverse gear

The governing principle: **no forward step is taken until its reverse step is written and rehearsed.** Three tiers of rollback exist, mapped to the kind of change:

### 6.1 Flag rollback (Phases 2, 4, 6, 7) — instant, zero data risk
Behavioural phases ship behind the `ENABLED → SHADOW → OPT_IN_OPERATORS → *` ladder with a **kill-switch** (the API gateway returns `503` on writes for the disabled context). Reverting = dropping the flag one rung. The legacy path stays warm. Phase 2's rollback — *re-point the pad's `fetch` to the legacy edge URL* — is the safety net for the entire incident response: even if the whole new stack misbehaves, the prototype's edge function (with its 546 risk, but a known quantity) is one flag away.

### 6.2 Migration rollback (Phase 5) — per-migration + cutover-level
- **In-flight:** every dbmate migration has a CI-verified `.rollback.sql` (`dis/` ships M001–M008 each with one). `up → down → up` is a merge gate, so a down path is never theoretical.
- **Cutover:** the **expand/contract** design keeps legacy columns/tables readable through the expand and migrate phases; the destructive *contract* step is the last and is gated by a verified backup. Aborting before contract reverts reads to the legacy shape with no data loss. Detail: `03_data/schema_migration.md` §6.2.

### 6.3 Last-resort rollback — point-in-time restore
For any unrecoverable state, Supabase PITR (POC) / RDS snapshots (prod) restore the database to a known-good timestamp. This is the floor under the whole plan and is rehearsed in **Phase 0** before any phase runs. Per the global safety rule, **any step that deletes, drops, or force-pushes data stops for explicit human confirmation even with auto-approve on.**

---

## 7. Risk register

Ranked by *expected harm* (likelihood × clinical/operational impact). "Owner-phase" is where the mitigation lands.

| # | Risk | Likelihood | Impact | Mitigation | Owner-phase |
|---|---|---|---|---|---|
| R1 | **The incident recurs** — generation still times out or fails silently. | Med | **Patient harm** (no Rx) | Off-edge worker has no 150 s wall; hard client deadline → *degraded UI with retry/manual edit*, **never an infinite spinner**; BHAWNA fixture is a merge gate. | 2, 4 |
| R2 | **AI dose reaches paper without engine validation** (the fallback mental-math path). | Med | **Patient harm** (wrong dose) | Sealed `DoseEnginePort`; server re-check byte-for-byte; mismatch → `REVIEW REQUIRED`; golden parity gate **before** speculative automation; `SignoffGate` re-armed on every edit. | 3, 4 |
| R3 | **Data loss / corruption during DB migration.** | Low | **Severe** (clinical-legal records) | Forward-only dbmate + CI-verified `.rollback.sql`; expand/contract (no early destructive step); abort-on-duplicate dry-run; verified PITR before contract; human-confirm on any drop. | 5 |
| R4 | **Speculative generation cost blow-up** (every keystroke triggers a run). | Med | Cost | Content-hash keying + debounce + last-write-wins supersede; `ops.cost_ledger` + cost guardrail (`dis/` `cost-guardrail.ts`); prompt caching cuts per-run cost. | 4 |
| R5 | **Model retirement breaks prod** (the cause already seen). | Med | Outage | `ModelPolicyPort` (no dated literal in code, `core_no_model_id_literals` gate); model-tier fallback Opus→Sonnet on overload; `stop_reason:"refusal"` guard before reading content. | 1, 4 |
| R6 | **RLS migration locks out clinicians or over-exposes data.** | Low | Severe (DPDP) | RLS deployed **dark** and tested against each role before enforcement; portable `current_setting` pattern verified on a branch DB; no DELETE policy on clinical/audit. | 5 |
| R7 | **Shadow diff is noisy → false "regression" signals stall cutover.** | Med | Schedule | Diff on the *clinically material* fields (dose, drug, severity), tolerate cosmetic/ordering drift; rolling-window acceptance, not single-run. | 8 |
| R8 | **PII leaks to the model** through a new tool or the speculative path. | Low | Severe (DPDP) | PII-strip is a *typed boundary* in `get_previous_rx`/visit-summary (not ad-hoc `.map`); eval gate asserts no-PII-leakage; pino PII redactor on all logs. | 2, 4, 8 |
| R9 | **Frontend cutover degrades the print output** (NABH non-compliance). | Low | Compliance | One `<PrintDocument>` with a snapshot gate against the NABH-shaped reference; parallel-route rollout. | 6 |
| R10 | **ABDM coupling blocks sign-off** (as today's builder re-fetches and couples). | Low | Workflow | ABDM/FHIR off-edge, event-driven on `PrescriptionSigned`; subscriber toggle; sign-off path has zero ABDM dependency. | 7 |
| R11 | **Scope creep — "rewrite everything at once."** | Med | Schedule/quality | This roadmap's phase gates are the discipline; Phase 2 must ship before any non-incident work; parallelism only on disjoint seams (§3.2). | all |

---

## 8. Shadow & cutover protocol (the safety rail under §8 of the build order)

**Shadow** is the load-bearing de-risking mechanism: the new path runs against *live traffic* but its output is **logged and diffed, never surfaced** to the doctor, until proven. Mechanics:

1. On each real generation, the gateway enqueues **both** the legacy edge call (surfaced) and the new off-edge job (shadowed).
2. A diff worker compares the two on **clinically material fields** — `medicines[].generic`, computed dose (`row2_en`/`calc`), `severity_final`, `investigations`, `safety.overall_status` — and writes a `shadow_diff` row.
3. Acceptance is a **rolling-window** threshold (not a single run): material-field agreement over N consecutive generations, with every disagreement triaged.
4. Only then does the flag advance `SHADOW → OPT_IN_OPERATORS` (a named subset of clinicians) `→ *`.
5. The **kill-switch** (gateway `503` on the context's writes) is the instant reverse at every rung.

This protocol applies first and most rigorously to **Phase 2** (does the off-edge worker produce the same prescription the legacy path did, minus the 546?) and again at **Phase 8** for the speculative/streaming whole.

---

## 9. Definition of "migration complete"

The migration is done — and the prototype decommissioned — when **all** hold:

- [ ] The BHAWNA incident fixture (and the frozen pediatric eval set) generate end-to-end with **zero HTTP 546**, doctor perceived wait within the §10 budget of `latency_ux_architecture.md`.
- [ ] Golden JS↔TS dose-engine parity is a merge-blocking gate and green.
- [ ] No `claude-*`, URL, or anon-key literal exists in business code (`core_no_model_id_literals` + secret-scan green).
- [ ] Live clinical data is in the target bounded-context schemas with per-role RLS enforced, append-only audit live, server-side ID allocation in place, and the composite FK enforced — with every migration's `.rollback.sql` CI-verified.
- [ ] One `<PrintDocument>` renderer; the duplicate is deleted; Lighthouse ≥90 and a11y clean.
- [ ] ABDM/FHIR runs off-edge, event-driven, with JWS-signed QR and real gateway auth; sign-off never blocks on it.
- [ ] The eval suite (dose parity, NABH fields, no-PII-leak, JSON-schema conformance, safety invariants, FHIR validation, `GenerationPort` state contract) gates the pipeline — owned by `09_engineering_discipline/`.
- [ ] The Edge Function, the 8 HTML pages, and the blanket RLS policy are removed in a single decommission commit, after a green shadow window.
- [ ] **The AI-first path is an additive subscriber, not a rewrite** — a future autonomous agent emits `RequestGeneration` + `SignOff` on the same CommandBus, fail-closed at the same `SignoffGate`.

---

## 10. Cross-references

| Topic | Authoritative sibling |
|---|---|
| Off-edge worker, speculative generation, SSE, sequence diagrams, perceived-wait budget | [`02_architecture/latency_ux_architecture.md`](../02_architecture/latency_ux_architecture.md) |
| Load-bearing decisions (ADR-101…110) | [`02_architecture/adrs.md`](../02_architecture/adrs.md) |
| Table-by-table data migration, expand/contract, rollback SQL, drift reconciliation | [`03_data/schema_migration.md`](../03_data/schema_migration.md) |
| Target schema (bounded-context schemas, server-side IDs, composite FK, terminology) | [`03_data/schema_design.md`](../03_data/schema_design.md) |
| AI orchestration (`ModelPolicyPort`, tools, caching, dose separation, fallbacks) | [`02_architecture/ai_orchestration.md`](../02_architecture/ai_orchestration.md) |
| Backend service decomposition, CommandBus, state machine | [`02_architecture/backend_services.md`](../02_architecture/backend_services.md) |
| Frontend components, ports, design system, a11y | [`02_architecture/frontend_architecture.md`](../02_architecture/frontend_architecture.md), [`frontend_design_system.md`](../02_architecture/frontend_design_system.md) |
| ABDM / FHIR / crypto / JWS QR | [`05_integration/`](../05_integration/) |
| Security, RLS, DPDP, PII boundaries | [`06_security/`](../06_security/) |
| Deployment topology, Postgres-queue worker, CI/CD | [`07_deployment/infrastructure_cicd.md`](../07_deployment/infrastructure_cicd.md) |
| TDD/eval gates, review protocol, drift prevention | [`09_engineering_discipline/`](../09_engineering_discipline/) |

### Key source references (branch-qualified)

- **Incident evidence:** `console-log.md` L15–16 (HTTP 546 at 150,000 ms, BHAWNA 4-syrup case).
- **The flaw:** `supabase/functions/generate-prescription/index.ts` — `toolUseLoop` L485–613, 120 s abort L499–501, hardcoded model L518/L637, hardcoded URL/anon key L14–16, `singleShotFallback` L617–658, `extractJSON` L662–682.
- **Foundation (`origin/feat/dis-plan`):** `dis/migrations/M001–M008` (+ `.rollback.sql`); `dis/scripts/fitness-rules.json` (6 rules); `dis/src/core/state-machine.ts` (`transition`); `M004_dis_jobs.sql` (queue pattern); `M008_rls_policies.sql` (`current_setting` RLS); `M007_dedupe_unique_indexes.sql` (abort-on-duplicate); `dis/src/core/{env.schema,promotion,cost-guardrail,content-hash}.ts`.
- **Clinical brain (`origin/sprint-2-saved`):** `supabase/functions/_shared/dose-engine.ts` (745 LOC, exports verified: `computeDose`, `parseIngredients`, `calculateBSA`, `roundToUnit`, `buildCalcString`, `formatDoseDisplay`, `FREQ_EN/HI`, `HINDI_DROPS/ML/TABLETS/UNITS`); `generate-prescription/index.ts` (`compute_doses` tool, three-tier severity); `20260428000000_baseline_from_live.sql`; `20260428001000_prescription_audit.sql`; `radhakishan_system/docs/15-decisions-2026-04-28.md` (37 decisions).
- **IO indexes:** `origin/fix/io-indexes:radhakishan_system/scripts/migration_io_indexes.sql`; `radhakishan_system/docs/system/10-index-proposal.md`.
- **Prototype to retire:** `web/prescription-pad.html` (generate L4843–4980, `printRx` L6682, autosave L3905–3964); `web/prescription-output.html` (duplicate renderer L690–1073); `web/dose-engine.js`; `web/registration.html` (`COMMON_LABS` L2616, `IAP_SCHEDULE` L1221).
