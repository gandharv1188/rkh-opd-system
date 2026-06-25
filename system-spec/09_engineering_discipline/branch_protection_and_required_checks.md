---
trace_id: ENG-DISC-09-BRANCH-PROTECTION
title: Branch Protection & Required Checks — The Unbypassable Gate as Config-as-Code
status: binding
scope: methodology/governance (spec-independent)
parent_digest: OPERATING-MODEL DIGEST (single source of truth)
parent_canonical: 00_overview/canonical_decisions.md (Part D.1, D.2)
last_verified_repo_state: 2026-06-25
owners: [engineering-discipline, gatekeeper-ci, release-captain]
supersedes: ".github/workflows/deploy-pages.yml (zero-gate push→Pages, no protection)"
related:
  - quality_gates_ci.md (the gate ledger G1–G20 whose CONTEXTS this file pins as required checks)
  - agent_operating_model.md (Appendix B required-checks list this file makes canonical and reconciles)
  - evals_framework.md (the eval gate registered here as ci/eval-gate; LLM-judge non-determinism owner)
  - change_management_versioning.md (ADR discipline; protection-config change is an ADR-mandatory change)
  - drift_control.md (structural/behavioral/spec drift; protection-config drift is a fourth drift surface this file closes)
  - testing_strategy.md (owns the ci/dose-parity runner; this file registers it as a required check)
  - observability_runtime_verification.md (admin-override + force-push attempts are alarmed events)
---

# Branch Protection & Required Checks

> **Purpose.** This file makes the system's single most load-bearing axiom — **"done = proven + gated, an actor cannot bypass the gate" (A1/A2)** — itself *real, versioned, and auditable*. Every other discipline file describes a gate; this file describes the **lock on the gate**: the GitHub branch-protection ruleset on `main`, expressed as **config-as-code** (Terraform / `gh api` artifact under review), the handling of admin-override and force-push, and — the part that is usually missing — **how the "cannot bypass" property is itself audited**, so it is not a single un-versioned checkbox in a repo-admin's account settings that can be quietly toggled off.
>
> **The failure this file prevents.** A team can author twenty perfect gates and still ship the model-retirement incident if one admin unticks "Include administrators" or "Require status checks to pass" in the GitHub UI at 2 a.m. — leaving no diff, no review, and no alarm. An *un-versioned account setting* is exactly the kind of silent, unmonitored dependency the founding incident was made of. The protection config is therefore treated like the dose engine: **a frozen-contract artifact, versioned, reviewed, drift-detected, and tested in CI.**
>
> **Authority.** This file conforms to the OPERATING-MODEL DIGEST and to `00_overview/canonical_decisions.md` (Part D.1 assigns this file ownership of *branch-protection-as-code*, the *model-EXISTENCE contract-test placement*, and *traceability-matrix CI required-check registration*; Part D.2 folds those gates to this owner). Where this file and the digest disagree, the **digest wins** until amended by an ADR. This file is **spec-independent**: it constrains *how the gate is locked and audited*, not the target product architecture.
>
> **Single-source reconciliation.** Two branch-protection YAML blocks already exist in the suite — `quality_gates_ci.md §3` (full) and `agent_operating_model.md` Appendix B (abbreviated, illustrative). **This file is now the canonical, machine-applied artifact for that configuration.** Those two blocks are downgraded to *expository excerpts that MUST match §2 here*; any divergence is a defect corrected to this file (and detected by the drift check in §5).

---

## 0. Axioms this file enforces (inherited, non-negotiable)

| # | Axiom | How branch protection enforces it |
|---|---|---|
| **A1** | **Done = proven + gated, never declared.** | Merge to `main` is *physically* impossible until the required-check set is green. There is no `--no-verify`, no admin override, no self-approval that reaches `main`. |
| **A2** | **Enforce in CI, not in convention.** | The protection config is **applied by Terraform/`gh api` from a reviewed file**, and **drift from that file fails a required check** (`ci/protection-drift`). The lock is enforced, not trusted. |
| **A3** | **Answer from data, not guesswork.** | The required-check set *includes* the eval gate and the dose-parity gate; a model/prompt/engine change cannot merge without the scored evidence. |
| **A4** | **Humans and AI are symmetric actors.** | `enforce_admins: true` + `require_last_push_approval: true` apply identically to a human admin and an agent actor — no actor class is exempt. The pusher (human or agent) is never the sole approver. |
| **A5** | **Deterministic dose-engine is the dosing source of truth.** | `ci/dose-parity` (the JS↔TS golden-parity gate, canonical_decisions Part C) is a **required status check registered here**; the TS port is "not trusted in generation" until this check is green on `main`. |

