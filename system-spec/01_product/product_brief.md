# Product Brief — Radhakishan Pediatric OPD Prescription System (Target-State Rebuild)

> **Status:** Target-state specification (rebuild), not as-built. This document describes what we are building toward, decisively. Where it disagrees with the current `web/` + Edge-Function prototype, this document wins.
>
> **Audience:** Product, clinical leadership (Dr. Lokender Goyal), engineering, NABH/compliance, and every downstream file-authoring agent in the `system-spec/` suite. This is the `01_product` anchor; deep technical specs (`02_*`–`10_*`) build on the vision, users, value, and capabilities defined here.
>
> **Scope of this file:** *What the system is, who uses it, the value it delivers, and the core capabilities.* Architecture, schema, AI orchestration, API, security, and rollout are specified in their own files and only summarized here for orientation.

---

## 1. What the system is

The Radhakishan Pediatric OPD Prescription System is the **clinical operating surface for the outpatient department** of Radhakishan Hospital — a NABH-accredited pediatric and neonatal hospital in Jyoti Nagar, Kurukshetra, Haryana. It carries a child from **walk-in to a printed, bilingual, pictogram-illustrated, NABH-compliant prescription** and onward into India's national digital-health rails (ABDM/ABHA + FHIR R4), as one continuous, auditable flow.

It is three things at once:

1. **A lightweight OPD EMR** — registration, demographics, allergies, vitals, growth, labs, vaccinations, visit history — purpose-built for high-volume **pediatric** practice (neonate to 12 years), not a generic adult HMIS bent to fit.
2. **An AI-assisted prescription authoring tool** — the doctor states intent in plain clinical language (typed or dictated); the system drafts a structured, safety-checked prescription. **The AI selects drugs and regimens and narrates; it never computes a number that reaches paper.** A sealed, deterministic dose engine is the sole arithmetic authority. Every AI draft is a **draft** until a human doctor reviews and signs.
3. **A compliance and interoperability engine** — every prescription is NABH-structured, every action is auditable, every signed record can be packaged as a FHIR R4 bundle and pushed to the patient's ABHA-linked health record under explicit consent, and child-data handling meets DPDP Act 2023 obligations.

### The one design decision that defines the product

> **The doctor's perceived wait to a reviewable prescription is approximately zero.**

The current prototype generates prescriptions **synchronously inside a Supabase Edge Function with a hard 150-second wall-clock limit**. Generation realistically takes 50–150s; doctors have waited up to ~5 minutes and hit `504`/`546` failures at exactly `150,000ms`. In a busy OPD this is the product's central failure.

The rebuild removes the wall entirely and inverts the timing:

- **Off-edge long-running compute.** The Claude tool-use loop runs on a persistent worker (Hono container; Cloud Run / Fly), pulling from a durable Postgres job queue — never in a timeout-capped function.
- **Speculative, background generation during the consult.** The doctor's note already auto-saves as they type/dictate. Each meaningful save speculatively (re-)generates a draft in the background, keyed by a content hash of the note + patient context + selected sections. By the time the doctor clicks **Generate**, a fresh draft usually already exists.
- **Streaming, review-first UX.** Generation streams (diagnosis → medicines → safety checks appear progressively). Clicking Generate opens the review at ~0ms when the speculative draft matches the current note; otherwise it shows a short, honest "regenerating from your latest note…" state — **never an infinite spinner**, always a definite end state (ready / retry / manual edit).

This is not a performance tweak bolted onto the old design — it is the spine the whole system is built around. Everything else (bilingual print, ABDM/FHIR, NABH auditability, DPDP compliance) hangs off a hexagonal, port/adapter, config-driven core that keeps humans and AI as **symmetric actors on one command/event bus**, so a future "AI drafts, doctor signs" autonomous mode is an *additive subscriber, not a rewrite*.

### What it is not

- **Not a diagnosis engine.** The doctor states the diagnosis; the system structures intent, applies matching protocols, calculates doses safely, and checks for hazards. It does not decide *what is wrong with the child*.
- **Not an autonomous prescriber.** No prescription is ever finalized without a human doctor's sign-off. This is a clinical-safety invariant enforced in the state machine, not a setting.
- **Not a billing/inventory/IPD system.** It is the OPD prescription and clinical-capture surface. Billing, pharmacy stock, and inpatient flows are out of scope for this product (integration seams may exist; the workflows do not).
- **Not the document-ingestion service.** OCR of uploaded external records is a separate bounded context (`dis/`) that feeds *staged* data in under a confidence gate; it never writes clinical tables directly.

