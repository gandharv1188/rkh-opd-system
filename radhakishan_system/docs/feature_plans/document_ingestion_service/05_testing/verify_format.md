# Verify Format — How Every Ticket Proves It Is Done

> Binding on every DIS ticket. The agent cannot claim completion
> without a Verify report that passes each step. Gate 7 (DoD) rejects
> any PR where the Verify report is missing, incomplete, or contains a
> failing step.

## §1. Why Verify

TDD proves the code behaves to tests. Verify proves the **ticket**
behaves to its **acceptance criteria** — with evidence a reviewer can
re-run. Tests are written by the agent; Verify is a transcript the
reviewer trusts.

Verify is **not a synonym for "tests pass"**. A ticket can have green
tests and still fail Verify (e.g., the test doesn't actually exercise
the acceptance criterion).

## §2. The shape of a Verify report

Per ticket, in the same `dis/handoffs/DIS-###.md` file as the session
handoff, a dedicated section:

```markdown
## Verify Report

### AC-1: <verbatim acceptance criterion text>

**Given** <starting state>
**When** <action>
**Then** <expected observable outcome>

**How verified:**

- Command: `<exact command the reviewer can re-run>`
- Expected output: `<literal expected output or a regex>`
- Actual output:
```

<paste of the actual output — do not paraphrase>

```
- Artifact: `<path to log, screenshot, test name, commit SHA>`

**Status:** PASS | FAIL | N/A (explain)

---

### AC-2: <...>

(same structure)
```

Every acceptance criterion from the ticket gets one block. No
criterion may be missing. No criterion may be marked PASS without all
three fields (Command, Expected, Actual) filled in.

## §3. What counts as evidence

- **Command evidence** — a shell command that can be re-run by the
  reviewer. Include the working directory (`cd dis/ && npm test …`).
- **Test evidence** — vitest test names with paths (`health.test.ts:42`).
- **Commit evidence** — commit SHA where the change is visible.
- **Log evidence** — excerpts of structured logs with correlation IDs.
- **Schema evidence** — `psql -c "\d+ table_name"` output, or migration
  up/down transcripts.
- **HTTP evidence** — `curl -i http://localhost:3000/health` with
  headers + body pasted.
- **Type evidence** — `npx tsc --noEmit` output (empty = pass).
- **Lint evidence** — `npm run lint` output.
- **Visual evidence** — screenshots for UI tickets, committed under
  `dis/handoffs/assets/DIS-###/…`.

## §4. What does NOT count as evidence

- "Looks correct to me."
- "The code matches the spec."
- Paraphrased test output.
- "See the diff."
- Tests that exist but were not actually run.
- Tests that were run with `.skip` or `.only`.

A Verify block that contains only prose and no command/output pair is
a Gate 7 failure.

## §5. Given/When/Then rigor

Every Verify block must be a testable triple:

- **Given** describes preconditions the reviewer can reproduce (fresh
  clone + `npm ci`, or a specific fixture, or a DB state).
- **When** is a single atomic action. Not "set up X and then do Y" —
  that's two Whens; split them.
- **Then** describes observable outcomes, not internal state unless
  the ticket is specifically about internal structure (schema, type
  signatures).

If the acceptance criterion is "strict mode enabled in tsconfig",
the Given/When/Then is:

> Given: `dis/tsconfig.json` from this branch.
> When: `grep '"strict"' dis/tsconfig.json`.
> Then: output contains `"strict": true`.

That is perfectly fine Verify. Trivial ACs stay trivial — Verify just
forces the triple and the literal evidence.

## §6. Handling N/A

If an acceptance criterion does not apply (e.g., a platform-specific
AC on a non-applicable platform), mark **N/A** and explain in one
sentence. An N/A without explanation = Gate 7 failure.

## §7. Verify for non-code tickets

Documentation-only tickets still need Verify. Evidence is:

- File exists at path X → `ls path`.
- Link target resolves → command that fetches it.
- Section is present in the doc → `grep "^## Section"`.

The rigor does not change.

## §8. Verify for clinical-safety tickets

Tickets tagged `clinical-safety` (CS-1..CS-12) have an **additional**
row in the Verify report:

- **Clinical evidence** — the fixture used, the assertion the clinician
  would make on review, the commit hash of the test.
- **Sign-off pending** — explicit "Awaiting Clinical Reviewer
  sign-off per `08_team/RACI.md`".

The ticket cannot merge until the clinician writes
`CLINICAL APPROVED` in the PR thread, referencing the Verify report.

## §9. Verify for integration-tagged tickets (held)

Tickets in `07_tickets/integration_hold.md` produce their Verify
reports in a **dry run** against the staging environment, not against
live production. Every Verify block must state:

> **Environment:** STAGING (project ID, RLS context)

before the evidence. A Verify report run against live production
without Gatekeeper approval = clinical-safety incident.

## §10. Verify workflow

1. Agent implements the ticket.
2. Agent writes the Verify report _by actually running each command_
   and pasting actual output. Not speculating.
3. Agent commits the Verify report as part of the final commit.
4. Reviewer re-runs a sample of the commands. Discrepancy with the
   pasted output = Gate 5 failure.

## §11. Minimal example (good)

```markdown
## Verify Report

### AC-1: `dis/package.json` declares "type": "module"

**Given** Fresh clone, branch `feat/dis-001-scaffold`, at repo root.
**When** `cat dis/package.json | grep '"type"'`.
**Then** output contains `"type": "module"`.

- Command: `cat dis/package.json | grep '"type"'`
- Expected output: `  "type": "module",`
- Actual output:
```

    "type": "module",

```
- Artifact: commit 4cabf87

**Status:** PASS
```

## §12. Minimal example (bad — will fail Gate 7)

```markdown
### AC-1: `dis/package.json` declares "type": "module"

Yes, it does. See the file.
**Status:** PASS
```

No Given/When/Then. No command. No output. No artifact. Rejected.

## §13. Enforcement

- PR template includes a "Verify report reviewed: YES/NO" checkbox.
- Gate 7 DoD checklist adds: `[ ] Verify report present, all ACs
PASS/N/A with evidence pasted.`
- Reviewer re-runs at least 20% of Verify commands before approving.
- Clinical-safety and integration tickets: reviewer re-runs 100%.

## §14. Retrofit for completed tickets

If a ticket was completed before Verify was introduced, the agent (or
the orchestrator on the agent's behalf) appends a retroactive Verify
report to the handoff file on that branch. Commit message:
`docs(DIS-###): retroactive Verify report`.
