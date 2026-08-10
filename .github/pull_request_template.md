<!--
Pull request checklist for the Document Ingestion Service (DIS).
Aligned with review_gates.md Gate 7 (Definition of Done).
-->

## Ticket

- Ticket ID (put `DIS-###` in the PR title and reference it here): DIS-\_\_\_
- Link to backlog entry:

## Summary

<!-- 1-3 sentences describing what and why. -->

## Gate 7 — Definition of Done checklist

- [ ] Ticket ID (DIS-###) referenced in title and description
- [ ] TDD section implemented (cite section, e.g. §9.1, §10.2)
- [ ] All acceptance criteria from the backlog ticket are satisfied and checked below
- [ ] Tests added and passing locally (`npm test` inside `dis/`)
- [ ] Coding standards followed (cite relevant §§ from `coding_standards.md`)
- [ ] No `any` introduced without an inline justification comment
- [ ] Docs updated (TDD / runbook / README / ADR, as applicable)
- [ ] Changelog entry added

### Acceptance criteria

<!-- Copy each acceptance-criteria line from the backlog ticket here and tick when met. -->

- [ ] AC1 — ...
- [ ] AC2 — ...
- [ ] AC3 — ...

### Applicable gates (check those that apply, confirm handled)

- [ ] Integration gate — cross-module contracts verified
- [ ] Clinical-safety gate — patient-safety impact reviewed (per `review_gates.md` Gate 5)
- [ ] Security gate — threat model / secret handling reviewed (per Gate 6)
- [ ] Breaking-change gate — migration path documented; consumers notified

## Test plan

<!-- Bulleted list of what you ran / what reviewers should run. -->

-

## Risk / rollback

<!-- What breaks if this is wrong? How do we revert? -->

-
