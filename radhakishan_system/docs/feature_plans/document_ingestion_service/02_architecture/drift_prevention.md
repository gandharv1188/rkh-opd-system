# Drift Prevention in DIS

> **Status:** Draft for user review. Phase 1 enforced; Phase 2 staged.
> **Scope:** Applies to every ticket executed under DIS (see
> `07_tickets/README.md`). Controls here compose with, and do not
> replace, the gate system in `08_team/review_gates.md`.
>
> **Why now:** DIS is delivered by isolated agent sessions working
> ticket-by-ticket. Each session has no memory of the last. Without
> mechanical guardrails, the codebase drifts from the TDD in small,
> plausible-looking steps until it no longer matches what was approved.
> This document is the guardrail set.

---

## §1. What we mean by drift

Drift is the gap between what the TDD + tickets approved and what the
code, schema, or process actually does. Four flavors matter for DIS.

### 1a. Scope drift

An agent touches files outside its ticket's mandate.

_Concrete example:_ DIS-023 (promotion service) is meant to touch
`dis/src/core/promotion.ts` + its tests. The agent "helpfully"
refactors `dis/src/core/state-machine.ts` to tidy a switch statement.
The refactor is benign-looking but was never test-gated or reviewed for
Gate 6a (clinical-safety), and now ships silently inside a
clinical-safety ticket.

### 1b. Spec drift

Code diverges from the TDD without an ADR.

_Concrete example:_ TDD §9 says promotion is always behind an explicit
command (CQRS-lite, see `coding_standards.md` §2). An agent adds an
"auto-promote on reception clerk upload if confidence ≥ 0.98" path
because a fixture test expected it. No ADR exists. Six weeks later
nobody remembers it's there.

### 1c. Architectural drift

Core starts depending on adapters; ports mutate silently; the
hexagonal contract cracks.

_Concrete example:_ `dis/src/core/orchestrator.ts` imports
`dis/src/adapters/storage/supabase-storage.ts` "just for the type".
It compiles. The port validator in `adapters.md` is supposed to catch
this; if we haven't actually automated it, it won't. Or: someone adds
a new method to `OcrPort` without bumping `// port-version:` and
without ADR.

### 1d. Quality drift

`TODO` / `FIXME` accumulate, tests get `.skip`-ed, coverage slips,
`any` escape hatches multiply, baselines creep.

_Concrete example:_ A unit test for CS-4 (fail-closed on structuring
error) starts flaking. The agent adds `.skip` "until CI is less
noisy." Six tickets later the skip is forgotten; CS-4 regression
ships.

---

## §2. Control matrix (executive summary)

| #   | Name                                  | Type       | Prevents                 | Cost      | Phase | Status   |
| --- | ------------------------------------- | ---------- | ------------------------ | --------- | ----- | -------- |
| 1   | PR source-of-truth citation check     | CI         | Spec drift               | 1–2 h     | 1     | Proposed |
| 2   | Files-touched allowlist               | CI+process | Scope drift              | 2–3 h     | 1     | Proposed |
| 3   | Architectural fitness functions       | CI         | Architectural drift      | 3–4 h     | 1     | Proposed |
| 4   | Spec hash locking                     | CI         | Spec drift (advanced)    | 4–6 h     | 2     | Staged   |
| 5   | Anti-regression baselines             | CI         | Quality drift (perf/cov) | 4–6 h     | 2     | Staged   |
| 6   | Forbidden commit message tokens       | CI         | Spec + quality drift     | 1 h       | 2     | Staged   |
| 7   | Dead-code / TODO detector             | CI         | Quality drift            | 1 h       | 1     | Proposed |
| 8   | Prompt version stamping               | Code       | Spec drift (LLM)         | 2–3 h     | 2     | Staged   |
| 9   | ADR-gated decisions                   | CI+process | Spec + arch drift        | 2 h       | 2     | Staged   |
| 10  | Orchestrator re-verification sampling | Process    | All four (safety-net)    | 5–10 m/PR | 1     | Proposed |
| 11  | Handoff diff audit                    | Process    | Scope + quality drift    | 5 m/PR    | 2     | Staged   |