---

## 1. The threat: "cannot bypass" as an un-versioned account setting

Branch protection on GitHub is, by default, **mutable UI state owned by whoever holds repo-admin**. That makes the most important security property of the whole rebuild — *no path issues a prescription, swaps a model, or merges unsafe code without passing the gates* — as fragile as a single toggle. The concrete failure modes:

| # | Bypass vector | What it looks like | Why config-in-UI cannot defend |
|---|---|---|---|
| **B1** | **Admin un-ticks a setting.** | An admin disables "Require status checks", drops a context, or unticks "Include administrators". | No diff, no PR, no review, no audit entry visible to engineers. The gate is gone and nobody is told. |
| **B2** | **Admin merges past red checks.** | "Merge without waiting for requirements" because `enforce_admins=false`. | The gate ran and was *red*; the merge happened anyway. Nothing in the repo records that the gate was overridden. |
| **B3** | **Force-push rewrites history.** | `git push --force` to `main` erases the merge-commit lineage that proves a change passed gates. | If `allow_force_pushes=true`, the audit chain (signed commits, linear history) is destroyed; provenance is unrecoverable. |
| **B4** | **Required check renamed / silently removed.** | A gate job is renamed in the workflow but its context is still "required" → it can never run → PRs hang; OR a context is dropped from the required list and the gate becomes advisory. | The required-list and the actual job names drift apart; a gate that *looks* required is effectively bypassed. |
| **B5** | **Branch deleted / recreated unprotected.** | Delete `main`, recreate it without the ruleset; or push a new long-lived branch that deploys. | Protection is per-branch; deletion/recreation or a new deploy branch escapes it. |
| **B6** | **Self-approval / AI self-merge.** | The actor that pushed the code is also the sole approver. | A symmetric-actor system (A4) must forbid the author — human or agent — being its own reviewer. |
| **B7** | **Bot/token over-privilege.** | A CI token or app installation has `bypass` privileges on the ruleset. | Bypass actors are an *intended* hole in the lock; if unaudited they are the easiest path through it. |

> **The thesis of this file:** every one of B1–B7 must be closed by (a) expressing the protection as **code**, (b) **applying** that code from CI (not the UI), (c) **detecting drift** between the code and the live setting as a required check, and (d) **auditing** override/force-push/admin events as alarmed, logged signals. The "cannot bypass" axiom is then a *property the system continuously proves about itself*, not a promise.

---

## 2. Config-as-code — the canonical protection artifact

The protection configuration lives in version control as a **reviewed, applied artifact**. We pin **GitHub Repository Rulesets** (the successor to legacy branch-protection; rulesets are themselves exportable/importable as JSON and support `bypass_actors`, layered rules, and org-level enforcement) and manage them with **Terraform** (`github_repository_ruleset`) as the source of truth, with a `gh api`-based applier as the boring fallback. The artifact is reviewed like any change and is **ADR-mandatory to alter** (change_management_versioning §3.1: "changes a safety invariant").

### 2.1 File locations (the versioned artifacts)

| Artifact | Path | Role |
|---|---|---|
| **Terraform ruleset** | `infra/github/branch-protection.tf` | Source of truth for the `main` ruleset; `terraform plan` in CI shows any drift. |
| **Exported ruleset JSON** (snapshot) | `infra/github/rulesets/main.ruleset.json` | Human-diffable export of the live ruleset; the drift check diffs live-vs-this. |
| **`gh api` applier (fallback)** | `infra/github/apply-protection.sh` | Idempotent applier if Terraform is unavailable; same content, `PUT`-applied. |
| **Required-context registry** | `infra/github/required-contexts.yaml` | The single list of required check names, consumed by both the ruleset and the name-sync check (§4). |
| **Bypass-actor allowlist** | `infra/github/bypass-actors.yaml` | Explicit, reviewed, *empty-by-default* list of any actor permitted to bypass (see §3.4). |

### 2.2 The canonical ruleset (Terraform)

