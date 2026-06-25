---
doc_id: ENG-DISC-DRIFT-001
title: Drift Control — Structural, Behavioral, and Spec Drift
layer: engineering-discipline
status: binding
applies_to: rebuild (agent-built pediatric OPD prescription system)
spec_independent: true
authority: |
  Conforms to OPERATING-MODEL DIGEST. Where this file disagrees with the digest,
  the digest wins until amended via ADR. This file is methodology/governance only;
  it does NOT define the product architecture (authored in parallel, married later).
trace_id: TRACE-ENG-DRIFT
owner: eng-lead
last_reviewed: 2026-06-25
---

# Drift Control

> **One-line thesis.** Three kinds of drift kill an agent-built clinical system: the code stops obeying the architecture (**structural**), the model output stops being clinically safe (**behavioral/quality**), and the code stops matching the spec (**spec**). We block all three with **machine-checkable gates an actor cannot bypass** — fitness functions + contract tests for structure, eval gates for behavior, single-source-of-truth generation + a traceability matrix for spec. A change must pass **every** relevant axis to merge. "Done = proven + gated, never declared."

This document is the authority for **Axiom 1 (Done = proven + gated)**, **Axiom 2 (Enforce in CI, not in convention)**, and **Axiom 3 (Answer from data, not guesswork)** as they apply to keeping **spec ↔ code ↔ runtime in lockstep**. The founding counter-example — a hardcoded dated Claude model id retired mid-production today, then fixed by **guesswork with no eval harness** — is the incident this entire file exists to make impossible.

---

## 0. The three drift axes (and why each needs its own gate)

| Axis | Question it answers | Detection mechanism | Gate verb | Speed vs human review |
| --- | --- | --- | --- | --- |
| **Structural drift** (§2) | Does the code still obey the architecture? | Architecture **fitness functions** + **contract tests** at every port/API/event seam | **Fail the build** | Faster — catches "agent crossed a boundary" before a human ever reads the diff |
| **Behavioral / quality drift** (§3) | Does the *output* still meet clinical quality & safety? | **Versioned golden eval set** + scorers + never-events suite | **Fail the build** | Catches "model now gives subtly worse/unsafe Rx" no structural check can see |
| **Spec drift** (§4) | Does the code still match the spec we agreed to? | **Single-source-of-truth generation** + **spec↔task↔code↔test↔eval traceability matrix** | **Fail the build** | Catches "skeleton/schema/types diverged from spec" before they rot silently |

> **Why three, separately gated.** Any one axis alone is insufficient. A change can be architecturally clean (passes fitness functions) yet clinically degraded (fails evals). It can pass both yet implement a clause that no longer exists in the spec (spec drift). Each axis is an **independent veto**; a green merge requires unanimity across the axes relevant to the change.

```
                         ┌─────────────────────────────────────────────┐
   change (human OR ─────▶│   CI GATE MATRIX — all relevant axes must    │
   agent command)        │   be GREEN or the merge is blocked           │
                         └───────────────┬─────────────────────────────┘
            ┌──────────────────────────────┼──────────────────────────────┐
            ▼                              ▼                              ▼
  ┌───────────────────┐        ┌───────────────────────┐      ┌────────────────────┐
  │ STRUCTURAL (§2)   │        │ BEHAVIORAL (§3)        │      │ SPEC (§4)          │
  │ fitness functions │        │ golden eval set        │      │ SSoT generation    │
  │ + contract tests  │        │ + never-events suite   │      │ + traceability     │
  │ dependency-cruiser│        │ promptfoo / DeepEval   │      │ matrix (trace IDs) │
  │ ESLint / AST grep │        │ dose-engine cross-check│      │ generated-in-sync  │
  │ Ajv / Pact / FHIR │        │ severity scorecard     │      │ CI check           │
  └───────────────────┘        └───────────────────────┘      └────────────────────┘
            │                              │                              │
            └──────────────── ALL GREEN ───┴──────────── ALL GREEN ───────┘
                                           │
                                           ▼
                              supply-chain pinning gate (§5)
                              (lockfiles, SBOM, SRI, model-id-in-config)
                                           │
                                           ▼
                                        MERGE
```