Totals: **5 Phase-1 controls, 6 Phase-2 controls, 11 total.**

---

## §3. Phase 1 controls — apply now

These are high-leverage and low-cost. They run on every PR in the
`dis/` tree starting with Epic B.

### Control 1 — PR source-of-truth citation check

**What.** Every PR body must cite, verbatim, the exact TDD section(s),
clinical-safety requirement(s) (CS-##), user story (DIS-US-###), and
coding-standards section(s) it implements. CI reads the PR body and
verifies each citation resolves to a real section in the referenced
file.

**Why it prevents drift.** If the agent has to _name_ what it is
implementing before it merges, a human reviewer can mechanically
verify the code matches the claim. Unstated drift becomes stated
drift, which becomes reviewable drift.

**How.** GitHub Actions workflow pulls the PR body via the API, greps
for `implements TDD §[0-9]+(\.[0-9]+)*`, `CS-[0-9]+`,
`DIS-US-[0-9]+`, and `coding_standards.md §[0-9]+`, and validates each
against the actual file on the branch.

**Implementation sketch.**

Files:

- `.github/workflows/dis-pr-citations.yml`
- `dis/scripts/check-pr-citations.mjs`

Pseudocode (`check-pr-citations.mjs`):

```js
import fs from "node:fs/promises";
const body = process.env.PR_BODY ?? "";
const tddPath =
  "radhakishan_system/docs/feature_plans/document_ingestion_service/02_architecture/tdd.md";
const tdd = await fs.readFile(tddPath, "utf8");
const citations = [
  ...body.matchAll(/implements TDD §([0-9]+(?:\.[0-9]+)*)/g),
].map((m) => m[1]);
if (!citations.length) {
  console.error("No TDD citation in PR body");
  process.exit(1);
}
for (const s of citations) {
  const anchor = new RegExp(`^## §${s.replace(".", "\\.")}\\.`, "m");
  if (!anchor.test(tdd)) {
    console.error(`TDD §${s} not found`);
    process.exit(1);
  }
}
// Repeat for CS-## against clinical_safety.md, etc.
```

**Cost.** ~1–2 h one-time. Zero runtime cost per PR.

**False-positive risk.** Low. Cited section numbers are mechanically
verifiable against the markdown source.

**Enforced at.** Gate 4 (Automated checks).

---

### Control 2 — Files-touched allowlist

**What.** Every ticket declares the exhaustive list of files it may
add, modify, or delete. CI diffs the PR against that allowlist and
fails if any file outside the allowlist is touched.

**Why it prevents drift.** This is the single biggest lever against
scope drift. "While I was here I also refactored X" is exactly how
architectural drift enters the codebase. If the agent cannot write
outside the allowlist, it must either stay in scope or open a new
ticket.

**How.** Two parts.

1. **Ticket frontmatter.** Add a machine-readable `files_allowed: [...]`
   YAML block to `07_tickets/_ticket_template.md` (mirroring the
   existing "Files the ticket will touch" section).
2. **CI script.** Reads frontmatter from the ticket file matching the
   branch name (`feat/dis-023-promotion` → DIS-023); invokes
   `git diff --name-only origin/feat/dis-plan...HEAD` via
   `execFile`; fails on additions, modifications OR deletions outside
   the allowlist.

**Implementation sketch.**

Files:

- `.github/workflows/dis-files-touched.yml`
- `dis/scripts/check-files-touched.mjs`
- Amended `07_tickets/_ticket_template.md`

Pseudocode:

````js
import fs from "node:fs/promises";
import yaml from "yaml";
import { runGit } from "./_git.mjs"; // wraps execFile('git', [...])
const ticketId = process.env.BRANCH.match(/feat\/dis-(\d+)/)[1];
const backlog = await fs.readFile(".../07_tickets/backlog.md", "utf8");
const block = backlog.match(
  new RegExp(`### DIS-${ticketId}[\\s\\S]*?(?=\\n### DIS-|$)`),
)[0];
const fm = yaml.parse(block.match(/```yaml([\s\S]*?)```/)[1]);
const changed = (
  await runGit(["diff", "--name-only", "origin/feat/dis-plan...HEAD"])
)
  .split("\n")
  .filter(Boolean);
