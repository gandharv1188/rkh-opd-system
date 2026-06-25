# Non-Goals / Out-of-Scope

> **Status:** Normative for the target-state rebuild. This file is the **negative space** of the architecture: it names what the rebuilt Radhakishan pediatric OPD prescription system **does not** build, touch, or design for in the rebuild's defined scope. It is paired with `north_star.md` (what we *do* build) and governed by the [TARGET-ARCHITECTURE DIGEST], which wins on any conflict.
>
> **Why a non-goals file is load-bearing here.** This rebuild is large (frontend + backend services + database + AI orchestration + ABDM/FHIR + compliance) and agent-built in parallel slices. The dominant failure mode of an agent-built system is **scope drift** — a slice quietly absorbs an adjacent concern and the blast radius, the eval surface, and the review burden balloon. Every item below is a **fence**: if a ticket, PR, or slice drifts toward it, the slice must be **split** and the drift flagged, not silently accommodated.
>
> **How to read an entry.** Each non-goal states (a) what is excluded, (b) the **boundary** (where the line sits — often a port or schema column that *anticipates* the future without building it), and (c) the **rationale**. A non-goal is a deliberate deferral with a seam, **not** an architectural blind spot.

---

## How a non-goal differs from a deferred feature

| Concept | Meaning | Example here |
|---|---|---|
| **Non-goal (this file)** | Out of the rebuild's defined scope. Must not be built. Drift toward it splits the ticket. | Multi-hospital SaaS tenancy; native mobile apps; HIU (M3) ABDM. |
| **Seam-but-not-implementation** | A port/column/flag exists so the future is *additive*, but the behavior is not built. | `facility_id` column + RLS scope (multi-site seam) with single-facility data only; symmetric command-bus actor layer with no autonomous AI agent wired in. |
| **Phased-in (in `north_star`/roadmap)** | In scope, sequenced later. **Not** a non-goal. | ABDM M2 (HIP push); self-host OCR threshold; AWS stack flip. |
| **Owned by a sibling suite** | In scope for the program, but authored elsewhere — do not duplicate. | The TDD/eval operating model (`09_engineering_discipline/`). |

> **The seam discipline (decisive).** Where the digest says "portable by an env flip" or "additive subscriber, not a rewrite," the rebuild **builds the seam now and the behavior later**. A seam is a port interface, a config key, a nullable schema column, or a feature flag — never a half-built feature. Building the seam is *in scope*; building the behavior behind it is the non-goal. This is the open/closed principle applied to scope.

---

## A. Product & clinical scope

### A1. Non-pediatric / general OPD, IPD, and other departments

The system is **pediatric OPD only**. It does **not** model adult medicine, inpatient (IPD) admissions, ward rounds, OT scheduling, billing, pharmacy inventory/dispensing, emergency/casualty, ANC/maternity, or any other hospital department.

- **Boundary:** the clinical model (dosing bands, growth z-scores, IAP/NHM vaccination schedules, neonatal/preterm logic, corrected-vs-chronological age) is intrinsically pediatric. The `facility_id` and `identity` schemas anticipate other sites/practitioners but **not** other care settings.
- **Rationale:** a full HMIS is a different product with a different safety surface and regulatory footprint (CDSCO is the binding regulator for clinical decision support; widening to adult dosing or IPD multiplies the eval set and the never-events suite). The dose engine's pediatric assumptions would be silently wrong for adults.

### A2. Autonomous prescribing — no AI-finalized prescription, ever

The AI **drafts**; a human doctor **reviews and signs**. There is **no** mode in scope where a prescription is finalized, issued, or printed without an explicit doctor `SignOff` command.

- **Boundary (seam, not behavior):** the **symmetric-actor command bus** is built so that a future "AI-drafts-then-doctor-signs" or even fully autonomous agent is an *additive subscriber* that emits `RequestGeneration` and `SignOff` commands. The seam exists; the autonomous signer is **not wired in**. The clinical-safety invariant — an AI draft stays `pending_review` until a human `SignOff` — is enforced by the state machine (`transition()` throws on any path that issues without sign-off) and is **not** weakened by this seam.
- **Rationale:** patient safety and the regulatory firewall. Keeping mandatory physician sign-off is what keeps the CDS non-device-shaped and is the real clinical backstop behind the eval gates. Going AI-first later is a deliberate, separately-scoped, separately-gated decision — never an accident of a refactor.