---

## 1. Canonical tooling for drift control (FIXED — swappable only via ADR)

These rows are the subset of the digest's §1 table that this file owns. They are **binding** so every other discipline file composes against the same tools. Any swap requires an ADR that (a) names the replacement, (b) proves it satisfies the same gate contract, and (c) updates the digest.

| Drift concern | Canonical tool | Encodes | Swap cost |
| --- | --- | --- | --- |
| Structural — layer/boundary/circular | **dependency-cruiser** | hexagonal ports/adapters, no-circular, domain ⇏ vendor SDK | Low |
| Structural — invariant rules | **ESLint flat config** (custom rules) + **AST/grep fitness tests** | `esc()`-XSS, dose-engine-only-dosing, sign-off-before-issue, model-id-in-config | Low |
| Contract — Claude tool I/O + Rx output | **JSON Schema + Ajv** | machine-checkable structure at the AI seam | Med |
| Contract — ABDM FHIR R4 boundary | **Pact-style provider verification** + **HL7 FHIR validator** (R4 profiles) | regulator-adjacent external contract | Med |
| Behavioral — primary CI eval gate | **promptfoo** (GitHub Action, base-vs-branch diff) | deterministic assertions + never-events + cost/latency, PR-comment diff | Low |
| Behavioral — rich LLM-judge rubrics | **DeepEval** (pytest, G-Eval) | soft medical-faithfulness scoring (non-blocking / high threshold) | Low |
| Behavioral — online eval (prod) | **Braintrust** | prod-miss → golden case, live quality scoring | Med |
| Spec — traceability + decisions | **Markdown ADRs** + **YAML front-matter trace IDs** + generated **matrix** | spec↔task↔code↔test↔eval spine (IEC-62304-style, right-sized) | Low |
| Spec — codegen | **schema→types** (Supabase typegen / `quicktype`), **OpenAPI→clients** (`openapi-typescript`) | single source of truth, hand-sync banned | Low |
| Supply-chain — pinning/monitoring | **Lockfiles committed**, **Renovate** (security auto-merge only), **CycloneDX SBOM**, **SRI** on every CDN `<script>`, **gitleaks** | Shai-Hulud / GhostAction-era hardening; model-id firewall | Low |

CI/CD platform is **GitHub Actions**; branch model is **trunk-based with protected `main`**; backend tests run on **Deno test**, frontend/shared on **Vitest**, E2E on **Playwright** (digest §1). These are assumed throughout.

---

## 2. STRUCTURAL drift control

> *Goal:* the architecture is **executable**. Architectural rules that a human or agent could break are encoded as tests that **fail the build**, not as review comments or wiki prose.

### 2.1 Architecture fitness functions

A fitness function is an automated test *of the architecture itself*. We **start with the 5 rules tied to the highest patient-safety risk** and accrete from there. Front-load the gates that block harm; do not front-load enterprise ceremony.

| # | Fitness function | Rule | Risk if violated | Tool |
| --- | --- | --- | --- | --- |
| F1 | **esc()-XSS** | Every `innerHTML =` (or equiv.) in `web/**` with a dynamic value must be wrapped in `esc()`. | Stored XSS in a patient-data UI. | ESLint custom rule + AST scan |
| F2 | **no-circular / boundary** | No circular deps; no cross-context internal imports; **domain code ⇏ vendor SDK** (must go through an adapter behind a port). | Anti-corruption layer bypassed; vendor lock-in leaks into domain. | dependency-cruiser |
| F3 | **dose-engine-only-dosing** | Dosing arithmetic exists **only** in the dose engine. AI/Edge paths must *call* it; no parallel math, no AI-computed numbers. | Wrong dose reaches a child. This is the cardinal safety boundary. | AST scan + ESLint + import allowlist |
| F4 | **sign-off-before-issue** | No code path issues/prints/transmits a prescription without an explicit doctor **sign-off event** on the command bus. | Unsigned Rx leaves the building; also the **regulatory firewall** keeping CDS a non-device. | AST flow check + fitness test |
| F5 | **no-secrets / model-id-in-config** | No secret literal **and no vendor model id** outside the centralized config adapter. | Secret leak; **the model-retirement incident class** (hardcoded model id). | gitleaks + grep/AST gate |

