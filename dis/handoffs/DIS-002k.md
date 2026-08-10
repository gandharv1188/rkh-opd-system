# Handoff — DIS-002k Rewrite stale `10_handoff/` path refs to `handoffs/sessions/`

- **Agent:** dev-002k-stale-paths (Opus 4.7, 1M context)
- **Branch:** feat/dis-002k
- **Worktree:** .claude/worktrees/dis-002k
- **Date:** 2026-04-22
- **Duration:** ~30 minutes wall-clock
- **TDD refs implemented:** n/a (doc-only housekeeping)
- **CS refs (if any):** none
- **User story refs:** none

## 1. What was built

Literal path-substitution rewrite across 15 files inside the ticket's
`files_allowed` set. Purpose: neutralize stale textual pointers to the
deprecated directory `dis/document_ingestion_service/10_handoff/` (moved
to `dis/handoffs/sessions/` on 2026-04-22 at commit `69ce4bc`). No code
changed; no gates regressed.

Deliverables:

- 15 Markdown files edited with the two ordered substitutions:
  1. `dis/document_ingestion_service/10_handoff/` → `dis/handoffs/sessions/`
  2. `10_handoff/` → `dis/handoffs/sessions/`
  Ordering matters: applying shorthand first would break the full-path
  form by producing `dis/document_ingestion_service/dis/handoffs/sessions/`.
- `dis/handoffs/DIS-002k.md` — this handoff file.

## 2. Acceptance criteria status

- [x] AC-1: VERIFY-1 ran; output matches files_allowed plus 6 known
      out-of-scope files (flagged and reported to orchestrator before
      editing — see §3 D-1) → output pasted in §9.
- [x] AC-2: VERIFY-2a empty for in-scope files; residual 6 files are
      the ones explicitly declared out of scope → §9.
- [ ] AC-3: VERIFY-3 expected integer ≥ 1 for stale-path count in the
      JSONL transcript, but actually returned **0**. Investigation
      showed the transcript preserves a DIFFERENT older path
      (`radhakishan_system/docs/feature_plans/document_ingestion_service/10_handoff/`)
      which pre-dates the `dis/` reorganization. So the historical
      record is preserved, just not under the exact string the ticket
      expected. Flagged in §3 D-2.
- [x] AC-4: VERIFY-4 modified-files set is a strict subset of
      files_allowed → §9.
- [x] AC-5: VERIFY-5 handoff file exists at
      `dis/handoffs/DIS-002k.md` → §9.
- [x] AC-6: VERIFY-6 fitness=0 violations; tsc exit=0; vitest 124/124
      passed → §9.

## 3. Decisions taken during implementation

### D-1: Strict-scope enforcement — 6 files deferred to DIS-002l

**Context:** VERIFY-1 discovered 6 files carrying stale refs that were
NOT in `files_allowed`. The ticket explicitly says "if ANY file is
listed by grep that's NOT in `files_allowed`, STOP and report — do not
silently widen scope." (DIS-021c pattern.)

**Options considered:** (a) silently rewrite them anyway; (b) stop and
report to orchestrator; (c) quietly drop them from scope.

**Decision:** (b). Halted before the first edit, sent a SendMessage
report with the 15-file list, per-file files_allowed classification,
and 3 resolution options.

**Reason:** The 6 out-of-scope files (4 orientation/meta docs + 2
`sessions/` docs now carrying their own pre-move internal refs)
contain historical prose that would be damaged by blind literal
substitution — e.g., `source-manifest.md:25` says "`dis/document_ingestion_service/10_handoff/` — **deprecated directory.** Its 8 files were moved to `dis/handoffs/sessions/`." Rewriting that sentence would produce a tautology. This is exactly the
"historical-quote preservation" case the ticket flagged as judgment
work, not literal substitution.

**Revisit if:** Follow-up ticket DIS-002l (registered in §5) handles
these 6 files with case-by-case discrimination between historical and
live refs.

### D-2: Shorthand-rule expansion confirmed by orchestrator

**Context:** The ticket's literal rule targeted only the full path
`dis/document_ingestion_service/10_handoff/`. But files_allowed
includes 6 files (ADR-002, ADR-007, done.md, in_progress.md, DIS-001b,
DIS-002e) that contain ONLY the shorthand form `10_handoff/foo.md`. If
the ticket's rule applied literally, those 6 would remain stale —
making files_allowed a confusing promise.

**Options considered:** (a) rewrite shorthand too (expand rule); (b)
leave shorthand untouched (respect rule literally); (c) ask.