---

## 2. Users and roles

The system serves **five roles** across a three-stage OPD workflow plus print and administration. Roles are enforced by real, JWT-derived row-level security — not a blanket policy over a shared anonymous key. Each role sees only what its job requires.

| Role | Stage | Primary surface | What they do | What they must never do |
|---|---|---|---|---|
| **Reception** | 1. Intake | Registration page | Register/look up patient, capture demographics, allergies, guardian consent, external records, create the visit, capture chief complaints. Generate UHID + token. | Edit clinical vitals, write or sign prescriptions, see other facilities' data. |
| **Nurse** | 2. Triage | Registration page (nurse section) | Capture vitals — weight, height, head circumference, MUAC, temperature, HR, RR, SpO₂. Weight is the gate for dose calculation. | Author or sign prescriptions; alter demographics arbitrarily. |
| **Doctor** | 3. Consult | Prescription Pad | The clinical decision-maker. Reviews captured data, growth trends, recent labs, vaccination status, and previous prescriptions; states intent by typing or dictation; reviews the AI draft; adjusts doses (via the engine, never freehand math); resolves safety flags; **signs off** (the only action that finalizes a prescription). | Be bypassed — no draft becomes a final prescription without an explicit doctor sign-off command. |
| **Print operator** | Output | Print Station (standalone) | Load today's signed prescriptions, search/filter by patient/UHID/Rx ID, print the canonical A4 document. | Modify clinical content; print unsigned drafts. |
| **Admin** | Cross-cutting | Admin surfaces (formulary, standard-Rx, config) | Maintain the formulary (~530 drugs) and standard protocols (~446 ICD-10 entries) under six-eye review provenance; manage users/roles/facility config; view audit and operational dashboards. Centralized config/secrets — model IDs, keys, URLs live here, never hardcoded. | Touch a *signed* prescription's clinical content (immutable; edits create new versions). Read raw PHI beyond their administrative need. |

### Symmetric actors (humans **and** AI)

A defining architectural commitment that matters at the product level: **every mutating action — a doctor's edit, a nurse's vitals entry, a reception sign-up, a future AI agent's draft — is expressed as the same `Command` on one bus, producing the same `Event`s.** Today the AI is a *tool the doctor invokes*; the bus is designed so that tomorrow the AI can be an *actor that proposes* (drafting from the note autonomously) while the doctor's sign-off remains the immovable safety gate. Going "AI-first" later is adding a subscriber, not re-platforming.

### Persona snapshots

- **Reception clerk** — high throughput, India-financial-year UHID (`RKH-<FY4><MM2><SEQ5>`, regex `^RKH-\d{11}$`, 4-digit FY code) issued server-side (no client-side race), returning-patient lookup by name/UHID/guardian/token, QR re-registration. Speed and zero-ambiguity patient matching are the job.
- **Staff nurse** — fast, accurate vitals on a tablet; auto-units, auto-flags, large touch targets. The **missing-weight prompt** at Generate exists because pediatric dosing is weight-based; the nurse's weight is load-bearing.
- **Dr. Lokender Goyal / pediatrician** — the product's center of gravity. Wants: state intent once, in his own words (English/Hindi, typed or dictated); see a *correct* draft instantly; trust the arithmetic completely; catch allergy/interaction/max-dose hazards before they reach the child; sign and move on. Perceived wait ≈ 0 is for him.
- **Print operator / front desk** — reliably produce a clean, legible, low-literacy-friendly A4 that the guardian can actually follow at home.
- **Hospital admin / Dr. Gandharv (product owner)** — formulary governance, compliance posture (NABH, DPDP, ABDM), cost and reliability visibility, safe configuration changes (the day a hardcoded dated model ID was retired and broke production is *why* config is centralized).

---

## 3. Value

