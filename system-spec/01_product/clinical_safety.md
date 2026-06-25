# Clinical Safety — Target-State Specification

> **Scope.** This document is the binding clinical-safety specification for the rebuilt
> Radhakishan Pediatric OPD Prescription System (frontend + backend services + database + AI).
> It defines *what must be true* for the system to be safe to put in front of a doctor and a
> child, and it makes those guarantees **machine-checkable** — enforced in code (state machine,
> dose engine, database constraints, RLS, audit triggers), not in prompt text.
>
> **Authority model.** These are **hard requirements (invariants)**. Any change that violates one
> is blocked at CI and at code review. Tickets tagged `clinical-safety` require a second human
> review by the clinical reviewer (Dr. Lokender Goyal or delegate). This mirrors the discipline
> already established for the Document Ingestion Service (`dis/.../clinical_safety.md`, CS-1..CS-12),
> and extends it to **prescribing**.
>
> **Lineage.** The numbered safety invariants below (CS-RX-1..CS-RX-20) are the prescribing
> analog of the ingestion CS-1..CS-12 set. The behavioural decisions are the 37 doctor-ratified
> decisions of `15-decisions-2026-04-28.md` (cited inline as **D#**). The arithmetic authority is
> the pure dose engine (`web/dose-engine.js` → ported to `core/` as `DoseEnginePort`).
>
> **Sister documents (do not duplicate):** the TDD/eval operating model, review gates, and
> drift-prevention live under `09_engineering_discipline/`. *This* document defines **what** is
> gated (dose golden-parity, generation evals, safety invariants, FHIR snapshots); it does not own
> the runner.

---

## 0. The one-sentence safety contract

> **No prescription numeral that a human did not deterministically compute or explicitly
> acknowledge ever reaches printed paper, and no AI-authored prescription is ever finalized
> without a human `SignOff` command — fail-closed, audited, and replayable.**

Everything in this document is an elaboration of that sentence. Three load-bearing claims:

1. **The dose engine is the sole arithmetic authority.** The AI selects drugs and regimens and
   narrates; it *never* emits a numeric dose, volume, or daily total that reaches the prescription.
   The deterministic engine computes every number; the server re-computes byte-for-byte and rejects
   mismatches. (Goodell et al. 2025, *npj Digital Medicine*: tool-computed pediatric dosing 95% vs.
   36% for LLM mental math — the empirical basis for `D5`.)
2. **Humans and AI are symmetric actors, but only humans can finalize.** Every mutation is a
   `Command` on one bus; an AI draft sits in `pending_review` until a human `SignOff` — identical
   fail-closed gating to the OCR `promotion.ts` (CS-1/CS-7 analog). Going "AI-first" later is an
   additive subscriber, **not** a relaxation of this gate.
3. **There is no silent wrong Rx.** Every failure mode — omission, formulary miss, allergy clash,
   dose cap, Anthropic outage, Hindi-render failure, model retirement — degrades to a *visible*,
   *audited*, *acknowledge-gated* state. Silence is the defined worst-case and is engineered out.

---

## 1. Threat model — the failure modes we are defending against

These are the concrete ways a pediatric OPD AI prescription system kills or harms a child. Each maps
to one or more invariants in §3. Most are drawn from real audit cases in this codebase (cited).

| # | Failure mode | Concrete example | Defended by |
|---|---|---|---|
| T1 | **Silent drug omission** | Doctor wrote 3 drugs; Rx prints 2; doctor believes all 3 are there | CS-RX-2, CS-RX-3 (`D1`) |
| T2 | **AI mental-math dose error** | AI computes 250mg/dose where engine says 125mg | CS-RX-5, CS-RX-6 (`D5`) |
| T3 | **Max-dose / toxic overdose** | Paracetamol > 75 mg/kg/day; not capped | CS-RX-7 (`D4`) |
| T4 | **Allergy clash printed silently** | Child penicillin-allergic; amoxicillin printed with no warning | CS-RX-8 (`D10`) |
| T5 | **Dangerous interaction** | QT-prolonging pair co-prescribed | CS-RX-9 |
| T6 | **Hallucinated drug / brand misattribution** | "Vitafol" mapped to Folic Acid from training memory (real audit case) | CS-RX-10 (`D3`) |
| T7 | **Formulary miss silently dosed** | Drug absent from formulary; AI doses from prior knowledge | CS-RX-10, CS-RX-11 (`D9`, `D37`) |
| T8 | **AI auto-finalizes** | Draft printed without doctor sign-off | CS-RX-1, CS-RX-13 |
| T9 | **High-severity bypass via edit** | High flag → doctor edits → save re-enables Sign without re-check | CS-RX-13 |
| T10 | **Wrong patient context** | Generation runs against stale/other patient's weight or allergies | CS-RX-4, CS-RX-15 |
| T11 | **Missing weight → bad dose** | Weight-based dosing with weight=null | CS-RX-4 (`D11`) |
| T12 | **Preterm age arithmetic error** | Corrected vs chronological age confused | CS-RX-4 (`D12`) |
| T13 | **Garbled / missing Hindi** | Patient-facing Devanagari absent or mojibake | CS-RX-12 (`D13`) |
| T14 | **Model retirement breaks prod** | Hardcoded `claude-*` id retired → silent failure (happened) | CS-RX-16 |
| T15 | **Silent model downgrade** | Opus → Sonnet on overload, doctor unaware | CS-RX-16 |
| T16 | **Tamper / forged Rx** | 6-char client-salt QR hash forged | CS-RX-17 |
| T17 | **Unverified OCR labs feed Rx** | `pending_review` lab influences dosing | CS-RX-15 (CS-12 analog) |
| T18 | **Audit gap** | No record of who signed / what model / which tools | CS-RX-18 |
| T19 | **Pictogram false confidence** | Icon-only dosing misread by low-literacy parent | CS-RX-12 |
| T20 | **Infinite spinner / timeout fallback wrong-Rx** | 150s edge timeout → degraded single-shot silently trusted | CS-RX-13, CS-RX-19 |

---

## 2. Safety architecture — defense in depth (five sealed layers)

Safety is **not** a prompt. It is five independent layers, each of which can fail closed without
the others. The AI sits *inside* this sandwich and is treated as an untrusted-but-useful actor.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ LAYER 5 — HUMAN SIGN-OFF GATE (the only finalizer)                            │
│   SignoffGate: severity-driven, re-applied after every edit, ack-checkbox,    │
│   provenance-labelled. AI can never emit a SignOff. (CS-RX-13)                │
├──────────────────────────────────────────────────────────────────────────────┤
│ LAYER 4 — SERVER RE-VALIDATION (the trust boundary)                          │
│   Re-runs dose engine byte-for-byte, re-derives severity = max(server, ai),   │
│   enforces completeness, validates Devanagari, checks codes, NO tolerance.    │
│   Client-supplied numerals are NEVER trusted. (CS-RX-5,6,7,8,9,12,14)         │
├──────────────────────────────────────────────────────────────────────────────┤
│ LAYER 3 — DETERMINISTIC DOSE ENGINE (the arithmetic authority)               │
│   Pure DoseEnginePort. Computes mg/ml/drops, caps, range checks, bilingual    │
│   + pictogram strings. Zero IO/DOM. Golden JS↔TS parity gate. (CS-RX-5,6,7)  │
├──────────────────────────────────────────────────────────────────────────────┤
│ LAYER 2 — AI ORCHESTRATION (untrusted proposer)                              │
│   Selects drugs/regimens, narrates, calls tools. Emits NO numerals. Routed    │
│   through ClinicalKnowledgePort tools (formulary, std-rx, labs — verified     │
│   only). Structured-output schema, not regex. (CS-RX-2,10,11,15)             │
├──────────────────────────────────────────────────────────────────────────────┤
│ LAYER 1 — DATABASE INVARIANTS (immovable substrate)                          │
│   Composite FKs, CHECK constraints, server-side ID allocation, per-role RLS,  │
│   append-only audit triggers, immutable signed Rx, terminology FKs.           │
│   (CS-RX-3,17,18)                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Design principle (open/closed + dependency inversion):** the dose engine and the state machine
are *sealed*. New drugs, new protocols, new AI behaviour, and the future AI-first autonomous mode
are all *additions* — none can weaken Layers 1, 3, 4, or 5 without breaking a CI fitness rule or a
golden fixture.

---

## 3. The prescribing safety invariants (CS-RX-1 .. CS-RX-20)

> These are the prescribing analog of the ingestion CS-1..CS-12 set. Each invariant states the rule,
> the enforcement point, and a **machine-checkable test** that gates merge. "Decision D#" cites
> `15-decisions-2026-04-28.md`.

### CS-RX-1 — No AI draft is finalized without a human SignOff

An AI-generated (or speculatively generated) prescription is `pending_review` until a human actor
issues a `SignOff` command. No code path — including the future autonomous AI-first subscriber —
may transition `draft_ready → signed` without a `SignOff` event whose `actor` is a human role
(`doctor`).

- **Enforcement:** pure `state-machine.ts` `transition(state, event)`; the only edge into `signed`
  requires `{ kind: 'sign_off', actor }` where `actor.role === 'doctor'`. Invalid transitions throw
  `InvalidStateTransitionError` and are **never persisted**. Server `signOff()` re-checks the gate
  server-side (the client gate is convenience, not the boundary).
- **Test:** attempt to drive `draft_ready → signed` via a `system`/`ai_agent` actor → throws, writes
  nothing, returns 409. Attempt to print an unsigned draft → 409.

### CS-RX-2 — No silent drug omission (`D1`)

The AI never silently drops a drug the doctor wrote. Every drug in `requested_medicines[]` must
appear **either** in `medicines[]` **or** in `omitted_medicines[]` with a `reason`. The reconciliation
`len(medicines from doctor) + len(omitted_medicines) == len(requested_medicines)` is enforced
**server-side**; a mismatch triggers exactly one auto-retry, then forces `severity = high` and
surfaces the still-missing drugs as red stubs.

- **Allowed omission reasons (closed set):** `not_in_formulary`, `age_contraindication`,
  `dangerous_interaction`, `doctor_specified_dose_unsafe_engine_capped`,
  `fallback_mode_omission` (server-set), `server_completeness_check_skipped_retry` (server-set).
  **Allergy is NOT a valid omission reason** — see CS-RX-8.
- **Enforcement:** `core/completeness.ts` reconciliation (a pure function over the requested/emitted/
  omitted sets) runs after generation and after every edit; not a prompt instruction.
- **Test:** generate from a 3-drug note where the model emits 2 and omits 0 → server detects the
  gap, retries once, and on persistence the missing drug appears as a stub with `severity = high`.

### CS-RX-3 — Every prescription line traces to its origin

Every `prescribing.medicines` line records `provenance ∈ {doctor_written, ai_suggested,
engine_computed}` and the `rx_generation_job_id` that produced it. AI-suggested protocol drugs
(only possible with Standard Rx ON — `D2`, `D32`) are visually distinct on screen and on paper and
require explicit doctor approval at sign-off.

- **Enforcement:** NOT NULL `provenance` column + composite FK to the generation job; the UI renders
  AI lines differently (not colour-only — see CS-RX-12 a11y) and the print carries an
  "AI-assisted, doctor-reviewed" line.
- **Test:** a line with `provenance = ai_suggested` and no doctor approval at sign-off → SignoffGate
  blocks; DDL test asserts NOT NULL provenance.

### CS-RX-4 — Patient context is complete, fresh, and human/deterministic before dosing

Weight-based dosing requires a weight. The system enforces:
- **Weight mandatory** at the nurse station; no visit saves without it (`D11`). If still missing at
  Generate, an inline prompt captures it (persisted to the visit) before any compute runs.
- **Preterm ages computed deterministically on the client** (`D12`): `corrected_age_days` and
  `chronological_age_days` are JavaScript-computed and sent as structured fields; the AI does **no**
  age arithmetic.
- **Context version pinning:** each generation is keyed to a `patient_context_version`; if the
  context (weight/allergies/labs) changes, the in-flight draft is marked `superseded` (CS-RX-19).

- **Enforcement:** Generation refuses to call `compute_doses` for a weight-based drug when
  `weight == null` (returns a structured "missing weight" error, never a guess). Nurse-station weight
  is a NOT NULL-on-save constraint at the application boundary.
- **Test:** request generation with `weight=null` and a weight-based drug → no numeral is produced;
  the UI surfaces the inline weight prompt; audit records `warnings: ['weight_missing']`.

### CS-RX-5 — The AI emits NO numerals; the dose engine computes every number

In the prescription payload, AI-authored medicine objects carry **no** numeric dose, volume,
mg/kg, or daily-total fields. The deterministic `DoseEnginePort` (`compute_doses` tool, `D5`)
computes `volume_display`, `english_dose`, `hindi_dose`, and `calc_string` for **all** drugs in one
batched call; the AI copies those verbatim.

- **Enforcement:** the structured-output schema for medicine objects forbids numeric dose fields
  (Ajv/`strict:true` tools); a CI fitness rule (`ai_emits_no_dose_numerals`) scans the generation
  schema. Any weight-based medicine lacking an engine `calc_string` is auto-flagged
  `compute_doses_likely_skipped` and severity ≥ `moderate`.
- **Test:** feed a model response with a hand-written `dose_mg: 250` field → schema rejects it; the
  drug is re-routed through the engine.

### CS-RX-6 — The server re-computes byte-for-byte, with zero tolerance

The server independently re-runs the dose engine over the signed regimen and compares to the
client/AI-supplied strings **exactly**. There is **no tolerance band** — a 20% (or 1%) client
override is rejected. A mismatch forces `severity = REVIEW REQUIRED (high)` and the engine value
wins on paper.

- **Enforcement:** Layer-4 server re-validation; the engine output is canonical, the client value is
  advisory. Golden **JS↔TS parity fixtures** (≥20 cases: syrup 0.5 ml / drops 0.1 ml / tablet 0.25
  rounding; single & daily caps; combo limiting-ingredient; bilingual strings) gate the engine port
  itself — closing the gap that `sprint-2-saved` shipped the TS port *without* fixtures.
- **Test:** submit a tampered `volume_display` differing from the engine → server rejects, flags
  high, prints the engine value, logs the discrepancy.

### CS-RX-7 — Max single dose and max daily dose are hard caps (`D4`)

For every ingredient (including each component of a combo drug, via the limiting ingredient), the
engine enforces `max_single_mg` and `max_daily_mg` from the formulary band. Exceeding a cap sets
`capped = true`, surfaces a prominent red banner, forces `severity = high`, and requires an
acknowledge checkbox before Sign. A doctor-specified dose above max is **printed as written** (D4 —
authority preserved) but **only after explicit acknowledgement** logged to audit.

- **Enforcement:** `computeDose()` cap logic (`effMaxSingle`, per-ingredient `max_single_mg` /
  `max_daily_mg` checks) + server re-check; the SignoffGate consumes the `capped`/`maxExceeded` flags.
- **Test:** prescribe paracetamol at a dose exceeding `max_daily_mg` → `capped=true`, banner shown,
  Sign disabled until ack; audit records the acknowledged override.

### CS-RX-8 — Allergy clash: print + warn loudly + gate, never silent, never auto-drop (`D10`)

When a prescribed drug clashes with a recorded allergy (direct or cross-reaction), the drug **stays
in `medicines[]`** (doctor authority), the AI adds a prominent warning and a suggested allergy-safe
alternative, and **Sign is disabled** until the doctor either swaps to the alternative or ticks an
explicit override checkbox. Allergy is **never** a reason to silently omit (CS-RX-2).

- **Enforcement:** allergy/cross-reaction check runs server-side against `patients.known_allergies`
  + formulary `cross_reactions`; the SignoffGate blocks on an un-acknowledged allergy flag. Allergy
  state itself is mandatory-at-registration (NKDA or explicit list — no "not asked" state, `D27`).
- **Test:** penicillin-allergic patient + amoxicillin → drug printed, warning + alternative shown,
  Sign blocked until swap-or-override; override is logged.

### CS-RX-9 — Drug-drug interactions are surfaced and severity-weighted

Pairwise interactions among prescribed drugs (and against active prior Rx) are checked against the
formulary `interactions` data; high-severity interactions force `severity = high` and gate sign-off;
moderate ones raise a caution banner. The AI's clinical judgment is captured separately in
`ai_safety_notes` and **added to**, never substituted for, the server check.

- **Enforcement:** server-side interaction matrix evaluation; `overall_status` severity is
  `max(server, ai)` (`D8`, FHIR `DetectedIssue.severity` aligned).
- **Test:** two drugs flagged as a high-severity pair in the formulary → severity high, gate engaged.

### CS-RX-10 — No drug or brand from model memory; formulary is the only source (`D3`, `D9`)

The AI may only prescribe drugs present in the hospital formulary. Brand→generic mapping comes
**only** from the formulary `brand_names` array; an unmapped brand prints generic only — **no
guessing from training data** (the real "Vitafol → Folic Acid" audit case is the prohibition's
origin). Output format is `GENERIC NAME (Brand)`; NABH requires generic.

- **Enforcement:** the `get_formulary` tool is the only drug-knowledge source; the formulary-not-found
  message is a **structured error** instructing the model to route the drug to `omitted_medicines[]`
  with `reason='not_in_formulary'`, server-enforced — replacing the historical "use your clinical
  training knowledge" anti-pattern (`D37`).
- **Test:** prescribe a brand with no `brand_names` match → prints generic-only or a verify-manually
  stub; never an inferred mapping.

### CS-RX-11 — Formulary miss = visible stub, never silent dose (`D9`)

A drug absent from the formulary prints as a stub — `WIKORYL — DOSE TO BE VERIFIED MANUALLY` — with
the reason shown, a server-side fuzzy `brand_names` suggestion inline, and `severity` forced to
`high`. The doctor fills the dose manually or accepts a suggestion. The drug is **never** silently
omitted nor silently dosed.

- **Enforcement:** `get_formulary` not-found path → structured omission + `renderOmittedStubs()` red
  stub + forced high severity.
- **Test:** a note naming a non-formulary drug → red stub present, severity high, Sign gated.

### CS-RX-12 — Bilingual + pictogram patient instructions are validated, never icon-only (`D13`)

Every medicine carries an English row (R2) and a Hindi/Devanagari row (R3) plus a pictogram sidebar
(R4). The boilerplate (doses, frequencies, durations, routes) is composed **deterministically** from
the engine's Hindi maps; only unusual clinical phrasing is AI-translated. The server validates
Devanagari Unicode (U+0900–U+097F) presence; absence forces `severity = high` with a `devanagari_missing`
flag. **Every pictogram is paired with Hindi+English text — never icon-only** (false-confidence risk);
icons map to USP/FIP-validated sets.

- **Enforcement:** engine builds `hindi_dose` from `HINDI_DROPS/ML/TABLETS/UNITS` + `FREQ_HI`;
  server Devanagari validator; `<MedicineCard>` enforces text-with-every-icon at the component level.
- **Test:** a medicine whose R3 contains no U+0900–U+097F codepoint → `devanagari_missing` flag,
  severity high. A pictogram rendered without paired text → component test fails.

### CS-RX-13 — The Sign-off gate is severity-driven and re-applied after EVERY edit (`D31`)

Sign-off uses one consistent UX for all gates (`D31`): a banner at top + an acknowledge checkbox next
to a disabled Sign button. `severity = high` disables Sign until ack; `moderate` shows a caution
banner; `low` is clear. **Critically, the gate re-runs after any edit** so a `high → edit → save`
sequence cannot bypass it. The same pattern applies to fallback/outage mode (`D7`).

- **Enforcement:** `applySignoffGate(rx)` consumes `severity_final` and the issues list
  (`ai_safety_notes`, `flags`, flagged `max_dose_check`, `omitted_medicines`); it is invoked on
  render **and** on every command that mutates the draft. Server `signOff()` independently re-derives
  severity at submit time (defense in depth — the client gate is not the boundary).
- **Test:** drive `high → edit (lower a dose) → save` and assert the gate re-evaluates and remains
  engaged until the new state is genuinely low; assert server rejects a `SignOff` whose recomputed
  severity is high without an `ack` payload.

### CS-RX-14 — Severity verdict is the safer of server and AI (`D8`)

`overall_status` / severity is `severity_final = max(severity_server, severity_ai)` on the three-tier
scale (`high` > `moderate` > `low`), aligned with FHIR `DetectedIssue.severity`. The server **always**
recomputes its own severity; it may only *raise*, never *lower*, what the AI proposed. The AI's textual
concerns persist as `ai_safety_notes` (additive, never substitutive).

- **Enforcement:** server severity reducer; both values + the final are persisted to
  `prescription_audit` (`severity_server`, `severity_ai`, `severity_final`).
- **Test:** AI says `low`, server check finds a max-dose breach → `severity_final = high`.

### CS-RX-15 — Only verified clinical data feeds the generator (CS-12 analog)

The generation tools (`get_lab_history`, `get_previous_rx`, `get_formulary`) return only
**verified** clinical data. `get_lab_history` filters `lab_results.verification_status = 'verified'`
(or `source ∈ {manual, upload}`); unverified OCR extractions (`pending_review`) never reach the
prescription generator. `get_previous_rx` is **PII-stripped at a typed boundary** (not an ad-hoc
`.map`).

- **Enforcement:** the `ClinicalKnowledgePort` adapters apply the verification filter in the query,
  not the prompt; the PII-strip is a typed projection with its own contract test.
- **Test:** with only an `ai_extracted / pending_review` lab present, `get_lab_history` returns zero
  labs; `get_previous_rx` output contains no name/UHID/identifiers (assert against a denylist).

### CS-RX-16 — Centralized model config; no silent model class change (`D35`, T14/T15)

No `claude-*` (or any vendor model id) string appears in business code — only behind a
`ModelPolicyPort` config object. A dated model retirement that broke production is the prohibition's
origin. Clinical generation runs on the configured clinical-class model (`claude-opus-4-8` at spec
time); a fallback **downgrade** (e.g., Opus → Sonnet on overload/5xx) is permitted but is **flagged**
on the draft and recorded in audit — never silent. The model id + version actually used is recorded
per generation.

- **Enforcement:** CI fitness rule `core_no_model_id_literals`; the worker emits a
  `model_downgraded` event and sets a draft flag when it falls back; `prescription_audit.meta_mode`
  and a model-id column record reality. A `stop_reason: 'refusal'` guard runs before reading content.
- **Test:** grep the codebase for `claude-` outside `adapters/` / config → zero hits. Simulate an
  Opus overload → fallback fires, draft carries a visible "generated on fallback model" badge, audit
  records both the requested and used model.

### CS-RX-17 — Signed prescriptions are immutable and tamper-evident

A signed prescription is immutable: edits create new rows in `prescribing.rx_versions`
(append-only, `D14`); the original signed version is never overwritten. A **content hash** is stored
on the signed Rx for tamper-evidence, and the QR/verify path uses an **ES256 JWS signature**
(`SignaturePort`), replacing the forgeable 6-char client-salt hash. No PHI travels in the QR URL;
verification calls a read-only server endpoint.

- **Enforcement:** BEFORE UPDATE/DELETE triggers on signed Rx and `ops.audit_log` that **raise**
  (the `dis/` M002 append-only pattern); ES256 JWS at sign time; `verify.html` → server endpoint,
  QR rendered client-side (no `api.qrserver.com`, `D24`).
- **Test:** attempt to UPDATE a signed prescription row → trigger raises; verify a Rx with a tampered
  body → signature verification fails.

### CS-RX-18 — Every generation and sign-off is fully audited

Each generation attempt (including retries and fallback) writes one `prescription_audit` row:
`meta_mode`, `stop_reason`, model id + version, input/output tokens, `rounds`, `tools_called[]`,
`requested/emitted/omitted/added` meds, `severity_{server,ai,final}`, `warnings[]`, `duration_ms`,
`correlation_id`. Each `SignOff` writes an `ops.audit_log` row: actor, timestamp, the severity at
sign time, and any acknowledged overrides (max-dose, allergy, fallback). Field-by-field edits between
AI output and signed value are logged with before/after and actor (CS-6 analog, `D14`).

- **Enforcement:** the worker writes `prescription_audit` on every attempt; the CommandBus records
  every mutating command as an event; append-only `ops.audit_log`. PHI in logs is masked
  (UHID → first-4 + last-4, `D15`).
- **Test:** one generation with two edits and a max-dose override → one+ audit rows, two field-edit
  rows, one sign-off row recording the override; UHID never appears unmasked in any log.

### CS-RX-19 — Degraded states are visible and acknowledged; never an infinite spinner or silent timeout

The `GenerationPort` exposes `idle | streaming | ready | stale | error | timeout`. Off-edge
long-running compute removes the 150s edge wall (the root flaw: 504/546 at exactly 150,000 ms). A
hard client deadline degrades to a *visible* UI (retry / manual edit / single-shot) — **never** an
infinite spinner. A speculative draft that no longer matches the current note is `superseded` and the
UI says "regenerating from your latest note…"; the stale draft can never be silently signed.
**Anthropic-outage fallback** generates with a red banner + acknowledge checkbox; Sign is disabled
until ticked (`D7`), and the fallback (non-engine-validated) path forces `severity = high` (`D33`
loop limits + early-stop retained as audited events).

- **Enforcement:** state-machine `superseded`/`failed`/`timeout` transitions; AbortController on every
  request; backoff+jitter; the fallback path sets `meta_mode='fallback-single-shot'` and
  `severity_server='high'`.
- **Test:** induce a timeout → UI shows the degraded panel, not a spinner; sign on a `superseded`
  draft → 409.

### CS-RX-20 — Database substrate cannot be bypassed

The clinical-safety guarantees do not depend on application code being correct. The database enforces:
composite FK `(visit_id, patient_id) REFERENCES visits(id, patient_id)` (Rx↔visit consistency,
formerly app-only); **server-side ID allocation** for UHID/receipt/token via `SECURITY DEFINER`
row-locked counters (kills the client-side `MAX(seq)+1` race, `D19`); **per-role RLS**
(`reception`/`nurse`/`doctor`/`service`/`admin`) set from JWT (`current_setting('app.role'...)`,
`D22`) — the anon key never touches clinical schemas; **no DELETE policy** on clinical/audit tables;
terminology FKs to `catalog.concepts` (ICD-10/SNOMED/LOINC) validated on write.

- **Enforcement:** DDL (forward-only dbmate migrations + `.rollback.sql`); RLS portable across
  Supabase and RDS; CHECK constraints on medical ranges.
- **Test:** insert a prescription whose `patient_id` disagrees with its visit → FK violation; a
  `reception`-role JWT attempts to read a prescription → 0 rows; attempt DELETE on `clinical.visits`
  → policy denies.

---

## 4. The dose engine as deterministic truth

### 4.1 Why a separate engine (the open/closed safety boundary)

The dose engine is the **single arithmetic authority** and a *sealed* module: AI proposes a drug +
regimen with **no numeric fields**; the engine computes every numeral. This is dependency inversion
applied to safety — the unsafe, evolving, non-deterministic actor (the LLM) depends on the safe,
sealed, deterministic one (the engine), never the reverse. Empirically justified: tool-computed
pediatric dosing is 95% accurate vs. 36% for LLM mental math (Goodell 2025; `D5`).

### 4.2 What the engine owns (verified from `dose-engine.ts`)

| Responsibility | Implementation | Safety guarantee |
|---|---|---|
| Weight / BSA / fixed / GFR / infusion / age dosing | `computeDose()` 6 methods | One code path per method; no ad-hoc math |
| BSA | Mosteller: `sqrt(height·weight/3600)` (`calculateBSA`) | Deterministic |
| Form-specific rounding | `roundToUnit()`: syrups → 0.5 ml, drops → 0.1 ml (per-drop), tablets → 0.25, caps/puffs → 1 | Bounded, predictable units |
| Max single dose cap | `effMaxSingle`; `primaryMgPerDose > effMaxSingle ⇒ capped=true` | Hard ceiling (CS-RX-7) |
| Max daily dose cap | per-ingredient `mgPerDay > ingMaxDaily ⇒ maxExceeded` | Hard ceiling (CS-RX-7) |
| Combo / limiting ingredient | `_findIngBand` + `_getLimiting` (`is_limiting`) | Caps every component |
| Therapeutic-range check | `withinRange` vs `dose_min/max_qty` | Surfaces out-of-range |
| Bilingual + pictogram strings | `buildCalcString`, `HINDI_*`, `FREQ_EN/HI` | Deterministic R2/R3/R4 (CS-RX-12) |

### 4.3 The recompute contract (no tolerance)

```
                       ┌─────────────────────────────────────────────┐
 doctor note ─► AI ───►│ proposes: { drug, method, band, freq, route }│  (NO numerals)
                       └───────────────────┬─────────────────────────┘
                                           ▼
                            compute_doses (DoseEnginePort, batched)
                                           │  volume_display, english_dose,
                                           │  hindi_dose, calc_string, capped, warnings[]
                                           ▼
                 AI copies engine output VERBATIM into medicines[]
                                           ▼
            SERVER re-runs the engine over the signed regimen  ── mismatch (any δ) ──► severity=high,
                                           │                                          engine value wins,
                                           ▼                                          logged
                                  byte-for-byte equal ──► trusted numerals
```

**There is no tolerance band.** A client/AI value differing from the server recompute — even by 1% —
is rejected; the engine value is printed. (Rejects the "20% override" failure mode.)

### 4.4 The golden-parity gate (mandatory before trust)

`sprint-2-saved` ships the TS port **without** parity fixtures — a gap this rebuild closes *before*
trusting the engine. The gate: ≥20 golden cases run against **both** `web/dose-engine.js` (browser
source of truth) and the `core/` TS port, asserting identical output. Coverage: syrup 0.5 ml /
drops 0.1 ml / tablet 0.25 rounding; single-dose caps; daily caps; combo limiting-ingredient; BSA;
Devanagari bilingual strings; PRN `max_per_day`. CI blocks merge on any divergence. (Owned by
`09_engineering_discipline/`; *required* here.)

---

## 5. AI guardrails (the untrusted proposer)

The AI is treated as **untrusted-but-useful**. Guardrails are structural, not prompt-trust.

1. **No numerals (CS-RX-5).** Structured-output / `strict:true` tool schema forbids numeric dose
   fields; the brittle `extractJSON` regex is retired in favour of schema-conformed output.
2. **Tools are the only knowledge source (CS-RX-10/15).** Drugs, protocols, labs, and prior Rx come
   through `ClinicalKnowledgePort` adapters; training-memory dosing/brand mapping is structurally
   impossible because the not-found path is a server-enforced structured omission.
3. **Mandatory enumeration + completeness (CS-RX-2).** Reconciliation is a pure server function, not
   a prompt promise; one auto-retry, then visible stubs + high severity.
4. **Determinism for audit (`D36`).** Temperature 0 (where the model supports it); structured
   outputs dominate anyway. Reproducibility > diversity for clinical work.
5. **Loop bounds as audited events (`D33`).** `MAX_TOOL_LOOPS`, repeated-tool-call early-stop, and
   timeouts are kept but promoted to typed, audited events (`ToolInvoked`, `GenerationFailed`) — not
   silent guards. Generations needing ≥5 rounds are flagged in audit.
6. **PII never leaves the project (CS-RX-15, `D29`).** `get_previous_rx` / visit-summary / voice
   context are PII-stripped at typed boundaries; logs mask UHID (`D15`).
7. **Model class is config, downgrade is flagged (CS-RX-16).** `ModelPolicyPort`; a clinical-class
   downgrade is surfaced and audited.

---

## 6. NABH compliance (built-in, not bolted-on)

NABH (Digital Health Standards, 2nd ed., Sep 2025) compliance is mandatory on **every** prescription
and is enforced structurally, not by a prompt asking the model to "be NABH-compliant."

| NABH requirement | How the rebuild enforces it |
|---|---|
| Generic drug naming | `GENERIC NAME (Brand)` format; brand only from formulary `brand_names`; generic-only fallback (CS-RX-10, `D3`) |
| Allergy asked & recorded | Mandatory at registration: NKDA or explicit list; **no "not asked" state** (`D27`) |
| Original signed Rx preserved | Append-only `rx_versions`; signed Rx immutable; "Version N of M" tag (CS-RX-17, `D14`) |
| Complete prescription (no omissions) | Completeness reconciliation + visible stubs (CS-RX-2) |
| Patient-comprehensible instructions | Bilingual R2/R3 + validated pictograms; local comprehension test as NABH quality artifact (CS-RX-12) |
| Audit trail / traceability | `prescription_audit` + append-only `ops.audit_log` per generation and sign-off (CS-RX-18) |
| NABH block on every Rx | Pre-embedded in the cached system prompt (saves a tool round) + asserted present server-side |
| Prescriber identity | Doctor identity + registration numbers on every Rx; HPR ID in config (ABDM/NABH Gold path) |

The **NABH compliance block is pre-embedded** in the prompt prefix; the server asserts its presence
(`nabh_compliant: true` + required fields) before a draft can be signed.

---

## 7. Human review & sign-off (the only finalizer)

### 7.1 The symmetric-actor invariant

Humans and AI emit the **same `Command` shape** to one bus. `RequestGeneration` (doctor click |
speculative autosave trigger | future AI agent) is indistinguishable to the worker. **But only a
human `SignOff` can finalize** — the clinical-safety invariant that makes the future AI-first mode an
*additive subscriber*, not a rewrite. The AI-first subscriber may emit `RequestGeneration`
autonomously; it can **never** emit a valid `SignOff` (CS-RX-1).

### 7.2 The prescription state machine (the safety spine)

```
 note_captured ──RequestGeneration──► generating ──stream──► streaming ──complete──► draft_ready
        ▲                                  │                     │                      │
        │                                  └───fail──► failed     └──supersede──► superseded
        │                                                                              │
        │  (note change / context bump → new RequestGeneration)                        ▼
        └──────────────────────────────────────────────────────────  doctor_editing ◄─┤
                                                                            │           │
                                                                       (edit re-runs    │ SignOff (doctor only,
                                                                        SignoffGate +    │  severity must be low
                                                                        server severity) │  OR ack present)
                                                                            ▼           ▼
                                                                          signed ──print──► printed
```

`transition(state, event)` is **pure**: invalid transitions throw and are **never persisted**; even
failure paths route through `transition()`. There is exactly one human-gated edge into `signed`
(CS-RX-1, CS-RX-13).

### 7.3 The sign-off gate UX (one consistent pattern — `D31`)

| Severity | Banner | Sign button | Ack checkbox |
|---|---|---|---|
| `high` | Red "⚠ REVIEW REQUIRED" + issue list | **Disabled** until ack | Required; Sign enabled only when ticked |
| `moderate` | Amber "⚠ Caution" + issue list | Enabled | Not required (advisory) |
| `low` | None | Enabled | None |
| Allergy clash (CS-RX-8) | Warning + suggested alternative | Disabled | Swap-to-alternative OR explicit override |
| Max-dose breach (CS-RX-7) | Red, drug + calculated vs allowed mg | Disabled | Required; override logged |
| Fallback/outage (`D7`) | Red "generated in degraded mode" | Disabled | Required |
| Model downgrade (CS-RX-16) | "generated on fallback model" badge | per severity | per severity |

**The gate re-applies after every edit** (CS-RX-13) and the **server independently re-derives
severity at submit** — the client gate is convenience, the server gate is the boundary. Issues
surfaced: `ai_safety_notes`, `flags`, flagged `max_dose_check`, `omitted_medicines`. No status is
conveyed by colour alone (WCAG 2.2 AA — avoids the rubber-stamp risk).

---

## 8. Audit, traceability & no-silent-failure

### 8.1 Two audit surfaces

- **`prescribing.prescription_audit`** — one row per generation **attempt** (incl. retries/fallback).
  Telemetry: `meta_mode`, `stop_reason`, model id+version, tokens, `rounds`, `tools_called[]`,
  `requested/emitted/omitted/added` meds, `severity_{server,ai,final}`, `warnings[]`, `duration_ms`,
  `correlation_id`. (Ported & extended from `sprint-2-saved`.)
- **`ops.audit_log`** — append-only, BEFORE UPDATE/DELETE triggers that **raise**. Every mutating
  `Command` (SaveNote, AdjustDose, AddMedicine, GiveVaccination, **SignOff**) becomes an event with
  actor + before/after; field-by-field edit logging (CS-6 analog).

### 8.2 Reference DDL (target)

```sql
-- prescribing.prescription_audit — one row per generation attempt (port + extend sprint-2)
CREATE TABLE prescribing.prescription_audit (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rx_generation_job_id uuid REFERENCES prescribing.rx_generation_jobs(id),
  prescription_id  uuid REFERENCES prescribing.prescriptions(id) ON DELETE SET NULL,
  visit_id         uuid REFERENCES clinical.visits(id) ON DELETE SET NULL,
  patient_id       uuid,                       -- full value here for analytics; masked in logs
  attempt_number   smallint NOT NULL DEFAULT 1,
  meta_mode        text NOT NULL,              -- 'tool-use' | 'fallback-single-shot'
  model_id         text NOT NULL,              -- the model id ACTUALLY used (CS-RX-16)
  model_downgraded boolean NOT NULL DEFAULT false,
  stop_reason      text,
  input_tokens     integer, output_tokens integer,
  cache_read_input_tokens integer,             -- prompt-cache audit (must be > 0 when warm)
  rounds           smallint,
  tools_called     text[],
  requested_meds   text[], emitted_meds text[], added_meds text[],
  omitted_meds     jsonb,                       -- [{name, reason}, ...]
  severity_server  text, severity_ai text, severity_final text,
  warnings         text[],
  duration_ms      integer,
  correlation_id   text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ops.audit_log — append-only; UPDATE/DELETE blocked by trigger
CREATE TABLE ops.audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity        text NOT NULL,                 -- 'prescription' | 'visit' | ...
  entity_id     uuid NOT NULL,
  command       text NOT NULL,                 -- 'SignOff' | 'AdjustDose' | ...
  actor_id      uuid NOT NULL, actor_role text NOT NULL,
  before        jsonb, after jsonb,
  severity_at_action text,                     -- severity at sign-off time
  overrides     jsonb,                          -- acknowledged max-dose / allergy / fallback
  correlation_id text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION ops.deny_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON ops.audit_log
  FOR EACH ROW EXECUTE FUNCTION ops.deny_mutation();
```

### 8.3 The no-silent-failure principle

Every failure mode in §1 has a **defined visible state** and an **audit row**. There is no code path
where a clinically wrong prescription reaches paper silently: omissions become stubs, dose mismatches
become high-severity gates, formulary misses become verify-manually stubs, outages become
acknowledge-gated banners, model downgrades become badges, timeouts become degraded panels — and
each writes to `prescription_audit` / `ops.audit_log`.

---

## 9. Out-of-band safeguards (process, not code)

Mirrors the ingestion service's out-of-band layer:

- **Weekly clinician audit.** The clinical reviewer samples 10 random signed prescriptions/week and
  confirms doses, allergies, and bilingual instructions against the note. Results logged.
- **Red-team eval fixtures.** A frozen pediatric fixture set of adversarial cases — max-dose-bait,
  allergy-clash, formulary-miss, combo-drug limiting-ingredient, preterm age, missing weight, brand
  misattribution (Vitafol), Devanagari-missing, silent-omission — must all be caught. Run on every
  generation-path change (owned by `09_engineering_discipline/`).
- **Metrics & thresholds.** Edit rate, omission rate, max-dose-override rate, fallback rate, and
  "signed-but-flagged" rate are tracked; threshold breaches open investigation tickets.
- **Project guard on destructive scripts (`D20`).** Sample-data / reseed scripts refuse to run unless
  `PROJECT_REF == dev-only-ref` — prevents wiping live patient data.

---

## 10. Verification matrix (invariant → gate → evidence)

| Invariant | Enforcement layer | Machine-checkable gate |
|---|---|---|
| CS-RX-1 No finalize without human SignOff | State machine + server | transition test: non-human SignOff → 409 |
| CS-RX-2 No silent omission | Server completeness fn | 3-drug-emit-2 → stub + high |
| CS-RX-3 Line provenance | DDL NOT NULL + UI | DDL test + ai_suggested-unapproved → gate |
| CS-RX-4 Context complete/fresh | App + state machine | weight=null → no numeral |
| CS-RX-5 AI emits no numerals | Output schema + fitness rule | schema rejects `dose_mg` field |
| CS-RX-6 Server recompute, no tolerance | Layer-4 + golden parity | tampered volume → reject + high |
| CS-RX-7 Max-dose caps | Engine + server + gate | over-max → capped + ack-gated |
| CS-RX-8 Allergy clash | Server + gate | clash → print + warn + gate |
| CS-RX-9 Interactions | Server matrix | high pair → severity high |
| CS-RX-10 No memory drugs/brands | Tool + structured error | unmapped brand → generic only |
| CS-RX-11 Formulary miss = stub | Tool not-found path | non-formulary → red stub + high |
| CS-RX-12 Validated bilingual+pictogram | Engine + validator + component | no Devanagari → flag; icon-only → fail |
| CS-RX-13 Gate re-applied after edit | SignoffGate + server | high→edit→save → gate persists |
| CS-RX-14 Severity = max(server, ai) | Server reducer | AI low + breach → final high |
| CS-RX-15 Only verified data | Port query filter | pending_review lab → 0 results |
| CS-RX-16 Model config; no silent downgrade | ModelPolicyPort + fitness rule | grep `claude-` → 0; downgrade → badge |
| CS-RX-17 Immutable + tamper-evident | DDL triggers + JWS | UPDATE signed → raise; tamper → JWS fail |
| CS-RX-18 Full audit | Audit tables + bus | gen+edit+override → rows present |
| CS-RX-19 Visible degraded states | GenerationPort states | timeout → panel not spinner |
| CS-RX-20 DB substrate | DDL + RLS | mismatch FK → reject; role read → 0 rows |

---

## 11. Decision traceability

These invariants operationalize the 37 doctor-ratified decisions of `15-decisions-2026-04-28.md`:
omission (D1→CS-RX-2), addition (D2/D32→CS-RX-3), brand (D3→CS-RX-10), explicit dose (D4→CS-RX-7),
implicit dose (D5→CS-RX-5/6), fallback (D7→CS-RX-19), severity (D8→CS-RX-14), formulary-miss
(D9/D37→CS-RX-11), allergy (D10→CS-RX-8), missing weight (D11→CS-RX-4), preterm age (D12→CS-RX-4),
Hindi (D13→CS-RX-12), edit history (D14→CS-RX-17), PHI masking (D15→CS-RX-18), instrumentation
(D18→CS-RX-18), server-side counters (D19→CS-RX-20), project guard (D20→§9), auth/RLS
(D22→CS-RX-20), QR (D24/D30→CS-RX-17), allergy-state (D27→CS-RX-8), high-severity gate
(D31→CS-RX-13), loop limits (D33→CS-RX-19), model upgrade (D35→CS-RX-16), temperature 0
(D36→§5).

---

## 12. Non-negotiables (the merge-blockers)

1. The AI never emits a dose numeral that reaches paper. (CS-RX-5)
2. The server re-computes every dose with zero tolerance. (CS-RX-6)
3. No AI draft is finalized without a human `SignOff`. (CS-RX-1)
4. The sign-off gate re-applies after every edit. (CS-RX-13)
5. No drug is ever silently omitted or silently dosed. (CS-RX-2, CS-RX-11)
6. Allergy clash and max-dose breach are visible and acknowledge-gated. (CS-RX-7, CS-RX-8)
7. Signed prescriptions are immutable, append-only-versioned, and tamper-evident. (CS-RX-17)
8. Every generation and sign-off is audited; PHI is masked in logs. (CS-RX-18)
9. No `claude-*` literal in business code; clinical model downgrades are flagged. (CS-RX-16)
10. The dose engine ships with golden JS↔TS parity fixtures before it is trusted. (§4.4)

> A pull request that weakens any of these is blocked at CI (fitness rules + golden fixtures + RLS/
> DDL tests) and requires a second clinical-reviewer sign-off to even be discussed.