**Decision:** (a), per orchestrator direction in response to my scope-
mismatch report. Applied BOTH substitutions uniformly to ALL 15 in-
scope files (the 9 with full-path hits + the 6 with shorthand-only
hits). Ordering: full-path first, then shorthand.

**Reason:** Orchestrator confirmed: "shorthand is a real live pointer,
not a quoting style." Leaving it would defeat the ticket's stated
purpose of killing dead pointers.

**Revisit if:** A future markdown style guide mandates prefixing all
internal refs with `dis/document_ingestion_service/` (unlikely — the
new convention is `dis/handoffs/sessions/`).

### D-3: VERIFY-3 mismatch noted but not a blocker

**Context:** VERIFY-3 as written expects the JSONL at
`dis/document_ingestion_service/11_session_transcripts/2026-04-20_dis-build-session.jsonl`
to contain at least one occurrence of `dis/document_ingestion_service/10_handoff/`. Actual count is 0.

**Investigation:** The transcript DOES contain historical 10_handoff
path references, but under the pre-reorganization form
`radhakishan_system/docs/feature_plans/document_ingestion_service/10_handoff/`.
The `dis/` prefix is a newer layout. So the JSONL correctly preserves
the historical record; the VERIFY-3 command as authored is checking
for the wrong string.

**Decision:** Do not mutate the JSONL (it's explicitly READ-ONLY per
ticket). Do not mutate the VERIFY-3 command (that would require
rewriting the ticket). Flag the mismatch in §5 as follow-up for the
orchestrator to update the ticket text or VERIFY-3 in a future edit.

**Reason:** Preserving the JSONL is the binding requirement; the
VERIFY-3 wording is a secondary artifact that can be amended without
risk.

## 4. What was deliberately NOT done

- No edit to the 6 out-of-scope files (see D-1). Deferred to DIS-002l.
- No edit to `dis/handoffs/orientation/05-tickets-handoffs.md` even
  though it has stale refs — ticket explicitly lists it as READ-only
  for enumeration purposes.
- No edit to the JSONL transcript
  (`dis/document_ingestion_service/11_session_transcripts/2026-04-20_dis-build-session.jsonl`)
  — ticket marks it READ-only historical record.
- No content changes beyond the path fragment — formatting, table
  layout, bullets, and surrounding prose all preserved verbatim.
  Diff stat confirms balanced: 113 insertions, 113 deletions — pure
  line-for-line substitution.
- No fitness-rule additions, no new tests, no schema edits.

## 5. Follow-ups / known gaps

- **DIS-002l (suggested):** "Rewrite `10_handoff/` references in the 6
  out-of-scope meta/orientation/session files with historical-vs-live
  judgment." Files:
  1. `dis/handoffs/orientation/_meta/source-manifest.md`
  2. `dis/handoffs/orientation/02-architecture.md` (shorthand-only —
     new discovery during VERIFY-2b run)
  3. `dis/handoffs/orientation/04-rollout-team-runbooks.md`
  4. `dis/handoffs/orientation/05-tickets-handoffs.md` (listed as
     READ-only in DIS-002k — DIS-002l needs a separate note)
  5. `dis/handoffs/orientation/README.md`
  6. `dis/handoffs/sessions/Prompt_2.md`
  7. `dis/handoffs/sessions/SESSION_HANDOVER_2026-04-20.md`
  8. `dis/handoffs/sessions/SESSION_HANDOVER_2026-04-21.md`
     (shorthand-only — new discovery during VERIFY-2b run)
  Epic: meta / documentation hygiene. Urgency: S. Doc-only. Requires
  per-ref judgment of historical-vs-live framing.

- **DIS-002m (suggested):** "Fix DIS-002k ticket VERIFY-3 expected
  string." The VERIFY-3 grep pattern should reference the pre-`dis/`
  old path or the check should be reframed as "JSONL transcripts
  remain unmodified by this ticket" (e.g.,
  `git diff feat/dis-plan..HEAD -- '*.jsonl' | wc -l` → 0). Urgency: S.
  Doc-only.

## 6. Files touched

- Added:
  - `dis/handoffs/DIS-002k.md` (this file)
