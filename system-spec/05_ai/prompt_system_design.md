# Prompt System Design — The Rebuilt `core_prompt`, Pre-Embedded NABH, Cache Prefix & Governance

> **Status:** Authoritative TARGET-STATE rebuild specification for the **prompt substance** of the Generation bounded context. Build to **this**, not to the live `radhakishan_system/skill/core_prompt.md` (24 KB, "SPEED IS CRITICAL — 2 rounds" survival prose, `Male|Female|Other` patient block, free-text JSON instructions, `extractJSON`-shaped output). Where this document and the prototype disagree, this document wins; where it disagrees with a **verified Anthropic/Postgres/ABDM fact**, the author flags it rather than silently following.
>
> **Authority & subordination.** This file is a child of `00_overview/README.md` (vision, the seven invariants I1–I7), the **Target-Architecture Digest**, and — binding above all — `00_overview/canonical_decisions.md` (the lead-architect adjudications C1–C7 and the Part B `05_ai/` roster). It is the **content owner** that `02_architecture/ai_orchestration.md` (§4 tools, §4.2 pre-embed NABH, §5 caching) and `04_api/api_contracts.md` (§5 SSE, §0 "`05_ai/*` owns prompt/tool internals") delegate to. **Orchestration owns *how the loop runs*; this file owns *what the loop says* and *the exact byte layout of the cacheable prefix*.** Its siblings in `05_ai/`: `clinical_references.md` (the 11 reference files' content + the `catalog.clinical_reference` registry), `tool_contracts.md` (the 6 tools' `input_schema` + condensed output), and `worked_examples_and_golden_cases.md` (exemplars ↔ eval golden cases).
>
> **Scope of this file.** (1) The rebuilt `core_prompt.md` target structure and content outline; (2) the **pre-embedded NABH block** — its source, placement, and server-side presence assertion; (3) the **prompt-cache prefix layout** — the byte-frozen `tools → system → messages` prefix, breakpoint placement, the 4096-token Opus-4.8 minimum, and the no-UUID/timestamp/unsorted-JSON invariant; (4) the **progressive-disclosure design** the prompt drives; and (5) how prompts are **versioned and governed**. It does **not** re-derive the tool JSON-Schemas (that is `tool_contracts.md`), the reference-file bodies (`clinical_references.md`), the model/effort/streaming policy (`ai_orchestration.md §2–§6`), or the dose-engine internals (`ai_orchestration.md §4.6`).

---

## 0. The prompt system in one paragraph

The rebuilt prompt system is a **byte-frozen cacheable prefix** — `tools (sorted, deterministic) → system (the rebuilt `core_prompt.md` + the pre-embedded NABH block) → messages` — with a **single `cache_control:{type:"ephemeral"}` breakpoint on the last system block**, behind which *nothing volatile ever appears* (no `Date.now()`, no UUID, no `patient_id`, no unsorted `JSON.stringify`, no conditional sections). The system prompt is rebuilt from the prototype's 933-line skill into a **lean, declarative core** (~250 lines) that states *role, the progressive-disclosure protocol, the arithmetic-abstinence rule, the de-identified-context contract, and a pointer to the structured-output schema* — and **deletes** the prototype's prose that the architecture now enforces structurally: the "SPEED IS CRITICAL / 2-rounds" latency coaching (the off-edge worker absorbs latency — `ai_orchestration §1`), the inline 200-line JSON-shape dictation (replaced by `output_config.format` + Ajv on `prescription.v1.json` — `ai_orchestration §4.4`), and every "round UP / round to 0.5 ml" arithmetic instruction (the model **never computes a number** — it calls `compute_doses`, which delegates to the TS `DoseEnginePort`, the C5 runtime authority). The NABH 20-section compliance block is **concatenated into the cached prefix** so Claude never spends a tool round fetching it, and its presence is **server-asserted** on every emitted draft (a missing block is a hard-block never-event, not a prompt nicety — `09 clinical_risk_management`). Progressive disclosure is preserved verbatim in spirit — Claude pulls only the clinical knowledge it needs via the 6 tools behind `ClinicalKnowledgePort` — but the prompt is tuned for **Opus 4.8's tool-conservatism** with prescriptive "Call this when…" descriptions and a search-first nudge. Every prompt artifact is **content-hashed, versioned in `catalog.clinical_reference`/a `prompt_manifest`, six-eye-reviewed for clinical edits, and a version bump is a cache-bust** — so a prompt change is a governed, auditable, eval-gated event, never an unversioned Storage overwrite.

---

## 1. Why the prompt is being rebuilt (the load-bearing flaws in the current `core_prompt.md`)

The prototype `core_prompt.md` is **clinically validated** (37 doctor-ratified decisions are baked into its rules) but **structurally entangled** with three concerns the target architecture moves out of the prompt entirely. Keeping them in the prompt is what makes it brittle, expensive, and unsafe-by-omission.

