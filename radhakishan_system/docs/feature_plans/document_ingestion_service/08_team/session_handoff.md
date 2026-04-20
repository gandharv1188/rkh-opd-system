# Session Handoff Protocol

> **Binding on every agent** (worker + orchestrator) finishing work on DIS.
> A handoff is the last thing an agent produces before returning to the
> orchestrator. The orchestrator produces a final, feature-level handoff
> when DIS v1 is complete.
>
> Purpose: a human or a future agent can resume cold — no context loss,
> no archaeological digging through commit history.

## §1. Why this exists

Agents run in isolated sessions. When one finishes, its working memory
vanishes. Without a structured handoff:

- The orchestrator has to re-read the diff to understand what was done.
- Decisions made mid-ticket ("I chose Vitest over Jest because…") evaporate.
- Follow-up work gets rediscovered painfully by the next agent.
- Reviewers can't tell whether acceptance criteria were interpreted
  correctly.

The handoff is a short, structured document saved with the branch.
The orchestrator links it into `07_tickets/done.md` at merge time.

## §2. Two levels of handoff

| Level             | Who writes it            | When                                    | Where it lives                                                                                   |
| ----------------- | ------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Ticket-level**  | Every worker agent       | End of each ticket, before final commit | `dis/handoffs/DIS-###.md` on the ticket's branch                                                 |
| **Feature-level** | Orchestrator (Architect) | When DIS v1 is merged                   | `radhakishan_system/docs/feature_plans/document_ingestion_service/10_handoff/FEATURE_HANDOFF.md` |

(Epic-level handoffs are optional — only required when an epic spans
multiple agent waves.)

## §3. Ticket-level handoff template

Every worker agent creates `dis/handoffs/DIS-###.md` on its branch as
the **last file written before the final commit**. File is staged and
committed with everything else. If missing, the PR does not pass Gate 7.

```markdown
# Handoff — DIS-### {one-line summary}

- **Agent:** {subagent-type or name; e.g. "general-purpose, Opus 4.7"}
- **Branch:** feat/dis-###-<slug>
- **Worktree:** .claude/worktrees/dis-###-<slug>
- **Date:** YYYY-MM-DD
- **Duration:** ~N minutes wall-clock
- **TDD refs implemented:** §X.Y, §A.B
- **CS refs (if any):** CS-##, CS-##
- **User story refs:** DIS-US-###

## 1. What was built

Bullet list of concrete deliverables with absolute paths.
Example:

- `dis/src/core/orchestrator.ts` — IngestionOrchestrator class
- `dis/tests/unit/orchestrator.test.ts` — 18 test cases covering CS-1, CS-4

## 2. Acceptance criteria status

One line per criterion, with evidence (test name, screenshot link, log excerpt, or commit SHA).

- [x] AC-1: ... → `orchestrator.test.ts:42`
- [x] AC-2: ... → commit abc123
- [ ] AC-3: not addressed — see §5 Follow-ups.

## 3. Decisions taken during implementation

Non-obvious choices the agent made, with reasoning. This is the most
important section — it captures knowledge that the diff alone cannot
convey.

Format:

### D-1: Chose X over Y

**Context:** why a choice was needed
**Options considered:** X, Y, Z
**Decision:** X
**Reason:** one or two sentences
**Revisit if:** condition that would invalidate the choice

## 4. What was deliberately NOT done

Scope kept out, with reason. Anything here that could become a surprise
for the next agent belongs on the follow-up list in §5.

## 5. Follow-ups / known gaps

Explicit new tickets to open. Each must say: what, why, suggested
ticket ID, suggested epic.

Format:

- DIS-### (suggested): short title — reason — urgency S/M/L

## 6. Files touched

Exhaustive list, not just the commit diff summary:

- Added: `...`
- Modified: `...`
- Deleted: `...` (if any)

## 7. External dependencies introduced

- New npm dep: name@version — why
- New environment variable: NAME — what it's for — where documented
- New SQL extension: name — confirmed available on both POC + prod

If none, write "None."

## 8. Tests

- Tests added: N unit, M integration, K e2e
- Coverage for this module: X% lines, Y% branches
- Known flaky tests introduced: name + why flaky
- Snapshot files added: paths (if any)

## 9. Reproducing the work locally

Exact commands that a reviewer can run to verify:
```

cd dis
npm ci
npm run typecheck
npm test -- orchestrator

```

If a special setup is needed (secrets, fixtures, migrations), list it
here. Assume the reviewer has only the branch checked out.

## 10. Non-obvious gotchas

Things that would trip up a future agent resuming this work.
Example: "vitest must be run with --pool=threads because the pg client
leaks sockets on --pool=forks."

## 11. Verdict

One line. "Complete, ready for review" OR "Partial — see §5" OR
"Blocked — see §5".
```