**Accretion policy.** Every production incident or near-miss that a structural rule *could* have caught spawns a new fitness function in the same PR that fixes the incident. The set only grows. Removing one requires an ADR.

#### dependency-cruiser — boundary rules (F2)

```js
// .dependency-cruiser.cjs  (illustrative — domain must not import a vendor SDK)
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'domain-no-vendor-sdk',
      comment: 'Domain may only reach vendors through a port/adapter (anti-corruption layer).',
      severity: 'error',
      from: { path: '^src/domain/' },
      to:   { path: 'node_modules/(@anthropic-ai|@supabase|fhir|tesseract)' },
    },
    {
      name: 'no-cross-context-internals',
      comment: 'Bounded contexts talk only via published contracts, never internal modules.',
      severity: 'error',
      from: { path: '^src/contexts/([^/]+)/' },
      to:   { path: '^src/contexts/(?!\\1)[^/]+/internal/' },
    },
  ],
};
```

#### ESLint flat config — invariant rules (F1, F3, F5)

```js
// eslint.config.js  (illustrative custom rules)
export default [
  {
    files: ['web/**/*.{js,html}'],
    rules: {
      // F1: dynamic innerHTML must be esc()-wrapped
      'rkh/no-unescaped-innerhtml': 'error',
    },
  },
  {
    files: ['src/**/*.ts', 'supabase/functions/**/*.ts'],
    rules: {
      // F3: forbid arithmetic on dose-related fields outside the dose engine
      'rkh/no-dosing-arithmetic-outside-engine': 'error',
      // F5: forbid model-id / secret literals outside config adapter
      'rkh/no-vendor-model-id-literal': 'error',
      'rkh/no-secret-literal': 'error',
    },
  },
];
```

#### AST/grep fitness test in CI (F3, F4, F5 — framework-agnostic backstop)

```bash
# scripts/fitness/dose-engine-only.sh  — CI fails if dosing math leaks outside the engine
set -euo pipefail
LEAK=$(grep -REn '(mg/kg|dose\s*[*/]|\*\s*weight|weight\s*\*)' \
  --include='*.ts' --include='*.js' src supabase/functions \
  | grep -v 'src/domain/dosing/dose-engine' || true)
if [ -n "$LEAK" ]; then
  echo "FITNESS F3 FAIL: dosing arithmetic found outside the dose engine:"; echo "$LEAK"; exit 1
fi

# scripts/fitness/model-id-in-config.sh  — F5: vendor model ids only in the config adapter
LEAK=$(grep -REn 'claude-[a-z0-9-]+' --include='*.ts' --include='*.js' --include='*.html' \
  src supabase web | grep -v 'src/config/model-config' || true)
[ -z "$LEAK" ] || { echo "FITNESS F5 FAIL: model id outside config adapter:"; echo "$LEAK"; exit 1; }
```

> **The model-id firewall (F5) in one sentence.** Vendor model ids are a *pinned dependency declared only in `src/config/model-config`*; a swap is therefore a **gated change** (eval gate + ADR + rollback, §3 & §5), never a hotfix — which is exactly the discipline absent during the founding incident.

### 2.2 Contract tests at every port / API / event seam

Every vendor seam and every internal port gets a **machine-checkable contract** so that a change on either side that breaks the agreed shape **fails a build** rather than surfacing in production.

| Seam | Contract artifact | Tool | Direction verified |
| --- | --- | --- | --- |
| Claude **tool inputs** (`get_reference`, `get_formulary`, `get_standard_rx`, `get_previous_rx`, `get_lab_history`) | JSON Schema per tool | **Ajv** | Edge ⇄ Claude |
| Claude **Rx output JSON** (4-row format, safety block, NABH block, `overall_status`) | JSON Schema | **Ajv** | Claude → app (also a behavioral assertion, §3.2) |
| **Command bus** commands & **events** | JSON Schema per command/event, with `actor`, `trace_id`, audit envelope | **Ajv** | producer ⇄ consumer (CQRS) |
| **DB ↔ app** | Generated types (§4.1) | typegen + `tsc` | schema → code |
| **ABDM FHIR R4** boundary | R4 profile + **consumer-driven contract** | **Pact-style provider verification** + **HL7 FHIR validator** | app ⇄ ABDM gateway |
| Frontend ↔ backend HTTP | **OpenAPI** spec → generated client (§4.1) | `openapi-typescript` + schema validation | client ⇄ server |