### A3. The AI does not compute, validate, or override any dose number

Drug/dose arithmetic is **exclusively** the deterministic dose engine's job. The AI selects drugs/regimens and narrates; it **never** produces a number (mg/ml/drops/tablet fraction, max-dose cap, BSA, GFR adjustment) that reaches paper.

- **Boundary:** the AI proposes a med + regimen with **no numeric fields**; the sealed `DoseEnginePort` recomputes every number, rebuilds the bilingual R2/R3 rows + pictogram, applies caps/therapeutic-range checks, and the server re-checks byte-for-byte. Mismatch → `REVIEW REQUIRED`. There is **no tolerance band** — a numeric disagreement is a flag, not an averaged compromise.
- **Rationale:** this is axiom **A5** of the rebuild and the single most important safety boundary. A second, parallel, or "good-enough" dose path anywhere is out of scope by construction; it is a fitness-function build failure, not a design option.

### A4. No standalone clinical-knowledge authoring tool

The system **consumes** the curated formulary (~530 drugs) and ICD-10 protocols (~446) as a governed, contract-tested knowledge base. It does **not** ship a built-in CMS/editor for clinicians to author, version, or peer-review drug monographs, dosing bands, or protocols inside the app.

- **Boundary:** the formulary/protocol KB is governed via **migrations + seed scripts + an Ajv JSON-schema gate** (verified-vs-placeholder provenance, six-eye review captured as data). Editing happens through the governed data pipeline, not an in-app authoring UI.
- **Rationale:** clinical-content governance is a curation discipline, not a runtime feature. An in-app editor bypassing the schema gate and provenance review would re-open the exact safety hole the governance closes.

### A5. No telemedicine, patient-facing portal, or appointment/queue management

No video consults, no patient login/app, no online booking, no token-queue display boards, no patient SMS/WhatsApp notifications, no feedback/review collection.

- **Boundary:** the system serves the **in-clinic 3-stage workflow** (reception → nurse → doctor pad → print) for **staff** actors. The patient's only artifact is the printed bilingual Rx (with signed QR).
- **Rationale:** each is a distinct product surface with its own consent, identity, and availability requirements. The QR on the printed Rx is a verification affordance, not the seed of a patient portal.

### A6. No analytics, BI, dashboards, or secondary-use of clinical data

No operational/clinical dashboards, no cohort analytics, no Looker/Metabase/BI exports, no ML training on patient data, no population-health reporting, no marketing or research secondary-use.

- **Boundary:** **operational logging, the append-only audit log, the per-generation `prescription_audit` event stream, and a cost ledger are in scope** (they are safety, traceability, and FinOps machinery). Product/clinical analytics on top of them are not.
- **Rationale:** **DPDP Act 2023 + Rules 2025** — nearly every patient is a child; the healthcare exemption is scope-limited to *service delivery*. Analytics/marketing/secondary-use fall outside the exemption and would require a separate consent and lawful basis. Out of scope keeps the compliance surface honest.

---

## B. Platform, deployment & infrastructure scope

### B1. Supabase Edge Functions are NOT the long-running compute host

No part of the rebuild runs the Claude tool-use loop, FHIR generation, or any long-running compute inside a Supabase Edge Function. The 150s wall-clock (observed: HTTP **546 / 504 at exactly 150,000ms** on `generate-prescription`) is the root flaw the rebuild exists to kill.

- **Boundary:** long-running compute runs **off-edge** on the Hono container (Fly.io/Render at POC → Cloud Run/AWS at prod) pulling from a durable queue. Edge Functions, *if kept at all*, are reduced to **thin signed-webhook receivers** that `validate → enqueue → 202` and SSE relays — never the tool-loop host.
- **Rationale:** the entire latency design (off-edge worker + speculative background generation + streaming) depends on this. Re-introducing a tool loop into a time-capped function re-introduces the founding bug. Any timeout/budget/fallback workaround that existed only to survive the edge wall is **deleted**, not ported.

### B2. No multi-cloud-at-once and no premature AWS build

The POC runs on **one** stack (Supabase Postgres/Auth/Storage + a Hono container on Fly/Render). The AWS path (Cloud Run/ECS, SQS, RDS, S3, Secrets Manager, Cognito) is a **portability target reached by an env flip (`DIS_STACK=aws`)**, not a parallel deployment built now.