```hcl
# infra/github/branch-protection.tf — SOURCE OF TRUTH for main protection.
# Changing this file requires an ADR (change_management_versioning §3.1) and review.
# Drift between this file and the live ruleset fails ci/protection-drift (§5).

resource "github_repository_ruleset" "main" {
  name        = "protect-main"
  repository  = "radhakishan-prescription-system"
  target      = "branch"
  enforcement = "active"                       # not "evaluate"/"disabled" — drift check asserts "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]            # binds to the default branch even if renamed (closes B5 partially)
      exclude = []
    }
  }

  # ── B6: no self-merge; independent review required ────────────────────────
  rules {
    pull_request {
      required_approving_review_count   = 1
      require_code_owner_review         = true   # CODEOWNERS routes risk-tier reviewers (quality_gates_ci §10)
      dismiss_stale_reviews_on_push     = true
      require_last_push_approval        = true   # the pusher (human OR agent) cannot be the sole approver — A4
      required_review_thread_resolution = true
    }

    # ── A1/A2/A3/A5: ALL required checks must be green; list is generated from
    #    infra/github/required-contexts.yaml (§4) — single source, name-synced.
    required_status_checks {
      strict_required_status_checks_policy = true   # branch must be up to date with main before merge
      required_check { context = "ci/format" }
      required_check { context = "ci/lint" }
      required_check { context = "ci/type-check" }
      required_check { context = "ci/unit" }
      required_check { context = "ci/contract" }
      required_check { context = "ci/integration" }
      required_check { context = "ci/e2e-critical" }
      required_check { context = "ci/fitness-functions" }
      required_check { context = "ci/eval-gate" }          # conditionally-required; FAILS CLOSED if scope undetermined (§6)
      required_check { context = "ci/dose-parity" }        # JS↔TS golden parity — canonical_decisions Part C (A5)
      required_check { context = "ci/coverage" }
      required_check { context = "ci/sast-codeql" }
      required_check { context = "ci/sast-semgrep" }
      required_check { context = "ci/secret-scan" }
      required_check { context = "ci/supply-chain" }
      required_check { context = "ci/perf-budget" }
      required_check { context = "ci/traceability" }       # safety-clause matrix; registered here (canonical_decisions D.2)
      required_check { context = "ci/model-existence" }    # config-resolved model id resolves to a LIVE model (§7)
      required_check { context = "ci/eval-phi-scan" }      # no PHI token in any fixture/model-bound payload (eval_data_governance owner)
      required_check { context = "ci/adr-check" }          # conditionally-required on high-tier/architectural change
      required_check { context = "ci/independent-review" } # no self-review attestation (G17)
      required_check { context = "ci/protection-drift" }   # THIS file's self-audit: live ruleset == versioned artifact (§5)
    }

    required_signatures   = true    # signed commits — actor identity is cryptographically auditable
    required_linear_history = true   # no merge-commit tangles; provenance is a clean chain
    non_fast_forward      = true    # ── B3: forbids force-push (history rewrite) on main
    deletion              = true    # ── B5: forbids deletion of the protected branch
    creation              = false   # creating main is allowed once; recreation still inherits ~DEFAULT_BRANCH rule
    update                = false
  }

  # ── B1/B2: admins are NOT exempt; bypass list is empty by default (§3.4) ──
  # No `bypass_actors {}` block ⇒ zero bypass actors ⇒ enforce_admins-equivalent.
  # Any bypass actor MUST be added here AND mirrored in bypass-actors.yaml AND ADR'd.
}
```

> **Legacy-API equivalence (for readers of the older blocks).** The `quality_gates_ci.md §3` and `agent_operating_model.md` Appendix B YAML use the legacy branch-protection API field names. They map 1:1 to the ruleset above: `enforce_admins: true` ⇔ *no bypass actors*; `allow_force_pushes: false` ⇔ `non_fast_forward: true`; `allow_deletions: false` ⇔ `deletion: true`; `required_signatures: true` ⇔ `required_signatures = true`; `require_last_push_approval: true` ⇔ `require_last_push_approval = true`. **Both excerpts must be kept consistent with this file**; the drift check (§5) is what makes "must be kept consistent" a machine fact rather than a hope.

### 2.3 Applier and idempotency

```bash
# infra/github/apply-protection.sh — boring fallback applier (idempotent).
# Run by a privileged, audited workflow (NOT by a developer's local token).
set -euo pipefail
gh api -X PUT "repos/$ORG/$REPO/rulesets/$RULESET_ID" \
  --input infra/github/rulesets/main.ruleset.json
# Re-running with identical input is a no-op; a non-empty diff means someone
# changed the live ruleset out-of-band → ci/protection-drift will already be red.
```

