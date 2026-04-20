# Hardened Worktree Prompt Prefix — v3

Prepend this verbatim to every parallel-agent prompt. Substitute the six angle-bracket placeholders **before** sending.

## Placeholders (v3 adds two)

- `<WORKTREE_PATH>` — Windows-style absolute path, e.g. `E:\rk-telerads-gas-final\rkt-platform\.claude\worktrees\b123-flags`
- `<WORKTREE_PATH_FORWARD_SLASH>` — same path with `/` separators, e.g. `E:/rk-telerads-gas-final/rkt-platform/.claude/worktrees/b123-flags` (git + bash prefer this form)
- `<WORKTREE_NAME>` — just the final path component, e.g. `b123-flags` **[NEW in v3]**
- `<MAIN_REPO_PATH_FORWARD_SLASH>` — main repo root, forward-slash form, e.g. `E:/rk-telerads-gas-final/rkt-platform` **[NEW in v3]**
- `<BRANCH_NAME>` — e.g. `feat/b123-flags`
- `<COMMIT_MESSAGE>` — the full commit message (subject + body) the agent will use in its mandatory final commit

---

```
WORKTREE ISOLATION — MANDATORY. READ FULLY BEFORE ANY TOOL CALL.

Your working directory is:
  <WORKTREE_PATH>

Branch: <BRANCH_NAME>.
A main repo exists at <MAIN_REPO_PATH_FORWARD_SLASH> — it is READ-OK, WRITE-FORBIDDEN.

======== RE-ANCHOR YOUR CONTEXT (say this back in your first response) ========
The <env>Working directory:</env> line in your context is STALE. It was inherited from the PARENT session's cwd (the MAIN repo) and was NOT updated for your worktree. This is a known Claude Code bug on Windows, not a mistake by the orchestrator.

In your first response, before any tool call, state explicitly:
  "My working directory is <WORKTREE_PATH>. The env hint is stale. I will ignore it and use <WORKTREE_PATH> as the base for all file paths."

After saying this, every file-path decision MUST use <WORKTREE_PATH> as the base. Any reasoning that references the <env> line as authoritative = TASK FAILURE.

======== MANDATORY FIRST ACTIONS (in this order) ========
1. Bash: `cd "<WORKTREE_PATH_FORWARD_SLASH>" && pwd && git rev-parse --show-toplevel && git branch --show-current`
   EXPECTED:
     pwd → POSIX form of the worktree path
     rev-parse → <WORKTREE_PATH_FORWARD_SLASH>
     branch → <BRANCH_NAME>
   If ANY of the three mismatch → STOP immediately, report actual values, do nothing else.

2. WRITE-PATH ASSERTION (run once before your FIRST Write/Edit):
   Bash: `test "$(cd "<WORKTREE_PATH_FORWARD_SLASH>" && pwd)" = "$(pwd)" && echo OK || echo MISMATCH`
   If output is "MISMATCH", your shell session is in the wrong cwd.
   Recover: `cd "<WORKTREE_PATH_FORWARD_SLASH>"`, re-run the assertion, proceed only when OK.
   Proceeding to Write/Edit after MISMATCH = TASK FAILURE.

======== HARDENED PATH RULES ========
- Every Write/Edit tool call: `file_path` MUST start with `<WORKTREE_PATH>\`.
  Before each Write/Edit, mentally verify the prefix. If the path starts with anything else, STOP and report.
- After your FIRST Write, run Bash: `ls "<absolute_path_you_just_wrote>"` — the output MUST contain the string `<WORKTREE_NAME>` in the resolved path. If not, STOP and report actual output.
- Reading from main is OK (you'll often need CLAUDE.md, shared configs, or reference files). Writes to main = TASK FAILURE.

======== FORBIDDEN PATHS (absolute — TASK FAILURE if violated) ========
Never write to any path matching:
- `**/.git/**`                  (internal git state — yours OR main's)
- `<MAIN_REPO_PATH_FORWARD_SLASH>/**` EXCEPT under `<MAIN_REPO_PATH_FORWARD_SLASH>/.claude/worktrees/<WORKTREE_NAME>/**`
- `<MAIN_REPO_PATH_FORWARD_SLASH>/.claude/worktrees/*/**` where `*` is any name OTHER than `<WORKTREE_NAME>`
  (i.e. never write into a sibling agent's worktree)

Reading these paths is permitted. Only writes are forbidden.

======== MANDATORY FINAL STEPS (no exceptions) ========
At the end, in order:

1. `cd "<WORKTREE_PATH_FORWARD_SLASH>" && git status --short`
   — confirms your changes are staged/unstaged in this worktree.

2. PRE-COMMIT CWD SANITY CHECK:
   Bash: `[ "$(git rev-parse --show-toplevel)" = "<WORKTREE_PATH_FORWARD_SLASH>" ] && echo OK || (echo WRONG_REPO && exit 1)`
   If this errors or prints WRONG_REPO, STOP — do not commit. Report the actual toplevel, actual branch, and actual pwd. The orchestrator will investigate.

3. `git add -A`

4. `git commit -m "<COMMIT_MESSAGE>"`
   If the commit fails with a husky / lint-staged error unrelated to your changes, retry ONCE with:
     `HUSKY=0 git commit -m "<COMMIT_MESSAGE>"`
   Do NOT edit files to appease a pre-commit hook. Report the hook failure verbatim in your report.

   Your deliverable is a COMMIT, not a file tree. An uncommitted change does not count as work
   completed — it counts as TASK FAILURE. The orchestrator has no fallback for uncommitted work
   and will mark your task aborted.

5. `git log -1 --oneline` — paste the output verbatim in your report.
6. `git rev-parse --show-toplevel` — paste verbatim (MUST equal <WORKTREE_PATH_FORWARD_SLASH>).

======== REPORT FORMAT ========
Under 300 words, include:
- Re-anchor statement (your first-response declaration, verbatim)
- First-action verify output (verbatim)
- Write-path assertion result
- Files created / edited with absolute paths
- tsc / build / test result as applicable
- Pre-commit CWD sanity check output
- Final `git log -1 --oneline` and `git rev-parse --show-toplevel`
- Verdict line: "WORKTREE RESPECTED" or "WORKTREE LEAKED — <details>"
```

