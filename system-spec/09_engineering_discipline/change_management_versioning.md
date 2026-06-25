---
trace_id: ENG-DISC-09-CHANGE-MGMT-VERSIONING
title: Change Management, Versioning, ADRs, Migrations & Rollback Drills
status: binding
scope: methodology/governance (spec-independent)
parent_digest: OPERATING-MODEL DIGEST (single source of truth)
last_verified_repo_state: 2026-06-25
owners: [engineering-discipline, gatekeeper-ci, release-captain]
supersedes: ".github/workflows/deploy-pages.yml (zero-gate big-bang push→Pages)"
related:
  - quality_gates_ci.md (the gate ledger this file slots into)
  - evals_framework.md (the eval gate every model/prompt change must pass)
  - drift_control.md (fitness functions + traceability this file references)
  - observability.md (SLOs, error budgets, alarms that trigger rollback)
  - supply_chain.md (vendor model id as a pinned dependency)
---

# Change Management, Versioning, ADRs, Migrations & Rollback

> **Purpose.** This file is the **change-control contract** for the agent-built rebuild of the Radhakishan pediatric OPD prescription system. It defines how a change is *named* (semantic versioning of every changeable artifact), how an architectural decision is *recorded* (ADR discipline), how schema and data *move* (migrations with verification + drilled rollback), how risky behavior is *toggled* (feature flags), how a release *ships* (release process), and how the rebuild *reaches patients* (safe, incremental rollout — latency-fix slice first, shadow, then pilot — **never a big-bang cutover**).
>
> **Authority.** This file conforms to the OPERATING-MODEL DIGEST. Where this file and the digest disagree, the **digest wins** until amended by an ADR authored under §3 of this file. This file is **spec-independent**: it constrains *how change is governed and rolled out*, not the target product architecture.
>
> **Founding incident (never again).** On 2026-06-25 a hardcoded, dated Claude model id was retired by the vendor and **broke production**. The emergency fix swapped models and tuned reasoning effort **by guesswork, with no eval harness and no rollback path**. Three failures of change management caused it: (1) the model id was an **unversioned, unmonitored, hardcoded dependency**; (2) the swap shipped as a **hotfix, not a gated change**; (3) there was **no pre-validated fallback to roll back to**. Every section below exists to make each of those three failures structurally impossible.

---

## 0. Axioms this file enforces (inherited, non-negotiable)

| # | Axiom | How change management enforces it |
|---|---|---|
| A1 | **Done = proven + gated, never declared.** | A release is a tagged, gate-passing artifact with an attached evidence bundle — not a push to `main`. No version is "released" by assertion. |
| A2 | **Enforce in CI, not in convention.** | Version bumps, changelog entries, ADR presence, migration up+down pairing, and flag registration are **required status checks**, not review etiquette. |
| A3 | **Answer from data, not guesswork.** | Every model/prompt/reference/schema change runs the golden eval set base-vs-branch and ships only with a **pre-validated rollback target**. No swap merges on vibes. |
| A4 | **Humans and AI are symmetric actors.** | Every change is a command on the bus carrying `actor={human\|agent}`, `task trace ID`, version delta, and migration/flag references; the audit envelope is identical for both. |
| A5 | **Deterministic dose-engine is the dosing source of truth.** | The dose engine is its own independently-versioned, frozen-contract artifact (§1.4). A change to it is **always High risk** and **always eval-gated**. |

---

## 1. Semantic versioning — everything changeable carries a version

We version **artifacts, not just the repo**. The model-retirement incident happened because the most safety-critical dependency in the system — the Claude model id — had no version, no changelog, and no deprecation monitor. We fix the *class*, not the instance: **every artifact whose behavior can drift gets an explicit, monitored version.**

### 1.1 The versioned-artifact inventory

| Artifact | Version scheme | Where the version lives | Bump trigger |
|---|---|---|---|
| **Application / repo** | SemVer `MAJOR.MINOR.PATCH` on git tags `vX.Y.Z` | git tag + `CHANGELOG.md` | any release |
| **Edge Functions** (per function) | SemVer, embedded `FUNCTION_VERSION` const + tag suffix | function source + deploy metadata | any deploy of that function |
| **`core_prompt.md` & references** | SemVer `prompt vX.Y.Z` in YAML front-matter | front-matter `prompt_version:` + `PROMPTS_CHANGELOG.md` | any wording/tool/behavior change |
| **Vendor model id** (Claude, OCR, ABDM) | Pinned exact id + internal `model_policy vX.Y` | centralized config adapter only (§7.1) | any model swap or effort change |
| **Rx output contract** (JSON Schema) | SemVer + `$id` URL with version path | `schemas/rx-output.vX.Y.Z.json` | any field add/remove/rename |
| **Claude tool I/O contracts** | SemVer per tool schema | `schemas/tools/<tool>.vX.Y.Z.json` | any tool signature change |
| **Dose engine** | SemVer + frozen public API contract | `dose-engine.js` header + `DOSE_ENGINE_VERSION` | any dosing-logic change (always High risk) |
| **Database schema** | Monotonic migration number `NNNN` + schema `vX.Y` | `migrations/` + `schema_version` table | any DDL/data migration |
| **Golden eval set** | SemVer; `eval_set vX.Y.Z` | dataset front-matter + tag | any case add/edit/retag |
| **ABDM FHIR profiles** | Track ABDM-published profile versions | contract-test fixtures | regulator profile change |

