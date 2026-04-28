# H4 — Safety overhaul plan (2026-04-28 working session)

> _Last updated: 2026-04-28_

## Status banner

- ✅ **Sprint 1 ready to start.**
- 📄 37 decisions captured in `radhakishan_system/docs/system/15-decisions-2026-04-28.md`.
- 📄 5-sprint plan at `radhakishan_system/docs/system/16-implementation-plan.md`.
- ✅ Customer (Dr. Goyal) has signed off on all decisions.
- 🔐 **Token rotation due** — `sbp_` token in `.mcp.json` was exposed in chat history; rotate before resuming.
- ⚠️ **Working tree has uncommitted state** — see "Working tree status & how to recover" below.
- ✅ **`dis/` (Document Ingestion Service) work is SAFE** on `feat/dis-plan` branch (locally + `origin`). Snapshot backup at `origin/feat-dis-plan-snapshot-2026-04-21`. See recovery instructions below.

---

## Working tree status & how to recover (read this first)

> **🔴 IMPORTANT — Your `dis/` feature work is SAFE.** It is committed to the **`feat/dis-plan`** branch (locally and on `origin`). It is *not* in `git stash` and not in this session's working tree. Details below.

There is **no `git stash`** (`git stash list` is empty). Everything in the current working tree is either modified, deleted, or untracked from this session's documentation work.

---

## ⭐ How to get the `dis/` feature work back

Your `dis/` feature (Document Ingestion Service — DIS-156, DIS-157, DIS-158, DIS-169, DIS-174, DIS-175, Epic F observability, Wave-7 wrap-up) is on the `feat/dis-plan` branch.

### To switch to that work and continue

```bash
# Save anything from this session you don't want to lose:
git status                                       # review what's uncommitted
git add . && git commit -m "wip: 2026-04-28 docs"  # OR git stash push -u -m "session-2026-04-28-wip"

# Switch to the dis/ feature branch:
git checkout feat/dis-plan

# Verify you have all the dis/ work:
ls dis/                                           # should show full DIS structure (not just node_modules + ui)
git log --oneline -10                             # tip is 8c2cafb "docs(wave-7): record Wave-7..."
```

### To merge `dis/` into `main` later (after Sprint 1 completes)

```bash
# Make sure both branches are up to date with origin:
git fetch --all --prune
git checkout main && git pull
git checkout feat/dis-plan && git pull

# Merge dis/ into main:
git checkout main
git merge --no-ff feat/dis-plan -m "merge: feat/dis-plan into main (DIS service complete)"
git push origin main
```

### Backup branches that exist on `origin` (in case `feat/dis-plan` is ever lost)

```bash
git fetch --all --prune
git branch -a | grep dis   # shows: origin/feat-dis-plan-snapshot-2026-04-21 (snapshot backup)
```

If `feat/dis-plan` ever gets deleted by mistake, recover from the snapshot:
```bash
git checkout -b feat/dis-plan origin/feat-dis-plan-snapshot-2026-04-21
```

### Reflog as last-resort recovery

Even if both branches are deleted, the reflog preserves every commit you've made on this machine for ~90 days:
```bash
git reflog --date=short | grep -E "(dis|DIS)"
```
Find the SHA, then `git checkout -b feat/dis-plan-recovered <SHA>`.

---

## Other working-tree state (this session only)

### What's in the working tree right now

| State | File | Meaning | Keep? |
|---|---|---|---|
| `M` modified | `supabase/functions/generate-prescription/index.ts` | Staged model swap Sonnet 4 → Sonnet 4.6 (lines 518, 635). Will deploy in Sprint 1. | **Keep** |
| `D` deleted | `radhakishan_system/docs/system/10-index-proposal.md` | Pre-existing deletion from before this session. Was the trigram-index proposal. We later decided in this session to **skip** Fix 4 (trigram indexes) so the deletion is consistent with current plan, but the file still has historical value. Decide whether to commit the deletion or restore. | Probably **restore** for history |
| `??` untracked | `radhakishan_system/docs/system/11-ai-implementation-audit.md` | AI audit doc | **Commit** |
| `??` untracked | `radhakishan_system/docs/system/12-standard-rx-flow-gap.md` | Std Rx trace | **Commit** |
| `??` untracked | `radhakishan_system/docs/system/13-ai-architecture-research.md` | Architecture research | **Commit** |
| `??` untracked | `radhakishan_system/docs/system/14-prompting-and-instruction-following-research.md` | Prompting research | **Commit** |
| `??` untracked | `radhakishan_system/docs/system/15-decisions-2026-04-28.md` | Decisions record | **Commit** |
| `??` untracked | `radhakishan_system/docs/system/16-implementation-plan.md` | Sprint plan | **Commit** |
| `??` untracked | `.claude/handoffs/H4-*` | This file + transcript recap | **Commit** |
| `??` untracked | `radhakishan_system/scripts/_diag/`, `diagnose_io.out.txt`, `diagnose_io_clean.sql`, `run_diagnose.sh`, `health_check.js` | Diagnostic helpers used during the session. May be useful for future re-runs. | **Decide:** keep `run_diagnose.sh` and `diagnose_io_clean.sql`; gitignore `.out.txt` outputs and `_diag/` |
| `??` untracked | `image.png` | Screenshot from session | Delete |
| `??` untracked | `dis/` (just `node_modules/` + `ui/` here on `main`) | Stale leftover from when `feat/dis-plan` was checked out. The real DIS work lives on `feat/dis-plan` branch. | Delete from `main` working tree (safe — full content is on `feat/dis-plan`) |
| `??` untracked | `.claude/worktrees/` | Worktree for `fix/io-indexes` (`80dff74`). Used during diagnostic work. | Decide: keep until `fix/io-indexes` is merged or removed via `git worktree remove` |