### For the doctor
- **Time returned to the patient.** Perceived wait ≈ 0 instead of 50–150s (or a 5-minute failure) per prescription. Across an OPD day this is the difference between the tool helping and the tool being abandoned.
- **Arithmetic he can trust without re-checking.** A deterministic dose engine — gated by golden parity fixtures — owns every mg/ml/drop/tablet. The AI proposes drug + regimen with *no numbers*; the engine computes, rounds (syrups 0.5ml, drops 0.1ml, tablets ¼), and caps to max single/daily dose. Mismatch ⇒ `REVIEW REQUIRED`. The doctor stops doing mental math under time pressure — the documented source of dosing errors.
- **Safety as a visible gate, not a footnote.** Allergy conflicts, drug interactions, and max-dose breaches surface inline; a high-severity flag disables Sign-off until acknowledged (and re-applies after any edit, so high→edit→save can't bypass). Provenance is visible: AI-generated lines are distinguishable from clinician edits.

### For the patient and guardian
- **A prescription they can follow.** Every medicine is rendered in a 4-row block: GENERIC NAME (CAPS) with concentration → English dosing → Hindi/Devanagari dosing → an inline-SVG pictogram sidebar (sunrise/sun/sunset/moon, dose quantity, food/duration). Designed for low-literacy guardians; pictograms always paired with text (never icon-only).
- **Continuity of care.** Growth tracked across visits (WHO z-scores), labs and vaccinations on record, previous prescriptions one tap away, and the record portable into ABDM so it follows the child.

### For the hospital
- **NABH compliance built in, not bolted on.** Every prescription is NABH-structured; every generation, tool call, model used, and sign-off is an auditable event stream — satisfying traceability requirements and supporting Silver→Gold progression under NABH Digital Health 2nd edition.
- **National interoperability (ABDM/ABHA + FHIR R4).** ABHA capture at registration; signed prescriptions packaged as FHIR R4 bundles (OPConsultation, Prescription, DiagnosticReport, ImmunizationRecord) and pushed to the patient's health record under explicit, recorded consent.
- **Regulatory defensibility.** DPDP Act 2023 child-data obligations met (guardian consent captured distinctly from ABDM consent; service-delivery scope; breach runbook). Real RLS + JWT closes the single biggest privacy liability in the prototype.
- **Lower cost, higher reliability.** Prompt caching and per-task model policy cut token cost and time-to-first-token; off-edge compute ends the timeout failure class; an append-only audit makes incidents investigable.

### For engineering and the product's future
- **Portable by an env flip.** Hexagonal core with ports/adapters: Supabase today, AWS tomorrow, no rewrite. Vendors (Claude, ABDM, OCR, Storage) sit behind anti-corruption layers, so a model retirement or gateway change is an adapter swap.
- **AI-first ready.** The symmetric command bus means autonomous drafting is an additive layer behind the same human sign-off gate.
- **Safe to change.** TDD/eval-gated; clinical safety enforced as code (state machine + staging/clinical separation), not prompt text; CI fitness rules block architectural drift.

---

## 4. Core capabilities

The capabilities below are the product's functional surface. Each is owned in depth by a downstream spec; this section defines the *what* and the acceptance bar.

### 4.1 Three-stage OPD workflow (Reception → Nurse → Doctor) + Print

```
  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────────┐     ┌──────────────┐
  │ 1. RECEPTION │ ──▶ │  2. NURSE    │ ──▶ │  3. DOCTOR (Rx Pad)      │ ──▶ │  PRINT STATION│
  │ register /   │     │  vitals,     │     │  review data + AI draft  │     │  signed Rx → │
  │ lookup,      │     │  growth      │     │  (speculative, streamed) │     │  A4 print    │
  │ consent,     │     │  inputs      │     │  → adjust dose → resolve │     │  (canonical  │
  │ visit + CC   │     │              │     │  safety → SIGN OFF       │     │   renderer)  │
  └──────────────┘     └──────────────┘     └──────────────────────────┘     └──────────────┘
        │                                              │                              │
        └──────────────── one command/event bus; append-only audit ───────────────────┘
                          (humans and future AI agents are symmetric actors)
```

- **Stage 1 — Reception:** patient register/lookup, demographics, allergies, **guardian consent capture** (DPDP), external-record entry (free-text + document upload), visit creation with chief complaints. Server-side UHID/token allocation (no client race). Neonatal section auto-activates for age < 90 days. QR re-registration for returning patients.
- **Stage 2 — Nurse:** structured vitals (weight, height, HC, MUAC, temp, HR, RR, SpO₂) with auto-units/auto-flags; deterministic growth z-scores (WAZ/HAZ/WHZ/HCZ) via a `GrowthEngine` held to the same source-of-truth discipline as dosing.
- **Stage 3 — Doctor (Prescription Pad):** the critical path — see 4.2.
- **Print Station:** standalone surface that loads today's *signed* prescriptions and prints the single canonical A4 document.

**Acceptance bar:** each stage gated by role-scoped RLS; no stage can perform another's privileged action; the full chain is reconstructable from the audit log.

### 4.2 AI-assisted prescription generation (the headline capability)

- **Intent in, draft out.** Doctor types or dictates a clinical note in English/Hindi. The note auto-saves (debounced, de-duplicated — the prototype's triple-write is fixed via the command bus).
- **Speculative background drafting.** Meaningful note saves and section-chip changes trigger background (re-)generation keyed by content hash; last-write-wins supersedes stale in-flight runs.
- **Off-edge tool-use loop.** A persistent worker runs the Claude loop with progressive-disclosure tools: `get_formulary`, `get_standard_rx` (ICD-10-first), `get_previous_rx` (PII-stripped), `get_lab_history`, `get_reference`, plus `compute_doses`. NABH compliance block is pre-embedded.
- **Streaming, review-first.** Generation streams as domain events; the pad renders diagnosis → medicines → safety progressively. Click Generate ⇒ instant review when the speculative hash matches; honest inline "regenerating…" when stale; defined end states (`ready | stale | error | timeout`) — never an infinite spinner.
- **Standard-protocol discipline:** if the doctor enabled a standard protocol, AI may add first-line drugs *flagged as suggestions to verify*; otherwise it prescribes only drugs the doctor named. The doctor's explicitly written drugs always appear and are never silently dropped or substituted.

**Acceptance bar:** doctor perceived wait ≈ 0 in the common (matched-hash) case; every draft is `pending_review` until a `SignOff` command; every attempt (incl. retries/fallbacks) recorded in the generation audit.

### 4.3 Deterministic dose engine (the safety boundary)

- **Sole arithmetic authority.** AI proposes med + regimen with **no numeric fields**; the sealed pure dose engine recomputes mg/ml/drops/tablets from concentration + dosing band + weight/BSA, rebuilds the bilingual R2/R3 lines and pictograms, and applies per-ingredient max-single/max-daily caps and therapeutic-range checks.
- **No tolerance.** The server re-checks byte-for-byte; an AI-supplied number that disagrees with the engine is rejected and flagged `REVIEW REQUIRED`.
- **Six dosing methods:** weight-based, BSA, GFR-adjusted, fixed, infusion, age/GA-tier. Rounding rules: syrups → 0.5ml, drops → 0.1ml, tablets → ¼.
- **Preterm correctness:** corrected age for growth/development, chronological age for vaccinations; computed on the client, not by the AI.

**Acceptance bar:** golden JS↔TS parity fixtures (≥20 cases covering rounding, caps, bilingual strings) pass as a hard TDD gate before the engine is trusted.

### 4.4 Bilingual + pictogram prescription rendering (one canonical renderer)

- **4-row medicine block:** R1 GENERIC NAME in CAPS (concentration) · R2 English dosing · R3 Hindi/Devanagari dosing · R4 inline-SVG pictogram sidebar (time-of-day, dose quantity, food/duration). All in royal blue.
- **Colour code as design tokens:** blue = medicines, red = investigations, black = everything else.
- **A4 print fidelity:** comfortable spacing (margins 12mm 10mm, body 12px/1.5, med r1 14px / r2-r3 12px, 2-col emergency grid), centered hospital header, NABH badge, Noto Sans Devanagari, inline SVG only (no external images), "AI-assisted, doctor-reviewed" provenance line.
- **One renderer.** The prototype's duplicate `printRx`/`renderRx` is collapsed into a single canonical `<PrintDocument>` shared by pad and print station.

**Acceptance bar:** WCAG 2.2 AA, no colour-only status, pictograms paired with text, identical output from pad and print station.

### 4.5 Pediatric clinical capture

- **Vitals & growth:** full vitals set; WHO z-score growth trends with trend arrows across visits.
- **Labs:** structured pediatric lab panel (hematology, biochemistry, microbiology, imaging) with auto-unit, auto-flag, LOINC/SNOMED coding; flagged recent results surfaced on the pad.
- **Vaccinations:** age-based IAP 2024 and NHM-UIP schedules, **mutually exclusive**, neither pre-selected; overdue labels; Haryana specifics (PCV + Rotavirus free, no JE); given-today capture at sign-off.
- **Neonatal:** auto-activating section (age < 90d / GA < 37wk / BW < 2.5kg) capturing GA, birth weight, time of birth.

### 4.6 Patient lookup & continuity

- Search by name / UHID / guardian / token; returning-patient detection; AI visit summary for returning patients; previous-prescription history tabs; growth/lab/vax context loaded onto the pad.

### 4.7 Formulary & protocol knowledge base

- **~530-drug formulary** (formulations, dosing bands, renal bands, interactions) and **~446 ICD-10-keyed standard protocols**, governed as a contract-tested KB (JSON-schema validated at write time, six-eye verified-vs-placeholder provenance, fuzzy diagnosis→protocol matching).

### 4.8 ABDM / ABHA + FHIR R4 interoperability

- ABHA verify/create/Scan-&-Share at registration; FHIR R4 bundle generation (OPConsultation, Prescription, DiagnosticReport, ImmunizationRecord) running **off-edge, event-driven** on `PrescriptionSigned` — sign-off never blocks on it; HIP push under recorded consent; signed-QR verification via a server endpoint (no PHI in the QR).

### 4.9 Voice dictation

- Dual-engine dictation (AI transcription primary, Web Speech fallback) in `en-IN`, feeding the same auto-save → speculative-generation path as typing.

### 4.10 Auditability, safety & compliance (cross-cutting)

- Append-only audit of every command, tool call, model used, token usage, draft, and sign-off; immutable signed prescriptions (edits create new versions); real RLS + JWT; no PII to the model; DPDP guardian consent + breach runbook; NABH Digital Health alignment.

---

## 5. Success criteria (product-level acceptance)

| # | Criterion | Target |
|---|---|---|
| 1 | Doctor perceived wait to reviewable draft (matched-hash case) | ≈ 0; p95 to first reviewable content well under the old 50–150s |
| 2 | Generation timeout failures (`504`/`546` at 150s) | Eliminated (off-edge compute) |
| 3 | Prescriptions with AI-computed numbers reaching paper | **Zero** — engine is sole arithmetic authority |
| 4 | Dose-engine JS↔TS golden parity | 100% of fixtures pass before trust |
| 5 | Prescriptions finalized without human sign-off | **Zero** (state-machine invariant) |
| 6 | High-severity safety flags bypassable at sign-off | **Zero** (gate re-applies after edits) |
| 7 | Clinical writes via anonymous key / blanket RLS | **Zero** (real per-role RLS + JWT) |
| 8 | PII sent to the model | **Zero** (typed PII-stripping boundary) |
| 9 | Audit reconstruction of any prescription's full lineage | 100% from append-only events |
| 10 | Accessibility | WCAG 2.2 AA; no colour-only status |
| 11 | Cloud portability | Supabase→AWS by `DIS_STACK` env flip, no business-code change |

---

## 6. Constraints & non-negotiables

- **Clinical safety invariant:** no prescription is final without a human doctor's `SignOff`. AI drafts are `pending_review`. Enforced by the pure state machine — invalid transitions throw and are never persisted.
- **Arithmetic boundary:** the AI never computes a number that reaches paper. The deterministic engine recomputes and the server re-checks byte-for-byte.
- **No hardcoded model IDs / keys / URLs** in business code (a hardcoded dated model ID retired in production caused an outage). Centralized config + CI rule (`core_no_model_id_literals`).
- **No edge function hosts the tool-loop.** The 150s wall is the root flaw; long-running compute is off-edge.
- **PHI never leaves its boundary:** not in logs, URLs, QR payloads, commit messages, or model prompts.
- **Pediatric-first throughout:** weight-based dosing, corrected vs chronological age, neonatal handling, IAP/NHM schedules, low-literacy bilingual+pictogram output are first-class, not options.
- **Forward-only, reversible DB migrations.** No destructive `drop … cascade` monolith.

---

## 7. Orientation map (where the rest lives)

| Concern | Owning spec (in `system-spec/`) |
|---|---|
| Latency design, off-edge compute, speculative/streaming generation | Architecture / backend specs (`02_*`, `04_*`) |
| Frontend components, design system, ports, safety UX | Frontend spec (`03_*`) |
| Bounded contexts, command bus, state machine | Backend decomposition (`04_*`) |
| Target schema, RLS, audit, migration of current data | Database spec (`05_*`) |
| Model policy, tools, prompt caching, dose separation | AI orchestration (`06_*`) |
| REST + SSE + async jobs, ABDM/FHIR | API & integrations (`07_*`) |
| RLS/JWT, DPDP, NABH, PII boundary | Security & compliance (`08_*`) |
| TDD/eval gates, review protocol, drift prevention | Engineering discipline (`09_*`) |
| Phased migration, shadow rollout | Migration plan (`10_*`) |

> This brief is the product north star. If a downstream spec must contradict a *vision-level* statement here, that is a flag to be raised, not a silent override.
