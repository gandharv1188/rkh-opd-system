# dis/scripts

Operational scripts for DIS. Not runtime code. All scripts are pure Node
ESM (`.mjs`); no external deps — they must be runnable before
`dis/package.json` exists.

## Phase 1 drift-prevention controls

Implements `02_architecture/drift_prevention.md` §3. Each script exits `1`
with a list of offenders on violation, `0` when clean. All four are
wired as required (blocking) jobs in `.github/workflows/dis-ci.yml`.

| Script                               | Control    | Purpose                                                                                                                         |
| ------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `check-pr-citations.mjs`             | 1          | Verify TDD/CS/DIS-US citations in PR body resolve to real anchors.                                                              |
| `check-files-touched.mjs`            | 2          | Fail when the PR diff touches files outside the ticket's `files_allowed:`.                                                      |
| `fitness.mjs` + `fitness-rules.json` | 3          | Declarative architectural fitness functions (hexagonal + layering).                                                             |
| `check-forbidden-tokens.mjs`         | 7          | Grep production tree for `TODO/FIXME/.only/.skip/...`; honors `// lint-allow: TOKEN — DIS-###`.                                 |
| `port-validator.mjs`                 | 3 (legacy) | Thin wrapper that delegates to `fitness.mjs --only core_no_adapter_imports,ports_no_adapter_imports`. Kept for backward compat. |

Control 10 (orchestrator re-verification sampling) is process-only and
lives in `08_team/review_gates.md` Gate 5.

## Local usage

```bash
# Control 1 — local PR body dry-run
node dis/scripts/check-pr-citations.mjs --body "Implements TDD §4 and CS-1"

# Control 2 — run on the current branch
TICKET_ID=DIS-030 node dis/scripts/check-files-touched.mjs --verbose

# Control 3 — scan the repo
node dis/scripts/fitness.mjs

# Control 7 — scan production sources
node dis/scripts/check-forbidden-tokens.mjs
```

## Self-test

`dis/scripts/__tests__/drift-controls.test.mjs` is a pure-Node smoke
harness (no vitest / no npm install). It exercises `fitness.mjs`,
`check-forbidden-tokens.mjs`, and `check-pr-citations.mjs` against
fixture trees in `dis/scripts/__tests__/fixtures/`.

```bash
node dis/scripts/__tests__/drift-controls.test.mjs
```

Expected output: `5/5 tests passed.` and exit code `0`.
