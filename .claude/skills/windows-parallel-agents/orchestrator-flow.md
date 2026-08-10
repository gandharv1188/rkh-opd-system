# Orchestrator Flow — End-to-End Parallel Agent Wave

Concrete bash-level commands for running a wave of N agents. Run from the main repo root unless noted.

## 0. Pre-flight

```
cd E:/rk-telerads-gas-final/rkt-platform
git status --short   # must be empty
git log --oneline -1  # note base commit
```

If dirty, resolve before the wave. A clean main is the leak detector.

## 1. Pre-install shared dependencies

Every new `dependencies` / `devDependencies` needed across the wave, installed in one commit, so agents don't touch `package.json`.

```
cd apps/web && npm install <runtime-deps...>
cd ../.. && npm install -D <dev-tools...> --ignore-workspaces
git add package.json package-lock.json apps/web/package.json
HUSKY=0 git commit -m "chore(sprint-N): pre-install Wave <M> dependencies"
```

Reason: parallel agents editing `package.json` + `package-lock.json` produces nasty merge conflicts. Install up front.

## 2. Create worktrees

```
for id in b102-csp b103-safe-action b107-ci b111-knip b115-posthog b116-eslint b119-motion b121-img-font b122-form; do
  git worktree add ".claude/worktrees/$id" -b "feat/$id"
done
git worktree list   # verify N+1 entries (N agents + main)
```

Naming convention: `feat/b<backlog-id>-<slug>`. Keeps branches linkable to the backlog item.

## 3. Dispatch agents

For each agent, send:

```
prompt =
  HARDENED_WORKTREE_PREFIX (from prompt-template.md, with placeholders filled) +
  task_brief (concrete spec, file paths, acceptance criteria)
```

Invoke with `run_in_background: true`. Use the appropriate `subagent_type` (backend-infra, frontend-dev, database-admin, test-engineer, etc.).

## 4. Monitor while agents run

Every time an agent completes (or on a timer), check:

```
cd E:/rk-telerads-gas-final/rkt-platform
git status --short
```

- Output empty → safe, keep waiting.
- Output non-empty → **LEAK DETECTED**. Immediately:
  ```
  git stash push -u -m "WAVE-N-LEAK-QUARANTINE"
  ```
  This yanks the leaked changes off main so later agents see a clean tree. Investigate the stash after the wave finishes — usually the leaked content is a partial version of what an agent eventually wrote to its worktree correctly; in that case, drop the stash.

## 5. After each agent returns

Verify three things before moving on:

```
# Agent reports VERDICT: WORKTREE RESPECTED (from its report)

# Orchestrator checks:
git log --oneline main..feat/<branch>   # must show ≥1 commit
cd .claude/worktrees/<id> && git rev-parse --show-toplevel
# must equal the worktree path, not main
cd E:/rk-telerads-gas-final/rkt-platform
```

If `git log main..feat/<branch>` is empty, the agent forgot to commit:

```
cd .claude/worktrees/<id>
git add -A && git status --short
git commit -m "<appropriate message>"
cd -
```

(This should never be needed with the v2 hardened prompt — every Wave 3 agent committed correctly. But it's the recovery path if it happens.)

## 6. Merge to main — sequenced order

Suggested merge order to minimize conflicts:

1. **Infrastructure-only** (`.github/workflows/*`, `docs/runbooks/*`, `.lighthouserc.json`)
2. **Pure-add new files** (new components, new libs, new test files)
3. **Config edits** (`eslint.config.mjs`, `next.config.ts`, `tailwind.config.ts`, `globals.css`)
4. **Shared-file edits** (`app/layout.tsx`, `apps/web/package.json` scripts) — last, since these are where conflicts happen

```
git merge --no-ff --no-edit feat/<id>
```

If a conflict arises in `package.json` (multiple agents added scripts), combine both blocks and commit:

```
# Edit the conflict region to keep both sets of scripts
git add apps/web/package.json
HUSKY=0 git commit --no-edit
```

## 7. Post-wave verification

```
cd apps/web
npx tsc --noEmit         # must exit 0
npm run format:check     # must pass; if not, run: npm run format
cd ..
git status --short       # any diff from format:check? commit as: style(wave-N): prettier format pass
```

## 8. Cleanup

```
for id in b102-csp b103-safe-action b107-ci b111-knip b115-posthog b116-eslint b119-motion b121-img-font b122-form; do
  git worktree remove --force ".claude/worktrees/$id"
  git branch -D "feat/$id"
done
git worktree list   # should only show main
```

Occasional worktree-remove failure on Windows: "Directory not empty" (npm `node_modules` lingering). Safe to ignore — the worktree is unregistered, the directory is gitignored, and the branch is deleted.

## 9. Update task tracker + commit the sprint wave

Update task-list entries, update sprint file with per-item commits + caveats, then either open a PR or move to next wave.

## Recovery: agent leaked to main

If an agent leaks (dirty `git status` on main during the wave):

1. `git stash push -u -m "WAVE-N-LEAK-QUARANTINE"` — contain it
2. Let the wave finish
3. Inspect: `git stash show -p stash@{0}`
4. Compare against the agent's worktree diff: `git diff main..feat/<suspect-id>`
5. If the stash is a subset of the worktree's commit → drop the stash (`git stash drop`), the worktree has the authoritative work.
6. If the stash has unique content missing from the worktree → cherry-pick into the correct branch, then drop.
