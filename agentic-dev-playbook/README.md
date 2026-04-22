# Agentic AI Coding Playbook — Claude Team-Mode

> Observed practice + rationale + evidence from the Document Ingestion
> Service (DIS) build on the `radhakishan-prescription-system` repo,
> 2026-04-15 through 2026-04-22. Dual audience: a future orchestrator
> (another Claude Opus session) who wants to reproduce the discipline,
> and a human tech lead who wants to understand the tradeoffs behind
> each pattern.
>
> Voice is descriptive — "here's what worked for us, here's why, here's
> the outcome" — not commandment. Readers decide how to adopt.
>
> **Shape of the document.** PART A covers the practices we actually
> exercised; every claim cites a source file or session handover. PART B
> covers practices we recognize as valuable but have not yet
> battle-tested here. Each part is clearly labelled at its header so
> readers can tell grounded from aspirational at a glance.

---

## How this playbook is organized

| Part | What it contains | Evidence bar |
| ---- | ---------------- | ------------ |
| PART A — Practices exercised | The 14 patterns we actively ran during the DIS build | Each claim cites a source file, commit, or session handover |
| PART B — Unexercised practices | Patterns we know are valuable but did not adopt | Flagged as aspirational; described, not prescribed |

Quick-reference and source pointers live in the appendices.

---

## Preface

This playbook grew out of the DIS build: a verification-gated,
cloud-portable document-ingestion pipeline for a pediatric OPD. The
feature was planned, designed, ticketed, implemented, reviewed, and
handed off by an orchestrator Claude session (Opus 4.7, 1M context)
driving a persistent squad of named Claude teammates in isolated git
worktrees on a native-Windows workstation. Over roughly two weeks of
wall clock the orchestrator and the squad produced ~40 plan documents
(north-star, TDD, ADRs, runbooks, drift-prevention) and delivered 15+
tickets across three parallel waves. The steady-state quality bar was
`tsc --noEmit` exit 0, 124 vitest tests green, and 0 fitness-rule
violations on every commit landing on `feat/dis-plan`.

**Why agentic at all.** A single Claude session can hold the mental
model of a mid-sized feature for about the length of one wave. Beyond
that, context saturates and the session degrades. A team of fresh
teammates with narrow ticket briefs and strict worktree isolation
sidesteps that ceiling: the orchestrator holds the feature-level
picture, each teammate holds a ticket-level picture, and handoff files
carry knowledge between them. When the discipline holds, the result
is parallel throughput at a correctness bar that a solo session finds
hard to sustain — because each piece of work passes through gates
(test-first, VERIFY, fitness, clinical-safety, integration) that a
tired solo session quietly skips.

**What this document is.** The concrete protocols — and the incidents
behind each — that made that throughput possible. PART A sections are
opinionated. Each closes with a short **Why it worked for us**
paragraph pointing to a specific file, commit, or session handover.

**What this document is not.** A survey. Nothing in PART A is
theoretical. If a pattern is in PART A, we exercised it, it bit us,
or both. Conversely, if a pattern is absent from PART A, assume we did
not exercise it and check PART B or verify externally before relying
on it.

**How to adapt this to a new project.** See §A14. In short: write the
plan folder first, author ADRs and the TDD before ticketing, ticket
in Verify-Driven format, dispatch in waves, refresh orientation as
you go, stop for user sign-off at integration gates.

---

# PART A — Practices exercised in the DIS build

> The patterns in PART A were actively run during the DIS build.
> Every subsection cites at least one source file or session handover
> to ground the claim. Voice is descriptive: observed behavior,
> rationale behind our choices, and the outcome we saw.

---

## §A1. Team model

### How we ran teammates

We created teammates once per wave with `TeamCreate` +
`Agent(team_name, name=...)`, then addressed them by `name` via
`SendMessage`. Names — not UUIDs — were canonical, because UUIDs
changed across sessions while names stayed stable.

```
TeamCreate(team_name="dis-squad")
Agent(team_name="dis-squad", name="dev-021b-reconcile", ...)
SendMessage(to="dev-021b-reconcile", payload="...")
```

Teammates persisted within a session and were re-addressable across
tickets. The alternative — one-shot subagents — lost the accumulated
conventions and context between invocations and produced noticeably
lower-quality second-ticket work.

A related distinction we hit more than once: an `Agent(name=...)`
spawned *without* `team_name` is a subagent, not a teammate. Subagents
cannot be messaged and cannot receive `shutdown_request`. When we
needed mid-flight correction, we always wanted teammates, not
subagents. This is captured as gotcha #5 in
`dis/handoffs/sessions/SESSION_HANDOVER_2026-04-20.md §13`.

### How we capped ticket load per teammate

In practice, three tickets per teammate per session was the ceiling
where quality held. A teammate's context window is independent and
does not mid-session compact, so every file read, every tool-call
result, every message accumulates. Past three tickets we saw the
typical symptoms of context saturation: missed VERIFY steps,
paraphrased outputs, half-read briefs. For tickets requiring a lot
of reading (cross-referencing the TDD, consulting prior handoffs),
two tickets was sometimes the right cap.

When a teammate's context saturated, respawning was cheaper than
steering — shutdown_request, then `Agent(...)` with a fresh instance.

### How we handled cross-wave teammates

We did not reuse teammates across waves, even when one finished a
wave idle and healthy. The wave's merge cycle on main had usually
invalidated many of the teammate's assumptions about file layout,
and the accumulated reads from the prior wave were dead context that
competed with fresh ticket context. Fresh teammates per wave made
onboarding faster and output more consistent.

### Shutdown discipline

When a teammate's branch merged and its worktree was removed, we
sent a JSON `shutdown_request` via `SendMessage` immediately:

```
SendMessage(to="dev-021b-reconcile", payload={"shutdown_request": true})
```

And cleaned up on the main repo side:

```
git worktree remove --force .claude/worktrees/dis-021b-reconcile
git branch -D feat/dis-021b-reconcile
```

One recurring surprise: shut-down teammates sometimes emitted one
last `idle_notification` after the shutdown call. These were
harmless. We ignored them silently. Documented as gotcha #6 in
`SESSION_HANDOVER_2026-04-20.md §13` and re-confirmed in
`SESSION_HANDOVER_2026-04-21_WaveB.md §8.4`.

### Why it worked for us

Wave B on 2026-04-21 ran two parallel teammates
(`dev-021b-reconcile`, `dev-050a-datalab-hotfix`) under the
persistent-team model with zero cross-contamination and zero leaks
(`SESSION_HANDOVER_2026-04-21_WaveB.md §8.1`). Earlier, when we
leaned on individual subagents, continuity between tickets was lost
and roughly 30% of wall-clock went to re-orientation. The 3-ticket
cap came from a late-Wave-2 incident where a teammate on its fourth
ticket produced a paraphrased VERIFY block; the orchestrator caught
it at Gate 5 re-sampling because the teammate had not actually run
the command.

---

## §A2. Windows parallel-agents v3 protocol

### Why we pre-created worktrees instead of using `isolation: "worktree"`

Claude Code's `Agent(isolation="worktree")` parameter is broken on
Windows. The harness creates the worktree directory but does not
rewrite the sub-agent's `<env>Working directory:</env>` context
line. The agent reads that stale line, derives paths from it, and
silently writes to main. The issues are documented in
`.claude/skills/windows-parallel-agents/SKILL.md` with scenario and
outcome for each:

| Issue | Scenario | Outcome |
| ----- | -------- | ------- |
| #40164 | `isolation: "worktree"` on Windows 11 | Path-resolution mismatch; silent fallback to main |
| #39886 | `isolation: "worktree"` alone | Worktree never created; agent runs in main |
| #37549 | `isolation: "worktree"` + `team_name` | Silent failure; agent runs in main |
| #33045 | Same, different repro | Same outcome |
| #41010 | Sub-agent ID collides with parent worktree name | Cleanup deletes parent's working dir — data loss |
| #39680 | `.claude/worktrees/` already exists | EEXIST on Linux/macOS |
| #34645 | Multiple parallel subagents creating worktrees | `git config` lock contention |