## §4. Feature-level handoff template

Orchestrator writes this at the end of DIS v1. Stored at:
`radhakishan_system/docs/feature_plans/document_ingestion_service/10_handoff/FEATURE_HANDOFF.md`

```markdown
# DIS v1 — Feature Handoff

- **Orchestrator:** Claude (Architect / Tech Lead / QA Lead)
- **Feature branch:** feat/dis-plan → integration branch → main
- **PR chain:** #1 plan, #N integration, #M cutover
- **Duration:** YYYY-MM-DD start → YYYY-MM-DD default rollout
- **Status:** v1 complete, Epic G awaiting integration gate

## 1. What DIS v1 delivers

3-5 sentence summary that reads well to a new engineer.

## 2. Acceptance against product brief success criteria

One row per success criterion from `01_product/product_brief.md`.

| #   | Criterion | Target | Actual | Pass/Fail |
| --- | --------- | ------ | ------ | --------- |

## 3. Architecture snapshot

A compact diagram + a list of ports and their adapters. Points to
`02_architecture/tdd.md` for detail but is a standalone summary.

## 4. Feature-level decisions

Most important architectural calls the orchestrator made (ADR list) —
each linked to its ADR file.

## 5. Safety posture

- CS-1..CS-12 implementation evidence: one line each with file + test.
- Red-team fixture results.
- Weekly clinician audit results (last 4 weeks).
- Any open safety concerns.

## 6. Operational posture

- Active feature flag state.
- Kill switch tested on: YYYY-MM-DD. Latency to revert: N min.
- On-call rotation: who, when.
- Backup status.
- Cost YTD vs. budget.

## 7. Epic G integration hand-off (if applicable)

What was integrated, which tickets, which migrations applied to live,
where the legacy `process-document` stands, when it was removed.

## 8. What's explicitly NOT done

- On-prem Chandra.
- Pad-mode OCR replacement.
- ABDM / FHIR integration with DIS.
- Multi-tenant.
- … (cross-reference non_goals.md)

## 9. Next-phase roadmap (suggested)

Numbered list of suggested follow-up features / tickets / epics, with
rationale. Not commitments — the PO will re-scope.

## 10. Known tech debt

Explicit list. Each has a ticket ID + severity.

## 11. Reproducing the full build

End-to-end commands for a fresh clone:
```

## 12. Secrets / configuration checklist

- [ ] DATALAB_API_KEY set in Secrets Adapter
- [ ] ANTHROPIC_API_KEY set
- [ ] DIS_STACK set
- [ ] DIS_KILL_SWITCH=0 (prod) / 1 (emergency)
- etc.

## 13. Training status

- Reception clerks trained: date, count
- Nurses trained: date, count
- Doctors informed: date

## 14. Thanks / credits

Humans + agents who contributed. Useful for later audits.

```

## §5. Integration with the gate system

- **Gate 2 (Test-first)** is unchanged.
- **Gate 7 (DoD)** adds an explicit check: *ticket-level handoff exists at `dis/handoffs/DIS-###.md` and is fully filled in (no empty sections).*
- Merging a branch without a handoff is a Gate 7 failure; the orchestrator re-opens the PR with the reason.

## §6. Agent prompt amendment

Every worker agent's dispatch prompt **must include** a "Session handoff"
step between the task body and the mandatory final commit steps:

```

======== SESSION HANDOFF ========
Before your final commit, create dis/handoffs/DIS-###.md using the
template in radhakishan_system/docs/feature_plans/document_ingestion_service/08_team/session_handoff.md §3.
Include the handoff in the final `git add -A` / `git commit`.
Omitting the handoff = TASK FAILURE.

```

The orchestrator includes this block in every future ticket dispatch.

## §7. Storage & retention

- Ticket handoffs stay in `dis/handoffs/` forever — they're the
  agentic equivalent of a PR description that survives.
- Feature handoff goes into the plan folder, version-controlled.
- No secrets in handoffs. PHI never in handoffs (refer to patient by
  opaque ID only, as with logs — coding_standards.md §8).

## §8. How to consume a handoff

- New agent picking up where another left off: read the handoff file
  on the predecessor's branch FIRST, then the diff.
- Reviewer: read the handoff before the diff. The handoff tells you
  what to look for.
- Architect merging: copy the one-line verdict from §11 into
  `07_tickets/done.md`.

## §9. Failure modes this prevents

- "I don't know why the previous agent chose X, I'll just rewrite it."
- Forgotten follow-up tickets lingering in commit messages.
- Reviewers re-doing the agent's thinking from scratch.
- Feature-level knowledge loss when the feature lead rotates off.
```