### 1.2 SemVer semantics — what each digit *means here* (clinical-safety-aware)

A generic "what changed" rule under-protects a clinical system. We bind SemVer digits to **blast radius**, so the number itself signals review depth.

| Bump | Meaning (code) | Meaning (prompt/model) | Meaning (schema/contract) | Default risk tier |
|---|---|---|---|---|
| **PATCH** `_._.x` | Backward-compatible bugfix, no behavior change | Typo/formatting fix that the eval diff proves is behavior-neutral | Additive index, comment, non-breaking default | Low (still eval-gated if it touches the model/prompt surface) |
| **MINOR** `_.x._` | Backward-compatible feature; additive | New capability/instruction; eval shows net-neutral-or-better, **zero new severe errors** | Additive nullable column / new optional contract field | High if model/prompt/dosing-adjacent; else Med |
| **MAJOR** `x._._` | Breaking change to a public contract | Behavior change that alters Rx outputs on the golden set; model-family swap | Breaking DDL (drop/rename/retype), required-field add, Rx-schema field removal | **High → mandatory human review** (§6); MAJOR schema = potentially **Critical** (§6) |

> **Hard rule:** a model-family swap (e.g. one Claude tier → another) or any change that moves dosing-relevant numbers on the golden set is **never** a PATCH. If the eval base-vs-branch diff shows *any* output delta on dosing/safety cases, the bump is at least MINOR and the PR is auto-retagged High risk by CI.

### 1.3 Compatibility & deprecation policy (the model-retirement firewall)

- **Pin exact, never float.** No `latest`, no `@^`, no dated-id-without-monitor. Vendor model ids and CDN script versions are **exact, lockfile-committed, SRI-protected**.
- **Deprecation windows.** A versioned artifact marked `deprecated` carries a `sunset:` date in its front-matter. CI **fails** if a `deprecated` artifact is still referenced past `sunset - 14d` without an open migration task (trace ID).
- **Vendor-deprecation monitor.** A scheduled job polls vendor deprecation feeds (Anthropic model lifecycle, ABDM profile bumps) and opens a **High-risk tracking issue** the moment a pinned id is announced for retirement — turning the silent break into a tracked, gated change with lead time. (Detail in `supply_chain.md`; the alarm path is in `observability.md`.)
- **N-1 fallback always live.** For the Claude model and any other swappable vendor, the config adapter declares a **`primary` and a pre-validated `fallback`** that has itself passed the eval gate. Rollback = flip primary→fallback (§7.1, §10).

### 1.4 Dose engine: frozen contract, independently versioned

The dose engine is the dosing source of truth and AI never does arithmetic — so it is the one artifact whose **public contract is frozen** and whose every change is treated as the highest-blast-radius change in the system.

```text
dose-engine.js (DOSE_ENGINE_VERSION = "x.y.z")
  public API (frozen): computeDose(drug, patient, route) -> { value, unit, rounded, max_check }
  ── PATCH: rounding/edge fix, identical results on the golden dosing cases except the fixed case
  ── MINOR: new drug band / new route, no change to existing results
  ── MAJOR: any change to an existing computed result  → ALWAYS High risk, ALWAYS eval-gated,
            ALWAYS requires a new/updated golden case documenting the intended delta
```

A change to `dose-engine.js` that alters an existing golden-case result **without** a paired golden-case update **hard-fails** the eval gate. You cannot quietly change a dose.

---

## 2. Changelog & release notes discipline

- **Conventional Commits** are mandatory (`feat:`, `fix:`, `perf:`, `chore:`, `refactor:`, `docs:`, plus scopes `feat(dose):`, `fix(prompt):`, `feat(schema):`). CI lints commit messages; a non-conforming message **fails the PR**.
- **`CHANGELOG.md`** (Keep-a-Changelog format) is generated from Conventional Commits at release; a release with no changelog delta **fails** the release gate.
- **`PROMPTS_CHANGELOG.md`** separately records every prompt/model/effort change with: version delta, the eval diff summary (Δ severe errors, Δ cost, Δ latency), the fallback target, and the ADR link. This is the human-readable audit of "why does the model behave differently than last week."
- **Release notes** for any patient-facing release name the **risk tier**, the **migrations included**, the **flags toggled**, and the **rollback procedure** verbatim.

---