| Prototype prompt symptom (`radhakishan_system/skill/core_prompt.md`) | Why it is a flaw | Target-state relocation |
|---|---|---|
| **"SPEED IS CRITICAL. Aim for 2 rounds."** + "Round 1 = ALL tool calls, Round 2 = generate JSON" (lines 18–44) | Latency coaching baked into the prompt — a survival hack for the 150 s edge wall. It trades correctness for round-count and pollutes the cacheable prefix with a non-clinical concern. | **Deleted.** The off-edge worker absorbs latency (`ai_orchestration §1`); speculative + streaming make round-count a non-issue. The prompt keeps only the *clinical* batching guidance ("fetch protocol+formulary before composing"), not a speed ultimatum. |
| **~145 lines of inline JSON-shape dictation** (lines 55–203) — every field name, type, nullability spelled out in prose | The output contract lives in prose the model may drift from; there is no machine validation; field renames require a prompt edit; it inflates the prefix by ~3–4K tokens. | **Replaced** by `output_config.format = {type:"json_schema", schema: prescription.v1.json}` on the final turn + **Ajv validation** (`ai_orchestration §4.4`). The prompt references the schema by name; it does **not** restate it. |
| **Arithmetic instructions** — "Round UP to nearest 0.5 ml for syrups", "15mg/kg × 7.2kg = 108mg ÷ …", "NEVER reduce a calculated dose" (lines 107, 337–351) | The model is being asked to do mental math — the exact **AI-mental-math dosing risk** (I2, memory `project_dose_engine_is_source_of_truth.md`). Any number the model emits that reaches paper is unsafe. | **Deleted from the model's job.** The model proposes drug + formulation + regimen + band selection with **no numeric mg/ml/drops fields**; `compute_doses` (TS `DoseEnginePort`, C5) computes every number; the model copies engine output verbatim (`ai_orchestration §4.6`). The prompt's dosing section becomes "**you never compute a dose — call `compute_doses`**". |
| **`"sex": "Male\|Female\|Other"`** in the patient block (line 67) | Title-case, and it leaks PII-shaped presentation into the model context. Conflicts with the canonical de-identified form. | Per **C2**: the model sees the **de-identified `'M'\|'F'`** form only (`DeidentifiedPatientContext`); `'O'`/unknown maps to omission of any sex-specific branch (none exists in pediatric dosing). No patient *name*/UHID ever enters the prefix. |
| **`"overall_status": "SAFE\|REVIEW REQUIRED"`** (line 194) and prose "set overall_status to REVIEW REQUIRED" | Space-form `REVIEW REQUIRED` as a *wire/stored* value contradicts the DB CHECK and the API enum. | Per **C3**: the machine value is **`REVIEW_REQUIRED`** (UPPER_SNAKE) everywhere stored/wire; the words "Review required" are display-only. The schema (`prescription.v1.json`) pins the enum; the prompt does not re-spell it. |
| **"DO NOT call `get_reference("nabh_compliance")` — it is already embedded"** (line 43) | Correct intent (pre-embed NABH) but stated as a fragile prose negation that the model can ignore; there is no server enforcement that the block was actually present. | **Formalized** (§3): NABH is concatenated into the frozen prefix; the tool surface **does not expose** `nabh_compliance` as a fetchable name; the server **asserts** the 20-section block's presence on every draft (§3.3). |
| **"Output ONLY raw JSON — no markdown fences, no preamble"** (lines 41, 366) → consumed by `extractJSON()` regex | Prompt-enforced JSON discipline is unreliable; the prototype slices `{…}` out of free text — a silent-malformed-draft surface. | **Retired** by structured outputs (`ai_orchestration §4.4`). The prompt no longer pleads for clean JSON; the API *guarantees* it. |
| **"3-Row Medicine Format"** prose (lines 276–289) — the model writes R2 English + R3 Devanagari | The bilingual rows are a *render* of the dose computation; having the model author them invites a Devanagari/number mismatch. | The **engine** rebuilds R2/R3 + R4 pictogram (`DoseEnginePort` output `enD`/`hiD`/`pictogram`, C5/`tool_contracts §B.2`); the model copies them. The prompt explains the *format* for the model's narrative fields only (counselling, warning signs), not for dosing rows. |

> **The principle:** the prompt should carry **only what cannot be enforced structurally** — clinical role, the disclosure protocol, the arithmetic-abstinence contract, and narrative style. Everything the schema, the engine, the state machine, or the server re-check can guarantee is **moved out of the prompt and into code**, where it is testable and unbypassable. This is the same "answer from data, not prose" axiom the whole rebuild rests on, applied to the prompt itself.

---

## 2. The rebuilt `core_prompt.md` — target structure & content outline

The rebuilt core prompt is a **single Storage object** (`website/skill/core_prompt.md`, resolved through `StoragePort`, content-hashed and versioned — §6) loaded once per worker boot and frozen into the cacheable prefix (§4). It is **declarative and lean** (~250 lines target, down from 933 in the full skill / ~370 in the prototype core), because the schema, engine, and server re-check now carry the load the prose used to.

### 2.1 Section roster (the target table of contents)

