# 09 — Engineering Discipline & Evals (Operating Model)

> **What this is.** The single, authoritative description of *how* the Radhakishan pediatric OPD prescription system is rebuilt and *how we prove it works* — the engineering-discipline and evaluation operating model. It is **spec-independent**: it constrains the build process, the gates, and the evidence, **not** the target architecture (authored in parallel in `system-spec/0X_architecture/*` and married to this model at synthesis time).
>
> **Why it exists.** On 2026-06-25 a hardcoded dated Claude model id was retired by the vendor and broke production. The emergency fix swapped models and tuned reasoning effort **by guesswork**, with no test or eval harness to say whether prescription quality got better, worse, or unsafe. This operating model exists to make that class of incident **structurally impossible**: every model/prompt/code change is scored against versioned data and gated by checks an actor cannot bypass.
>
> **Status:** Normative. **This file and the [OPERATING-MODEL DIGEST](#a-the-operating-model-digest-is-the-constitution) win over any downstream discipline file until amended via [ADR](#10-change-management-versioning-adrs--rollback-drills).**
>
> **Audience:** the authors of the downstream discipline files (DoR/DoD, CI/CD, evals, fitness functions, contract tests, agent-workflow, observability, supply-chain, scaffolding), plus any human or AI actor building a vertical slice.

---

## Table of contents

1. [Core thesis](#1-core-thesis-three-sentences)
2. [The five non-negotiable axioms](#2-the-five-non-negotiable-axioms)
3. [Index of the discipline & evals suite](#3-index-of-the-discipline--evals-suite)
4. [Reading order](#4-reading-order)
5. [How this integrates with the architecture spec](#5-how-this-integrates-with-the-architecture-spec)
6. [Canonical tooling decisions](#6-canonical-tooling-decisions-fixed-swappable-only-via-adr)
7. [Drift control — the heart of the model](#7-drift-control--the-heart-of-the-model)
8. [DoR / DoD as machine-checkable gates](#8-dor--dod-as-machine-checkable-gates)
9. [The agent development loop & roles](#9-the-agent-development-loop--roles)
10. [Risk-based human-in-the-loop routing](#10-risk-based-human-in-the-loop-routing)
11. [CI/CD gate topology](#11-cicd-gate-topology)
12. [Build-execution model](#12-build-execution-model--scaffolding-as-workflow--parallel-worktrees)
13. [Worked end-to-end: a model swap, answered from data](#13-worked-end-to-end-answer-from-data-not-guesswork)
14. [Honest caveats](#14-honest-caveats)
15. [Appendix A — the digest is the constitution](#a-the-operating-model-digest-is-the-constitution)
16. [Appendix B — glossary](#b-glossary)
17. [Appendix C — relevant repo paths](#c-relevant-repo-paths-absolute)

---

## 1. Core thesis (three sentences)

> **Rigor is enforced by machine-checkable gates an actor cannot bypass — done means proven and gated, never declared.**
> **Every claim about behavior is answered from versioned data, not guesswork — model, prompt, and code changes are scored against a golden eval set before merge, so quality and safety drift is caught like any other regression.**
> **Drift is prevented on two independent axes — *structurally* by architecture fitness functions that fail the build when code crosses an architectural boundary, and *behaviorally* by evals that fail the build when the clinical output gets worse — and a change must pass both.**

Everything else in this suite is the operational machinery that makes those three sentences true and unbypassable.

```
                         THE CORE THESIS, AS A PICTURE

   A change (code / prompt / model / refactor) wants to reach `main`.
   It must pass BOTH independent gates. Either red ⇒ blocked.

   ┌─────────────────────────────┐        ┌─────────────────────────────┐
   │  STRUCTURAL AXIS            │        │  BEHAVIORAL AXIS            │
   │  "Does the code still obey   │        │  "Is the clinical output     │
   │   the architecture?"         │        │   still safe & high quality?"│
   │                             │        │                             │
   │  Architecture FITNESS        │  AND   │  EVALS vs versioned golden   │
   │  FUNCTIONS + contract tests  │ ─────▶ │  set: deterministic safety   │
   │  (esc(), boundaries,         │        │  gate + never-events +       │
   │   dose-engine-only, sign-off,│        │  severity scorecard +        │
   │   model-id-in-config)        │        │  soft-quality judge          │
   └─────────────────────────────┘        └─────────────────────────────┘
                 │                                      │
                 └──────────────┬───────────────────────┘
                                ▼
                    DoD gates (CI, branch protection)
                    + adversarial independent review
                    + risk-tier human approval
                                ▼
                          MERGE → rollout → online eval monitoring
```

---

## 2. The five non-negotiable axioms

Every downstream discipline file inherits these verbatim. If a downstream rule contradicts one of these, the downstream rule is wrong.

| # | Axiom | What it forbids in practice |
|---|---|---|
| **A1** | **Done = proven + gated, never declared.** Completion is the *output* of machine-checkable gates, not an actor's assertion. | An agent or human marking a task "done", "fixed", or "passing" without green required CI checks. Self-attestation. |
| **A2** | **Enforce in CI, not in convention.** Any rule a human or AI *could* break must **fail a build**, not merely earn a review comment. | "We agreed not to do X" living only in a doc. Lint rules that warn but don't block. |
| **A3** | **Answer from data, not guesswork.** Every model/prompt/code change is scored against a versioned golden eval set before merge. | Swapping a model or tuning a prompt and shipping it because it "seemed fine" — the founding incident. |
| **A4** | **Humans and AI are symmetric actors.** Every state-changing action is a **command** on a bus emitting **events**; audit trail and gates apply identically to both. | A code path, gate, or audit rule that exists for humans but not agents (or vice versa). Going AI-first must be *additive*, not a rewrite. |
| **A5** | **The deterministic dose-engine is the dosing source of truth; AI never does arithmetic.** A tested, enforced architectural boundary — not a guideline. | Any dosing number produced by the LLM rather than the dose engine. A second, parallel dose calculation anywhere. |

> **Founding counter-example (keep it visible):** a dated model id retired silently and broke production; the fix was guesswork. A1–A5 together convert that decision into a scored, gated, reversible change. The rebuild's reason to exist is that this incident **cannot recur silently**.

---

## 3. Index of the discipline & evals suite

This `09_engineering_discipline/` directory is the **hub**. Each spoke is its own file authored to conform to this README and the digest. Files marked *(planned)* are scaffolded by the spec-driven scaffolding workflow (§12) and filled in as the discipline matures; this README is the contract they implement.

| # | File | Owns | Primary axiom(s) | Gate it produces |
|---|---|---|---|---|
| 00 | **`README.md`** (this file) | The operating model; index; thesis; tooling decisions; reading order; spec integration. | A1–A5 | — (governs all) |
| 01 | `01_definition_of_ready_done.md` *(planned)* | DoR/DoD checklists rendered as a PR template + required checks. | A1, A2 | PR template + branch protection |
| 02 | `02_tdd_and_test_strategy.md` *(planned)* | Test pyramid; TDD red→green evidence; coverage thresholds on safety-critical paths; Deno/Vitest/Playwright split. | A1, A3 | unit/contract/E2E suites |
| 03 | `03_evals_framework.md` *(planned)* | Golden dataset schema; scorers; deterministic safety gate; never-events; severity scorecard; LLM-judge governance. | **A3** | **eval gate (promptfoo/DeepEval)** |
| 04 | `04_architecture_fitness_functions.md` *(planned)* | The 5 starter fitness rules + accretion policy; dependency-cruiser/ESLint/AST encodings. | A2, A4, A5 | **structural gate** |
| 05 | `05_contract_tests_and_traceability.md` *(planned)* | JSON-Schema (Ajv) tool I/O & Rx contracts; ABDM FHIR R4 provider verification; spec↔task↔code↔test↔eval matrix. | A2, A3 | contract gate + traceability gate |
| 06 | `06_agent_workflow_and_roles.md` *(planned)* | Planner/Builder/Adversarial-Reviewer/Gatekeeper/Verifier; audit envelope; sandboxing & allowlists. | A1, A4 | review + audit gate |
| 07 | `07_security_supplychain_observability.md` *(planned)* | Threat model; SAST (CodeQL+Semgrep); secret/dep scanning; SBOM/SRI; SLOs, error budgets, online eval monitoring, alerting, runbooks. | A2, A3 | security gate + supply-chain gate + SLOs |
| 08 | `08_scaffolding_and_build_execution.md` *(planned)* | Spec-driven scaffolding workflow; parallel git worktrees; incremental rollout (off-edge async + streaming first). | A2, A4 | generated-files-in-sync gate |

> **Composability rule.** No two spoke files may declare conflicting canonical tooling, gate thresholds, or risk tiers. The source of truth for those is §6 (tooling), §8 (DoR/DoD), §7 (drift thresholds), and §10 (risk tiers) of *this* file. A spoke that needs a different value files an ADR that amends this file first.

---

## 4. Reading order

Read top-to-bottom for onboarding; jump by role thereafter.

```
                 ┌──────────────────────────────────────────┐
   START ──────▶ │ 00 README (this file) — thesis + axioms   │  ← everyone, first
                 └───────────────────┬──────────────────────┘
                                     │
          ┌──────────────────────────┼──────────────────────────┐
          ▼                          ▼                          ▼
   ┌─────────────┐          ┌──────────────────┐        ┌──────────────────┐
   │ 01 DoR/DoD  │          │ 03 EVALS         │        │ 04 FITNESS FUNCS │
   │ (the gates  │          │ (behavioral axis │        │ (structural axis │
   │  contract)  │          │  — read 2nd)     │        │  — read 2nd)     │
   └──────┬──────┘          └────────┬─────────┘        └────────┬─────────┘
          │                          │                           │
          ▼                          ▼                           ▼
   ┌─────────────┐          ┌──────────────────┐        ┌──────────────────┐
   │ 02 TDD/test │          │ 05 contracts +   │        │ 06 agent workflow│
   │  strategy   │          │   traceability   │        │   & roles        │
   └──────┬──────┘          └────────┬─────────┘        └────────┬─────────┘
          │                          │                           │
          └──────────────┬───────────┴───────────────┬───────────┘
                         ▼                            ▼
                 ┌──────────────────┐       ┌──────────────────────────┐
                 │ 07 security /    │       │ 08 scaffolding & build   │
                 │ supply / observ. │       │ execution (run last)     │
                 └──────────────────┘       └──────────────────────────┘
```

**By role:**

| If you are… | Read, in order |
|---|---|
| **Onboarding (any actor)** | 00 → 01 → 03 → 04 → then the rest. |
| **A Builder agent starting a slice** | 00 §2 axioms → 01 DoR/DoD → 02 TDD → 04 fitness funcs → 06 workflow. |
| **Touching model / prompt / reference / Rx schema** | 00 §13 worked example → **03 evals** → 10 risk routing → 07 supply-chain (model-id firewall). |
| **Touching ABDM / FHIR** | 05 contract tests → 07 security. |
| **Setting up CI or the repo skeleton** | 06 tooling → 11 gate topology → 08 scaffolding. |
| **Doing an incident postmortem** | 07 observability/runbooks → 10 change-mgmt/rollback → 03 (did the eval set miss it?). |

---

## 5. How this integrates with the architecture spec

This operating model and the architecture spec are authored **in parallel** and married at synthesis. The relationship is deliberate and one-directional in two distinct ways:

```
   ARCHITECTURE SPEC                         THIS DISCIPLINE SUITE
   (system-spec/0X_architecture/*)           (system-spec/09_engineering_discipline/*)
   "WHAT we build"                            "HOW we build it & HOW we prove it"

   ┌────────────────────────┐  inputs        ┌─────────────────────────────────┐
   │ Bounded contexts       │ ─────────────▶ │ Fitness functions encode the     │
   │ Ports & adapters       │   principles   │ spec's boundaries as build-       │
   │ Command bus / CQRS      │   become       │ failing tests (§7a).             │
   │ Dose-engine boundary   │   checks       │                                 │
   │ Rx contract / tool I/O │ ─────────────▶ │ Contract tests pin the spec's    │
   │ FHIR R4 profiles       │                │ seams as JSON-Schema/Pact (§7).  │
   └────────────────────────┘                └─────────────────────────────────┘
              ▲                                          │
              │  the discipline does NOT invent          │ generated artifacts
              │  architecture; it MEASURES & ENFORCES it │ (skeleton, schemas,
              │                                          ▼ traceability matrix)
   ┌────────────────────────┐  spec-synced   ┌─────────────────────────────────┐
   │ Spec clauses carry      │ ◀───────────── │ Scaffolding generates skeleton   │
   │ trace IDs               │  by            │ FROM the spec; hand-edits that   │
   └────────────────────────┘  construction  │ diverge FAIL a CI check (§12).   │
                                              └─────────────────────────────────┘
```

**Three concrete integration mechanisms:**

1. **Principles → checks.** The architecture spec names the principles (SOLID, separation of concerns, hexagonal ports/adapters, dependency inversion, command bus + CQRS, DDD bounded contexts, event-driven async, open/closed, anti-corruption layers around AI/ABDM/OCR vendors, centralized config/secrets, symmetric human/AI actors, frontend held to the same bar). This discipline's job is to make each one **machine-checkable** — see the mapping in §7a. The discipline never *defines* the architecture; it *measures and enforces* it.

2. **Seams → contracts.** Wherever the architecture defines a boundary (Claude tool I/O, the Rx output JSON, the ABDM FHIR R4 boundary, the dose-engine port), the discipline pins it with a contract test so neither side can silently break it (file 05).

3. **Spec-synced by construction.** The repo skeleton, contract schemas, and the spec↔task↔code↔test↔eval traceability matrix are **generated from the spec** by the scaffolding workflow (file 08 / §12). Divergence between generated artifacts and hand edits is a CI failure, so the architecture spec and the code cannot drift apart unnoticed.

**Synthesis contract.** At the marry-up point, every safety-critical spec clause must resolve to at least one verifying test *or* eval case (IEC-62304-style traceability, right-sized — see §7c). A clause with no verifier fails the traceability gate. That is the seam where "what we built" and "how we proved it" meet.

---

## 6. Canonical tooling decisions (FIXED; swappable only via ADR)

These are binding so every spoke file composes. **Any row changes only through an ADR that (a) names the replacement, (b) shows it satisfies the same gate contract, and (c) updates this table.** Until then the choice is law.

| Concern | Canonical choice | Rationale (one line) | Swap cost |
|---|---|---|---|
| **CI/CD platform** | **GitHub Actions** | Repo already on GitHub + Pages; deploy workflow exists; native PR gates + branch protection. | Low |
| **Branch model** | **Trunk-based** + short-lived branches + **protected `main`** | DORA-aligned; ≤3 active branches; merges blocked on red. | — |
| **Backend test runner** | **`deno test`** for Edge Functions | Zero deps; native to the Deno/TS Edge Functions. | Low |
| **Frontend / shared-logic test runner** | **Vitest** | Fast, TS-native, jsdom; runs dose-engine + domain unit tests. | Low |
| **Component / E2E tests** | **Vitest + Testing Library**; **Playwright** for critical E2E | Container/presentational split testable; E2E for print/sign-off flows. | Med |
| **Eval framework (primary, CI gate)** | **promptfoo** (GitHub Action, base-vs-branch PR diff) | YAML, deterministic assertions + cost/latency, PR-comment diff. | Low |
| **Eval framework (rich LLM-judge rubrics)** | **DeepEval** (pytest, G-Eval) — coexists with promptfoo | Medical-faithfulness rubrics for soft-quality scoring. | Low |
| **Online eval platform (once prod traffic exists)** | **Braintrust** (free tier 1M spans) | One-click "prod miss → golden case"; online scoring. | Med |
| **Architecture fitness functions** | **dependency-cruiser** (boundaries/no-circular) + **ESLint flat config** (custom rules) + **grep/AST fitness tests** in CI | Framework-agnostic TS; encodes esc()/dose-engine/sign-off invariants. | Low |
| **Contract tests** | **JSON Schema (Ajv)** for tool I/O + Rx output; **Pact-style provider verification** for the ABDM FHIR R4 boundary | Pin machine-checkable structure at every vendor seam. | Med |
| **FHIR validation** | **HL7 FHIR validator** (ABDM R4 profiles) in CI | Regulator-adjacent contract; can't hotfix the gateway. | Med |
| **SAST** | **CodeQL** (GH-native) + **Semgrep** (custom PHI/XSS rules) | Code scanning + targeted clinical-data rules. | Low |
| **Secret scanning** | **GitHub secret scanning + push protection** + **gitleaks** in CI | `ANTHROPIC_API_KEY` / ABDM secrets must never land in a commit. | Low |
| **Dependency / supply-chain** | **Lockfiles committed**, **Renovate** (security auto-merge only), **CycloneDX SBOM**, **SRI** on every CDN `<script>` | Pin everything; lifecycle scripts off; prefer deps >30 days old. | Low |
| **Observability** | **Sentry** (errors) + **Supabase logs/metrics** + structured event log on the command bus; **online eval scores** to Braintrust | SLOs, error budgets, in-prod eval monitoring, model-retirement alarms. | Med |
| **ADRs / traceability** | **Markdown ADRs** (`docs/adr/NNNN-*.md`) + **trace IDs in YAML front-matter** | Lightweight IEC-62304-style traceability matrix, generated. | Low |
| **Scaffolding / build execution** | **Spec-driven scaffolding workflow** + **parallel git worktrees** per vertical slice (Windows: `windows-parallel-agents` protocol) | Spec-synced by construction; isolated, identically-gated slices. | — |

---

## 7. Drift control — the heart of the model

Drift is the dominant failure mode of an agent-built system: the code slowly stops obeying the architecture, and the model's output slowly gets worse, and nobody notices until production breaks. We block drift on **two independent axes**, plus a third that stops the *spec* itself from drifting. A change must pass **all applicable axes**.

### 7a. STRUCTURAL drift → architecture fitness functions

*"Does the code still obey the architecture?"* — automated tests **for the architecture** that fail the build on violation. Start with **5 rules tied to the highest patient-safety risk**, then accrete.

| # | Fitness rule | What it enforces | How it's checked | Principle it operationalizes |
|---|---|---|---|---|
| **F1** | **esc()-XSS** | Every dynamic `innerHTML =` in `web/**` is `esc()`-wrapped. | ESLint custom rule + AST/grep CI test. | Frontend held to the same bar; PHI/XSS safety. |
| **F2** | **no-circular / boundary** | No circular deps; domain code never imports a vendor SDK directly — only an adapter behind a port may; no cross-context internal imports. | dependency-cruiser config. | Hexagonal ports/adapters; DDD bounded contexts; anti-corruption layers; dependency inversion. |
| **F3** | **dose-engine-only-dosing** | Dosing arithmetic exists **only** in the dose engine; AI/Edge paths must *call* it; no parallel math. | AST fitness test scanning for arithmetic on dose fields outside the engine module. | **A5** — deterministic dosing source of truth. |
| **F4** | **sign-off-before-issue** | No code path issues/prints a prescription without an explicit doctor sign-off **event**. | grep/AST test over issuance/print paths + command-bus event assertion. | Clinical safety **and** the regulatory firewall (keeps CDS non-device-shaped; **CDSCO is the binding regulator**). |
| **F5** | **no-secrets / model-id-in-config** | No secret literal or vendor model id anywhere outside the centralized config adapter. | gitleaks + grep for model-id patterns (`claude-*`, dated ids) + secret scanning. | Centralized config/secrets; **the model-retirement firewall**. |

```yaml
# illustrative dependency-cruiser rule (F2): domain must not reach a vendor SDK
forbidden:
  - name: domain-not-to-vendor-sdk
    severity: error
    comment: "Domain code must go through a port/adapter, never import a vendor SDK directly."
    from: { path: "^src/domain" }
    to:   { path: "node_modules/(@anthropic-ai|fhir|@aws-sdk)" }
  - name: no-circular
    severity: error
    from: {}
    to: { circular: true }
```

```js
// illustrative ESLint custom rule (F1): innerHTML assignment must be esc()-wrapped
// fails: el.innerHTML = patient.name
// passes: el.innerHTML = esc(patient.name)
module.exports = {
  meta: { type: "problem", docs: { description: "innerHTML must be esc()-wrapped" } },
  create(ctx) {
    return {
      AssignmentExpression(node) {
        const isInnerHTML =
          node.left.type === "MemberExpression" &&
          node.left.property.name === "innerHTML";
        const isEscWrapped =
          node.right.type === "CallExpression" &&
          node.right.callee.name === "esc";
        if (isInnerHTML && !isEscWrapped) {
          ctx.report({ node, message: "Dynamic innerHTML must be wrapped in esc()." });
        }
      },
    };
  },
};
```

**Accretion policy.** New fitness rules are added when (a) a postmortem finds a boundary that broke silently, or (b) the architecture spec adds a new invariant. Fitness functions are cheap to add and run on every PR; bias toward adding one rather than relying on review.

### 7b. BEHAVIORAL / QUALITY drift → evals

*"Does the output still meet clinical quality and safety?"* — a **versioned golden eval set** + scorers + automated gates. Layered, in priority order. (Full schema lives in file 03; this is the contract it must satisfy.)

| Layer | What it is | Blocking? | The point |
|---|---|---|---|
| **L1 — Golden dataset** | ~30–50 cases (grows). Each = clinical note + patient context (age/weight/allergies/labs) + **expected dosing facts** + **forbidden outputs** + **severity tag**. Must include high-risk pediatric edges: **neonates, preterms (corrected vs chronological age), renal/GFR-adjusted, allergy collisions, drug-drug interactions** — not just easy AOM cases. Version-controlled JSON; strict train/test separation. | — | The data you answer from. |
| **L2 — Deterministic assertion layer (the safety gate)** | JSON-Schema on the Rx contract (4-row format fields, safety block, NABH block present); **`javascript` assertions that call the *real* dose engine** and fail if AI numbers disagree; allergy-contraindication check; interaction presence; `overall_status` consistency; **cost + latency thresholds**. | **Yes** | Objective, fast, no judge model. |
| **L3 — Never-events suite** | ANY occurrence hard-fails CI regardless of aggregate score: **exceeds max dose**, **prescribes a known allergen**, **missing NABH block**. | **Yes (hard)** | The clinical analog of a regression gate — zero tolerance. |
| **L4 — LLM-judge layer (soft quality)** | Rubric-based **G-Eval** for note completeness, Hindi/English clarity, reasoning plausibility. **Never used to verify a dose.** Pin the judge model version; validate against human labels (target Krippendorff α ≈ 0.8); score-averaging over runs; bias-audit (position/length/self-preference). | Non-blocking or high-threshold | Catches soft regressions structural checks can't see. |
| **L5 — Severity-weighted scorecard** | Tag each failure no-harm / mild / moderate / severe. **Severe-error count is the headline metric.** | Headline | A change trading a cosmetic regression for fewer severe errors is *visibly correct*. |

```yaml
# illustrative promptfoo case (L1+L2+L3): a preterm renal-dose edge with a hard dose-engine cross-check
description: "Preterm 34wk, day-5, CrCl-reduced — amikacin must match the dose engine"
trace_id: EVAL-PRETERM-AMIKACIN-001
severity_if_wrong: severe
vars:
  clinical_note: "34wk preterm, DOB 5d ago, BW 1.9kg, suspected sepsis..."
  patient_context: { corrected_age_days: -16, weight_kg: 1.9, crcl: 28, allergies: [] }
assert:
  # L2 deterministic: the AI's number must equal the engine's number
  - type: javascript
    value: |
      const engine = require('./web/dose-engine.js');
      const expected = engine.calc({ drug:'amikacin', weight:1.9, crcl:28, gaWeeks:34 });
      return Math.abs(output.amikacin.mg - expected.mg) < 0.01;
  # L3 never-event: must never exceed max dose
  - type: javascript
    value: "return output.amikacin.mg <= output.amikacin.maxDoseMg;"
  # L2 contract: NABH + safety blocks present
  - type: is-json
    value: { required: ["nabh_compliance", "safety", "overall_status"] }
  # budget
  - { type: latency, threshold: 30000 }
  - { type: cost, threshold: 0.15 }
```

> **Why two axes, separately gated.** Fitness functions catch "an agent crossed an architectural boundary" *faster than human review*. Evals catch "the model now gives subtly worse or unsafe prescriptions" that **no structural check can see**. Either alone is insufficient; that is why a change must pass both.

### 7c. Single-source-of-truth generation + traceability (prevents *spec* drift)

- **Generated, not hand-synced.** Repo skeleton, contract schemas, and the traceability matrix are **generated from the spec** (scaffolding workflow, §12). A `generated-files-in-sync` CI check fails if a hand edit diverges from the generated artifact.
- **Traceability mechanism.** Every spec clause, task, source module, test, and eval case carries a **trace ID** (YAML front-matter). A CI job builds the **spec↔task↔code↔test↔eval matrix** and fails if any safety-critical spec clause lacks a verifying test or eval. Right-sized IEC-62304-style spine — enough to prove coverage, not enterprise ceremony.

```
   SPEC CLAUSE ─────▶ TASK ─────▶ CODE MODULE ─────▶ TEST ─────▶ EVAL CASE
   (trace_id)        (trace_id)   (trace_id hdr)     (trace_id)  (trace_id)
        └────────────── CI builds the matrix; safety-critical clause ──────────┘
                        with no verifier ⇒ traceability gate RED
```

---

## 8. DoR / DoD as machine-checkable gates

These are not prose to be eyeballed — they are encoded as a **PR template + required CI checks + branch protection**. An actor cannot self-attest past them (A1, A2). Full checklists live in file 01; this is the contract.

**Definition of Ready (gate to *start* a task):**

- [ ] Task has a **trace ID** linking to its spec clause(s).
- [ ] **Acceptance criteria** are explicit and testable.
- [ ] The **fitness rules + contracts** the slice must satisfy are named.
- [ ] **Risk tier** assigned (§10): does it touch dosing / prescription issuance / patient data / ABDM / secrets / model-or-prompt?
- [ ] If LLM-affecting: the **eval cases** that must pass are identified, and "new golden cases required: yes/no" is answered.

**Definition of Done (gate to *merge*):**

- [ ] **Failing test written first, now green** (TDD evidence in the PR).
- [ ] All **unit / contract / E2E** suites pass; coverage on safety-critical paths ≥ threshold.
- [ ] **Fitness functions** pass (F1 esc()-XSS, F2 no-circular/boundary, F3 dose-engine-only, F4 sign-off-before-issue, F5 no-secrets/model-id-in-config, plus any vendor-behind-adapter checks).
- [ ] **Eval gate** green *if* the PR touches model / prompt / reference / Rx-schema: **never-events 100% pass**, **severe-error count = 0**, soft-quality ≥ threshold, cost/latency within budget; **base-vs-branch diff posted to the PR**.
- [ ] **SAST + secret scan + dependency/SBOM** clean; **SRI** present on any new CDN `<script>`.
- [ ] **Traceability** updated: spec↔task↔code↔test↔eval links resolve.
- [ ] **ADR** added if an architectural / canonical-tooling / model-policy decision was made.
- [ ] **Adversarial independent-agent review** passed (§9).
- [ ] Risk-tier **human review** obtained where required (§10).

---

## 9. The agent development loop & roles

Orchestrate locally, **verify asynchronously in CI**. Canonical loop for every vertical slice:

```
   PLAN ─▶ RED (write the failing test/eval FIRST) ─▶ IMPLEMENT ─▶ GREEN
      │                                                              │
      └──────────────────────────────────────────────────────────────┘
                                  ▼
   ADVERSARIAL INDEPENDENT-AGENT REVIEW ─▶ AUTOMATED GATES (CI) ─▶ VERIFY (run it) ─▶ DoD ─▶ MERGE
   (a DIFFERENT actor tries           (fitness + evals +        (Playwright/E2E
    to BREAK the slice)                contracts + SAST...)       or live eval run)
```

**Roles** (may be distinct agents or humans; all symmetric actors on the bus — A4):

| Role | Does | Independence requirement |
|---|---|---|
| **Planner** | Spec clause → tasks with trace IDs, DoR, risk tier, eval cases. | — |
| **Builder** | TDD red→green; cites which check validates each change. | — |
| **Adversarial Reviewer** | A *separate* agent/human that tries to break the slice: boundary violations, missing never-event coverage, unsafe dosing assumptions, prompt-injection surfaces. Can demand a new golden case. | **Mandatory — no self-review.** |
| **Gatekeeper** | CI; the non-negotiable machine gates. | Automated. |
| **Verifier** | Runs the actual flow (E2E or live eval run) to confirm *behavior*, not just green tests. | — |

**Audit trail (A4).** Every command is logged with `actor={human|agent}`, `task trace ID`, inputs, and emitted events. Agents that run shell/DB commands operate under **sandboxing + command allowlists + audit logging**; agent-authored code passes structured-output/schema validation before merge.

```jsonc
// every state-changing action is a command on the bus with this envelope
{
  "command": "IssuePrescription",
  "actor": { "kind": "agent", "id": "builder-7", "session": "..." },
  "trace_id": "TASK-RX-ISSUE-014",
  "inputs": { "visit_id": "...", "rx_draft_id": "..." },
  "emits": ["PrescriptionSignedOff", "PrescriptionIssued"],
  "ts": "2026-06-25T11:04:00Z"
}
```

---

## 10. Risk-based human-in-the-loop routing

| Risk tier | Triggers | Gate |
|---|---|---|
| **Low** | internal refactor, docs, presentational tweak | **Automated gates only.** |
| **High → mandatory human review** | dosing; prescription **issuance**; patient data / PHI; ABDM / FHIR; secrets; **any model / prompt / reference change** | **Full eval gate + a named human approver before merge.** |
| **Critical → explicit confirm even with auto-approve on** | delete / force-push / prod / data-drop / schema-destructive | **Stop and confirm with a human** (global CLAUDE safety rule), regardless of automation. |

> Risk tier is assigned at DoR and is a required PR field. The tier selects which gates and approvers are mandatory; CI enforces that a High-tier PR cannot merge without the eval gate green and a named approver.

---

## 11. CI/CD gate topology

Today there is exactly one workflow — `.github/workflows/deploy-pages.yml` — which ships `web/` to Pages on push to `main` with **zero gates**. That is the thing this model replaces. Target topology:

```
   PR opened / pushed
        │
        ▼
   ┌─────────────────────────────── PR GATES (all required to merge) ──────────────────────────────┐
   │  lint + typecheck   unit + contract   fitness funcs   SAST (CodeQL+Semgrep)   secret scan      │
   │  (Vitest/deno test)  (Ajv/Pact)        (dep-cruiser/    + PHI/XSS rules         + gitleaks       │
   │                                          ESLint/AST)                            + push-protect   │
   │                                                                                                  │
   │  EVAL GATE (only if model/prompt/reference/Rx-schema touched):                                   │
   │    promptfoo base-vs-branch ─▶ L2 deterministic ─▶ L3 never-events (hard) ─▶ L5 severe=0         │
   │    ─▶ L4 soft ≥ threshold ─▶ cost/latency budget ─▶ PR-COMMENT DIFF                              │
   │                                                                                                  │
   │  dependency/SBOM (CycloneDX) + SRI check     traceability matrix (safety clauses verified)       │
   │  adversarial review (required check)         risk-tier human approval (if High)                  │
   └──────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                   │ all green
                                                   ▼
                          MERGE to protected `main`  ─▶  deploy (web/ + Edge Functions)
                                                   │
                                                   ▼
   ┌──────────────────────────── POST-DEPLOY (runtime verification) ──────────────────────────────┐
   │  SLOs + error budgets (availability, p95 latency, TIMEOUT RATE on Rx path)                     │
   │  ONLINE eval scoring on live traffic ─▶ alert on quality drift the golden set missed           │
   │  ALARMS: model-retirement/deprecation · timeout-rate breach · severe-error online · budget burn│
   │  runbooks: pre-validated fallback model + drilled rollback                                      │
   └──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Branch protection encodes A1+A2:** `main` requires all the above checks green; no force-push; no self-merge of a High-tier PR without the named approver. An agent literally cannot click past a red gate.

---

## 12. Build-execution model — scaffolding-as-workflow + parallel worktrees

1. **Scaffolding workflow (spec-synced by construction).** A spec-driven workflow generates the **repo skeleton** — folder structure, ports/adapters, command bus, **CI gates, fitness functions, test + eval harness, DoD gates, contract schemas, traceability matrix** — *from the spec*. The skeleton is correct-by-construction and re-generable; divergence from spec is a CI failure. (This also creates the missing `package.json` / `deno.json` / CI test jobs that do not exist today.)

2. **Parallel feature workflows in isolated git worktrees.** Each vertical slice is built in its **own worktree**, gated by the identical checks. On Windows, use the **`windows-parallel-agents`** protocol (worktree isolation + commit hygiene) to avoid cross-agent file leakage and missed commits.

3. **Safe / incremental rollout, not big-bang.** First slice = **off-edge async + streaming generation** (move Rx generation off the Edge Function constraint and stream results), behind the same gates. Expand vertically. The clinical-safety bar holds at every slice; **physician sign-off (F4) is preserved throughout**.

```
   SPEC ──▶ [ scaffolding workflow ] ──▶ skeleton (gates + harness + schemas + matrix)
                                              │
                  ┌───────────────────────────┼───────────────────────────┐
                  ▼                           ▼                           ▼
         worktree: slice A            worktree: slice B            worktree: slice C
         (off-edge async + stream)    (...)                        (...)
         identical gates              identical gates              identical gates
                  └───────────────────────────┴───────────────────────────┘
                                              ▼
                              merge each slice to protected main, in order
```

---

## 13. Worked end-to-end: "answer from data, not guesswork"

**Scenario:** an agent must swap the Claude model (the real 2026-06-25 incident) or edit `core_prompt.md`.

1. **DoR.** Task gets a trace ID, links to the affected spec clause, and is tagged **High risk** (model/prompt). Required eval cases identified; "new golden cases required?" answered.
2. **RED.** If a new failure mode is in scope, a **new golden eval case** (with severity tag + forbidden outputs) is added *first* and is expected to constrain the change.
3. **IMPLEMENT.** The model id changes **only in the centralized config adapter** (F5 blocks it anywhere else); the prompt edit is **versioned**.
4. **CI eval gate (promptfoo Action).** Runs the golden set on **base vs branch**, side by side:
   - L2 deterministic: dose-engine cross-check, allergy/interaction, JSON-Schema, NABH block.
   - **L3 never-events: 100% pass; L5 severe-error count: 0** — else hard fail.
   - L4 soft-quality (G-Eval): ≥ threshold; **cost + latency** within budget.
   - **PR comment** posts the diff: cases improved/regressed, Δ severe errors, Δ cost, Δ latency.
5. **Structural gate.** Fitness functions confirm the model id stayed in config (F5), the vendor stayed behind the adapter (F2), no boundary crossed.
6. **Adversarial reviewer (independent agent).** Probes for a regression the dataset missed and for prompt-injection exposure; can demand a new golden case.
7. **Human review (High tier).** Physician / eng lead approves on the **data**, not vibes.
8. **Merge → rollout.** The versioned change ships with a **pre-validated fallback model + documented rollback**. **Online eval** monitors live Rx quality; alarms fire on drift, timeout-rate, and the next deprecation — so the incident **cannot recur silently**.

**Result.** The decision that was made by guesswork is now made by a **scored base-vs-branch diff, gated on never-events and severe-error count, with a rollback path.** That is the entire point of the operating model.

---

## 14. Honest caveats

Carry these into every spoke file; they keep the model truthful.

- **An eval suite is only as good as its golden set.** v1 (~30–50 cases) is a **safety net, not proof of safety** — grow it from production misses.
- **LLM-judge scores drift when the judge model updates.** Pin the judge version and re-validate against human labels; **never let a judge verify a dose** (that is L2's job, against the deterministic engine).
- **This is engineering rigor, not regulatory clearance.** **CDSCO is the binding regulator.** Severe-error gating + **mandatory physician sign-off (F4)** remain the real clinical safety backstop.
- **Don't front-load enterprise ceremony — front-load the gates that block harm.** Start with **5 fitness functions and ~30–50 eval cases** tied to the highest patient-safety risk; let the harness **accrete** from postmortems and production misses.

---

## A. The operating-model digest is the constitution

The `OPERATING-MODEL DIGEST` is the single source of truth that every discipline file (this one included) conforms to. **Where a downstream file disagrees with the digest, the digest wins — until amended via [ADR](#10-change-management-versioning-adrs--rollback-drills).** This README is the digest's primary expansion: it does not add new policy beyond it, only operationalizes it. If you find a contradiction between this README and the digest, the digest is correct and this file has a bug — file an ADR.

## B. Glossary

| Term | Meaning |
|---|---|
| **Fitness function** | An automated test *for the architecture* that fails the build when code violates a structural invariant. |
| **Golden eval set** | Versioned, train/test-split dataset of clinical cases with expected dosing facts, forbidden outputs, and severity tags. |
| **Never-event** | A clinical failure so severe that any single occurrence hard-fails CI regardless of aggregate score (exceeds max dose, prescribes a known allergen, missing NABH block). |
| **Deterministic safety gate** | The eval layer (L2) that uses JSON-Schema + real-dose-engine cross-checks — no judge model — to gate every relevant PR. |
| **LLM-judge** | A pinned model scoring soft quality (note completeness, clarity, plausibility) only; never verifies a dose. |
| **Severity scorecard** | Failure tagging (no-harm/mild/moderate/severe) whose headline metric is the **severe-error count**. |
| **Symmetric actor** | A human or agent — both issue commands on the bus and are bound by identical gates and audit. |
| **Trace ID** | The identifier that links a spec clause → task → code module → test → eval case for the traceability matrix. |
| **Model-id firewall** | F5: vendor model ids live only in the centralized config adapter, monitored for deprecation; a swap is a gated change, never a hotfix. |
| **Off-edge async + streaming** | The first rollout slice: Rx generation moved off the Edge Function constraint, results streamed. |
| **PCCP-style change mgmt** | Pre-defined allowed prompt/model changes within intended use, each validated by the eval suite with a drilled rollback. |

## C. Relevant repo paths (absolute)

- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\.github\workflows\deploy-pages.yml` — current zero-gate deploy (the thing to gate).
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\web\dose-engine.js` — dosing source of truth; anchor of fitness rule F3 and the L2 deterministic cross-check; first TDD target.
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\radhakishan_system\scripts\integration_test.js` — existing hand-rolled shape smoke test (to be superseded by the eval + contract harness).
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\supabase\functions\generate-prescription\` — Rx-generation Edge Function; primary eval-gated surface.
- **Confirmed (2026-06-25):** no `package.json` / `deno.json` at root and no CI test job exist — the scaffolding workflow (§12) must create these.

---

> **Bottom line.** Rigor is not a culture here; it is a set of machine-checkable gates an actor cannot bypass. Quality is not a vibe; it is a scored diff against versioned clinical data. Drift is not caught in review; it is blocked structurally by fitness functions and behaviorally by evals, on every change, before it reaches a patient.