## 3. ADR discipline — Architecture Decision Records

ADRs are the durable memory of *why*. The digest's swappability clause has teeth only if every binding decision is recorded as an ADR that can be cited, superseded, and traced.

### 3.1 When an ADR is **mandatory** (CI-enforced)

A PR that does any of the following **must** add an ADR or it fails the `adr-required` check:

- Changes a **canonical tooling decision** from the digest's §1 table (swappability clause).
- Changes the **model policy** (model id, model family, reasoning-effort default, fallback choice).
- Introduces or removes an **architectural boundary** (a new bounded context, port/adapter, anti-corruption layer).
- Makes a **MAJOR** version bump on any contract, schema, or the dose engine.
- Changes a **safety invariant** (a fitness-function rule, a never-event definition, the sign-off-before-issue rule).
- Adopts/retires a **dependency** with supply-chain impact.

### 3.2 ADR format (MADR-style, `docs/adr/NNNN-kebab-title.md`)

```markdown
---
adr_id: ADR-0007
trace_id: ADR-0007
title: Pin and version the Claude model id behind the config adapter
status: accepted        # proposed | accepted | superseded | deprecated
date: 2026-06-25
deciders: [eng-lead, physician-reviewer]
supersedes: []
superseded_by: []
risk_tier: high
relates_to: [ENG-DISC-09-CHANGE-MGMT-VERSIONING, model_policy]
---

## Context
The dated model id was hardcoded in the Edge Function and retired without warning,
breaking production. Decisions about the model were invisible and unversioned.

## Decision
The vendor model id, family, and reasoning-effort live ONLY in the centralized
config adapter, versioned as `model_policy vX.Y`, with a pinned `primary` and a
pre-validated `fallback`. A swap is a gated change (eval gate + this ADR + rollback).

## Consequences
+ Model swaps become scored, reversible changes; a fitness function forbids the id elsewhere.
+ The deprecation monitor can watch a single, declared dependency.
- Adds one indirection and a required ADR per model-policy change (accepted cost).

## Alternatives considered
- Keep inline id (rejected: the founding incident).
- Float to `latest` (rejected: removes the pin; trades silent break for silent drift).

## Verification / rollback
Eval gate green base-vs-branch; rollback = flip `primary`→`fallback` in config (drilled §10).
```

### 3.3 ADR lifecycle rules

- ADRs are **append-only and immutable** once `accepted`. You do not edit a decision; you **supersede** it with a new ADR that sets `superseded_by` on the old one (CI checks the back-link resolves).
- An **ADR index** (`docs/adr/README.md`) is generated; a CI job fails if any ADR referenced in code/front-matter does not resolve, or if a `superseded` ADR is still cited as authority.
- The **traceability matrix** (see `drift_control.md`) links `spec clause ↔ ADR ↔ task ↔ code ↔ test ↔ eval`. A safety-critical decision with no verifying test/eval fails the matrix job.

---

## 4. Schema & data migrations — verified, reversible, drilled

Migrations are the highest-stakes change type after dosing logic: they touch patient data and cannot be "guessed." The current repo has hand-edited `.sql` files in `radhakishan_system/schema/` with **no migration runner, no version table, no down-migrations** — this section replaces that.

### 4.1 Migration framework & contract

| Concern | Decision |
|---|---|
| **Runner** | Versioned, ordered SQL migrations (Supabase CLI migrations / `supabase db push` against a tracked `schema_migrations` ledger). Swappable via ADR. |
| **Naming** | `migrations/NNNN_<verb>_<subject>.up.sql` + paired `NNNN_<verb>_<subject>.down.sql`. Monotonic `NNNN`. |
| **Pairing** | **Every `up` has a `down`.** A migration PR with an `up` and no `down` (or a `down` that is a no-op for a reversible change) **fails CI**. Irreversible-by-nature migrations require an explicit `-- IRREVERSIBLE: <reason>` marker + ADR + Critical-tier human confirm (§6). |
| **Idempotency** | Migrations use `IF NOT EXISTS` / guarded DDL where safe; the runner records applied versions in `schema_migrations` so re-runs are no-ops. |
| **Transactionality** | Each migration runs in a transaction where the DB supports it; non-transactional DDL (e.g. some index builds) is isolated into its own migration and flagged. |
| **No destructive DDL without expand/contract** | Drops/renames/retypes go through the **expand → migrate → contract** pattern (§4.3). A bare `DROP`/`ALTER ... TYPE`/`RENAME` on a populated table is a **Critical** change (§6). |

### 4.2 Migration verification pipeline (machine-checked, blocks merge)