- **Boundary (seam, not behavior):** every vendor sits behind a **port** with a `__fakes__` peer and an env-selected adapter (the only composition root is `wiring/`). Fitness rules (`supabase_sdk_only_in_supabase_adapters`, `aws_sdk_only_in_aws_adapters`) enforce that no business code knows which cloud it is on. The AWS *adapters* are written only when the prod migration runs.
- **Rationale:** portability is a design property enforced by the hexagon; standing up AWS infra before the POC validates is premature infrastructure work with no payoff.

### B3. No native mobile apps; tablet-web only

No iOS or Android native application, no React Native / Flutter client, no app-store presence. The doctor's pad, reception, and print station are **web** surfaces.

- **Boundary:** the SPA is **tablet-first** (touch targets, the dose slider, and voice dictation are first-class; WCAG 2.2 AA, Lighthouse ≥90). That is the mobility commitment.
- **Rationale:** a native app is a product decision with its own distribution, update, and offline-sync surface. A responsive, accessible web app covers the clinic tablet use case without that overhead.

### B4. No offline-first / local-first operation

The system assumes connectivity to its backend during the consult. No offline queue of consults, no local-first CRDT store, no service-worker write-buffer that reconciles on reconnect.

- **Boundary:** the speculative/streaming generation is a *latency* optimization over a live connection, **not** an offline capability. Autosave persists to the server; it is not a local-first store.
- **Rationale:** offline-first multiplies the consistency, conflict, and audit surface (especially for signed, immutable prescriptions). Out of scope until a verified clinic-connectivity problem justifies it.

### B5. No real-time multi-user collaboration on a single record

Two clinicians cannot simultaneously co-edit the same draft note, prescription, or registration. **Last-writer-wins with optimistic locking** (`version` column → `409 VersionConflictError`) is the concurrency model. No presence indicators, live cursors, or CRDT merge.

- **Boundary:** the 3-stage handoff (reception → nurse → doctor) is **sequential by workflow**, not concurrent co-editing. Concurrency control protects against *accidental* clobber, not collaborative editing.
- **Rationale:** at OPD volume, true co-editing is unneeded complexity; optimistic locking is sufficient and already proven in the `dis/` foundation.

### B6. The realtime channel is SSE / status-row, not WebSocket

The notify channel for streamed generation deltas and job status is **SSE (or short-interval status-row poll)**. Supabase Realtime WebSocket is **not** used; it was removed for IO cost.

- **Boundary:** the `RealtimePort` abstracts the notify mechanism; SSE is the chosen adapter. A future WebSocket holder (e.g., a Fly persistent worker) is a portability option, not a rebuild deliverable.
- **Rationale:** SSE meets the streaming UX requirement at far lower IO cost; re-adding the WebSocket subscription would reverse a deliberate IO fix.

---

## C. Data, integration & interoperability scope

### C1. ABDM HIU (M3) and consent-broker flows are deferred

The rebuild sequences **M1 (ABHA at registration, V3 API) → M2 (HIP push: OPConsultation / Prescription / DiagnosticReport / ImmunizationRecord)**. **M3 (HIU — pulling external records via consent requests)** is explicitly out of the rebuild's initial scope.

