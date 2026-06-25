# 05 · AI — Clinical Reference Documents, Registry & Governance

> **Status:** Authoritative target-state design. Build to **this**, not to the live
> `radhakishan_system/skill/references/*.md` + hardcoded Storage-path prototype. Where this
> document and an upstream study report disagree, this document wins; where it disagrees with a
> **verified Postgres / Anthropic / Supabase-Storage fact**, the author flags it rather than
> silently following.
>
> **Authority.** This file is a spoke under `00_overview/README.md` and is **bound by**
> [`00_overview/canonical_decisions.md`](../00_overview/canonical_decisions.md) (Part B.1 names
> `05_ai/clinical_references.md` as the owner of *"the 11 `references/*.md` files' target content,
> governance, versioning, and the `catalog.clinical_reference` registry authoring"*). Where any
> prior wording in a sibling diverges from a Canonical Decision, the Canonical Decision wins and
> the divergence is a defect.
>
> **Scope of this file.** (1) The **content/scope target** of each of the **11 clinical reference
> documents** Claude fetches on demand; (2) the **`catalog.clinical_reference` registry**
> (`ref_name → storage_key → content_hash → version`) — its authoring, write path, and
> invariants; (3) **authoring + clinician review / governance** (six-eye, clinician-as-oracle
> sign-off); (4) **versioning** (semver-per-reference, content-hash identity, append-not-mutate);
> (5) **how each reference is fetched at runtime** via the `get_reference` tool through
> `ClinicalKnowledgePort → StoragePort`, and the **version-bump → cache-bust** rule.
>
> **Sibling ownership (do not duplicate).** `02_architecture/ai_orchestration.md` owns the
> *orchestration mechanism* (the tool-use loop, caching prefix, streaming, fallback — this file
> is the *content the loop carries*); `05_ai/prompt_system_design.md` owns the `core_prompt.md`
> structure and the **pre-embedded NABH block** placement inside the cached prefix;
> `05_ai/tool_contracts.md` owns the frozen `get_reference` JSON-Schema (this file owns the
> *name→object resolution* and the registry behind it); `03_data/schema_design.md §3.4` owns the
> `catalog.clinical_reference` **DDL** (this file owns its **authoring + governance semantics**);
> `09_engineering_discipline/evals_framework.md` + `agent_threat_model.md` own the *gate
> mechanics* this file's governance hooks into. This file is the **clinical-knowledge content
> spine** those siblings hang off.
>
> **Provenance of every claim below:** the 11 on-disk files
> `radhakishan_system/skill/references/{nabh_compliance, dosing_methods, neonatal,
> emergency_triage, growth_charts, developmental, iv_fluids, antibiotic_stewardship,
> standard_prescriptions, vaccination_iap2024, vaccination_nhm_uip}.md`; the registry DDL in
> `03_data/schema_design.md §3.4`; the tool surface in `02_architecture/ai_orchestration.md
> §4.1–§4.5`; the caching prefix rules in `ai_orchestration.md §5.1`; `canonical_decisions.md`
> Part B.1/B.2 and §A C2.

---

## 0. The reference subsystem in one paragraph

The AI never carries the full clinical skill in every prompt. Eleven small, doctor-ratified
**Markdown reference documents** sit in Supabase Storage under the `website/skill/references/`
prefix; Claude fetches **only the ones a given case needs** through the `get_reference(name)`
tool — the progressive-disclosure design that keeps the cached prefix lean (`ai_orchestration.md
§4`). Each file is registered in **`catalog.clinical_reference`** as a row mapping a stable
`ref_name` (e.g. `'neonatal'`) to its **versioned Storage object** (`storage_key`) and a
**`content_hash`** (SHA-256 over the canonical bytes) so the tool resolves a *name*, not a
hardcoded path, and an edit is a **versioned, cache-busting, six-eye-reviewed event** rather than
a silent file overwrite. The **one exception** to on-demand fetch is **`nabh_compliance`**, which
is **pre-embedded** in the cached system prefix (`05_ai/prompt_system_design.md`,
`ai_orchestration.md §4.2`) so every prescription carries the 20 mandatory NABH sections without
spending a tool round. Governance treats every reference as a **clinical safety artifact**: edits
require **six-eye review with a named clinician as oracle**, a version bump, a fresh content hash,
and — because a poisoned reference is a prompt-injection / data-poisoning surface
(`agent_threat_model.md`) — an **adversarial content-governance gate** before the new bytes can be
trusted by the model.

---

## 1. Why references exist as on-demand documents (the design rationale)

| Property | Why it is a *document fetched on demand*, not prompt text or a DB row |
|---|---|
| **Token economy** | The full clinical skill is ~39 k chars (`radhakishan_prescription_skill.md`). Inlining it every call would blow the cached prefix and cost. Progressive disclosure fetches only the 1–4 references a case needs. |
| **Prose, not structured data** | References are clinical *narrative* (tables, rules, bilingual lists) — unlike `catalog.formulary` (structured, queried by `get_formulary`) or `catalog.standard_prescriptions` (queried by `get_standard_rx`). Markdown is the right shape; the model consumes it verbatim. |
| **Independent edit cadence** | A schedule (IAP 2024) or a stewardship rule changes on its own clinical clock, decoupled from code releases. A registry + Storage object lets a clinician-reviewed edit ship without a code deploy. |
| **Auditable identity** | A `content_hash` + `version` makes "which exact reference text did the model see for this prescription?" answerable — an NABH traceability requirement (`generation_events` records the resolved `ref_name@version`). |
| **Cache discipline** | References live in Storage and resolve **after** the cached prefix breakpoint (except pre-embedded NABH); a reference edit therefore does **not** silently invalidate the prompt cache — the cache-bust is explicit and version-keyed (§5.4). |

> **Boundary with `05_ai/tool_contracts.md`.** That file freezes the `get_reference`
> `input_schema` (`{ name: string }`, `strict:true`) and the *condensed output shape* (the
> resolved `.md` body). This file owns **what the body contains, how it is governed, and how the
> name resolves to the right versioned object.**

---

## 2. The 11 clinical reference documents — target content & scope

Each row below is the **target-state mandate** for that reference: its `ref_name` (the registry
key and the tool argument), its **clinical scope**, the **trigger** that should make Claude fetch
it (the prescriptive "Call this when…" cue that `tool_contracts.md` bakes into the tool
`description`, countering Opus 4.8's tool-under-reach — `ai_orchestration.md §4.5`), the **owning
clinical domain** (for the six-eye reviewer roster, §3), and the **load-bearing invariants** the
text must preserve. Content is grounded in the on-disk files; the rebuild **preserves the
clinical substance verbatim** and only adds governance metadata around it — a reference edit that
changes a dosing rule or a schedule is a clinical change, not a doc edit (§3).

> **Naming note.** Two on-disk files use slightly richer registry names than their filename:
> `neonatal.md → ref_name 'neonatal'` and the registry MAY expose the alias `'neonatal_dosing'`
> used in `canonical_decisions.md` Part B.2 / `ai_orchestration.md §3.1` — both resolve to the
> same object (§4.2 alias rule). The **canonical `ref_name` is the filename stem**; aliases are
> additive and recorded in the registry, never a second object.

### 2.1 `nabh_compliance` — *(pre-embedded; the one always-on reference)*

- **Scope.** The **20 mandatory NABH sections** every prescription JSON must contain (hospital
  header + NABH badge, patient name, UHID, age/sex/weight, date/time, guardian/contact, diagnosis
  with ICD-10, bilingual 4-row medicines, dose calculations shown, allergy status, interaction
  check, max-dose verification, bilingual emergency warning signs, follow-up, doctor
  name/degree/registration, signature placeholder, emergency contacts, QR payload, NABH strip, AI
  draft disclaimer).
- **Fetch trigger.** **Never fetched at runtime.** Pre-embedded in the cached system prefix
  (`05_ai/prompt_system_design.md`; `ai_orchestration.md §4.2`) so the block sits *inside* the
  cacheable prefix and costs zero tool rounds. Claude must satisfy all 20 sections in output.
- **Owning domain.** Quality / NABH (Medical Superintendent + NABH coordinator as reviewers).
- **Invariants.** Mandatory on **every** Rx (digest; `06_security`); the AI-draft disclaimer and
  the "AI-assisted, doctor-reviewed" provenance line print on every prescription
  (`ai_orchestration.md §8`). Because this block is in the **byte-frozen prefix**, a NABH edit is
  a **prefix change** → it *does* invalidate the prompt cache and forces a pre-warm (§5.4) — the
  only reference whose version bump is a prefix event.

### 2.2 `dosing_methods` — the 6 dose-calculation methods + rounding

- **Scope.** The **6 dosing methods** — (A) weight-based mg/kg, (B) BSA Mosteller, (C)
  GFR-adjusted Schwartz, (D) fixed/age-band, (E) infusion mcg/kg/min, (F) age/GA-tier — each with
  formula, the `calc`-string format, and the **never-exceed-max** rule; the **rounding table**
  (syrup → 0.5 ml, drops → 0.1 ml, tablet → ¼ tab, injection → 0.01 ml, insulin → whole unit, BSA
  → exact); the **Indian-concentration rule** (use MIMS/CIMS concentration, state it in Row 1) and
  common Indian concentrations.
- **Fetch trigger.** "Call when any medicine is being dosed and you need to confirm the method,
  `calc` format, or rounding." In practice the **arithmetic is never done by the model** — the
  `compute_doses` tool / `DoseEnginePort` owns every number (`ai_orchestration.md §4.6`,
  `canonical_decisions.md C5). This reference is the model's **narrative grounding** for *which
  method and band to propose*, not a licence to compute.
- **Owning domain.** Pharmacology / Pediatrics lead.
- **Invariants.** Mirrors the engine's behaviour exactly: rounding rules and caps here MUST equal
  the engine's. A drift between this text and `DoseEnginePort` is a **clinical-risk hazard**
  (`clinical_risk_management.md`); the dose-parity gate (`canonical_decisions.md` Part C) polices
  the engine, this reference's review polices the *prose* the model reasons from.

### 2.3 `neonatal` *(alias `neonatal_dosing`)* — neonatal/preterm rules

- **Scope.** Method-F age/GA-tier dosing for neonatal drugs (gentamicin, ampicillin, caffeine
  citrate, phenobarbitone); the **corrected-age rule** (`corrected = chronological − (40 − GA)
  weeks`, used to 2 yr for growth/dev); neonatal **Day-1 fluids** (10% Dextrose 60–80 ml/kg/day);
  and the **vaccination age rule** (always **chronological** age for vaccines, Hep-B deferral if
  BW < 2 kg).
- **Fetch trigger.** "Call whenever the patient is a neonate/preterm (age < 90 d, GA < 37 wk, or
  BW < 2.5 kg), or any age/GA-tier drug is named." (The neonatal chip auto-activates on those
  thresholds — `CLAUDE.md` workflow.)
- **Owning domain.** Neonatology.
- **Invariants.** **Corrected age for growth/development; chronological age for vaccination** — the
  single most error-prone pediatric distinction; it is a golden-eval edge (`evals_framework.md
  §4.2`) and the dose-parity floor (`canonical_decisions.md` Part C.2). Age numbers are computed
  **client-side before generation**; the model receives resolved values and does no age arithmetic
  (`ai_orchestration.md §4.6`).

### 2.4 `emergency_triage` — bilingual warning signs + triage scoring

- **Scope.** The **10 bilingual emergency warning signs** (Hindi Devanagari + English) that print
  on every Rx; the **triage scoring** table (airway/cyanosis/SpO₂<92/shock/seizure = 3, etc.) and
  the action bands (0–1 Routine, 2–3 Priority, 4–6 Urgent, ≥7 Emergency).
- **Fetch trigger.** "Call on every prescription — the bilingual warning-sign block is a NABH
  mandatory section (#13)." Effectively always-needed for output; a candidate for pre-embedding if
  token budget allows, but kept on-demand so the Devanagari block can be edited without a prefix
  cache-bust.
- **Owning domain.** Emergency / PICU.
- **Invariants.** The **Devanagari strings are render-fidelity-critical** — a missing/garbled
  Devanagari warning is a `devanagari_missing` audit warning (`ai_orchestration.md §7.2`) and a
  `render_fidelity_gates.md` check. Edits to this file MUST pass the Devanagari render gate
  (`ci/render-devanagari`).

### 2.5 `growth_charts` — growth assessment & Z-scores

- **Scope.** Chart selection (Fenton 2013 for <40 wk corrected; WHO 2006 for term 0–5 yr and
  preterm post-discharge to 2 yr corrected; IAP 2015 for 5–18 yr); the **Z-score classification**
  table (WAZ/HAZ/WHZ/HCZ thresholds → underweight/stunting/SAM/MAM/microcephaly etc.); **MUAC**
  bands (<11.5 SAM, 11.5–12.5 MAM, ≥12.5 normal); the corrected-age rule restated.
- **Fetch trigger.** "Call when growth/nutrition is assessed, a Z-score or MUAC is mentioned, or
  malnutrition is in the differential."
- **Owning domain.** Pediatrics (growth) / Nutrition.
- **Invariants.** Z-score arithmetic is owned by the deterministic `GrowthEnginePort`
  (`02_architecture/backend_services.md`), not the model — this reference grounds *interpretation*
  (classification thresholds, referral triggers), not computation. Corrected-age rule MUST match
  `neonatal` (§2.3) — cross-reference, do not re-derive.

### 2.6 `developmental` — developmental screening

- **Scope.** Screening tools by setting (IAP Developmental Card, TDSC, Denver DDST-II, HINE/ASQ
  for NICU graduates, M-CHAT-R for autism concern, LEST for language delay); the **red-flag list**
  (no social smile by 3 mo, no words by 16 mo, any loss of acquired skills at any age, etc.); the
  **preterm corrected-age rule** to 2 yr.
- **Fetch trigger.** "Call when a developmental concern, milestone delay, or screening is raised."
- **Owning domain.** Developmental pediatrics.
- **Invariants.** Red flags → **immediate referral** language; corrected-age rule consistent with
  §2.3/§2.5.

### 2.7 `iv_fluids` — IV fluid prescribing

- **Scope.** **Holiday-Segar** maintenance (100/50/20 ml/kg tiers), **bolus** (20 ml/kg NS,
  neonates 10 ml/kg), **neonatal Day-1 fluids**, and the **documentation checklist** per fluid
  (type, volume, rate ml/hr, additives, monitoring, duration).
- **Fetch trigger.** "Call whenever IV fluids, rehydration, or maintenance fluids are prescribed."
- **Owning domain.** Pediatrics / PICU.
- **Invariants.** Fluid volumes feed the engine's infusion method (Method E); the model proposes
  fluid + regimen, the engine/worker computes ml/hr. Neonatal Day-1 numbers MUST match `neonatal`
  (§2.3).

### 2.8 `antibiotic_stewardship` — antibiotic stewardship checklist

- **Scope.** The **9-point stewardship checklist** (indication & site documented, fever pattern,
  prior-antibiotic-30-day, allergy checked, culture-before-start, narrowest agent, 48–72 h review
  date, finite duration, parent counselling) to be recorded in `safety.flags`.
- **Fetch trigger.** "Call whenever **any antibiotic** is being prescribed." (Prescriptive cue —
  this is a should-call surface Opus 4.8 under-reaches on by default.)
- **Owning domain.** Infectious disease / Pharmacology.
- **Invariants.** Stewardship justification MUST appear in the `safety` object; a missing
  stewardship note on an antibiotic Rx is a **soft-quality warn** (`clinical_risk_management.md`
  WARN tier), surfaced in review, not a hard block.

### 2.9 `standard_prescriptions` — first-line protocol exemplars

- **Scope.** First-line protocols for the **10 most common pediatric OPD diagnoses** (Fever/URTI
  J06.9, AOM H66.90, CAP J18.9, AGE A09, Asthma J45.901, IDA D50.9, Worms B82.0, UTI N39.0,
  Febrile seizures R56.00, Croup J05.0) with drug, dose band, duration, alternatives, and
  red-flag/hospitalise criteria.
- **Fetch trigger.** This reference is the **narrative companion** to the structured
  `get_standard_rx` tool (`ai_orchestration.md §4.1`, ICD-10-first against
  `catalog.standard_prescriptions`). `get_standard_rx` returns the **deterministic governed
  protocol row**; `get_reference('standard_prescriptions')` gives the model the **clinical
  reasoning narrative** (when to deviate, alternatives, hospitalise criteria). "Call when the
  structured protocol needs clinical context the row does not carry."
- **Owning domain.** Pediatrics lead.
- **Invariants.** This file MUST **not** contradict `catalog.standard_prescriptions` rows — the
  governed table is authority for the *protocol*; this is exemplar prose. Divergence between the
  two is a six-eye review finding (§3) and a consistency check (§5.5). The doctor "may modify
  based on clinical judgement" framing is preserved — these are first-line defaults, never
  auto-applied (I3: human sign-off always).

### 2.10 `vaccination_iap2024` — IAP 2024 ACVIP schedule

- **Scope.** The full **IAP 2024 ACVIP** schedule (birth → 16–18 yr), the **IAP-vs-NHM
  differences** table, and **Haryana-specific** rules (Rotavirus + PCV free under UIP; JE not
  routine; HPV rollout 2026–27); the **preterm chronological-age** vaccination rule.
- **Fetch trigger.** "Call when the **IAP** schedule is selected at the pad, or any vaccination
  decision is made for a privately-vaccinated patient." (NHM/IAP buttons are mutually exclusive,
  neither pre-selected — `CLAUDE.md`.)
- **Owning domain.** Immunization / Community pediatrics.
- **Invariants.** Haryana-specific deviations are load-bearing (free PCV/Rotavirus; no JE). Preterm
  rule MUST match `neonatal` (§2.3) — **chronological age for vaccines, always.** This file and
  `vaccination_nhm_uip` share the differences/Haryana/preterm tables; they MUST stay in sync
  (§5.5 cross-file consistency).

### 2.11 `vaccination_nhm_uip` — NHM-UIP (government free) schedule

- **Scope.** The **NHM-UIP** government-free schedule (birth → 16 yr; Pentavalent, OPV, Rotavirus,
  PCV, fIPV, MR, JE in endemic areas, DPT boosters, Td), the IAP-vs-NHM differences table, Haryana
  specifics, and the preterm chronological-age rule.
- **Fetch trigger.** "Call when the **NHM** schedule is selected at the pad, or for a
  government-scheme / free-vaccination patient."
- **Owning domain.** Immunization / Community pediatrics.
- **Invariants.** Same shared-table sync requirement as §2.10. fIPV (fractional intradermal) vs IAP
  full-IM IPV distinction is load-bearing.

### 2.12 Reference roster summary

| `ref_name` | Storage key (`website/skill/references/…`) | Owning domain | Pre-embedded? | Render-critical bytes |
|---|---|---|---|---|
| `nabh_compliance` | `nabh_compliance.md` | Quality / NABH | **Yes (cached prefix)** | bilingual block refs |
| `dosing_methods` | `dosing_methods.md` | Pharmacology / Peds | No | — |
| `neonatal` *(alias `neonatal_dosing`)* | `neonatal.md` | Neonatology | No | — |
| `emergency_triage` | `emergency_triage.md` | Emergency / PICU | No | **Devanagari** |
| `growth_charts` | `growth_charts.md` | Peds / Nutrition | No | — |
| `developmental` | `developmental.md` | Developmental peds | No | — |
| `iv_fluids` | `iv_fluids.md` | Peds / PICU | No | — |
| `antibiotic_stewardship` | `antibiotic_stewardship.md` | ID / Pharmacology | No | — |
| `standard_prescriptions` | `standard_prescriptions.md` | Peds lead | No | — |
| `vaccination_iap2024` | `vaccination_iap2024.md` | Immunization | No | — |
| `vaccination_nhm_uip` | `vaccination_nhm_uip.md` | Immunization | No | — |

> **Adding a 12th reference** is an additive registry row + a six-eye-reviewed object + a
> `tool_contracts.md` enum extension (the `get_reference` name enum is `strict`). No code change
> beyond the enum; the tool resolves any registered name. Adding one is an ADR-worthy clinical
> decision, not a silent file drop.

---

## 3. Authoring, clinician review & governance

A clinical reference is a **clinical safety artifact**: text the model reasons from to produce a
prescription. Its governance is therefore as strict as the formulary's (`schema_migration.md
§7.3`, six-eye), and stricter than ordinary docs. Three controls bind every reference change.

### 3.1 Six-eye review (no single author ships a reference)

Every create/edit of a reference object passes **three independent pairs of eyes** before its
registry row can point at the new bytes:

1. **Author** — drafts the Markdown (a clinician or a clinical-content agent). May be an AI actor;
   if AI-drafted, the reviewer model/human **MUST be a different actor** (the *judge ≠ author*
   pinning from `agent_threat_model.md` — reviewer/author collusion when both are the same base
   model is an explicit threat).
2. **Clinician-as-oracle** — a **named clinician in the owning domain** (§2 roster) signs off the
   *clinical correctness* of the change. This is the same "clinician is the oracle" principle the
   golden-eval set uses (`eval_data_governance.md`); the reference text is held to the clinician's
   judgement, not the model's. The sign-off records `reviewed_by`, `reviewed_at`, and a one-line
   clinical rationale.
3. **Quality / NABH gate** — confirms the change keeps NABH consistency (e.g. a change to
   `emergency_triage` still satisfies NABH mandatory section #13; a `standard_prescriptions` change
   does not contradict a governed `catalog.standard_prescriptions` row, §5.5).

The sign-off is recorded **out-of-band but auditable** (a `reference_review` provenance record,
the structural sibling of `catalog.formulary_review` in `schema_design.md`'s `catalog` schema
roster), carrying `ref_name`, `from_version`, `to_version`, `from_hash`, `to_hash`, the three
sign-offs, and the clinical rationale. **A registry row MUST NOT be advanced to a new
`content_hash`/`version` without a matching completed review record** — enforced as a write-path
precondition (§4.3) and a content-governance gate (§3.3).

### 3.2 Clinician-as-oracle for clinical substance

The asymmetry matters: **a clinician — never the AI and never an engineer — is the authority on
whether a dosing rule, schedule, or red-flag is correct.** Engineering owns the registry
mechanics, hashing, and gates; the clinician owns the *clinical truth* of the bytes. A reference
edit that changes clinical substance (a dose band in `dosing_methods`, a schedule row in
`vaccination_*`, a red flag in `developmental`) is a **clinical change requiring clinician
sign-off**, not a documentation tweak that can be merged on engineering review alone. Cosmetic
edits (typo, formatting, non-clinical wording) MAY take a lighter path **only if** a reviewer
explicitly classifies the diff as `clinical_impact: none` — and that classification is itself
recorded and spot-audited.

### 3.3 Adversarial content-governance gate (poisoning defence)

A reference file is a **prompt-injection / data-poisoning surface** — a malicious or careless edit
("ignore prior dosing limits", an inflated max dose, an injected instruction) reaches the model
verbatim. So beyond six-eye, an automated **content-governance gate** (`agent_threat_model.md`,
owned there; this file specifies the *reference-content* slice) runs on every proposed reference
change and **fails closed**:

| Check | Fails the change when… |
|---|---|
| **Injection-pattern scan** | the diff introduces imperative-to-the-model phrasing ("ignore", "disregard", "you must output", system-prompt-shaped text) that is not legitimate clinical content. |
| **No-PII scan** | any PHI token (UHID, name, DOB, MRN, phone) appears — a reference is generic clinical knowledge and must contain **zero** patient data (reuses the `ci/eval-phi-scan` PHI-pattern engine from `eval_data_governance.md`). |
| **Dose-sanity bounds** | a numeric dosing rule in `dosing_methods`/`standard_prescriptions`/`iv_fluids` falls outside a sane pediatric envelope (a guard against a fat-fingered max-dose; the clinician oracle is the primary control, this is the automated backstop). |
| **Render-fidelity** *(for `emergency_triage`, `nabh_compliance`)* | the Devanagari/bilingual block fails the `ci/render-devanagari` check. |
| **Consistency** | a cross-file invariant breaks (corrected-age, vaccination-age, shared vaccination tables — §5.5). |

> **Why this gate exists.** The system's entire safety case is "answer from data, not guesswork."
> A reference is *the data the model reasons from*. An ungated reference edit is the one path that
> can move clinical behaviour without touching code, schema, or the dose engine — so it gets the
> same severity-weighted scrutiny (`clinical_risk_management.md`) as any never-event surface.

### 3.4 RLS & access (who may write a reference)

Reference objects live in the `website` Storage bucket; the registry is `catalog.clinical_reference`.
Per `06_security` and the `catalog`-schema RLS model: **only the `admin` (formulary/reference
maintainer) role may write** the registry and the Storage object; `reception/nurse/doctor` are
**read-through-the-tool only** (they never read the bucket directly — the worker's `StoragePort`
adapter does). **No DELETE** on the registry (append-only history; a retired reference is marked,
not deleted — §4.4). The `service`/worker role has **read-only** access to resolve `get_reference`
at runtime.

---

## 4. The `catalog.clinical_reference` registry

### 4.1 Schema (owned by `03_data/schema_design.md §3.4`, restated for locality)

```sql
create table catalog.clinical_reference (
  id            uuid primary key default gen_random_uuid(),
  ref_name      text not null unique,        -- 'nabh_compliance', 'neonatal', ...  (filename stem)
  storage_key   text not null,               -- website/skill/references/<file>.md
  content_hash  text not null,               -- SHA-256 over canonical UTF-8 bytes (NFC-normalized)
  version       int not null default 1,      -- monotonic per ref_name; bumps on every byte change
  updated_at    timestamptz not null default now()
);
```

**Registry invariants this file pins (beyond the DDL):**

- **`ref_name` is the resolution key** and the **`get_reference` tool argument** (`tool_contracts.md`
  `input_schema = { name: enum(<ref_names + aliases>) }`, `strict:true`). The name is stable across
  versions; the *object the name points at* changes.
- **`content_hash` is the object's identity.** It is computed over the **canonical bytes**
  (UTF-8, NFC-normalized, LF line endings) so a Devanagari normalization difference cannot produce
  a false "unchanged". Two registry rows for the same `ref_name` with the same `content_hash` are
  the same content; a different hash is — by definition — a new version requiring review.
- **`version` is monotonic per `ref_name`** and bumps on **every** byte change (§5.1). The pair
  `(ref_name, version)` is what `generation_events` records as "the reference the model saw"
  (NABH traceability).
- **`storage_key` MAY be version-qualified** (e.g. `…/neonatal.md@3` or a content-addressed key)
  so historical versions remain fetchable for audit replay; the **live** row's `storage_key`
  points at the current object. (Implementation choice deferred to `03_data`/`07_deployment`; this
  file requires only that *old versions stay retrievable for audit*.)

### 4.2 Name → object resolution (and aliases)

`get_reference(name)` resolves as:

```
get_reference(name):
  row = SELECT storage_key, content_hash, version
        FROM catalog.clinical_reference
        WHERE ref_name = name OR name = ANY(aliases(ref_name))   -- alias-aware
  assert row exists                       -- unknown name → tool error (never a silent empty body)
  body = StoragePort.getObject(row.storage_key)
  assert sha256(canonical(body)) == row.content_hash   -- integrity: bytes match the registry hash
  return body                              -- the resolved .md, condensed shape per tool_contracts
```

- **Aliases.** The registry carries a small, reviewed alias map so the canonical names used across
  the spec resolve to the right object — notably `neonatal_dosing → neonatal`. An alias is a
  **registry-level redirect to the same object**, never a duplicate object (no second hash to keep
  in sync).
- **Integrity assertion is mandatory.** If the fetched bytes do not hash to the registry's
  `content_hash`, the resolution **fails closed** (`GenerationFailed{reason: reference_integrity}`)
  rather than feeding the model tampered/stale bytes — a Storage object diverging from its
  registry hash is a poisoning/operational alarm.
- **Unknown name fails loud.** Because the tool enum is `strict`, an unregistered name should be
  unreachable; a defence-in-depth assertion still rejects it rather than returning an empty body
  the model might silently proceed without.

### 4.3 Write path (how a reference is published)

```
1. Author edits/creates the .md  →  six-eye review (§3.1) + content-governance gate (§3.3) PASS
2. content_hash = sha256(canonical(bytes))
3. Upload object to Storage at the (version-qualified) storage_key   [admin role only]
4. UPSERT catalog.clinical_reference (ref_name, storage_key, content_hash, version = prev+1, updated_at = now())
   PRECONDITION (enforced): a completed reference_review record exists for (ref_name, to_hash)
5. Emit ReferenceVersionPublished{ ref_name, version, content_hash } on the bus
6. → cache-bust / pre-warm handling per §5.4
```

The write is **idempotent on `(ref_name, content_hash)`**: re-publishing identical bytes is a
no-op (no version bump, no review re-trigger). The version bump is reserved for genuine byte
changes (canonical-hash difference), so the version counter is a true edit count.

### 4.4 Retirement (never delete)

A reference is retired by marking it (e.g. `retired_at` / a status column added by `03_data`),
**never DELETEd** (append-only `catalog`; `06_security`). A retired `ref_name` is removed from the
`get_reference` enum (so the model can no longer fetch it) but its rows and objects remain for
audit replay of past prescriptions. Retiring a reference that prompts still cite is an ADR-worthy
change (it alters model behaviour).

---

## 5. Versioning & cache-bust

### 5.1 Versioning model

- **Per-reference monotonic `version` (int)** is the registry's edit counter — the audit-grade
  identity recorded per generation. It is the **minimum** contract.
- **Optional human-facing semver** MAY be carried in a sidecar header inside the `.md`
  (`<!-- ref: neonatal v2.1.0 -->`) for clinician readability, where `MAJOR` = a clinical-rule
  change (new dose band, schedule row, red flag), `MINOR` = additive clarification, `PATCH` =
  cosmetic. The **registry `version` int is authority**; the semver is documentation. A `MAJOR`
  semver bump is the signal that the change is clinically load-bearing and needs the full clinician
  oracle path (§3.2).
- **Append-not-mutate.** A new version is a **new content_hash + incremented version**, never an
  in-place overwrite that loses the prior bytes. This mirrors the golden-eval "append, don't
  mutate" discipline (`evals_framework.md`) and keeps audit replay total.

### 5.2 What a version records (audit)

Every generation's `generation_events` / `prescription_audit` (`ai_orchestration.md §7`) records,
per `ToolInvoked{tool:'get_reference'}`, the **`ref_name@version` and `content_hash`** the model
actually saw. This answers, for any historical prescription, *exactly which reference text grounded
it* — an NABH traceability and clinical-incident-review requirement. A reference edit therefore
does **not** rewrite history: prescriptions signed against v2 still trace to v2's bytes.

### 5.3 Reference version ↔ eval set

A reference is part of the **model-facing context**; changing it can change generation behaviour.
Therefore a reference version bump (especially `MAJOR`) is scored against the **pinned golden eval
set** (`evals_framework.md`) before it ships — the same gate a prompt or model change passes.
A reference edit that regresses a safety-critical eval case **blocks**. This closes the loop: a
clinically-correct-looking edit that breaks a golden case is caught before clinicians depend on it.

### 5.4 Cache-bust rule (the prefix interaction)

This is the load-bearing interaction with `05_ai/prompt_system_design.md`'s **byte-frozen cache
prefix** (`ai_orchestration.md §5.1`):

| Reference | Where it sits relative to the cache breakpoint | Version bump → cache effect |
|---|---|---|
| **`nabh_compliance`** | **Inside** the cached prefix (pre-embedded) | A version bump **changes the prefix bytes → invalidates the prompt cache** for the whole pipeline. The publish flow MUST trigger a **pre-warm** (`max_tokens:0` request on worker boot, `ai_orchestration.md §5.1`) so the next real generation is a cache *write*, and the `cache_read_input_tokens != 0` audit assertion re-greens on the call after. **NABH edits are scheduled, not hot-patched**, precisely because they cost a cache reset. |
| **All other 10 references** | **After** the breakpoint (fetched as `tool_result` blocks) | A version bump does **not** touch the cached prefix → **no prompt-cache invalidation.** The only cache that busts is any *application-level* reference cache the `StoragePort` adapter holds (the Edge Function "caches skill files" in the prototype). The `ReferenceVersionPublished` event (§4.3) **invalidates that application cache by `ref_name`** so the next `get_reference` fetches the new bytes, not a stale cached copy. |

> **The rule in one line:** *a reference edit busts the application-level Storage cache for that
> `ref_name` always; it busts the **prompt** cache only for the one pre-embedded reference
> (`nabh_compliance`), which is why NABH edits are batched and pre-warmed.*

### 5.5 Cross-file consistency (versioned invariants)

Some clinical truths appear in **multiple** references and MUST stay in lockstep across versions —
a consistency gate (§3.3) blocks a change that desyncs them:

| Shared invariant | Files that must agree |
|---|---|
| **Corrected-age formula** (`chronological − (40 − GA) wk`, to 2 yr) | `neonatal`, `growth_charts`, `developmental` |
| **Vaccination = chronological age, always** (Hep-B BW<2 kg exception) | `neonatal`, `vaccination_iap2024`, `vaccination_nhm_uip` |
| **IAP-vs-NHM differences + Haryana specifics tables** | `vaccination_iap2024`, `vaccination_nhm_uip` |
| **Neonatal Day-1 fluids** (10% Dextrose 60–80 ml/kg/day) | `neonatal`, `iv_fluids` |
| **Rounding rules & dose caps** (must equal `DoseEnginePort` behaviour) | `dosing_methods` ↔ `core/` `DoseEnginePort` (`canonical_decisions.md` C5) |
| **Standard-protocol narrative vs governed rows** | `standard_prescriptions` ↔ `catalog.standard_prescriptions` |

---

## 6. Runtime fetch — how a reference reaches the model

The end-to-end path, grounded in `ai_orchestration.md §4` and `backend_services.md §4`:

```
 Claude (off-edge worker, streaming loop)
   │  emits tool_use: get_reference{ name: 'neonatal' }
   ▼
 ClinicalKnowledgePort.get_reference(name)            (core/ — port only; no IO here)
   │
   ▼  adapter: knowledge/reference.adapter.ts
 catalog.clinical_reference  ─lookup ref_name(+alias)→ storage_key, content_hash, version
   │
   ▼  StoragePort.getObject(storage_key)              (Supabase Storage POC → GCS/S3 prod, env-flipped)
 .md body  ─integrity: sha256(canonical(body)) == content_hash─ assert (fail-closed §4.2)
   │
   ▼  return body (condensed shape per tool_contracts.md) in a SINGLE tool_result message
 Claude continues the loop
   │
   ▼  ObservabilityPort records ToolInvoked{ tool:'get_reference', ref_name, version, content_hash }
```

Key runtime properties (each owned elsewhere, enforced here for references specifically):

- **Behind ports.** `get_reference` is a method on `ClinicalKnowledgePort`; the Storage fetch is
  `StoragePort` (`ai_orchestration.md §3.1`, `backend_services.md §4.1`). `core/` touches neither
  Storage nor SQL directly — the model-id-firewall-style hexagon applies (`canonical_decisions.md`
  I5).
- **Parallel, single `tool_result`.** When Claude requests several references (or references +
  formulary + protocol) in one `tool_use` turn, the worker resolves them **concurrently
  (`Promise.all`)** and returns **all** `tool_result` blocks in **one** user message — never split
  (`ai_orchestration.md §4.3`; splitting trains the model out of parallel calls —
  `canonical_decisions.md` Part B.2).
- **No PII in, no PII out.** A reference is generic clinical knowledge; the `get_reference` tool
  takes a `name` only — **no `patient_id`, no clinical note** flows into it. There is no PII
  surface on this tool at all (`ai_orchestration.md §8`; `canonical_decisions.md` C2/I6). This is
  the one tool that is *structurally* PII-free.
- **Application cache.** The `StoragePort` reference adapter MAY cache resolved bodies by
  `(ref_name, content_hash)` for the worker's lifetime (the prototype's "caches skill files"
  behaviour, made correct): the `content_hash` in the key means a version bump can never serve a
  stale body, and `ReferenceVersionPublished` (§5.4) evicts the old key.
- **Pre-embedded NABH is not a runtime fetch.** `nabh_compliance` is concatenated into the cached
  system prefix at composition time (`05_ai/prompt_system_design.md`), so it never traverses this
  path; its "fetch" is a build-time embed (§2.1, §5.4).

---

## 7. Acceptance criteria (what makes this subsystem conformant)

This subsystem is **gated**; `09_engineering_discipline/` owns the runners, this file defines
WHAT is gated for references:

1. **Registry completeness.** Every one of the 11 `ref_name`s resolves through
   `get_reference` to a Storage object whose bytes hash to the registry `content_hash`; the
   `get_reference` tool enum equals the set of live (non-retired) `ref_name`s + aliases. A missing
   or hash-mismatched reference fails CI.
2. **Six-eye precondition.** No registry row advances to a new `content_hash`/`version` without a
   matching completed `reference_review` (author + clinician-oracle + NABH/quality). Enforced at
   the write path (§4.3) and asserted in CI.
3. **Content-governance gate green.** The injection / no-PII / dose-sanity / render-fidelity /
   consistency checks (§3.3) pass on every reference change; any failure blocks
   (fail-closed).
4. **Cache-bust correctness.** A `nabh_compliance` version bump triggers a pre-warm and the
   `cache_read_input_tokens != 0` audit re-greens; a non-NABH reference bump invalidates the
   application Storage cache for that `ref_name` and does **not** invalidate the prompt cache
   (asserted — a non-NABH edit that drops cache-read is a regression alarm).
5. **Audit traceability.** Every generation records `ref_name@version` + `content_hash` for each
   `get_reference` invocation; historical prescriptions trace to the exact reference bytes that
   grounded them.
6. **Eval gate on version bumps.** A reference version bump is scored against the pinned golden eval
   set (§5.3); a regression on a safety-critical case blocks the publish.
7. **Cross-file consistency.** The §5.5 shared invariants hold across the affected references after
   any change (corrected-age, vaccination-age, shared vaccination tables, Day-1 fluids, rounding,
   protocol-vs-governed-row).

---

### Key source references (absolute / branch-qualified)

- **The 11 references (port-from, governance-wrap):**
  `radhakishan_system/skill/references/{nabh_compliance, dosing_methods, neonatal,
  emergency_triage, growth_charts, developmental, iv_fluids, antibiotic_stewardship,
  standard_prescriptions, vaccination_iap2024, vaccination_nhm_uip}.md`.
- **Registry DDL:** `system-spec/03_data/schema_design.md §3.4` (`catalog.clinical_reference`);
  `catalog.formulary_review` (the six-eye provenance sibling, §3.1) — `schema_design.md` `catalog`
  roster.
- **Tool surface & orchestration:** `system-spec/02_architecture/ai_orchestration.md §4.1–§4.5`
  (`get_reference`, progressive disclosure, parallel `tool_result`, Opus-4.8 tool-trigger tuning),
  §4.2 (pre-embedded NABH), §5.1 (cache prefix + pre-warm + `cache_read_input_tokens` audit), §7
  (`generation_events`/`prescription_audit`), §8 (no-PII boundary);
  `02_architecture/backend_services.md §4.1` (knowledge adapters behind ports).
- **Frozen tool schema:** `system-spec/05_ai/tool_contracts.md` (`get_reference` `input_schema`,
  `strict:true`, condensed output) — Part B.2 of `canonical_decisions.md`.
- **Prefix / NABH embed:** `system-spec/05_ai/prompt_system_design.md` (cacheable-prefix byte
  contract, pre-embedded NABH block).
- **Governance / gates:** `09_engineering_discipline/evals_framework.md §4.2` (dataset governance,
  clinician-as-oracle, PHI scan), `eval_data_governance.md` (de-id PHI-scanner `ci/eval-phi-scan`),
  `agent_threat_model.md` (reference/formulary poisoning, judge≠author, content-governance gate),
  `clinical_risk_management.md` (severity-weighting hard-block vs warn),
  `render_fidelity_gates.md` (`ci/render-devanagari`).
- **Migration / KB integrity precedent:** `03_data/schema_migration.md §7.3` (formulary KB as the
  highest-integrity, six-eye, idempotent-seed governance model this reuses).
- **Binding decisions:** `00_overview/canonical_decisions.md` Part B.1 (this file's mandate), Part
  B.2 (the 6 tool contracts incl. `get_reference`), C2 (no PII / de-id), C5 (dose-engine
  authority), Part E conformance ledger.