```text
                    MIGRATION CHANGE → MERGE GATE
  ┌───────────────────────────────────────────────────────────────────────┐
  │ 1. up/down pairing present ............................ fail if missing │
  │ 2. spin EPHEMERAL db from current schema ............................. │
  │ 3. apply ALL prior migrations + this up .............. must succeed ... │
  │ 4. load REPRESENTATIVE seed (scrubbed, no PHI) ....................... │
  │ 5. run post-migration assertions (row counts, NOT NULL,             │
  │    FK integrity, CHECK constraints, RLS policies present) .. fail-on-x │
  │ 6. apply the DOWN migration .......................... must succeed ... │
  │ 7. assert schema == pre-migration baseline (drift diff) .. fail-on-Δ . │
  │ 8. re-apply UP (idempotency / replay) ................ must succeed ... │
  └───────────────────────────────────────────────────────────────────────┘
            ALL green ⇒ migration is mergeable. ANY red ⇒ blocked.
```

This is the **rollback drill, automated on every migration PR**: step 6–7 *prove the down-migration actually returns to baseline* before the change is ever allowed near production. A down-migration that does not restore the baseline schema fails the build.

### 4.3 Expand/contract (zero-downtime, reversible) for breaking schema change

Never break readers and writers in one step. A rename/retype/drop is staged across releases so each step is independently deployable and reversible, gated by a feature flag.

```text
  Release N    EXPAND   : add new column/table (nullable, additive). Old code still works.
  Release N    BACKFILL : migrate data old→new in a batched, resumable, idempotent job.
                          Dual-write behind flag `schema.dual_write.<x>` so both shapes stay valid.
  Release N+1  MIGRATE  : flip readers to new shape behind flag `schema.read_new.<x>`; verify.
  Release N+2  CONTRACT : drop the old column/table ONLY after telemetry confirms zero readers.
                          This is the only step that is hard to reverse → Critical-tier confirm.
```

- **Backfills** are batched, resumable (checkpointed), idempotent, rate-limited to protect the live DB, and **observable** (progress metric + alarm on stall). A backfill that touches patient rows never logs PHI.
- Each stage's flag is removed (flag-debt cleanup, §5.4) once `CONTRACT` is shipped.

### 4.4 Data migrations (content, not structure)

Bulk data changes (re-importing the 530-drug formulary, re-keying 446 protocols, LOINC/SNOMED remaps) follow the same up/down + ephemeral-verify discipline, plus:
- **Dry-run + diff report** required: the migration prints the exact rows it will change; a human reviews the diff for High/Critical tiers.
- **Snapshot before apply** in any environment with real data; the snapshot id is recorded in the change's audit envelope as the rollback target.
- Reference data (formulary/protocols) is itself **versioned** so a bad import can be rolled back to the prior versioned dataset.

---

## 5. Feature flags — decoupling deploy from release

Flags let us **deploy code dark** and **release behavior gradually**, which is what makes shadow/pilot rollout (§9) possible without a big-bang.

### 5.1 Flag taxonomy

| Flag type | Lifespan | Example | Removal policy |
|---|---|---|---|
| **Release / rollout** | Short (days–weeks) | `rx.streaming_generation`, `rollout.pilot_cohort` | Removed at 100% rollout; tracked as flag-debt |
| **Ops / kill-switch** | Long-lived | `killswitch.rx_generation`, `killswitch.abdm_sync` | Permanent; audited quarterly |
| **Experiment** | Bounded by experiment | `exp.prompt_v3_shadow` | Removed when experiment concludes |
| **Permission / tier** | Long-lived | `cohort.pilot_doctors` | Lives with the capability |

### 5.2 Flag governance (CI-enforced)

- **Registry, not scattered booleans.** Every flag is declared in a central `flags/registry.(ts|json)` with: `key`, `type`, `owner`, `default`, `created`, `sunset` (for short-lived), `risk_tier`. A flag read in code that is **not** in the registry **fails a fitness function**.
- **Default off + fail-safe.** A flag's *off/error* path must be the **safe** path. For clinical flags the safe default is "preserve the proven existing behavior, keep mandatory physician sign-off." A flag that fails open into an unsafe path is a never-event.
- **Symmetric-actor evaluation.** Flag evaluation is logged on the command bus with `actor`, cohort, and resolved value — so a pilot doctor's session and an agent's session are equally auditable.
- **No flag gates dosing correctness.** Flags may gate *rollout* of a feature, never the dose-engine result itself. Dosing is always computed by the engine regardless of flag state (fitness-function invariant).

### 5.3 Kill-switches (mandatory for clinical paths)

Every patient-facing AI path ships with a **kill-switch** that reverts to the last-known-good behavior **without a deploy**:

```text
killswitch.rx_generation = ON  → AI generation enabled (normal)
killswitch.rx_generation = OFF → fall back to: deterministic template + manual entry,
                                  physician sign-off still mandatory, NO patient impact
```

The kill-switch is the **fastest rollback primitive** (seconds, config-only) and is the first thing tried in an incident (§10). It is tested in the rollback drill, not assumed.

### 5.4 Flag-debt control

A flag past its `sunset` date with no open removal task **fails CI**. Stale flags are a known source of incidents; we treat them as expiring debt.

