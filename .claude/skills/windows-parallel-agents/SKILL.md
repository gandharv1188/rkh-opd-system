---
name: windows-parallel-agents
description: Windows-safe protocol for dispatching parallel Claude Code subagents with git worktree isolation. Use any time the orchestrator needs to run 2+ agents in parallel on Windows, or any time the Agent tool's isolation="worktree" parameter is being considered. Trigger phrases include "dispatch parallel agents", "run agents in parallel", "parallel wave", "parallel dispatch", "isolation: worktree", "create worktrees", "windows worktree", "multiple agents at once", "agents in parallel". Prevents cross-agent file leakage, missed commits, and the sibling-worktree data-loss class of bugs common on native Windows.
---

# Windows Parallel Agent Dispatch Protocol — v3

Use this skill any time you are about to launch **2 or more agents in parallel** while developing on Windows. It prevents three classes of failure we hit in Sprint 002 Waves 1–2:

1. **Cross-agent file leakage** — agents writing to the main repo instead of their worktree.
2. **Missed commits** — agents leaving work uncommitted, forcing the orchestrator to go into each worktree and commit by hand.
3. **Sibling-worktree contamination** — agent writes into another agent's worktree (rare, but non-recoverable when it happens; added protection in v3 after GitHub issue #41010 surfaced a data-loss variant).

## Why Claude Code's `isolation: "worktree"` is broken on Windows

The harness creates the worktree directory correctly but does **not** rewrite the sub-agent's `<env>Working directory:</env>` context line. On Windows, agents read that line, use absolute paths derived from it (which point to main), and their writes land in the main repo instead of the worktree.

### Known-broken scenarios (confirmed via GitHub issues, unfixed as of v2.1.72)

| Issue  | Scenario                                                      | Outcome                                               |
| ------ | ------------------------------------------------------------- | ----------------------------------------------------- |
| #40164 | `isolation: "worktree"` on Windows 11                         | Path-resolution mismatch; falls back to main silently |
| #39886 | `isolation: "worktree"` alone                                 | Worktree never created; agent runs in main            |
| #37549 | `isolation: "worktree"` + `team_name` (agent teams)           | Silently fails; agent runs in main                    |
| #33045 | `isolation: "worktree"` + `team_name` (different repro)       | No effect; agent runs in main                         |
| #41010 | Sub-agent ID collides with parent worktree name               | Cleanup deletes parent's working dir — DATA LOSS      |
| #39680 | `.claude/worktrees/` already exists                           | EEXIST error on Linux/macOS                           |
| #34645 | Multiple parallel subagents creating worktrees simultaneously | `git config` lock contention                          |

Linux / macOS don't see most of these — different shell-spawning internals and filesystem semantics.

**Do not use the Agent tool's `isolation: "worktree"` parameter on this machine.** Pre-create worktrees manually instead.

**Note on `claude --worktree`:** Claude Code v2.1.49 (Feb 19, 2026) added a native `--worktree` flag, and v2.1.72+ added the `ExitWorktree` tool. These help when you're launching a _single_ Claude Code session into a worktree. They do NOT fix the parallel-subagent case, which is what this skill addresses.

## The protocol (orchestrator's steps)

1. **Pre-install shared deps on main, in one commit** before the wave. Every agent that needs a new dependency installs it via one orchestrator-led commit; agents never touch package.json. This removes the biggest source of parallel merge conflicts.

2. **Pre-create one worktree per agent**: `git worktree add .claude/worktrees/<agent-id> -b feat/<agent-id>` from the main repo. Use stable IDs (e.g., `b103-safe-action`) so branch names match backlog items. **Do not use agent IDs whose first 8 characters could collide** with an existing worktree name under `.claude/worktrees/` — this is the #41010 data-loss trigger.

3. **Dispatch each agent with the hardened prompt prefix** from `prompt-template.md` (v3). Substitute **all six** placeholders before sending:
   - `<WORKTREE_PATH>`, `<WORKTREE_PATH_FORWARD_SLASH>`, `<WORKTREE_NAME>`, `<MAIN_REPO_PATH_FORWARD_SLASH>`, `<BRANCH_NAME>`, `<COMMIT_MESSAGE>`.

   Run all agents with `run_in_background: true` so you can monitor.