### Recovering the deleted file

```bash
# Restore 10-index-proposal.md from HEAD (does NOT lose any other work):
git restore radhakishan_system/docs/system/10-index-proposal.md

# Or, if you decide the deletion was intentional, commit it explicitly:
git add radhakishan_system/docs/system/10-index-proposal.md
git commit -m "docs(system): remove obsolete 10-index-proposal (Fix 4 dropped per 2026-04-28 review)"
```

### Recovering the staged Edge Function model edit

If for any reason you need to revert the Sonnet 4.6 model edit before Sprint 1 ships:

```bash
git restore supabase/functions/generate-prescription/index.ts
```

This brings back the original `claude-sonnet-4-20250514` strings on lines 518 and 635.

### Recommended commit before Sprint 1 starts

```bash
git add radhakishan_system/docs/system/11-ai-implementation-audit.md \
        radhakishan_system/docs/system/12-standard-rx-flow-gap.md \
        radhakishan_system/docs/system/13-ai-architecture-research.md \
        radhakishan_system/docs/system/14-prompting-and-instruction-following-research.md \
        radhakishan_system/docs/system/15-decisions-2026-04-28.md \
        radhakishan_system/docs/system/16-implementation-plan.md \
        .claude/handoffs/H4-2026-04-28-safety-overhaul-plan.md \
        .claude/handoffs/H4-2026-04-28-session-transcript.md

git commit -m "docs(system): capture 2026-04-28 review — 37 decisions, sprint plan, AI audit, std Rx gap"
```

Do **NOT** include the staged `generate-prescription/index.ts` edit in this commit — it ships with Sprint 1 along with the prompt and schema changes.

### How to back-out everything from this session if needed (nuclear option)

You don't need this — the IO commit `1d80756` is good and proven. But if you ever needed to back out *only* this session's local-tree changes (preserving committed history):

```bash
# Save unsaved work first as a stash so nothing is lost:
git stash push -u -m "2026-04-28 session local state backup"

# Verify the stash:
git stash list   # should now show: stash@{0}: On main: 2026-04-28 session local state backup

# Working tree is clean. To restore:
git stash pop stash@{0}
```

The committed history (everything up to and including `1d80756`) is **already pushed to origin** and is safe — it cannot be lost from a local working-tree mistake.

---

## TL;DR

- **What we found:** the IO budget warning was 97% caused by Realtime polling, not the 4 fixes originally proposed. Customer's "AI drops/adds meds" complaint was real and confirmed in 5/8 recent prescriptions.
- **What we decided:** 37 decisions across AI safety, dose math, security, schema, audit. Doc 15 is the source of truth.
- **What's already shipped:** commit `1d80756` cut DB IO ~95% (Realtime → 60s poll, autosave 30s removed). Realtime publication disabled in dashboard. Verified via `pg_stat_statements`.
- **What's queued:** Sprint 1 (3 days) — temperature 0, requested_medicines schema, Std Rx button rules, formulary fallback message rewrite, model upgrade to Sonnet 4.6, UHID masking. Then Sprints 2–5.
- **Where to start tomorrow:** rotate Supabase token, commit pending docs, open `core_prompt.md` and the Edge Function, follow the Sprint 1 task list in doc 16.

---

## What's already in production

| Change | Commit / Action | Verified |
|---|---|---|
| Realtime WebSocket → 60s poll | `1d80756` (pushed) | ✅ Chrome DevTools showed no WS, 60s poll firing |
| Autosave 30s timer removed | `1d80756` (pushed) | ✅ `autoSaveTimer` is `null` in browser |
| Realtime publication disabled | Manual dashboard toggle | ✅ `pg_stat_statements` shows 0 new realtime calls |
| `.mcp.json` configured | Local config (gitignored) | ✅ MCP tools work |

The Edge Function model swap (Sonnet 4 → Sonnet 4.6) is **staged in working tree but NOT deployed** — will deploy with Sprint 1.

---

## Files the engineer will need in Sprint 1

### `supabase/functions/generate-prescription/index.ts`
- **line 308** — replace `"Use your clinical training knowledge for dosing"` with structured error payload telling AI to add to `omitted_medicines[]` with reason `"not_in_formulary"` (decision 37)
- **lines 56–151** — tool definitions; update `get_standard_rx` description; `compute_doses` tool added in Sprint 2
- **lines 510–525** (main loop) and **627–640** (fallback) — add `temperature: 0` to API body (decision 36)
- **line 429** — mask UHID in `console.log` (first 4 + last 4 chars) (decision 15)
- **lines 658–678** (`extractJSON`) — add validation for new schema fields `requested_medicines`, `omitted_medicines`, severity tier (decisions 1, 8)
- **around line 757** — add server-side completeness check + auto-retry-once (decision 1)
- **around line 760** — append server-computed severity using `max(server, AI)` rule (decision 8)