---

## 6. Risk tiers govern change depth (binding routing)

The digest's risk tiers determine *how much ceremony a given change needs*. Restated here as it applies to versioning, migrations, and flags:

| Risk tier | Triggers (change-mgmt view) | Gate |
|---|---|---|
| **Low** | PATCH refactor, docs, presentational tweak, additive non-clinical flag | automated gates only |
| **High → mandatory human review** | any model/prompt/reference change; dose-engine change; MINOR+ schema; new migration; Rx-contract change; new clinical flag | full eval gate **+ named human approver** (physician for clinical-quality surfaces, eng-lead for structural) before merge |
| **Critical → explicit confirm even with auto-approve** | destructive DDL (drop/rename/retype on populated table), data-drop, prod data migration, force-push, model-family swap at rollout | **stop, confirm with a human**; staged via expand/contract; snapshot taken; rollback drilled before apply |

CI auto-assigns the tier from the changed paths and the SemVer delta; an agent **cannot** downgrade its own tier (the tier label is a CI output, not a PR input).

---

## 7. The model-policy change — the founding incident, fully governed

### 7.1 Centralized config adapter (the single source of model truth)

```ts
// config/model-policy.ts  — the ONLY place a vendor model id may appear (fitness-function enforced)
export const MODEL_POLICY = {
  version: "2.3",                       // model_policy vX.Y, bumped on every change, ADR-linked
  rx_generation: {
    primary:  "claude-<pinned-exact-id>",     // pinned, NOT dated-floating, NOT `latest`
    fallback: "claude-<pinned-prevalidated-id>", // has itself PASSED the eval gate
    reasoning_effort: "high",           // changes here are versioned + eval-diffed
    deprecation_watch: true,            // monitored by the vendor-deprecation job
  },
} as const;
```

A fitness function (`model-id-in-config-only`) fails the build if any vendor model id literal appears outside this adapter. This makes the founding incident's "hardcoded id in the Edge Function" **structurally impossible**.

### 7.2 The governed model-swap procedure (replaces guesswork)

```text
1. DoR     trace ID; tagged HIGH risk (model policy); eval cases identified;
           "new golden cases required?" answered.
2. RED     if a new failure mode is in scope, add the golden case FIRST.
3. CHANGE  edit model id / effort ONLY in config/model-policy.ts; bump model_policy version;
           add ADR (mandatory, §3.1); update PROMPTS_CHANGELOG.md.
4. EVAL    promptfoo runs golden set BASE vs BRANCH:
             • never-events 100% pass, severe-error count = 0  → else HARD FAIL
             • soft-quality ≥ threshold; cost + latency within budget
             • PR comment posts the diff (Δ severe / Δ cost / Δ latency, improved/regressed cases)
5. STRUCT  fitness functions confirm id stayed in config, vendor stayed behind adapter.
6. REVIEW  adversarial agent probes for missed regressions / injection; named human approves on DATA.
7. SHIP    fallback already pre-validated; rollback documented; online eval watches live quality.
```

The decision that was once made by guesswork is now a **scored base-vs-branch diff, gated on never-events, with a live fallback**.

---

## 8. Release process — tag, gate, evidence, promote

### 8.1 Release pipeline (supersedes the zero-gate `deploy-pages.yml`)

```text
   feature/worktree ──PR──▶ MERGE GATE ──merge──▶ main ──tag vX.Y.Z──▶ RELEASE GATE ──▶ ROLLOUT (§9)
        │                       │                                          │
        │ pre-commit (advisory) │ unbypassable, branch-protected           │ environment-protected
        ▼                       ▼                                          ▼
  fast local mirror     full gate matrix (quality_gates_ci.md)     re-run contracts + eval smoke,
                        + version-bump check + changelog            build SBOM, attach evidence bundle,
                        + ADR-required + migration verify           require reviewers + manual prod gate
                        + flag-registry check
```

### 8.2 What a release **is**

A release is an **immutable tagged artifact** (`vX.Y.Z`) with an attached **evidence bundle**:

- [ ] Eval report (base-vs-branch diff; never-events pass; severe-error = 0) for any model/prompt/schema change.
- [ ] Migration verification log (up+down+idempotency green on ephemeral DB).
- [ ] Fitness-function + contract + SAST + secret-scan + SBOM results.
- [ ] Changelog + prompts-changelog deltas.
- [ ] Risk tier, flags toggled, **rollback procedure**, and the **rollback target** (previous tag / fallback model / pre-migration snapshot id).
- [ ] Any ADRs added.

A tag without a complete evidence bundle **cannot promote to production** (release gate hard-fail).

### 8.3 Deploy vs release (decoupled)

- **Deploy** = code is on the server (possibly dark behind flags). Cheap, frequent, reversible.
- **Release** = behavior is turned on for users, gradually, via flags + cohorts (§9).
  This decoupling is what lets us ship continuously while exposing patients to change slowly.