- Modified (15):
  - `dis/document_ingestion_service/02_architecture/adrs/ADR-002-datalab-hosted-vs-self-host.md`
  - `dis/document_ingestion_service/02_architecture/adrs/ADR-007-claude-haiku-default-sonnet-escalation.md`
  - `dis/document_ingestion_service/07_tickets/backlog.md`
  - `dis/document_ingestion_service/07_tickets/done.md`
  - `dis/document_ingestion_service/07_tickets/in_progress.md`
  - `dis/document_ingestion_service/07_tickets/integration_hold.md`
  - `dis/document_ingestion_service/08_team/session_handoff.md`
  - `dis/handoffs/DIS-001b.md`
  - `dis/handoffs/DIS-002d.md`
  - `dis/handoffs/DIS-002e.md`
  - `dis/handoffs/DIS-002f.md`
  - `dis/handoffs/DIS-002g.md`
  - `dis/handoffs/DIS-002h.md`
  - `dis/handoffs/DIS-002j.md`
  - `dis/handoffs/DIS-050a.md`
- Deleted: none.

## 7. External dependencies introduced

None. `npm install` was run inside `dis/` to satisfy VERIFY-6's
`npx tsc` + `npx vitest`, but `node_modules/` is gitignored and not
committed.

## 8. Tests

- Tests added: 0 (doc-only)
- Coverage changes: none
- Flakiness introduced: none
- Snapshot files: none

VERIFY-6 baseline preserved: vitest 124/124 passed; tsc exit 0;
fitness 0 violations.

## 9. Reproducing the work locally

```
cd .claude/worktrees/dis-002k
git checkout feat/dis-002k
```

### VERIFY-1 — Pre-flight stale-ref inventory

Command:
```
grep -rln "dis/document_ingestion_service/10_handoff/" dis/ --include="*.md" 2>/dev/null | sort
```

Output (run pre-edit, commit 23f6476):
```
dis/document_ingestion_service/07_tickets/backlog.md
dis/document_ingestion_service/07_tickets/integration_hold.md
dis/document_ingestion_service/08_team/session_handoff.md
dis/handoffs/DIS-002d.md
dis/handoffs/DIS-002f.md
dis/handoffs/DIS-002g.md
dis/handoffs/DIS-002h.md
dis/handoffs/DIS-002j.md
dis/handoffs/DIS-050a.md
dis/handoffs/orientation/_meta/source-manifest.md
dis/handoffs/orientation/04-rollout-team-runbooks.md
dis/handoffs/orientation/05-tickets-handoffs.md
dis/handoffs/orientation/README.md
dis/handoffs/sessions/Prompt_2.md
dis/handoffs/sessions/SESSION_HANDOVER_2026-04-20.md
```
15 files found. 9 in files_allowed; 6 out-of-scope (last 6 rows) →
see D-1.

### VERIFY-2a — Post-rewrite, full-path form clean

Command:
```
grep -rln "dis/document_ingestion_service/10_handoff/" dis/ --include="*.md" 2>/dev/null
```

Output (post-edit):
```
dis/handoffs/orientation/04-rollout-team-runbooks.md
dis/handoffs/orientation/05-tickets-handoffs.md
dis/handoffs/orientation/README.md
dis/handoffs/orientation/_meta/source-manifest.md
dis/handoffs/sessions/Prompt_2.md
dis/handoffs/sessions/SESSION_HANDOVER_2026-04-20.md
```
Exactly the 6 out-of-scope files. 0 in-scope residual. ✓

### VERIFY-2b — Post-rewrite, shorthand form clean (inside scope)

Command:
```
grep -rln "10_handoff/" dis/ --include="*.md" 2>/dev/null
```

Output (post-edit):
```
dis/handoffs/orientation/02-architecture.md
dis/handoffs/orientation/04-rollout-team-runbooks.md
dis/handoffs/orientation/05-tickets-handoffs.md
dis/handoffs/orientation/README.md
dis/handoffs/orientation/_meta/source-manifest.md
dis/handoffs/sessions/Prompt_2.md
dis/handoffs/sessions/SESSION_HANDOVER_2026-04-20.md
dis/handoffs/sessions/SESSION_HANDOVER_2026-04-21.md
```
All 8 are out-of-scope. 0 in-scope residual. DIS-002l (see §5) owns
these. `02-architecture.md` and `SESSION_HANDOVER_2026-04-21.md` are
new discoveries during this run (not in the VERIFY-1 full-path set
because they only carry shorthand).

### VERIFY-3 — JSONL transcript preserved

Command:
```
grep -c "dis/document_ingestion_service/10_handoff/" dis/document_ingestion_service/11_session_transcripts/2026-04-20_dis-build-session.jsonl
```

Output:
```
0
```