**Contract-test invariants enforced in CI:**

- **Every published command/event has a registered schema.** A producer that emits an unregistered or schema-violating message fails a contract test.
- **Provider verification runs against the consumer contract**, not a mock the provider authored. For ABDM, the consumer contract is pinned and the FHIR validator runs the R4 profiles — the gateway cannot be hotfixed, so the contract is the law.
- **Schema changes are versioned and additive by default**; a breaking change to any contract requires an ADR and a coordinated consumer bump.

```yaml
# Conceptual: contract gate in CI
- name: Contract tests (Ajv schemas)
  run: deno test --allow-read contracts/  # validates tool I/O, Rx output, bus messages
- name: FHIR R4 validation (ABDM)
  run: java -jar validator_cli.jar fixtures/abdm/*.json -version 4.0 -ig <abdm-igs>
- name: Pact provider verification (ABDM seam)
  run: deno task pact:verify
```

---

## 3. BEHAVIORAL / QUALITY drift control (evals)

> *Goal:* every model/prompt/reference/Rx-schema change is **scored against a versioned golden eval set before merge**. Behavioral drift is caught **like a regression**. We answer from data, never guesswork.

### 3.1 The golden eval set

| Property | Decision |
| --- | --- |
| **Size (v1)** | ~30–50 cases, grows from production misses. v1 is a **safety net, not proof of safety**. |
| **Format** | Version-controlled JSON; one case = clinical note + patient context (age/weight/allergies/labs) + **expected dosing facts** + **forbidden outputs** + **severity tag**. |
| **Coverage (mandatory edges)** | Neonates; preterms (corrected vs chronological age); renal/GFR-adjusted; allergy collisions; drug-drug interactions. **Not just easy AOM cases.** |
| **Train/test separation** | Strict. Cases used to tune a prompt are not the cases used to gate it. |
| **Growth source** | Online eval / prod misses promoted to golden cases (§5, Braintrust "prod miss → golden case"). |

```jsonc
// evals/golden/preterm-gfr-001.json  (illustrative shape)
{
  "id": "preterm-gfr-001",
  "trace_id": "TRACE-RX-DOSING-GFR",
  "severity_on_failure": "severe",
  "input": {
    "note": "32-week preterm, now 6 weeks chronological, suspected UTI...",
    "patient": { "ga_weeks": 32, "chrono_age_days": 42, "weight_kg": 2.1,
                 "allergies": ["amoxicillin"], "labs": { "creatinine": 0.9 } }
  },
  "expected_dosing_facts": [
    { "drug": "cefotaxime", "method": "weight-based+GFR-adjusted",
      "uses_corrected_age": true, "must_call_dose_engine": true }
  ],
  "forbidden_outputs": [
    "amoxicillin",                       // allergen collision
    "exceeds_max_dose",                  // never-event
    "uses_chronological_age_for_growth" // preterm rule violation
  ]
}
```

### 3.2 Eval layers (priority order — deterministic gates first, judges last)

| Layer | What it does | Blocking? | Tool |
| --- | --- | --- | --- |
| **L1 — Deterministic assertion (safety gate)** | JSON-Schema on Rx contract (4-row fields, safety block, NABH block present); **`javascript` assertions that call the real dose engine** and fail if AI numbers disagree; allergy-contraindication check; interaction presence; `overall_status` consistency; **cost + latency thresholds**. | **Yes — every relevant PR.** | promptfoo (`javascript`/schema asserts) |
| **L2 — Never-events suite** | ANY occurrence **hard-fails CI regardless of aggregate score**: exceeds max dose, prescribes a known allergen, missing NABH block. | **Yes — 100% pass required.** | promptfoo never-events tag |
| **L3 — Severity-weighted scorecard** | Tag each failure no-harm / mild / moderate / severe. **Severe-error count is the headline metric** (must = 0 to merge). Makes "traded a cosmetic regression for fewer severe errors" visibly correct. | **Yes — severe count = 0.** | promptfoo + scorecard |
| **L4 — LLM-judge (soft quality only)** | Rubric-based **G-Eval** for note completeness, Hindi/English clarity, reasoning plausibility. **Never used to verify a dose.** | **Non-blocking or high threshold.** | DeepEval (G-Eval) |