### 8.4 Coordinated multi-artifact releases

When a change spans web + Edge Function + schema (common here), the release plan declares **deploy order** and **backward-compat windows**:

```text
schema (expand, backward-compatible)  →  Edge Function (reads old OR new)  →  web (uses new)
                              CONTRACT step deferred to a later release (§4.3)
```

Old and new versions must interoperate during the rollout window — enforced by contract tests that run *both* schema versions against the function.

---

## 9. Safe, incremental rollout — latency slice first, then shadow, then pilot, **never big-bang**

This is the core of the rollout doctrine. The current system big-bangs every push straight to all users via Pages with zero gates. We replace that with a staged exposure where the **clinical-safety bar and mandatory physician sign-off hold at every stage**.

### 9.1 The rollout staircase

```text
 STAGE 0  INTERNAL          off-edge async + STREAMING generation slice (the latency fix),
          (latency slice)   behind flag, internal cohort only. No clinical-output change ⇒
                            lowest-risk first slice. Proves the new path end-to-end.
            │  promote on: green gates + SLOs met internally
            ▼
 STAGE 1  SHADOW            new path runs IN PARALLEL with the live path on real traffic,
          (no patient       output is SCORED by online eval but NEVER shown to patient/doctor.
           exposure)        Compare shadow vs prod: Δ severe errors, Δ latency, Δ cost, Δ timeout-rate.
            │  promote on: shadow ≥ prod on never-events & severe-error; SLOs met; N cases observed
            ▼
 STAGE 2  PILOT             enable for a SMALL named cohort (e.g. pilot doctors / one clinic-day),
          (small cohort,    via `cohort.pilot_*` flag. Physician sign-off mandatory. Tight alarms.
           real exposure)   Online eval + error budget watched live; instant kill-switch armed.
            │  promote on: pilot error budget intact; no severe online events; physician sign-off rate healthy
            ▼
 STAGE 3  CANARY %          ramp 5% → 25% → 50% → 100% of traffic, holding at each step
          (progressive)     for a bake window; auto-halt + rollback on alarm (§10).
            │  promote on: each step's SLO/eval/error-budget checks green for the bake window
            ▼
 STAGE 4  GENERAL           100%. Remove rollout flags (flag-debt cleanup). Keep kill-switch.
```

### 9.2 Promotion criteria are **data gates**, not dates

No stage advances on a calendar. Each promotion requires, automatically checked:

| Gate at each stage | Source |
|---|---|
| Never-events = 0, severe online-eval score = 0 | online eval (Braintrust) |
| p95 latency + timeout-rate within SLO | observability SLOs |
| Error budget not burning | observability error budgets |
| Cost within budget | eval/cost telemetry |
| (Pilot+) physician sign-off rate healthy, no clinician-reported safety events | sign-off telemetry + incident channel |

A stage that breaches any gate **auto-halts** and triggers the rollback path (§10). This is the anti-big-bang guarantee: exposure only ever increases when the data says it is safe to increase it.

### 9.3 The first slice is deliberately low-risk

The first vertical slice is **off-edge async + streaming generation** — moving Rx generation off the Edge Function constraint and streaming results. It is chosen first **because it changes latency, not clinical output**, so Stage-0/Shadow can validate the new execution path with minimal patient-safety blast radius before any behavior change rides on it. Subsequent slices expand vertically through the same staircase.

---

## 10. Rollback drills — pre-validated, fast, rehearsed (not theoretical)

The founding incident had **no rollback path**. Every change now ships with one, and we *drill* it so it works under pressure.

### 10.1 Rollback primitives, fastest first

| Primitive | Reverts | Speed | When |
|---|---|---|---|
| **Kill-switch flag flip** | AI path → last-known-good template + manual entry | seconds, config-only, no deploy | first response to any clinical-quality incident |
| **Model fallback flip** | `primary` → pre-validated `fallback` model | seconds, config-only | model-quality / model-retirement incident |
| **Rollout halt + cohort off** | pilot/canary cohort back to old path | seconds, flag-only | staged-rollout alarm |
| **Re-deploy previous tag** | code → previous `vX.Y.Z` artifact | minutes | code regression not covered by a flag |
| **Down-migration** | schema → previous version (drilled in CI §4.2) | minutes | bad migration caught early, before CONTRACT |
| **Snapshot restore** | data → pre-migration snapshot | longer, Critical-tier | data corruption; last resort, human-confirmed |

> **Order of operations in an incident:** flag/kill-switch first (stop the bleeding), then fallback model, then halt rollout, *then* consider re-deploy or down-migration. Restore-from-snapshot is the last resort and always human-confirmed.

### 10.2 The rollback is part of the change, not an afterthought

