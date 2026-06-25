---
trace_id: PROD-LANDSCAPE-001
title: Competitive & SOTA Landscape — AI Scribes, e-Prescribing/CPOE, Pediatric Dosing DSS, India Digital Health
status: ratified
authority: product source-of-truth for the rebuild's positioning; binds frontend, backend, AI, and DB authors on what we adopt and where we deliberately differ
supersedes_when_conflict: false   # The TARGET-ARCHITECTURE DIGEST wins on conflict until amended via ADR
companion_files:
  - 01_product/product_brief.md
  - 01_product/user_journeys.md
  - 06_ai/generation_orchestration.md
  - 07_integrations/abdm_fhir.md
  - 08_security/compliance.md
  - 09_engineering_discipline/evals_framework.md
last_reviewed: 2026-06-25
---

# 01 — Competitive & State-of-the-Art Landscape

> **What this file is.** A decisive survey of the state of the art (SOTA) in the four markets this product sits inside — **AI clinical scribes / AI prescribing**, **e-prescribing & CPOE with clinical decision support (CDS)**, **pediatric weight-based dosing decision support**, and **India's digital-health rails (ABDM/ABHA + FHIR R4, NABH, DPDP)** — and a clear statement, for each, of **what the Radhakishan rebuild adopts, what it deliberately differs on, and why.** It exists so that the rebuild's architectural commitments (off-edge speculative generation, the deterministic dose engine as sole arithmetic authority, the symmetric command bus, real RLS, ABDM-native FHIR) read as *informed positions against the field*, not invented in a vacuum.
>
> **What this file is NOT.** It is not the architecture (`02_*`/`04_*`), the AI orchestration internals (`06_ai`), the integration spec (`07_integrations`), or the compliance spec (`08_security`). It cites those by name where a "we differ" claim is implemented there. It does **not** re-derive the latency design — it explains *why the field's latency model is wrong for an OPD* and points at `product_brief.md §1` and `user_journeys.md §3`.
>
> **Authority.** Where this survey and the **TARGET-ARCHITECTURE DIGEST** disagree, the digest wins; a contradiction is a flag to raise, not a silent override. Where a cited source disagrees with a *verified API/regulatory fact* used elsewhere in the suite, the verified fact wins and is noted inline.

---

## 0. Executive position (read this first)

The market has converged on a single dominant pattern — **ambient AI scribes** (Nuance DAX, Abridge, Suki, Nabla, DeepScribe): record the encounter, transcribe, draft a note, clinician edits and signs. It is a real, validated category: 90%+ note accuracy and measurable documentation-time and burnout reductions. **We adopt its proven core** (AI drafts, human signs; structured progressive grounding; provenance display) and **reject three of its assumptions** that are wrong for a high-volume Indian pediatric OPD:

1. **Scribes optimise the *note*; we optimise the *prescription*.** The clinically dangerous artifact a pediatric OPD produces is a weight-based dose on paper, not a SOAP note. Scribes leave drug/dose hallucination as "clinician must review"; we make it *structurally impossible for an AI number to reach paper* via a sealed deterministic dose engine.
2. **Scribes are synchronous-after-the-visit; we are speculative-during-the-visit.** The field accepts a post-encounter wait while the note generates. Our root failure was exactly that wait (a 150s edge wall, `504`/`546` at `150,000ms`). We invert it: generate speculatively from the auto-saved note *during* the consult, stream, and open review at ≈0ms.
3. **Scribes are model-coupled and cloud-coupled; we are port/adapter-portable.** Most products are welded to one vendor model and one cloud. A hardcoded dated model ID retiring in production is precisely the failure class we engineer out (centralised config, anti-corruption layer, `core_no_model_id_literals` CI rule).

On the India axis: the field's leaders are **Bahmni** (only open-source HMIS certified for all three ABDM milestones) and a crowded commercial HMIS market (Practo, CliniqWise, eka.care). **We are not competing with a general HMIS** — we are a purpose-built pediatric OPD prescription surface that is **ABDM-native and DPDP-child-data-correct by construction**, two things general HMIS bolt on late.

The table below is the whole argument in one screen; the rest of the document is evidence.