const extras = changed.filter((f) => !fm.files_allowed.includes(f));
if (extras.length) {
  console.error("Out-of-scope files:", extras);
  process.exit(1);
}
````

**Cost.** ~2–3 h. One-time template update + CI script.

**Escape hatch.** The ticket author may expand `files_allowed` with a
follow-up commit to the ticket file **before** writing the new file.
Never after — that would be a retro-fit.

**Enforced at.** Gate 4.

---

### Control 3 — Architectural fitness functions

**What.** Encode the hexagonal + layering rules from `adapters.md`
and `coding_standards.md` §2 as declarative rules; CI scans the source
tree and fails on violations.

**Why it prevents drift.** Architectural drift is invisible in a
one-line diff but obvious at the boundary level. Automate the
boundary check; don't rely on reviewer vigilance.

**Rules (initial set).**

- `dis/src/core/**` cannot `import` from `dis/src/adapters/**`.
- `dis/src/ports/**` cannot `import` from `dis/src/adapters/**` or
  from `dis/src/core/**` (ports are the narrow waist).
- `dis/src/core/**` cannot contain `fetch(`, `new XMLHttpRequest`,
  `node:http`, `node:https` — core does no network.
- `dis/src/core/**` cannot contain `db.query(`, `pool.query(`, or
  any raw SQL string literal — core does no DB.
- `dis/src/adapters/storage/supabase-*.ts` is the ONLY path allowed
  to `import` the Supabase SDK (`@supabase/supabase-js`).
- `dis/src/adapters/database/*.ts` is the ONLY path allowed to
  `import` `pg`, `postgres`, `drizzle-orm`.
- No `: any` in `dis/src/**` outside an explicit `// reason: …`
  comment block (`coding_standards.md` §1).

**How.** Rules live as JSON in `dis/scripts/fitness-rules.json`; one
script walks the tree and applies them.

Pseudocode (`dis/scripts/fitness.mjs`):

```js
import fs from "node:fs/promises";
import { globby } from "globby";
const rules = JSON.parse(
  await fs.readFile("dis/scripts/fitness-rules.json", "utf8"),
);
const files = await globby(["dis/src/**/*.{ts,tsx}"]);
const violations = [];
for (const f of files) {
  const src = await fs.readFile(f, "utf8");
  for (const r of rules) {
    if (!new RegExp(r.appliesTo).test(f)) continue;
    for (const forbid of r.forbidden) {
      if (new RegExp(forbid.pattern).test(src)) {
        violations.push(`${f}: ${forbid.reason}`);
      }
    }
  }
}
if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}
```

**Example violation output.**

```
dis/src/core/orchestrator.ts: core must not import adapters (matched /adapters\//)
dis/src/core/promotion.ts: core must not contain raw SQL (matched /SELECT .* FROM/)
```

**Cost.** ~3–4 h. Rules file + script + CI workflow.

**Enforced at.** Gate 4. Subsumes the "port validator" mentioned in
`adapters.md` under change control.

---

### Control 7 — Dead-code / TODO detector (Phase 1 slice)

**What.** CI greps the production tree (`dis/src/**`, excluding test
files) for forbidden tokens: `TODO`, `FIXME`, `XXX`, `HACK`,
`console.log`, `debugger`, `.only`, `.skip`, and `xdescribe`/`xit`.
Test files are exempt because `.skip` and `describe.skip` are
legitimate during TDD (Gate 2 occasionally leaves tests skipped
pending implementation, per `coding_standards.md` §9).