The applier runs only from a dedicated **`protection-apply.yml`** workflow, triggered on merge to `main` of any change under `infra/github/**`, using a least-privilege GitHub App installation (not a personal admin token). Applying protection is itself a **gated change** — the `infra/github/**` path is High-risk (CODEOWNERS routes it to the release-captain + an independent reviewer) and ADR-mandatory.

---

## 3. Admin-override, force-push & deletion handling

The lock is only as strong as its exemptions. This section pins the exemption policy and what happens when someone tries to use one.

### 3.1 Admin override — denied, then alarmed

- **Denied by default.** With **zero bypass actors** in the ruleset (§2.2), an org/repo admin attempting to merge a PR with a red required check is *blocked by GitHub itself* — the "Merge without waiting for requirements" affordance is absent. This is the ruleset equivalent of legacy `enforce_admins: true`.
- **If an override is ever genuinely required** (a true incident-mode break-glass), it is done by a **time-boxed, reviewed ruleset change** (a PR to `branch-protection.tf` that adds a named bypass actor with an expiry), never by a UI click. The break-glass PR is itself High-risk + ADR + independent review.
- **Every override-shaped event is alarmed.** Per `observability_runtime_verification.md`, the audit pipeline subscribes to the GitHub audit-log stream and **alarms on**: `protected_branch.policy_override`, `repository_ruleset.update`, `repository_ruleset.destroy`, and any merge whose commit's checks were not all green. An override is therefore never silent — it pages on-call (canonical_decisions safety rule: admin-override is a logged, alarmed event).

### 3.2 Force-push — forbidden and history-protected

- `non_fast_forward = true` (⇔ legacy `allow_force_pushes: false`) **forbids force-push to `main`**. Combined with `required_linear_history` and `required_signatures`, the history of `main` is an **append-only, signed, linear chain** — provenance for every change (which gates passed, which actor, which review) is reconstructable and tamper-evident (closes B3).
- Force-push **is** allowed on short-lived feature branches (trunk-based model; rebasing a slice is normal). Protection is scoped to `main` only; the cost of a rewritten feature branch is zero because the gate runs at the `main` boundary regardless.

### 3.3 Deletion / recreation — forbidden and rebindable

- `deletion = true` (⇔ legacy `allow_deletions: false`) **forbids deleting `main`** (closes B5 directly).
- The ruleset condition binds to `~DEFAULT_BRANCH`, so a rename of the default branch carries the protection with it (it does not need a hardcoded `main` literal that a rename would orphan).
- **New deploy branches cannot escape the gate**, because deployment is environment-protected (`release.yml`, quality_gates_ci §11) and the *deploy* job re-runs the gate ledger on the release ref — there is no "push a branch, it ships" path that bypasses MERGE-boundary checks. (Org-level rulesets may additionally protect `release/*` and `deploy/*` glob patterns; recorded as a follow-up in §10.)

### 3.4 Bypass actors — empty by default, explicit and audited if non-empty

```yaml
# infra/github/bypass-actors.yaml — MUST be empty in steady state.
# Any entry is a HOLE in the unbypassable gate and is treated as one.
bypass_actors: []   # ← steady state. Non-empty requires: ADR + independent review + an expiry + an alarm subscription.
# If ever populated, each entry carries:
#   - actor_id / actor_type (Integration | OrganizationAdmin | RepositoryRole | Team)
#   - bypass_mode: "pull_request"   # never "always"
#   - reason + ADR link + sunset date (CI fails if past sunset; change_management_versioning §1.3)
```

- **Steady state is zero bypass actors.** A non-empty list is a *finding*, not a configuration — `ci/protection-drift` reports the count, and a non-zero count past its `sunset` date hard-fails.
- CI tokens / GitHub Apps used by automation **must not** appear here. Automation merges by *passing the gates*, never by bypassing them (symmetric actor — A4).

---

## 4. Required-check registration & name-sync (closing B4)

A required check is only real if the **name in the ruleset** exactly matches the **name GitHub reports for the job**. Renames silently break this. We close the gap with a single registry and a sync check.

### 4.1 The single registry