- **Boundary (seam, not behavior):** the `AbdmGatewayPort` is shaped to cover session/auth, `on-*` callbacks, `pushHealthInformation`, and consent so that HIU is an additive set of handlers, not a re-architecture. `abdm_inbox`/`abdm_outbox` exist for reliable callbacks. M3 *handlers* are not built.
- **Rationale:** HIP push (sharing what we generate) is the higher-value, lower-coupling half and earns the NABH Silver→Gold credit; HIU (consuming others' data) has a separate compliance and reconciliation surface best deferred until HIP is live.

### C2. No legacy FHIR/HL7v2/DICOM/lab-analyzer integrations

No HL7 v2 ADT/ORM/ORU interfacing, no DICOM imaging pipeline or viewer, no direct lab-analyzer (ASTM/HL7) feeds, no inbound CCDA/non-ABDM FHIR ingestion.

- **Boundary:** structured FHIR R4 is produced **only** for the ABDM HIP path via the pure `NrcesR4Adapter` (NRCeS R4 profiles). Labs enter via structured reception entry and the document-ingestion (OCR-staged) path — not analyzer feeds. Document ingestion handles a bounded file set (PDF/JPEG/PNG/HEIC/WebP/TIFF/DOCX/XLSX); **DICOM and archives are rejected at upload.**
- **Rationale:** each legacy protocol is a heavyweight integration with its own conformance testing; none is on the critical path for the OPD Rx workflow. DICOM is a separate imaging pipeline; archives risk zip-bombs.

### C3. No bulk reprocessing / re-generation of historical prescriptions

The rebuild applies to **new** consults. Historical prescriptions already issued are **not** re-generated, re-validated by the new dose engine, or re-rendered. Legacy clinical rows are migrated with `verification_status='legacy'` and **not** retroactively "upgraded."

- **Boundary:** the data migration (§5 of the digest) is forward-only, abort-on-duplicate, and preserves legacy data as-is under a `legacy` marker. A backfill/re-validation ticket may be scheduled **separately** if the clinical team requests it.
- **Rationale:** re-generating a signed, printed, possibly already-acted-upon prescription is clinically meaningless and audit-hostile. Immutability of signed records is a feature, not a limitation.

### C4. No general-purpose ETL / data-warehouse / HIE export

Beyond the one-time current-Supabase-data migration and the ABDM HIP bundle export, the system does **not** provide a generic data-export API, a warehouse sync, or a health-information-exchange feed.

- **Boundary:** the migration is a **one-time, reversible, gated** ETL (baseline → clean → backfill → uuid+UHID-key → dedupe → reconcile → cutover), not a standing pipeline. ABDM HIP is the only external data egress.
- **Rationale:** standing export pipelines are a secondary-use surface (DPDP, §A6) and a maintenance burden with no current consumer.

---

## D. Identity, access & security scope

### D1. No new IdP / SSO / federated-identity system

The rebuild uses **Supabase Auth (real JWT) with per-role RLS** (`reception`, `nurse`, `doctor`, `service`, `admin`). It does **not** build or integrate an external SSO/OIDC provider, SAML federation, MFA hardware, or a custom user-management console beyond role assignment.

- **Boundary (seam, not behavior):** RLS is expressed portably via `current_setting('app.role' / 'app.doctor_id' / 'app.facility_id')` set from the JWT at request start, so it runs unchanged on Supabase **and** RDS, and Cognito is a later adapter swap. Replacing blanket `authenticated_full_access`-over-anon-key with real per-role RLS **is in scope**; a new IdP is not.
- **Rationale:** the security win is *real RLS + real JWT + no-anon-key-on-clinical-schemas*, which is achievable on Supabase Auth. A federated IdP is a separate procurement/integration with no current driver.

### D2. No penetration testing, formal certification, or third-party audit delivery

The rebuild **builds for** DPDP 2023 + Rules 2025, NABH Digital Health 2nd-ed (Sep 2025), and CERT-In, and ships the controls (real RLS, append-only audit, PII-stripping boundary, secrets via `SecretsPort`, signed-QR ES256 JWS, guardian-consent capture, breach-runbook clocks). It does **not** itself deliver a pen-test report, a NABH assessor sign-off, a DPDP DPIA document, or a CERT-In empanelled audit — those are **external activities** performed by qualified third parties against the built system.

- **Boundary:** *compliance-by-design controls* are in scope; *compliance certification/attestation* is an external program the controls enable.
- **Rationale:** certification is a procurement/legal activity, not a software deliverable. Conflating them would let "we wrote the control" masquerade as "we are certified."

### D3. No homegrown cryptography

No custom cipher, custom key-exchange, or hand-rolled signature scheme. ABDM encryption uses **Fidelius (Curve25519 Short-Weierstrass)** via a `CryptoBoxPort`; prescription QR uses **ES256 JWS** via a `SignaturePort`.

- **Boundary:** crypto is confined to vetted libraries behind ports; the forgeable 6-char client-salt QR hash and the `api.qrserver.com` round-trip are **removed**, not re-engineered in-house.
- **Rationale:** rolling crypto is a never-event for a clinical system. The non-goal is *inventing* crypto; *using* standard primitives correctly is the goal.

### D4. No PII/PHI to the model, and no in-prompt patient identifiers

Sending raw patient identifiers (name, UHID, guardian, contact, ABHA) into the LLM prompt is out of scope. The PII-stripping in `get_previous_rx` and visit-summary is a **typed boundary**, not an optional nicety.

- **Boundary:** the model receives de-identified clinical content only; identifiers stay server-side and are re-attached after generation. No identifier appears in the cacheable prompt prefix (also a caching correctness requirement).
- **Rationale:** DPDP child-data minimization and NABH privacy. A PII leak into a third-party model is a reportable breach.

---

## E. AI orchestration scope

### E1. No multi-provider model marketplace; no per-request model auto-tuning

The rebuild fixes the **per-task model policy** behind one `ModelPolicyPort` (Opus 4.8 for generation; Haiku/Sonnet for summary/lookup/OCR-structuring per the digest table). It does **not** build a model-router marketplace, a cost-bidding auto-selector, or runtime A/B model experimentation in production traffic.

- **Boundary (seam, not behavior):** model ids and effort/thinking settings live in **config only** (CI rule `core_no_model_id_literals` forbids `claude-*` literals in business code). A **single, flagged fallback** — model-tier downgrade Opus 4.8 → Sonnet 4.6 on overload/5xx/timeout, *with flagging* — is in scope; a general router is not.
- **Rationale:** the founding incident was a hardcoded dated model id retired by the vendor. The fix is *centralized, gated, swappable config* — not a speculative routing layer that adds its own surface. Model/prompt experimentation is the eval suite's job (owned by §F), gated, not a live-traffic feature.

### E2. No fine-tuning, no self-hosted LLM, no RAG vector store

No fine-tuned/custom model, no on-prem LLM serving, no embedding/vector database, no semantic-search RAG over clinical literature.

- **Boundary:** clinical knowledge reaches the model via **progressive-disclosure tools** (`get_formulary`, `get_standard_rx`, `get_previous_rx`, `get_lab_history`, `get_reference`, `compute_doses`) backed by Postgres/Storage — a structured, auditable retrieval, not a vector index. Self-hosting the OCR model (Chandra) is a **separately-triggered phase** at sustained 1000 docs/day, not a rebuild deliverable.
- **Rationale:** the tool-based retrieval is deterministic, cheaper to audit, and PII-controllable. Fine-tuning/vector-RAG add training-data governance and drift surfaces with no demonstrated need at this scale.

### E3. No AI features beyond the named set

The AI surface is bounded to: **prescription generation, returning-patient visit summary, OCR structuring, and drug/protocol lookup formatting.** No AI scribe for the full encounter, no differential-diagnosis engine, no AI triage, no chatbot, no AI-authored patient education leaflets, no coding/billing automation.

- **Boundary:** voice **dictation → text** is in scope (dual-engine VAD: AI transcribe primary, Web Speech fallback, behind `TranscriptionPort`); voice *understanding/agentic action* is not.
- **Rationale:** each added AI surface needs its own golden eval set, never-events, and safety gating. Scope is held to the four tasks the workflow actually needs.

---

## F. Process & governance scope (owned elsewhere — do NOT duplicate)

### F1. The TDD / eval / engineering-discipline operating model is NOT authored here

This spec defines **WHAT** the system is. **HOW it is built and proven** — review gates, the agentic-dev protocol, drift prevention, fitness functions, the golden eval set, contract tests, OpenAPI-as-truth, CI topology, risk-tier routing — is owned by the parallel **`system-spec/09_engineering_discipline/`** suite.

- **Boundary:** this architecture spec *names* the things that get gated (dose-engine golden JS↔TS parity, generation eval over a frozen pediatric fixture set, FHIR snapshot validation, `GenerationPort` state-contract tests, the `core_no_model_id_literals` rule). The discipline suite *defines the runner, thresholds, and gate topology*. Authoring those here would create two conflicting sources of truth.
- **Rationale:** the digest is explicit — the discipline suite owns the operating model; this spec must not duplicate it. A duplicated, divergent gate definition is itself a drift hazard.

### F2. No project-management, ticketing, or RACI content in the architecture spec

Backlogs, epics, ticket templates, RACI matrices, session handoffs, and rollout-comms/training plans (as seen in the `dis/` `07_tickets` / `08_team` trees) are **not** authored into this architecture spec.

- **Boundary:** the architecture spec states the **phased migration order** (the technical sequence) and the **feature-flag ladder / kill-switch** as *architectural* controls. The day-to-day execution artifacts live in their own process suite.
- **Rationale:** mixing execution ceremony into the target-state spec dilutes it and ages quickly. Keep the spec about the system, not the project plan.

---

## G. Out-of-scope summary table

| # | Non-goal | In scope instead | Seam preserved? |
|---|---|---|---|
| A1 | Adult / IPD / other-department HMIS | Pediatric OPD only | `facility`/`identity` schemas (sites/practitioners) |
| A2 | AI auto-finalized prescriptions | AI draft → **doctor `SignOff`** | Symmetric command bus (additive AI actor) |
| A3 | AI computing/overriding dose numbers | Deterministic `DoseEnginePort` (A5) | — (hard boundary) |
| A4 | In-app clinical-content authoring CMS | Governed KB via migrations + Ajv gate | Provenance columns in `catalog` |
| A5 | Telemedicine / patient portal / queue mgmt | In-clinic staff 3-stage workflow + printed Rx | Signed-QR verify endpoint |
| A6 | Analytics / BI / secondary-use of PHI | Audit log + `prescription_audit` + cost ledger (ops only) | — |
| B1 | Edge Function as tool-loop host | **Off-edge** Hono worker + queue + SSE | Edge = thin webhook/relay only |
| B2 | Premature AWS / multi-cloud build | One POC stack | Ports + `DIS_STACK` env flip |
| B3 | Native mobile apps | Tablet-first accessible web SPA | — |
| B4 | Offline-first / local-first | Connected operation; server autosave | — |
| B5 | Real-time co-editing | LWW + optimistic locking (`version`/409) | — |
| B6 | Realtime WebSocket | SSE / status-row poll | `RealtimePort` |
| C1 | ABDM HIU (M3) | M1 ABHA → M2 HIP push | `AbdmGatewayPort` + inbox/outbox |
| C2 | HL7v2 / DICOM / analyzer / non-ABDM FHIR | ABDM-only FHIR R4 (`NrcesR4Adapter`); bounded file ingest | — |
| C3 | Bulk reprocessing of historical Rx | New consults; legacy data preserved as `legacy` | Optional later backfill ticket |
| C4 | General ETL / warehouse / HIE export | One-time gated migration + ABDM HIP egress | — |
| D1 | New IdP / SSO / federation | Supabase Auth + **real per-role RLS** | Portable `current_setting` RLS → Cognito adapter |
| D2 | Pen-test / certification / audit delivery | Compliance-**by-design** controls shipped | — |
| D3 | Homegrown cryptography | Fidelius + ES256 JWS via ports | `CryptoBoxPort` / `SignaturePort` |
| D4 | PII/PHI to the model | De-identified clinical content only | Typed PII-stripping boundary |
| E1 | Model marketplace / live A/B routing | One `ModelPolicyPort` + single flagged fallback | Config-only model ids |
| E2 | Fine-tune / self-hosted LLM / vector-RAG | Tool-based progressive disclosure | `OcrPort` self-host threshold (later phase) |
| E3 | AI scribe / dx engine / triage / chatbot | 4 named AI tasks only | `TranscriptionPort` (dictation only) |
| F1 | TDD/eval operating model | Authored in `09_engineering_discipline/` | Spec names what gets gated |
| F2 | PM / ticketing / RACI / comms | Phased order + flag ladder + kill-switch (as controls) | — |

---

## H. The escape hatch — when a non-goal must change

A non-goal is **decisive but not permanent**. To bring any item above into scope:

1. **Raise an ADR** that names the item, the driver (a verified clinical/compliance/operational need — not convenience), the new boundary, and the seam it lands on.
2. **Confirm the seam holds.** If the rebuild built the right seam (a port, a column, a flag), promotion should be *additive*. If it requires a rewrite, that is a signal the seam was wrong — fix the seam discussion first.
3. **Re-tier the risk and the gates.** Anything touching dosing, prescription issuance, PHI, ABDM, secrets, or the model/prompt is High-risk: it inherits the full eval gate + named human approver (per the discipline suite).
4. **Update this file and `north_star.md` together** so the system's positive and negative space stay consistent.

> **Bottom line.** Scope here is a safety and focus instrument, not a wish-list cut. Every fence above either protects a clinical/compliance invariant or preserves the rebuild's leverage (off-edge latency, hexagonal portability, the symmetric-actor seam). Crossing a fence is a deliberate, ADR-gated act — never the quiet byproduct of a drifting ticket.