**Why it prevents drift.** Quality drift is silent. An accumulating
pile of `TODO` is the mile-marker that the team stopped caring.
`.only` committed by accident silently narrows the test run to one
case; `.skip` silently disables a safety test.

**How.** `dis/scripts/check-forbidden-tokens.mjs`. Honors an inline
allow-annotation: `// lint-allow: TODO — ticket DIS-999` so that a
known, ticketed deferral can be tolerated. Annotations without a
ticket reference are rejected.

Pseudocode:

```js
import { globby } from "globby";
import fs from "node:fs/promises";
const FORBIDDEN = [
  "TODO",
  "FIXME",
  "XXX",
  "HACK",
  "console\\.log",
  "debugger",
  "\\.only\\(",
  "\\.skip\\(",
  "xdescribe",
  "xit\\(",
];
const files = await globby([
  "dis/src/**/*.{ts,tsx,js,mjs}",
  "!dis/src/**/*.test.*",
  "!dis/src/**/__tests__/**",
]);
const hits = [];
for (const f of files) {
  const src = await fs.readFile(f, "utf8");
  // Normalize CRLF on Windows so $-anchored patterns don't miss matches.
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((line, i) => {
    for (const pat of FORBIDDEN) {
      if (new RegExp(pat).test(line) && !/lint-allow:.*DIS-\d+/.test(line)) {
        hits.push(`${f}:${i + 1}: ${line.trim()}`);
      }
    }
  });
}
if (hits.length) {
  console.error(hits.join("\n"));
  process.exit(1);
}
```

**Windows note.** The `.replace(/\r\n/g, '\n')` normalization is
required because Windows check-outs use CRLF and some regex patterns
(esp. `$`-anchored) quietly miss hits otherwise. This is the only
place in the Phase-1 controls where line-ending handling matters.

**Cost.** ~1 h.

**Enforced at.** Gate 4.

---

### Control 10 — Orchestrator re-verification sampling

**What.** The Orchestrator (Architect) re-runs a random sample of the
PR's `VERIFY` commands (the test/lint/fitness commands the worker
agent claims to have run) before merge. Sampling rate: **20% of
VERIFY blocks** for ordinary tickets; **100%** for tickets tagged
`clinical-safety`, `integration`, or `breaking`.

**Why it prevents drift.** This is the catch-all for _speculative
output_: an agent that pasted a plausible "✓ 42 tests passing" line
without actually running the suite. It also catches environment
mismatches (works on agent's worktree, fails on orchestrator's).

**How.** Process-only, no CI change. Added to Gate 5 as an
Orchestrator checklist step.

**Procedure.**

1. Orchestrator opens the PR's handoff file
   (`dis/handoffs/DIS-###.md`, §9 "Reproducing the work locally").
2. Picks N VERIFY commands at random (N = ceil(0.2 × total) for
   normal, all for high-risk tags).
3. Runs each in a fresh worktree on the PR branch.
4. Diffs captured output against what the agent reported in the
   handoff or PR body.
5. Any discrepancy → Gate 5 failure, PR re-opened with
   `Changes Requested — VERIFY mismatch`, specific commands cited.

**Cost.** ~5–10 min per PR for the Orchestrator. Cheapest single
control against the hardest failure mode.

**Enforced at.** Gate 5 (Code review). Goes into
`08_team/review_gates.md` as a new sub-section of Gate 5.

---

## §4. Phase 2 controls — staged

Defer unless a specific incident justifies earlier adoption or until
Epic F retrospective.

### Control 4 — Spec hash locking

- **What.** At ticket dispatch, hash the cited TDD/CS sections. On
  merge, re-hash; reject if the hash differs (TDD was edited mid-ticket).
- **Why.** Prevents "agent updated the TDD to match its implementation."
- **How.** `dis/scripts/hash-cited-specs.mjs` writes
  `dis/handoffs/DIS-###.spec-hash.json` at start; CI compares at merge.