| Axis | Field SOTA (2025–26) | What we **adopt** | Where we **differ** (and why) |
|---|---|---|---|
| AI documentation | Ambient scribe: record → draft note → clinician signs; 90%+ accuracy; ~1–2 min/visit saved | AI-drafts-human-signs; progressive grounding; provenance line on output | Prescription-first not note-first; **deterministic dose engine** owns all arithmetic (AI proposes drug+regimen, *no numbers*) |
| Latency UX | Synchronous post-encounter generation; spinner; "review when ready" | Streaming + review-first | **Speculative background generation during the consult** → perceived wait ≈ 0; never an infinite spinner |
| e-Rx / CPOE + CDS | CPOE+CDS cuts prescribing errors substantially **but pediatric dose errors persist without dose-range checking** | CDS as a *gate*: allergy, interaction, max-dose, duplicate | Dose-range checking is **non-bypassable** and **byte-for-byte server-rechecked**; high-severity flag disables Sign-off until acknowledged |
| Pediatric dosing DSS | Weight-based DSS reduces dosing errors; unit/weight-conversion remains a top error source | kg-only weight as the dosing gate; weight-prompt at Generate | Six dosing methods + corrected-vs-chronological age computed deterministically (never by AI) |
| LLM safety | RAG grounding + guardrails + human handoff; RAG drives hallucination toward 0 | Progressive-disclosure tool-use (a RAG analog) + pre-embedded NABH | **Numeric separation** (a guardrail RAG cannot give) + frozen-fixture evals + PII-stripped boundary |
| India rails | ABDM at scale; FHIR R4 via NRCeS; Bahmni 3-milestone certified | ABDM/ABHA + FHIR R4 (NRCeS profiles); Scan-&-Share at registration | **ABDM-native off-edge, event-driven**; ES256-JWS signed QR (no PHI in URL); HIP-first sequencing |
| Compliance | DPDP 2023 + Rules 2025 in force; child-data heavily penalised; NABH Digital Health 2nd ed. | Healthcare-service-delivery exemption scope; NABH structure on every Rx | **Guardian consent captured distinctly** from ABDM consent; CERT-In 6h + DPB 72h dual breach clocks; real RLS+JWT |
| Architecture | Per-product vertical stacks, often model/cloud-coupled | Hexagonal ports/adapters (adopted from `dis/`) | **Symmetric command bus** (human+AI same `Command`) → AI-first is an additive subscriber, not a rewrite |

---

## 1. AI clinical scribes & AI prescribing

### 1.1 What the field looks like in 2025–26

The ambient AI scribe is the breakout clinical-AI category. The shape is uniform across vendors: **passively capture the clinician–patient conversation, transcribe it, and generate a draft clinical note (usually SOAP) that the clinician edits and signs.** The leaders and the third-party signal:

| Product | Vendor | Positioning | Independent signal |
|---|---|---|---|
| **DAX Copilot** | Microsoft / Nuance | EHR-embedded (Epic), enterprise default | Documentation time per visit reduced (~5.3 → ~4.5 min in study settings) |
| **Abridge** | Abridge | Real-time, enterprise health systems | KLAS ~95.3; documentation time ~6.2 → ~5.3 min/encounter in a 57-clinician study |
| **DeepScribe** | DeepScribe | Specialty-tunable | Highest cited KLAS (~98.8, 2025) |
| **Suki** | Suki | Voice assistant + scribe | Strong ambulatory adoption |
| **Nabla** | Nabla | Lightweight, multi-specialty | ~9.5% reduction in time-in-note vs usual care (RCT context) |
| **Freed / OrbDoc / others** | various | SMB / solo-clinician tier | 90%+ note accuracy claims across the category |

Two findings recur in the peer-reviewed and KLAS literature and are load-bearing for our design:

- **Time and burnout reductions are real but modest and require editing.** A randomized trial of two ambient scribes measured documentation efficiency and burnout improvements, but every serious source repeats the same caveat: *AI-generated notes still miss clinically relevant detail, can hallucinate medications, and require physician editing before signing.* Clinician review is non-optional. ([RCT of two ambient AI scribes — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12265753/); [Ambient AI scribes narrative review — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12973079/))
- **Accuracy is "good enough to draft," not "good enough to trust unreviewed."** 90%+ note accuracy is the marketing floor; the *medication* layer specifically is where hallucination is called out as a residual risk. ([Best AI Medical Scribes 2026 — Commure](https://www.commure.com/blog-scribe/best-ai-medical-scribes); [The Physician AI Handbook — documentation](https://physicianaihandbook.com/practical/documentation.html))

### 1.2 What we adopt

- **AI-drafts → human-signs, as an invariant, not a setting.** This is the field's single best idea and it matches our clinical-safety invariant exactly: no draft becomes a final prescription without an explicit human `SignOff` command (`product_brief.md §6`; `user_journeys.md`). Where scribes treat "clinician review" as a UX convention, we encode it in the pure state machine — invalid transitions throw and are never persisted (digest §9).
- **Progressive grounding over a single mega-prompt.** Scribes increasingly ground generation in patient context and templates. Our progressive-disclosure **tool-use loop** (`get_formulary`, `get_standard_rx`, `get_previous_rx`, `get_lab_history`, `get_reference`, `compute_doses`) is the same instinct, implemented as a `ClinicalKnowledgePort` (`06_ai/generation_orchestration.md`).
- **Provenance on the artifact.** Leading sources note that surfacing the source of each fact raises clinician trust. We render an **"AI-assisted, doctor-reviewed"** line on the printed Rx and **visually distinguish AI-generated lines from clinician edits** in the pad (digest §3).
- **Dual-engine dictation.** Voice is table stakes; we keep AI transcription primary with a Web Speech (`en-IN`) fallback behind a `TranscriptionPort` (digest §3).

### 1.3 Where we deliberately differ

| # | Scribe assumption | Our position | Implemented in |
|---|---|---|---|
| D-1 | The dangerous artifact is the **note**; the medication list is a by-product to be reviewed. | The dangerous artifact is a **weight-based pediatric dose on paper**. We make AI numeric output structurally unable to reach paper. | `06_ai`, dose-engine port (digest §6) |
| D-2 | Generation is **synchronous after the encounter**; a wait is acceptable. | Generation is **speculative during the encounter**; perceived wait ≈ 0; never an infinite spinner. | `product_brief.md §1`, `user_journeys.md §3` |
| D-3 | One vendor model, one cloud, often hardcoded. | Model + cloud behind **anti-corruption ports**; centralised config; `core_no_model_id_literals` CI rule. | `06_ai`, `09_engineering_discipline` |
| D-4 | Output is **English** SOAP for the chart. | Output is a **bilingual (English + Hindi/Devanagari) + SVG-pictogram** Rx for a low-literacy guardian. | `03_frontend` `<PrintDocument>` |
| D-5 | The AI is a **tool the clinician invokes**. | Humans and AI are **symmetric actors** on one command bus → AI-first later is an additive subscriber. | digest §9 |

> **The crisp differentiator:** an ambient scribe that hallucinates "Amoxicillin 250mg/5ml, 7.5ml TDS" hands the clinician a *plausible wrong number to catch*. Our AI is not permitted to emit a number at all — it proposes *Amoxicillin, standard AOM regimen* and the sealed engine computes the volume from concentration + band + weight, rounds it (syrups → 0.5 ml), caps it, and the server re-checks it byte-for-byte. There is no wrong number for the doctor to miss because there is no AI number.

---

## 2. e-Prescribing, CPOE & clinical decision support (CDS)

### 2.1 What the evidence says

Computerised Physician Order Entry (CPOE) with CDS is the mature, evidence-backed backbone of safe inpatient/outpatient prescribing — but the literature is unusually precise about *where it works and where it fails*, and that precision dictates our design:

- **CPOE+CDS substantially reduces prescribing errors** — neonatal/pediatric ICU deployments report large reductions in prescribing errors and adverse drug events after CPOE introduction. ([CPOE in pediatric ICU before/after — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7202919/); [CPOE impact on prescribing errors in children — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10257583/))
- **BUT CPOE alone does *not* fix pediatric dose errors.** The systematic review is explicit: *pediatric dosing errors are not decreased without a dose-range-checking system*; pediatric-specific CDS is necessary. ([Systematic review: CPOE+CDS to prevent pediatric dose errors — Springer](https://link.springer.com/article/10.1007/s40272-023-00614-6))
- **CPOE introduces *new* error classes.** A longitudinal study documents technology-related prescribing errors — wrong-patient, dropdown/pick-list slips, and copy-forward errors that the paper world did not have. ([Technology-related prescribing errors in pediatrics — PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11648728/))
- **Alert fatigue is the silent killer of CDS value.** Over-alerting trains clinicians to dismiss alerts, so the *severity tiering and bypass policy* of a CDS is as important as its rule coverage.

### 2.2 What we adopt

- **CDS as a gate, not a footnote.** We implement the proven CDS rule set: **allergy conflict, drug–drug interaction, max-dose breach, and duplicate-therapy** checks (digest §3 Safety UX; `08_security`).
- **Dose-range checking as the load-bearing pediatric control** — exactly the control the systematic review says CPOE lacks. Ours is the deterministic engine's per-ingredient max-single/max-daily caps + therapeutic-range checks (§3 below).
- **Three-tier severity** (ported from `sprint-2-saved`): high → Sign-off disabled until acknowledged; moderate → caution banner; informational → inline. This is our answer to **alert fatigue**: only high severity blocks.

### 2.3 Where we deliberately differ

- **Non-bypassable high-severity gate that re-applies after edits.** A known CPOE escape is "acknowledge the alert, then edit the order to a still-unsafe value." Our `applySignoffGate()` re-runs after *any* edit, so a high→edit→save sequence cannot launder an unsafe order past the gate (digest §3).
- **No freehand dose entry.** Pick-list and free-text dose fields are the documented source of technology-related dose slips. The doctor adjusts dose through the `<DoseAdjuster>` bound to the engine (slider/radios), never by typing a number the system trusts. This designs out an entire CPOE error class.
- **Wrong-patient defence by construction.** Server-side UHID/token allocation (kills the client-side `MAX(seq)+1` race), a composite FK `(visit_id, patient_id)` the DB enforces, and a `<PatientHeaderStrip>` pinned to every command address the wrong-patient error class structurally (`05_data`).
- **The arithmetic is not the AI's and not the CPOE form's — it is a sealed engine's, server-rechecked.** CPOE dose-range checks validate a *human-entered* number; we *generate* the number deterministically and reject any AI-supplied number that disagrees (`REVIEW REQUIRED`).

---

## 3. Pediatric weight-based dosing decision support

### 3.1 Why pediatrics is a category of its own

Adult prescribing is mostly fixed-dose; pediatric prescribing is **per-kilogram, per-BSA, age-tiered, and developmentally moving** — the same child's correct dose changes week to week. The evidence and the incident record:

- **Computerised pediatric dosing DSS reduces dosing errors** when it does explicit dose calculation and range-checking. ([Computerized pediatric dosing DSS — ScienceDirect](https://www.sciencedirect.com/science/article/pii/S1021949813000392))
- **Weight and unit handling is a top, recurring error source.** kg-only scales are recommended precisely because lb↔kg conversion (by operator or EHR) injects error; a single "weighty mistake" (lbs entered as kg, or a tenfold slip) cascades into a tenfold overdose. ([Pediatric medication safety in the ED — ENA](https://www.ena.org/sites/default/files/2025-11/Pediatric%20Medication%20Safety%20in%20the%20ED.pdf); ["A Weighty Mistake" — AHRQ PSNet](https://psnet.ahrq.gov/web-mm/weighty-mistake))
- **Mental math under time pressure is the documented failure mode** in our own setting — captured in project memory (`project_dose_engine_is_source_of_truth.md`): dosing errors come from AI/human mental arithmetic, not from the engine.

### 3.2 Our position: the deterministic dose engine is the sole arithmetic authority

This is the rebuild's defining safety boundary and where we go furthest beyond the field. The field's pediatric DSS *checks* a number; ours *owns* the number.

```
        ┌──────────────────────────────────────────────────────────────┐
        │  AI (Claude) proposes: drug + regimen + frequency             │
        │  — NO numeric mg / ml / drops / tablets fields permitted —     │
        └───────────────────────────────┬──────────────────────────────┘
                                         │  med + band reference only
                                         ▼
        ┌──────────────────────────────────────────────────────────────┐
        │  DoseEnginePort (pure TS, core/, zero IO/DOM)                  │
        │   • computeDose() from concentration + dosing_band + weight/BSA│
        │   • rounding: syrups 0.5 ml · drops 0.1 ml · tablets ¼         │
        │   • caps: max single + max daily (per ingredient)             │
        │   • therapeutic-range check                                   │
        │   • rebuilds R2 (English) + R3 (Hindi) + R4 pictogram         │
        └───────────────────────────────┬──────────────────────────────┘
                                         │  computed Rx line
                                         ▼
        ┌──────────────────────────────────────────────────────────────┐
        │  SERVER re-checks byte-for-byte (no tolerance).               │
        │  Any AI/client number that disagrees ⇒ REVIEW REQUIRED.       │
        └──────────────────────────────────────────────────────────────┘
```

**Six dosing methods** are first-class: weight-based, BSA, GFR-adjusted, fixed, infusion, age/GA-tier. **Corrected vs chronological age** (corrected for growth/development, chronological for vaccinations) is computed **on the client deterministically — the AI does no age arithmetic** (digest §3, §6).

**TDD gate (non-negotiable):** golden **JS↔TS parity fixtures** (≥20 cases covering rounding, caps, bilingual strings) must pass before the engine is trusted. `sprint-2-saved` ships the 745-line TS port (`dose-engine.ts`) *without* fixtures; closing that gap is a hard prerequisite (digest §6; `09_engineering_discipline/evals_framework.md`).

### 3.3 Adopt / differ summary

| Field practice | Adopt? | Our refinement |
|---|---|---|
| kg-only weight capture | ✅ | Weight is the **Generate gate**; missing-weight prompt persists; no lb path exists |
| Explicit dose calculation in software | ✅ | Done by a **sealed pure engine**, not a spreadsheet macro or AI mental math |
| Dose-range / max-dose checking | ✅ | Per-ingredient caps **+ server byte-for-byte recheck**, zero tolerance |
| Dropdown/free-text dose entry | ❌ | Replaced by engine-bound `<DoseAdjuster>` — designs out pick-list slips |
| AI computes the dose | ❌ (hard no) | AI proposes drug+regimen with **no numbers**; this is an open/closed safety boundary |

---

## 4. LLM clinical-generation safety (RAG, guardrails, evals)

### 4.1 The field's safety playbook

The 2025 literature on LLMs in clinical generation converges on a consistent stack: **retrieval-augmented generation (RAG) to ground outputs in trusted local knowledge, guardrails + escalation tiers (evaluator models, human handoff), and provenance citations to build trust.**

- **RAG drives hallucination toward zero.** Controlled studies report RAG eliminating hallucinations (e.g., **0% vs 8%**), and self-reflective RAG lowering them to ~5.8%; provenance notes per cited fact raised clinician trust ~12%. ([RAG variants for CDS, hallucination mitigation — MDPI](https://www.mdpi.com/2079-9292/14/21/4227); [RAG elevates local LLM in radiology — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12223273/))
- **RAG improves medication instructions specifically** — grounding plus prompt engineering reduced vague/unsolicited instructions in medication-use guidance. ([RAG for medication-use instructions — ScienceDirect](https://www.sciencedirect.com/science/article/pii/S001048252501488X))
- **LLM-as-CDS can augment medication safety across specialties** — but only as an augmentation behind human judgement. ([LLM as CDS augments medication safety across 16 specialties — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12629785/))
- **Prompt-injection / clinical-safety attack surface is now a named risk.** Benchmarks like MPIB exist precisely because clinical LLMs are attackable. ([MPIB medical prompt-injection benchmark — arXiv](https://arxiv.org/pdf/2602.06268))
- **Systematic review of real-world deployments** confirms the pattern: RAG + guardrails + escalation tiers are the recurring implementation recipe. ([LLMs in real-world clinical workflows — Frontiers](https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2025.1659134/full))

### 4.2 What we adopt

- **Grounding via progressive disclosure.** Our tool-use loop *is* a RAG analog: instead of stuffing the whole formulary into context, Claude pulls `get_formulary`/`get_standard_rx` on demand from the governed KB (digest §6). Tools run in parallel (`Promise.all`).
- **Provenance + escalation tiers.** Provenance line on the Rx; three-tier severity as the escalation ladder; human sign-off as the terminal handoff.
- **Prompt-injection awareness.** External-record text and OCR output are treated as untrusted: OCR is **staged**, never direct-written to clinical tables, and promoted only through `promotion.ts` behind a confidence gate (digest §4, the `dis/` pattern). `esc()` is the safe-render primitive everywhere.

### 4.3 Where we go beyond RAG

RAG reduces hallucination probabilistically — it cannot make hallucination *impossible*, and **"5.8% residual" is unacceptable for a pediatric dose.** Our additional, RAG-independent guardrails:

- **Numeric separation (the guardrail RAG cannot provide).** Even a perfectly grounded model can transpose a digit. Removing numeric authorship from the model entirely is a *categorical* control, not a *probabilistic* one (§3).
- **Frozen-fixture, eval-gated generation.** A frozen pediatric fixture set asserts: doses within rounding rules, NABH fields present, **no PII leakage**, JSON-schema conformance, safety invariants hold. This is a machine-checkable gate, owned by `09_engineering_discipline/evals_framework.md` (this file does not duplicate the runner).
- **Typed PII-stripping boundary.** `get_previous_rx` and visit-summary strip PII at a *typed* boundary, not via an ad-hoc `.map` — no patient identifier reaches the model (digest §8).
- **Prompt-caching for cost/TTFT, schema-strict tools for robustness.** Cache the frozen `tools → system` prefix; consider `strict:true` tools + structured outputs to retire the brittle `extractJSON` regex (digest §2, §6).

> **Net position:** the field's answer to "how do we trust the LLM's numbers?" is *better grounding*. Our answer is *the LLM never produces a number we trust* — grounding is for drug/regimen *selection*, and a sealed engine + server recheck owns every digit.

---

## 5. India digital-health rails — ABDM/ABHA, FHIR R4, NABH, DPDP

### 5.1 The national context (scale and momentum)

ABDM (formerly NDHM, launched Sep 2021, ₹1,600 cr / 5 yr) is now one of the largest digital-health rollouts on earth and is moving from *differentiator* to *table stakes*:

- **84.79 crore ABHA IDs** created and **82.69 crore health records** linked; **17,000+** facilities integrated; **~2 lakh OPD tokens/day** generated via ABDM (project ABDM research, Jan 2026 figures, corroborated by NHA reporting). ([NHA / ABDM official](https://abdm.gov.in/); [ABDM as DPI](https://www.dpi.global/globaldpi/abdm); [ABDM making of India's digital health story — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10064942/))
- **NHA targets most public touchpoints ABDM-enabled by 2027** — the early-integrator advantage narrows through 2026–27. ([India hospital digitization 2025 — Nutryah](https://www.nutryah.com/blogs/india-hospital-digitization-initiatives-2025))
- **FHIR R4 is the wire format, profiled for India by NRCeS.** HIPs publish records as FHIR R4 to the ABDM health locker on a clinical event. ([NRCeS FHIR Implementation Guide for ABDM R4](https://nrces.in/ndhm/fhir/r4/))

### 5.2 The competitive field in India

| System | Type | ABDM posture | Relevance to us |
|---|---|---|---|
| **Bahmni** (+ Bahmni Lite) | Open-source EMR/HMIS | **Only OSS HMIS certified for all three ABDM milestones** (HRP/HIP/HIU); Lite targets OPD clinics SaaS ~USD 20/mo | The benchmark for "ABDM-ready" — but a general HMIS, not pediatric-Rx-specialised. ([Bahmni](https://www.bahmni.org/); [Bahmni ABDM FAQ](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/2981232664)) |
| **Practo (Ray)** | Commercial SaaS | ABDM-enabled appointment/practice mgmt | Booking/practice-mgmt centric, not deep clinical pediatric dosing. ([EMR comparison 2025 — BMRAO](https://bmrao.com/blog-emr-comparison-2025.html)) |
| **eka.care / CliniqWise / others** | Commercial HMIS | "ABDM-ready", WhatsApp, billing, lab, pharmacy | Broad HMIS suites; pediatric weight-based dosing + bilingual pictogram Rx is not their focus. ([Best HMS India 2026 — CliniqWise](https://cliniqwise.com/resources/blog/best-hospital-management-software-india)) |
| **eSanjeevani / e-Hospital** | Govt platforms | National teleconsult / hospital | Public-sector scale; not a specialised private-OPD pediatric Rx pad. ([India digitization 2025 — Nutryah](https://www.nutryah.com/blogs/india-hospital-digitization-initiatives-2025)) |

**Our lane:** we are **not** building a general HMIS (no billing/inventory/IPD — `product_brief.md §1`). We are a **purpose-built pediatric OPD prescription surface** that is ABDM-native and DPDP-child-correct. The competitive moat is depth in the one workflow general HMIS treat shallowly: *safe, fast, bilingual, pictogram pediatric prescribing*.

### 5.3 What we adopt from the rails

- **ABDM V3 APIs, NRCeS FHIR R4 profiles.** Target V3 exclusively (V1 deprecating); use NRCeS R4 resource profiles. We keep the strong 1680-LOC NRCeS builder from `generate-fhir-bundle` but re-home it into a **pure `FhirCompositionPort` adapter (`NrcesR4Adapter`)** that takes data not a DB (kills the N+1 formulary re-fetch) (digest §7).
- **Scan-&-Share + ABHA at registration.** ABHA verify/create/Scan-&-Share at the reception stage; ABHA captured as a patient field alongside (not replacing) the internal UHID.
- **HFR/HPR registries.** HFR ID + HPR ID move to **config/secrets**, not source (the baked-in `HOSPITAL.hfr_id=""` is a known blocker) (digest §7).

### 5.4 Where we deliberately differ

| # | Common India-HMIS practice | Our position | Implemented in |
|---|---|---|---|
| I-1 | FHIR/ABDM generation **inline / synchronous**, sometimes via the NHA Java+Mongo sidecar | **Off-edge, event-driven** on `PrescriptionSigned`; sign-off never blocks on FHIR/ABDM | `07_integrations/abdm_fhir.md` (digest §7) |
| I-2 | QR with weak/forgeable hash; some use external QR image services | **ES256 JWS signed QR** verified by a read-only server endpoint; **no PHI in the QR URL**; QR rendered client-side (drop `api.qrserver.com`) | `07_integrations`, `SignaturePort` |
| I-3 | Fidelius treated as "just encryption" | Correct crypto: **Curve25519 Short-Weierstrass (Fidelius), not libsodium Montgomery**; plaintext gated behind a double-locked sandbox flag | `CryptoBoxPort` (digest §7) |
| I-4 | M1→M2→M3 attempted together | **M1 (ABHA) → M2 (HIP push) first; M3 (HIU) deferred** | `07_integrations` sequencing |
| I-5 | General-HMIS adult-first dosing bent to pediatrics | **Pediatric-first** (weight/BSA/age-tier, corrected age, IAP/NHM, bilingual pictograms) by construction | whole spec |

### 5.5 Compliance: DPDP 2023 + Rules 2025, NABH, CERT-In

This is a hard regulatory surface for us because **nearly every patient is a child (<18)**, the most heavily penalised data class under DPDP.

- **DPDP child-data rules are in force.** Verifiable **parental/guardian consent** is required before processing a child's data; behavioural tracking/profiling/targeted ads at children are prohibited; penalties for child-data violations reach **₹200 crore**. ([DPDP Act 2023 + Rules 2025 — EY](https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025); [Children's data under DPDP Rules — KSandK](https://ksandk.com/data-protection-and-data-privacy/childrens-data-protection-under-indias-dpdp-rules/); [Rule 10 — dpdpa.com](https://www.dpdpa.com/dpdparules/rule10.html))
- **Healthcare-service-delivery exemption is narrow.** A clinical establishment may process a child's data **without separate parental consent only to provide health services to that child**, limited to the protection of the child's health — **no analytics, marketing, or secondary use.** ([Children's data protection — Law.asia](https://law.asia/childrens-data-protection-dpdp-act/))
- **What we do (and differ on):** we capture **guardian consent at registration** — timestamped, plain-language notice, withdrawal path — as a **`CaptureGuardianConsent` command distinct from the ABDM consent artefact** (general HMIS often conflate the two). We stay strictly inside the service-delivery scope (no secondary-use analytics on child PHI). Breach runbook honours **both clocks**: CERT-In **6h** and DPB notify "without delay" + 72h full report (digest §8; `08_security/compliance.md`).
- **NABH Digital Health 2nd ed. (Sep 2025)** is our EMR compliance checklist; NABH structure is mandatory on every prescription; the append-only audit + ABDM work targets Silver→Gold. The single biggest prototype liability we close is the **blanket RLS over a shared anon key** — replaced by **real per-role RLS derived from JWT** (`reception`/`nurse`/`doctor`/`service`/`admin`), with **no DELETE policy** on clinical/audit tables (digest §5, §8).

---

## 6. Synthesis — the defensible position in one page

**What is genuinely SOTA and we take it wholesale:** ambient-AI's *draft-then-human-signs* loop; CPOE+CDS's *gated* safety checks; pediatric DSS's *explicit dose calculation + range checking + kg-only weight*; LLM-safety's *grounding + guardrails + provenance + escalation*; India's *ABDM/ABHA + NRCeS FHIR R4*.

**The four places we are ahead of, or deliberately orthogonal to, the field:**

1. **Numeric safety is categorical, not probabilistic.** The field's best answer to LLM dose errors is "ground it better and have the clinician check." Ours removes numeric authorship from the model and re-checks byte-for-byte server-side. RAG can hit 5.8% residual hallucination; for a pediatric dose, our residual is structurally **0**.
2. **Latency is solved by *not waiting*, not by *waiting faster*.** Scribes generate after the encounter; we generate speculatively during it, stream, and open review at ≈0ms — the inversion that kills our `504`/`546`-at-150,000ms failure class.
3. **Symmetric command bus makes AI-first additive.** No competitor (scribe or HMIS) treats human and AI as the same actor on one bus. This is why our autonomous-drafting future is a subscriber, not a rewrite (digest §9).
4. **Compliance is by construction, child-first.** ABDM-native off-edge FHIR, ES256-JWS signed QR with no PHI, guardian consent distinct from ABDM consent, real RLS+JWT, dual breach clocks — the things general HMIS retrofit, we build in.

**Honest limitations / open risks (sparring-partner note):**

- We are **narrower** than Bahmni/CliniqWise — no billing/inventory/IPD. If Radhakishan later needs a full HMIS, we integrate at a seam; we do not become one. That is a deliberate scope bet, and it is a real competitive exposure if buyers want one throat to choke.
- **ABDM certification is work, not a checkbox.** Bahmni is 3-milestone certified; we are targeting M1→M2 first and must actually pass NHA sandbox + certification. The spec claims the architecture; certification is earned.
- **Speculative generation costs tokens on drafts never used.** Mitigated by prompt caching, content-hash supersession (last-write-wins), and debounce — but it is a real cost line to monitor (`ops.cost_ledger`).
- **The dose engine is only as safe as its fixtures and its formulary.** The golden parity gate and the contract-tested, six-eye-verified formulary KB are load-bearing; a placeholder dosing band that slips through "verified" provenance is the residual clinical risk we must police (digest §5, §6).

---

## Sources

**AI clinical scribes / AI prescribing**
- [RCT of two ambient AI scribes — documentation efficiency & burnout — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12265753/)
- [Ambient AI scribes: narrative review of technology, impact, implementation — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12973079/)
- [Best AI Medical Scribes 2026 — Commure](https://www.commure.com/blog-scribe/best-ai-medical-scribes)
- [AI-Assisted Clinical Documentation — The Physician AI Handbook](https://physicianaihandbook.com/practical/documentation.html)

**e-Prescribing / CPOE / CDS**
- [Systematic review: CPOE+CDS to prevent dose errors in pediatric orders — Springer (Pediatric Drugs)](https://link.springer.com/article/10.1007/s40272-023-00614-6)
- [CPOE impact on prescribing errors in children — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10257583/)
- [Impact of technology on prescribing errors in pediatric ICU (before/after) — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7202919/)
- [Longitudinal study of technology-related prescribing errors in pediatrics — PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11648728/)

**Pediatric weight-based dosing DSS**
- [Computerized pediatric dosing decision-support system on dosing errors — ScienceDirect](https://www.sciencedirect.com/science/article/pii/S1021949813000392)
- [Pediatric Medication Safety in the Emergency Department — ENA](https://www.ena.org/sites/default/files/2025-11/Pediatric%20Medication%20Safety%20in%20the%20ED.pdf)
- ["A Weighty Mistake" — AHRQ PSNet](https://psnet.ahrq.gov/web-mm/weighty-mistake)

**LLM clinical safety / RAG / guardrails**
- [Evaluating RAG variants for CDS: hallucination mitigation, on-prem — MDPI Electronics](https://www.mdpi.com/2079-9292/14/21/4227)
- [RAG elevates local LLM quality in radiology — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12223273/)
- [Enhanced LLM medication-use instructions via RAG — ScienceDirect](https://www.sciencedirect.com/science/article/pii/S001048252501488X)
- [LLM as CDS augments medication safety across 16 specialties — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12629785/)
- [LLMs in real-world clinical workflows: systematic review — Frontiers Digital Health](https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2025.1659134/full)
- [MPIB: medical prompt-injection / clinical-safety benchmark — arXiv](https://arxiv.org/pdf/2602.06268)

**India digital health — ABDM / FHIR / NABH / DPDP**
- [NHA / ABDM official site](https://abdm.gov.in/)
- [NRCeS FHIR Implementation Guide for ABDM R4](https://nrces.in/ndhm/fhir/r4/)
- [ABDM as Digital Public Infrastructure — DPI.global](https://www.dpi.global/globaldpi/abdm)
- [ABDM: making of India's digital health story — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10064942/)
- [India hospital digitization 2025 (ABDM/e-Hospital/eSanjeevani) — Nutryah](https://www.nutryah.com/blogs/india-hospital-digitization-initiatives-2025)
- [Bahmni open-source EMR/HMIS](https://www.bahmni.org/)
- [Bahmni ABDM compliance FAQ](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/2981232664)
- [EMR comparison 2025 (OpenEMR/Bahmni/OpenMRS/Practo) — BMRAO](https://bmrao.com/blog-emr-comparison-2025.html)
- [Best Hospital Management Software India 2026 — CliniqWise](https://cliniqwise.com/resources/blog/best-hospital-management-software-india)
- [DPDP Act 2023 + Rules 2025 — EY](https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025)
- [Indian perspective on protecting children's personal data — Law.asia](https://law.asia/childrens-data-protection-dpdp-act/)
- [Children's data protection under India's DPDP Rules — KSandK](https://ksandk.com/data-protection-and-data-privacy/childrens-data-protection-under-indias-dpdp-rules/)
- [Rule 10 (verifiable parental consent) — dpdpa.com](https://www.dpdpa.com/dpdparules/rule10.html)

> **Provenance note.** Scale figures for ABDM are cited as of Jan 2026 from the project's own ABDM research and corroborating NHA/PIB reporting; where a secondary source quotes a slightly different running total (a moving counter), the verified project figure is used. Model IDs/pricing and ABDM V3 API facts referenced here defer to `06_ai/generation_orchestration.md` and `07_integrations/abdm_fhir.md` respectively, which are the suite's source-of-truth for those verified facts.