4. **Monitor while agents run.** Run `git status --short` on main periodically. If it shows anything dirty, an agent leaked. Stash immediately with `git stash push -u -m "WAVE-N-LEAK-QUARANTINE"` to contain the leak so later agents see a clean tree. Investigate after the wave finishes.

5. **After every agent returns**, verify:
   - Agent reported `VERDICT: WORKTREE RESPECTED` (no leak)
   - Agent's first-response re-anchor statement is present (v3 requirement)
   - Write-path assertion output is `OK` (v3 requirement)
   - `git log main..feat/<branch>` shows at least 1 commit (no missed commit)
   - Agent pasted `git rev-parse --show-toplevel` matching the worktree path

6. **Merge sequentially** with `git merge --no-ff --no-edit`. Suggested order:
   1. Infrastructure-only branches (`.github/workflows/**`, runbook docs)
   2. Standalone new-file branches (pure-add, no edits)
   3. Config-edit branches (`eslint.config.mjs`, `next.config.ts`, `tailwind.config.ts`)
   4. Shared-file edit branches (`app/layout.tsx`, `package.json`) — git auto-merges different sections reliably

   Run `npx tsc --noEmit` + `npm run format:check` between merges. Run `npm run format` + one `style(...)` commit if format has drifted.

7. **Cleanup after merge:**
   ```
   git worktree remove --force .claude/worktrees/<agent-id>
   git branch -D feat/<agent-id>
   ```

## Anti-patterns that caused prior leakage

- Agent uses the `<env>Working directory:</env>` line instead of running `git rev-parse --show-toplevel` first → writes to main. **v3 mitigation: mandatory re-anchor statement in first response.**
- Agent edits a file in-place that also exists in main, creating a `.bak` backup that lands in main. **v3 mitigation: forbidden-paths block explicitly denies writes outside your worktree.**
- Agent runs `npm install` from a directory that resolves to main's `package.json`. **v3 mitigation: pre-commit CWD sanity check catches this.**
- Agent ends without committing → orchestrator has to chase down each worktree and commit manually. **v3 mitigation: directive commit-or-fail language and explicit husky fallback.**
- Two agents both add dependencies → main's `package.json` + `package-lock.json` get tangled at merge time. **Orchestrator mitigation: install up front (step 1).**
- Agent writes into a sibling agent's worktree because it resolved a relative path from the wrong cwd. **v3 mitigation: forbidden-paths explicitly denies sibling worktree prefix.**
- Sub-agent with colliding 8-char ID prefix cleans up and deletes parent's worktree (#41010). **Orchestrator mitigation: use backlog-linked stable IDs; never nest orchestrator inside a worktree.**

## Sibling files

- **`prompt-template.md`** — exact hardened prefix to prepend to every parallel-agent prompt (v3).
- **`orchestrator-flow.md`** — step-by-step bash-level commands for an N-agent wave end-to-end.

## Validation history

- v1 (baseline): 2/2 test agents (2026-04-15)
- v1 → v2: 9/9 Wave 2 agents, 1 leak caught + corrected (2026-04-15)
- v2: 10/10 Wave 3 agents, 0 leaks, 0 missed commits (2026-04-15) — both gaps closed with v2 hardened prompt
- v2 → v3: [TO VALIDATE ON NEXT WAVE] Research-driven hardening. Adds mandatory re-anchor, write-path assertion, forbidden-paths enforcement, pre-commit sanity check, and husky fallback. Targeted at the #41010 sibling-worktree class of failures that v2 had no protection against.

## Future direction: WorktreeCreate / WorktreeRemove hooks

Claude Code now supports `WorktreeCreate` and `WorktreeRemove` hooks. The endgame for this skill is to move validation OUT of the prompt prefix and INTO deterministic hooks:

- The `WorktreeCreate` hook creates the worktree, writes the correct absolute path into a well-known file (e.g., `.claude/current-worktree-path.txt`), and returns the path on stdout.
- The prompt prefix becomes: "Read `.claude/current-worktree-path.txt` as your first action; that is your working directory."
- Path substitution stops being a manual orchestrator chore and becomes a property of the hook.

This is future work. The current v3 prompt-based approach is battle-tested enough to keep shipping with; the hook-based approach requires more infrastructure before it's worth the migration.