- **Cost.** ~4–6 h.

### Control 5 — Anti-regression baselines

- **What.** `dis/metrics/baselines.json` holds per-module coverage
  - p95 endpoint latency + test count; CI fails if any metric regresses
    > 10% (`coding_standards.md` §14 budget).
- **Why.** Catches slow quality erosion invisible in single-PR review.
- **How.** Nightly job updates baseline on `feat/dis-plan`; PR job
  compares.
- **Cost.** ~4–6 h.

### Control 6 — Forbidden commit-message tokens

- **What.** Block commit messages containing hedging tokens:
  `probably`, `should be fine`, `temporarily`, `TODO later`, `HACK`,
  `will fix`, `quick fix`.
- **Why.** These phrases are signatures of deferred work that usually
  isn't deferred — it's abandoned.
- **How.** `commit-msg` Git hook plus a CI check on the PR's commit
  history.
- **Cost.** ~1 h.

### Control 8 — Prompt version stamping

- **What.** Every LLM call from DIS adapters records
  `prompt_id` + `prompt_sha256` alongside the request.
- **Why.** When extraction quality changes, we need to know whether
  the prompt changed. Silent prompt drift is invisible otherwise.
- **How.** `dis/prompts/` files are content-addressed; adapters emit
  the SHA in the extraction audit row.
- **Cost.** ~2–3 h.

### Control 9 — ADR-gated decisions

- **What.** Every `// reason: …` comment in code (the escape hatch
  from §1 of coding standards) must cite an `ADR-###`; CI checks that
  the ADR file exists.
- **Why.** Forces the escape hatch to be documented, not a free pass.
- **How.** Grep `// reason:` in `dis/src/**`, ensure each line
  contains `ADR-\d+`, resolve against
  `02_architecture/adrs/NNNN-title.md`.
- **Cost.** ~2 h.

### Control 11 — Handoff diff audit

- **What.** Orchestrator compares the "Decisions" and "Files touched"
  sections of `dis/handoffs/DIS-###.md` (per `session_handoff.md` §3)
  against `git diff`. Unmentioned file changes → re-opened PR.
- **Why.** Agents sometimes write files they forget to mention in the
  handoff; forgotten files = future mystery.
- **How.** Process. Orchestrator runs
  `git diff --name-only` and cross-references §6 of the handoff.
- **Cost.** ~5 min per PR.

---

## §5. How these compose with existing gates

- **Gate 1 (Pre-start):** Template now contains `files_allowed` — so
  Control 2 is effectively pre-flight.
- **Gate 2 (Test-first):** Unchanged. Control 7's `.skip` rule does
  not fire in test files — TDD legitimately leaves tests red/skipped
  until implementation lands.
- **Gate 4 (Automated checks):** Controls 1, 2, 3, 7 fire here. They
  are added to the CI job list alongside lint/typecheck/tests/audit.
- **Gate 5 (Code review):** Control 10 (re-verification sampling)
  fires here, owned by the Orchestrator.
- **Gate 6a (Clinical-safety):** Control 10 escalates to 100%
  sampling when this gate is triggered.
- **Gate 6b (Integration):** Same — 100% sampling.
- **Gate 7 (DoD):** Handoff check already lives here
  (`review_gates.md` Gate 7); Control 11 (Phase 2) will add the
  diff-vs-handoff cross-check.

---

## §6. Failure mode library

Real agent failure modes seen in LLM agentic work, and which controls
catch them.