> **Hard line:** the **dose-engine cross-check (L1) and never-events (L2) are deterministic and blocking**; the **LLM judge (L4) never gates a dose**. A judge can flag prose, never arithmetic.

```yaml
# promptfoo.config.yaml  (illustrative — base-vs-branch eval gate)
description: Rx generation eval gate
prompts: [file://prompts/core_prompt.md]
providers:
  - id: anthropic:messages:{{ MODEL_ID }}   # injected ONLY from config adapter
tests: file://evals/golden/**/*.json
defaultTest:
  assert:
    - type: is-json                                   # L1 contract
    - type: javascript                                # L1 dose-engine cross-check
      value: file://evals/assert/dose-engine-crosscheck.js
    - type: javascript                                # L1 allergy/interaction
      value: file://evals/assert/allergy-interaction.js
    - type: javascript                                # L2 never-events (hard fail)
      value: file://evals/assert/never-events.js
    - type: cost      ; threshold: 0.05               # L1 budget
    - type: latency   ; threshold: 8000               # L1 budget (ms)
    - type: g-eval                                    # L4 soft quality (high threshold)
      value: file://evals/rubric/clinical-clarity.md
      threshold: 0.8
```

### 3.3 The eval gate in CI (base-vs-branch diff)

```yaml
# .github/workflows/eval-gate.yml  (illustrative)
name: Eval Gate
on:
  pull_request:
    paths:
      - 'prompts/**'
      - 'src/config/model-config/**'
      - 'evals/**'
      - 'supabase/functions/generate-prescription/**'
      - 'radhakishan_system/skill/references/**'
jobs:
  evals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run promptfoo (base vs branch)
        uses: promptfoo/promptfoo-action@v1
        with:
          config: promptfoo.config.yaml
          # posts side-by-side diff as a PR comment:
          # which cases improved/regressed, Δ severe-errors, Δ cost, Δ latency
        env:
          MODEL_ID: ${{ vars.MODEL_ID }}   # sourced from config, never a literal
      # Hard gates (job fails the merge):
      #   - never-events: 100% pass
      #   - severe-error count: 0
      #   - cost & latency within budget
```

**LLM-judge governance (carry into the discipline):**

- **Pin the judge model version**; re-validate against human labels on every judge bump (target Krippendorff α ≈ 0.8).
- Use **score-averaging (non-deterministic)** to dampen judge variance; **bias-audit** for position/length/self-preference.
- A judge-model update is itself a **gated change** (it can silently move scores) — treat it like a model swap (§5).

---

## 4. SPEC drift control — single-source-of-truth generation + traceability

> *Goal:* keep **spec ↔ code ↔ runtime in lockstep**. Artifacts that *can* be generated from the spec are **generated, not hand-synced**; divergence from the generated form **fails a build**. Every safety-critical spec clause is **proven** by a test/eval via a traceability matrix.

### 4.1 Generated, not hand-synced (single source of truth)

| Source of truth | Generated artifact | Generator | Hand-edit policy |
| --- | --- | --- | --- |
| **DB schema** (`radhakishan_system/schema/*.sql`) | TypeScript DB types | Supabase typegen / `quicktype` | **Banned.** Edit the schema, regenerate. |
| **OpenAPI spec** (HTTP boundary) | Typed clients + server stubs | `openapi-typescript` | **Banned.** Edit the spec, regenerate. |
| **JSON Schemas** (tool I/O, Rx output, bus messages) | Validators + TS types | Ajv standalone / `json-schema-to-typescript` | **Banned.** Edit the schema, regenerate. |
| **Spec** (clauses) | **Repo skeleton** (ports/adapters, command bus, CI gates, fitness functions, test+eval harness, DoD gates, contract schemas) | Spec-driven **scaffolding workflow** (digest §8) | Skeleton is **correct-by-construction and re-generable**. |
| **Spec + tasks + code + tests + evals** | **Traceability matrix** | matrix generator (§4.2) | Generated artifact, never hand-curated. |

