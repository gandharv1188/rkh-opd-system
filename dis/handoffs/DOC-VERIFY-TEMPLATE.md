# Handoff — DOC-VERIFY-TEMPLATE: Adopt Verify-Driven Ticketing in DIS meta-docs

- **Agent:** doc-verify-template (general-purpose, Opus 4.7)
- **Branch:** feat/dis-verify-template
- **Worktree:** .claude/worktrees/verify-template
- **Date:** 2026-04-20
- **Duration:** ~15 minutes
- **TDD refs implemented:** n/a (meta-docs, no runtime code)
- **CS refs:** none
- **User story refs:** none

## 1. What was built

- `radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/_ticket_template.md`
  — Full rewrite into Verify-Driven format. Preserves all existing
  frontmatter fields (Tags, Epic, Depends on, Blocks, TDD ref, CS ref,
  User-story ref, Estimated effort, Status). Adds `files_allowed:`
  YAML list with CI-rejection note. Replaces "Acceptance criteria" with
  a `VERIFY-N` block (Command / Expect / Pass-if triples) plus worked
  example. Retains Out-of-scope, Test plan, Notes/gotchas, Review
  gates. Review-gates checklist extended with 4 new rows (VERIFY ≥3,
  shell-only, handoff paste, files_allowed match).
- `radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/README.md`
  — New `## Verify-Driven Ticketing` section appended at the bottom
  (2 paragraphs): format explanation + composition with TDD /
  handoffs / drift-prevention. Links to
  `05_testing/verify_format.md` and `02_architecture/drift_prevention.md`.

## 2. Acceptance criteria status

See §Verify Report below.

## 3. Decisions taken during implementation

### D-1: `files_allowed` rendered as YAML inside fenced code block

**Context:** brief required YAML-style list but the section is in a
markdown template.
**Options considered:** inline YAML list vs fenced `yaml` code block
vs bullet list.
**Decision:** fenced `yaml` code block.
**Reason:** keeps the block machine-parseable by CI (can be grepped /
loaded as YAML) while still rendering cleanly in the ticket body.
**Revisit if:** CI parser expects a different shape.

### D-2: VERIFY block uses `VERIFY-N:` prefix inside a fenced code block

**Context:** brief specified `VERIFY-N:` prefix + shell commands.
**Options considered:** free-text headings vs fenced block vs
sub-headings per step.
**Decision:** fenced (unlanguaged) block containing the triple
(Command / Expect / Pass-if).
**Reason:** `grep -c "VERIFY-"` in Verify step 2 stays deterministic;
block discourages ad-hoc prose between steps.
**Revisit if:** reviewers want per-step sub-headings for navigation.

## 4. What was deliberately NOT done

- Did not edit `backlog.md`, `epics.md`, or any existing ticket file —
  owned by other teammates per brief.
- Did not retrofit existing done tickets with VERIFY blocks — out of
  scope (the brief says apply the pattern to template + README only).
- Did not create `02_architecture/drift_prevention.md` — linked
  forward, expected to land in Wave 3 per the task description.

## 5. Follow-ups / known gaps

- DIS-xxx (suggested): retrofit already-merged tickets with VERIFY
  blocks — reason: uniformity for Wave-3 CI — urgency S.
- DIS-xxx (suggested): add a CI check that parses `files_allowed:` and
  diffs against the PR — urgency M, needed before Wave 3.

## 6. Files touched

- Modified: `radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/_ticket_template.md`
- Modified: `radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/README.md`
- Added: `dis/handoffs/DOC-VERIFY-TEMPLATE.md`

## 7. External dependencies introduced

None.

## 8. Tests

No tests (meta-docs). VERIFY evidence is the shell-grep transcript
below.

## 9. Reproducing the work locally

```
cd <repo-root>
test -f radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/_ticket_template.md && echo EXISTS
grep -c "VERIFY-"        radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/_ticket_template.md
grep -c "files_allowed"  radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/_ticket_template.md
grep -c "## Verify-Driven Ticketing" radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/README.md
grep -c "verify_format.md" radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/README.md
```

## 10. Non-obvious gotchas

- The VERIFY code block is intentionally unlanguaged (no `bash`
  fence). Adding `bash` would render the `Expect:` / `Pass if:` lines
  as comments and confuse readers.
- Relative links inside the template target `../05_testing/…` and
  `../08_team/…` because ticket copies live in `07_tickets/`.

## 11. Verdict

Complete, ready for review.

---

## Verify Report

### VERIFY-1: template file exists at expected path

**Given** branch `feat/dis-verify-template` checked out at worktree root.
**When** `test -f <path> && echo EXISTS`.
**Then** output is `EXISTS`.

- Command: `test -f radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/_ticket_template.md && echo EXISTS`
- Expected output: `EXISTS`
- Actual output:

```
EXISTS
```

- Artifact: worktree HEAD on `feat/dis-verify-template`

**Status:** PASS

---

### VERIFY-2: template contains ≥1 `VERIFY-` marker

- Command: `grep -c "VERIFY-" radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/_ticket_template.md`
- Expected output: integer ≥ 1
- Actual output:

```
4
```

- Artifact: same file

**Status:** PASS (4 ≥ 1)

---

### VERIFY-3: template contains ≥2 `files_allowed` mentions

- Command: `grep -c "files_allowed" radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/_ticket_template.md`
- Expected output: integer ≥ 2
- Actual output:

```
2
```

- Artifact: same file

**Status:** PASS (2 ≥ 2)

---

### VERIFY-4: README contains exactly one `## Verify-Driven Ticketing` heading

- Command: `grep -c "## Verify-Driven Ticketing" radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/README.md`
- Expected output: `1`
- Actual output:

```
1
```

- Artifact: README.md

**Status:** PASS

---

### VERIFY-5: README contains ≥1 link to `verify_format.md`

- Command: `grep -c "verify_format.md" radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/README.md`
- Expected output: integer ≥ 1
- Actual output:

```
1
```

- Artifact: README.md

**Status:** PASS (1 ≥ 1)