A High/Critical PR's DoD includes a **named, specific rollback procedure** and a **named rollback target** in its evidence bundle. "We'll figure it out" is not a rollback plan and fails review. For migrations, the down-migration is **proven** by the automated drill (§4.2) before merge.

### 10.3 Scheduled rollback fire-drills (rehearsed, runbooked)

We rehearse rollback so it is muscle memory, not improvisation:

- **Quarterly game-day**, in a staging environment with scrubbed data, exercising each primitive end-to-end against a deliberately broken change.
- **Named runbooks** for the foreseeable incidents, each with: detection signal, decision criteria, exact commands, verification step, and owner. Mandatory runbooks:
  - `RUNBOOK: model retired / deprecated` (the founding incident) — detect via deprecation monitor / error spike → flip to pre-validated fallback → verify via online eval → open governed swap task.
  - `RUNBOOK: bad migration` — detect via post-deploy assertion failure → apply down-migration → verify schema baseline → root-cause.
  - `RUNBOOK: eval/quality regression in prod` — detect via online severe-error alarm → kill-switch to template → bisect change → governed re-ship.
  - `RUNBOOK: timeout-rate / SLO breach` — detect via SLO alarm → halt rollout / kill-switch → investigate.
- A runbook is **valid only if it was executed in the last game-day**; an un-drilled runbook is flagged stale.

### 10.4 Post-incident discipline

Every rollback triggers a **blameless post-incident review** that produces: the timeline, the root cause, the **new golden eval case or fitness function** that would have caught it (added before close), and any ADR the incident demands. The incident's lesson becomes a permanent gate — that is how the founding incident produced this entire file.

---

## 11. Change-management gate ledger (what blocks merge vs deploy)

Legend: **MERGE** = required PR status check. **DEPLOY** = required release/promote check. **HITL** = additionally requires a named human approver (§6).

| # | Gate | Blocks MERGE | Blocks DEPLOY | Hard-fail condition |
|---|---|:---:|:---:|---|
| C1 | **Conventional-commit lint** | ✅ | — | Any commit message non-conforming. |
| C2 | **Version-bump present & correct tier** | ✅ | — | Changed artifact without a SemVer bump, or bump too low for the eval-detected blast radius. |
| C3 | **Changelog / prompts-changelog delta** | ✅ | ✅ | Release with no changelog entry; model/prompt change with no prompts-changelog entry. |
| C4 | **ADR-required** | ✅ | — | Trigger in §3.1 met but no ADR added/updated; or dangling `superseded_by`. |
| C5 | **Migration up+down pairing** | ✅ | — | `up` without `down` (or no-op `down` for a reversible change) and no `IRREVERSIBLE` marker+ADR. |
| C6 | **Migration verify drill** | ✅ | ✅ (re-run) | Ephemeral apply → down → baseline-diff → re-up not all green. |
| C7 | **Flag registered & fail-safe** | ✅ | — | Flag read not in registry; flag default not the safe path; flag past `sunset` with no removal task. |
| C8 | **Eval gate (model/prompt/schema)** | ✅ | ✅ (smoke) | Never-event >0, severe-error >0, soft-quality < threshold, or cost/latency over budget. |
| C9 | **Risk-tier human review** | ✅ (HITL) | — | High/Critical change without named approver. |
| C10 | **Evidence bundle complete** | — | ✅ | Tag promoted without full evidence bundle + named rollback target. |
| C11 | **Rollback target named & (for migrations) proven** | ✅ (High/Crit) | ✅ | High/Critical change with no rollback procedure/target; migration with unproven down. |
| C12 | **No `deprecated`-past-sunset references** | ✅ | — | A deprecated artifact still referenced past its sunset window without a migration task. |

A gate that can be satisfied by assertion is not a gate. Every row is a machine check with a defined pass/fail oracle; no admin override, no `--no-verify`, no self-approval on protected `main`.

---

## 12. Anti-patterns this file forbids (and the gate that catches each)

| Anti-pattern | Why it's banned | Caught by |
|---|---|---|
| Hardcoded / dated / `latest` vendor model id | the founding incident | fitness fn `model-id-in-config-only` (C8 surface) + supply-chain pin |
| Hotfix model/prompt swap with no eval | guesswork shipping to patients | C8 eval gate + C9 HITL |
| `up` migration with no `down` | irreversible by accident | C5 + C6 |
| Bare `DROP`/`RENAME`/`ALTER TYPE` on populated table | data loss, broken readers | C6 + Critical tier (§6) + expand/contract (§4.3) |
| Big-bang push straight to all users | the current `deploy-pages.yml` | release gate (§8) + rollout staircase (§9) |
| Changing a dose-engine result silently | unsafe dose drift | dose-engine MAJOR rule (§1.4) + eval golden-case pairing (C8) |
| Flag that fails open into unsafe path | clinical never-event | C7 fail-safe-default check |
| ADR edited in place / decision rewritten | lost audit trail | ADR immutability + supersede back-link (C4) |
| Stale flag never removed | latent incident source | C7 sunset check (§5.4) |
| "We'll figure out rollback later" | no recovery under pressure | C11 named-rollback requirement + game-day drill |