| #   | Failure mode                                                        | Caught by        | Not caught by |
| --- | ------------------------------------------------------------------- | ---------------- | ------------- |
| F1  | Agent silently widens `any` escape hatch                            | C3 (fitness)     | C1,C2,C7,C10  |
| F2  | Agent commits `.only` on a test to speed local dev                  | C7               | all others    |
| F3  | Agent pastes speculative VERIFY output; never ran the command       | C10              | C1,C2,C3,C7   |
| F4  | Agent edits TDD mid-feature to match its implementation             | **Phase 2 C4**   | all Phase-1   |
| F5  | Agent "while I was here" refactors an unrelated module              | C2               | C1,C3,C7,C10  |
| F6  | Core imports an adapter for a type-only reason                      | C3               | C1,C2,C7,C10  |
| F7  | Agent leaves `TODO: handle error` in clinical-safety path           | C7               | C1,C2,C3,C10  |
| F8  | Agent claims "implements TDD §9.2" but §9.2 doesn't exist           | C1               | C2,C3,C7,C10  |
| F9  | Agent lowers a test assertion to make it pass                       | **none** (human) | all automated |
| F10 | Agent adds a new port method with no ADR and no version bump        | C3 + Phase 2 C9  | C1,C2,C7,C10  |
| F11 | Agent regresses p95 latency by 25% under a plausible refactor       | **Phase 2 C5**   | all Phase-1   |
| F12 | Agent writes correct-looking code that is subtly semantically wrong | **none**         | tests + human |

F4, F9, F12 are explicit limitations — see §8.

---

## §7. Rollout plan

1. This document is committed to `feat/dis-drift-prevention`; user
   reviews it.
2. On user approval, the Architect opens a PR that:
   - Adds `files_allowed:` block to
     `07_tickets/_ticket_template.md`.
   - Adds `.github/workflows/dis-pr-citations.yml`,
     `dis-files-touched.yml`, `dis-fitness.yml`,
     `dis-forbidden-tokens.yml`.
   - Adds `dis/scripts/check-pr-citations.mjs`,
     `check-files-touched.mjs`, `fitness.mjs`,
     `fitness-rules.json`, `check-forbidden-tokens.mjs`.
   - Updates `08_team/review_gates.md` Gate 5 with Control 10
     procedure.
3. First wave of tickets after merge (Epic B) runs under the full
   Phase 1 set. Any false positives in the first wave are tuned, not
   silenced.
4. Phase 2 controls are filed as DIS-xxx tickets. They are pulled off
   the backlog only when either (a) a drift incident justifies one
   specifically, or (b) at the Epic F retrospective.

---

## §8. What this does NOT prevent

Honest list of drift types that survive every control here.

- **Subtle semantic bugs.** Code that matches the TDD word-for-word
  but does the wrong thing on an unexercised edge case. Only tests +
  human review catch this (coding_standards.md §9).
- **Mid-feature TDD edits.** If a human (or the Architect) changes
  the TDD during a feature, no Phase-1 control flags it. Phase 2
  Control 4 (spec hash locking) is the designed counter.
- **Upstream provider drift.** If Datalab Chandra silently changes its
  output format, our code is now wrong relative to reality. Fixture-
  based golden tests catch this at test time, never earlier.
- **Long-lived-branch rot.** `feat/dis-plan` diverges from `main`;
  re-integration surprises appear late. We rely on rebase discipline
  here; no automation.
- **Agents colluding with weak tests.** An agent can write an
  implementation AND the test that validates it; if both share a
  misunderstanding, both pass. Only an independent reviewer breaks
  this (Gate 5).

---

## §9. References

- `05_testing/test_strategy.md` — overall test pyramid + coverage
  thresholds (no standalone `verify_format.md` yet; VERIFY block
  conventions are inherited from worker-agent prompt templates).
- `08_team/session_handoff.md` — handoff template (used by Controls
  10 and 11).
- `08_team/review_gates.md` — gate sequence (Controls slot in here).
- `02_architecture/coding_standards.md` — §1 (`any`), §2 (hexagonal),
  §9 (testing), §14 (performance), §17 (enforcement).
- `02_architecture/adapters.md` — port/adapter boundary and the
  "port-validator" concept that Control 3 generalizes.
- `02_architecture/tdd.md` — §1 architectural style, §17 portability
  (both cited by Phase-1 tickets).
- `07_tickets/_ticket_template.md` — will be amended to add
  `files_allowed:` for Control 2.
