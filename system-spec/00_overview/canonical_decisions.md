# Canonical Decisions — Cross-File Inconsistency Resolutions

> **Status:** BINDING. This file is the lead-architect adjudication of the cross-file
> inconsistencies surfaced by the two authoring runs. Each decision below is the **single
> canonical form**; every downstream author MUST apply it verbatim and treat any prior
> divergent wording in a spoke as a defect to be corrected to match this file.
>
> **Authority.** This file is a child of `00_overview/README.md §7` (canonical decisions)
> and the Target-Architecture Digest. Where a spoke (`02_architecture/*`, `03_data/*`,
> `04_api/*`, `05_ai/*`, `06_security/*`, `07_deployment/*`, `09_engineering_discipline/*`)
> disagrees with this file, **this file wins** until amended by an [ADR](README.md#9-change-management-adrs).
> Where this file disagrees with a **verified Postgres/Anthropic/ABDM fact**, the author
> flags it rather than silently following.
>
> **How to read it.** Part A pins the eight cross-file value conflicts (one canonical form +
> rationale + the exact edits each affected file must carry). Part B authors the new `05_ai/`
> layer's responsibilities and file roster. Part C defines the dose-engine golden-parity gate
> as the load-bearing JS↔TS sync contract. Part D rosters the six missing discipline files and
> folds the previously-unowned eval/CI gates into their owners. Part E is a one-screen
> conformance ledger for the synthesis step.
>
> **Naming note (numbering drift).** Two numbering schemes coexist on disk: the README's
> `01_frontend … 09_engineering_discipline`, and the as-built directory names
> (`02_architecture`, `03_data`, `04_api`, `05_integration`, `06_security`, `07_deployment`,
> `08_migration`). This file references the **on-disk directory names** and notes the README
> alias where it helps. The new AI layer is authored as **`05_ai/`** (the path 6+ files already
> reference); §D.0 records the directory-vs-README number reconciliation so it is not itself a
> new inconsistency.

---

## Part A — The eight cross-file inconsistencies, made canonical

Each row of the master table is then expanded with rationale and the concrete edits.

| # | Concern | Canonical form (one, everywhere) |
|---|---------|----------------------------------|
| **C1** | UHID grammar | Format `RKH-<FY4><MM2><SEQ5>`; regex `^RKH-\d{11}$`; FY-code is the **4-digit** Indian-FY code (`2526`); SEQ is monthly, zero-padded to 5. The legacy `RKH-YYMM#####` (9-digit) gloss is **retired**. |
| **C2** | `patients.sex` | **DB enum = `('male','female','other')`** (lowercase). **API/DTO = `"M" \| "F" \| "O"`**. One mapping table at the adapter boundary (anti-corruption), nowhere else. |
| **C3** | Safety `overall_status` / severity | `overall_status ∈ {'SAFE','REVIEW_REQUIRED'}` (UPPER_SNAKE, underscore) **everywhere** — DB, API, SSE, audit. Severity tier `∈ {'none','moderate','high'}`. The space-form `REVIEW REQUIRED` is a **display string only**, never a stored/wire value. |
| **C4** | Rx `status:signed` | `status` on a prescription is a **computed/synthetic API field**, not a column. Presence of the row in `prescribing.prescriptions` *is* the signed state. The API derives `status:"signed"` at serialization. |
| **C5** | Dose-engine source of truth | **Runtime authority = the pure TS `DoseEnginePort`** (ported into `core/`). `web/dose-engine.js` is the **frozen legacy reference / parity oracle** only. The golden-parity gate (Part C) keeps them byte-identical until the JS is retired. |
| **C6** | Guardian consent enforcement | AI-assisted generation is **blocked at the command boundary** unless an active (`consent_given=true AND withdrawn_at IS NULL`) `purpose='ai_assisted_rx'` consent row exists for the patient. Withdrawal blocks *new* generations immediately. |
| **C7** | SSE fan-out under multi-instance | Single-process POC = in-memory `StatusChannel`. Multi-instance prod = **Postgres `LISTEN/NOTIFY` keyed by `job_id`, fed by `ops.outbox`** (Redis pub/sub is the reserved alternative behind the same `RealtimePort`). The SSE handler never changes between the two. |
| **C8** | (Folded) PII/eval/CI gates without an owner | Each assigned a single owning discipline file in Part D; no gate is ownerless. |

---

### C1 — UHID grammar (pin the regex, format, and FY-code width)

**Canonical form.**

```
Format:   RKH-<FY4><MM2><SEQ5>
Regex:    ^RKH-\d{11}$
Example:  RKH-25260600042   →  FY=2526, MM=06, SEQ=00042
Allocator: clinical.next_uhid(facility, fy_code, month)
           returns format('RKH-%s%02s%05s', p_fy, p_month, v_seq)
           where p_fy is the 4-char FY code '2526', p_month is 1–12, v_seq is monthly.
```

- **FY-code width is 4** (`2526` = Indian financial year 2025-26, April-anchored), not 2.
- Total digit count after `RKH-` is exactly **11** = 4 (FY) + 2 (MM) + 5 (SEQ). The CHECK
  `uhid ~ '^RKH-\d{11}$'` and the allocator's `format(...)` are now provably consistent
  (4+2+5 = 11).
- The human-facing gloss **`RKH-YYMM#####`** in `CLAUDE.md` and any prose is **wrong** (it
  implies 9 digits with a 2-digit year) and must be rewritten to `RKH-<FY4><MM2><SEQ5>` /
  "`RKH-` then 11 digits".

**Rationale.** A 2-digit year collides every century and, worse, is ambiguous across the
April FY boundary (a Jan-2026 visit is FY 2025-26 → `2526`, not `26`). The 4-digit FY code is
already what the allocator and the counter table (`uhid_counter.fy_code text` storing `'2526'`)
emit; the 11-digit regex already assumes it. The only defect was the prose gloss. Pinning the
4-digit FY makes the format self-describing and the regex a real guard rather than a loose
`\d{11}` that happens to pass.

**Edits to apply.**
- `03_data/schema_design.md §4, §5.1`: already correct (`fy_code '2526'`, `^RKH-\d{11}$`,
  `format('RKH-%s%02s%05s', …)`). Add a one-line comment that `%05s` zero-pads SEQ and that
  total = 11 digits = FY4+MM2+SEQ5. **No structural change.**
- `04_api/api_contracts.md §3.2`: keep `^RKH-\d{11}$`; change any "`RKH-YYMM#####`" gloss to
  "`RKH-<FY4><MM2><SEQ5>`". The sample `RKH-25260600042` is canonical.
- `CLAUDE.md` (root, project memory): rewrite "`RKH-YYMM#####`" and
  "Format RKH-YYMM##### (Indian financial year)" to the 4-digit FY form. (Tracked as a
  doc-debt edit; the spec is authoritative regardless.)

> **Server-allocated, never client-computed** (unchanged): the value comes only from
> `clinical.next_uhid()` under a row lock; the regex is belt-and-braces, not the source.

---

### C2 — `patients.sex` (DB enum + API representation + mapping)

**Canonical form.**

| Layer | Representation |
|---|---|
| **DB column** | `sex text check (sex in ('male','female','other'))` — lowercase tokens. |
| **API / DTO (request & response)** | `sex: 'M' \| 'F' \| 'O'`. |
| **De-identified model context** (`DeidentifiedPatientContext`) | `sex: 'M' \| 'F'` (no `'O'` reaches the model; `'O'`/unknown maps to omission of any sex-specific dosing branch — there is none in pediatrics that depends on it). |
| **Mapping** | A single pure function `sexToApi / sexFromApi` at the database adapter boundary. `male↔M`, `female↔F`, `other↔O`. No other code branches on sex strings. |

**Rationale.** Three forms are live across the files: DB CHECK `('Male','Female','Other')`
(title-case, schema §5.1), API `"sex":"M"` (api_contracts §3.1), and
`DeidentifiedPatientContext.sex: 'M'|'F'` (security §3.2). Title-case in the DB is brittle
(case-mismatch inserts silently violate the CHECK) and leaks a presentation choice into
storage. **Lowercase canonical tokens** in the DB is the boring, collation-safe choice;
**single-letter codes** are the compact, FHIR-administrative-gender-mappable wire form
(`M→male`, `F→female`, `O→other` align to HL7 AdministrativeGender). The conversion lives in
exactly one anti-corruption seam so neither side has to know the other's spelling.

**Edits to apply.**
- `03_data/schema_design.md §5.1`: change
  `sex text check (sex in ('Male','Female','Other'))` →
  `sex text check (sex in ('male','female','other'))`.
- `04_api/api_contracts.md §3.1`: keep `"sex":"M"`; add a note that the API form is
  `'M'|'F'|'O'` and the adapter maps to/from the DB lowercase tokens.
- `06_security/security_auth_rbac_compliance.md §3.2`: `DeidentifiedPatientContext.sex` stays
  `'M' | 'F'` (model never needs `'O'`); add the mapping note.
- `05_ai/tool_contracts.md` (new, Part B): the patient context handed to tools uses the
  de-identified `'M'|'F'` form.

---

### C3 — Safety `overall_status` / severity (one spelling)

**Canonical form.**

```
overall_status ∈ { 'SAFE', 'REVIEW_REQUIRED' }      // UPPER_SNAKE, underscore. Stored + wire.
severity_final ∈ { 'none', 'moderate', 'high' }      // three-tier (sprint-2 port)
Display only:  the UI MAY render 'REVIEW_REQUIRED' as the words "Review required" /
               "REVIEW REQUIRED" — that is a label, never persisted, never sent.
```

**Rationale.** The DB CHECK already pins `('SAFE','REVIEW_REQUIRED')`
(schema §6.5 `prescribing.safety_checks`). The API draft (`api_contracts §4.7`) and the
error model use the **space form** `"REVIEW REQUIRED"`. A value that is `REVIEW_REQUIRED` in
the database and `REVIEW REQUIRED` on the wire is a contract bug: a consumer branching on the
string, an Ajv enum, and the DB CHECK would all disagree. The machine value is **one token**;
spaces are a rendering concern (same rule as error codes: stable UPPER_SNAKE machine value,
human text is a separate field/label).

**Severity** is independently pinned to `{none, moderate, high}` (the error-model and
ai_orchestration three-tier ladder). Drop any `low` usage on the *gate* severity (the
`safety_checks.severity_final` CHECK in schema §6.5 currently lists `('high','moderate','low')`
— reconcile to `('none','moderate','high')` so the gate severity and the audit `severity_*`
share one vocabulary; `low` was an audit-only artifact and maps to `none` at the gate).

**Edits to apply.**
- `04_api/api_contracts.md §4.7`: `"overall_status": "REVIEW REQUIRED"` →
  `"overall_status": "REVIEW_REQUIRED"`; `"severity": "moderate"` stays; the JSON comment
  `// SAFE | REVIEW REQUIRED` → `// SAFE | REVIEW_REQUIRED`.
- `04_api/error_model.md`: the load-bearing-invariant prose may keep "REVIEW REQUIRED" as
  *prose* but the §1 `clinical_safety` block and §5.6 codes use `severity ∈ {high,moderate}`
  (gate severities) and any `overall_status` reference uses `REVIEW_REQUIRED`. The user-message
  table (§7.1) may show the words "needs your review" — that's display text, fine.
- `03_data/schema_design.md §6.5`: keep `overall_status in ('SAFE','REVIEW_REQUIRED')`; change
  `severity_final in ('high','moderate','low')` → `severity_final in ('none','moderate','high')`.
- `02_architecture/ai_orchestration.md §4.6`: the diagram's `severity = REVIEW REQUIRED` →
  reads as the *gate outcome* (`overall_status=REVIEW_REQUIRED`, `severity_final=high`).

---

### C4 — Prescription `status:signed` (declare it computed/synthetic)

**Canonical form.**

> A prescription has **no `status` column**. **Membership in `prescribing.prescriptions` is
> the signed state** — a row exists only because a human `SignOff` command created it from a
> `pending_review` draft. The API's `status:"signed"` is a **derived/synthetic field** computed
> at serialization, never read from or written to a column. Lifecycle *before* signing lives on
> the **draft** (`prescription_drafts.status ∈ {pending_review, superseded, promoted, discarded}`)
> and the **job** (`rx_generation_jobs.status ∈ {queued, generating, streaming, draft_ready,
> superseded, failed, timeout}`).

The synthetic projection (when a serializer must present a unified status across the
draft→signed boundary):

```
api.status(prescription) := 'signed'                          // row exists ⇒ signed (immutable)
api.status(draft)        := draft.status                      // pending_review | superseded | promoted | discarded
api.status(job)          := job.status                        // queued | … | draft_ready | failed | timeout
```

**Rationale.** `api_contracts §4.7` returns `"status":"signed"` on the sign-off response, but
the schema (§6.3) deliberately has **no `is_approved`/`status` column** — "presence in this
table *is* the approval", and the row is immutable (edits → `rx_versions`). Inventing a
`status` column would create a second source of truth that could disagree with row existence
and with the immutability trigger. Declaring `status` **computed** keeps the DB honest (one
fact: the row), keeps the API ergonomic (clients get a `status` field), and preserves the
state machine: `signed` is reachable only through the `SignOff` command, never as a column
mutation. This also means there is **no `signed` value in any generation-job enum** — exactly
the clinical-safety invariant (no API path turns model output into a signed Rx without a human).

**Edits to apply.**
- `04_api/api_contracts.md §4.7`: keep `"status": "signed"` in the response body but annotate
  it `// synthetic: derived from row existence, NOT a column`. Add a sentence to §3.0 / §4.7
  that prescription `status` is computed.
- `03_data/schema_design.md §6.3`: add an explicit note: "There is no `status` column; the
  API's `status:'signed'` is synthetic (row existence). Draft/job carry the mutable lifecycle."
- `02_architecture/backend_services.md §9.3` and `ai_orchestration.md §9`: the lifecycle line
  `… → signed → printed` is the **state-machine** view; clarify that `signed` materializes as a
  row insert into `prescribing.prescriptions`, not a status update.

---

### C5 — Dose-engine source of truth (runtime authority vs legacy oracle)

**Canonical form.**

| Artifact | Role | Status |
|---|---|---|
| **`DoseEnginePort` (pure TS, in `core/`)** | **The runtime arithmetic authority.** Every mg/ml/drop that reaches a draft, a server re-check, or paper comes from here. | Built to; the 745-line `sprint-2-saved` `dose-engine.ts` is its seed. |
| **`web/dose-engine.js`** | **Frozen legacy reference + the golden-parity oracle** the eval cross-check (M2) imports. | Reference only; never invoked in the new runtime path; retired after JS is no longer the printed-page engine anywhere. |

- The runtime **never** calls `web/dose-engine.js`. The eval scorer **does** (it is the M2
  oracle). The two are kept identical by the golden-parity gate (Part C) for as long as both
  exist; the gate is what licenses trusting the TS port.
- Project memory `project_dose_engine_is_source_of_truth.md` ("`web/dose-engine.js` is correct;
  Rx dosing errors come from AI mental math, not the engine") remains true and is the reason
  the JS is the **oracle**: it is the doctor-validated baseline the TS must match before the TS
  is trusted.

**Rationale.** Two files describe the engine's authority with subtly different emphasis:
ai_orchestration/backend call the **TS port** the runtime authority; the discipline files and
project memory call **`web/dose-engine.js`** the source of truth. Both are right about
different roles, and conflating them is dangerous — if the TS were treated as "just a port"
with no oracle, a silent transcription error in the 745-line port could ship; if the JS were
treated as the runtime, the new off-edge worker would have to embed browser JS. The resolution
names **the TS port as runtime authority** and **the JS as the parity oracle**, joined by the
gate. This is exactly the "answer from data, not guesswork" axiom applied to the engine itself.

**Edits to apply.**
- `02_architecture/ai_orchestration.md §4.6`, `backend_services.md §5`: keep "port the 745-line
  engine into `core/` as `DoseEnginePort`"; add the one-liner "`web/dose-engine.js` is the
  frozen parity oracle, not the runtime engine."
- `09_engineering_discipline/evals_framework.md §6.1`, `quality_gates_ci.md §6.4`: the M2
  scorer's `import { computeDose } from web/dose-engine.js` is **correct and intentional** — it
  imports the **oracle**, not the runtime. Add a comment to that effect so a future reader does
  not "fix" it to import the TS port (which would make the test tautological).
- `05_ai/*` (Part B): the `compute_doses` tool delegates to the **TS `DoseEnginePort`**.

---

### C6 — Guardian consent runtime enforcement (DPDP)

**Canonical form.**

> **AI-assisted prescription generation is blocked unless the patient has an active
> `purpose='ai_assisted_rx'` guardian consent.** "Active" = a `clinical.guardian_consents` row
> with `consent_given = true AND withdrawn_at IS NULL`. Enforcement is at the **command
> boundary** (`RequestGeneration` handler), fail-closed, **and** mirrored in RLS so a bypass
> still cannot read the clinical context a generation needs.

```
RequestGeneration(visit_id, …):
  ctx = loadDeidentifiedContext(visit_id)            // resolves patient_id server-side
  assertActiveConsent(patient_id, purpose='ai_assisted_rx')   // else → 403 CONSENT_REQUIRED
  … enqueue job …

Withdrawal:  CaptureGuardianConsent / WithdrawConsent sets withdrawn_at = now()
             → next RequestGeneration for that patient fails CONSENT_REQUIRED immediately.
             → in-flight speculative jobs for that patient are superseded/cancelled on withdrawal.
```

- This is **distinct** from `opd_care` consent (which gates clinical *processing* at
  registration, SEC-7) and from **ABDM consent artefacts** (which gate *sharing*). Three
  separate consent purposes, three separate gates; none substitutes for another.
- New error code: **`CONSENT_REQUIRED` (403, C2 category, not retryable)** with
  `details:{ purpose:'ai_assisted_rx' }`. Added to the error catalogue (Part D / error_model).
- Speculative generation is also gated: the background trigger checks consent before enqueuing,
  so a withdrawn-consent patient never has an AI draft sitting in `prescription_drafts`.

**Rationale.** The schema *captures* `guardian_consents` with a `purpose` of `ai_assisted_rx`
and a `withdrawn_at` column, and the security file lists "verifiable guardian consent before
processing" as SEC-7 — but **no file states where the AI path is actually blocked**. A captured
consent that is never enforced is theatre. DPDP child-data + the "fail closed" invariant
require that the absence (or withdrawal) of `ai_assisted_rx` consent **stops the AI**, not just
the registration write. Putting the gate on the `RequestGeneration` command (the symmetric-actor
boundary) means it applies identically to a doctor click, a speculative trigger, and a future
AI agent — exactly the bus design.

**Edits to apply.**
- `06_security/security_auth_rbac_compliance.md §6.1, §2.3`: add `CONSENT_REQUIRED` and the
  `assertActiveConsent` gate to the `RequestGeneration` row; note speculative is gated too.
- `02_architecture/backend_services.md §4.2` / `ai_orchestration.md §9`: add the consent check
  as a precondition of `RequestGeneration` (before enqueue), fail-closed.
- `04_api/api_contracts.md §4.1`, `error_model.md §5.2/§5.4`: add `403 CONSENT_REQUIRED`.
- `03_data/schema_design.md §5.2`: add a partial index supporting the lookup,
  e.g. `create index idx_consent_active on clinical.guardian_consents (patient_id, purpose) where consent_given and withdrawn_at is null;`

---

### C7 — SSE fan-out behind a multi-instance deployment

**Canonical form.**

```
Transport seam:  RealtimePort  (one interface, two adapters by env)

POC (single process):    in-memory StatusChannel (EventEmitter pub/sub) — the dis/ pattern.
PROD (multi-instance):   transactional outbox → Postgres LISTEN/NOTIFY, channel keyed by job_id.
                         Worker writes the domain event to ops.outbox in the SAME transaction
                         as the job-state change; a relay NOTIFYs 'rx_job_<job_id>'; any gateway
                         instance holding that job's SSE connection is LISTENing and forwards.
Reserved alternative:    Redis pub/sub behind the same RealtimePort (only if NOTIFY fan-out or
                         payload-size limits bite at scale). Swapped by wiring, not by handler edits.
Reconnect/resume:        Last-Event-ID replays ops.outbox events with id > N (held for the job's
                         lifetime), then resumes live (already specified in api_contracts §5.4).
```

- The **SSE handler code never changes** between POC and prod — it subscribes to the
  `RealtimePort`. Only the adapter the composition root picks changes (`StatusChannel` vs the
  `LISTEN/NOTIFY` relay), exactly the env-flip portability invariant (I7).
- `ops.outbox` is the durable backbone: it is the source for both the live `NOTIFY` and the
  `Last-Event-ID` replay, so an event is never lost on a worker or gateway crash, and any
  instance can serve any job's stream.
- Payloads on `NOTIFY` carry only `{job_id, event_id, type}` (NOTIFY has an 8 KB limit and is
  not the data plane); the SSE relay reads the full frame from `ops.outbox` by `event_id`.
  This keeps PII/large deltas out of the NOTIFY channel.

**Rationale.** `api_contracts §5.1` and `backend_services §6.2` both note that the in-memory
`StatusChannel` is single-process and that multi-instance prod needs cross-process fan-out via
`ops.outbox` / Postgres `LISTEN/NOTIFY` — but neither *designs* it, and `07_deployment` lists
SSE as "SSE relay from the worker via the API" without saying how an SSE connection on
gateway-instance-A receives an event produced by worker-instance-B. On Cloud Run (N gateway
instances, min-instances ≥ 1) a doctor's SSE connection can land on any instance; without a
shared bus the stream silently stalls. `LISTEN/NOTIFY` fed by the transactional outbox is the
boring, infra-free (no extra service) answer that already fits the outbox the schema mandates,
and it degrades to the status-row poll if NOTIFY is unavailable.

**Edits to apply.**
- `07_deployment/infrastructure_cicd.md §2.5`: add the `LISTEN/NOTIFY`-fed-by-outbox design as
  the prod SSE fan-out; name the Redis alternative as reserved; state the handler is unchanged.
- `02_architecture/backend_services.md §6.2`: promote the parenthetical to the canonical design
  (NOTIFY keyed by `job_id`, payload is `{job_id,event_id,type}`, full frame read from outbox).
- `04_api/api_contracts.md §5.1/§5.4`: cross-reference this decision; `Last-Event-ID` replay
  reads from `ops.outbox` (already stated).
- `03_data/schema_design.md` (`ops.outbox`): ensure the outbox row carries a monotonic
  `event_id` per `job_id` (the SSE `id:` field) so resume and replay are total-ordered per job.

---

## Part B — The `05_ai/` layer (author the missing AI-substance owner)

`05_ai/` is referenced by 6+ files (`api_contracts`, `schema_design`, `ai_orchestration`,
`backend_services`, `error_model`, the README) as the owner of **prompt/tool substance**, but
the directory does not exist. `02_architecture/ai_orchestration.md` owns the *orchestration*
(model policy, caching, streaming, fallback, the dose-separation **mechanism**); `05_ai/` owns
the **content and contracts the orchestration carries**. They are complementary, not
overlapping: orchestration is "how the loop runs"; `05_ai/` is "what the loop says and the
exact shapes it exchanges."

### B.0 Directory/number reconciliation

- The on-disk integration directory is **`05_integration/`**; the README's logical numbering
  calls integration "05". To avoid renumbering churn, the AI layer is authored at the path the
  referencing files already use — **`05_ai/`** — as a **sibling** of `05_integration/`. Both
  are "05-class" content (AI substance; ABDM/FHIR substance). The README's index gets one new
  row (`05_ai/`) and a note that `05_*` is a family, not a single directory. This is recorded
  here so the dual-`05` is a *decision*, not an accidental collision. (If a future ADR prefers
  strict single-number directories, the clean rename is `04_api → 04_api`, `05_ai`, `05b_integration`
  — deferred; not worth the cross-link churn now.)

### B.1 Files and responsibilities

| File | Owns | Key contracts it freezes |
|---|---|---|
| **`05_ai/prompt_system_design.md`** | The rebuilt `core_prompt.md` structure; the **pre-embedded NABH block**; the **prompt-cache prefix layout** (the exact `tools → system → messages` byte-frozen prefix, breakpoint placement, the 4096-token Opus-4.8 minimum, the "no UUID/timestamp/unsorted-JSON in prefix" invariant). | The cacheable-prefix byte contract; the `cache_read_input_tokens != 0` audit assertion (CI-checked). |
| **`05_ai/clinical_references.md`** | The **11 `references/*.md`** files' target content, governance, **versioning**, and the **`catalog.clinical_reference` registry** authoring (name → Storage key → content_hash → version). Six-eye review for clinical reference edits. | `clinical_reference` registry rows; the `get_reference` name→object resolution; reference-version bump → cache-bust rule. |
| **`05_ai/tool_contracts.md`** | The **6 tools'** exact `input_schema` given to Claude **and** the **condensed output shape** returned to the model (token-stripped). | The frozen tool JSON-Schemas + the `condenseDrugForAI()` output contract (§B.2). |
| **`05_ai/worked_examples_and_golden_cases.md`** | The **worked examples** (Arjun AOM etc.) as both prompt exemplars **and** eval golden inputs; the mapping from a worked example to its `evals/golden/cases/*.case.json`. | The example↔golden-case bijection; which examples are `split:train` (prompt iteration) vs `split:test` (gate). |

### B.2 The six tool contracts (the canonical surface `05_ai/tool_contracts.md` authors)

The **5 progressive-disclosure tools + `compute_doses`** behind `ClinicalKnowledgePort`. For
each: the `input_schema` Claude sees, and the **condensed** result shape (PII-stripped,
token-stripped) the model receives back. These are frozen here at contract level; `05_ai`
expands each with the full Ajv schema.

| Tool | `input_schema` (to Claude) | Condensed output to the model |
|---|---|---|
| `get_standard_rx` | `{ icd10?: string, diagnosis_name?: string }` — ICD-10-first, `pg_trgm` name fallback. | One deterministic protocol: `{icd10, diagnosis_name, first_line_drugs[], investigations[], duration_days_default, warning_signs[], counselling[]}`. No internal ids, no audit columns. |
| `get_formulary` | `{ drug_names: string[] }` (batched). | Per drug, `condenseDrugForAI()`: identity + `dosing_bands` + safety arrays + promoted `max_single_*/max_daily_*`. **Strips** `brand_names`/`indian_brands` (~77% of tokens), SNOMED metadata, null fields, provenance. |
| `get_previous_rx` | `{ patient_id: string }` (server-resolved from visit; opaque uuid). | Typed `PreviousRxView[]` — **no PII fields exist on the type**: dates, drug generics, regimens only. Compile-time un-leakable. |
| `get_lab_history` | `{ patient_id: string }`. | Recent `lab_results` with `{test_name, value, unit, flag, test_date, loinc?}`; no identifiers. |
| `get_reference` | `{ name: string }` (registry name, e.g. `'neonatal_dosing'`). | The resolved `.md` body from `catalog.clinical_reference` Storage key (versioned, content-hashed). |
| **`compute_doses`** | `{ drugs: [{ generic, formulation, method, band, frequency, is_per_day }], patient: {weightKg, heightCm?, ageDays, correctedAgeDays?, gaWeeks?, egfr?} }` — **NO numeric mg/ml fields from the model.** | The **engine output verbatim**: `{ vol, enD (R2 English), hiD (R3 Devanagari), calc, capped, warnings[], ingredientDoses[], pictogram }`. Computed by the TS `DoseEnginePort` (C5), copied into `medicines[]` unchanged. |

**Invariants `05_ai` must enforce (cross-referenced, not re-derived):**
- No PII to the model (C2 de-id form; security SEC-3). Tool outputs carry uuids only.
- `compute_doses` is **mandatory when `medicines[]` is non-empty** (server-asserted); the model
  proposes drug+regimen+band, never a number (I2).
- Tool results returned in a **single** `tool_result` user message (parallel `Promise.all`),
  never split (preserves parallel-call behavior on Opus 4.8).
- `strict: true` on tools whose inputs must validate exactly; final-turn
  `output_config.format = {type:"json_schema", schema: prescription.v1.json}` retires
  `extractJSON`.

---

## Part C — The dose-engine golden-parity gate (JS↔TS sync contract)

This gate is the mechanism that lets the system trust the TS `DoseEnginePort` (C5) as runtime
authority while keeping the doctor-validated `web/dose-engine.js` as the oracle. It is a
**release blocker** for the Generation context (the TS port is "not wired into generation" until
the gate is green) and a **required CI check** (`09` quality_gates G9-adjacent / a dedicated
`ci/dose-parity` check).

### C.1 Contract

```
GIVEN  a frozen fixture set  evals/golden/dose_parity/*.fixture.json   (≥ 20 cases)
WHEN   each fixture's ComputeDoseParams is run through BOTH
         - web/dose-engine.js  (the oracle)        → resultJS
         - core/ DoseEnginePort (the runtime port)  → resultTS
THEN   resultTS  MUST equal  resultJS  field-by-field, byte-for-byte, for every output field:
         vol, enD (R2 English), hiD (R3 Devanagari), calc, capped, warnings[],
         volumeMl, volumeUnits, ingredientDoses[]  (and the pictogram codes).
       ANY divergence → the check FAILS → merge blocked, engine NOT trusted in generation.
```

### C.2 Coverage floor (the ≥20 cases MUST include)

| Edge | Why it is in the floor |
|---|---|
| Syrup rounding → **0.5 ml** | The most common pediatric form; a rounding drift is a dosing error. |
| Drops rounding → **0.1 ml** | Neonatal/infant drops; tight tolerance. |
| Tablet rounding → **¼ tab (0.25)** | Solid-form rounding rule. |
| **Max-single** cap clamp | Engine `capped:true` path; never exceed max. |
| **Max-daily** cap clamp | Cumulative ceiling. |
| **Weight-based** + **BSA** + **GFR-adjusted** | Three of the six methods; the GFR path is the preterm-renal never-event surface. |
| **Combo drug** (limiting ingredient) | `ingredientDoses[]` + `is_limiting`. |
| **Bilingual strings** (R2 English + R3 Devanagari) | The print-fidelity surface; a Devanagari mismatch is a render-correctness defect. |
| **Preterm corrected-age** vs chronological | Corrected for growth/dose, chronological for vaccination (computed pre-engine; the engine receives the resolved number). |

### C.3 Where it lives and how it gates

- **Fixtures:** `evals/golden/dose_parity/` (versioned JSON; append-not-mutate; each carries a
  `trace_id` to the dosing spec clause).
- **Runner:** a vitest/deno suite that imports both engines and asserts deep equality; emits a
  per-field diff on failure.
- **CI:** a dedicated required status check (`ci/dose-parity`) under branch protection on `main`
  (a structural sibling to the eval gate; it is **not** LLM-affecting, so it runs on **every**
  PR that touches `core/` dose code, the JS, or the fixtures — fails closed if scope is
  undetermined).
- **Owner:** `09_engineering_discipline/testing_strategy.md` owns the runner; `evals_framework.md`
  references it as the M2 oracle's integrity guarantee; `02_architecture/ai_orchestration.md §4.6`
  and `backend_services.md §5.3` cite it as the trust precondition. **This file pins its
  contract and floor.**

> **Why byte-for-byte, no tolerance:** the runtime server re-check (I2) already rejects any
> non-engine number with **zero tolerance**; the parity gate must hold the **two engines** to
> the same zero tolerance, or the oracle and the runtime could quietly disagree and the
> "answer from data" guarantee would be hollow. A 0.5 ml vs 0.6 ml drift is exactly the class
> of silent dosing error this whole architecture exists to prevent.

---

## Part D — Missing discipline files + folding the unowned gates

Six discipline files are referenced/implied but unauthored. Each is assigned a single owner and
a crisp scope. The previously-unowned eval/CI gates are folded into the relevant file so **no
gate is ownerless**.

### D.1 The six new discipline files

| File (`09_engineering_discipline/`) | Owns | Folds in (previously unowned) |
|---|---|---|
| **`eval_data_governance.md`** | Golden-set **lifecycle**: authoring, **de-identification PROOF**, **clinician-as-oracle sign-off**, train/test split discipline, **prod-miss intake**, **anti-staleness / anti-overfitting** (no tuning on test; case provenance). | The **de-identification PHI-scanner gate** (a gitleaks/PHI-pattern check over `evals/**` that hard-fails on any PHI token in a fixture). The "prod miss → golden case" loop's de-id proof. |
| **`clinical_risk_management.md`** | ISO-14971-style **hazard analysis → severity-weighted eval failures**: a wrong max-dose **HARD-blocks** (never-event), a formatting miss **warns**; the **human-in-loop sign-off invariant** as the top control; hazard→control→eval-case traceability. | The mapping of every never-event to a hazard; the **severity-weighted scorecard** rationale (why M11 severe-count is the headline). |
| **`data_migration_rollback.md`** | **Expand/contract** migration discipline; **prod-like dataset restore in CI**; reversibility under **RLS / ON DELETE RESTRICT / CHECK** constraints; the forward-only dbmate + `.rollback.sql` round-trip proof; the abort-on-duplicate ETL. | The **migration round-trip gate** (up→down→up + `pg_dump` schema-diff) ownership; the restore-drill-in-CI gate; the "never `drop … cascade`" enforcement. |
| **`agent_threat_model.md`** | **Prompt-injection / data-poisoning** via a malicious **reference file or formulary row**; **reviewer/author collusion** when both are the same base model; **human-escalation thresholds**; sandboxing + command-allowlist for agent shell/DB. | The **independent-adversarial-review** integrity (G17) threat rationale; the reference/formulary content-governance gate (six-eye); the "judge ≠ author model" pinning. |
| **`branch_protection_and_required_checks.md`** | **Config-as-code** for branch protection so the "unbypassable gate" axiom is **real, not an un-versioned GitHub setting**: the `required_status_checks` list as a reviewed Terraform/`gh api` artifact; `enforce_admins`, `require_last_push_approval`, signed commits, linear history. | The **branch-protection-as-code** gate (drift in the protection config fails a check); the model-EXISTENCE contract test placement; the **traceability-matrix CI enforcement** required-check registration. |
| **`render_fidelity_gates.md`** *(or fold into `testing_strategy.md`)* | **Accessibility / Devanagari / pictogram / print-fidelity** render-correctness gates. | The **WCAG 2.2 AA / Lighthouse ≥ 90** gate; the **Devanagari R3 render** check; the **pictogram-paired-with-text** (never icon-only) check; the **A4 print-fidelity** snapshot (the one canonical `<PrintDocument>`). |

> If a seventh file is undesirable, `render_fidelity_gates.md` may be a §-section of the existing
> `testing_strategy.md`; the **content and ownership** above are binding regardless of file count.

### D.2 The remaining unowned gates, each assigned an owner

| Gate (previously stated but unowned) | Canonical owner | Form |
|---|---|---|
| **De-identification PHI-scanner** | `eval_data_governance.md` | gitleaks/PHI-pattern over `evals/**` (and any model-bound payload); any PHI token → hard-fail. Required check `ci/eval-phi-scan`. |
| **LLM-judge non-determinism** (variance bounds, seed pinning, escalation) | `evals_framework.md` (already centers judge discipline) | Pinned judge model id; **score-average n≥3**; report mean+variance; variance over bound → escalate to human, never auto-pass; judge upgrade is itself a gated change (re-validate vs human labels, Krippendorff α ≈ 0.8). |
| **Eval-in-CI cost + record/replay + model-EXISTENCE contract test** | `quality_gates_ci.md` (cost/latency) + `branch_protection_and_required_checks.md` (existence test placement) | Record/replay cassettes for deterministic CI cost; a **model-existence contract test** (the config-resolved model id must resolve to a live model at boot/CI — the model-retirement lesson) registered as a required check. |
| **Coverage & perceived-latency numeric budgets** (TTFT vs total) | `quality_gates_ci.md` (it already owns coverage §7 + perf budgets §9) | TTFT budget (first `DraftDelta` ≤ ~3 s on the stale-regenerate path) and total worker budget tracked **separately**; perceived-wait ≈ 0 on the speculative-hit path is the headline; both are assertions, not aspirations. Coverage stays path-weighted (safety-critical ≥ 95%). |
| **Traceability-matrix CI enforcement** | `branch_protection_and_required_checks.md` (registration) + the existing G15 | The matrix builder is a **required check**; a safety-critical clause with no verifying test/eval → red. |
| **Accessibility / Devanagari / pictogram / print-fidelity** | `render_fidelity_gates.md` (D.1) | As above; required checks `ci/lighthouse-a11y`, `ci/render-devanagari`, `ci/print-snapshot`. |

### D.3 Severity-weighting principle (the spine of clinical_risk_management)

```
HARD-BLOCK (never-event, severe, on_hit: hard_fail):
   exceeds max dose · prescribes a recorded allergen · NABH block missing ·
   AI-originated dosing number · sign-off bypass in the evaluated flow ·
   AI-assisted generation without ai_assisted_rx consent (C6).
WARN (threshold / observational, does not hard-block alone):
   formatting miss · soft-quality (note completeness, Hindi clarity) below threshold ·
   cost/latency near budget · cosmetic M1 regression.
INVARIANT (the top control, above all evals):
   no path issues/prints a prescription without a human SignOff event (I3 / F4 / SEC-4).
```

A wrong **milligram** hard-blocks; a wrong **font weight** warns. That asymmetry — owned by
`clinical_risk_management.md`, enforced by `never_events.yaml` + the severity scorecard — is the
whole point of severity weighting over a single accuracy number.

---

## Part E — Conformance ledger (for the synthesis/marriage step)

A spoke conforms to this file iff every box below is true after its edits.

- [ ] **C1** UHID is `^RKH-\d{11}$` = `RKH-<FY4><MM2><SEQ5>`; FY-code 4-digit (`2526`); no `RKH-YYMM#####` gloss survives.
- [ ] **C2** DB `sex ∈ ('male','female','other')`; API `'M'|'F'|'O'`; one adapter-boundary mapping; model sees `'M'|'F'`.
- [ ] **C3** `overall_status ∈ {'SAFE','REVIEW_REQUIRED'}` everywhere stored/wire; `severity_final ∈ {'none','moderate','high'}`; spaces are display-only.
- [ ] **C4** Prescription `status` is synthetic (row existence ⇒ `signed`); no `status` column; no `signed` value in any job enum.
- [ ] **C5** TS `DoseEnginePort` = runtime authority; `web/dose-engine.js` = frozen oracle; M2 scorer imports the **oracle** by design.
- [ ] **C6** `RequestGeneration` fail-closed on active `ai_assisted_rx` consent; `CONSENT_REQUIRED` (403) exists; speculative path gated; withdrawal cancels in-flight.
- [ ] **C7** SSE fan-out = `RealtimePort`; POC `StatusChannel`, prod outbox→`LISTEN/NOTIFY` keyed by `job_id`; handler unchanged across env; NOTIFY carries `{job_id,event_id,type}` only.
- [ ] **B** `05_ai/` exists with the four files; the 6 tool contracts (input_schema + condensed output) are frozen; `compute_doses` delegates to the TS port and is mandatory when `medicines[]` non-empty.
- [ ] **C** `ci/dose-parity` is a required check; ≥20 fixtures covering the C.2 floor; byte-for-byte, zero tolerance; release-blocks the Generation context until green.
- [ ] **D** The six discipline files exist (or `render_fidelity_gates` is a `testing_strategy` section); every folded gate has exactly one owner; branch protection is config-as-code; severity-weighting (hard-block vs warn vs sign-off invariant) is authored.

---

### Provenance (files read to ground these decisions)

`03_data/schema_design.md` (§4 allocator, §5.1 patients, §6.3/§6.5 prescriptions+safety),
`04_api/api_contracts.md` (§3.1/§3.2 sex+UHID, §4.1/§4.7 generation+signoff, §5 SSE),
`04_api/error_model.md` (§1 envelope, §5 code catalogue, §6 degradation),
`02_architecture/ai_orchestration.md` (§2 model policy, §4 tools+dose separation, §5 caching, §9 state machine),
`02_architecture/backend_services.md` (§4 worker, §5 dose engine, §6 SSE/queue, §9 command bus),
`06_security/security_auth_rbac_compliance.md` (SEC-1..8, §2.3 command matrix, §3.2 de-id, §6.1 DPDP consent),
`07_deployment/infrastructure_cicd.md` (§2 compute, §2.4 queue, §2.5 SSE, §4 CI/CD),
`09_engineering_discipline/evals_framework.md` (metrics, golden set, never-events, judge discipline),
`09_engineering_discipline/quality_gates_ci.md` (gate ledger, branch protection, fitness functions, eval gate),
`00_overview/README.md` (§2 invariants I1–I7, §7 canonical decisions).
