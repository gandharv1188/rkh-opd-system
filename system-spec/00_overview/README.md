# 00 — System Specification: Master Index & Reading Order

> **What this is.** The single entry point to the **complete target-state rebuild specification** for the Radhakishan Hospital pediatric OPD prescription system — product, frontend, backend services, database (+ migration of the live data), AI generation, integrations (ABDM/FHIR), security/compliance, deployment, and the engineering-discipline & evals operating model. It is the **hub**; every other file under `system-spec/` is a spoke authored to conform to this index, to [`canonical_decisions.md`](canonical_decisions.md), and to the Target-Architecture Digest.
>
> **What it is NOT.** Not the current `web/` + Supabase-Edge prototype, and not a build log. The **architecture** ("what we build") lives in `01_product`–`08_migration` (with `05_ai/` and `05_integration/` as a sibling "05-class" family); the **engineering-discipline & evals operating model** ("how we build it and how we prove it works") lives in `09_engineering_discipline/`. Where this spec and the upstream study reports disagree, **the digest wins**; where a spoke disagrees with this README or with `canonical_decisions.md`, **`canonical_decisions.md` then this README wins** — both amendable only by [ADR](#9-change-management-adrs).
>
> **Status:** Normative target-state spec. Build to THIS, not to the prototype.
>
> **Audience:** every human or AI actor authoring a downstream spec section, or building a vertical slice of the rebuild.

---

## Table of contents

1. [Why we are rebuilding — the load-bearing context](#1-why-we-are-rebuilding--the-load-bearing-context)
2. [Vision (one paragraph) and the seven invariants](#2-vision-and-the-seven-invariants)
3. [The whole spec suite — every file, one line each](#3-the-whole-spec-suite--every-file-one-line-each)
4. [Per-section one-paragraph summaries](#4-per-section-one-paragraph-summaries)
5. [Reading order](#5-reading-order)
6. [The target system at a glance (C4-ish container diagram)](#6-the-target-system-at-a-glance)
7. [Canonical decisions that bind every section](#7-canonical-decisions-that-bind-every-section)
8. [How the architecture spec and the discipline suite marry up](#8-how-the-architecture-spec-and-the-discipline-suite-marry-up)
9. [Change management — ADRs](#9-change-management-adrs)
10. [Provenance & key source references](#10-provenance--key-source-references)
11. [Appendix A — the digest is the constitution](#a-the-digest-is-the-constitution)
12. [Appendix B — glossary](#b-glossary)

---

## 1. Why we are rebuilding — the load-bearing context

The system works clinically but has **one fatal architectural flaw and a cluster of structural ones**:

| # | Flaw | Evidence | Where it's fixed |
|---|---|---|---|
| **1** | **Prescription generation runs synchronously inside a Supabase Edge Function with a hard 150s wall-clock.** Generation takes 50–150s; doctors wait up to 5 minutes and hit `504`/`546` at exactly `150,000ms`. | `console-log.md:15-16`; `generate-prescription/index.ts` tool-loop with a `setTimeout(...abort)` workaround that only exists to survive the edge wall. | **`02_architecture` (off-edge worker)** + **`05_ai`/`ai_orchestration` (streaming)** + the latency design (`latency_ux_architecture.md`). |
| **2** | **A hardcoded, dated Claude model id** (`claude-sonnet-4-6` literal at `generate-prescription/index.ts:711,832`). When a dated model retires, prod breaks silently — it did, on 2026-06-25. | Source literal; the incident that motivated `09_engineering_discipline`. | **`ai_orchestration` (`ModelPolicyPort`, no model literal in business code)** + the `core_no_model_id_literals` fitness rule. |
| **3** | **No real authz.** A single `authenticated_full_access` RLS policy over a client-side **anon key** that touches clinical tables — the biggest DPDP/NABH/CERT-In liability. | Schema + every page's hardcoded anon key. | **`03_data` (per-role RLS + JWT)** + **`06_security`**. |
| **4** | **Client-side ID allocation** (`MAX(seq)+1` for UHID/receipt/token) — a write race that can collide patient identities. | `registration.html` allocation logic. | **`03_data` (server-side `SECURITY DEFINER` counters)**. |
| **5** | **AI mental-math dosing risk.** The deterministic engine is correct, but any path where the LLM emits a number that reaches paper is unsafe. | Memory `project_dose_engine_is_source_of_truth.md`. | **`05_ai`/`ai_orchestration` (sealed `DoseEnginePort`, AI emits no numbers)** + golden parity fixtures. |
| **6** | **~21k lines of duplicated inline JS/CSS across 8 single-file HTML pages**, including **two divergent print renderers** (`printRx` vs `prescription-output.html`'s `renderRx`). | `web/*.html`. | **`02_architecture` frontend (componentized SPA, one `<PrintDocument>`)**. |
| **7** | **App-only consistency** — `prescriptions↔visits` integrity, terminology codes, formulary contracts enforced in JS, not the DB. | Schema lacks composite FKs / concept FKs / Ajv contracts. | **`03_data` (composite FK, `catalog.concepts`, formulary `v1` schema)**. |

The rebuild is **not** greenfield: a typecheck-clean hexagonal TS foundation already exists on-branch (`origin/feat/dis-plan` under `dis/` — Hono, `postgres` driver, dbmate, 8 ports + `__fakes__`, Zod env, CI fitness rules, M001–M008 with `.rollback.sql`), and the clinical brain exists on `origin/sprint-2-saved` (the 745-line pure-TS `dose-engine.ts`, the `compute_doses` tool, three-tier severity, `prescription_audit`, 37 doctor-ratified decisions). **We adopt those as the foundation and extend.**

---

## 2. Vision and the seven invariants

> **Vision.** A pediatric OPD prescription system where **the doctor's perceived wait to a reviewable prescription is ≈ 0**, the **deterministic dose engine is the sole arithmetic authority** (AI selects drugs/regimens and narrates; it never computes a number that reaches paper), and **humans and AI are symmetric actors** on one command/event bus — so an autonomous "AI-drafts-then-doctor-signs" mode is an *additive subscriber, not a rewrite*. Everything else — bilingual + pictogram print, ABDM/FHIR, NABH auditability, DPDP child-data compliance — hangs off a hexagonal, port/adapter, config-driven core portable from Supabase to AWS by an env flip. The system is **TDD/eval-gated**; clinical safety is enforced as code (state machine + staging/clinical separation), not prompt text.

These **seven invariants** bind every section. A spoke that violates one is wrong.

| # | Invariant | Enforced by |
|---|---|---|
| **I1** | **Perceived wait ≈ 0; never an infinite spinner.** Generation is off-edge, speculative-in-background, and streamed. | `02_architecture`, `05_ai`, `06_security` + `GenerationPort` state contract |
| **I2** | **The dose engine is the sole arithmetic authority; AI emits no numbers.** Server re-checks byte-for-byte; mismatch → `REVIEW_REQUIRED`. | `05_ai` + dose-engine golden parity fixtures (gate) |
| **I3** | **A draft is `pending_review` until a human `SignOff` command — always.** No auto-finalized prescription, ever. | `02_architecture` state machine + `SignoffGate` (frontend) |
| **I4** | **Humans and AI are symmetric actors on one command/event bus.** Every mutation is a `Command`; results are `Event`s; audit + gates apply identically. | `02_architecture` CommandBus/CQRS |
| **I5** | **Vendors live behind ports/adapters; no business code touches a vendor SDK, model id, or secret directly.** | Hexagonal layout + fitness rules (CI merge-blockers) |
| **I6** | **No PII reaches the model; every clinical mutation is auditable.** PII-stripping is a typed boundary; each generation is an event stream. | `05_ai`, `06_security` |
| **I7** | **Portable by an env flip (Supabase POC → AWS prod).** One composition root picks adapters by env; schema lives only in migrations. | `02_architecture`, `03_data`, `07_deployment` |

---

## 3. The whole spec suite — every file, one line each

`system-spec/` is organized as numbered top-level sections; each section is a self-contained spoke that conforms to this README and to `canonical_decisions.md`. **Numbering note:** the on-disk directory names (`02_architecture`, `03_data`, `04_api`, `05_ai` + `05_integration`, `06_security`, `07_deployment`, `08_migration`, `09_engineering_discipline`) are the source of truth used below; `canonical_decisions.md §B.0` reconciles them with the digest's logical numbering and records `05_*` as a **family, not a single directory**. Every file present on disk is indexed.

### 00_overview — the constitution layer

| File | One-line description |
|---|---|
| `00_overview/README.md` | **This file** — the master index, vision, seven invariants, reading order, canonical decisions, and provenance; the hub every spoke conforms to. |
| `00_overview/north_star.md` | The apex vision document — the latency bet, the 11 prototype flaws, goals/non-goals, the off-edge + speculative + streaming design, the clinical-safety spine, and the end-to-end "what done looks like" story. |
| `00_overview/canonical_decisions.md` | **BINDING** lead-architect adjudications resolving cross-file conflicts (C1 UHID grammar, C2 `sex`, C3 safety vocab, C4 synthetic `signed`, C5 dose-engine authority/oracle, C6 consent gate, C7 SSE fan-out) + the `05_ai/` roster, the dose-parity gate, and the missing-discipline-file assignments. |
| `00_overview/glossary.md` | The single controlled vocabulary for the whole rebuild — every canonical term, code symbol, state, event, and model id, with no-synonyms enforcement. |
| `00_overview/non_goals.md` | The negative space — what the rebuild deliberately does **not** build (IPD/billing/adult OPD, ABDM M3/HIU, multi-tenant SaaS, native apps), each with its seam-but-not-implementation boundary. |

### 01_product — product, clinical, and journeys

| File | One-line description |
|---|---|
| `01_product/product_brief.md` | The product anchor — users, value proposition, capabilities, and target-state product vision that the technical sections build on. |
| `01_product/clinical_safety.md` | The binding clinical-safety specification — what must be true for the system to be safe in front of a doctor and a child, made machine-checkable (state machine, dose engine, sign-off gate). |
| `01_product/user_journeys.md` | The 3-stage OPD workflow (reception → nurse → doctor pad), the instant-feel pad, print station, and patient lookup — the journeys frontend/backend/AI/DB authors build to. |
| `01_product/competitive_landscape.md` | The SOTA/competitive positioning (AI scribes, e-prescribing/CPOE, pediatric dosing DSS, India digital health) — what the rebuild adopts and where it deliberately differs. |

### 02_architecture — system map, services, frontend, latency, standards, ADRs

| File | One-line description |
|---|---|
| `02_architecture/overview.md` | The end-to-end component/service map — frontend, backend services, database, AI, integrations, the off-edge compute model, and the request/generation flows; the spine the deep files hang off. |
| `02_architecture/backend_services.md` | The backend decomposition — the off-edge Hono service, the 9 DDD bounded-context hexagons, the generation worker, and the state-machine spine that replaces the 150s Edge Function. |
| `02_architecture/ai_orchestration.md` | The Generation bounded context's orchestration *mechanism* — `ModelPolicyPort`, tool-use/progressive disclosure, prompt caching, streaming, fallbacks, the dose-engine separation boundary, and generation observability. |
| `02_architecture/frontend_architecture.md` | The frontend SoT — framework, component model, routing, state, the streaming generation client, the speculative-generation trigger, offline/resilience, and per-surface builds (pad/registration/print/lookup). |
| `02_architecture/frontend_design_system.md` | The design system — component library, design tokens, bilingual (English + Devanagari) rendering, the 4-row + SVG-pictogram medicine block, A4 print, accessibility, tablet ergonomics, voice UX, streaming states. |
| `02_architecture/latency_ux_architecture.md` | The deepest treatment of perceived-wait ≈ 0 — the four compounding latency mechanisms (off-edge compute, speculative generation, SSE streaming, async job + notify), the debounce/last-write-wins policy, and the sign-off interaction. |
| `02_architecture/coding_standards.md` | The minutest code- and function-authoring rules (language/runtime, module organization, naming, function design, typing, async, ports/adapters dependency rules) — every rule a lint/CI/typecheck/review-gate hook. |
| `02_architecture/adrs.md` | The load-bearing Architecture Decision Records (Context → Decision → Consequences → Alternatives) — the decisions that, if reopened, force a rewrite. |

### 03_data — schema, contracts, migration

| File | One-line description |
|---|---|
| `03_data/schema_design.md` | The complete target Postgres schema — DDD bounded-context schemas, every table/column/key, server-side ID allocation, per-role RLS, append-only audit, the async-generation read models, and the live-data migration plan (§13), at DDL detail. |
| `03_data/data_contracts.md` | The JSON contract layer — the knowledge-base datasets (formulary, ICD-10 protocols, terminology) and the prescription payload that flows worker → dose engine → print → FHIR; the shapes/invariants/enums enforced by Ajv in CI and at write time. |
| `03_data/schema_migration.md` | The ETL/cutover plan — migrating the existing live Supabase data (project `ecywxuqhnlkjtdshpcbc`, in active clinical use) into the target DDD schema, forward-only, reversible, abort-on-duplicate. |

### 04_api — the external HTTP contract

| File | One-line description |
|---|---|
| `04_api/api_contracts.md` | The external HTTP contract — REST resource model, the async generation job API (`POST …/generations → 202 {job_id}` + polling fallback), the SSE streaming endpoint, authn/authz, versioning, idempotency, and the canonical error envelope. |
| `04_api/error_model.md` | The one canonical error model spanning frontend, backend, DB, and AI — the `{error:{code,message,correlation_id,retryable}}` envelope, the stable code catalogue, severity, and graceful-degradation rules. |

### 05_ai — the AI substance layer (sibling "05-class" of 05_integration)

| File | One-line description |
|---|---|
| `05_ai/README.md` | The hub/constitution of the AI substance layer — what the loop *carries* (vs `ai_orchestration.md`'s how-it-runs), the six tool contracts at contract level, the invariants this layer enforces, and the four spoke files' roster. |
| `05_ai/prompt_system_design.md` | The prompt substance — the rebuilt `core_prompt` structure, the pre-embedded NABH block, the byte-frozen cacheable-prefix layout (breakpoint, 4096-token Opus-4.8 minimum, no-UUID/timestamp/unsorted-JSON invariant), and the tool-under-reach copy. |
| `05_ai/clinical_references.md` | The 11 clinical reference files' content, governance, versioning, and the `catalog.clinical_reference` registry — six-eye review, name→Storage resolution, and the version-bump → cache-bust rule. |
| `05_ai/tool_contracts.md` | The six tools' exact wire surface — `input_schema` shown to Claude + condensed (PII-/token-stripped) output returned, `condenseDrugForAI()`, the typed `PreviousRxView`, `compute_doses` delegating to the TS `DoseEnginePort`, `strict:true`, and the final-turn structured output that retires `extractJSON`. |
| `05_ai/worked_examples_and_golden_cases.md` | The worked examples (Arjun AOM, neonatal/preterm renal edges) as both prompt exemplars and eval golden inputs — the example↔golden-case bijection and the `split:train` vs `split:test` discipline. |

### 05_integration — ABDM/ABHA + FHIR R4 (sibling "05-class" of 05_ai)

| File | One-line description |
|---|---|
| `05_integration/abdm_fhir.md` | The ABDM/ABHA identity + HIP/HIU + consent + FHIR R4 integration — the pure `FhirCompositionPort`/`NrcesR4Adapter`, `AbdmGatewayPort`/`CryptoBoxPort`(Fidelius)/`SignaturePort`(ES256 JWS), off-edge event-driven, with M1→M2 first and M3/HIU deferred. |

### 06_security — security, authz, PII/PHI, compliance

| File | One-line description |
|---|---|
| `06_security/security_auth_rbac_compliance.md` | The target-state security SoT — authentication, authorization + RBAC, PII/PHI handling, secrets via `SecretsPort`, audit/immutability, and compliance (NABH Digital Health, ABDM, DPDP Act 2023 + Rules 2025, CERT-In dual breach clocks); replaces the prototype's anon-key/blanket-RLS model entirely. |

### 07_deployment — infrastructure & CI/CD wiring

| File | One-line description |
|---|---|
| `07_deployment/infrastructure_cicd.md` | The production-grade delivery plane — compute (Fly/Render POC → Cloud Run prod, AWS by env flip), the Postgres-queue → SQS worker, env/secrets centralization, frontend delivery, the SSE fan-out design, and the CI/CD wiring to the gate topology. |

### 08_migration — the phased sequencing & execution plan

| File | One-line description |
|---|---|
| `08_migration/migration_roadmap.md` | The conductor's score — the order of operations, the salvage-vs-retire inventory, the risk register, and the rollback strategy that sequences every other section into gated vertical slices (shadow → opt-in → default). |

### 09_engineering_discipline — the TDD/eval operating model (authored)

| File | One-line description |
|---|---|
| `09_engineering_discipline/README.md` | The hub of the operating model — the core thesis (machine-checkable unbypassable gates; answer from data; dual structural+behavioral drift control), the five axioms, the suite index, canonical tooling, and the CI/CD gate topology. |
| `09_engineering_discipline/engineering_principles.md` | The architectural constitution & extensibility discipline — the SOLID/hexagonal/ports/DDD/event-driven/anti-corruption principles every section inherits, and the open/closed rules for additive AI-first behavior. |
| `09_engineering_discipline/agent_operating_model.md` | The agent development loop & roles — how human/AI actors author, review, and land vertical slices under the discipline. |
| `09_engineering_discipline/build_execution_workflow.md` | The build-execution model — spec-driven scaffolding generated from the spec, plus the parallel-worktree feature workflow (Windows-safe). |
| `09_engineering_discipline/definition_of_ready_done.md` | DoR/DoD as machine-checkable gates — the entry/exit conditions a ticket must satisfy before it starts and before it is "done". |
| `09_engineering_discipline/drift_control.md` | Drift control on three axes — structural (fitness functions), behavioral (evals), and spec (traceability) — the heart of the operating model. |
| `09_engineering_discipline/quality_gates_ci.md` | The unbypassable CI/CD quality-gate pipeline — the gate ledger, fitness functions, the eval gate, coverage/cost/latency budgets, and OpenAPI-diff enforcement. |
| `09_engineering_discipline/branch_protection_and_required_checks.md` | The unbypassable gate as config-as-code — `required_status_checks` as a reviewed Terraform/`gh api` artifact (`enforce_admins`, signed commits, linear history), the model-existence contract test, and traceability-matrix enforcement. |
| `09_engineering_discipline/testing_strategy.md` | The TDD discipline, test pyramid, clinical acceptance, and eval gates — including the dose-parity runner and (optionally) the render-fidelity gates. |
| `09_engineering_discipline/evals_framework.md` | The behavioral gate — the golden eval set, the deterministic safety gate, never-events, the severity scorecard, the soft-quality judge, and the judge-non-determinism discipline (variance bounds, seed pinning, escalation). |
| `09_engineering_discipline/eval_data_governance.md` | The golden-set lifecycle — authoring, proven de-identification (the PHI-scanner gate), clinician-as-oracle sign-off, train/test split discipline, prod-miss intake, and anti-staleness/anti-overfitting. |
| `09_engineering_discipline/clinical_risk_management.md` | ISO-14971/IEC-62304-style hazard analysis → severity-weighted eval failures — hazard→control→eval-case traceability, the hard-block-vs-warn asymmetry, and the human-in-loop sign-off as the top control. |
| `09_engineering_discipline/code_review_standards.md` | The adversarial independent-agent code-review standard — what a reviewer must verify and the independence requirements. |
| `09_engineering_discipline/agent_threat_model.md` | The threat model for agent-built clinical code — prompt-injection/data-poisoning via a malicious reference/formulary row, reviewer↔author collusion, human-escalation thresholds, and untrusted-input isolation. |
| `09_engineering_discipline/security_review.md` | The security & privacy discipline — threat modeling, SAST, dependency/secret scanning, PHI handling, authz review, the CI security gate, and DPDP/NABH alignment. |
| `09_engineering_discipline/change_management_versioning.md` | Change management, versioning, ADRs, migrations, and rollback drills — how a binding decision is amended and proven reversible. |
| `09_engineering_discipline/data_migration_rollback.md` | The data-migration & rollback discipline — expand/contract, restore-prod-like-in-CI, proven reversibility under RLS/RESTRICT/CHECK, and the forward-fix policy. |
| `09_engineering_discipline/observability_runtime_verification.md` | Observability & runtime verification — SLOs, in-prod evals, alerting, and incident response. |

> **Composability rule.** No two spokes may declare conflicting canonical tooling, ports, schema names, vocabulary, or risk tiers. The source of truth is **§7 of this file**, **`canonical_decisions.md`**, and `09_engineering_discipline/README.md §6` (tooling). A spoke needing a different value files an [ADR](#9-change-management-adrs) that amends this file *first*.

---

## 4. Per-section one-paragraph summaries

Each summary is the target-state mandate for that section — decisive, not exploratory.

### 00 — Overview (the constitution layer)
The master index and constitution-expander (`README.md`) plus the apex `north_star.md`, the **BINDING** `canonical_decisions.md` (the C1–C7 adjudications every spoke applies verbatim), the no-synonyms `glossary.md`, and the scope-fencing `non_goals.md`. Together they pin the vision, the seven cross-cutting invariants, the canonical decisions every section inherits, the controlled vocabulary, and the negative space. Read `README.md` then `canonical_decisions.md` first; return to them whenever two spokes appear to disagree.

### 01 — Product
The product anchor: who the users are (reception, nurse, Dr. Lokender Goyal at the pad, print station), the value proposition, and the capabilities — grounded in the **3-stage OPD workflow** (`user_journeys.md`), the binding **clinical-safety** guarantees made machine-checkable (`clinical_safety.md`), and the **competitive/SOTA positioning** that says what we adopt from AI scribes / e-prescribing / pediatric dosing DSS and where we deliberately differ (`competitive_landscape.md`). This is the *why* and *for whom* the technical sections build to.

### 02 — Architecture
The architecture spine. Replace the **8 single-file HTML pages and ~21k lines of duplicated inline JS/CSS** with a **component-based SPA** (`frontend_architecture.md` + `frontend_design_system.md`: container/presentational split, client ports, design tokens blue=meds/red=investigations/black=else, the one canonical `<PrintDocument>`, the 4-row + pictogram block, WCAG 2.2 AA). The backend (`backend_services.md`) is a single off-edge **Hono service** decomposed into **9 DDD bounded-context hexagons** wired by one composition root, whose net-new construct is the **CommandBus → EventBus** with the pure `transition()` state-machine spine. `ai_orchestration.md` owns the Generation *mechanism* (`ModelPolicyPort`, caching, streaming, fallback, dose separation); `latency_ux_architecture.md` owns the four-mechanism perceived-wait ≈ 0 design; `coding_standards.md` pins every enforceable code rule; `adrs.md` records the rewrite-forcing decisions; `overview.md` is the map they all hang off.

### 03 — Data
The data layer. `schema_design.md` is the complete target schema — **DDD bounded-context Postgres schemas** (`catalog`/`clinical`/`prescribing`/`identity`/`abdm`/`ops`), every mutable table carrying `id uuid`/timestamps/`version`/`correlation_id`/`facility_id`, UHID/receipt as **UNIQUE business columns not PKs** — decisively fixing the 11 flaws: **server-side `SECURITY DEFINER` counters** (kills the `MAX(seq)+1` race), **real per-role RLS from JWT** (anon key never touches clinical), **append-only `ops.audit_log`** + immutable signed Rx, the **`rx_generation_jobs`** read model, the **composite FK `(visit_id, patient_id)`**, **terminology integrity** via `catalog.concepts`, and the formulary as a governed Ajv-`v1` KB. `data_contracts.md` owns the JSON shapes (datasets + prescription payload) those tables store and that cross service boundaries. `schema_migration.md` owns the forward-only, reversible, abort-on-duplicate ETL/cutover from the live Supabase project.

### 04 — API
The external HTTP contract (`api_contracts.md`): **REST for CRUD, async jobs for generation (`POST …/generations → 202 {job_id}` + polling fallback), and SSE for streamed deltas (`GET /jobs/{id}/events`)**, with OpenAPI 3.1 as the source of truth (diffed in CI), `Idempotency-Key` required on writes, and `correlation_id` on every response. `error_model.md` is the one canonical error model across frontend/backend/DB/AI — the `{error:{code,message,correlation_id,retryable}}` envelope, the stable UPPER_SNAKE code catalogue (including `CONSENT_REQUIRED`), and the graceful-degradation rules that mean a failure never becomes an infinite spinner.

### 05_ai — AI substance
The *content and contracts the orchestration carries* (vs `ai_orchestration.md`'s *how the loop runs*). The `README.md` is the layer hub; `prompt_system_design.md` owns the byte-frozen **cacheable prefix** + pre-embedded NABH block; `clinical_references.md` governs the **11 reference files** and the `catalog.clinical_reference` registry (six-eye review, version→cache-bust); `tool_contracts.md` freezes the **six tools'** `input_schema` + condensed PII-/token-stripped output (`condenseDrugForAI`, typed `PreviousRxView`, `compute_doses` delegating to the TS `DoseEnginePort`, `strict:true`, structured-output retiring `extractJSON`); `worked_examples_and_golden_cases.md` maps each worked example 1:1 to a golden eval case with train/test discipline. The non-negotiables it enforces: **no number from the AI (I2), no PII to the model (I6), draft until human sign-off (I3).**

### 05_integration — ABDM/FHIR
`abdm_fhir.md`: keep the strong NRCeS R4 builder but fix its coupling by porting it into a pure **`FhirCompositionPort`** adapter (`NrcesR4Adapter`) that takes data, not a DB (killing the N+1 re-fetch), adding DocumentReference + Composition narrative + `Bundle.signature` + a FHIR-validator CI gate. New ports: **`AbdmGatewayPort`** (session/auth, `on-*` callbacks, push, consent), **`CryptoBoxPort`** (Fidelius — Curve25519 Short-Weierstrass), and **`SignaturePort`** (ES256 JWS replacing the forgeable 6-char client-salt QR hash; no PHI in the QR URL). Sequencing is **M1 (ABHA at registration) → M2 (HIP push)** first, **M3/HIU deferred**, and all generation runs **off-edge, event-driven** (`PrescriptionSigned` → async handlers) so sign-off never blocks on it.

### 06 — Security
`security_auth_rbac_compliance.md`: security is structural, not aspirational. **Real RLS + JWT replaces the blanket-policy-over-anon-key** (the single biggest DPDP/NABH/CERT-In liability); **secrets flow only through `SecretsPort`** (never client/logs/URLs/commits); **no PII reaches the model** (a typed stripping boundary). **DPDP Act 2023 + Rules 2025** (every patient is effectively a child < 18) means **timestamped guardian consent at registration** and the dual breach clocks (DPB 72h + CERT-In 6h); the **`ai_assisted_rx` consent gate** (C6) blocks generation at the `RequestGeneration` boundary. **NABH Digital Health 2nd-ed** is the EMR checklist; auditability is an **event stream per generation**; `esc()` remains the safe-render primitive and every pictogram is paired with Hindi + English text.

### 07 — Deployment & operations
`infrastructure_cicd.md`: compute is the **Hono container, not Edge Functions** for long-running work — **POC on Fly.io/Render** (holds SSE) with a **Postgres-queue worker**; **prod on Google Cloud Run** (60-min timeout, scale-to-zero, clean SSE), queue flipping to **SQS via `DIS_STACK=aws`**. Supabase remains only for Postgres, Auth (real JWT), and Storage; any retained Edge Function is a thin `validate → enqueue → 202` receiver. Configuration/secrets centralize in `env.schema.ts` (Zod, fail-fast) + `ConfigPort` + `SecretsPort` with **zero hardcoded URLs/keys/models**; the prod SSE fan-out is **outbox → Postgres `LISTEN/NOTIFY` keyed by `job_id`** (C7). Rollout is **shadow → opt-in → default** behind a feature-flag ladder with a kill-switch, wired into the section-09 gate topology.

### 08 — Migration & phased rollout
`migration_roadmap.md` is the conductor's score — **decisive, ordered, shadow-before-cutover, never big-bang**: (1) **config/secrets centralization** first to unblock the model-retirement failure class; (2) **adopt the `dis/` skeleton** as the monorepo template; (3) **port-ify the dose-engine and growth-engine into pure `core/` and land golden JS↔TS parity fixtures as a TDD gate first**; (4) **build the CommandBus + speculative-draft state machine + streaming `GenerationPort`** (the headline); (5) the **DB migration** (baseline → ETL-clean → backfill `legacy` → uuid+UHID-business-key → dedupe → reconcile → cutover); (6) the **frontend rebuild**; (7) **ABDM/FHIR off-edge**; (8) **shadow rollout** diffing speculative generation against legacy behind the flag ladder + kill-switch. Each step is its own gated vertical slice; physician sign-off (I3) holds throughout.

### 09 — Engineering discipline & evals *(already authored)*
The parallel operating model that makes the rebuild safe and provable. Its `README.md` pins the core thesis (machine-checkable unbypassable gates; answer from data, not guesswork; dual structural+behavioral drift control) and the five axioms (A1–A5). The suite defines the **architecture fitness functions** (`drift_control.md`, `quality_gates_ci.md`), the **golden eval set + deterministic safety gate + never-events + severity scorecard** (`evals_framework.md`, `eval_data_governance.md`), **clinical risk management** (`clinical_risk_management.md`), DoR/DoD (`definition_of_ready_done.md`), the **branch-protection-as-code** unbypassable gate (`branch_protection_and_required_checks.md`), the testing strategy and dose-parity runner (`testing_strategy.md`), code-review and agent-threat-model standards, security review, change management + data-migration rollback, observability, and the build-execution/agent-operating model. It owns **WHAT is gated**; sections 01–08 conform to it for *how they are built and proven*, while it conforms to them for *what the boundaries are*.

---

## 5. Reading order

Read **00 first** (`README.md` then `canonical_decisions.md`), then by the surface you are touching. The dependency spine is: **vision/invariants (00) → product/journeys (01) → backend bus + state machine (02) → everything that rides the bus (frontend, 05_ai, 04 API, 05_integration) → the schema underneath (03) → how it ships and stays safe (07, 06) → the order to do it in (08)**, with **09** read in parallel as the gate contract.

```
                 ┌───────────────────────────────────────────────┐
   START ──────▶ │ 00 OVERVIEW — vision, 7 invariants, decisions │  ← everyone, first
                 └───────────────────────┬───────────────────────┘
                                         │
                                         ▼
                 ┌───────────────────────────────────────────────┐
                 │ 01 PRODUCT — users, journeys, clinical safety  │
                 └───────────────────────┬───────────────────────┘
                                         ▼
                 ┌───────────────────────────────────────────────┐
                 │ 02 ARCHITECTURE — CommandBus/EventBus + state  │  ← the seam everything rides
                 └───┬───────────────┬───────────────┬───────┬────┘
                     ▼               ▼               ▼       ▼
              ┌──────────┐  ┌──────────────┐ ┌──────────┐ ┌────────────┐
              │ FRONTEND │  │ 05_ai / DOSE │ │ 04 API   │ │05_integr.  │
              │(rides bus)│ │ (rides bus)  │ │(REST+SSE)│ │(ABDM/FHIR) │
              └────┬─────┘  └──────┬───────┘ └────┬─────┘ └─────┬──────┘
                   └───────────────┼──────────────┴─────────────┘
                                   ▼
                        ┌──────────────────────┐
                        │ 03 DATA + MIGRATION   │  ← the schema underneath
                        └──────────┬───────────┘
                  ┌────────────────┼────────────────┐
                  ▼                                  ▼
        ┌──────────────────┐              ┌──────────────────────┐
        │ 07 DEPLOYMENT    │              │ 06 SECURITY / DPDP    │
        └────────┬─────────┘              └──────────┬───────────┘
                 └───────────────┬──────────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │ 08 MIGRATION — the order │  (run last; sequences 01–07)
                    └────────────────────────┘

   In parallel, throughout:  09 ENGINEERING DISCIPLINE  — the gate contract for 01–08
```

**By role:**

| If you are… | Read, in order |
|---|---|
| **Onboarding (any actor)** | 00 (`README` + `canonical_decisions`) → 01 → `02/overview` → 03 → `05_ai/README` → then the surface you own. |
| **Building the latency fix (the headline)** | 00 §2 + `02/latency_ux_architecture` → `02/backend_services` (worker + CommandBus + state machine) → `02/ai_orchestration` + `05_ai/prompt_system_design` (streaming, caching) → `07_deployment` (off-edge platform + queue) → `04/api_contracts` (SSE). |
| **Building the frontend** | 00 → `02/frontend_architecture` + `02/frontend_design_system` → `02/backend_services` (CommandBus/EventBus contract) → `04/api_contracts` (API shape) → `01/clinical_safety` (sign-off UX). |
| **Touching the database / running the migration** | 00 + `canonical_decisions` (C1–C7) → `03/schema_design` → `03/schema_migration` → `08/migration_roadmap` → `06_security` (RLS/audit). |
| **Touching AI / model / prompt / dose** | 00 + `canonical_decisions` (C5/C6) → `02/ai_orchestration` → `05_ai/*` → `09/evals_framework` + `09/eval_data_governance` → `06_security` (no-PII boundary). |
| **Touching ABDM / FHIR** | 00 → `05_integration/abdm_fhir` → `03/schema_design` (`abdm` schema, outbox/inbox) → `06_security` (crypto, consent). |
| **Setting up CI/CD or shipping** | 00 §7 → `07_deployment` → `09/quality_gates_ci` + `09/branch_protection_and_required_checks` → `08/migration_roadmap` (flag ladder). |

---

## 6. The target system at a glance

```
                         ┌──────────────────────────────────────────────────────────────┐
                         │  FRONTEND SPA (Vite + TS)  — components, design tokens, a11y   │
                         │  ports: DataAccess · Generation(SSE) · Transcription · Config  │
   Reception ───┐        │         Print · EventBus/CommandBus · Realtime                 │
   Nurse ───────┼──────▶ │  Pad: DictationPad(autosave) · MedicineCard(4-row+pictogram)   │
   Doctor ──────┘        │       DoseAdjuster(→engine) · SignoffGate · <PrintDocument>    │
                         └───────────────┬───────────────────────────────┬───────────────┘
                                         │ REST + Idempotency-Key         │ SSE  GET /jobs/{id}/events
                                         ▼                                ▲
          ┌──────────────────────────────────────────────────────────────┴────────────────────┐
          │   OFF-EDGE HONO SERVICE (Node 20, one Dockerfile; Fly/Render POC → Cloud Run prod) │
          │                                                                                     │
          │   API GATEWAY  ── correlation-id · idempotency · error-envelope · kill-switch ·     │
          │                   rate-limit · CORS-locked · JWT→app.role                           │
          │                          │                                                          │
          │                ┌─────────▼─────────┐   commands         ┌──────────────────────┐    │
          │   9 BOUNDED ──▶ │  CommandBus       │ ────────────────▶  │  EventBus + outbox   │    │
          │   CONTEXTS       │  (symmetric actors: human = AI)   │   │  + state-machine spine│    │
          │   (hexagons)     └─────────┬─────────┘                   └──────────┬───────────┘    │
          │                            │                                        │                │
          │   Registration · Clinical-Capture · Document-Ingestion(staging→     │                │
          │   promotion) · GENERATION WORKER(tool-loop, speculative, streaming) │                │
          │   · Job-Queue/Realtime · ABDM · DoseEngine(sealed) · Print          │                │
          └──────┬───────────────┬──────────────────────┬────────────────┬──────┴──────┬─────────┘
                 │ ports/adapters │                      │                │             │
                 ▼ (env-flipped)  ▼                      ▼                ▼             ▼
          ┌────────────┐  ┌──────────────┐      ┌────────────────┐ ┌───────────┐ ┌──────────────┐
          │ Postgres   │  │ Storage      │      │ Claude API     │ │ ABDM      │ │ Job queue    │
          │ (6 DDD     │  │ (skill,docs, │      │ (ModelPolicy-  │ │ Gateway   │ │ pg-queue POC │
          │  schemas;  │  │  rx, signed) │      │  Port: Opus/   │ │ (Fidelius,│ │ → SQS prod   │
          │  RLS+JWT;  │  │              │      │  Sonnet/Haiku) │ │  JWS, R4) │ │              │
          │  audit;    │  └──────────────┘      └────────────────┘ └───────────┘ └──────────────┘
          │  counters) │      Supabase POC ───────────── env flip (DIS_STACK=aws) ──────────▶ AWS prod
          └────────────┘
```

**The latency design (the headline) — four compounding mechanisms** (full detail in `02/latency_ux_architecture.md` + `02/ai_orchestration.md`):

1. **Off-edge persistent worker** — the Claude tool-use loop runs on the Hono/Cloud-Run worker pulling from the durable queue, not in a 150s-capped function. This single change kills the `504/546-at-150,000ms`; delete every timeout/budget/fallback workaround that only existed to survive the edge wall.
2. **Speculative / background generation** — each meaningful autosave of `visits.raw_dictation` (and each section-chip change) is a `DraftNoteUpdated` command → a debounced worker speculatively (re)generates a draft keyed by a **content hash of `{note, patient_context_version, selected_sections}`**; a newer hash supersedes the in-flight run (last-write-wins). By the time the doctor clicks **Generate**, a fresh `draft_ready` usually exists.
3. **Streaming end-to-end** — the worker uses `client.messages.stream(...)` and emits `GenerationStarted/ToolInvoked/DraftDelta/GenerationCompleted/GenerationFailed` on a per-job channel; the pad subscribes by `job_id` over **SSE** (Realtime WebSocket removed for IO cost) and renders progressively.
4. **Async job + notify + review-first UX** — Generate opens review at 0ms if the speculative hash matches (subtle "draft — confirm" badge), or shows "regenerating from your latest note…" if stale; `GenerationPort` exposes `idle|streaming|ready|stale|error|timeout` with an AbortController, backoff retry, and a hard client deadline → degraded UI, **never an infinite spinner**.

---

## 7. Canonical decisions that bind every section

These are binding so every spoke composes. **Any row changes only through an [ADR](#9-change-management-adrs)** that names the replacement, shows it satisfies the same contract, and updates this table. The cross-file *value* adjudications (UHID grammar, `sex`, safety vocabulary, synthetic `signed`, dose-engine authority/oracle, consent gate, SSE fan-out) are pinned in **`canonical_decisions.md` C1–C7** and are not re-decided here.

| Concern | Canonical choice | Rationale (one line) |
|---|---|---|
| **Runtime** | **Node 20 + Hono**, one Dockerfile | Long-running compute off the Edge 150s wall; portable Node/Bun/Lambda. |
| **Compute platform** | **Fly/Render (POC) → Google Cloud Run (prod)**; AWS by env flip | 60-min request timeout, scale-to-zero, clean SSE; the boring default. |
| **Language** | **TypeScript, strict** | Whole stack; shared dose-engine + domain types. |
| **DB driver** | **`postgres` (porsager); NO ORM** (ADR-006) | Parameterized `sql`; schema lives only in migrations. |
| **Migrations** | **dbmate**, forward + `.rollback.sql`; CI up→down→up + pg_dump diff | Reversible, drift-checked; never `drop … cascade`. |
| **Validation** | **Zod** (env + DTOs) + **Ajv** (JSON-schema for clinical payloads/formulary) | Fail-fast boot; contract-tested clinical I/O. |
| **Architecture** | **Hexagonal** `core/ports/adapters/__fakes__` + **one `wiring/` composition root** | DIP; vendor edge isolated; env-flip portability (I5, I7). |
| **Fitness rules (CI merge-blockers)** | `core_no_adapter_imports`, `ports_no_adapter_imports`, `core_no_fetch`, `core_no_xhr`, `core_no_sql_literals`, `supabase_sdk_only_in_supabase_adapters` (+ `aws_sdk_only_in_aws_adapters`, **+ `core_no_model_id_literals`**) | Structural drift blocked; the model-id firewall. |
| **Cross-cutting integration** | **CommandBus → EventBus + CQRS read models**; `state-machine.ts transition()` spine | Symmetric human/AI actors (I4); AI-first is additive (I3 preserved). |
| **Async API** | **REST CRUD + `POST …/generations → 202 {job_id}` + SSE `GET /jobs/{id}/events`**; OpenAPI 3.1 source-of-truth | Perceived-wait ≈ 0 (I1); contract diffed in CI. |
| **Job queue** | **Postgres queue (POC, `dis/` M004) → SQS (prod)** | Durable, env-flipped; powers the off-edge worker. |
| **Model strategy** | **`ModelPolicyPort` config** — Opus 4.8 (Rx) / Haiku-Sonnet (summary, OCR, lookup); **no model literal in business code** | Fixes the retirement incident; per-task cost/correctness. |
| **Dosing** | **Sealed pure `DoseEnginePort`** (745-line port); AI emits no numbers; server re-checks byte-for-byte | I2; gated by golden JS↔TS parity fixtures (`canonical_decisions.md` Part C). |
| **Realtime / SSE fan-out** | **SSE** behind `RealtimePort`; POC in-memory `StatusChannel`, prod **outbox → `LISTEN/NOTIFY` keyed by `job_id`** (C7) | Realtime WebSocket removed for IO cost; handler unchanged across env. |
| **Authz** | **Per-role RLS driven from JWT** via `current_setting('app.role'/...)` (`dis/` M008) | Portable to Supabase *and* RDS; anon key never touches clinical. |
| **Identity allocation** | **Server-side `SECURITY DEFINER` counters** (`uhid_counter`, receipt, token); UHID `^RKH-\d{11}$` = `RKH-<FY4><MM2><SEQ5>` (C1) | Kills the client-side `MAX(seq)+1` race; self-describing FY-4 format. |
| **Audit** | **Append-only `ops.audit_log` + BEFORE UPDATE/DELETE triggers**; signed Rx immutable + content hash | NABH/DPDP traceability; tamper-evidence. |
| **Secrets** | **`SecretsPort`** — Supabase secrets (POC) → AWS Secrets Manager (prod) | Never in client/logs/URLs/commits. |
| **Consent (DPDP)** | **`ai_assisted_rx` guardian-consent gate** at `RequestGeneration` (C6); `CONSENT_REQUIRED` (403) | Captured consent is enforced, not theatre; fail-closed. |
| **FHIR/ABDM** | Pure **`NrcesR4Adapter`** + `AbdmGatewayPort`/`CryptoBoxPort`(Fidelius)/`SignaturePort`(ES256 JWS) | Off-edge, event-driven; forgeable QR hash replaced. |
| **Frontend** | **Vite + TS SPA**, container/presentational, design tokens, one `<PrintDocument>`, WCAG 2.2 AA | Replaces 8 HTML pages + duplicated renderers. |

> **CI/CD platform, branch model, test runners, eval frameworks, SAST, secret scanning, observability** are pinned in `09_engineering_discipline/README.md §6` and are not re-decided here.

---

## 8. How the architecture spec and the discipline suite marry up

Sections 01–08 are the **architecture** ("what we build"); `09_engineering_discipline` is the **operating model** ("how we build it and prove it works"). They are authored in parallel and married at synthesis — one-directional in two ways:

```
   ARCHITECTURE (01–08)                       DISCIPLINE (09)
   "WHAT we build"                            "HOW we build it & prove it"

   ┌────────────────────────┐  principles    ┌──────────────────────────────────┐
   │ Bounded contexts        │ ─────────────▶ │ Fitness functions encode the      │
   │ Ports & adapters        │   become       │ spec's boundaries as build-failing│
   │ CommandBus / CQRS       │   checks       │ tests (boundary, dose-engine-only)│
   │ Dose-engine boundary    │ ─────────────▶ │ Contract tests pin the seams as   │
   │ Rx contract / tool I/O  │                │ JSON-Schema/Pact; FHIR validator. │
   └───────────┬─────────────┘                └────────────────┬─────────────────┘
               │ the discipline does NOT invent architecture;   │ generated skeleton,
               │ it MEASURES & ENFORCES it                       ▼ schemas, traceability
   ┌────────────────────────┐  spec-synced   ┌──────────────────────────────────┐
   │ Spec clauses carry      │ ◀───────────── │ Scaffolding generates skeleton    │
   │ trace IDs               │  by            │ FROM the spec; divergent hand     │
   └────────────────────────┘  construction  │ edits FAIL a CI check.            │
                                              └──────────────────────────────────┘
```

The seven invariants (I1–I7) of this spec map onto the five axioms (A1–A5) of the discipline: **I2 ↔ A5** (dose-engine source of truth), **I3 ↔ A1** (done = signed + gated), **I4 ↔ A4** (symmetric actors), **I5 ↔ A2** (enforce in CI not convention), **I6 ↔ A3** (answer/audit from data). **Synthesis contract:** every safety-critical spec clause must resolve to at least one verifying test or eval case, or the traceability gate goes red.

---

## 9. Change management — ADRs

Decisions in §7, the seven invariants, the `canonical_decisions.md` adjudications, and the section index are **fixed until amended by an Architecture Decision Record**. To change a binding decision: open `docs/adr/NNNN-<slug>.md` that (a) states the decision and context, (b) names the replacement and shows it satisfies the same contract/invariant, (c) lists consequences and the rollback, and (d) updates this README's affected table/section (and `canonical_decisions.md` where the change touches C1–C7) in the **same PR**. The `dis/` ADR set (ADR-001 hexagonal, ADR-005 Hono, ADR-006 `postgres`-over-ORM, ADR-007 Haiku-default/Sonnet-escalation, ADR-008 document-text-extractor) is inherited; new ADRs accrete. A spoke that needs a value this file does not grant files the ADR *before* proceeding — it does not silently diverge.

---

## 10. Provenance & key source references

This spec is built to the **Target-Architecture Digest** (the constitution), corroborated against verified on-branch source. Absolute / branch-qualified anchors:

**Foundation — adopt as the skeleton** (`origin/feat/dis-plan`, under `dis/`):
- Ports: `dis/src/ports/{database,storage,queue,secrets,structuring,ocr,preprocessor,file-router,document-text-extractor}.ts`
- Core (pure): `dis/src/core/{orchestrator,state-machine,promotion,confidence-policy,env.schema,idempotency-store,error-envelope,audit-log,version-lock,validate-extraction,content-hash}.ts`; `dis/src/core/schema/clinical_extraction.v1.json` + `ajv.ts`
- HTTP: `dis/src/http/{server,router,middleware/*,realtime/status-channel,routes/{ingest,process-job}}.ts`
- Wiring: `dis/src/wiring/{supabase,aws}.ts`
- CI fitness rules (6 enforced, verified): `dis/scripts/fitness-rules.json` (`core_no_adapter_imports`, `ports_no_adapter_imports`, `core_no_fetch`, `core_no_xhr`, `core_no_sql_literals`, `supabase_sdk_only_in_supabase_adapters`, `aws_sdk_only_in_aws_adapters`)
- Migrations: `dis/migrations/M001–M008` (each with `.rollback.sql`); ADR-001/005/006/007/008
- Service spec template: `dis/document_ingestion_service/{00_overview..09_runbooks}` (the numbered-section convention this suite mirrors)

**Clinical brain — port-from** (`origin/sprint-2-saved`):
- `supabase/functions/_shared/dose-engine.ts` — **745 LOC, verified exports**: `computeDose`, `parseIngredients`, `makeIngredient`, `calculateBSA`, `roundToUnit`, `isSolidForm`, `formatDoseDisplay`, `buildCalcString`, `FREQ_EN/FREQ_HI`, `HINDI_DROPS/HINDI_ML/HINDI_TABLETS/HINDI_UNITS`, `DROPS_PER_ML`, typed `ComputeDoseParams/ComputeDoseResult/Ingredient/IngredientBand`
- `supabase/functions/generate-prescription/index.ts` — `compute_doses` tool + three-tier severity; **the 150s flaw** (tool-loop with `setTimeout(...abort, timeoutMs)`; **hardcoded `model:"claude-sonnet-4-6"` at lines 711, 832** — the firewall target)
- Migrations: `20260428000000_baseline_from_live.sql` (pg-dump of live 14-table schema — migration baseline), `20260428001000_prescription_audit.sql`, `20260428002000_pg_trgm.sql`, `20260502000000_stdrx_trgm_index.sql`
- Docs: `13-ai-architecture-research.md`, `15-decisions-2026-04-28.md` (37 doctor-ratified decisions), `16-implementation-plan.md`; `radhakishan_system/skill/core_prompt.md`; `radhakishan_system/skill/references/*.md` (the 11 reference files); `radhakishan_system/skill/examples/worked_example.md` (Arjun AOM)

**Prototype — port-from, then retire** (`main`):
- `web/prescription-pad.html` (generate ~4843–4980; dose-engine integ ~5103–6003,7150; `printRx` ~6682; autosave ~3905–3964; voice ~4298–4560)
- `web/dose-engine.js` (the frozen parity oracle — C5), `web/prescription-output.html` (duplicate renderer ~690–1073 — collapse to the one `<PrintDocument>`), `web/registration.html` (`COMMON_LABS` ~2616; `IAP_SCHEDULE` ~1221), `web/verify.html`
- `console-log.md:15-16` (the `546`/`150,000ms` evidence)

**Index / IO** (`origin/fix/io-indexes`): `radhakishan_system/scripts/migration_io_indexes.sql`; `radhakishan_system/docs/system/10-index-proposal.md`.

**Authority for model/API facts:** the `claude-api` skill (Opus 4.8 `claude-opus-4-8`, adaptive-thinking-only, `effort` in `output_config`, streaming-mandatory > ~16K, prompt-cache prefix rules, 4096-token minimum, refusal guard) — verified 2026-06.

**Sibling discipline suite (authored):** `system-spec/09_engineering_discipline/README.md` + its 17 discipline files.

---

## A. The digest is the constitution

The **Target-Architecture Digest** is the single source of truth that every spec section (this one included) conforms to. **Where a section disagrees with the digest, the digest wins — until amended via [ADR](#9-change-management-adrs).** This README is the digest's primary expansion: it does not add policy beyond it, only organizes and binds it. If you find a contradiction between this README and the digest, the digest is correct and this file has a bug — file an ADR. The one exception the digest itself grants: if a section author hits a contradiction between the digest and a **verified API fact** (e.g., a model id, pricing, or parameter the vendor confirms), flag it rather than silently following the digest.

## B. Glossary

The full controlled vocabulary lives in [`glossary.md`](glossary.md) (normative, no-synonyms). The terms most load-bearing for navigating this index:

| Term | Meaning |
|---|---|
| **Speculative generation** | Background (re)generation of a draft from each meaningful autosave, keyed by a content hash; superseded by a newer hash. The core of perceived-wait ≈ 0. |
| **CommandBus / EventBus** | The single bus on which every mutation is a `Command` and every result an `Event`; the net-new construct that makes humans and AI symmetric actors. |
| **Symmetric actor** | A human or AI agent — both issue commands on the bus, bound by identical audit and gates; going AI-first is an additive subscriber, not a rewrite. |
| **`DoseEnginePort`** | The sealed pure port wrapping the 745-line dose engine (runtime authority, C5); AI proposes drug + regimen with no numbers, the engine computes and the server re-checks byte-for-byte. `web/dose-engine.js` is the frozen parity oracle. |
| **`ModelPolicyPort` / model-id firewall** | The config object that is the *only* place a Claude model id may appear; CI rule `core_no_model_id_literals` blocks it anywhere else. |
| **Fitness rule** | A CI merge-blocker that fails the build when code crosses an architectural boundary (the digest's structural-drift control). |
| **`transition(state, event)`** | The pure state-machine spine; invalid transitions throw and are never persisted, even on failure paths. |
| **`verification_status='legacy'`** | The migration convention marking backfilled live records that predate the new constraints. |
| **Off-edge worker** | The Hono/Cloud-Run process running the Claude tool-loop off the Supabase Edge 150s wall — the headline fix. |
| **Env flip (`DIS_STACK=aws`)** | The single switch in the composition root that swaps Supabase adapters for AWS ones; the portability guarantee (I7). |
| **`05_*` family** | The two "05-class" sibling directories — `05_ai/` (AI substance) and `05_integration/` (ABDM/FHIR substance); a family, not a single section (`canonical_decisions.md §B.0`). |
| **`ai_assisted_rx` consent gate** | The C6 DPDP precondition: generation is blocked at `RequestGeneration` unless an active guardian consent exists → `CONSENT_REQUIRED` (403). |
| **Fidelius / JWS QR** | ABDM crypto (Curve25519 Short-Weierstrass, not Montgomery) and the ES256-JWS signed QR that replaces the forgeable 6-char client-salt hash. |

---

> **Bottom line.** This is the target state, not the prototype. Build off the edge so the doctor never waits; let the dose engine own every number; put humans and AI on one bus so autonomy is additive; and hang bilingual print, ABDM/FHIR, NABH, and DPDP off a hexagonal, config-driven, env-portable core — every boundary gated by `09_engineering_discipline`.