### `radhakishan_system/skill/core_prompt.md`
- **REMOVE** the line saying *"ALWAYS call get_standard_rx when a diagnosis is provided"*
- **REMOVE** the sentence *"USE STANDARD PRESCRIPTION — include ALL first-line drugs"* that the front-end currently appends
- **ADD** XML-tagged Step-1 enumeration prompt for `requested_medicines` (decision 1)
- **ADD** Std Rx button rules — OFF: only doctor's drugs; ON: protocol drugs allowed but tagged `"AI suggestion"` (decision 2)
- **ADD** the full menu of `(icd10, diagnosis_name)` pairs from `standard_prescriptions` (decision 6 part a)
- **ADD** the doctor-authority rule, brand-name format rule, Hindi rules

### `web/prescription-pad.html`
- Std Rx chip (~line 1910–1918) — change default state to **OFF**, reset on patient change (decision 32)
- Generate POST body (~lines 4899–4903) — add `doctor_selected_protocol` block when Std Rx is ON (decision 2)
- Banner + acknowledge-checkbox UI components near the Sign button (decisions 7, 10, 31) — use the same component for fallback / allergy / high-severity gates

### `radhakishan_system/schema/`
- New migration: install `pg_trgm` extension + GIN trigram index on `standard_prescriptions.diagnosis_name` (decision 6 part b)
- New table: `prescription_audit` (decision 18)

---

## Open items needing customer input before Sprint 3

- Exact list of users to provision in Supabase Auth: doctor name + nurse names (3-4) + reception names (2-3).
- Confirm a dev-only Supabase project ref string for the `create_sample_data.js` guard (decision 20).

---

## Known gotchas / context an engineer would miss

- **Supabase MCP is read-only** by design. `DROP PUBLICATION`, `pg_stat_statements_reset()`, and any DDL will fail through MCP. Use the Supabase SQL Editor for those.
- **`pg_stat_statements` accumulates** across the entire 6-week stats window. To measure post-fix impact, take snapshot deltas, not raw values.
- **`.mcp.json` access token was exposed** in the working session's chat history. Rotate at https://supabase.com/dashboard/account/tokens and edit `.mcp.json` line 10.
- **Customer's biggest pain point is medication omission/addition** — Sprint 1 success criteria is the doctor running 5 live test prescriptions and confirming the silent additions/drops are gone.
- **`web/dose-engine.js` is the source-of-truth** for dose math (per `CLAUDE.md`). Never override silently. Don't let the AI emit numbers without going through this engine — that's the Sprint 2 work.
- **Standard Rx contamination is a prompt-string problem**, not an architectural one. Today's `core_prompt.md` literally says *"include ALL first-line drugs from the hospital standard protocol"* — that's the smoking gun and it's gone in Sprint 1.
- **Edge Function deploys are NOT auto-deployed** by GitHub Pages CI. Run `npx supabase functions deploy generate-prescription --project-ref ecywxuqhnlkjtdshpcbc` manually.
- **The current session transcript** (raw, 3.4 MB) is at:
  `C:\Users\gandh\.claude\projects\E--projects-AI-Enabled-HMIS-radhakishan-prescription-system-folder-radhakishan-prescription-system\c0ce08d8-3fc7-4b59-bf5a-fcd89b0b889a.jsonl`
  — for reference. The curated narrative is at `H4-2026-04-28-session-transcript.md`.

---

## Where to start tomorrow

1. **Confirm `dis/` work is safe.** Run `git branch -a | grep dis` and `git log feat/dis-plan -1 --oneline`. You should see `8c2cafb docs(wave-7): record Wave-7 (Epic F Observability, 27/31 tickets) in done.md`. ✅ DIS work is committed and pushed.
2. **Rotate the Supabase token.** Generate new at https://supabase.com/dashboard/account/tokens, paste new value into `.mcp.json` line 10, revoke the old one. Restart Claude Code.
3. **Read** `radhakishan_system/docs/system/15-decisions-2026-04-28.md` (decisions) and `16-implementation-plan.md` (sprint plan) in order.
4. **Commit pending docs** using the recommended `git add` + `git commit` block above.
5. **Start Sprint 1 first commit:** edit `core_prompt.md` (remove protocol-include lines + add enumeration + add Std Rx rules + add ICD-10 menu) and `generate-prescription/index.ts` (temperature 0 + UHID masking + structured formulary error). This is the smallest, highest-leverage change.
6. **Deploy Edge Function** + push web changes.
7. **Test live** with 3 patient scenarios from `doc 14 Section F` (HETANSHI, BHAVYANSH, VAIDIKA). Verify silent additions and drops are gone.
8. **Get doctor sign-off** via 5 live test prescriptions before continuing to Sprint 2.

_End of handoff._
