# Review Gates

Every ticket passes through this exact sequence of gates. No gate may
be skipped, waived, or combined. Agents that bypass a gate have their
PR rejected automatically.

## The gate sequence

```
[1] Pre-start gate
  └── [2] Test-first gate
        └── [3] Implementation
              └── [4] Automated checks gate
                    └── [5] Code review gate
                          └── [6] Safety / integration / security gate (conditional)
                                └── [7] DoD gate
                                      └── Merge
```

Each gate has an explicit pass criterion, an owner, and an action on
failure.

---

## Gate 1 — Pre-start

**Purpose:** ensure the ticket is executable before an agent begins.

**Owner:** Architect (reviews on ticket creation)

**Pass criteria:**

- Ticket has a unique `DIS-###` ID.
- Ticket references the TDD section(s) it implements (e.g. `implements TDD §9.2`).
- Acceptance criteria are numbered and testable.
- Dependencies (if any) are listed by ticket ID AND are in `Done` status.
- "Out of scope" list is explicit.
- Tags applied (at least one of: `core`, `adapter`, `ui`, `migration`, `test`, `doc-only`; plus any special tag from `08_team/RACI.md`).

**Fail action:** ticket status flips to `Blocked — needs clarification`; Architect either updates the ticket or creates a clarification ticket.

---

## Gate 2 — Test-first

**Purpose:** enforce TDD. No implementation without a failing test.

**Owner:** QA Agent (proposes test); Architect (approves)

**Pass criteria:**

- A test file exists at the expected path (per `05_testing/`).
- The test contains at least one assertion tied to an acceptance criterion.
- Running the test locally **fails** with a predictable error (e.g. "not implemented", "undefined export").
- The failing test is committed on the ticket's branch before any implementation commit.

**Fail action:** implementation ticket status stays `Not Started`. Developer agent may not begin.

**Exception:** tickets tagged `doc-only` skip this gate. No implementation code, no tests required — but the doc change itself is reviewed via Gate 5.

---

## Gate 3 — Implementation

**Purpose:** actual work. Not a gate per se, but tracked for visibility.

**Rules during implementation:**

- Scope is frozen to the acceptance criteria. Any scope change requires a new ticket.
- No modifications to files outside the ticket's declared file list.
- Commit messages follow `[DIS-###] <summary> — implements TDD §X.Y` format.
- Tests from Gate 2 turn green incrementally; they do not get deleted or weakened.

---

## Gate 4 — Automated checks

**Purpose:** the machine-checkable must pass before humans look.

**Owner:** CI

**Pass criteria (all must be green):**

- Lint (ESLint + Prettier — no changes in format-check).
- Type-check (`tsc --noEmit`).
- Unit tests pass (100% of suite, not just this ticket's).
- Integration tests pass against sandbox adapters.
- Port validator passes: no `import` from `adapters/` inside `core/` or `ports/`.
- Schema round-trip test (if `migration` tag): up-down-up produces identical schema dump.
- Secret-scan clean (no keys in diff).
- OpenAPI schema is valid and unchanged (or changes are in a dedicated `api-change` ticket).

**Fail action:** PR marked draft; agent fixes and re-runs. No human review until green.

---

## Gate 5 — Code review

**Purpose:** an independent pair of eyes.

**Owner:** A second agent OR a human. Clinical-safety tickets require a human; see Gate 6.

**Pass criteria:**

- At least one `Approved` review by a non-author.
- All review comments addressed (either fixed or explicitly deferred to a follow-up ticket).
- Reviewer has verified: acceptance criteria met, tests cover the changes, documentation updated.

**Fail action:** PR remains open with `Changes Requested`. Author iterates.

---

## Gate 6 — Conditional gates (any that apply)

### 6a. Clinical-safety gate

**Triggered by:** tag `clinical-safety`. Applies to any ticket implementing CS-1..CS-12 or touching extraction-to-clinical promotion.

**Owner:** Clinical Reviewer (human clinician from `RACI.md`)

**Pass criteria:**

- Clinical Reviewer has written `CLINICAL APPROVED — <name>, <date>` in the PR thread.
- If edits were made after clinical review, re-approval is required.

**Fail action:** PR cannot merge. No override.

### 6b. Integration gate

**Triggered by:** tag `integration`. Applies to any ticket that:

- Modifies files under `web/`, or
- Modifies existing Edge Functions in `supabase/functions/` (including `process-document`), or
- Applies DIS migrations to the live Supabase database, or
- Adds any reference to DIS from existing registration / prescription-pad / generate-prescription flows.

**Owner:** Integration Gatekeeper (user — Dr. Lokender Goyal)

**Pass criteria:**

- Integration Gatekeeper has written `INTEGRATION APPROVED — <name>, <date>` in the PR thread.
- The approval explicitly states what is being integrated.

**Fail action:** PR cannot merge. No override. No integration ticket is auto-executable.

### 6c. Security gate

**Triggered by:** tag `security`. Applies to auth changes, secret handling, RLS policy changes, any network-boundary changes.

**Owner:** Security Reviewer

**Pass criteria:**

- Security Reviewer has run `/security-review` and resolved any HIGH/CRITICAL findings.
- CI secret-scan is clean.
- No credentials in logs, error messages, or commit history.

**Fail action:** PR cannot merge.

### 6d. Breaking-change gate

**Triggered by:** tag `breaking`. Applies to port interface changes, schema breaks, API contract breaks.

**Owner:** Architect

**Pass criteria:**

- An ADR exists in `02_architecture/adrs/NNNN-title.md`.
- All consumers are updated in the same PR OR are on a named follow-up ticket list.
- Architect has written `BREAKING APPROVED` in the PR thread.

---

## Gate 7 — Definition of Done

**Purpose:** final pre-merge checklist.

**Owner:** Author (self-check) + final reviewer (cross-check)

**Checklist:**

- [ ] All acceptance criteria checked off with evidence linked (test names, screenshots, log excerpts).
- [ ] TDD updated if architecture changed.
- [ ] OpenAPI updated if API changed.
- [ ] Runbook updated if operational surface changed.
- [ ] `ROADMAP.md` / ticket board updated with `Done`.
- [ ] No TODO / FIXME / `console.log` in production code paths.
- [ ] Changelog entry added (`dis/CHANGELOG.md`).
- [ ] Audit log entry added for migration tickets.

**Fail action:** PR reopened; author addresses gaps.

---

## Merge mechanics

- Merge method: **squash-and-merge** for feature tickets; **rebase-and-merge** for migrations (so each migration is one commit). No regular merges except between agent branches and `feat/dis-plan`/development branches (per `windows-parallel-agents` orchestrator flow).
- The Architect is the only role that can merge to the main integration branch.
- Branch naming: `feat/dis-<agent-id>` for agent work; `feat/dis-###-<slug>` for implementation tickets.

## Emergency override

There is **no emergency override** for Gates 6a (clinical-safety) or 6b
(integration). If the situation is truly urgent, escalate to SEV1 and
follow `09_runbooks/incident_response.md` — that path has its own
authority model and explicit post-hoc review requirement.