**Note:** Expected ≥ 1 per ticket, but actual is 0 because the JSONL
preserves the pre-`dis/` form
(`radhakishan_system/docs/feature_plans/document_ingestion_service/10_handoff/`).
Independent check:
```
grep -c "10_handoff" dis/document_ingestion_service/11_session_transcripts/2026-04-20_dis-build-session.jsonl
→ 6
```
So the historical record IS preserved; the VERIFY-3 pattern in the
ticket is checking for the wrong string. See §5 follow-up DIS-002m.
JSONL itself is untouched (confirmed: not in `git diff --name-only`).

### VERIFY-4 — Modified files ⊆ files_allowed

Command:
```
git diff --name-only feat/dis-plan..HEAD | sort
```

Output (post-commit):
```
dis/document_ingestion_service/02_architecture/adrs/ADR-002-datalab-hosted-vs-self-host.md
dis/document_ingestion_service/02_architecture/adrs/ADR-007-claude-haiku-default-sonnet-escalation.md
dis/document_ingestion_service/07_tickets/backlog.md
dis/document_ingestion_service/07_tickets/done.md
dis/document_ingestion_service/07_tickets/in_progress.md
dis/document_ingestion_service/07_tickets/integration_hold.md
dis/document_ingestion_service/08_team/session_handoff.md
dis/handoffs/DIS-001b.md
dis/handoffs/DIS-002d.md
dis/handoffs/DIS-002e.md
dis/handoffs/DIS-002f.md
dis/handoffs/DIS-002g.md
dis/handoffs/DIS-002h.md
dis/handoffs/DIS-002j.md
dis/handoffs/DIS-002k.md
dis/handoffs/DIS-050a.md
```
16 entries. All ⊆ files_allowed (+ DIS-002k.md handoff). ADR-004 in
files_allowed but not modified (no stale ref in it — it's allowed
slack, not a required edit). ✓

### VERIFY-5 — Handoff file exists

Command:
```
test -f dis/handoffs/DIS-002k.md && echo EXISTS
```

Output:
```
EXISTS
```
✓

### VERIFY-6 — Fitness + tsc + vitest unchanged

Command:
```
node dis/scripts/fitness.mjs 2>&1 | tail -3
cd dis && npx tsc --noEmit ; echo "tsc exit=$?"
cd dis && npx vitest run 2>&1 | tail -5
```

Output:
```
fitness: no violations (7 rule(s), 47 file(s) scanned).
tsc exit=0
 Test Files  12 passed (12)
      Tests  124 passed (124)
   Start at  09:25:35
   Duration  1.23s
```
All three match Wave-B baseline. ✓

### Workspace setup notes

- Worktree created pre-session by orchestrator via `git worktree add`.
- `npm install` was run in `dis/` only to power VERIFY-6 (`npx tsc`,
  `npx vitest`). `node_modules/` is gitignored; not committed.
- Fitness script must be invoked from worktree root (`node dis/scripts/fitness.mjs`),
  not from `dis/` — it resolves `fitness-rules.json` relative to a
  computed `root/dis/scripts/...`. Running from `dis/` produces
  `root/dis/dis/scripts/...` and fails. Pre-existing behavior; worth
  flagging for team docs someday.

## 10. Non-obvious gotchas

- **Substitution ordering matters.** Apply the FULL path substitution
  first, THEN the shorthand. Reversed ordering would break the full
  path form: `dis/document_ingestion_service/10_handoff/` shorthand
  match `10_handoff/` → `dis/document_ingestion_service/dis/handoffs/sessions/`. The `-e A -e B` sed invocation preserves file-order application
  (A runs before B per input line).
- **Diff stat balance check.** 113 insertions + 113 deletions is the
  tell for clean line-for-line substitution. Any imbalance would
  indicate line-wrap or whitespace damage. Inspect with `git diff --stat`
  before committing.
- **`sed -i` on Windows bash** used in this worktree worked without
  BOM/encoding damage (git-bash sed behaves Unix-like). If the next
  agent uses PowerShell `Get-Content | Set-Content`, expect UTF-8-BOM
  introduction; use Node's `fs.writeFileSync` with explicit `utf8`.
- **Fitness script cwd trap** — see §9 workspace setup notes.
- **VERIFY-3 asymmetry.** The JSONL transcript preserves a DIFFERENT
  old path (pre-`dis/`) than VERIFY-3 checks for. Don't "fix" the
  JSONL to match; fix VERIFY-3 (see DIS-002m).

## 11. Verdict

Complete, ready for review.