Given this, we pre-created worktrees manually before dispatch:

```bash
git worktree add .claude/worktrees/<stable-id> -b feat/<stable-id>
```

We used stable backlog-linked IDs (e.g., `dis-021b-reconcile`), not
random UUIDs, which also sidestepped issue #41010 (sub-agent IDs
colliding with parent worktree names).

### Pre-installing shared deps in one orchestrator commit

When a wave needed new npm dependencies, the orchestrator installed
them in one commit on main **before** dispatching teammates:

```bash
cd apps/web && npm install <runtime-deps>
cd ../.. && npm install -D <dev-tools> --ignore-workspaces
git add package.json package-lock.json apps/web/package.json
HUSKY=0 git commit -m "chore(wave-N): pre-install Wave N dependencies"
```

Teammates then never touched `package.json` or `package-lock.json`.
When two early-sprint teammates both tried to add deps in parallel,
the resulting lockfile conflict cost about 20 minutes to reconcile —
installing up front eliminated that class entirely. See
`.claude/skills/windows-parallel-agents/orchestrator-flow.md §1`.

### The v3 hardened prompt prefix

Every parallel-agent dispatch began with the prefix from
`.claude/skills/windows-parallel-agents/prompt-template.md`. Six
placeholders had to be substituted before sending:

| Placeholder                     | Meaning                               | Example                                              |
| ------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| `<WORKTREE_PATH>`               | Windows-style absolute path           | `E:\repo\.claude\worktrees\b123-flags`               |
| `<WORKTREE_PATH_FORWARD_SLASH>` | Forward-slash form                    | `E:/repo/.claude/worktrees/b123-flags`               |
| `<WORKTREE_NAME>`               | Final path component                  | `b123-flags`                                         |
| `<MAIN_REPO_PATH_FORWARD_SLASH>` | Main repo root, forward slash         | `E:/repo`                                            |
| `<BRANCH_NAME>`                 | Branch                                | `feat/b123-flags`                                    |
| `<COMMIT_MESSAGE>`              | Full mandatory final commit message   | `feat(B-123): add flags`                             |

The prefix enforced, in order:

1. **Re-anchor statement.** The teammate stated verbatim in its
   first response (before any tool call): *"My working directory
   is `<WORKTREE_PATH>`. The env hint is stale. I will ignore it
   and use `<WORKTREE_PATH>` as the base for all file paths."* This
   was a chain-of-thought commitment; passive "ignore that line"
   instructions had been unreliable in v1 / v2.
2. **First-action verify.** `cd "<WORKTREE_PATH_FORWARD_SLASH>" && pwd
   && git rev-parse --show-toplevel && git branch --show-current` —
   all three outputs had to match, otherwise the teammate stopped.
3. **Write-path assertion.** Before any Write/Edit: `test "$(cd
   "<WORKTREE_PATH_FORWARD_SLASH>" && pwd)" = "$(pwd)" && echo OK ||
   echo MISMATCH`. MISMATCH = stop.
4. **Forbidden-paths block.** Absolute prohibition on writes to
   `**/.git/**`, to main outside the teammate's worktree, and to
   any sibling worktree.
5. **Pre-commit CWD sanity.** `[ "$(git rev-parse --show-toplevel)" =
   "<WORKTREE_PATH_FORWARD_SLASH>" ] && echo OK || (echo WRONG_REPO
   && exit 1)`.
6. **Commit-or-fail language.** Husky fallback allowed once: `HUSKY=0
   git commit`.
7. **Report format.** Re-anchor verbatim, first-action output,
   write-path result, files touched, sanity output, log oneline,
   toplevel, Verdict `WORKTREE RESPECTED` or `WORKTREE LEAKED —
   <details>`.

### Main-tree leak detection

While teammates ran, the orchestrator ran `git status --short` on
main periodically. A dirty main tree signalled a leak. On leak:

```bash
git stash push -u -m "WAVE-N-LEAK-QUARANTINE"
```

This yanked the leaked changes off main so subsequent teammates saw
a clean tree. After the wave finished, the stash was compared
against the suspect teammate's worktree diff; in every case we saw,
the stash was a partial version of what the teammate eventually
wrote correctly to its worktree, so we dropped the stash.

### Merge order per wave

We minimized conflicts by merging sequentially in this order:

1. Infrastructure-only branches (`.github/workflows/*`, runbook docs).
2. Pure-add new-file branches (no edits to existing files).
3. Config-edit branches (`eslint.config.*`, `next.config.*`, `tsconfig.json`).
4. Shared-file edit branches (`app/layout.tsx`, `package.json` scripts).

Using `git merge --no-ff --no-edit feat/<id>`. Between merges we ran
`npx tsc --noEmit` and the test suite. If format drifted we ran `npm
run format` and committed as `style(wave-N): prettier format pass`.

### Cleanup

```bash
for id in …; do
  git worktree remove --force .claude/worktrees/$id
  git branch -D feat/$id
done
git worktree list   # main only
```

On Windows, `git worktree remove --force` occasionally failed with
"Permission denied" — usually an npm-process file lock lingering.
Branch cleanup succeeded regardless and the directory was
gitignored. We treated this as safe noise. Documented in
`SESSION_HANDOVER_2026-04-20.md §13 gotcha 3` and reconfirmed in Wave
B.

### Why it worked for us

Sprint 002 Waves 1–2 lost several agents to Windows worktree bugs
before v1 of the skill was written. v2 closed most leaks but added
no protection against #41010 (sibling-worktree data loss). v3
research-hardened the prompt with re-anchor, write-path assertion,
forbidden-paths, and pre-commit sanity. Wave B of 2026-04-21 was the
first parallel dispatch under v3 — two teammates, zero leaks, zero
missed commits, confirmed in
`SESSION_HANDOVER_2026-04-21_WaveB.md §8.1`. Validation history is
recorded at the bottom of the skill file.

---

## §A3. Verify-Driven Ticketing (VDT)

### What every dispatchable ticket contained

Tickets followed the template at
`dis/document_ingestion_service/07_tickets/_ticket_template.md`. The
sections were:

- ID, Tags, Epic, Depends on, Blocks.
- TDD ref, Clinical-safety ref (CS-##), User-story ref.
- Estimated effort (S half-day, M 1-2 days, L 3-5 days).
- Description — 2-4 sentences of what, not how.
- **Files allowed (exhaustive)** — a YAML block.
- Files read-only — context the ticket may consult but not modify.
- **VERIFY blocks** — at least 3 numbered, copy-pasteable shell
  commands with literal expected output and a one-line pass
  criterion.
- **Out of scope (explicit, not silent)** — named items with reason.
- Test plan (unit / integration / clinical-acceptance).
- Gate checklist.

Acceptance criteria had to live inside VERIFY blocks. Prose criteria
did not count. If a criterion could not be reduced to a shell
command, we treated that as a signal the spec was not ready to
ticket. `verify_format.md` is the binding spec for this.

### Shape of a VERIFY block

```
VERIFY-1: <one-line description>
  Command:  <exact shell command, copy-pasteable>
  Expect:   <literal expected output OR /regex/>
  Pass if:  <one-line pass criterion>
```

Even trivial criteria got the triple. "Strict mode enabled in
tsconfig" became:

```
VERIFY-1: strict is true
  Command:  grep '"strict"' dis/tsconfig.json
  Expect:   "strict": true,
  Pass if:  grep exits 0 AND output contains the literal above
```

The rigor did not change for trivial cases — we just kept the form
identical so reviewer re-runs were mechanical.

### files_allowed as a cap

`files_allowed` was exhaustive. A teammate that needed a file outside
the list stopped and reported — they did not silently widen scope.
The orchestrator then decided:

- **Strict** — defer the out-of-scope work to a new ticket.
- **Widen** — amend `files_allowed` in the ticket file (recorded so
  it was auditable), dispatch the teammate to continue.
- **Split** — close the current ticket partial, open a successor
  ticket for the remainder.

Two exemplars of STOP-and-report in this project:

- `dis/handoffs/DIS-021c.md §1` — the teammate applied Fix 1, it
  surfaced 17 TypeScript errors in 8 files outside its
  `files_allowed`, it stopped, the orchestrator approved a split,
  Fix 1 deferred to DIS-021d.
- `dis/handoffs/DIS-002k.md` — same pattern applied by a
  documentation teammate when a citation required editing a file
  outside its scope.

Both were exactly the behavior the drift-prevention controls were
designed to elicit.

### VERIFY outputs pasted verbatim

The teammate ran every VERIFY command and pasted the *actual* output
(not paraphrased) into §9 of its handoff file. Reviewer re-ran a
sample at Gate 5. `verify_format.md §4` lists what did **not** count
as evidence:

- "Looks correct to me."
- "The code matches the spec."
- Paraphrased test output.
- "See the diff."
- Tests that exist but were not run.
- Tests run with `.only` or `.skip`.

### Why it worked for us

DIS-021b shipped with 10/10 VERIFY passing according to its handoff.
Post-merge, we ran a full vitest sanity and discovered the
DatabasePort contract had not propagated to the Supabase adapter —
DIS-021b had excluded those files from `tsconfig.json` to make `tsc
--noEmit` green, which hid the break from the ticket's VERIFY. See
`SESSION_HANDOVER_2026-04-21_WaveB.md §3.2`. Result: two extra
tickets (DIS-021c + DIS-021d). The lesson: VERIFY is only as honest
as the scope of the checks, and the orchestrator-side re-verification
sampling (Gate 5 — see §A4) is what guards against speculative
VERIFY output.

---

## §A4. Review gates (1 through 7)

Every ticket passed through the same sequence. We did not skip,
waive, or combine gates. From
`dis/document_ingestion_service/08_team/review_gates.md`:

| Gate | Name | Owner | Pass criterion (abbreviated) |
| ---- | ---- | ----- | ---------------------------- |
| 1 | Pre-start | Architect | Ticket has DIS-### ID, TDD ref, files_allowed, testable ACs, out-of-scope list, tags |
| 2 | Test-first | QA Agent + Architect | Failing test committed BEFORE impl, visible in `git log --oneline` as separate commit; skip only if `doc-only` |
| 3 | Implementation | (tracked) | Scope frozen to AC; no files outside `files_allowed`; commits `[DIS-###] <summary> — implements TDD §X.Y` |
| 4 | Automated checks | CI | Lint + Prettier + `tsc --noEmit` + full vitest + port validator + schema round-trip (if migration) + secret scan + OpenAPI valid |
| 5 | Code review | Agent or human | One `Approved`; reviewer re-runs 20% of VERIFY (100% for CS/integration/breaking); discrepancy = Gate 5 fail |
| 6a | Clinical-safety | Clinical Reviewer (human) | Written `CLINICAL APPROVED — <name>, <date>` in PR thread. No override |
| 6b | Integration | Integration Gatekeeper (user) | Written `INTEGRATION APPROVED — <name>, <date>` stating what is integrated. No override |
| 6c | Security | Security Reviewer | `/security-review` run, HIGH/CRITICAL resolved, secret scan clean |
| 6d | Breaking | Architect | ADR exists, consumers updated or tracked, `BREAKING APPROVED` |
| 7 | DoD | Author + reviewer | All ACs checked off with evidence; TDD/OpenAPI/runbook updated if changed; CHANGELOG entry; handoff file at `dis/handoffs/DIS-###.md` fully filled in |

Emergency override for Gates 6a and 6b did not exist. For truly
urgent situations we had `09_runbooks/incident_response.md`, which
has its own authority model and explicit post-hoc review. The
absolute-no-override clause was a conscious choice: pressured
sessions are exactly the population most likely to flip a
confirmation flag inappropriately, so we removed the flag.

### Test-first commit visible in git log

Before implementation landed, a separate commit with the failing
test existed on the branch. A reviewer could check `git log
--oneline main..feat/<branch>` and confirm the test commit preceded
the impl. DIS-050a, DIS-021b, and DIS-021d all shipped with this
shape — see the Wave B commit history in
`SESSION_HANDOVER_2026-04-21_WaveB.md §3`.

### 20% / 100% re-verification sampling

At Gate 5, the orchestrator re-ran a sample of VERIFY commands:

- Non-CS tickets: 20% (ceil, minimum 1) of VERIFY blocks.
- Clinical-safety, integration, or breaking tickets: 100%.

Any discrepancy between the teammate's pasted output and the
reviewer's re-run was a Gate 5 fail; PR re-opened with specific
commands cited. The orchestrator recorded which commands were
sampled in one PR comment before approving.

### Why it worked for us

Clinical safety is not an abstraction in this project — pediatric
OPD dosing is the domain, patient harm is the worst-case outcome.
CS-1..CS-12 were enumerated in `01_product/clinical_safety.md`
before any architecture was chosen, precisely so every downstream
ticket had to trace to one. Wave B held DIS-021b and DIS-021d at
Gate 6a until the user wrote `CLINICAL APPROVED` in chat; both
merges waited. The absolute-no-override clause is what made that
real, rather than advisory.

---

## §A5. Commit & PR discipline

### Conventional Commits with ticket scope

Every commit subject followed Conventional Commits with scope =
ticket ID:

- `feat(DIS-123): add new flag`
- `test(DIS-123): add failing test for CS-7`
- `docs(DIS-123): handoff + VERIFY report`
- `core+adapter+infra(DIS-021d): restore full typecheck surface`

When an agent authored the commit, we included a `Co-Authored-By:
Claude <noreply@anthropic.com>` trailer. See
`dis/document_ingestion_service/02_architecture/coding_standards.md`.

### One ticket = one branch = three commits minimum

A complete ticket produced at least:

1. **Test commit** — the failing test (Gate 2).
2. **Implementation commit** — makes the test pass.
3. **Handoff commit** — `dis/handoffs/DIS-###.md` with 11 sections
   + VERIFY report (Gate 7).

Merged squash-and-merge for feature tickets; rebase-and-merge for
migrations (one commit per migration); or `--no-ff` when the branch
was short-lived and preserving the merge topology helped the wave
narrative. Wave B's merges are the canonical example —
`SESSION_HANDOVER_2026-04-21_WaveB.md §3`.

### Branch protection

`main` and `feat/dis-plan` were protected — no force push, no direct
commits. Only the Architect merged to `feat/dis-plan`. Agent
branches (`feat/dis-###-<slug>`) were disposable and deleted
post-merge.

We never used `--no-verify` and never force-pushed. The one
exception to verify-bypass behavior was the `HUSKY=0 git commit`
fallback from the v3 prompt prefix: permitted once per ticket, only
when the hook failure was unrelated to the agent's changes. Hook
failures that stemmed from the agent's changes got fixed, not
bypassed.

### Merge order within a wave

From `.claude/skills/windows-parallel-agents/orchestrator-flow.md §6`:

1. Infra/doc-only branches first (lowest conflict risk).
2. Pure-add new-file branches next.
3. Config-edit branches (tsconfig, eslint, etc.).
4. Shared-file edits last (layout files, package.json scripts) —
   git auto-merges different sections reliably, but if both
   teammates added lines near each other, a manual combine took 30
   seconds.

### Why it worked for us

Conventional Commits with ticket scope made `git log --oneline
main..HEAD` readable as a project narrative and made release-note
generation trivial. The three-commit minimum was not ceremony: the
test commit locked in Gate 2; the impl commit was the unit of
review; the handoff commit was Gate 7 evidence. Wave B's merges
preserved this shape across all four tickets. The merge-order
convention came from Sprint 002 Wave 2 where two parallel agents
editing the same `package.json` section produced the 20-minute
conflict that motivated the pre-install pattern in §A2.

---

## §A6. Session handoffs

Three levels, each with a distinct purpose and template.

### Ticket-level handoff

File: `dis/handoffs/DIS-###.md` on the teammate's branch. Last file
written before the final commit. Staged and committed alongside the
work. Missing handoff = Gate 7 fail.

Eleven sections (from `08_team/session_handoff.md §3`):

1. Metadata — agent, branch, worktree, date, duration, TDD refs,
   CS refs, user-story refs.
2. What was built — bullet list with absolute paths.
3. Acceptance criteria status — one line per AC with evidence
   (test name, commit SHA, log excerpt).
4. Decisions taken — non-obvious choices with context / options /
   decision / reason / revisit-if.
5. What was deliberately NOT done — scope kept out, with reason.
6. Follow-ups / known gaps — explicit new tickets to open.
7. Files touched — added / modified / deleted.
8. External dependencies introduced — "None" if none.
9. Tests — counts, coverage, flaky, snapshots.
10. Reproducing the work locally — exact commands.
11. Non-obvious gotchas — things that would trip up a future agent.

The Verify Report rendered inside §9 per `verify_format.md §2` in
some templates, or as its own top-level section in others. Either
layout passed the gate.

### Feature-level handoff

File: `dis/handoffs/sessions/FEATURE_HANDOFF.md`. Written by the
orchestrator when the feature completes. 14 sections: what the
feature delivers, AC against product-brief success criteria,
architecture snapshot, ADR list, safety posture, ops posture,
integration hand-off, what's NOT done, next-phase roadmap, known
tech debt, reproducing the full build, secrets checklist, training
status, thanks/credits.

### Session-level handover

File: `dis/handoffs/sessions/SESSION_HANDOVER_<date>_<wave>.md`.
Written by the orchestrator at the end of each working session.
Captures: session metadata, what the wave delivered (per-ticket),
what was deliberately NOT done, outstanding issues, next-wave
dispatch plan (held until user go-ahead), binding rules reaffirmed,
gotchas observed this session, verification invariants at session
end, sign-off.

Exemplars:

- `dis/handoffs/sessions/SESSION_HANDOVER_2026-04-20.md` — initial
  build session, §13 is the lived-experience gotchas list.
- `dis/handoffs/sessions/SESSION_HANDOVER_2026-04-21.md` — Wave A.
- `dis/handoffs/sessions/SESSION_HANDOVER_2026-04-21_WaveB.md` —
  Wave B closeout with gotchas in §8.

### Why it worked for us

Agent sessions end and their working memory evaporates. Without
handoffs, the orchestrator had to re-read the diff to understand
what was done; mid-ticket decisions ("I chose Vitest over Jest
because…") vanished; follow-up work got rediscovered painfully by
the next agent; reviewers couldn't tell whether ACs were interpreted
correctly. `SESSION_HANDOVER_2026-04-20.md §13` lists 12 gotchas the
next session needs to know at startup — without that file, a fresh
orchestrator would repeat each at least once. Handoff authorship ran
~5 minutes and saved roughly 1 hour of re-discovery in the next
session.

---

## §A7. Mid-flight course correction via SendMessage

### When we messaged instead of respawning

A running teammate could be nudged mid-task without killing the
session. We used SendMessage when:

- VERIFY was close to passing and a command needed a small tweak.
- A decision became clearer and we wanted to steer the teammate.
- A new constraint emerged (e.g., a sibling ticket merged and
  changed an interface).

The payload was plain text with direction + rationale + updated
VERIFY steps:

```
SendMessage(
  to="dev-021c-regression-fix",
  payload="""
    Option B approved: split the ticket.
    - Land Fix 2 (vitest.config) and Fix 3 (cwd-independent DOCS).
    - Revert Fix 1 via `git checkout HEAD -- dis/tsconfig.json`.
    - Update VERIFY: trim V1-V3 (Fix 1 scope removed), keep V4-V10.
    - Record the scope change in handoff §4.
  """
)
```

We avoided asking the teammate to reason about the change — we told
it what to do and why. Teammates executed; the orchestrator decided.

### When a teammate STOP-reported

When a teammate stopped because work went out of `files_allowed`,
the orchestrator chose strict / widen / split (see §A3) and
recorded the decision in the ticket backlog — not as an unspoken
SendMessage. DIS-021c went "split"; DIS-002k went "widen" with a
recorded amendment. Scope boundary stayed auditable either way.

### When we shut down instead

We switched to shutdown+respawn when:

- The teammate's context was clearly saturated (tool calls
  repeating, paraphrasing its own outputs).
- The task brief was wrong at the foundation — a patch was more
  confusing than a fresh start.
- The teammate was stuck in a retry loop (usually visible via the
  health-check cron — see §A10).

### Why it worked for us

DIS-002k was one of several documentation tickets where the teammate
discovered mid-way that a citation required reading a file outside
its `files_allowed`. A SendMessage amendment with an explicit widen
took ~30 seconds; a shutdown+respawn would have cost ~15 minutes
of re-orientation. DIS-021c went the other way — the scope
expansion was too big to swallow, so we split. Both are captured in
their handoff files. The pattern — STOP-and-report by teammate,
explicit decision by orchestrator, recorded in the ticket — is what
made the scope boundary auditable without being adversarial.

---

## §A8. Drift prevention

From `dis/document_ingestion_service/02_architecture/drift_prevention.md`,
11 controls across two phases. Phase 1 ran on every PR during DIS.
Phase 2 is defined but staged.

### Phase 1 (active) — five controls on every PR

| # | Control | What it prevents | How it ran |
| - | ------- | ---------------- | ---------- |
| 1 | PR source-of-truth citation check | Spec drift | `check-pr-citations.mjs` reads PR body for `implements TDD §X.Y`, `CS-##`; each citation must resolve to a real section |
| 2 | Files-touched allowlist | Scope drift | `check-files-touched.mjs` reads `files_allowed:` frontmatter, diffs `git diff --name-only`, fails on extras |
| 3 | Architectural fitness functions | Architectural drift | `fitness.mjs` walks `dis/src/**`: core cannot import adapters, ports cannot import core, no raw SQL in core, no `fetch()` in core, only adapters import Supabase SDK |
| 7 | Dead-code / TODO detector | Quality drift | `check-forbidden-tokens.mjs` greps `dis/src/**` (excluding tests) for `TODO`, `FIXME`, `XXX`, `HACK`, `console.log`, `debugger`, `.only`, `.skip`. Allow-annotation `// lint-allow: TODO — ticket DIS-999` |
| 10 | Orchestrator re-verification sampling | All four (safety-net) | Orchestrator re-runs 20% of VERIFY (100% for CS/integration/breaking) at Gate 5 |

### Phase 2 (staged) — six controls

| # | Control | What it would prevent |
| - | ------- | --------------------- |
| 4 | Spec hash locking | Mid-feature TDD edits |
| 5 | Anti-regression baselines (coverage, p95, test count) | Quality drift over time |
| 6 | Forbidden commit-message tokens (`probably`, `temporarily`, `quick fix`) | Hedge language hiding deferred work |
| 8 | Prompt version stamping (content-addressed prompts; adapters emit SHA) | Silent LLM prompt drift |
| 9 | ADR-gated decisions (`// reason:` comments must cite ADR-###) | Free-pass escape hatches |
| 11 | Handoff diff audit (compare handoff §6 Files touched to `git diff`) | Unmentioned file changes |

### The live invariants

Across every commit on `feat/dis-plan`, three invariants held:

```
npx tsc --noEmit           # exit 0 over the full tree
cd dis && npx vitest run   # all tests passing
node dis/scripts/fitness.mjs   # 0 violations
```

DIS-021d was dispatched specifically to restore these invariants
after DIS-021b's aggressive `tsconfig.json` excludes broke them.
See `SESSION_HANDOVER_2026-04-21_WaveB.md §5`.

### Failure-mode library — which control catches which mistake

From `drift_prevention.md §6`:

| Failure mode | Caught by |
| ------------ | --------- |
| Agent silently widens `any` escape hatch | Fitness (C3) |
| Agent commits `.only` on a test | Forbidden tokens (C7) |
| Agent pastes speculative VERIFY output | Re-verification sampling (C10) |
| Agent edits TDD mid-feature to match impl | **Phase 2 C4** |
| Agent "while I was here" refactors unrelated module | Files-allowed (C2) |
| Core imports an adapter for a type-only reason | Fitness (C3) |
| Agent leaves `TODO: handle error` in clinical-safety path | Forbidden tokens (C7) |
| Agent claims `implements TDD §9.2` but §9.2 doesn't exist | Citation check (C1) |
| Agent lowers a test assertion to make it pass | **None — human review only** |
| Agent adds a new port method with no ADR, no version bump | Fitness (C3) + Phase 2 C9 |
| Agent regresses p95 latency by 25% | **Phase 2 C5** |
| Agent writes correct-looking code that is subtly semantically wrong | **None — tests + human** |

### Why it worked for us

Drift was not hypothetical. DIS-021b silently introduced aggressive
`tsconfig.json` excludes that hid a real contract break from `tsc
--noEmit`; fitness.mjs caught 0 violations (excluded files didn't
run through fitness), but the post-merge full-suite vitest run
caught the break — only because the orchestrator ran it. Phase 1
Controls 3 (fitness) and 10 (re-verification sampling) are the two
that would have prevented the need for DIS-021c + DIS-021d
altogether, had they been applied aggressively enough. The lesson
was folded into gotcha #3 of `SESSION_HANDOVER_2026-04-21_WaveB.md
§8`: aggressive tsconfig excludes are a smell, not a fix.

---

## §A9. Durable orientation packages

### The six-report orientation

`dis/handoffs/orientation/` holds durable reports that orient a
fresh orchestrator session in ~45-60 minutes without re-reading the
~377 plan documents. Each report has frontmatter:

```yaml
---
last_refreshed: 2026-MM-DD
source_commit: <SHA>
source_paths:
  - dis/document_ingestion_service/02_architecture/
covered_files:
  - tdd.md
  - adapters.md
  - coding_standards.md
---
```

The six reports (per `dis/handoffs/orientation/README.md`):

1. `01-overview-product.md` — north-star, non-goals, product brief,
   user stories, clinical safety.
2. `02-architecture.md` — TDD, ADRs, adapters, portability, coding
   standards.
3. `03-data-api.md` — data model, migrations, OpenAPI, error model.
4. `04-rollout-runbooks.md` — feature flags, kill switch, rollout
   plan, runbooks.
5. `05-tickets-handoffs.md` — ticket board, epics, done list,
   session handovers.
6. `06-code-reality-audit.md` — what the code actually is vs. what
   the docs say it should be.

### The refresh protocol

From `dis/handoffs/orientation/_meta/refresh-protocol.md`. Five
steps:

1. Read the six reports first. They explain what's current and
   what the known drift is. Re-reading source without this map
   wastes time.
2. For each report, compute the diff: `git log --name-only
   <source_commit>..HEAD -- <source_paths>`. Empty → report
   current. Not empty → read only the delta files.
3. Update the report in place. Locate the section the changed file
   informs; edit tables, findings, and subsections. Append one
   line to `## What changed since last refresh`. Bump frontmatter
   `last_refreshed` + `source_commit`.
4. Update the README if findings changed.
5. Commit: `docs(dis): refresh orientation — <report-ids>
   (<YYYY-MM-DD>)` with source commit range + per-report-updated
   summary.

Append-only was forbidden: we never created
`orientation/refresh-2026-05-*.md` as a new file when sources
changed. Refresh = edit in place. The one exception was
`dis/handoffs/sessions/SESSION_HANDOVER_*.md` — session handovers
*are* append-only and belong under `sessions/`, not `orientation/`.

### When a report needed re-dispatch

Two scenarios (from `refresh-protocol.md`):

- The diff had touched > ~50% of the report's `covered_files` — an
  incremental patch cost more than a fresh write.
- A new top-level slice emerged under
  `dis/document_ingestion_service/` (e.g., `12_compliance/`) that
  warranted its own `07-<slug>.md` report.

Both were rare. The default refresh was a single-session in-place
edit.

### Why it worked for us

At each session start, the orchestrator faced a choice: read 377
plan documents (saturates context in 30-60k tokens just for the
reading, then useful orientation starts) or read six reports +
`CLAUDE.md` + the most recent `SESSION_HANDOVER` (~15k tokens,
oriented in 45 minutes). The six-report package was the cheap path.
Without the refresh protocol, the reports would go stale silently
and the orchestrator would start trusting them while they lied;
with the protocol, every session began with a one-command check per
report.

---

## §A10. Cron-driven health checks

### The 15-minute pulse

A recurring `CronCreate` job ran every 15 minutes during a wave:

```
CronCreate(
  schedule="7,22,37,52 * * * *",
  prompt="""
    Check team health.
    1. Run `git status --short` on main.
    2. Run `git worktree list`.
    3. For each teammate, check branch commits since last pulse.
    If any teammate has >30 min since last commit: SendMessage a status poke.
    If still stuck after poke: shutdown_request + re-dispatch.
  """
)
```

We avoided the `:00` and `:30` marks. The global Claude API fleet
sees usage spikes at those times and our 429 rate clustered with it;
picking off-minutes like `7,22,37,52` gave us cleaner behavior.

### What the cron caught

- Silent-commit teammates (idle-notification didn't fire but the
  branch had commits). The orchestrator marked the task completed
  even though the teammate didn't return.
- Stuck teammates (no commits 30+ min after dispatch). Usually a
  read-loop or retry spiral. Status poke first; if still stuck,
  shutdown + respawn with a tightened brief.
- Leaked-to-main teammates (`git status --short` on main dirty).
  Stash immediately; investigate after the wave.

### Session-only

The cron is session-scoped. It dies when the orchestrator session
ends. We re-created it at the start of each session before
dispatching any wave. Documented as gotcha #12 in
`SESSION_HANDOVER_2026-04-20.md §13` and referenced in Wave B where
the health-check cron `61da4758` was explicitly noted as
session-only.

### Why it worked for us

In Sprint 002 Wave 2, a teammate completed its work, committed, and
went idle. Its idle-notification never arrived (dropped packet, lost
websocket, unknown). The orchestrator spent 40 minutes assuming the
teammate was still working before checking `git log`. With a 15-min
health cron, that gap shrinks to 15 minutes worst-case and the
orchestrator has a reliable rhythm of inspection. The
avoid-round-minutes habit came from noticing 429s cluster at :00
and :30 during high-usage sessions.

---

## §A11. Task-list conventions

### When we created a TaskList

We used `TaskCreate` for waves with ≥3 discrete tickets. Not for a
single trivial task. Items were tickets; the owner field was a
teammate name; status moved `pending → in_progress → completed`.

### Owner discipline

When a teammate shut down, we cleared the `owner` field on any
tasks it held. The auto-dispatcher otherwise re-poked the idle
teammate repeatedly — a real nuisance we observed in early DIS
sessions, where the same teammate got four identical pokes in a row
because its owner assignment outlived its shutdown.

### Completion discipline

Tasks marked `completed` immediately on work done — never batched.
"Done" meant: branch merged, worktree removed, branch deleted,
teammate shut down, handoff filed.

Idle ≠ done. We confirmed via `git log <branch>` + `ls
dis/handoffs/DIS-###.md` before marking complete. See
`SESSION_HANDOVER_2026-04-20.md §13 gotcha 2`.

### When we skipped TaskCreate

Single-file documentation work. One-off refactors. Anything where
the orchestrator was both author and reviewer and the work was <30
min. TaskCreate was overhead when the work was shorter than the
tracking ceremony.

### Why it worked for us

Clearing the owner post-shutdown made the auto-dispatcher poking
problem go away. The idle≠done gotcha fired in Wave 2 when a
teammate committed silently and the orchestrator trusted the
idle_notification alone; after that we always verified with `git
log`.

---

## §A12. Anti-patterns we lived through

Each row is a concrete failure in this project and the specific
remediation it drove. Not theoretical — every entry has a citation.

| # | Anti-pattern | Remediation | Evidence |
| - | ------------ | ----------- | -------- |
| 1 | Agent writes to main instead of worktree | v3 re-anchor statement + write-path assertion (first tool call) | `.claude/skills/windows-parallel-agents/prompt-template.md §re-anchor` |
| 2 | Agent leaves work uncommitted | Commit-or-fail language in prompt; husky fallback allowed once | `prompt-template.md §mandatory-final-steps` |
| 3 | Sibling-worktree contamination (#41010 class) | Explicit forbidden-paths block: never write to `.claude/worktrees/<other>/**` | `prompt-template.md §forbidden-paths` |
| 4 | Aggressive tsconfig excludes to hide errors | DIS-021b did this; DIS-021d reconciled. Lesson: fix errors, don't exclude | `SESSION_HANDOVER_2026-04-21_WaveB.md §8 gotcha 3` |
| 5 | Vitest auto-discovery picks up non-test dirs | Explicit `dis/vitest.config.ts` pinning `test.include` | `SESSION_HANDOVER_2026-04-21_WaveB.md §8 gotcha 7`, DIS-021c Fix 2 |
| 6 | cwd-dependent scripts break from sub-dirs | `fileURLToPath(import.meta.url)` + `dirname` for path resolution | DIS-021c Fix 3; `dis/handoffs/DIS-021c.md §3` |
| 7 | Stale `<env>Working directory:</env>` defeats prompt isolation | v3 mandatory re-anchor statement (verbal chain-of-thought commit) | `prompt-template.md §why-v3` |
| 8 | Task-list auto-dispatcher poking already-assigned teammates | Clear owner field on shutdown | §A11 Owner discipline |
| 9 | Scope drift when VERIFY fails | STOP-and-report, not silent widening | DIS-021c §1; DIS-002k |
| 10 | package.json conflicts across parallel waves | Orchestrator pre-install commit | `orchestrator-flow.md §1` |
| 11 | Late idle notifications from shut-down teammates | Ignore silently | `SESSION_HANDOVER_2026-04-20.md §13 gotcha 6` |
| 12 | Untouched stale references after file moves | Explicit follow-up ticket; full-path rewrite rule | Session handovers §Follow-ups; orientation refresh protocol |
| 13 | Teammate `name` without `team_name` = subagent, not teammate | Always use the teammate form | `SESSION_HANDOVER_2026-04-20.md §13 gotcha 5` |
| 14 | JSONL transcript fed to Read/Agent in one shot | Never — use grep/head/tail/jq filters | `SESSION_HANDOVER_2026-04-20.md §13 gotcha 7` |
| 15 | Cron does not survive session restart | Re-create at each session start | §A10 Session-only |
| 16 | Node 24 vs Node 20 `@types/node` drift (BodyInit) | Buffer → Uint8Array at fetch boundary | DIS-021d RC-B; `SESSION_HANDOVER_2026-04-21_WaveB.md §8 gotcha 6` |
| 17 | Speculative VERIFY output (never ran the command) | Gate 5 re-verification sampling (Control 10) | `drift_prevention.md §6 F3` |
| 18 | TDD §X.Y citation to a section that doesn't exist | PR citation check (Control 1) | `drift_prevention.md §6 F8` |
| 19 | Windows `git worktree remove --force` "Permission denied" | Safe to ignore — branch cleanup still succeeds | `SESSION_HANDOVER_2026-04-20.md §13 gotcha 3` |
| 20 | CRLF breaks `$`-anchored regex in forbidden-tokens | `.replace(/\r\n/g, '\n')` before split | `drift_prevention.md §3 Control 7 Windows note` |

### Why this table exists

Every entry is a wound. The remediation column is the scab — once
scabbed, it became a rule in the prompt, the skill, or the
protocol. A future session that hits one of these and doesn't
recognize it will re-incur the cost. A future session that reads
this table first will not.

---

## §A13. When to delegate vs. do-it-yourself

### When delegation worked

Our delegations landed cleanly when the work had:

- ≥2 independent slices, each specifiable without forward
  references.
- ≥20 minutes of estimated work per slice — below that, the
  dispatch overhead ate the gain.
- File-surface disjoint — no two slices touched the same file.
- Well-specified — ACs testable, VERIFY commands written, the
  teammate wouldn't need clarifying questions.

Examples that delegated cleanly: DIS-020 state machine,
DIS-021 orchestrator, DIS-022 confidence policy, DIS-023
promotion service, DIS-024 audit log — each ran on its own
teammate with disjoint file surfaces, all five landed in one Wave
2 pass (`SESSION_HANDOVER_2026-04-20.md §2`).

### When we kept work on the orchestrator

Synthesis work stayed with the orchestrator. This included:

- Writing the TDD.
- Drafting ADRs.
- Composing the feature handoff.

These required holding the whole feature picture simultaneously;
delegating them produced plausible-looking drafts that lacked
cross-cutting coherence. We tried delegating TDD authorship once
early — the result was 40% longer, 20% more internally inconsistent,
and missed two cross-cutting constraints (portability + clinical
safety). The orchestrator re-wrote it from scratch.

Also kept on the orchestrator:

- Judgment calls affecting ADRs — teammates executed ADRs, didn't
  write them.
- Cross-cutting refactors touching >~10 files — a narrow-brief
  teammate repeatedly asked clarifying questions or STOP-reported;
  the orchestrator did it in one pass.
- Security-boundary changes — RLS, auth, secrets handling. The
  orchestrator audited the diff personally.
- Work <20 min where the context was already loaded in the
  orchestrator's head.

### The load-bearing spine the orchestrator read personally

For DIS, these were files the orchestrator read itself. Teammates
summarized everything else:

- `dis/document_ingestion_service/00_overview/north_star.md`
- `dis/document_ingestion_service/00_overview/non_goals.md`
- `dis/document_ingestion_service/00_overview/glossary.md`
- `dis/document_ingestion_service/02_architecture/tdd.md`
- `dis/document_ingestion_service/02_architecture/adapters.md`
- `dis/document_ingestion_service/02_architecture/portability.md`
- `dis/document_ingestion_service/02_architecture/coding_standards.md`
- `dis/document_ingestion_service/08_team/agentic_dev_protocol.md`
- `dis/document_ingestion_service/08_team/session_handoff.md`
- The most recent `dis/handoffs/sessions/SESSION_HANDOVER_*.md`.

### Why it worked for us

Early DIS experience — the TDD delegation miss — showed us
delegation amplifies execution; synthesis stays with the
orchestrator. The 20-minute rule came from timing dispatch overhead
(prompt write, worktree create, handoff expect); below that
break-even, the orchestrator was faster doing it directly.

---

## §A14. How we adapted this to the DIS build — and how to port it

The shape above is portable, not tied to this codebase. When
starting a new feature or project, three steps in order covered
what we did:

### Step 1 — Write the plan folder before any code

Stand up a numbered plan folder at the root of the feature
(`<feature>/00_overview/`, `01_product/`, `02_architecture/`, …,
`11_session_transcripts/`). Populate at minimum:

- `00_overview/north_star.md` — what this feature is, in one page.
- `00_overview/non_goals.md` — explicit don'ts. Every piece of
  drift pressure you will face later is either covered by the
  non-goals list or uncovered by its absence.
- `00_overview/glossary.md` — house terms. Teammates and future
  orchestrators hit the same vocabulary.

The plan folder is the feature's durable memory. Skipping this
step means re-deriving it from commit history six months later,
badly.

### Step 2 — Author ADRs and the TDD before ticketing

A ticket references `implements TDD §X.Y`. If the TDD doesn't
exist, the ticket can't cite it, and the citation check (Control 1)
can't enforce it. Author the TDD with component list, state
machine, ports & adapters, error model, invariants. Write ADRs for
every non-trivial decision — cheap at decision time, priceless
later.

### Step 3 — Ticket in Verify-Driven format; dispatch in waves

Translate the TDD into tickets with `files_allowed`, ≥3 VERIFY
blocks, tags, explicit out-of-scope. Dispatch in waves (v3 parallel
protocol on Windows; simpler flows on Linux/macOS but the
verification discipline is identical). Refresh orientation as you
go — the point of the reports is that they're always current, not
that they're comprehensive.

Stop for user sign-off at integration gates (Gate 6b). Don't let
the orchestrator, even when certain, cross into live systems
without a written `INTEGRATION APPROVED` from the designated
gatekeeper.

---

# PART B — Unexercised practices worth adding next

> **Not exercised in this project.** The items in PART B are
> patterns we recognize as valuable but did not adopt during the
> DIS build. Include them in adoption decisions with the
> understanding that our advice here is theoretical, not empirical.
> We can describe what each pattern is, why it would fit, and what
> it would cost; we cannot vouch for the operational details from
> lived experience.

For each entry:

- **What it is** — one paragraph describing the pattern.
- **Why consider it here** — one paragraph on fit with what's
  already in PART A.
- **Cost to introduce** — one sentence on the rough integration
  effort.

---

## §B1. Mutation testing (Stryker for TypeScript)

**What it is.** Mutation testing runs your test suite against
automatically generated faulty variants ("mutants") of your
production code — for example, flipping a `<` to `<=`, negating a
boolean return, or removing a guard clause. If the test suite still
passes on a mutant, that mutant "survives", which means your tests
don't actually constrain the behavior they claim to. Stryker is the
best-known TypeScript implementation; mutation score (percent
mutants killed) becomes an additional CI-trackable metric alongside
line coverage.

**Why consider it here.** `dis/document_ingestion_service/08_team/agentic_dev_protocol.md`
marks "implementation-gap prevention (mutation / golden / property-
based)" as `P` (partial) at row 5.9. The failure mode it would
catch — "agent writes correct-looking code that is subtly
semantically wrong" — is the bottom-row "**None — tests + human**"
entry in the PART A §A8 failure-mode library. Mutation testing on
the policy layer (confidence policy, promotion service, state
machine) and on the clinical-safety guards would directly close
that gap for the code paths that most need it. It composes cleanly
with the existing fitness.mjs harness — another `dis/scripts/*.mjs`
with its own CI workflow.

**Cost to introduce.** Roughly one ticket of setup (Stryker
install, `stryker.conf.mjs`, restrict to `dis/src/core/` on the
first pass, CI workflow that fails if mutation score drops) plus
one ticket of tuning per module to get the signal-to-noise ratio
right. Expect noisy initial runs; the payoff is in the signal
*after* the tuning pass.

---

## §B2. Property-based testing (fast-check)

**What it is.** Property-based tests assert *invariants* over a
large space of inputs generated randomly within a declared schema,
rather than asserting behavior on hand-picked examples. fast-check
is the TypeScript-native library. Example: "for any valid
confidence policy config and any input extraction, the policy
evaluation is idempotent" — fast-check generates thousands of
configs and extractions, shrinks any failing input to the minimal
reproducer, and reports it.

**Why consider it here.** Same `agentic_dev_protocol.md` row 5.9
flags this alongside mutation testing. The DIS state machine (CS-1),
confidence policy (CS-7), and promotion service (CS-10, CS-11) are
all pure functions with declarative invariants — property-based
tests fit naturally. They complement vitest: vitest proves the
happy path, fast-check explores the space.

**Cost to introduce.** Small. One ticket to add fast-check as a dev
dependency, a `tests/property/` subtree, and worked examples on
one pure module. Organic growth from there — each new pure module
gets a `.property.ts` companion as part of its original ticket.

---

## §B3. Prompt eval harness

**What it is.** A harness that runs a canonical set of "golden
prompts" through every prompt change, compares outputs against a
rubric (clinical accuracy, format conformance, refusal on unsafe
inputs), and fails the build if scores regress. Runs separately on
every model-version bump (Opus 4.7 → 4.8, for example) so silent
regressions on provider model updates are caught.

**Why consider it here.** `agentic_dev_protocol.md §8.9` lists this
as `N` (not yet). DIS depends on a Claude Haiku structuring call
and a Datalab Chandra OCR call. The structuring prompt is the
single highest-leverage surface in the feature; silent drift there
on a model upgrade would propagate directly to clinical outputs. A
prompt eval harness is specifically the countermeasure.

**Cost to introduce.** Moderate. Needs a curated prompt set (drawn
from §B4's fixture corpus once that exists), a rubric scorer
(either deterministic schema checks or a second LLM as judge with
bounded prompts), and CI wiring. Budget a full epic to set up
right — but the cost is front-loaded, not per-PR.

---

## §B4. Golden-file fixtures for OCR/LLM adapters

**What it is.** A corpus of 20+ anonymized real-shaped documents
(lab reports, discharge summaries, imaging reports) with declared
expected structured outputs. The extraction pipeline is run against
the corpus on every PR touching OCR or structuring code; diffs in
the output against the golden file fail the build.

**Why consider it here.** `dis/document_ingestion_service/05_testing/clinical_acceptance.md`
and `fixtures.md` describe the corpus. Row 6.4 of
`agentic_dev_protocol.md` marks it `P` — the plan exists, the
corpus doesn't. Without the corpus, rollout decisions rest on vibes
rather than numbers; with it, every adapter change has a measurable
quality delta. The corpus also doubles as the input set for §B3's
prompt eval harness.

**Cost to introduce.** Front-loaded and human-intensive: ~20 docs
to anonymize, structure, and verify with Dr. Goyal. After the
initial corpus, per-PR marginal cost is zero — the test just runs.
A red-team subset (adversarial fixtures, `agentic_dev_protocol.md`
row 6.5, currently `N`) should grow alongside.

---

## §B5. CI gate enforcement wired to GitHub Actions

**What it is.** All of the gate checks from PART A §A4 — lint,
typecheck, full vitest, fitness.mjs, citation check, files-touched
check, forbidden-tokens check, secret scan — running as required
GitHub Actions status checks on every PR. Gates documented but not
wired are guidance; gates wired to CI are enforced.

**Why consider it here.** `agentic_dev_protocol.md §6.7` marks CI
gate checks `P`. During DIS the orchestrator ran the checks
manually at Gate 4. That works while the orchestrator is attentive;
it doesn't scale to when multiple feature branches land in parallel
or when a human engineer is the reviewer. CI wiring converts human
vigilance into automation, which is the point of the whole
drift-prevention system.

**Cost to introduce.** One ticket per check to move it from
"documented workflow" to "`.github/workflows/<check>.yml`".
Coverage threshold is the one that needs care — set too tight and
you get false-positives on new-file PRs; set too loose and it
doesn't catch anything. Start looser and tighten once a baseline
lands.

---

## §B6. Schema migration round-trip in CI

**What it is.** For every migration that ships, CI spins up an
ephemeral Postgres (via a GitHub Actions service container or
`pg_tmp`), applies migrations forward to the target, runs `pg_dump
--schema-only`, rolls back via the down-migration, applies forward
again, and asserts the schema dump is bit-identical.

**Why consider it here.** `agentic_dev_protocol.md §6.8` marks this
`P` — migrations M-001..M-009 exist; the round-trip harness doesn't.
Migration bugs at Radhakishan's live Supabase are high-cost: live
patient data, RLS policies, foreign keys. A round-trip test catches
every class of "down migration doesn't actually undo the up
migration" bug at PR time instead of in production.

**Cost to introduce.** One ticket. GitHub Actions service containers
make the ephemeral DB trivial; the assertion is just `diff`. The
main cost is writing the down-migrations where we skipped them.

---

## §B7. MCP servers for long-lived context

**What it is.** Model Context Protocol (MCP) servers provide
persistent, structured context to Claude Code sessions that would
otherwise have to be re-derived each session. Supabase MCP
(schema/data queries), Playwright MCP (browser automation), and
GitHub MCP (PR state, issue tracking) are the most relevant here.
A session with the Supabase MCP connected can query schema and
tables directly rather than re-reading SQL files.

**Why consider it here.** DIS did not use MCP servers. Much of the
orientation cost (§A9 six-report refresh) is Claude re-reading
source files to re-derive context that a live MCP server would
provide on demand. For the Supabase-heavy surfaces (schema changes,
migration verification, data checks in support of clinical-safety
tickets), a connected Supabase MCP would cut context-load time
substantially.

**Cost to introduce.** Minimal per-server — `.mcp.json` plus
credentials in the user's settings. The real cost is the auditing:
what does the server expose, what can a misbehaving agent do with
it, and how does that interact with the clinical-safety boundary.
For DIS specifically: Supabase MCP in read-only mode with the
anon-key schema only, not the service-role key, is probably safe
enough for a first pass.

---

## §B8. Agent SDK direct API (outside Claude Code)

**What it is.** The Anthropic Agent SDK lets you reimplement the
orchestrator-teammate pattern outside Claude Code — programmatic
dispatch of Claude sessions via the SDK with tool-use loops and
explicit context management. The value is full control over
context windows, caching strategy, and tool affordances.

**Why consider it here.** Our entire DIS stack runs inside Claude
Code, which is excellent for interactive orchestration but
opinionated about tool exposure, memory handling, and session
shape. A future refactor that wanted to run DIS's wave loops
headlessly (e.g., a nightly auto-refresh of orientation reports, or
a scheduled regression of the prompt eval harness) would naturally
live on the Agent SDK side.

**Cost to introduce.** Substantial. It's a re-platforming, not a
feature addition. Worth considering only if a headless workflow
justifies it — probably post-§B3 (prompt eval) when there's a
concrete "this needs to run nightly without a human" case.

---

## §B9. Claude Code hooks (PreToolUse / PostToolUse / Stop / SessionStart)

**What it is.** Hooks are shell commands the harness runs on
specific lifecycle events. A PreToolUse hook fires before the agent
calls a specific tool; Stop fires when the agent finishes its turn;
SessionStart fires at the beginning of every session. Hooks can
block actions (return non-zero exit, print reason), annotate output,
or enforce invariants deterministically.

**Why consider it here.** Several v3 prompt-prefix assertions from
PART A §A2 are fundamentally hook-shaped: "before any Write, verify
write-path"; "before final commit, verify toplevel matches
worktree"; "at session start, re-read most recent SESSION_HANDOVER".
Prompt-based assertions depend on the agent reading and obeying the
prefix; hook-based assertions execute regardless. Hooks would be a
strictly stronger guard for the same invariants.

**Cost to introduce.** Per-hook, small — a shell script + a
`settings.json` entry. The audit cost is larger: hooks run with
user-level permissions, so each one is a trust-boundary decision.
Start with read-only hooks (PreToolUse logging, SessionStart
reminder) before moving to blocking hooks.

---

## §B10. Worktree hooks (WorktreeCreate / WorktreeRemove)

**What it is.** The skill file
`.claude/skills/windows-parallel-agents/SKILL.md §Future direction`
flags these as the endgame for the isolation protocol. A
`WorktreeCreate` hook would create the worktree, write the correct
absolute path into `.claude/current-worktree-path.txt`, and return
the path on stdout. The prompt prefix then becomes: "Read
`.claude/current-worktree-path.txt` as your first action; that is
your working directory." Path substitution stops being a manual
orchestrator chore.

**Why consider it here.** Exactly the class of "move validation out
of the prompt and into deterministic hooks" described in §B9. The
v3 prompt prefix works but is fragile — a new placeholder addition
touches the template, the orchestrator dispatch code, and every
active worktree. A hook-based approach centralizes it.

**Cost to introduce.** Moderate. The hook is maybe 20 lines of
bash. The infrastructure cost is the migration — every active
dispatch template simplifies, but in transition both paths must
work, and a bug in the hook silently breaks isolation the same way
a missing placeholder used to.

---

## PART B summary

Items in PART B cluster along three axes:

- **Verification strength** (§B1 mutation, §B2 property-based,
  §B4 golden fixtures, §B3 prompt eval) — patterns that raise the
  floor on "correct-looking code that is subtly wrong".
- **Enforcement strength** (§B5 CI gates, §B6 migration round-trip,
  §B9 Claude Code hooks, §B10 worktree hooks) — patterns that move
  rules from guidance to mechanical.
- **Architectural leverage** (§B7 MCP servers, §B8 Agent SDK) —
  patterns that change where and how the orchestrator runs.

Our judgment, if forced to pick a next-wave focus: §B5 (CI gate
enforcement) first — it converts everything in PART A §A4 from
human-enforced to CI-enforced, which is the highest-leverage
conversion available. §B4 (golden fixtures) second — unblocks §B3
and the clinical-acceptance story simultaneously. Everything else
opportunistically.

---

## Appendix A — Quick-reference of PART A patterns

Dense checklist for an orchestrator verifying they are following the
playbook on a given wave.

- §A1 Persistent named teammates; cap ~3 tickets/session; fresh teammates per wave; clear owner on shutdown.
- §A2 v3 prompt prefix with all 6 placeholders filled; pre-install deps in one orchestrator commit; pre-create worktrees under `.claude/worktrees/<stable-id>/`.
- §A3 Every ticket has `files_allowed` + ≥3 VERIFY blocks; no prose AC; STOP-and-report on scope miss.
- §A4 Test-first commit visible in `git log --oneline`; Gate 5 re-runs 20% of VERIFY (100% for CS); Gate 6a/6b absolute no-override.
- §A5 Conventional Commits with ticket scope; 3-commit min (test / impl / handoff); no force push.
- §A6 Ticket-level handoff at `dis/handoffs/DIS-###.md`; session-level at `dis/handoffs/sessions/SESSION_HANDOVER_<date>_<wave>.md`.
- §A7 Prefer SendMessage over respawn for in-flight tweaks; record scope amendments in the ticket.
- §A8 Phase 1 drift controls on every PR; invariants `tsc --noEmit exit 0`, all tests green, fitness 0 violations hold.
- §A9 Orientation reports with frontmatter; refresh = edit in place; append-only forbidden.
- §A10 15-min health-check cron, off-minutes (7/22/37/52); re-create every session.
- §A11 TaskList for ≥3-item waves only; idle ≠ done; mark completed immediately.
- §A12 Known anti-patterns table consulted when confused; new failures added with remediation.
- §A13 Delegate ≥2 disjoint slices of ≥20 min each; synthesis stays with orchestrator.
- §A14 Plan folder before code; ADR + TDD before ticketing; Verify-Driven tickets; stop at integration gates.

---

## Appendix B — Source pointers

Every claim in PART A has a source. The canonical sources live in
the main repo so this playbook stays thin.

- `.claude/skills/windows-parallel-agents/SKILL.md` — v3 isolation protocol.
- `.claude/skills/windows-parallel-agents/prompt-template.md` — hardened prompt prefix.
- `.claude/skills/windows-parallel-agents/orchestrator-flow.md` — end-to-end wave flow.
- `dis/document_ingestion_service/08_team/agentic_dev_protocol.md` — 9-phase end-to-end protocol with Y/P/N status.
- `dis/document_ingestion_service/08_team/session_handoff.md` — ticket-level + feature-level handoff templates.
- `dis/document_ingestion_service/08_team/review_gates.md` — Gates 1-7 with clinical/integration/security/breaking sub-gates.
- `dis/document_ingestion_service/08_team/RACI.md` — roles and responsibilities.
- `dis/document_ingestion_service/05_testing/verify_format.md` — Verify-Driven spec.
- `dis/document_ingestion_service/07_tickets/_ticket_template.md` — ticket template.
- `dis/document_ingestion_service/02_architecture/coding_standards.md` — commit/PR discipline.
- `dis/document_ingestion_service/02_architecture/drift_prevention.md` — 11 drift controls, Phase 1 + Phase 2.
- `dis/handoffs/orientation/_meta/refresh-protocol.md` — orientation refresh discipline.
- `dis/handoffs/sessions/SESSION_HANDOVER_2026-04-20.md` — initial build + §13 gotchas list.
- `dis/handoffs/sessions/SESSION_HANDOVER_2026-04-21.md` — Wave A closeout.
- `dis/handoffs/sessions/SESSION_HANDOVER_2026-04-21_WaveB.md` — Wave B closeout + §8 gotchas.
- `dis/handoffs/DIS-021c.md` — exemplary STOP-and-report.
- `dis/handoffs/DIS-002k.md` — same pattern on a doc ticket.
- `CLAUDE.md` §Agentic Team Management — repo-level summary.

---

*End of playbook. PART A edits in place when a new incident in this
project justifies a new rule — do not append dated refresh files.
PART B grows by adding entries as new patterns come into view; when
one graduates from aspirational to exercised, promote it to PART A
with a citation.*
