---
trace_id: ENG-DISC-09-EVAL-DATA-GOVERNANCE
title: Eval-Data Governance — Golden-Set Lifecycle, Proven De-identification, Clinician-as-Oracle, Anti-Staleness & Judge Calibration
status: binding
scope: methodology/governance (spec-independent)
parent_digest: OPERATING-MODEL DIGEST (single source of truth)
authority: conforms to OPERATING-MODEL DIGEST and to 00_overview/canonical_decisions.md; where this file disagrees with either, the higher authority wins until amended via ADR
last_verified_repo_state: 2026-06-25
owners: [engineering-discipline, gatekeeper-ci, clinical-lead, data-protection-officer]
related:
  - evals_framework.md          # the harness, scorers, never-events, judge discipline this file feeds
  - quality_gates_ci.md         # G9 eval gate + G12 secret/PHI scan ledger this file slots into
  - change_management_versioning.md  # ADR + versioning machinery dataset bumps ride on
  - clinical_risk_management.md # hazard→severity_floor mapping that case authoring consumes
  - ../06_security/security_auth_rbac_compliance.md  # SEC-3 de-id boundary, DPDP, audit
  - ../00_overview/canonical_decisions.md            # C2 sex, C3 status, C5 dose-engine, D.2 gate ownership
folds_in:
  - de-identification PHI-scanner gate (ci/eval-phi-scan) — canonical owner (canonical_decisions §D.2)
  - the "prod miss → golden case" de-id proof and PHI-clearance gate (canonical_decisions §D.1)
---

# Eval-Data Governance

> **What this file owns.** The **lifecycle of the golden eval dataset** — the versioned clinical
> corpus that `evals_framework.md` scores every model/prompt/reference/Rx-schema change against.
> It governs how a case is **created**, how it is **PROVEN de-identified** (not merely asserted),
> how a **named accountable clinician signs it off as the oracle of truth**, how the set is
> **versioned**, how **production misses are intaken** (with PHI clearance *before* a row enters
> the repo), and the controls that keep the set from going **stale** or being **overfit**. It also
> owns **judge-model calibration / meta-eval** — proving the LLM-judge agrees with humans before
> it is allowed to score anything.
>
> **What it does NOT own.** The harness, scorers, never-events suite, scorecard, and the judge's
> *runtime* discipline (n≥3 averaging, pinning) live in `evals_framework.md`. This file is the
> **data-governance contract** that file consumes: it decides *what is allowed into the dataset and
> on whose authority*; `evals_framework.md` decides *how the dataset is run and scored*. The de-id
> *engineering boundary to the live model* is `06_security` SEC-3; this file governs the de-id of
> *eval fixtures at rest in the repo*.
>
> **Authority.** Conforms to the OPERATING-MODEL DIGEST and to `00_overview/canonical_decisions.md`.
> Per `canonical_decisions §D.1/§D.2`, this file is the **single owner** of the
> **de-identification PHI-scanner gate (`ci/eval-phi-scan`)** and of the **prod-miss → golden-case
> de-id proof**. No other discipline file may claim those gates.
>
> **Founding incident (the reason the dataset must be trustworthy).** On 2026-06-25 a dated Claude
> model id retired and the emergency fix tuned the model **by guesswork** because there was no eval
> harness. The harness is only as honest as its golden set: a stale, overfit, clinician-unvalidated,
> or PHI-contaminated dataset would let a regression pass a green gate — re-creating the incident
> while *looking* safe. This file makes the dataset itself a **proven, accountable artifact**.

---

## 0. Axioms this file enforces (inherited, non-negotiable)

| # | Axiom | How eval-data governance enforces it |
|---|---|---|
| A1 | **Done = proven + gated, never declared.** | A case is "golden" only after the de-id proof, the clinician oracle sign-off, and CI ingest gates pass — never by an author asserting it. |
| A2 | **Enforce in CI, not in convention.** | De-identification is **proven by a blocking scanner** (`ci/eval-phi-scan`), not by a reviewer's eyeball. Sign-off is a recorded, schema-validated artifact, not a verbal nod. |
| A3 | **Answer from data, not guesswork.** | The data we answer from is itself governed: versioned, split-disciplined, anti-overfit, clinician-validated. A judge is allowed to score only after it is **proven** to agree with humans. |
| A4 | **Humans and AI are symmetric actors.** | A case authored or de-identified by an agent passes the **identical** gates as one authored by a human; the accountable clinician oracle is **always a named human** (the one asymmetry the law requires — see §3). |
| A5 | **Deterministic dose-engine is the dosing source of truth; AI never does arithmetic.** | Expected **dosing facts** in a case are *never* hand-typed numbers the clinician guessed; they are checked against the engine (C5). The clinician oracle certifies the **clinical envelope** (right drug/line/flag), not the milligram — the engine certifies the milligram. |