```yaml
# infra/github/required-contexts.yaml — the ONE list. Consumed by:
#   (a) the Terraform ruleset (generated required_check blocks), and
#   (b) ci/check-name-sync (asserts every context here is actually emitted by a workflow job).
required_contexts:
  # G-ledger MERGE gates (quality_gates_ci §2)
  - { context: ci/format,            owner: quality_gates_ci, gate: G1 }
  - { context: ci/lint,              owner: quality_gates_ci, gate: G2 }
  - { context: ci/type-check,        owner: quality_gates_ci, gate: G3 }
  - { context: ci/unit,              owner: quality_gates_ci, gate: G4 }
  - { context: ci/contract,          owner: quality_gates_ci, gate: G5 }
  - { context: ci/integration,       owner: quality_gates_ci, gate: G6 }
  - { context: ci/e2e-critical,      owner: quality_gates_ci, gate: G7 }
  - { context: ci/fitness-functions, owner: drift_control,    gate: G8 }
  - { context: ci/eval-gate,         owner: evals_framework,  gate: G9, conditional: true, fail_closed: true }
  - { context: ci/dose-parity,       owner: testing_strategy, gate: "C(parity)" }   # canonical_decisions Part C
  - { context: ci/coverage,          owner: quality_gates_ci, gate: G10 }
  - { context: ci/sast-codeql,       owner: security_review,  gate: G11 }
  - { context: ci/sast-semgrep,      owner: security_review,  gate: G11 }
  - { context: ci/secret-scan,       owner: security_review,  gate: G12 }
  - { context: ci/supply-chain,      owner: quality_gates_ci, gate: G13 }
  - { context: ci/perf-budget,       owner: quality_gates_ci, gate: G14 }
  - { context: ci/traceability,      owner: this_file,        gate: G15 }            # registration owned here (D.2)
  - { context: ci/model-existence,   owner: this_file,        gate: "EXISTENCE" }    # placement owned here (D.2)
  - { context: ci/eval-phi-scan,     owner: eval_data_governance, gate: "PHI-SCAN" }
  - { context: ci/adr-check,         owner: change_management_versioning, gate: G16, conditional: true, fail_closed: true }
  - { context: ci/independent-review,owner: agent_operating_model, gate: G17 }
  - { context: ci/protection-drift,  owner: this_file,        gate: "SELF-AUDIT" }   # §5 — audits this whole file
```

### 4.2 The name-sync check

```bash
# ci/check-name-sync — for every context in required-contexts.yaml, assert a
# workflow job actually emits that exact status name. A rename on either side fails.
# This closes B4: a "required" check that no job produces would otherwise hang every PR
# (or be quietly dropped) — here it is a build failure that names the mismatch.
node infra/github/check-name-sync.mjs --registry infra/github/required-contexts.yaml --workflows .github/workflows/
```

`conditional: true` contexts (`ci/eval-gate`, `ci/adr-check`) **must still always report a status** — they post `success` with an explicit "not-required for this PR" reason when out of scope, and `pending→fail` when scope is undetermined (**fail-closed**, quality_gates_ci §3). A conditional check never *omits* its status, because an omitted required status blocks the merge forever (the safe failure direction) — but we make the not-applicable case an explicit green-with-reason so PRs are not wedged.

---

## 5. The self-audit — how "cannot bypass" audits itself (`ci/protection-drift`)

This is the crux of the file: the unbypassability property is **continuously proven**, not assumed. Three independent mechanisms, layered defense-in-depth.

### 5.1 Drift detection (live ruleset vs versioned artifact)

```bash
# ci/protection-drift — REQUIRED CHECK on every PR and on a schedule (cron, 6-hourly).
# Pulls the LIVE ruleset from GitHub and diffs it against the versioned artifact.
# ANY difference → FAIL. This is what makes B1 (silent UI toggle) impossible to hide.
set -euo pipefail
gh api "repos/$ORG/$REPO/rulesets/$RULESET_ID" > /tmp/live.json
# Normalize (sort keys, strip server-only fields) then assert byte-equality of the
# enforcement-relevant subset against the committed snapshot.
node infra/github/assert-no-drift.mjs \
  --live /tmp/live.json \
  --expected infra/github/rulesets/main.ruleset.json \
  --must "enforcement=active" \
  --must "non_fast_forward=true" \
  --must "deletion=true" \
  --must "required_signatures=true" \
  --must "require_last_push_approval=true" \
  --must "bypass_actors==[]" \
  --must-contain-all-contexts infra/github/required-contexts.yaml
# Exit non-zero on ANY drift; the failure message names the field that changed and by whom (audit-log correlation).
```