| # | Section | Purpose | What it deliberately does **not** contain |
|---|---------|---------|-------------------------------------------|
| **§A** | **Role & boundary** | Who the assistant is (clinical prescription assistant for Radhakishan Hospital; assists, does not diagnose; the doctor states the diagnosis); **every output is a `pending_review` DRAFT** (I3). | Any claim of autonomy; any "you may finalize" language. |
| **§B** | **The arithmetic-abstinence contract** *(net-new, load-bearing)* | One unambiguous rule: **"You never compute a dose, volume, or drop count. When `medicines[]` is non-empty you MUST call `compute_doses`; copy its output verbatim; emit no numeric mg/ml/drops field yourself."** (I2, C5.) | Any `mg/kg × weight` worked examples; any rounding rule (0.5 ml / 0.1 ml / ¼ tab now live in the engine). |
| **§C** | **The progressive-disclosure protocol** | *When* to call each of the 6 tools (the search-first decision tree, §5 of this file). ICD-10-first protocol lookup; fetch formulary + protocol before composing; batch independent tools in one round. | Round-count ultimatums ("2 rounds"); speed coaching. The clinical batching guidance stays; the latency framing goes. |
| **§D** | **The de-identified context contract** | What the model will receive: a `DeidentifiedPatientContext` (`sex:'M'\|'F'`, `ageDays`, `weightKg`, `correctedAgeDays?`, `gaWeeks?`, `egfr?`, allergies as generic tokens) + the doctor's clinical note. **No name, no UHID, no DOB, no guardian.** (C2, I6, SEC-3.) | Any instruction to read/emit a patient name or UHID; any `patient.uhid` field (the prototype's line 63/265 is removed — identifiers are re-attached server-side after generation). |
| **§E** | **Standard-protocol usage policy** | The doctor-ratified rules for *how* to apply a fetched protocol: "standard prescription" → all first-line drugs; named drugs → exactly those; diagnosis only → protocol first-line as default; **never omit anything the doctor says** (non-pharmacological → `non_pharmacological[]` + `counselling[]`). | (Unchanged in clinical substance from the prototype §"STANDARD PROTOCOL USAGE" — this is validated clinical policy, ported verbatim.) |
| **§F** | **Output contract pointer** | "Your final turn returns JSON conforming to `prescription.v1.json` (enforced by `output_config.format` + server Ajv). Field semantics for the **narrative** fields (`chief_complaints`, `clinical_history`, `examination`, `counselling[]`, `warning_signs[]`, `non_pharmacological[]`, `doctor_notes`) are below; dosing rows are engine-authored." | The ~145-line inline JSON dump. The schema is the contract; the prompt points to it. |
| **§G** | **Narrative & bilingual style rules** | How to write the *model-authored* fields: bilingual policy (`LANGUAGE:` Hindi/English/Bilingual), spoken-Hindi Devanagari rules, 6–8 bilingual warning signs (4 universal + 2–4 diagnosis-specific), colour-coding semantics (blue=meds, red=investigations, black=else — as *intent the renderer applies*, not inline styling). | The 3-row *dosing* format (engine-owned); any instruction to author R2/R3 dose strings. |
| **§H** | **Safety-narration policy** | The model *narrates* safety findings into `safety` (allergy note, cross-reaction table awareness, interaction notes, the **doctor-override rule**: an explicitly named drug is always included + flagged, `overall_status:"REVIEW_REQUIRED"`). The **authoritative** allergy/max-dose/interaction gate is the **server re-check**, not the prompt. | Max-dose arithmetic ("cap at max" math); the model flags, the engine + server enforce. `overall_status` value is `REVIEW_REQUIRED` (C3), never the space form. |
| **§I** | **The NABH compliance contract** | "The NABH 20-section block is already provided to you above (§NABH, pre-embedded). Populate every mandatory section; **do not** call a tool to fetch NABH." Presence is **server-asserted** (§3.3). | A `get_reference("nabh_compliance")` invitation — that tool name is not exposed. |
| **§NABH** | **The pre-embedded NABH block** *(concatenated, §3)* | The 20 mandatory sections, verbatim, inside the frozen prefix. | (It is data, not instruction — see §3.) |
| **§J** | **Doctor authentication block** | Dr. Lokender Goyal's credentials + hospital contact, for the model to place in `doctor_notes`/auth fields. **Sourced from config**, not hardcoded prose drift (HPR/registration ids live in `doctors`/config). | Hardcoded secrets; any value that should be config (the *fact* it is config-sourced is noted; the literal credentials may appear as they are public professional identifiers, not secrets). |

### 2.2 The "13 Critical Rules", re-homed

The prototype ends with **13 non-negotiable rules** (lines 353–367). In the rebuild, each rule is classified by *where it is now enforced* — the prompt keeps a rule **only** if the model is the right enforcer; otherwise it moves to code and the prompt either drops it or states it as a fact, not a plea.

