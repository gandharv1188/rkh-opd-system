---
doc_id: ENG-DISC-BUILD-EXEC-001
title: Build-Execution Workflow — Spec-Driven Scaffolding + Parallel Worktree Feature Workflows
layer: engineering-discipline
status: binding
applies_to: rebuild (agent-built pediatric OPD prescription system)
spec_independent: true
authority: |
  Conforms to the OPERATING-MODEL DIGEST and to 09_engineering_discipline/README.md.
  Where this file disagrees with the digest or the README, those win until amended via ADR.
  This file is methodology/governance only; it does NOT define the product architecture
  (authored in parallel under system-spec/0X_architecture/*, married at synthesis time).
trace_id: TRACE-ENG-BUILD-EXEC
owner: eng-lead
last_reviewed: 2026-06-25
implements_axioms: [A1, A2, A4]
gate_produced: generated-files-in-sync gate (scaffold ↔ spec); per-slice DoD gate parity
related:
  - README.md
  - drift_control.md
  - quality_gates_ci.md
  - evals_framework.md
  - definition_of_ready_done.md
  - agent_operating_model.md
  - testing_strategy.md
  - code_review_standards.md
---

# Build-Execution Workflow

> **One-line thesis.** The build is not "agents writing files into a repo." The build is **two cooperating agent workflows**: (1) a **spec-driven scaffolding workflow** that *generates* the repo skeleton — structure, ports/adapters, command bus, CI gates, fitness functions, the test + eval harness, and the DoD gates — directly **from the spec**, so the skeleton is *spec-synced by construction*; then (2) **parallel feature workflows**, each in an **isolated git worktree**, building one vertical slice at a time, every one gated by the **identical** checks the scaffold emitted. The scaffold makes the gates exist and be unbypassable; the worktrees make parallelism safe; spec-sync maintenance keeps both honest as the spec evolves. **Done = proven + gated, never declared.**

This document is the authority for **how the rebuild physically runs as agent workflows**. It owns the mechanics that the [README](./README.md) §12 ("Build-execution model") and the digest §8 describe at the level of principle. It is the operational complement to [`drift_control.md`](./drift_control.md) (which owns *what* must not drift) and [`quality_gates_ci.md`](./quality_gates_ci.md) (which owns *the gate definitions*). This file owns the *execution choreography*: scaffold-then-slice, worktree isolation, coordination, integration, and spec-sync maintenance.

**Founding incident (the reason this file is normative).** On 2026-06-25 a hardcoded dated Claude model id was retired by the vendor and broke production; the emergency fix swapped models and tuned reasoning effort **by guesswork** because there was no harness to answer "did Rx quality get better, worse, or unsafe?" The current repo has **no `package.json`/`deno.json` at root** and **exactly one CI workflow** (`.github/workflows/deploy-pages.yml`) that ships `web/` to Pages with **zero gates**. The scaffolding workflow's first job is to make that harness and those gates *exist*; every feature workflow's job is to never merge anything past them.

---

## Table of contents

1. [The build as two workflows (the picture)](#1-the-build-as-two-workflows-the-picture)
2. [Why this model (and what it replaces)](#2-why-this-model-and-what-it-replaces)
3. [Workflow A — spec-driven scaffolding](#3-workflow-a--spec-driven-scaffolding)
4. [The generated skeleton — exhaustive manifest](#4-the-generated-skeleton--exhaustive-manifest)
5. [Spec-synced by construction — the generation contract](#5-spec-synced-by-construction--the-generation-contract)
6. [Workflow B — parallel feature workflows in isolated worktrees](#6-workflow-b--parallel-feature-workflows-in-isolated-worktrees)
7. [Worktree isolation protocol (Windows-safe)](#7-worktree-isolation-protocol-windows-safe)
8. [The per-slice loop — RED→…→DoD inside a worktree](#8-the-per-slice-loop--reddod-inside-a-worktree)
9. [Coordination across parallel slices](#9-coordination-across-parallel-slices)
10. [Integration — merging slices into a green trunk](#10-integration--merging-slices-into-a-green-trunk)
11. [Spec-sync maintenance — keeping scaffold ↔ spec ↔ code honest](#11-spec-sync-maintenance--keeping-scaffold--spec--code-honest)
12. [Slice sequencing & incremental rollout](#12-slice-sequencing--incremental-rollout)
13. [Roles, audit, and command-bus symmetry during the build](#13-roles-audit-and-command-bus-symmetry-during-the-build)
14. [Failure modes & recovery runbooks](#14-failure-modes--recovery-runbooks)
15. [Checklists (copy-paste)](#15-checklists-copy-paste)
16. [Honest caveats](#16-honest-caveats)
17. [Appendix A — directory contract the scaffold emits](#appendix-a--directory-contract-the-scaffold-emits)
18. [Appendix B — glossary delta](#appendix-b--glossary-delta)

---

## 1. The build as two workflows (the picture)

```
                          THE BUILD, AS TWO COOPERATING AGENT WORKFLOWS

  ┌───────────────────────────────────────────────────────────────────────────────────┐
  │ WORKFLOW A — SPEC-DRIVEN SCAFFOLDING  (runs once to bootstrap, re-runs on spec drift)│
  │                                                                                     │
  │   system-spec/*  ──generate──▶  REPO SKELETON                                       │
  │   (machine-readable        ┌── structure (ports/adapters, command bus, contexts)     │
  │    spec surface)           ├── CI gates  (.github/workflows/*.yml)                    │
  │                            ├── fitness functions (dependency-cruiser, ESLint, AST)    │
  │                            ├── test harness (Deno test + Vitest + Playwright)         │
  │                            ├── eval harness (promptfoo + DeepEval + golden set dir)   │
  │                            ├── contract schemas (Ajv JSON-Schema, FHIR profiles)      │
  │                            ├── DoD gate wiring (PR template + required checks)         │
  │                            └── traceability matrix generator (spec↔task↔code↔test↔eval)│
  │                                                                                     │
  │   PROPERTY: the skeleton is SPEC-SYNCED BY CONSTRUCTION. Re-running the generator    │
  │   over an unchanged spec is a NO-OP. Any hand-edit that diverges from generated       │
  │   output FAILS the `generated-files-in-sync` CI check.                                │
  └───────────────────────────────────────────────────┬──────────────────────────────-┘
                                                       │ emits the gates + harness
                                                       ▼
  ┌───────────────────────────────────────────────────────────────────────────────────┐
  │ WORKFLOW B — PARALLEL FEATURE WORKFLOWS  (one vertical slice per isolated worktree)  │
  │                                                                                     │
  │   trunk (protected `main`)                                                          │
  │      ├── worktree: slice/rx-generation-offedge   ──▶ same gates ──▶ PR ──▶ merge      │
  │      ├── worktree: slice/registration-context    ──▶ same gates ──▶ PR ──▶ merge      │
  │      └── worktree: slice/dose-engine-port         ──▶ same gates ──▶ PR ──▶ merge      │
  │            (≤3 active branches; each gated by the IDENTICAL checks Workflow A emitted) │
  │                                                                                     │
  │   PROPERTY: isolation prevents cross-agent file leakage / missed commits (Windows).   │
  │   Every slice passes BOTH drift axes (structural fitness + behavioral evals) + DoD.   │
  └───────────────────────────────────────────────────────────────────────────────────┘
```

**Two invariants make the whole model work:**

| Invariant | Owned by | Enforced by |
|---|---|---|
| **The gates exist and are unbypassable.** | Workflow A (scaffold) | Generated branch-protection + required-checks + PR template; `generated-files-in-sync` gate. |
| **Every slice passes the same gates, in isolation.** | Workflow B (slices) | Per-worktree CI runs the identical workflows; merge blocked on red; worktree isolation prevents leakage. |

---

## 2. Why this model (and what it replaces)

### 2.1 What it replaces

| Today (verified 2026-06-25) | Why it fails | This model's answer |
|---|---|---|
| No root `package.json`/`deno.json`; no CI test job. | There is nowhere to *hang* a gate; "done" is pure assertion (violates **A1**). | Scaffold generates the manifests, harness, and required checks **first**, before any feature work. |
| Single `deploy-pages.yml` ships `web/` with **zero gates**. | A red change reaches users; the model-retirement incident shipped unscored. | Scaffold emits gated CI; deploy is downstream of green gates, never parallel to them. |
| Hand-rolled `integration_test.js` live-API smoke test, not in CI. | A shape check that no one runs is not a gate (violates **A2**). | Superseded by the generated contract + eval harness wired as required checks. |
| Model swaps fixed by guesswork. | No data to decide (violates **A3**). | Every slice that touches model/prompt runs the eval gate the scaffold installed. |
| Ad-hoc edits across one working tree by serial agents. | Cross-agent file leakage / missed commits on native Windows; serial = slow. | Parallel **isolated worktrees** under the windows-parallel-agents protocol. |

### 2.2 Why scaffold-first, not feature-first

If you build features before gates, the gates get retrofitted to whatever the features happened to do — and retrofitted gates rationalize the existing code instead of constraining it. **Generate the gates from the spec first**, then make every feature earn its way past them. This is the structural expression of **A1 (done = proven + gated)** and **A2 (enforce in CI, not in convention)**: the rules predate the code that must obey them.

### 2.3 Why parallel worktrees, not a shared tree

- **Isolation** — each slice gets its own checkout; one agent's uncommitted edits cannot leak into another's diff (a known native-Windows failure mode).
- **Identical gating** — every worktree runs the *same* generated CI, so "passes in my worktree" means the same thing everywhere.
- **Trunk discipline** — short-lived branches, ≤3 active, protected `main`; integration is frequent and small (DORA), so merge conflicts stay shallow.

> **Decisive stance.** Worktrees are the default unit of parallel work for the rebuild. Multiple agents editing one working tree is **prohibited** for feature work; it is allowed only for the scaffold bootstrap (a single agent) and for trivial single-file docs changes outside `src/`.

---

## 3. Workflow A — spec-driven scaffolding

### 3.1 What "spec-driven" means here

A subset of `system-spec/*` is authored (or projected) into a **machine-readable spec surface** — structured front-matter and small JSON/YAML manifests that the generator reads. The generator is a deterministic, idempotent program (a Deno/Node CLI, version-pinned) that turns that surface into the skeleton. **Humans/agents do not hand-write the skeleton; they edit the spec and re-generate.**

> The *content* of the spec surface (which contexts, which ports, which adapters) is owned by the architecture spec — this file is spec-independent and does **not** invent it. This file owns the *generation mechanism, the idempotency contract, and the sync gate*.

### 3.2 The scaffolding workflow, step by step

```
SCAFFOLDING WORKFLOW (single orchestrator agent; auditable command stream)

 0. PRECONDITION  spec surface present + valid (schema-checked); ADRs for tooling choices resolved.
 1. PLAN          read spec surface → compute target skeleton manifest (deterministic).
 2. RED           generate the gate/harness FIRST in a failing state:
                    - CI workflows that REQUIRE checks which do not yet pass
                    - fitness-function configs that fail on the empty/placeholder tree
                    - eval harness pointed at an empty golden set (fails "min cases" assertion)
 3. GENERATE      emit structure, ports/adapters stubs, command-bus skeleton, contract schemas,
                  test+eval harness, DoD wiring, traceability generator.
 4. GREEN-FLOOR   bring the skeleton to a MINIMAL GREEN: placeholder tests pass, fitness functions
                  pass on the stub tree, eval harness runs the seeded ~30–50 golden cases.
 5. VERIFY        run the full generated CI locally; confirm branch protection + required checks wired.
 6. EMIT-MANIFEST write `.scaffold/manifest.lock` (hash of every generated file) for the sync gate.
 7. DoD           scaffold PR passes its own DoD; merged to protected `main` as commit 0 of the rebuild.
```

**The scaffold is itself a gated PR.** It does not get to skip the discipline it installs. Its DoD includes: the generated CI is green, the `generated-files-in-sync` check passes, the seeded golden set runs, and an ADR records every canonical-tooling choice it bakes in (per digest §1).

### 3.3 Idempotency & re-generation contract

| Property | Rule |
|---|---|
| **Idempotent** | Re-running the generator over an unchanged spec surface produces **byte-identical** output (no timestamps, sorted keys, stable ordering). |
| **No-op detection** | If output == working tree, the generator exits 0 and changes nothing. |
| **Divergence = failure** | The `generated-files-in-sync` CI check re-runs the generator in a temp dir and `diff`s against the tree. Any delta in a generated file **fails the build**. |
| **Escape hatch is explicit** | Files the generator owns carry a header banner: `// GENERATED FROM system-spec — DO NOT EDIT. Change the spec and re-generate.` Hand-editable files are *not* under `.scaffold/manifest.lock`. |

---

## 4. The generated skeleton — exhaustive manifest

The scaffold emits **all of the following** (this is the contract; the architecture spec decides the *names/shape* of the domain pieces, the discipline decides that they *exist and are gated*):

| Category | Generated artifact(s) | Gate it makes possible |
|---|---|---|
| **Root manifests** | `package.json` (Vitest/Playwright/ESLint/dependency-cruiser/Ajv deps, scripts), `deno.json` (Edge Function tasks/imports), committed lockfiles. | Anything to hang CI on (fixes "nowhere to gate"). |
| **Structure** | Bounded-context folders, **ports** (interfaces) + **adapters** (vendor impls), **command bus** skeleton, **CQRS** read/write split, event log scaffolding. | Boundary fitness functions; symmetric-actor audit envelope. |
| **Anti-corruption layer** | Adapter stubs for AI-model / ABDM / OCR vendors; **centralized config adapter** (the *only* place vendor model ids + secrets live). | `model-id-in-config` and `no-secrets` fitness functions; the **model-retirement firewall**. |
| **CI gates** | `.github/workflows/ci.yml` (test, fitness, contract, eval, SAST, secret/dep scan) wired as **required checks**; deploy made downstream of green CI. | Replaces the zero-gate `deploy-pages.yml` topology. |
| **Fitness functions** | `dependency-cruiser` config (no-circular, boundaries, domain⇏vendor SDK), ESLint flat config (custom rules), AST/grep fitness tests. | **Structural drift axis** (5 starter rules). |
| **Test harness** | `deno test` setup (Edge Functions), Vitest config + jsdom (frontend/shared logic incl. dose-engine), Playwright config (E2E print/sign-off). | Unit/contract/component/E2E suites. |
| **Eval harness** | `evals/` dir: `promptfoo` config (PR base-vs-branch GitHub Action), `deepeval` pytest scaffold (G-Eval rubrics), **golden set dir** with seed schema + ~30–50 seeded cases, scorers (deterministic dose-engine cross-check, allergy/interaction, never-events, severity scorecard). | **Behavioral drift axis** (the eval gate). |
| **Contract schemas** | Ajv JSON-Schema for Claude tool I/O + Rx output (4-row format, safety block, NABH block); ABDM **FHIR R4** profiles + provider-verification harness; HL7 FHIR validator step. | Contract gate at every vendor seam. |
| **DoD wiring** | `.github/pull_request_template.md` (the DoD checklist), required-checks config, branch-protection-as-code. | Makes DoD **unbypassable** (A1/A2). |
| **Traceability** | Trace-ID front-matter convention + a generator that builds the **spec↔task↔code↔test↔eval matrix** and fails if a safety-critical clause lacks a verifying test/eval. | Spec-drift / coverage gate. |
| **Security/supply-chain** | CodeQL + Semgrep (PHI/XSS rules) workflow, gitleaks + push-protection, Renovate config (security auto-merge only), CycloneDX SBOM step, SRI-checker for CDN `<script>`. | Security + supply-chain gates. |
| **Observability hooks** | Structured event-log interface on the command bus; Sentry init stub; online-eval emit point; alarm config stubs (model-deprecation, timeout-rate, severe-error online score). | Runtime verification + drift alarms. |
| **Sync lock** | `.scaffold/manifest.lock` (hashes of generated files). | `generated-files-in-sync` gate. |

> Every artifact above is *generated from the spec surface and CI-checked for sync* — the skeleton cannot silently rot away from the spec.

---

## 5. Spec-synced by construction — the generation contract

"Spec-synced by construction" is a precise claim with four enforceable parts:

```
   spec surface ──(generator, idempotent)──▶ generated skeleton
        │                                            │
        │   (1) generation is the ONLY way           │  (2) generated files carry a
        │       skeleton files come to exist         │      DO-NOT-EDIT banner
        │                                            │
        ▼                                            ▼
   (3) `generated-files-in-sync` CI re-runs    (4) traceability matrix proves every
       generator, diffs tree → red on drift        safety-critical spec clause has a test/eval
```

| Part | Mechanism | Failure surfaced as |
|---|---|---|
| (1) Generation is the only source | No PR may add a file *under generator ownership* by hand. | Reviewer + CI reject; banner missing. |
| (2) Edits are detectable | DO-NOT-EDIT banner + `manifest.lock` hashes. | Hash mismatch → `generated-files-in-sync` fails. |
| (3) Drift is a build failure | CI re-generates in temp, diffs. | Red required check; merge blocked. |
| (4) Coverage is provable | Traceability generator fails on uncovered safety-critical clause. | Red traceability gate. |

> **Decisive stance.** If you want the skeleton different, **change the spec and re-generate** — never patch the skeleton. This is the only behavior that keeps the spec-independent discipline and the parallel architecture spec from diverging before synthesis.

---

## 6. Workflow B — parallel feature workflows in isolated worktrees

### 6.1 A "vertical slice" defined

A slice is the **thinnest end-to-end change that delivers behavior across all layers** it touches — e.g. "move Rx generation off-edge with streaming" spans the command (write side), the AI adapter (vendor seam), the dose-engine port (dosing source of truth), the contract schema (Rx output), the eval cases (clinical safety), and the UI streaming surface. A slice is **not** a layer ("do all the adapters") — that re-introduces big-bang risk and starves the gates of end-to-end signal.

### 6.2 One worktree per slice

```
   main (protected)
     │
     ├── git worktree add ../wt-rx-offedge   slice/rx-generation-offedge
     ├── git worktree add ../wt-registration slice/registration-context
     └── git worktree add ../wt-dose-port     slice/dose-engine-port
            each worktree = its own checkout, its own branch, its own agent,
            its own CI run on push — IDENTICAL gates, zero shared mutable state.
```

| Property | Why it matters here |
|---|---|
| **Separate checkout per branch** | An agent's uncommitted edits live only in its worktree — no leakage into a sibling's diff. |
| **Same `.git` object store** | Cheap; branches/commits visible to the orchestrator for coordination. |
| **Identical generated CI** | "Green in my worktree" == "green everywhere"; gate parity is structural, not promised. |
| **≤3 active at once** | Trunk-based discipline; keeps integration small and conflicts shallow. |

### 6.3 Dispatch protocol

Parallel slices are dispatched under the **windows-parallel-agents** skill (mandatory on this Windows host) — it owns worktree creation/teardown, commit hygiene, and the anti-leakage rules. For 2+ independent slices, the orchestrator follows that protocol; `superpowers:using-git-worktrees` is the cross-platform fallback. **Do not** use the bare Agent-tool `isolation="worktree"` without the windows-parallel-agents protocol on this host.

---

## 7. Worktree isolation protocol (Windows-safe)

The native-Windows failure modes this prevents: (a) **cross-agent file leakage** (one agent reads/writes another's working files), and (b) **missed commits** (work left uncommitted in a worktree the orchestrator then deletes).

### 7.1 Hard rules

- [ ] **One agent, one worktree, one branch.** Never two agents in the same worktree.
- [ ] **Absolute paths only.** Agent cwd resets between calls on this host; every file op uses the worktree's absolute path. No reliance on "current directory."
- [ ] **Commit before handoff/teardown.** A worktree is never removed until its branch is pushed and the orchestrator has confirmed the commit SHA. Uncommitted work = lost work.
- [ ] **No writes outside your worktree** except the shared scratchpad (temp/intermediate only — never source).
- [ ] **Pull trunk before opening a PR.** Rebase the slice on latest `main` so the PR's CI reflects the post-merge world.
- [ ] **Lockfile changes are a coordination event** (see §9): two slices bumping deps in parallel is a known conflict source — serialize or reconcile.

### 7.2 Lifecycle

```
   CREATE    git worktree add  <abs-path>  slice/<name>     (branch off latest main)
   WORK      agent runs the per-slice loop (§8) entirely inside <abs-path>
   COMMIT    small, signed-off commits; trailer carries trace_id + actor={human|agent}
   PUSH      push branch; open PR (CI runs the generated gates)
   VERIFY    orchestrator records SHA; confirms required checks green
   TEARDOWN  ONLY after merge + SHA confirmed:  git worktree remove <abs-path>
```

---

## 8. The per-slice loop — RED→…→DoD inside a worktree

Every slice runs the canonical loop (README §9 / agent_operating_model). It happens **entirely inside the worktree**; nothing reaches `main` until DoD's required checks are green.

```
 PLAN ─▶ RED (failing test/eval first) ─▶ IMPLEMENT ─▶ GREEN
   ─▶ ADVERSARIAL INDEPENDENT-AGENT REVIEW ─▶ AUTOMATED GATES (CI)
   ─▶ VERIFY (run the real flow) ─▶ DoD ─▶ MERGE
```

| Stage | What the slice agent does | Gate / evidence produced |
|---|---|---|
| **PLAN** | Spec clause → tasks with **trace IDs**, **DoR** satisfied, **risk tier** assigned, eval cases identified. | DoR check (trace ID + acceptance criteria + named fitness rules + risk tier). |
| **RED** | Write the **failing test first**; if a new clinical failure mode is in scope, **add the golden eval case first** (severity tag + forbidden outputs). | Red test/eval committed (TDD evidence in PR history). |
| **IMPLEMENT** | Minimal code to satisfy the test; vendor ids/secrets only in the config adapter; prompts versioned. | — |
| **GREEN** | Unit/contract/component/E2E suites pass; coverage on safety-critical paths ≥ threshold. | Green test suites. |
| **ADVERSARIAL REVIEW** | A **separate** agent/human tries to break the slice: boundary violations, missing never-event coverage, unsafe dosing assumptions, prompt-injection surfaces. **No self-review.** | Independent review approval. |
| **AUTOMATED GATES** | CI runs **both drift axes**: structural fitness functions **and** the eval gate (never-events 100%, severe-errors = 0, soft-quality ≥ threshold, cost/latency in budget, base-vs-branch diff posted). | Structural gate + eval gate + SAST/secret/dep/SBOM/SRI + traceability. |
| **VERIFY** | Run the actual flow (Playwright E2E or a live eval run) — confirm behavior, not just green unit tests. | Verifier evidence. |
| **DoD** | Full DoD checklist (README §8) satisfied as **required checks**; risk-tier human approval where required. | All required checks green → mergeable. |
| **MERGE** | Squash/rebase onto trunk; versioned change ships with pre-validated fallback + documented rollback for model/prompt slices. | Merge commit; online-eval monitoring active. |

> **Gate parity is the point.** The checks a slice must pass are *exactly* the ones the scaffold emitted — not a per-slice variant. An agent cannot weaken its own gates because the workflows are generated, sync-locked, and required by branch protection.

---

## 9. Coordination across parallel slices

Parallelism is cheap until two slices touch the same surface. The orchestrator manages four coordination surfaces:

| Coordination surface | Risk if uncoordinated | Protocol |
|---|---|---|
| **Shared contracts** (Rx schema, tool I/O, FHIR profiles, ports) | Two slices change the same schema → silent contract break on merge. | A contract change is its **own slice / ADR**, landed first; dependent slices rebase onto it. Contracts are versioned; consumers pin. |
| **The golden eval set** | Two slices add overlapping/conflicting cases. | Golden cases are append-only with unique IDs; case additions reviewed; train/test split preserved; conflicts resolved at integration (§10). |
| **Lockfiles / deps** | Parallel dep bumps → merge conflict + supply-chain surprise. | Dep changes serialized through a single "deps" slice or Renovate; a slice that *must* add a dep flags it as a coordination event. |
| **The config adapter** (model ids, secrets, vendor endpoints) | The model-retirement firewall is a single file two slices may both edit. | Config changes are **High-risk** (human review) and serialized; never two open PRs editing model ids at once. |

```
   ORCHESTRATOR (planner/integrator) keeps a live slice map:

   slice               touches-contract?  touches-config?  touches-golden-set?  risk
   ─────────────────── ─────────────────  ───────────────  ───────────────────  ────
   rx-generation-offedge   Rx-schema(read)     model-id(R)        +5 cases        HIGH
   registration-context    none                none              +2 cases        MED
   dose-engine-port        dose-port(write)    none              +8 cases        HIGH

   Rule: at most ONE open slice may WRITE a given shared surface at a time.
   Others READ the published version or wait.  Conflicts are designed out, not merged out.
```

> **Decisive stance.** Conflicts on shared contracts/config/golden-set are prevented by **sequencing**, not resolved by hoping git merges cleanly. The orchestrator serializes writes to shared surfaces; reads parallelize freely.

---

## 10. Integration — merging slices into a green trunk

Trunk-based, continuous, small. Integration is where gate parity pays off: because every slice passed the *same* generated gates, integrating them is mostly mechanical.

### 10.1 Merge procedure (per slice)

```
 1. REBASE     rebase slice on latest main (resolve any shared-surface delta per §9).
 2. RE-GATE    push → CI re-runs ALL generated gates against the post-rebase tree.
               (structural fitness + eval base-vs-branch + contract + SAST + traceability)
 3. DIFF       eval gate posts base-vs-branch PR comment: Δ severe errors, Δ cost, Δ latency,
               which golden cases improved/regressed.  Δ severe errors > 0  ⇒  BLOCK.
 4. REVIEW     adversarial-agent approval + risk-tier human approval (High tier).
 5. MERGE      squash to a single trace-tagged commit on protected main.
 6. POST-MERGE main's CI runs again (integration safety); online eval monitors live traffic.
```

### 10.2 Integration-time invariants

- [ ] **Never-events stay at 100% pass** post-merge (a slice cannot regress another slice's safety case).
- [ ] **`generated-files-in-sync` green** — no slice hand-edited a generated file.
- [ ] **Traceability matrix resolves** — every safety-critical clause touched still has a verifying test/eval.
- [ ] **No contract break** — Ajv + FHIR validator green against the integrated tree.
- [ ] **SLO/perf budgets** for the Rx path still within budget (cost/latency eval assertions).

### 10.3 Why integration stays cheap

```
   Because each slice was gated by the SAME checks BEFORE merge,
   integration cannot introduce a NEW class of failure — only a
   COLLISION between two already-green slices. Collisions are caught
   by re-gating on rebase, and prevented up-front by §9 sequencing.
   ⇒ no big-bang integration phase; trunk is green continuously.
```

---

## 11. Spec-sync maintenance — keeping scaffold ↔ spec ↔ code honest

The spec is authored **in parallel** with this discipline and **evolves**. Three sync relationships must hold for the life of the build:

| Relationship | Drift symptom | Maintenance mechanism | Gate |
|---|---|---|---|
| **spec ↔ scaffold** | Skeleton no longer matches the spec surface. | Re-run the generator (idempotent); diff. | `generated-files-in-sync` — red on any delta. |
| **scaffold ↔ code** | A slice hand-edited a generated file, or added a generator-owned file by hand. | DO-NOT-EDIT banner + `manifest.lock` hashes. | hash mismatch → red. |
| **spec ↔ code (coverage)** | A safety-critical spec clause has no verifying test/eval. | Traceability generator builds spec↔task↔code↔test↔eval matrix. | uncovered safety clause → red. |

### 11.1 When the spec changes

```
 1. EDIT      change the spec surface (architecture spec owns the content).
 2. ADR       if it changes a canonical tooling/gate/model policy → ADR (per digest §1).
 3. REGEN     re-run the scaffolding generator → updated skeleton (its own gated PR/slice).
 4. RE-GATE   the scaffold-update PR passes its own DoD (incl. `generated-files-in-sync`).
 5. CASCADE   open slices rebase onto the regenerated skeleton; re-gate.
```

### 11.2 The sync gate, in CI (illustrative)

```yaml
# .github/workflows/ci.yml  (generated; required check)
jobs:
  generated-files-in-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<pinned-sha>
      - name: Re-generate skeleton from spec into a temp tree
        run: deno task scaffold:generate --out ".scaffold/_check"
      - name: Diff generated output against committed tree
        run: deno task scaffold:verify   # diffs + checks manifest.lock hashes
        # ANY delta in a generator-owned file ⇒ non-zero exit ⇒ red required check
```

> **Decisive stance.** Spec-sync is not a review responsibility — it is a **required CI check**. A human reviewer cannot be the thing standing between the spec and the code, because humans (and agents) drift. The generator + sync gate are.

---

## 12. Slice sequencing & incremental rollout

Safe/incremental rollout, **not big-bang** (digest §8.3). The clinical-safety bar — and **mandatory physician sign-off** — holds at *every* slice.

### 12.1 Sequencing principles

| Principle | Rationale |
|---|---|
| **Foundational ports first** | The dose-engine port and config adapter are dependencies of nearly every other slice; land them early so later slices read stable contracts. |
| **Highest-safety-risk surfaces get the first real eval cases** | Neonate/preterm/renal-GFR/allergy/interaction edges seed the golden set before features that exercise them merge. |
| **One shared-surface writer at a time** (§9) | Sequencing designs out the worst conflicts. |
| **Thin vertical slices** | Each merge delivers end-to-end behavior + exercises both drift axes — continuous signal, no integration cliff. |

### 12.2 First slice (decisive)

> **First vertical slice = move Rx generation off the Edge Function constraint, async + streaming, behind the same gates.** It exercises the AI adapter (vendor seam), the dose-engine port (A5), the Rx contract schema, the eval gate (clinical safety), and the streaming UI surface — the highest-leverage end-to-end path — while preserving physician sign-off throughout. It is the proving ground for gate parity: if the first slice cannot pass the generated gates, the scaffold is wrong, not the slice.

### 12.3 Rollout staging

```
   scaffold (commit 0)
        │
        ▼
   slice 1: rx-offedge-streaming ──▶ behind flag, gated, sign-off preserved ──▶ canary ──▶ default
        │
        ▼
   slice 2..N: expand vertically (context by context), each gated identically, each rolled out
               incrementally with a pre-validated fallback model + documented, drilled rollback.
```

Every model/prompt-touching slice ships with a **pre-validated fallback model + documented rollback** and **online eval monitoring** — so the founding model-retirement incident cannot recur silently.

---

## 13. Roles, audit, and command-bus symmetry during the build

Humans and AI are **symmetric actors** (A4): every state-changing build action is a **command** carrying `actor={human|agent}` + an audit envelope, and the same gates apply to both.

| Role | In the scaffolding workflow | In a feature workflow |
|---|---|---|
| **Orchestrator / Planner** | Reads spec surface; runs the generator; opens the scaffold PR. | Maintains the slice map (§9); dispatches worktrees; sequences shared-surface writes. |
| **Builder** | n/a (generator is deterministic). | Runs the per-slice RED→GREEN loop inside the worktree. |
| **Adversarial Reviewer** | Probes the generated gates for bypassability. | Independent agent/human; tries to break the slice. **No self-review.** |
| **Gatekeeper** | CI; the generated required checks. | CI; the identical generated required checks. |
| **Verifier** | Runs the full generated CI; confirms branch protection wired. | Runs the real flow (E2E / live eval). |

**Audit trail.** Every build command is logged with `actor`, `task trace_id`, inputs, and emitted events. Agents running shell/DB commands operate under **sandboxing + command allowlists + audit logging**; agent-authored code passes structured-output/schema validation before merge. Commit trailers carry `trace_id` and `actor` so the build's own history is queryable like the runtime command bus — going AI-first later is additive, not a rewrite.

---

## 14. Failure modes & recovery runbooks

| Failure mode | Symptom | Recovery runbook |
|---|---|---|
| **Cross-agent file leakage** (Windows) | A slice's diff contains files it never touched. | Stop both agents; re-derive each slice's diff from its branch only; re-run windows-parallel-agents protocol; discard the leaked tree. |
| **Missed commit / lost work** | Worktree torn down with uncommitted edits. | **Prevented** by "commit + SHA-confirm before teardown" (§7). If hit: recover from reflog/stash; if gone, re-run the slice (RED test still exists). |
| **Generated file hand-edited** | `generated-files-in-sync` red. | Revert the hand-edit; move the intended change into the spec surface; re-generate; re-gate. |
| **Two slices wrote a shared contract** | Merge conflict / contract break at integration. | Roll back the later slice; land the contract change as its own slice/ADR first; rebase dependents (§9). |
| **Eval gate red on rebase (Δ severe > 0)** | A slice that was green now regresses a sibling's safety case post-integration. | Block merge; bisect which interaction caused it; fix in the offending slice; add a golden case capturing the collision. |
| **Model deprecation alarm fires mid-build** | Vendor retiring the pinned model id. | Named runbook: swap id **only** in config adapter; run eval gate base-vs-branch; ship with fallback already validated; ADR. (The founding incident's fix, now gated.) |
| **Scaffold drifts from spec** | Spec changed but skeleton not regenerated. | Re-run generator as its own gated PR; cascade rebases to open slices (§11). |

---

## 15. Checklists (copy-paste)

### 15.1 Scaffolding workflow — Definition of Done

- [ ] Spec surface schema-valid; tooling ADRs resolved (digest §1).
- [ ] Root manifests + committed lockfiles generated; `deno.json` + `package.json` present (closes the "no root manifest" gap).
- [ ] Structure, ports/adapters, command bus, CQRS split, **centralized config adapter** emitted.
- [ ] CI gates generated as **required checks**; deploy made downstream of green CI (replaces zero-gate `deploy-pages.yml`).
- [ ] 5 starter fitness functions present and green on the stub tree.
- [ ] Test harness (Deno test + Vitest + Playwright) + eval harness (promptfoo + DeepEval) wired; **seeded ~30–50 golden cases** run.
- [ ] Contract schemas (Ajv Rx + tool I/O; FHIR R4 + validator) emitted.
- [ ] DoD wiring (PR template + branch protection-as-code) emitted and active.
- [ ] Traceability generator builds the spec↔task↔code↔test↔eval matrix; fails on uncovered safety-critical clause.
- [ ] Security/supply-chain (CodeQL+Semgrep, gitleaks+push-protection, Renovate security-only, SBOM, SRI) wired.
- [ ] `.scaffold/manifest.lock` written; `generated-files-in-sync` check green.
- [ ] Generator is idempotent (re-run = byte-identical / no-op).
- [ ] Scaffold PR passed its **own** DoD and merged to protected `main` as commit 0.

### 15.2 Feature slice (worktree) — pre-merge

- [ ] One agent / one worktree / one branch; absolute paths only.
- [ ] DoR satisfied (trace ID, acceptance criteria, named fitness rules, risk tier, eval cases).
- [ ] **RED first**: failing test (and golden eval case if new clinical failure mode) committed before implementation.
- [ ] Vendor ids/secrets only in config adapter; prompts versioned.
- [ ] Both drift axes green: structural fitness functions **and** eval gate (never-events 100%, severe = 0, soft-quality ≥ threshold, cost/latency in budget, base-vs-branch diff posted).
- [ ] Unit/contract/component/E2E suites green; safety-critical coverage ≥ threshold.
- [ ] SAST + secret/dep scan + SBOM clean; SRI on any new CDN script.
- [ ] Traceability links resolve; ADR added if an architectural/tooling/model decision was made.
- [ ] **Independent** adversarial review passed (no self-review).
- [ ] Risk-tier human approval obtained (High tier: dosing/issuance/PHI/ABDM/secrets/model-or-prompt).
- [ ] Rebased on latest `main`; re-gated post-rebase; SHA confirmed before worktree teardown.

### 15.3 Orchestrator — coordination

- [ ] ≤3 active slice branches; slice map maintained (touches-contract / config / golden-set / risk).
- [ ] At most **one** open slice writing any given shared surface (contract / config / golden set / lockfile).
- [ ] Shared-contract & config changes landed as their own slice/ADR first; dependents rebase.
- [ ] Every worktree committed + SHA-confirmed before teardown.

---

## 16. Honest caveats

- **Idempotent generation is hard to keep honest.** Non-determinism (timestamps, map ordering, dependency resolution) silently breaks the sync gate's value. Treat any flaky `generated-files-in-sync` result as a P1 generator bug, not a flaky test to retry.
- **Worktree isolation is a discipline, not a sandbox.** It prevents accidental leakage; it does not contain a malicious or runaway agent. The command allowlist + sandboxing + audit log (§13) are the actual containment.
- **The first slice tests the scaffold as much as the feature.** Expect the rx-offedge slice to surface scaffold gaps; budget for scaffold-fix ADRs early. That is the system working, not failing.
- **Spec-sync gates code structure, not clinical correctness.** A perfectly spec-synced skeleton can still generate an unsafe prescription — that is what the **eval gate** and **mandatory physician sign-off** are for. The two axes are independent for a reason (see `drift_control.md`).
- **This is engineering rigor, not regulatory clearance.** CDSCO is the binding regulator; severity-weighted eval gating + physician sign-off remain the real safety backstop. The build-execution model makes the *process* trustworthy; it does not certify the *product*.
- **Start small.** 5 fitness functions, ~30–50 golden cases, the first vertical slice. Don't front-load enterprise ceremony into the scaffold — front-load the gates that block patient harm, and let the harness accrete.

---

## Appendix A — directory contract the scaffold emits

> Illustrative shape only — the architecture spec owns the *names* of bounded contexts/ports; this discipline owns that these *categories* exist, are generated, and are sync-locked.

```
repo-root/
├── package.json                  # GENERATED — Vitest/Playwright/ESLint/dep-cruiser/Ajv + scripts
├── deno.json                     # GENERATED — Edge Function tasks + scaffold:generate/verify
├── <lockfiles>                   # committed (supply-chain pinning)
├── .scaffold/
│   ├── manifest.lock             # GENERATED — hashes of all generator-owned files
│   └── generate/                 # the generator (version-pinned, idempotent)
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                # GENERATED — test+fitness+contract+eval+SAST+scan+sync (required)
│   │   └── deploy-pages.yml      # deploy made DOWNSTREAM of green ci.yml (no longer zero-gate)
│   └── pull_request_template.md  # GENERATED — the DoD checklist
├── src/                          # bounded contexts (architecture spec owns the names)
│   ├── <context>/
│   │   ├── domain/               # no vendor SDK imports (fitness-function enforced)
│   │   ├── ports/                # interfaces
│   │   └── adapters/             # vendor impls behind ports (ACL)
│   ├── shared/command-bus/       # command + event log; actor envelope
│   └── config/                   # the ONLY home of vendor model ids + secrets refs
├── evals/
│   ├── golden/                   # versioned JSON cases (seeded ~30–50; train/test split)
│   ├── scorers/                  # dose-engine cross-check, allergy/interaction, never-events, severity
│   ├── promptfoo.config.yaml     # PR base-vs-branch GitHub Action
│   └── deepeval/                 # G-Eval rubrics (soft quality)
├── contracts/
│   ├── rx.schema.json            # Ajv — 4-row format + safety + NABH blocks
│   ├── tools/*.schema.json       # Claude tool I/O
│   └── fhir/                     # ABDM R4 profiles + provider-verification harness
├── fitness/
│   ├── .dependency-cruiser.cjs   # no-circular, boundaries, domain⇏vendor
│   ├── eslint.config.js          # flat config — esc()/innerHTML, raw-state, custom rules
│   └── ast/                      # AST/grep fitness tests (dose-engine-only, sign-off, model-id)
└── docs/
    ├── adr/NNNN-*.md             # ADRs (tooling/model-policy/architecture decisions)
    └── traceability/             # GENERATED matrix: spec↔task↔code↔test↔eval
```

---

## Appendix B — glossary delta

| Term | Meaning in this file |
|---|---|
| **Spec surface** | The machine-readable subset of `system-spec/*` (structured front-matter + small manifests) the generator reads. Edited by humans/agents; the skeleton is not. |
| **Scaffolding workflow** | The single-agent, idempotent generation workflow that emits the gated skeleton from the spec surface. |
| **Skeleton** | The generated repo: structure + gates + harness + DoD wiring. Spec-synced by construction. |
| **Feature workflow** | A parallel, worktree-isolated workflow building one vertical slice through the per-slice loop. |
| **Vertical slice** | The thinnest end-to-end change delivering behavior across the layers it touches. |
| **Gate parity** | The guarantee that every slice passes the *identical* generated checks — because the checks are generated, sync-locked, and required by branch protection. |
| **`generated-files-in-sync`** | The required CI check that re-runs the generator and fails on any delta in a generator-owned file. |
| **Shared surface** | A contract/config/golden-set/lockfile that multiple slices may touch; writes are serialized (§9). |
| **windows-parallel-agents** | The mandatory Windows protocol for dispatching parallel worktree agents without leakage/missed commits. |

---

> **Authority reminder.** This file conforms to the OPERATING-MODEL DIGEST and `09_engineering_discipline/README.md`. Where it disagrees with them, they win until amended via ADR. It is spec-independent methodology/governance — it constrains *how the build runs and how we prove each slice works*, never the product architecture.