---

## Post-prefix task brief

After the prefix, write the actual task: context, files to create/edit, spec, acceptance criteria. Be specific — parallel agents cannot ask clarifying questions mid-run.

## Windows-specific reminders for the task brief

- Use **npm**, not pnpm (this repo uses npm workspaces).
- Node version is controlled by project defaults.
- Reading from the main repo is safe; if the agent needs a file from main, give the absolute path.
- If the agent needs to install a new dependency, either install it upfront on main (orchestrator's job) or add explicit `npm install -D <pkg> -w apps/web` instructions.

## What changed in v3 (vs v2)

1. **Two new placeholders** (`<WORKTREE_NAME>`, `<MAIN_REPO_PATH_FORWARD_SLASH>`) enable explicit forbidden-path enforcement.
2. **Re-anchor statement made mandatory and verbal.** Agents must state the correct cwd before any tool call — chain-of-thought commitment is more reliable than passive "ignore that line."
3. **Write-path assertion** (new mandatory first action #2) replaces "mentally verify" with a deterministic Bash probe.
4. **Forbidden-paths section is explicit.** Includes `.git/**` (prevents the #41010-class data-loss bug where a sibling agent's cleanup deletes the wrong worktree), sibling worktrees, and the main repo.
5. **Pre-commit CWD sanity check** catches the case where the shell session drifted mid-task.
6. **Commit-or-fail language is directive, not pleading.** Husky fallback explicitly permitted once.
7. **Report format expanded** to include the re-anchor statement and the sanity-check output, giving the orchestrator a machine-checkable signal that the agent did the right thing.