**`generated-files-in-sync` CI check.** On every PR, regenerate all of the above and `git diff --exit-code`. If a hand-edit diverged from the generated form, **the build fails**. This is the mechanism that prevents schema→types and OpenAPI→client drift, and that makes the scaffolding **spec-synced by construction**.

```yaml
# .github/workflows/generated-in-sync.yml  (illustrative)
name: Generated Files In Sync
on: [pull_request]
jobs:
  regen:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: deno task gen:db-types        # schema -> types
      - run: deno task gen:openapi-clients  # OpenAPI -> clients
      - run: deno task gen:schemas          # JSON Schema -> validators/types
      - run: deno task gen:trace-matrix     # build traceability matrix (§4.2)
      - name: Fail if any generated file drifted from source of truth
        run: git diff --exit-code || (echo "SPEC DRIFT: regenerate and commit"; exit 1)
```

### 4.2 Spec ↔ task ↔ code ↔ test ↔ eval traceability

Every spec clause, task, source module, test, and eval case carries a **trace ID** in YAML front-matter or an inline tag. A CI job builds the matrix and **fails if any safety-critical spec clause lacks a verifying test or eval** (an IEC-62304-style verification spine, right-sized — not full enterprise ceremony).

```yaml
# In a spec clause file front-matter:
trace_id: TRACE-RX-DOSING-GFR
safety_critical: true

# In a task (DoR requires this link):
trace_id: TRACE-RX-DOSING-GFR
task: T-204

# In source (tag):  // @trace TRACE-RX-DOSING-GFR
# In a test:        // @trace TRACE-RX-DOSING-GFR
# In an eval case:  "trace_id": "TRACE-RX-DOSING-GFR"
```

Generated matrix (example):

| trace_id | safety_critical | spec clause | task | code | test | eval | status |
| --- | :---: | --- | --- | --- | --- | --- | :---: |
| TRACE-RX-DOSING-GFR | yes | spec/rx/dosing#gfr | T-204 | `src/domain/dosing/gfr.ts` | `gfr.test.ts` | `preterm-gfr-001.json` | OK |
| TRACE-RX-SIGNOFF | yes | spec/rx/issuance#signoff | T-211 | `src/contexts/rx/signoff.ts` | `signoff.test.ts` | `signoff-blocked-001.json` | OK |
| TRACE-RX-NABH | yes | spec/rx/output#nabh | T-187 | (Rx schema) | `nabh-schema.test.ts` | `nabh-present-001.json` | **MISSING-EVAL → FAIL** |

```bash
# scripts/trace/check-matrix.sh  — CI fails if a safety-critical clause is unverified
set -euo pipefail
UNVERIFIED=$(deno task gen:trace-matrix --json \
  | jq -r '.[] | select(.safety_critical==true and (.test==null or .eval==null)) | .trace_id')
if [ -n "$UNVERIFIED" ]; then
  echo "TRACEABILITY FAIL — safety-critical clauses missing a test or eval:"; echo "$UNVERIFIED"; exit 1
fi
```

---

## 5. Dependency & supply-chain pinning + monitoring (the model-retirement lesson, generalized)

> The founding incident generalizes: **a vendor model id is a dependency**, and an unpinned, unmonitored dependency is a production outage waiting to happen. Same era of risk (Shai-Hulud worm, GhostAction) means: pin everything, monitor for deprecation, gate every swap.

### 5.1 Pinning & monitoring gates (every PR / scheduled)