---

## 1. The golden case — the unit this file governs

A **golden case** is a frozen, de-identified clinical scenario with a machine-checkable expectation
envelope, authored to the schema pinned in `evals_framework.md §4.1`. This file does not redefine
that schema; it adds the **governance metadata block** every case MUST carry and which CI validates
on ingest.

```jsonc
// evals/golden/cases/0042_preterm_renal_amox.case.json  (governance block highlighted)
{
  "id": "0042_preterm_renal_amox",
  "trace_id": "SPEC-RX-DOSING-007",        // links to the spec clause (traceability spine)
  "version": "1.3.0",                      // semver; bumped on any edit (append-not-mutate, §4)
  "split": "test",                          // train | test — strict separation (§5)
  "risk_edge": ["preterm", "renal_gfr_adjusted"],
  "severity_floor": "severe",               // from hazard analysis (clinical_risk_management.md)

  // ── GOVERNANCE BLOCK (this file owns; CI ingest gate validates) ──────────────
  "governance": {
    "source": "prod-miss",                  // synthetic | scrubbed-real | prod-miss
    "provenance_ref": "INC-2026-07-031",    // redacted incident id (NO PHI), or curation batch id
    "deid": {
      "method": "synthetic+safe-harbor",    // see §2.2
      "scanner_version": "phi-scan@2.4.0",  // the exact gate that cleared it
      "cleared_at": "2026-07-12T09:14:00Z",
      "cleared_by": "ci/eval-phi-scan",     // machine clearance is mandatory (A2)
      "phi_clearance_ticket": "PHI-CLR-118" // human DPO clearance for prod-miss intake (§6)
    },
    "oracle": {                              // clinician-as-oracle sign-off (§3)
      "clinician_name": "Dr. <named>",       // a NAMED accountable human (not a role, not an agent)
      "clinician_reg_no": "HRY/MCI/<redacted-but-on-file>",
      "signed_at": "2026-07-12T10:02:00Z",
      "attestation_hash": "sha256:…",        // hash of the exact expected-envelope they signed
      "scope": "clinical-envelope",          // they certify drug/line/flag/required-elements
      "dosing_authority": "dose-engine"      // NOT the clinician — the engine owns the number (A5)
    },
    "review": {                              // six-eye for clinical content (§3.4)
      "author": "case-curation-2026-07",
      "independent_reviewer": "<agent|human, ≠ author>",
      "clinical_approver": "Dr. <named, = oracle>"
    }
  }
}
```

> **Invariant.** A `*.case.json` that lacks a complete, schema-valid `governance` block — or whose
> `deid.cleared_by` / `oracle.attestation_hash` / `review.independent_reviewer` are absent — is
> **rejected at ingest** (`ci/eval-data-governance`). There is no "draft golden case" state in
> the gating split: a case is either fully governed or it is not in `test`.

---

## 2. PROVEN de-identification (not asserted)

The dataset contains **no PHI, ever**. "Proven" means a **blocking machine scanner** clears every
fixture and every model-bound payload — the human review is a *second* layer, never the only one.

### 2.1 The two-layer de-id proof

```
 LAYER 1 — MACHINE (blocking, the proof)            LAYER 2 — HUMAN (defense-in-depth)
 ────────────────────────────────────────           ──────────────────────────────────
 ci/eval-phi-scan  (gitleaks + PHI-pattern +         A reviewer (six-eye, §3.4) confirms the
 entity scan over evals/**, before merge)            scenario reads as a plausible de-identified
 ANY PHI token → HARD FAIL, merge blocked            case and carries no residual identifier the
 (folds canonical_decisions §D.2)                    scanner's patterns could miss (e.g. a rare
                                                      village name in free text).
        │                                                       │
        └──────────────────── BOTH required ────────────────────┘
                 machine clearance is necessary AND human clearance is necessary;
                 neither alone makes a case de-identified.
```