- **PR-time + scheduled.** Running it as a required check on PRs catches drift before merge; running it on a **6-hourly cron** catches an out-of-band UI change *between* PRs and pages on-call. A toggle flipped at 2 a.m. (B1) is caught within hours and is loud, not silent.
- **Self-referential safety.** `ci/protection-drift` is itself in the required-context list (§4.1) — the audit of the lock is part of the lock. Removing it from the required list is a drift *of the required list*, which the same check detects (the registry is part of the expected snapshot).

### 5.2 Audit-log alarms (override / force-push / ruleset-change events)

`observability_runtime_verification.md` owns the alarm wiring; this file owns the **event taxonomy** that must be alarmed:

| GitHub audit-log event | Maps to vector | Action |
|---|---|---|
| `repository_ruleset.update` / `.destroy` | B1, B5 | Page on-call; correlate to a merged `infra/github/**` PR — if none, it was an out-of-band change → incident. |
| `protected_branch.policy_override` | B2 | Page; record actor + PR; require a post-hoc ADR justifying the break-glass or treat as a violation. |
| `git.push` with `force=true` to default branch | B3 | Should be impossible (ruleset denies it); if observed, the ruleset was weakened → P1 incident. |
| `protected_branch.destroy` / branch deletion of default | B5 | P1 incident. |
| `repository_ruleset.update` adding a `bypass_actor` | B7 | Must correlate to an ADR'd, expiry-bound PR; otherwise revoke + incident. |

> **The audit is the second key.** Config-as-code (§2) makes the *intended* state a diffable artifact; the audit-log alarms make any *deviation* (whether by toggle, override, or force) a paging event with an actor attached. Together they convert "we trust nobody disabled it" into "the system tells us within hours, with the actor's name, if anyone did."

### 5.3 An adversarial gate-bypass test (proves the lock holds end-to-end)

A scheduled **negative test** proves the gate cannot be bypassed, rather than just asserting config values:

```text
ci/gate-bypass-probe (scheduled, runs against a sacrificial test branch/repo fixture):
  1. Open a PR that deliberately FAILS a required check (e.g. a planted lint error).
  2. Attempt to merge it via the API as (a) a normal actor and (b) an admin token.
  3. ASSERT both merges are REJECTED by GitHub.
  4. Attempt a force-push to the protected ref → ASSERT rejected.
  5. Attempt to self-approve (pusher approves own PR) → ASSERT merge still blocked (require_last_push_approval).
  Any merge/force/self-approve that SUCCEEDS = the lock is broken → P1, page on-call.
```

This is the protection-config analog of a fire drill: it exercises the *actual* enforcement path on a real (sacrificial) ref, so a misconfiguration that the static drift diff might miss (e.g. a GitHub behavior change) is caught by behavior, not by reading config.

---

## 6. Conditionally-required checks & the fail-closed contract

Two required checks are *conditional* by design — `ci/eval-gate` (G9, runs only when a PR is LLM-affecting) and `ci/adr-check` (G16, required only on architectural/model-policy changes). Conditionality is where bypass usually sneaks in ("it didn't apply to me"), so the rule is strict:

- **The scope decision is itself a job step that runs first and fails closed.** If the scope detector cannot *prove* the PR is out-of-scope (changed-paths + labels are ambiguous), the gate is treated as **required and run** (quality_gates_ci §3, §6.1). Ambiguity blocks; it never waves through.
- **The status is always reported.** A conditional check posts `success` (with a machine-readable "not-required: <reason>") when provably out of scope, so the merge is not wedged, but the *required* registration never lets the check be silently absent.
- **Fail-closed is the default everywhere.** Any required check that errors, times out, or cannot determine applicability resolves to **fail**, not skip. The safe direction for an unbypassable gate is to block.

---

## 7. The model-EXISTENCE contract test (`ci/model-existence`) — placement owned here

Canonical_decisions Part D.2 places the **model-existence contract test** in this file. This is the direct structural antidote to the founding incident (a dated model id was retired by the vendor and broke prod):

```text
ci/model-existence (REQUIRED CHECK):
  GIVEN the model id resolved ONLY from config/model-registry (fitness rule F5),
  WHEN the test runs at PR time AND on a daily schedule,
  THEN it asserts the configured `primary` AND `fallback` model ids each RESOLVE to a
       live, non-deprecated model via the vendor capability/lifecycle endpoint.
  A primary that does not resolve, or resolves as `deprecated`/`sunset`, FAILS the check.
```