| Control | Rule | Tool | Gate |
| --- | --- | --- | --- |
| **Lockfiles committed** | `deno.lock` / `package-lock.json` present and current. | native | CI fails on uncommitted lock drift |
| **Dependency updates** | **Renovate, security auto-merge only**; must pass full CI (incl. eval gate if LLM-affecting). | Renovate | auto-merge blocked on red |
| **SBOM** | **CycloneDX** SBOM generated on every build, archived. | CycloneDX | build artifact |
| **SRI** | **Every CDN `<script>`** carries `integrity` + `crossorigin`. | AST/grep fitness check | fail on missing SRI |
| **Lifecycle scripts** | Install lifecycle scripts **disabled**; prefer deps **>30 days old**. | config + policy | CI policy check |
| **Secret scanning** | GitHub secret scanning + **push protection** + **gitleaks** in CI. | GitHub + gitleaks | fail on hit |
| **Vendor model id** | Declared **only** in `src/config/model-config` (F5); deprecation **monitored**; swap is gated (below). | grep/AST + monitor | fail on literal outside config |

```bash
# scripts/fitness/sri-required.sh  — every CDN script tag must carry an integrity hash
set -euo pipefail
BAD=$(grep -REn '<script[^>]+src="https?://' web \
  | grep -v 'integrity=' || true)
[ -z "$BAD" ] || { echo "SUPPLY-CHAIN FAIL: CDN <script> without SRI:"; echo "$BAD"; exit 1; }
```

### 5.2 A model/prompt swap is a *gated change*, never a hotfix

This is the §9 worked example from the digest, expressed as the lockstep procedure. **This is how the founding incident is made impossible.**

```
DoR ─▶ RED ─▶ IMPLEMENT (model id in config ONLY) ─▶ EVAL GATE (base vs branch)
   ─▶ STRUCTURAL GATE (F5: id stayed in config; vendor behind adapter)
   ─▶ ADVERSARIAL REVIEW ─▶ HUMAN REVIEW (High tier, decides on the DATA)
   ─▶ MERGE with pre-validated FALLBACK MODEL + documented ROLLBACK
   ─▶ ONLINE EVAL monitors live Rx quality + next deprecation alarm
```

1. **DoR.** Task gets a trace ID, links the affected spec clause, tagged **High risk** (model/prompt). "New golden cases required?" answered. (Routing per the risk table below.)
2. **RED.** If a new failure mode is in scope, add the **new golden eval case first** (with severity tag + forbidden outputs); it is expected to constrain the change.
3. **IMPLEMENT.** Model id changes **only in `src/config/model-config`** (F5 blocks it anywhere else); any prompt edit is **versioned**.
4. **Eval gate (promptfoo, base vs branch).** L1 deterministic (dose-engine cross-check, allergy/interaction, schema, NABH); **L2 never-events 100% pass; L3 severe-error count = 0** else hard fail; L4 soft-quality ≥ threshold; **cost + latency** within budget. **PR comment posts the diff** (improved/regressed cases, Δ severe, Δ cost, Δ latency).
5. **Structural gate.** Fitness functions confirm the id stayed in config, the vendor stayed behind the adapter, no boundary crossed.
6. **Adversarial reviewer (independent agent/human).** Probes for a regression the dataset missed and for prompt-injection exposure; **can demand a new golden case**. No self-review.
7. **Human review (High tier).** Physician / eng lead approves on the **scored diff**, not vibes.
8. **Merge → rollout.** Ships with a **pre-validated fallback model + documented, drilled rollback**. **Online eval** monitors live Rx quality; alarms on quality drift, **timeout-rate**, severe-error online score, error-budget burn, and the **next model deprecation** — so the incident cannot recur silently.

### 5.3 Risk-based human-in-the-loop routing (applies to all three drift axes)

| Risk tier | Triggers | Gate |
| --- | --- | --- |
| **Low** | internal refactor, docs, presentational tweak | automated gates only |
| **High → mandatory human review** | dosing, prescription **issuance**, patient data/PHI, ABDM/FHIR, secrets, **any model/prompt/reference change** | full eval gate **+** named human approver before merge |
| **Critical → explicit confirm even with auto-approve** | delete / force-push / prod / data-drop / schema-destructive | stop, confirm with a human (global CLAUDE safety rule) |

---

## 6. Runtime lockstep — catching drift the gates didn't predict

CI gates protect the merge. **Online verification** protects production, because v1 golden sets and contract fixtures are a safety net, not proof.

