---
meta: refresh-protocol
applies_to: dis/handoffs/orientation/*.md
written: 2026-04-22
---

# Orientation Refresh Protocol

> **Purpose.** Tell the next orchestrator session how to keep `dis/handoffs/orientation/` current without re-dispatching six teammates every time. This is the mechanical discipline that makes the orientation package durable.

## Mental model

Each of the six reports (`01-overview-product.md` … `06-code-reality-audit.md`) declares two things in its frontmatter:

- `source_commit` — the git SHA at which the report was written.
- `source_paths` — the directories (and in some cases specific files) the report covers.

To refresh a report, you ask git one question: *"What in my source paths has changed since my source commit?"* If the answer is empty, the report is still current. If not, you read only the delta and edit in place.

This is much cheaper than re-reading source trees.

## The five-step refresh

### Step 1 — Read the six reports first

Before doing anything else, read the current state of all six reports plus this README. This is how you get oriented. Do not skip this — the reports already explain what's current and what the known drift is. Re-reading source without the reports as a map wastes time and will miss the drift findings.

### Step 2 — For each report, compute the diff

From the repo root, for every report whose frontmatter declares `source_commit: <SHA>` and `source_paths: [...]`:

```bash
# Example for 02-architecture.md
git log --name-only <SHA>..HEAD -- \
  dis/document_ingestion_service/02_architecture/
```

- **No output** → the report's covered files have not changed. Report is current. Move on.
- **Output present** → read only the files listed. Do not re-read the whole source tree.

Also check for newly added files under `source_paths` that the report's `covered_files` frontmatter does not enumerate:

```bash
# New files under 02_architecture/ since 69ce4bc
git diff --name-only --diff-filter=A <SHA>..HEAD -- \
  dis/document_ingestion_service/02_architecture/
```

Added files represent scope growth (new ADR, new runbook, new migration) and must be folded into the report.

### Step 3 — Update the report in place

For each changed file you re-read:

1. Locate the section in the report that covers that file (the report is organized by topic, not by file — use `covered_files` in the frontmatter to find the section).
2. Edit the relevant tables, subsections, drift findings in place.
3. Append a brief entry to the report's `## What changed since last refresh` section. Format:

```markdown
- 2026-MM-DD: <file path> — <one-line summary of change and how report was updated>
```

4. At the end of the update, bump the report's frontmatter:
   - `last_refreshed: 2026-MM-DD`
   - `source_commit: <new HEAD SHA>`

### Step 4 — Update this README (§8 Provenance + §4 Critical findings if relevant)

If the refresh added, resolved, or changed the severity of any finding in the README's §4, update §4 accordingly. Otherwise touch only the `last_refreshed` field of the README's frontmatter.

### Step 5 — Commit with a structured message

```
docs(dis): refresh orientation — <report-ids> (<YYYY-MM-DD>)

Source commit range: <OLD_SHA>..<NEW_SHA>
Reports updated: 02-architecture.md, 05-tickets-handoffs.md
New findings: <one line per F-N added>
Resolved findings: <one line per F-N removed>
```

One refresh can update multiple reports. Keep the commit focused on orientation only — do not mix in unrelated changes.

## What *does not* require a full refresh

- A new `DIS-###.md` per-task handoff in `dis/handoffs/` → add one row to `05-tickets-handoffs.md`'s ticket table. That's it.
- A new `SESSION_HANDOVER_*.md` in `dis/handoffs/sessions/` → add one entry to `05-tickets-handoffs.md`'s sessions section.
- A new backlog entry in `07_tickets/backlog.md` → update `05-tickets-handoffs.md` backlog counts; enumerate only if it's a Wave-held ticket.
- A new ADR → add a full H3 subsection in `02-architecture.md` (Status / Context / Decision / Consequences / Cross-refs / Drift note).

## What *does* require re-dispatching a teammate

Only two scenarios:

1. **A report has decayed beyond incremental update.** If `source_commit`.. `HEAD` touches more than ~50% of the report's `covered_files`, the diff-and-patch approach costs more than a fresh write. Dispatch a replacement teammate with the same prompt pattern used in 2026-04-22.
2. **A new top-level slice emerges.** If a new numbered folder appears under `dis/document_ingestion_service/` (e.g., `12_compliance/`), decide whether it gets folded into an existing report or warrants a `07-<slug>.md`. If it warrants its own report, dispatch a teammate for it.

Both cases are rare. The default refresh is a single-session in-place edit, not a fan-out.

## Drift-finding lifecycle

Each numbered finding (F1, F2, …) in the README §4 has three legitimate states:

| State | What it means |
|-------|---------------|
| **Open** | Finding is present in source; implication stands. |
| **Resolved** | A commit has addressed the finding. Remove from §4; mention once in the report's "What changed since last refresh"; archive the finding text at the bottom of the report that owned it (so the history isn't lost). |
| **Superseded** | A newer finding replaces this one. Point from the old F-N to the new F-M. |

Do not silently delete findings. Every resolution gets one line in a commit message.

## Append-only is forbidden

This is worth its own rule because it's an easy mistake under time pressure.

**Do not** create `orientation/refresh-2026-05-*.md` as a new file when sources change. That pattern makes the orientation package bigger and harder over time, instead of keeping it small and current. Refresh = edit in place. If you're tempted to append, stop and update the report instead.

The one exception: `sessions/SESSION_HANDOVER_*.md` files *are* append-only and belong under `dis/handoffs/sessions/`, not under `dis/handoffs/orientation/`. Session handovers record a moment. Orientation reports describe the current state.

## How to add a new report (seventh+)

If the project grows a slice that doesn't fit any of the six reports (e.g., a full FHIR/ABDM integration that the current `non_goals.md` excludes but a future pivot could change):

1. Choose a slug and number: `07-<slug>.md`.
2. Write its frontmatter using the existing reports' format.
3. Add it to the table in `README.md §2`.
4. Add its `source_paths` to this protocol mentally so future refreshes include it.
5. Only then fill out the body — the frontmatter + README row create the contract.

## Sanity check after every refresh

Before committing, verify:

- [ ] Every report's `last_refreshed` that was touched was bumped.
- [ ] Every report's `source_commit` that was touched was bumped to current HEAD.
- [ ] README's `last_refreshed` was bumped.
- [ ] Each edited report has an entry in its own `## What changed since last refresh` section.
- [ ] No new `orientation/refresh-*.md` or `orientation/snapshot-*.md` files were created.
- [ ] README §4 findings list matches the true state (no stale "open" findings that were resolved).

If any of those fail, fix before committing.