### 2.2 What "de-identified" means here (the standard)

We apply a **Safe-Harbor-style identifier strip adapted to the Indian / DPDP context**, plus a
**preference for synthesis over scrubbing**:

| Rule | Detail |
|---|---|
| **Synthesize by default** | The lowest-risk case is one **never derived from a real patient** — a clinically faithful scenario authored from protocols. Synthetic cases need no scrubbing because there was no identity to remove. Prefer them; reserve scrubbed-real cases for failure modes synthesis cannot reproduce. |
| **Strip the 18-class identifier set (+ India)** | No name, UHID, **ABHA number/address**, DOB (only derived `ageInDays`), guardian name/phone, address/village, Aadhaar/PAN, MRN, document ids, email, IP, device id, full-face photo, free-text that re-identifies. The case carries **clinical facts only** — exactly the `DeidentifiedPatientContext` shape (`06_security §3.2`). |
| **Dates → ages** | Convert every date to a derived interval (`ageInDays`, `corrected_age_days`, `test_date` → relative day offset). No absolute clinical dates in fixtures. |
| **Sex token** | Per `canonical_decisions §C2`, the de-identified context uses **`sex: 'M' \| 'F'`** (no `'O'` reaches a fixture's model-bound context; unknown/other → omit the sex-specific branch — none exists in pediatric dosing). |
| **Free-text minimization** | The `clinical_note` is rewritten to the minimum needed to exercise the failure mode; rare quasi-identifiers (uncommon syndromes + locality + exact age) are blunted to defeat **re-identification by mosaic** (DPDP linkage risk). |
| **No PHI in provenance** | `provenance_ref` is a **redacted incident id** (`INC-…`), never a name/UHID/free-text link. The incident's PHI lives in the access-controlled incident store, not in the repo. |

### 2.3 The scanner gate — `ci/eval-phi-scan` (this file's owned gate)

```yaml
# .github/workflows/eval-phi-scan.yml  (required check on main; fails CLOSED)
name: Eval PHI Scan
on:
  pull_request:
    paths: ['evals/**']           # any change under evals/ is scanned in full (not just the diff)
jobs:
  phi-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: gitleaks (secrets + key literals)
        run: gitleaks detect --source evals --redact --exit-code 1
      - name: PHI pattern + entity scan
        # regex for UHID (^RKH-\d{11}$ per C1), ABHA (14-digit / @sbx), Aadhaar (12-digit),
        # phone (+91…), email, DOB-shaped dates, MRN; + NER pass for PERSON/GPE in free text
        run: deno task eval:phi-scan --strict --fail-on-any
      - name: Assert governance block present & valid
        run: deno task eval:governance-check   # schema-validates the §1 governance block
```

| Property | Rule |
|---|---|
| **Scope** | The **whole** `evals/` tree on any PR that touches it (not just the diff) — a poisoned fixture added earlier must not slip through because *this* PR didn't touch it. Also runs on **every outbound model payload** in CI replay (the SEC-3 "no PII leakage" eval, owned jointly with `06_security`). |
| **Fail mode** | **Fail-closed.** If the scanner cannot determine cleanliness (parse error, unknown encoding, binary blob in `evals/`), it **fails**, never passes by default. |
| **Required check** | `ci/eval-phi-scan` is a required status check under branch protection on `main` (slots into `quality_gates_ci §2 G12`). An agent or human cannot merge past a red PHI scan. |
| **Patterns are versioned** | The pattern/NER set is itself versioned (`phi-scan@MAJOR.MINOR.PATCH`); the version that cleared a case is recorded in `governance.deid.scanner_version`, so a later pattern improvement can re-scan historical fixtures and quarantine any that the older scanner missed (§7.4). |

> **Why machine-first.** A reviewer reading 40 cases will eventually miss a phone number in a
> free-text note at 5pm on a Friday. A regex/NER pass will not. The human layer catches what
> patterns can't (mosaic re-identification, context), but the **proof** is the scanner, because the
> proof must be repeatable, total, and unbypassable (A2).

---

## 3. Clinician-as-oracle sign-off (named, accountable, recorded)

An eval asserts the model produced the **clinically correct** output. "Correct" is defined by a
**named accountable clinician**, not by the case author, not by an agent, not by the model under
test. This is the dataset's **ground-truth authority** — and it is the one place A4's symmetry
yields to law: the oracle is **always a human with medical accountability**.

### 3.1 Who the oracle is

| | |
|---|---|
| **Must be** | A **named, registered clinician** (the supervising physician or a delegate they name), identified by `clinician_name` + on-file `clinician_reg_no`. The default oracle of record is the **supervising physician** (per `06_security` / clinical-lead). |
| **Must NOT be** | A role placeholder ("the clinical team"), an agent, the case author acting alone, or the model being evaluated. **No self-oracle**: the actor who authored the expected envelope cannot be its sole signer. |
| **Accountability** | The oracle **personally certifies** that the case's `expected` envelope is the clinically correct outcome for the scenario. Their attestation is recorded and auditable; the dataset's clinical authority is **traceable to a human**, not diffused. |

### 3.2 What the clinician certifies — and what they do NOT

```
CLINICIAN ORACLE CERTIFIES (scope = "clinical-envelope")     ENGINE / SCANNER CERTIFIES (NOT the clinician)
────────────────────────────────────────────────────────     ──────────────────────────────────────────────
• right drug class / line of therapy for the diagnosis       • the milligram / mL / drop number  ── dose-engine (A5/C5)
• the allergy collision MUST be flagged/withheld             • the PHI-free property             ── ci/eval-phi-scan
• required elements (NABH block, safety block, follow-up)    • the JSON contract validity        ── Ajv
• forbidden outputs (the never-event triggers) are right     • cost / latency budget             ── harness
• severity_floor is clinically justified
```

> **Hard rule (A5, restated for the dataset).** The clinician oracle **never hand-types the dose
> the case expects**. Expected dosing facts are expressed as **engine-checkable assertions**
> (`{drug, must_be_gfr_adjusted:true}`, `exceeds_max → forbidden`) and validated against the real
> `web/dose-engine.js` oracle (the M2 parity path, C5). A clinician certifies *that amoxicillin must
> be renally adjusted for this preterm*, the **engine** certifies *what the adjusted number is*. A
> case whose `dosing_facts` were a clinician's mental-math number is a defect — it would bake a human
> arithmetic guess into the "ground truth" the whole architecture exists to eliminate.

### 3.3 The sign-off record (the artifact)

Sign-off is a **recorded, machine-verifiable artifact**, not a verbal nod:

- The clinician signs the **exact expected envelope** (canonicalized JSON). `governance.oracle.attestation_hash` = `sha256(canonical(expected))`. CI re-derives the hash on ingest; a mismatch means the `expected` block changed since sign-off → the case is **un-signed** until re-attested.
- `governance.oracle.signed_at` + `clinician_name` + `clinician_reg_no` are recorded. The reg-no is stored on-file/redacted in the repo (it is not PHI of a *patient*, but is minimized).
- The sign-off emits a **command-bus event** (`GoldenCaseAttested`, `actor={human, clinician}`, `trace_id`, `case_id`, `attestation_hash`) — symmetric audit (A4): the dataset's provenance is on the same audit spine as a prescription sign-off.
- **Editing `expected` invalidates the attestation.** Because cases are append-not-mutate (§4), the normal path is to **supersede** with a new version that gets its own fresh sign-off — not to silently edit a signed envelope.

### 3.4 Six-eye for clinical content

Per `clinical_references.md` six-eye discipline, every golden case's *clinical content* passes
three distinct eyes recorded in `governance.review`:

1. **Author** — drafts the scenario + expected envelope (may be agent or human).
2. **Independent reviewer** — a **different** actor (agent or human, ≠ author) probes the envelope for a missing never-event, an unjustified `severity_floor`, an over-fit expectation.
3. **Clinical approver** — the **named clinician oracle** (§3.1), who is the accountable signer.

> The independent reviewer and the author **must differ** (no self-review, mirrors G17). The clinical
> approver is the oracle and is always a named human. Three eyes, one of them medically accountable.

---

## 4. Versioning (the dataset is a released artifact)

The golden set is a **versioned dependency** of every eval run, so a model/prompt PR is always
scored against a **pinned** dataset version (apples-to-apples diffs).

| Property | Rule |
|---|---|
| **Per-case semver** | Each `*.case.json` carries `version` (`MAJOR.MINOR.PATCH`). PATCH = metadata/comment; MINOR = added expectation that doesn't change pass/fail of existing-correct output; MAJOR = the `expected` envelope's pass/fail semantics changed (requires **fresh clinician sign-off**, §3.3). |
| **Dataset semver** | `evals/golden/MANIFEST.json` carries the **dataset version**, the case index, the per-split counts, and each case's content-hash. The manifest version bumps on any case add/supersede. |
| **Append-not-mutate** | Cases are, by default, **appended or superseded**, not edited in place. To change a graded expectation, mark the old version `superseded` and add a new versioned case. This preserves the audit trail and prevents "edit the test to make the change pass" (§5.3). |
| **Pinning in CI** | The eval gate (G9) records the dataset version it ran. A base-vs-branch eval run **pins the same dataset version** on both sides; comparing a branch against a *different* dataset version is a defect the harness rejects. |
| **Dataset bump = reviewed change** | Adding/superseding cases is a normal PR through the same gates (de-id scan, governance check, sign-off, six-eye). A **dataset MAJOR bump** (semantics of the gate change) is **ADR-worthy** per `change_management_versioning.md` — the bar for "what counts as correct" moved, and that decision is recorded. |

---

## 5. Anti-staleness & anti-overfitting controls

A golden set rots two ways: it goes **stale** (stops representing real traffic / real risk) or it
gets **overfit** (changes are tuned to pass *these specific cases* rather than to be clinically
correct). Both produce a green gate that lies. The controls below are the defense.

### 5.1 Train/test split discipline (the anti-overfit spine)

| Control | Rule |
|---|---|
| **Strict separation** | `split:"train"` cases may inform prompt iteration and are visible during development. `split:"test"` cases are **the gate** and are **held out** — never inspected to tune a change. |
| **Test cases are not "debugged against"** | An agent/human iterating on a prompt may run `train`; running `test` to read individual failures and tweak the prompt to those failures is **overfitting** and is forbidden. The `test` split is run by CI for pass/fail, not by the author for hill-climbing. |
| **No silent test edit** | Editing a `test` case so a failing change passes is a **reviewable, ADR-worthy act** (it moves the goalposts), never a quiet edit. The append-not-mutate rule + attestation-hash invalidation (§3.3) make a silent edit visible. |
| **Split ratio recorded** | `MANIFEST.json` records per-split counts; a PR that shifts a `test` case to `train` (which would weaken the gate) is flagged for explicit review. |

### 5.2 Anti-staleness (the set must keep representing reality)

| Control | Cadence | Rule |
|---|---|---|
| **Production-miss accretion** | continuous | The set's **primary growth engine** is the prod-miss loop (§6). A set that isn't growing from real misses is presumed **stale**. |
| **Coverage audit** | each release / quarterly | A scheduled job asserts the high-risk pediatric edges remain represented (neonate, preterm corrected-vs-chronological, renal/GFR, allergy collision, DDI, max-dose ceiling, weight-band boundary, BSA, infusion). A regressed edge (no covering `test` case) raises an alarm. |
| **Drift vs prod distribution** | quarterly | Compare the golden set's case-mix (diagnosis frequency, age bands) against the **de-identified** distribution of live traffic. A large divergence (golden set over-weights easy AOM while prod shifted to neonatal) flags the set as **stale** and queues curation. |
| **Decay review** | annual | Cases tied to retired protocols / deprecated drugs are reviewed; a superseded clinical guideline can make a once-correct `expected` envelope wrong. Re-attest or supersede. |

### 5.3 Anti-overfit, restated as a CI-visible rule

```
FORBIDDEN (overfitting the gate)                         REQUIRED (generalizing)
────────────────────────────────                         ────────────────────────
• reading test-split failures to tune a prompt           • iterate on train; gate on held-out test
• editing a test case's expected so a change passes      • supersede with a new signed version; ADR if MAJOR
• adding a case that only re-states an existing one       • add cases for NEW failure modes (prod-miss driven)
  to inflate the pass count                               • severity_floor from hazard analysis, not from
• weakening severity_floor to dodge a hard-block            convenience
```

> **The honest caveat (carried from `evals_framework §16`).** The set is a **safety net, not proof
> of safety**. These controls keep the net from quietly developing holes; they do not turn it into a
> guarantee. Mandatory physician sign-off at runtime (F4) remains the real clinical backstop.

---

## 6. Production-miss intake — with PHI clearance BEFORE entry

The dataset's growth engine is the **"prod miss → golden case"** loop. A live prescription scored
poorly (online eval) or flagged by a clinician becomes a golden case so the failure **can never
silently recur**. The governance risk: a prod miss is **real patient data** — it MUST be
**PHI-cleared before a single byte enters the repo**.

### 6.1 The gated intake pipeline

```
 LIVE Rx (real PHI)  ──online eval low score / clinician flag──▶  CANDIDATE (still PHI, NOT in repo)
        │
        ▼
 ┌─ STAGE 1: PHI CLEARANCE (in the secured incident store, NOT git) ──────────────────────────┐
 │  • De-identify: strip the 18-class + India identifier set (§2.2); dates→ages; blunt mosaic   │
 │  • DPO/data-protection review issues a PHI-clearance TICKET (PHI-CLR-NNN)                     │
 │  • The candidate is REWRITTEN to the DeidentifiedPatientContext shape; provenance → INC id    │
 │  GATE: no ticket → the candidate CANNOT proceed. PHI never reaches git.                       │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
        │  (now de-identified + ticketed)
        ▼
 ┌─ STAGE 2: AUTHORING ───────────────────────────────────────────────────────────────────────┐
 │  • Author the *.case.json with governance.source="prod-miss", provenance_ref=INC id,          │
 │    deid.phi_clearance_ticket=PHI-CLR-NNN, split="test" (a real miss is a gate, not training)  │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
 ┌─ STAGE 3: PROVEN DE-ID + ORACLE + SIX-EYE (§2, §3) ────────────────────────────────────────┐
 │  • ci/eval-phi-scan clears it (machine) ; reviewer clears it (human)                          │
 │  • named clinician oracle signs the expected envelope (attestation_hash)                      │
 │  • six-eye: author ≠ independent reviewer ; clinical approver = oracle                         │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
   MERGE into evals/golden/cases  ──▶  next model/prompt PR is gated on this exact failure
```

### 6.2 The intake rules (binding)

| Rule | Detail |
|---|---|
| **PHI clearance precedes the repo** | Stage 1 happens **entirely in the secured incident store** (access-controlled, audited). A prod-miss candidate **never lands in git, in a branch, in a PR, or in a fixture before it is de-identified and ticketed.** This is the single most important rule in §6. |
| **One-click is not one-step** | The Braintrust "promote to golden" affordance creates a **candidate**, not a committed case. The de-id + ticket + sign-off stages are mandatory before commit. Convenience never bypasses clearance. |
| **Ticketed provenance** | Every prod-miss case records `deid.phi_clearance_ticket` (the DPO clearance) and `provenance_ref` (the redacted incident id). CI rejects a `source:"prod-miss"` case missing either. |
| **Default split = test** | A production miss is, by definition, a real failure the gate must prevent recurring → it enters `split:"test"`. Moving a prod-miss case to `train` weakens the gate and is explicit-review-only (§5.1). |
| **Audit linkage** | The intake emits `GoldenCaseIntaken` on the command bus (`actor`, `trace_id`, `provenance_ref`, `phi_clearance_ticket`) so the loop from incident → golden case is auditable end to end (A4). |

> **Why "before entry" is load-bearing.** Once PHI touches git history it is effectively permanent
> (rewriting history is a high-risk, rarely-clean operation). The only safe design is to **never let
> raw PHI into the repository** — clearance is a precondition of authoring, not a cleanup afterward.
> `ci/eval-phi-scan` (§2.3) is the **backstop** that catches a clearance failure; it is not the
> primary control. The primary control is the Stage-1 gate that keeps PHI out of git in the first
> place.

---

## 7. Judge-model calibration & meta-eval

The LLM-judge scores **soft quality only** (note completeness, Hindi/English clarity, reasoning
plausibility) and **never a dose, allergy, or interaction** (`evals_framework §3, §6.2`). But a
judge that disagrees with clinicians is worse than no judge — it would gate (or pass) changes on a
fabricated signal. Before a judge is allowed to score *anything*, it must be **proven to agree with
humans**. This is the **meta-eval**: we evaluate the evaluator.

### 7.1 The calibration gate (a judge is a governed dependency)

| Control | Rule |
|---|---|
| **Pinned judge** | The judge model id + version is **pinned** in `judge_config.ts` (`evals_framework §4.3/§6.2`). A judge upgrade is a **gated change** (it re-runs this whole calibration). The judge id lives in config only (F5 model-id firewall). |
| **Human-labeled calibration set** | A held-out subset of cases carries **human soft-quality labels** (the same named clinician oracle, or a clinical delegate, rates note completeness / clarity on the rubric scale). This is the **ground truth the judge is measured against**. |
| **Agreement target** | The judge's scores must agree with the human labels at **Krippendorff α ≈ 0.8** (inter-rater reliability). Below the floor → the judge is **not trusted**; its scores become **observational (non-blocking)** until recalibrated, and soft-quality thresholds fall back to human spot-review. |
| **Re-validate on any change** | Calibration re-runs after **any** judge model change, rubric edit, or prompt-template change to the judge. A judge that scored yesterday is not assumed to score today after an upgrade. |

### 7.2 The runtime discipline this gate licenses

Once calibrated, the judge runs under the discipline `evals_framework §6.2` owns (this file does not
re-derive it, only states what calibration *licenses*):

- **Score-average n≥3** per case; **report mean + variance**.
- **Variance bound:** if a case's judge variance exceeds the configured bound, the result is **escalated to a human**, **never auto-passed**. High disagreement-with-itself is a signal the judge is out of its depth on that case.
- **Bias audit:** position, length, and self-preference bias are audited; ordering randomized; model-identifying tells stripped (a judge must not score its own model's output higher).
- **Blocking class:** judge scores are **threshold or non-blocking** — never the *only* thing between a change and merge. The deterministic safety layer is the real gate.

### 7.3 Meta-eval as a recorded artifact

```
 CALIBRATION RUN  ──▶  report: per-rubric α vs human labels, variance distribution, bias-audit result
        │
        ├─ α ≥ 0.8 on every blocking rubric ──▶ judge TRUSTED → soft thresholds may gate
        └─ α < 0.8 on any blocking rubric  ──▶ judge OBSERVATIONAL → that rubric is non-blocking,
                                               flagged for recalibration, human spot-review fills the gap
```

The calibration report is a CI artifact (`evals/reports/judge-calibration/…`) and the judge's
**trusted/observational** status is recorded in `judge_config.ts` alongside the pinned id, so a
reader can see *on what evidence* the judge is allowed to gate.

### 7.4 Re-scanning historical fixtures (closing the loop with §2.3)

When the **PHI scanner** improves (`phi-scan@…` bump) or the **judge** recalibrates, historical
fixtures are re-evaluated against the new bar:

- A scanner upgrade **re-scans the whole `evals/` tree**; any case the older scanner missed is **quarantined** (moved out of the gating split, flagged for re-de-id) — the `governance.deid.scanner_version` on each case makes "what cleared this, and was that good enough?" answerable.
- A judge recalibration re-scores the soft-quality rubrics; a rubric that drops below α is demoted to observational until fixed.

---

## 8. Roles & responsibilities (who does what)

| Role | Responsibility in the dataset lifecycle | Symmetric? |
|---|---|---|
| **Case author** | Drafts the scenario + expected envelope; runs local de-id; writes the governance block. | Human or agent (A4). |
| **Independent reviewer** | Six-eye reviewer ≠ author; probes for missing never-events, over-fit expectations, unjustified severity. | Human or agent (A4); must differ from author. |
| **Named clinician oracle** | Personally certifies the clinical envelope; signs the attestation hash; accountable for "what is correct." | **Human only** (the law's asymmetry). |
| **Data Protection Officer / clearance** | Stage-1 PHI clearance for prod-miss intake; issues the clearance ticket. | Human (accountable). |
| **Gatekeeper (CI)** | Runs `ci/eval-phi-scan`, governance-check, dataset-pin, calibration gate; blocks merge on any red. | Automated. |
| **Engineering-discipline owner** | Owns this file; owns scanner pattern versioning; owns the coverage/decay cadence. | Human, audited. |

---

## 9. CI gates this file owns or feeds (the enforcement ledger)

These slot into `quality_gates_ci.md §2` (the gate ledger) and are **required checks** under branch
protection on `main`.

| Gate | Owner | Hard-fail condition |
|---|---|---|
| **`ci/eval-phi-scan`** | **this file** (canonical, per `canonical_decisions §D.2`) | Any PHI token in `evals/**` or any outbound model payload; or scanner can't determine cleanliness (fail-closed). |
| **`ci/eval-data-governance`** | **this file** | A `*.case.json` missing/invalid governance block; `attestation_hash` ≠ `sha256(canonical(expected))`; author = independent reviewer; `prod-miss` case missing `phi_clearance_ticket` or `provenance_ref`. |
| **`ci/eval-dataset-pin`** | **this file** | Base-vs-branch eval ran against mismatched dataset versions; `MANIFEST.json` content-hash drift. |
| **`ci/judge-calibration`** | this file (data) + `evals_framework.md` (run) | A blocking judge rubric below Krippendorff α floor while still configured as blocking; judge id not in config (F5). |
| **`ci/eval-gate` (G9)** | `evals_framework.md` / `quality_gates_ci.md` | (consumes this file's governed, pinned, calibrated dataset) never-event ≠ 100%, severe count > 0, soft < threshold, cost/latency over budget. |

> **Fail-closed everywhere.** Every gate above fails the build if it **cannot prove** the safe
> condition — an indeterminate de-id scan, an unresolvable dataset pin, or an unparseable governance
> block is a **failure**, never a silent pass (A2 + the security fail-closed posture).

---

## 10. Conformance checklist (for the synthesis/marriage step)

- [ ] Every `test`-split `*.case.json` carries a complete, schema-valid `governance` block (`source`, `provenance_ref`, `deid`, `oracle`, `review`).
- [ ] `ci/eval-phi-scan` is a **required check** on `main`, scans the whole `evals/` tree, fails closed, and is owned here (no duplicate owner).
- [ ] De-identification is **two-layer**: machine scanner (the proof) + human six-eye review; synthesis preferred over scrubbing; dates→ages; `sex ∈ {'M','F'}` in model-bound context (C2).
- [ ] Every gated case has a **named clinician oracle** sign-off recorded as an `attestation_hash` over the canonical `expected`; **no self-oracle**; the clinician certifies the **clinical envelope**, the **engine** certifies the dose (A5/C5).
- [ ] Cases are **versioned** (per-case semver + dataset `MANIFEST.json`), **append-not-mutate**, and **pinned** in every base-vs-branch eval run.
- [ ] **Train/test split** is strict; `test` is held out and never tuned-against; editing a `test` expected is ADR-worthy, not silent.
- [ ] Prod-miss intake **PHI-clears before git** (Stage-1 ticket), defaults to `split:"test"`, records `phi_clearance_ticket` + `provenance_ref`, and is auditable on the command bus.
- [ ] Anti-staleness cadence (coverage audit, prod-distribution drift, decay review) is scheduled; the high-risk pediatric edges remain covered.
- [ ] The **judge is calibrated** (Krippendorff α ≈ 0.8 vs human labels) before it gates; recalibrates on any judge/rubric change; pinned in config; variance-over-bound escalates to a human, never auto-passes.

---

### Relevant repo paths (absolute)

- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\web\dose-engine.js` — the dosing oracle the clinician oracle defers to for the milligram (A5/C5; M2 parity path).
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\system-spec\09_engineering_discipline\evals_framework.md` — the harness/scorers/never-events/judge-runtime this dataset feeds.
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\system-spec\09_engineering_discipline\quality_gates_ci.md` — the gate ledger (G9, G12) these gates slot into.
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\system-spec\06_security\security_auth_rbac_compliance.md` — SEC-3 de-id boundary, DPDP, audit spine.
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\system-spec\00_overview\canonical_decisions.md` — C1 UHID, C2 sex, C3 status, C5 dose-engine, §D.1/§D.2 gate ownership.
- Target (created by the scaffolding workflow): `evals/golden/cases/`, `evals/golden/MANIFEST.json`, `evals/scorers/judge/judge_config.ts`, `evals/reports/judge-calibration/`, `.github/workflows/eval-phi-scan.yml`.