| Prototype Rule | Rebuilt home | Enforcement |
|---|---|---|
| 1. Never exceed max dose | **Engine + server re-check** | `DoseEnginePort` caps (`capped:true`); server byte-for-byte re-check (I2). Prompt: stated as a fact, not asked of the model. |
| 2. Generic names in CAPS | **Schema + engine row1** | `prescription.v1.json` + `row1_en` engine-built. |
| 3. Hindi Row 3 for every medicine | **Engine (`hiD`)** | Engine output; not model-authored. |
| 4. Check allergy/cross-reaction/interaction | **Prompt (narrate) + server (enforce)** | Model narrates into `safety`; server is authoritative. §H. |
| 5. Preterm corrected age for growth/dev | **Pre-engine compute** | Computed before the prompt; model receives the number (C2/`ai_orchestration §4.6`). |
| 6. Preterm chronological age for vaccination | **Pre-engine compute** | Same. |
| 7. Show dose calc working | **Engine (`calc`)** | Engine `calc` string; not model math. |
| 8. ICD-10 for every diagnosis | **Prompt + schema** | Model emits ICD-10; schema requires it. §C/§F. |
| 9. Bilingual emergency warning signs | **Prompt (narrative) + schema** | Model-authored; schema requires `hi`+`en`. §G. |
| 10. Doctor auth block | **Prompt + config** | §J. |
| 11. Output is a DRAFT | **State machine (I3) + prompt** | `pending_review` until human `SignOff`; prompt restates as boundary. §A. |
| 12. Raw JSON only | **`output_config.format`** | Structurally guaranteed; prompt no longer pleads. |
| 13. Round to measurable amounts | **Engine** | `roundToUnit` in `DoseEnginePort`. Removed from prompt. |

> **Net effect:** of 13 prototype rules, **7 move to code** (1,2,3,5,6,7,13), **2 become schema constraints** (8,9,12-as-format), and **4 stay as genuinely model-side narrative/judgment rules** (4-narrate, 8-emit, 10, 11). The prompt is shorter *and* the guarantees are stronger, because the load-bearing ones are now unbypassable.

### 2.3 Token-budget target for the core prompt

The rebuilt core prompt + pre-embedded NABH is the bulk of the cached prefix. Target the prefix to **~6–10K tokens** (`ai_orchestration §5.2`), comfortably above the **4096-token Opus-4.8 cacheable minimum** (§4) and cheap after the first call (cache-read ≈ 0.1×). Deleting the inline JSON dump (~3–4K tokens) and the arithmetic prose is what *funds* keeping the prefix lean while still pre-embedding NABH.

---

## 3. The pre-embedded NABH block

### 3.1 What it is and why it is embedded

The NABH compliance reference (`radhakishan_system/skill/references/nabh_compliance.md` — the **20 mandatory sections**: hospital header, patient name, UHID, age/sex/weight, date/time, guardian, diagnosis+ICD-10, medicines, dose calcs shown, allergy status, interaction check, max-dose verification, bilingual warning signs, follow-up, doctor name/degree/reg-no, signature placeholder, emergency contacts, QR data, NABH strip, AI-draft disclaimer) is **mandatory on every prescription** (CLAUDE.md domain rule; `01_product/clinical_safety.md §504`). Because it is required on **every** generation, fetching it via `get_reference` would burn a tool round on every single call and add latency for zero variability. The prototype already pre-embeds it (line 43); the rebuild **formalizes** that as a byte-frozen, server-asserted contract.

### 3.2 Placement — inside the cached prefix, last in the system block

```
┌─ CACHEABLE PREFIX (frozen; cache_control:{type:"ephemeral"} on the LAST block) ─┐
│  tools[]            (6 tools, sorted by name, deterministic JSON — §4.2)         │
│  system[0]          core_prompt.md  (§2 rebuilt body)                            │
│  system[1]          ── §NABH: the 20-section NABH block (verbatim) ──   ◄────────┼─ breakpoint here
└──────────────────────────────────────────────────────────────────────────────────┘
   messages[]         de-identified context + doctor note + tool_result (volatile, §4.3)
```

- The NABH block is the **last system block**, so the single `cache_control:{type:"ephemeral"}` breakpoint sits on it and the entire `tools → system(core + NABH)` prefix is one cache entry.
- It is **concatenated at worker boot** (not per-request), from the `clinical_reference` registry entry `name='nabh_compliance'` (versioned, content-hashed — §6 / `clinical_references.md`). A NABH version bump cache-busts the prefix exactly like any other prefix change (§4.4).
- The NABH block is **data, not a fetchable tool name**: `get_reference`'s registry **does not expose** `nabh_compliance` (the model cannot waste a round fetching what it already has — replaces the prototype's fragile "DO NOT call…" prose with an *absence of the affordance*).

### 3.3 The server-side NABH presence assertion (the real enforcement)

Pre-embedding makes NABH *available*; it does not make it *present in the output*. The guarantee lives in the **server**, not the prompt:

- After the final draft is produced, the worker asserts that **all 20 mandatory sections** are populated in the prescription JSON (a structural check against `prescription.v1.json`'s required NABH fields + a content presence check for the strip/disclaimer/auth lines).
- A **missing NABH block / section is a HARD-BLOCK never-event** (`09 clinical_risk_management.md §D.3`: "NABH block missing → `on_hit: hard_fail`"), surfaced as `GenerationFailed{reason: nabh_incomplete}` and an audit `warnings[]` entry — **never** a silently non-compliant draft reaching review.
- This is the same asymmetry the whole system rests on: a wrong **font weight** warns; a missing **NABH section** hard-blocks.

---

## 4. The prompt-cache prefix layout

> **Render order is `tools → system → messages`; caching is a strict prefix match — any byte change before the breakpoint invalidates the entire cache entry.** (`ai_orchestration §5.1`; `glossary` "Prompt caching"; verified Anthropic prompt-caching behavior, `claude-api` skill.)

### 4.1 The byte contract (what is frozen, what is volatile)

| Region | Contents | Mutability | Rule |
|---|---|---|---|
| **`tools[]`** | The 6 tool definitions (`get_standard_rx`, `get_formulary`, `get_previous_rx`, `get_lab_history`, `get_reference`, `compute_doses` — full schemas in `tool_contracts.md`). | **Frozen.** | Serialized in a **stable, name-sorted order** with **deterministic key order** (a canonical JSON serializer, never bare `JSON.stringify` of an unordered object). A reordered tool array silently invalidates the cache. |
| **`system[0]`** | The rebuilt `core_prompt.md` body (§2). | **Frozen.** | Loaded once at boot; same bytes every call. |
| **`system[1]`** | The pre-embedded NABH block (§3). | **Frozen.** | Concatenated at boot; carries the `cache_control:{type:"ephemeral"}` breakpoint. |
| **— breakpoint —** | (after `system[1]`) | — | The **only** `cache_control` marker. |
| **`messages[]`** | `DeidentifiedPatientContext` (de-id, C2), the doctor's clinical note, the `INCLUDE THESE SECTIONS` / `LANGUAGE:` directives, and **all** `tool_result` blocks. | **Volatile.** | Everything that varies per visit lives here, **after** the breakpoint, so it never invalidates the prefix. |

### 4.2 The "no silent invalidators in the prefix" invariant (CI-checked)

Nothing that varies per request may appear before the breakpoint. **Forbidden in the prefix:**

- `Date.now()` / any timestamp / "today's date" interpolation.
- Any UUID, `patient_id`, `visit_id`, `job_id`, `correlation_id`, or per-request id.
- Patient name, UHID, DOB, guardian (also a PII violation, I6/C2 — the model never sees these anyway).
- Unsorted `JSON.stringify` of tools or any object whose key order is not pinned.
- Any conditional/branching system section ("if neonatal, add…") — variability goes into `messages[]`, never into the system block.

> **The same rule, two reasons.** A `patient_id` in the prefix is *both* a cache invalidator (defeats the ~10× cost win) *and* a PII leak (I6). The no-identifier-in-prefix rule is therefore enforced twice — by the caching audit (below) and by the PII boundary (`06_security §3.2`). They reinforce; neither is redundant.

### 4.3 Volatile content placement (the de-identified message)

The first user message carries the de-identified context and note **as plain content after the breakpoint**:

```
messages: [
  { role: "user", content:
      "PATIENT CONTEXT (de-identified): sex=F, ageDays=243, weightKg=7.2, gaWeeks=null, egfr=null, allergies=[PENICILLIN]\n" +
      "INCLUDE THESE SECTIONS: medicines, investigations, counselling, warning_signs\n" +
      "LANGUAGE: Bilingual\n\n" +
      "CLINICAL NOTE:\n<the doctor's note, verbatim>" }
  // ... assistant tool_use, then a SINGLE user message with ALL tool_result blocks (§5.3)
]
```

No identifier, no timestamp; identifiers are **re-attached server-side** after generation (`non_goals §175`). The note may contain PII only as the doctor typed it; the system adds none.

### 4.4 Cache lifecycle — pre-warm, TTL, version-bump bust

- **Pre-warm on worker boot:** a `max_tokens: 0` request that writes the cache entry on the system-prompt block (not on a placeholder user turn). Re-warm on an interval **only** if traffic gaps exceed the ~5-minute ephemeral TTL (`ai_orchestration §5.1`).
- **Version bump = deliberate cache bust:** any change to `core_prompt.md`, the NABH block, a tool schema, or tool order produces a new prefix hash → a new cache entry. This is correct and intended; the governance flow (§6) ties a prefix change to a version bump, a content-hash, and an eval re-run.
- **Cache-bust is the *only* sanctioned way the prefix changes.** There is no per-request mutation of the prefix; a "small tweak" to the system prompt is a versioned release, not an edit.

### 4.5 The caching audit (the silent-invalidator alarm — CI-checked)

The biggest risk is a prefix change *no one intended* (a stray timestamp, a reordered tool) silently dropping the cache and 10×-ing cost without any functional symptom. The guard:

- **Per-call assertion:** `usage.cache_read_input_tokens` must be **non-zero** on every generation after the first identical-prefix call. Recorded to `prescription_audit.cache_read_input_tokens` (the column exists — `schema_design §777`, `clinical_safety §587`) and surfaced on the metrics dashboard (`infrastructure_cicd §423`: "must be non-zero — prompt-cache health").
- **The north-star target:** prompt-cache read hit **> 0 tokens on ≥ 90% of generation calls** (`north_star §257`).
- **CI assertion (the canonical-decisions Part B contract):** a test fires two identical-prefix generations against a recorded/replayed cassette and asserts `cache_read_input_tokens != 0` on the second. A regression (a silent invalidator reintroduced into the prefix) **fails CI** — owned as a quality gate (`09 quality_gates_ci.md`), referenced by `ai_orchestration §10` acceptance criterion 4.
- **Runtime alarm:** a zero-read rate above a threshold in prod raises an alert (`generation_events` / dashboard), because it means a silent invalidator shipped past CI.

### 4.6 Verified API-surface facts the prefix design depends on (do not regress)

From the `claude-api` skill (Opus 4.8, verified 2026-06; mirrors `ai_orchestration §2.3`):

- **Minimum cacheable prefix on Opus 4.8 = 4096 tokens.** The rebuilt core + NABH (~6–10K) clears this comfortably; if a future trim drops the prefix below 4096, caching silently stops — a CI token-count assertion on the assembled prefix guards the floor.
- **`cache_control:{type:"ephemeral"}`** marks the breakpoint; place it on the **last** frozen block. Up to 4 breakpoints are allowed but **one** suffices here (the whole `tools→system` is one frozen unit).
- **Streaming is mandatory** for the `max_tokens ≥ 16000` generation calls (the SDK refuses non-streaming above ~16K) — caching and streaming compose cleanly; the cache read happens on the streamed request's prefill.
- **No assistant prefill** on Opus 4.6+/Fable 5 — the prefix never includes a primed assistant turn; output is constrained by `output_config.format` (§2 §F), not a prefill.

---

## 5. Progressive-disclosure design (what the prompt drives)

Progressive disclosure is the **proven core** of this system: the prompt does not embed all clinical knowledge; instead Claude **pulls only the knowledge a given case needs** via tools behind `ClinicalKnowledgePort`. The rebuild keeps the design and **tunes the prompt for Opus 4.8's tool-conservatism**.

### 5.1 The 6 tools the prompt orchestrates

The contracts (input_schema + condensed output) are frozen in `tool_contracts.md §B.2`; the prompt's job is to teach the model **when** to call each.

| Tool | Prompt-side "call when…" guidance (prescriptive — §5.3) | Backing port |
|---|---|---|
| `get_standard_rx` | "Whenever a diagnosis or ICD-10 appears in the note — **ICD-10 first**, diagnosis-name fallback. Always, before composing." | `DatabasePort` |
| `get_formulary` | "For every drug named in the note, and for the protocol's first-line drugs you intend to include — **batch all drug names in one call**." | `DatabasePort` |
| `get_previous_rx` | "When the doctor says 'continue same', 'repeat last', or 'modify previous'." | `DatabasePort` (PII-stripped `PreviousRxView`) |
| `get_lab_history` | "When the note references a previous lab value or drug monitoring." | `DatabasePort` |
| `get_reference` | "For the specific clinical topic the case needs — e.g. `neonatal` if GA<37wk / age<28d / BW<2.5kg; `vaccination_iap2024` **or** `vaccination_nhm_uip` per the schedule directive; `dosing_methods` only for BSA/GFR/infusion/age-tier. **`nabh_compliance` is NOT a valid name — it is pre-embedded.**" | `StoragePort` (registry-resolved, §6) |
| `compute_doses` | "**Mandatory** when `medicines[]` is non-empty. You propose drug + formulation + method + band + frequency; the engine returns every number. You never compute a dose." | `DoseEnginePort` (TS, C5) |

### 5.2 The disclosure decision tree (the prompt's §C content, distilled)

```
Read the de-identified note
   │
   ├─ diagnosis / ICD-10 present? ──► get_standard_rx(icd10 first)        [always, before composing]
   ├─ drugs named OR protocol first-line known? ──► get_formulary([...])  [batch one call]
   ├─ "continue/repeat/modify previous"? ──────────► get_previous_rx
   ├─ prior lab / monitoring referenced? ──────────► get_lab_history
   ├─ topic-specific need (neonatal / vax sched / BSA-GFR)? ─► get_reference(name)
   │
   ▼  (all independent fetches issued in ONE round — §5.3)
   compose draft (drug + regimen + band, NO numbers)
   │
   └─ medicines[] non-empty? ──► compute_doses(...)   [MANDATORY] ──► copy engine output verbatim
   │
   ▼
   final turn: emit prescription.v1.json  (output_config.format enforced)
```

### 5.3 Opus 4.8 tool-triggering tuning (prompt-side counters to under-calling)

Opus 4.8 is **conservative about reaching for tools** by default (`ai_orchestration §4.5`). The prompt counters this where clinical safety depends on a fetch:

- **Prescriptive tool descriptions:** every tool's `description` (in `tool_contracts.md`) states *when* to call it ("Call `get_standard_rx` whenever a diagnosis or ICD-10 code appears…"), not just what it does — verified to lift should-call rate on 4.8.
- **Search-first nudge** in `core_prompt §C`: "When a drug or diagnosis is named, fetch formulary and protocol **before** composing — do not dose from memory."
- **Mandatory `compute_doses`**: stated in §B *and* server-asserted (`tools_called` must include `compute_doses` when `medicines[]` is non-empty) — the prompt's instruction is backed by a hard gate, not trust.
- **Single `tool_result` message:** the prompt + the worker keep all parallel `tool_result` blocks in **one** user message (never split) — splitting trains the model to stop making parallel calls (`ai_orchestration §4.3`, `canonical_decisions B.2`).

### 5.4 What progressive disclosure deliberately keeps *out* of the prompt

The whole point: the 11 reference files (`clinical_references.md`), the 530-drug formulary, the 446 protocols, and the previous-Rx/lab history are **never in the prefix**. They are fetched on demand, **condensed** (token-stripped — `condenseDrugForAI()` strips ~77–83% of formulary tokens; `PreviousRxView` carries no PII), and returned **after** the breakpoint. This is what keeps the prefix at ~6–10K tokens while the system has access to a large clinical knowledge base.

---

## 6. Prompt versioning & governance

A prompt change is a **clinical-software change**, not a content edit. The current workflow ("upload to Supabase Storage `website/skill/` prefix") is an **unversioned, unreviewed, unaudited overwrite** — exactly the class of change that, ungoverned, can silently alter clinical behavior. The rebuild governs every prompt artifact.

### 6.1 The versioned artifact registry

Every prompt artifact — `core_prompt.md`, the NABH block, each of the 11 reference files, the tool descriptions, the worked-example exemplars — is a **row in `catalog.clinical_reference`** (authored by `clinical_references.md`): `name → Storage key → content_hash → version`. The prefix-level artifacts (`core_prompt`, `nabh_compliance`, and the frozen tool set) additionally roll up into a **`prompt_manifest`** record carrying the **prefix content-hash** that the cache key derives from.

| Field | Meaning |
|---|---|
| `name` | Stable registry name (`core_prompt`, `nabh_compliance`, `neonatal_dosing`, …). |
| `storage_key` | The Storage object the `StoragePort` resolves (`website/skill/…`). |
| `content_hash` | SHA-256 of the bytes — the cache-bust trigger (§4.4) and the audit anchor. |
| `version` | Monotonic; a bump is a release event. |
| `reviewed_by` / `approved_at` | Six-eye sign-off provenance (§6.3). |

### 6.2 How a prompt change flows (the governed pipeline)

```
1. Author edits core_prompt.md / NABH / a reference / a tool description on a branch.
2. content_hash recomputed → version bumped in catalog.clinical_reference / prompt_manifest.
3. The change is a code-review PR (the .md lives in the repo, not only in Storage) — diffable, blamed, reverted like code.
4. Clinical edits require SIX-EYE review (clinician-as-oracle sign-off — §6.3).
5. CI runs the eval gate against the NEW prefix:
     - golden generation eval over the frozen pediatric fixture set (no regression on safety metrics);
     - caching audit re-asserts cache_read_input_tokens != 0 with the new prefix;
     - prefix token-count >= 4096 floor (§4.6);
     - no-silent-invalidator scan (§4.2) over the assembled prefix.
6. On green + sign-off → merge → Storage object replaced → cache busts → workers re-warm (§4.4).
7. The version + content_hash is recorded on every subsequent generation's audit row (provenance).
```

### 6.3 Six-eye review for clinical prompt edits

Per `canonical_decisions` Part B / `09 agent_threat_model.md`: edits to clinical substance (the NABH block, dosing-relevant reference files, the standard-protocol-usage policy, safety-narration policy) require **six-eye review** — author + an independent reviewer + the **clinician-as-oracle** sign-off. This is also a **data-poisoning control**: a malicious or erroneous edit to a reference file or the core prompt is an injection surface (`agent_threat_model.md`), so the reviewer and author must not be the same actor, and (for AI-assisted edits) the reviewing model must not be the authoring model.

### 6.4 Provenance on every generation (the audit tie-back)

Every generation records, in `prescription_audit` / `generation_events` (`ai_orchestration §7`), the **prompt version + content-hash actually used** alongside the model id+version. This makes "which prompt produced this prescription?" answerable for any historical Rx — a NABH traceability requirement and the precondition for safely rolling a prompt change back if an eval regression is found post-merge.

### 6.5 Worked examples as prompt exemplars *and* eval golden cases

The worked examples (Arjun AOM, etc. — `worked_examples_and_golden_cases.md`) serve double duty: a **prompt exemplar** (referenced, not inlined, to keep the prefix lean — the prototype's "DO NOT call `get_reference("worked_example")` unless unsure" becomes a registry name the model may fetch *on demand*, never a prefix cost) **and** an **eval golden case** (`evals/golden/cases/*.case.json`). The bijection is the governance link: a prompt change that breaks an exemplar's expected output is caught by the golden eval in §6.2 step 5 — `split:train` examples drive prompt iteration, `split:test` examples gate the merge (the model is never tuned on test).

---

## 7. Conformance to the canonical decisions (the ledger this file satisfies)

| Decision | How this file conforms |
|---|---|
| **C2 (sex / de-id)** | The model sees `DeidentifiedPatientContext.sex:'M'\|'F'` only; the prototype's `Male\|Female\|Other` patient block and `patient.uhid` field are removed from the prompt (§1, §2 §D, §4.3). No identifier in the prefix. |
| **C3 (`overall_status`)** | The prompt and schema use **`REVIEW_REQUIRED`** (UPPER_SNAKE); the space form is display-only (§1, §2 §H). |
| **C5 (dose engine)** | The prompt's **arithmetic-abstinence contract** (§2 §B) routes every number through `compute_doses` → the TS `DoseEnginePort` (runtime authority); no rounding/math prose survives (§1, §2.2). |
| **C6 (consent)** | Generation is consent-gated at the `RequestGeneration` command boundary before the prompt is ever assembled (`canonical_decisions C6`); this file assumes an active `ai_assisted_rx` consent as a precondition and does not re-implement the gate. |
| **Part B (`05_ai/` roster)** | This file is `prompt_system_design.md`; it owns the rebuilt `core_prompt` structure, the pre-embedded NABH block, and the cache-prefix byte contract + the `cache_read_input_tokens != 0` CI assertion. It defers tool schemas to `tool_contracts.md`, reference bodies to `clinical_references.md`, and exemplars to `worked_examples_and_golden_cases.md`. |
| **Invariants** | I2 (engine-only arithmetic — §2 §B), I6 (no PII to model — §4.2/§4.3), I5 (model id behind `ModelPolicyPort`, never in the prompt — §0), I3 (every output a `pending_review` draft — §2 §A). |

---

## 8. Acceptance criteria (eval-gated; the discipline suite owns the runner)

This file's substance is gated by `09_engineering_discipline/`. The criteria it must satisfy:

1. **Prefix freeze test** — the assembled `tools → system(core + NABH)` prefix is byte-identical across two builds from the same artifact versions; a diff fails CI.
2. **No-silent-invalidator scan** — the prefix contains no timestamp/UUID/identifier/unsorted-JSON (§4.2); a regression fails CI.
3. **Caching audit** — `cache_read_input_tokens != 0` on the second identical-prefix call; ≥ 90% read-hit in prod (§4.5). Release-blocking on regression.
4. **Prefix token floor** — assembled prefix ≥ 4096 tokens (§4.6); falling below fails CI (caching would silently stop).
5. **NABH presence assertion** — every generated draft has all 20 NABH sections; a missing section hard-blocks as a never-event (§3.3).
6. **Arithmetic-abstinence** — no generation emits a model-authored numeric mg/ml/drops field; `compute_doses` is called whenever `medicines[]` is non-empty (server-asserted, §5.3).
7. **Governance gate** — a prompt change cannot merge without a version bump, content-hash, six-eye sign-off for clinical edits, and a green golden-eval run on the new prefix (§6.2).

---

### Provenance (files read to author this spec)

- `00_overview/canonical_decisions.md` — C2, C3, C5, C6, Part B (`05_ai/` roster), the conformance ledger. **Binding.**
- `00_overview/README.md` — vision, invariants I1–I7, the spec index (`04_ai`/`05_ai` family).
- `00_overview/north_star.md §257` — prompt-cache read-hit target (> 0 tokens, ≥ 90% of calls).
- `00_overview/glossary.md` — "Prompt caching" canonical definition (render order, breakpoint, no timestamps/UUIDs, pre-warm, 4096 min, audit).
- `00_overview/non_goals.md §175` — identifiers stay server-side; none in the cacheable prefix.
- `02_architecture/ai_orchestration.md` — §2 model policy & verified API facts, §4 tools + pre-embed NABH (§4.2) + dose separation (§4.6), §5 caching & budgets, §7 observability/audit, §10 acceptance.
- `02_architecture/backend_services.md §362–366` — the `tools→system→messages` / ephemeral-breakpoint / 4096-min / pre-warm / `cache_read_input_tokens != 0` restatement.
- `04_api/api_contracts.md` — §0 ("`05_ai/*` owns prompt/tool internals"), §5 SSE, the de-identified-over-the-wire principle (A7).
- `01_product/clinical_safety.md §504, §587` — NABH pre-embedded + presence assertion; `cache_read_input_tokens` audit column.
- `03_data/schema_design.md §777` — `prescription_audit.cache_read_input_tokens` column.
- `07_deployment/infrastructure_cicd.md §255, §423, §442` — readiness probe + metrics for cache health.
- **The prototype prompt being rebuilt:** `radhakishan_system/skill/core_prompt.md` (the symptoms in §1), `references/nabh_compliance.md` (the 20-section block, §3).
- Authority for model/API facts: the `claude-api` skill (Opus 4.8 prompt-caching prefix rules, 4096 min, adaptive-thinking-only, no-prefill, streaming-mandatory > ~16K) — verified this session, 2026-06.