- **Why a required check, not just a runtime probe.** A runtime probe catches the break *after* it ships; a required check at the MERGE boundary stops a PR that pins a non-existent model from ever merging, and the **daily scheduled run** turns a vendor retirement announcement into a *red check + tracking issue* with lead time (change_management_versioning §1.3 deprecation monitor feeds the issue).
- **Reconciles with the dose-parity and eval gates.** `ci/model-existence` proves the model *exists*; `ci/eval-gate` proves it *behaves*; `ci/dose-parity` proves the *engine* the model defers to is byte-identical to the oracle. The three are distinct required contexts; none substitutes for another.

---

## 8. The dose-parity & traceability required checks — registration owned here

Per canonical_decisions Part C (dose-parity) and Part D.2 (traceability registration), this file is the place those two checks are *registered as required* (their runners/content are owned elsewhere):

| Required context | Runner/content owner | Why it is registered here as unbypassable |
|---|---|---|
| **`ci/dose-parity`** | `testing_strategy.md` owns the runner; `evals_framework.md` references it as the M2 oracle's integrity guarantee. | The TS `DoseEnginePort` is the runtime dosing authority (canonical_decisions C5) but is *not trusted in generation until this check is green*. It must run on **every PR touching `core/` dose code, `web/dose-engine.js`, or `evals/golden/dose_parity/**`** — fail-closed if scope is undetermined. Byte-for-byte, zero tolerance, ≥20 fixtures covering the C.2 floor. Making it a *required* check is what converts "the port is parity-verified" from a claim into a merge precondition. |
| **`ci/traceability`** | The matrix builder (G15, drift_control §7c) is the content owner. | A safety-critical spec clause with no verifying test/eval → the matrix builder emits red. Registering it as a **required** check here is what makes "every safety clause is verified" unbypassable: a PR that adds a safety clause without a verifier cannot merge. |

> **Separation of concerns.** *Owning the runner* (writing the parity assertions, the matrix builder) and *owning the requirement* (making the check block merge) are deliberately different responsibilities. This file owns the **requirement registration**; the runner files own the **logic**. The name-sync registry (§4.1) is the seam that keeps the two in agreement.

---

## 9. What this file does NOT own (boundaries)

To avoid duplicating policy across spokes (composability rule, README §3):

- **The gate ledger and pass/fail oracles (G1–G20)** are owned by `quality_gates_ci.md §2`. This file only pins *which contexts are required and unbypassable*.
- **The eval gate's internal scoring** (never-events, severity scorecard, LLM-judge discipline, judge non-determinism bounds) is owned by `evals_framework.md`. This file only registers `ci/eval-gate` as required and fail-closed.
- **The PHI-scanner content** (gitleaks/PHI-pattern over `evals/**`) is owned by `eval_data_governance.md`. This file registers `ci/eval-phi-scan` as required.
- **ADR mechanics** (when an ADR is mandatory, MADR format) are owned by `change_management_versioning.md §3`. This file only states that *changing the protection config is itself ADR-mandatory*.
- **Alarm wiring / SLOs** are owned by `observability_runtime_verification.md`. This file defines the *event taxonomy* (§5.2) that must be alarmed; that file implements the subscription.

---

## 10. Migration from the current zero-protection state

| Now (verified 2026-06-25) | Target |
|---|---|
| `main` has **no branch protection**; `.github/workflows/deploy-pages.yml` ships `web/` on any push, zero gates, no required checks, no signed commits. | `main` carries the §2 ruleset, applied from `infra/github/branch-protection.tf`; every G-ledger MERGE context + the new checks are *required*; `ci/protection-drift` audits the lock 6-hourly. |
| Protection (if added in the UI) would be **un-versioned account state** an admin could toggle silently. | Protection is **config-as-code**, applied by a privileged workflow, and **drift fails a required check** — B1 is closed. |
| No force-push / deletion / self-merge guards. | `non_fast_forward`, `deletion`, `require_last_push_approval`, `required_signatures`, `required_linear_history` — B3/B5/B6 closed; B2/B7 closed by zero bypass actors + audit alarms. |
| Model id hardcoded in the Edge Function; retired silently and broke prod. | `ci/model-existence` (required, daily-scheduled) makes a non-resolving/deprecated model id a **red check**, not a production outage. |