---

## 13. Worked end-to-end: shipping the latency-fix slice safely

**Scenario:** ship the off-edge async + streaming generation slice (Stage 0 of the rollout) — the deliberately low-risk first slice.

1. **DoR.** Task gets a trace ID, links to its spec clause, risk tier = **High** (touches the Rx-generation path) but **clinical output unchanged** is the explicit acceptance criterion. Rollback target = previous tag + `killswitch.rx_generation`.
2. **RED.** Failing E2E + contract tests written first asserting identical Rx output via the new streaming path; an eval case asserts **byte-equivalent dosing facts** old-path vs new-path.
3. **IMPLEMENT.** New path behind flag `rx.streaming_generation` (registered, default off, fail-safe to old path). No model/prompt change ⇒ no model-policy bump; SemVer **MINOR** (additive feature).
4. **MERGE gates.** Version bump (C2), changelog (C3), flag registered + fail-safe (C7), eval gate confirms **zero output delta / zero new severe errors** (C8), fitness functions green (dose engine still sole dosing path), HITL approval (C9). No migration ⇒ C5/C6 n/a.
5. **DEPLOY (dark).** Tag `vX.Y.0` with full evidence bundle (C10) + named rollback (C11). Code deployed, flag **off** — patients see nothing.
6. **ROLLOUT staircase (§9).** Stage 0 internal → Stage 1 **shadow** (new path scored online vs prod, never shown) → Stage 2 **pilot** cohort → Stage 3 **canary** ramp → Stage 4 GA. Each promotion is a **data gate**; any breach auto-halts and flips the kill-switch.
7. **STEADY STATE.** Rollout flags removed (flag-debt clean), kill-switch retained, online eval + SLO alarms watching. The model deprecation monitor watches the pinned model id so the next retirement is a tracked, gated, rollback-ready change — **not** a midnight production break.

**Result:** the slice that *was* a zero-gate big-bang push is now a versioned, ADR-traceable, eval-gated, flag-decoupled, shadow-then-pilot rollout with a drilled, named rollback at every step. That is change management answering from data, not guesswork.

---

## 14. Honest caveats (carry forward)

- **A rollback drill proves the mechanism, not every scenario.** Game-days cover the foreseeable incidents; novel failures will still happen — the discipline is to convert each into a new runbook + gate (§10.4), not to claim completeness.
- **Expand/contract costs latency and discipline.** Multi-release schema changes are slower than a single `ALTER`; that slowness is the price of reversibility and zero-downtime, and it is intentional for patient-data tables.
- **Feature flags are themselves debt.** Every flag adds a code path and a state to reason about; the sunset/flag-debt gate (C7, §5.4) keeps the count bounded, but flags are a tool to retire, not accumulate.
- **This is engineering rigor, not regulatory clearance.** CDSCO is the binding regulator. Versioning, drilled rollback, and staged rollout reduce *operational* risk; **mandatory physician sign-off and severe-error gating remain the real clinical safety backstop** at every rollout stage.
- **SemVer-to-risk binding is a heuristic.** It signals review depth well but is not a substitute for the eval diff; when the SemVer label and the eval blast radius disagree, **the eval data wins** and CI auto-escalates the tier.

---

## Appendix A — Quick reference card

```text
EVERYTHING CHANGEABLE HAS A VERSION  → app, edge fns, prompt, MODEL ID, schemas, dose engine, eval set
SEMVER = BLAST RADIUS                → PATCH (neutral) / MINOR (additive) / MAJOR (breaking → High/Critical)
ADR FOR EVERY BINDING DECISION       → docs/adr/NNNN-*.md, immutable, supersede-don't-edit
MIGRATIONS: up+down, verified, drilled→ ephemeral apply→down→baseline-diff→re-up, all green or blocked
DESTRUCTIVE SCHEMA = EXPAND/CONTRACT → never break readers+writers in one step; Critical-tier confirm
FLAGS DECOUPLE DEPLOY FROM RELEASE   → registered, fail-safe default, kill-switch on every clinical path
ROLLOUT STAIRCASE, NEVER BIG-BANG    → latency slice → shadow → pilot → canary % → GA, data gates only
ROLLBACK PRE-VALIDATED & DRILLED     → kill-switch first, fallback model, halt, redeploy, down-migrate, restore
MODEL SWAP = GATED CHANGE            → config-only id + eval diff + ADR + pre-validated fallback (never a hotfix)
```

> **The whole file in one line:** the model-retirement break happened because the most critical dependency had no version, shipped as a hotfix, and had nowhere to roll back to — so now *every* changeable artifact is versioned, *every* risky change is a gated change, and *every* change ships with a drilled rollback before it reaches a single patient.