| Signal | What it catches | Alarm |
| --- | --- | --- |
| **Online eval scoring** (Braintrust on live Rx traffic) | Behavioral drift the golden set didn't predict; new failure modes → promote to golden case. | severe-error online score breach |
| **Model deprecation monitor** | Vendor retiring a model id (the founding incident). | model-retirement / deprecation alarm |
| **Timeout-rate + p95 latency SLO** on Rx path | Edge/streaming degradation. | timeout-rate breach, error-budget burn |
| **Schema/contract violation counters** | A producer or vendor silently broke a contract in prod. | contract-violation alarm |
| **`generated-in-sync` on `main`** (scheduled) | Spec drift that slipped in via a bypass or merge race. | nightly drift alarm |

**Incident response.** The founding incident gets a **named runbook** with a **pre-validated fallback model** and a **drilled rollback**. Prompts are versioned (PCCP-style change management); allowed prompt/model changes within intended use are pre-defined, each validated by the eval suite with a documented rollback.

---

## 7. Drift-control DoD checklist (the merge gate)

A change cannot be merged until every box relevant to its risk tier is machine-verified. Encoded as a **PR template + required CI checks + branch protection** — an agent cannot self-attest past it.

- [ ] **Structural — F1 esc()-XSS** passes (no unescaped dynamic `innerHTML`).
- [ ] **Structural — F2 boundary/no-circular** passes (domain ⇏ vendor SDK; no cross-context internals).
- [ ] **Structural — F3 dose-engine-only-dosing** passes (no AI/parallel dosing math).
- [ ] **Structural — F4 sign-off-before-issue** passes (no issuance without sign-off event).
- [ ] **Structural — F5 no-secrets / model-id-in-config** passes (gitleaks clean; ids only in config).
- [ ] **Contract** — all tool I/O, Rx output, and bus message schemas validate; **FHIR R4** + Pact provider verification green (if ABDM touched).
- [ ] **Behavioral — L1 deterministic** assertions green incl. **dose-engine cross-check**, allergy/interaction, schema, NABH, cost & latency budgets (if model/prompt/reference/Rx-schema touched).
- [ ] **Behavioral — L2 never-events 100% pass**; **L3 severe-error count = 0**; **base-vs-branch diff** posted to PR.
- [ ] **Spec — `generated-in-sync`** passes (schema→types, OpenAPI→clients, schemas, skeleton, matrix all regenerate clean).
- [ ] **Spec — traceability matrix** resolves; **no safety-critical clause lacks a test or eval**.
- [ ] **Supply-chain** — lockfiles current, SBOM generated, **SRI present** on any new CDN script, secret scan clean.
- [ ] **ADR added** if a canonical-tooling / architectural / model-policy decision was made.
- [ ] **Adversarial independent-agent review** passed (no self-review).
- [ ] **Risk-tier human review** obtained where required (High / Critical).

---

## 8. Honest caveats (binding on downstream files)

- An eval suite is **only as good as its golden set**; v1 is a **safety net, not proof of safety** — grow it from production misses (§6).
- **LLM-judge scores drift** when the judge model updates — pin and re-validate against human labels; **never let a judge verify a dose**.
- This is **engineering rigor, not regulatory clearance.** CDSCO is the binding regulator; **severe-error gating + mandatory physician sign-off (F4)** remain the real safety backstop.
- Start with **5 fitness functions and ~30–50 eval cases** tied to the highest patient-safety risk; let the harness **accrete**. Don't front-load enterprise ceremony — front-load the gates that block harm.

---

### Relevant repo anchors (absolute)

- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\.github\workflows\deploy-pages.yml` — current **zero-gate** deploy; the thing this file's gates wrap.
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\web\dose-engine.js` — dosing **source of truth**; anchor of fitness function **F3** and the **L1 dose-engine cross-check**.
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\radhakishan_system\scripts\integration_test.js` — existing hand-rolled shape smoke test; **superseded** by the contract + eval harness here.
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\supabase\functions\generate-prescription\` — primary **eval-gated** surface.
- No `package.json` / `deno.json` at root and no CI test job exist (confirmed 2026-06-25); the scaffolding workflow must create these as part of the spec-synced skeleton.