**Rollout order (incremental, low-risk first).**
1. Land `infra/github/required-contexts.yaml` + the **abbreviated ruleset** (admins-not-exempt, no force-push, no deletion, signed commits) with only the Tier-1 fast contexts required — immediate protection, near-zero risk.
2. Add `ci/protection-drift` (the self-audit) and the audit-log alarm subscriptions — the lock now watches itself.
3. Expand the required-context list as each gate (contract → unit → fitness → eval → dose-parity) comes online; each becomes required the moment its job is green-stable.
4. Add `ci/model-existence`, the scheduled `ci/gate-bypass-probe`, and org-level `release/*`/`deploy/*` rulesets (the §3.3 follow-up).

> **Never big-bang.** A protected branch with required checks that don't yet exist would wedge every PR; that is why contexts are added to the *required* list only after the job reliably reports. The name-sync check (§4.2) guards against adding a required context with no producing job.

---

## 11. Definition-of-Done for a change to the protection config itself

A PR that touches `infra/github/**` is High-risk and is done only when:

- [ ] The change is expressed in `branch-protection.tf` (and the exported `main.ruleset.json` snapshot is regenerated). *(config-as-code, §2)*
- [ ] An **ADR** records *why* the protection changed (change_management_versioning §3.1). *(no silent loosening)*
- [ ] `ci/protection-drift` is green **after** apply (live ruleset == artifact). *(self-audit, §5.1)*
- [ ] `ci/check-name-sync` is green (every required context maps to a producing job). *(B4 closed, §4.2)*
- [ ] `bypass-actors.yaml` is still `[]` — or any addition carries an actor id, `bypass_mode: pull_request`, a reason, an ADR link, and a `sunset` date. *(§3.4)*
- [ ] An **independent reviewer** (never the author; release-captain via CODEOWNERS) approved. *(A4, B6)*
- [ ] The audit-log alarm subscriptions still cover the §5.2 event taxonomy. *(observability seam)*
- [ ] If the change *removed* or *renamed* a required context, the corresponding gate's owner file is updated in the same PR (no orphaned/dangling required check). *(composability)*

---

## 12. Honest caveats (carried into operation)

- **GitHub is the trust root.** Config-as-code + drift detection + audit-log alarms make tampering *loud and attributable*, but a sufficiently privileged actor at the GitHub-org level (or GitHub itself) is outside this file's control. We mitigate by least-privilege org admin, signed commits (tamper-evidence), and the scheduled bypass-probe (behavioral proof) — we do not claim cryptographic impossibility.
- **Drift detection has a window.** The 6-hourly cron means an out-of-band toggle is caught within hours, not instantly. We accept this for a POC-scale repo; tightening to webhook-driven (on `repository_ruleset` audit events) is the obvious upgrade and is recorded as a follow-up.
- **Required ≠ correct.** A green required check proves *the gate ran and passed*, not that the gate's logic is sufficient. The gate logic (evals, fitness functions, dose-parity floor) is owned and caveated in its own file; this file only guarantees those gates *cannot be skipped*.
- **This is engineering rigor, not regulatory clearance.** CDSCO is the binding regulator; severe-error eval gating + mandatory physician sign-off (F4) remain the clinical-safety backstop. Branch protection guarantees the *process* cannot be bypassed — it does not, by itself, prove the *product* is safe.

---

### Relevant repo paths (absolute)

- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\.github\workflows\deploy-pages.yml` — current zero-gate, zero-protection deploy (the thing this file locks down).
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\system-spec\09_engineering_discipline\quality_gates_ci.md` — gate ledger G1–G20 + the original branch-protection YAML (§3) this file makes canonical.
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\system-spec\09_engineering_discipline\agent_operating_model.md` — Appendix B required-checks list reconciled here.
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\system-spec\00_overview\canonical_decisions.md` — Part C (dose-parity), Part D.1/D.2 (this file's ownership + folded gates).
- `infra/github/branch-protection.tf` · `infra/github/required-contexts.yaml` · `infra/github/bypass-actors.yaml` · `infra/github/rulesets/main.ruleset.json` — the versioned protection artifacts this file defines (to be created by the scaffolding workflow).

---

*End of `09_engineering_discipline/branch_protection_and_required_checks.md`. Subordinate to the OPERATING-MODEL DIGEST and `00_overview/canonical_decisions.md`; the protection config is a frozen-contract artifact — amend only via ADR, and the amendment is itself drift-checked.*
