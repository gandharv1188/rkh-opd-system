---
report: 04-rollout-team-runbooks
last_refreshed: 2026-04-22
source_commit: 69ce4bc
source_paths:
  - dis/document_ingestion_service/06_rollout/
  - dis/document_ingestion_service/08_team/
  - dis/document_ingestion_service/09_runbooks/
covered_files:
  - dis/document_ingestion_service/06_rollout/rollout_plan.md
  - dis/document_ingestion_service/06_rollout/feature_flags.md
  - dis/document_ingestion_service/06_rollout/kill_switch.md
  - dis/document_ingestion_service/06_rollout/comms_and_training.md
  - dis/document_ingestion_service/08_team/RACI.md
  - dis/document_ingestion_service/08_team/review_gates.md
  - dis/document_ingestion_service/08_team/session_handoff.md
  - dis/document_ingestion_service/08_team/agentic_dev_protocol.md
  - dis/document_ingestion_service/09_runbooks/README.md
  - dis/document_ingestion_service/09_runbooks/incident_response.md
  - dis/document_ingestion_service/09_runbooks/key_rotation.md
  - dis/document_ingestion_service/09_runbooks/dr_and_backup.md
  - dis/document_ingestion_service/09_runbooks/migration_incident.md
  - dis/document_ingestion_service/09_runbooks/provider_outage.md
  - dis/document_ingestion_service/09_runbooks/stuck_jobs.md
report_owner: ops-reviewer
confidence:
  rollout: high
  team: high
  runbooks: high
---

## What changed since last refresh

(Empty on first write.)

## Executive summary

DIS rollout is a four-phase gradient: Phase 0 (internal dev+test, 1 week) →
Phase 1 SHADOW (2 weeks, DIS reads all prod traffic but `PromotionService`
is guarded so nothing lands in clinical tables) → Phase 2 OPT-IN (2–4 weeks,
2–6 named reception clerks, nurse verification UI live) → Phase 3 DEFAULT
(2-week soak, DIS is the path, legacy reachable via kill switch) → Phase 4
LEGACY REMOVAL. The cross-phase safety spine is immutable: `DIS_AUTO_APPROVAL_ENABLED=false`
from Phase 0 through Phase 4 exit (CS-7); only `verified`/`auto_approved`
extractions promote (CS-1); `loadRecentLabs`/`get_lab_history` always filter
`verification_status='verified'` (CS-12); raw responses retained forever
(CS-2); kill-switch RTO ≤ 5 min (TDD §18). Every phase transition has numeric
entry+exit criteria and explicit rollback triggers.

The team model is agentic with human veto. Claude (orchestrator) is
Architect/Tech-Lead/QA-Lead; Dr. Lokender Goyal is Product Owner, Clinical
Reviewer (sole veto on `clinical-safety`), and Integration Gatekeeper (sole
veto on `integration`). Seven review gates run in sequence (Pre-start →
Test-first → Implementation → Automated checks → Code review → Conditional
safety/integration/security/breaking → DoD). There is **no emergency
override** on Gates 6a (clinical-safety) or 6b (integration). Agentic
teammates are persistent named agents, isolated per ticket in
`.claude/worktrees/<id>/` via the `windows-parallel-agents` v3 protocol;
each ticket ends with a mandatory `dis/handoffs/DIS-###.md` handoff or
Gate 7 fails.

Operational readiness: 6 executable runbooks covering incident response,
key rotation, DR/backup, migration incidents, provider outages, and stuck
jobs. All runbooks are 3-a.m.-ready: copy-pasteable commands, CS/TDD cross-
refs, POC (Supabase) + Prod (AWS) variants, exit-criteria checklists. The
first rule on every page: *if unclear, flip the kill switch first,
investigate second.* Known gaps: on-call rotation is documented but not
staffed (`TBD` rows in `comms_and_training.md`); paging contacts are not
yet populated; quarterly drills (DR restore, key rotation, kill-switch
game day) are scheduled but none have executed because DIS has not yet
shipped to prod.

---

# PART 1 — ROLLOUT (06_rollout)

## Rollout stages

Four numbered phases plus legacy-removal. Summary table
(`rollout_plan.md:14-20`):

| Phase | Name                | Duration                | Audience                        | Writes to `lab_results`? |
| ----- | ------------------- | ----------------------- | ------------------------------- | ------------------------ |
| 0     | Internal dev + test | 1 week                  | Engineers only                  | No (test env only)       |
| 1     | Shadow mode         | 2 weeks                 | 100% prod traffic; legacy is SoR | No — only `ocr_extractions` |
| 2     | Opt-in              | 2–4 weeks               | 2–6 named reception clerks       | Yes — only for opted-in  |
| 3     | Default             | 2-week soak             | Everyone                        | Yes — DIS default        |
| 4     | Legacy removal      | 1 PR, ≥ 1 wk post-P3    | —                               | Legacy function deleted  |

### Phase transition requirements (must-pass gates)

**Phase 0 → 1** (`rollout_plan.md:41-62`):
- Entry: TDD §1–§20 signed off; M-001..M-008 migrations applied on dev;
  OpenAPI contract tests green; red-team fixture set checked in.
- Exit (numeric): 100% state-transition coverage; all 12 adversarial
  fixtures handled correctly (0 silent failures); unit coverage ≥ 85%;
  P95 end-to-end ≤ 90 s on dev; zero rows in `lab_results`/`vaccinations`
  without an `ocr_extraction_id` (CS-3 DDL test).

**Phase 1 → 2** (`rollout_plan.md:104-133`):
- Entry: Phase 0 exit met; `dis_shadow_diffs` + `dis_shadow_agreement` MV
  deployed; diff worker scheduled (pg_cron every 5 min); kill switch
  tested end-to-end.
- Duration minimum: 10 business days, ~500 real docs.
- Exit: ≥ 500 real docs processed; per-field agreement — summary Jaccard
  ≥ 0.80 median; `lab_values.test_name_normalized` ≥ 90% exact;
  `value_numeric` ±1% on ≥ 95% of paired rows; vaccine name ≥ 90% exact;
  hard-error rate ≤ 3%; P95 ≤ 90 s; cost/doc ≤ ₹0.40; 0 CS-# violations;
  **0 rows** in `lab_results`/`vaccinations` attributable to DIS (hard
  SQL audit).

**Phase 2 → 3** (`rollout_plan.md:203-213`):
- Entry: Phase 1 exit signed off by clinical lead; nurse verification UI
  (DIS-US-010..015) shipped; training completed per `comms_and_training.md`;
  red-team re-run all caught; `get_lab_history`/`loadRecentLabs` filter
  `verification_status='verified'` (CS-12, DIS-US-020).
- Exit: ≥ 300 real docs verified via UI across ≥ 6 operators; edit rate
  ≤ 15%; reject rate ≤ 10%; "verified-but-wrong" from weekly clinician
  audit = 0 for 2 consecutive weeks; P95 upload→verified ≤ 30 min in
  business hours; nurse NPS ≥ 80%; 0 CS-# incidents; all CS-1..CS-12
  integration tests still green on `main`.

**Phase 3 → 4** (`rollout_plan.md:265-271, 288-294`):
- Entry: Phase 2 exit + signed; kill-switch runbook tested in staging
  AND prod; on-call rotation published.
- Soak: 14 consecutive days with edit ≤ 12%, reject ≤ 8%, hard-error ≤ 2%,
  P95 ≤ 90 s, 0 CS-# violations, **kill switch not used** (single use →
  restart the 14-day clock).

**Phase 4 actions** (`rollout_plan.md:296-306`): remove kill-switch branch
from `/ingest` router; delete `supabase/functions/process-document/`;
remove legacy DB triggers + shadow-diff tables; update CLAUDE.md.

## Feature flags

All flags catalogued in `feature_flags.md`. No flag is permitted outside
this catalogue (`feature_flags.md:1-11`).

| # | Flag | Type | Default | Who/Where evaluated | Audit |
| -- | ---- | ---- | ------- | ------------------- | ----- |
| 1 | `DIS_ENABLED` | bool | `false` → `true` at Phase 0 dev / Phase 1 prod (`feature_flags.md:36-42`) | Edge Fn `dis-ingest`/`dis-verify`, browser | `dis_config_audit` |
| 2 | `DIS_KILL_SWITCH` | bool | `false` (`feature_flags.md:54-61`) | `dis-ingest` FIRST instruction | `dis_config_audit` + Slack webhook |
| 3 | `DIS_SHADOW_MODE` | bool | `true` Phase 1, `false` Phase 2+ (`feature_flags.md:75-82`) | `dis-ingest`, `dis-verify` (423 on approve) | `dis_config_audit` |
| 4 | `DIS_OPT_IN_OPERATORS` | csv UUIDs | `""` → `*` at Phase 3 (`feature_flags.md:91-98`) | Browser + server (defense in depth) | full list + diff |
| 5 | `DIS_OCR_PROVIDER` | enum `datalab`\|`claude`\|`onprem` | `datalab` (`feature_flags.md:109-116`) | adapter factory | per-extraction recorded |
| 6 | `DIS_STRUCTURING_PROVIDER` | enum `haiku`\|`sonnet` | `haiku` (`feature_flags.md:128-135`) | adapter factory | per-extraction recorded |
| 7 | `DIS_AUTO_APPROVAL_ENABLED` | bool | `false` **mandated at launch by CS-7** (`feature_flags.md:148-158`) | PromotionService | `dis_confidence_policy` append-only + `dis_config_audit` |
| 8 | `DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE` | int | `100` (`feature_flags.md:167-174`) | FileRouter | `dis_config_audit` |
| 9 | `DIS_MAX_PAGES` | int | `50` (`feature_flags.md:182-189`) | Preprocessor; 413 on excess | `dis_config_audit` |
| 10 | `DIS_MAX_UPLOAD_MB` | int MB | `20` (`feature_flags.md:198-204`) | Browser + server | `dis_config_audit` |

**Flag dominance matrix** (`feature_flags.md:210-220`):
```
DIS_ENABLED=false      → everything off, legacy only
DIS_KILL_SWITCH=true   → legacy regardless of other flags
DIS_SHADOW_MODE=true   → DIS runs but cannot promote; opt-in ignored
OPT_IN_OPERATORS="*"   → everyone
DIS_AUTO_APPROVAL_ENABLED is independent; always gated by
  dis_confidence_policy.enabled (CS-7).
```

**Not a flag** (`feature_flags.md:248-257`): confidence thresholds
(`dis_confidence_policy` rows), prompt versions (git history), schema
versions (versioned JSON files), UI copy.

## Kill-switch

`feature_flags.md:47-64` + `kill_switch.md` entire file.

**What it does** (`kill_switch.md:13-37`):
1. `/ingest` returns **HTTP 503 `UNAVAILABLE`** with `Retry-After`; the
   canonical error envelope from `04_api/error_model.md`; browser falls
   back to legacy `process-document` itself (DIS does **not** proxy —
   see ADR-003: `kill_switch.md:23-25`).
2. `dis-verify` continues to operate on existing extractions — nurses
   can drain the queue.
3. `PromotionService.promote()` still honours verified approvals — WIP
   is not orphaned.
4. Realtime channel stops emitting new events for new uploads.
5. Shadow-diff worker pauses (if Phase 1).

**What it does NOT do** (`kill_switch.md:40-47`): delete extractions,
roll back promoted `lab_results`/`vaccinations`, disable verification UI,
change `DIS_AUTO_APPROVAL_ENABLED`.

**How to flip — three paths** (`kill_switch.md:50-97`):
- **Path A — Supabase CLI (~60 s):** `npx supabase secrets set DIS_KILL_SWITCH=true --project-ref ecywxuqhnlkjtdshpcbc`; optionally force isolate refresh via `supabase functions deploy dis-ingest`.
- **Path B — Supabase dashboard (~2 min):** Project Settings → Edge Functions → Secrets → edit `DIS_KILL_SWITCH` → Deploy `dis-ingest`.
- **Path C — Hot DB row (sub-minute):** UPSERT into `dis_runtime_flags`, then `NOTIFY dis_runtime_flags`; each Edge Function holds a Postgres `LISTEN` and flips in-memory within seconds.

**Who can flip**: On-call engineer at their discretion to turn DIS
**off**. They do **not** need clinical-lead sign-off to kill; they **do**
need clinical-lead sign-off to un-flip (`kill_switch.md:172-174, 210-234`).

**Un-flip procedure** (`kill_switch.md:209-231`): write RCA in
`09_runbooks/incidents/<date>-dis-killed.md` → fix merged + deployed →
red-team re-run all pass → **re-enter shadow mode ≥ 48 h** (4 h if
non-safety) → clinical lead signs off → restore operator list.

**RTO**: flip-to-effect ≤ 5 min, per TDD §18 (`kill_switch.md:7-8`).
Detection signals — all three must be green within 5 min
(`kill_switch.md:116-141`): log line `event=kill_switch_active`; metric
`kill_switch_requests_per_min > 0` and `dis_extractions_created_per_min == 0`
sustained 2 min; SQL probe `SELECT COUNT(*) FROM ocr_extractions WHERE
created_at > now() - interval '2 minutes'` returns 0.

**Test schedule** (`kill_switch.md:240-249`): quarterly game day (Tue am,
24 h notice), pre-Phase-2 and pre-Phase-3 executions in staging, and a
CI synthetic assertion after every Edge Function deploy.

## SLOs / success metrics

Numeric targets cross-referenced from `rollout_plan.md` and summarised
in `comms_and_training.md:228-236`:

| Metric | Target | Source |
| ------ | ------ | ------ |
| P95 end-to-end latency | ≤ 90 s | rollout_plan §Phase 0/1/3 + TDD §18 |
| Per-document cost | ≤ ₹0.40 | rollout_plan.md:127 |
| Hard-error rate | ≤ 3% Phase 1; ≤ 2% Phase 3 | rollout_plan.md:125, 268 |
| Edit rate | ≤ 15% Phase 2; ≤ 12% Phase 3 | rollout_plan.md:205, 268 |
| Reject rate | ≤ 10% Phase 2; ≤ 8% Phase 3 | rollout_plan.md:206, 268 |
| Verified-but-wrong clinician audit | 0 | rollout_plan.md:207-208, 236 |
| P95 upload→verified | ≤ 30 min (biz hrs) | rollout_plan.md:209 |
| Nurse NPS | ≥ 80% | rollout_plan.md:210 |
| Kill-switch RTO | ≤ 5 min | TDD §18 / kill_switch.md:7-8 |
| Queue depth (biz hrs) | < 20 | comms_and_training.md:236 |
| Per-field agreement — summary | Jaccard ≥ 0.80 median | rollout_plan.md:120 |
| Per-field agreement — `test_name_normalized` | ≥ 90% exact | rollout_plan.md:121 |
| Per-field agreement — `value_numeric` | ±1% ≥ 95% | rollout_plan.md:122-123 |
| Per-field agreement — `vaccine_name_normalized` | ≥ 90% exact | rollout_plan.md:124 |
| Unit coverage on DIS core | ≥ 85% | rollout_plan.md:55 |

**Rollback triggers** (auto-page → kill switch) (`kill_switch.md:148-159`):
error rate > 5% / 10-min window; P95 > 180 s / 10-min window; any row
written to `lab_results`/`vaccinations` with linked extraction
`status != 'verified'` (CS-1 violation); Datalab outage > 15 min without
viable `claude` fallback.

## Rollout drift / gaps

- **On-call rotation named as required for Phase 3 entry** (`rollout_plan.md:261`) but `comms_and_training.md:195-201` lists paging contacts as `TBD`. Gate cannot be passed until populated.
- **`kill_switch.md:243-245` promises pre-Phase-2 and pre-Phase-3 staging+prod kill-switch tests**; there is no VERIFY ticket in the backlog wiring this into CI (relates to Phase 8.6–8.9 in `agentic_dev_protocol.md`).
- **`rollout_plan.md:109` requires the diff worker scheduled via pg_cron**; no migration in `03_data/migrations.md` references a pg_cron registration (orientation 02 may verify).
- **`rollout_plan.md:336` Decision Authority row for opt-in operator changes names "Reception lead" as backup**; Reception-lead role is not listed in `RACI.md:9-21` roles table.
- **Vercel path for kill switch** (`kill_switch.md:99-110`) is conditional on `/admin/metrics` UI shipping on Vercel; no ticket in the backlog provisions that surface. Non-blocking today since Path A/B/C cover the RTO.

---

# PART 2 — TEAM (08_team)

## RACI

### Role definitions (one-liners) — `RACI.md:9-21`

| Role | Filled by | One-liner |
| ---- | --------- | --------- |
| Product Owner | Dr. Lokender Goyal | Scope, priorities, clinical sign-off on phases |
| Architect / Tech Lead / QA Lead | Claude (orchestrator) | Owns TDD, backlog, review gates, DoD |
| Clinical Reviewer | Dr. Goyal + any co-clinician | Second human review on every `clinical-safety` ticket; weekly audit |
| Backend Agent(s) | `general-purpose` / `feature-dev:code-architect` | Implement core/adapter/migration tickets |
| Frontend Agent | `general-purpose` + `frontend-design:frontend-design` | Verification UI (new page, not pad/registration) |
| QA Agent | `general-purpose` | Unit + integration + clinical-acceptance tests first |
| SRE / Ops Agent | `general-purpose` | Runbooks, CI, monitoring, deploy |
| Port Validator | `agent-sdk-dev:agent-sdk-verifier-ts` or lint agent | Enforce "core imports no adapter" |
| Security Reviewer | `/security-review` skill + human on demand | Keys, RLS, CI secret scans |
| Integration Gatekeeper | Dr. Lokender Goyal | **Sole** authority to approve tickets touching `web/`, existing Edge Functions, live schema |

### RACI matrix — from `RACI.md:26-40`

(R = Responsible · A = Accountable · C = Consulted · I = Informed.)

| Activity | PO | Architect | Clinical | Backend | Frontend | QA | SRE | Security | IntGate |
| -------- | -- | --------- | -------- | ------- | -------- | -- | --- | -------- | ------- |
| Scope & priorities | **A** | R | C | I | I | I | I | I | — |
| Write / change TDD | C | **A**/R | C | C | C | C | C | C | — |
| Core/adapter ticket | I | A | — | **R** | — | C | — | — | — |
| Verification UI ticket | I | A | C | — | **R** | C | — | — | — |
| Write tests | I | A | — | C | C | **R** | — | — | — |
| Review clinical-safety | C | A | **R** (veto) | C | C | C | — | — | — |
| Integration approval | **R**/A | C | C | — | — | — | — | — | **R** (gate) |
| Migration dry-run / apply | I | A | — | R | — | R | **R** | — | — |
| Key rotation | I | A | — | — | — | — | **R** | C | — |
| Security review | I | A | — | C | C | C | C | **R** | — |
| Rollout phase advance | **R**/A | R | C (veto on safety) | I | I | C | C | I | I |
| Incident response | I | A | C (if clinical) | R | R | R | **R** | C | — |
| Weekly clinical audit | A | I | **R** | — | — | — | — | — | — |

**Key invariants**: Clinical Reviewer is `R` with veto on `clinical-safety`
rows; Integration Gatekeeper is the sole `R` on integration approvals;
SRE is `R` on key rotation, migration apply, and incident response.

## Review gates

Every ticket walks this sequence — no skip, no waive, no combine
(`review_gates.md:5-22`).

| # | Gate | Owner | Pass criterion | Source |
| - | ---- | ----- | -------------- | ------ |
| 1 | Pre-start | Architect | Unique `DIS-###`; TDD ref; numbered testable AC; deps Done; out-of-scope explicit; tags applied | review_gates.md:25-41 |
| 2 | Test-first | QA proposes; Architect approves | Failing test at expected path, tied to AC, committed BEFORE any impl commit | review_gates.md:44-60 |
| 3 | Implementation | Developer | Scope frozen; no out-of-file-list edits; commits `[DIS-###] <summary> — implements TDD §X.Y` | review_gates.md:63-73 |
| 4 | Automated checks | CI | Lint, `tsc --noEmit`, unit+integration, port validator, schema round-trip (if migration), secret scan, OpenAPI valid | review_gates.md:76-94 |
| 5 | Code review | Second agent or human | ≥ 1 Approved; all comments addressed; **reviewer re-runs 20% of VERIFY commands (100% for `clinical-safety`/`integration`)** — records sample in PR comment | review_gates.md:97-112 |
| 6a | **Clinical-safety** | Clinical Reviewer (human) | `CLINICAL APPROVED — <name>, <date>` in PR thread; re-approve if later edits | review_gates.md:118-130 |
| 6b | **Integration** | Integration Gatekeeper (Dr. Goyal) | `INTEGRATION APPROVED — <name>, <date>` with explicit statement of what's integrated | review_gates.md:132-148 |
| 6c | Security | Security Reviewer | `/security-review` run; HIGH/CRITICAL resolved; secret-scan clean; no creds in logs | review_gates.md:150-161 |
| 6d | Breaking-change | Architect | ADR in `02_architecture/adrs/`; consumers updated or follow-up tickets; `BREAKING APPROVED` | review_gates.md:163-174 |
| 7 | Definition of Done | Author + final reviewer | AC evidence linked; docs/OpenAPI/runbook updates; changelog entry; **handoff file `dis/handoffs/DIS-###.md` fully filled in** | review_gates.md:177-196 |

### Clinical-safety emphasis

- Gate 6a triggers on any ticket tagged `clinical-safety` or touching
  extraction→clinical promotion (`review_gates.md:118-120`).
- Gate 5 sampling rises to **100%** for `clinical-safety` and
  `integration` tags (`review_gates.md:110`).
- **No emergency override on Gates 6a or 6b** (`review_gates.md:205-210`).
  If truly urgent, escalate SEV1 via `09_runbooks/incident_response.md` —
  that path has its own authority model and requires post-hoc review.
- Merge method: squash-and-merge feature tickets; rebase-and-merge
  migrations (`review_gates.md:200-202`). Only the Architect merges to
  the main integration branch.

### Ticket tag routing (`RACI.md:57-64`)

| Tag | Effect |
| --- | ------ |
| `clinical-safety` | Clinical Reviewer sign-off; maps to CS-1..CS-12 |
| `integration` | Integration Gatekeeper sign-off; **no auto-merge** |
| `migration` | SRE + Architect joint; CI round-trip test |
| `security` | Security Reviewer sign-off |
| `breaking` | ADR + Architect sign-off |
| `doc-only` | No test requirement; still code-reviewed |

## Session handoff protocol

The mechanism by which agent sessions don't lose context. **Load-bearing
across the entire DIS build** — every agent uses it, and Gate 7 checks
for it (`session_handoff.md:1-11`).

### Two levels (`session_handoff.md:26-34`)

| Level | Writer | When | Path |
| ----- | ------ | ---- | ---- |
| Ticket-level | Every worker agent | End of each ticket, before final commit | `dis/handoffs/DIS-###.md` on the ticket's branch |
| Feature-level | Orchestrator (Architect) | When DIS v1 is merged | `dis/document_ingestion_service/10_handoff/FEATURE_HANDOFF.md` |

### Required fields in `DIS-###.md` (`session_handoff.md:41-147`)

Frontmatter-equivalent header (Agent, Branch, Worktree, Date, Duration,
TDD refs, CS refs, DIS-US refs) plus these eleven sections:

1. **What was built** — concrete deliverables with absolute paths.
2. **Acceptance criteria status** — one line per AC with evidence
   (test name, screenshot, log excerpt, or commit SHA).
3. **Decisions taken during implementation** — per-decision: Context /
   Options / Decision / Reason / Revisit-if. *This is called out as the
   most important section — it captures knowledge the diff alone cannot
   convey (`session_handoff.md:71-74`).*
4. **What was deliberately NOT done** — kept-out scope with reason.
5. **Follow-ups / known gaps** — format `DIS-### (suggested): title —
   reason — urgency S/M/L`.
6. **Files touched** — exhaustive Added/Modified/Deleted.
7. **External dependencies introduced** — npm, env vars, SQL extensions;
   "None." if none.
8. **Tests** — unit/integration/e2e counts; coverage; flaky tests;
   snapshot paths.
9. **Reproducing the work locally** — exact commands from a fresh clone.
10. **Non-obvious gotchas** — future-agent traps.
11. **Verdict** — one line: "Complete, ready for review" / "Partial —
    see §5" / "Blocked — see §5".

### Enforcement

- Gate 7 explicitly checks: *"Session handoff file exists at
  `dis/handoffs/DIS-###.md` and all sections are filled in"*
  (`review_gates.md:193`).
- Omitting the handoff = task failure (`session_handoff.md:262-265`).
- Every dispatch prompt includes a mandatory `SESSION HANDOFF` block
  (`session_handoff.md:255-265`).
- Orchestrator confirms teammate completion by git log + handoff file
  (CLAUDE.md Agentic Team Management).
- No secrets, no PHI in handoffs — opaque IDs only
  (`session_handoff.md:272-275`).

### Feature-level handoff (`session_handoff.md:149-244`)

14 numbered sections: v1 delivery summary; AC vs product brief table;
architecture snapshot; feature-level decisions (ADR list); safety
posture (CS-1..CS-12 evidence, red-team, weekly audit); operational
posture (flags, kill-switch test date, on-call, backup, cost YTD);
Epic G integration; non-goals; suggested roadmap; known tech debt;
repro commands; secrets/config checklist; training status; credits.

## Agentic dev protocol

`agentic_dev_protocol.md` enumerates the rules agents run under. Status
column reflects honest adherence today (Y/P/N) — **ambition is in
Notes, not in Status**.

### The enumerated rules (by phase)

**Phase 0 — Intake** (`agentic_dev_protocol.md:22-32`): 0.1 idea capture,
0.2 problem framing (Y — `north_star.md`), 0.3 prior-art scan (P),
0.4 non-goals declaration (Y — `non_goals.md`).

**Phase 1 — Research** (`agentic_dev_protocol.md:36-47`): 1.1 domain
(P), 1.2 competitive scan (N), 1.3 residency+compliance (P), 1.4 cost
modelling (N), 1.5 spike tickets (N). **Weakest early-stage phase.**

**Phase 2 — Product** (`agentic_dev_protocol.md:51-62`): 2.1 brief (Y),
2.2 user stories + role mapping (Y — `user_stories.md` + `RACI.md`),
2.3 CS-## clinical safety (Y), 2.4 quantitative success (P), 2.5 risk
register (P).

**Phase 3 — Architecture** (`agentic_dev_protocol.md:66-81`): 3.1 TDD (Y),
3.2 sequence diagrams (Y), 3.3 ports & adapters (Y), 3.4 portability (Y),
3.5 data model + migrations M-001..M-008 (Y), 3.6 OpenAPI (Y), 3.7 error
model (Y), 3.8 coding standards (Y), 3.9 ADRs (N — **biggest doc gap**).

**Phase 4 — Planning** (`agentic_dev_protocol.md:85-97`): 4.1 epics (Y),
4.2 Verify-Driven backlog (Y), 4.3 integration-hold (Y —
`integration_hold.md`), 4.4 feature-flag plan (Y), 4.5 rollout (Y doc,
unexecuted), 4.6 kill switch (Y).

**Phase 5 — Agentic build** (`agentic_dev_protocol.md:101-130`):
5.1 persistent named teammates (Y — `dis-squad`), 5.2 worktree isolation
v3 (Y — mandatory on every dispatch), 5.3 ticket dispatch with VERIFY
(Y), 5.4 TDD test-first (P — not CI-enforced), 5.5 parallel waves (Y —
Wave 1/2 run, Wave 3 in progress), 5.6 mid-flight via `SendMessage` (Y),
5.7 session handoff per ticket (Y — Gate 7), 5.8 drift prevention
Phase 1 (P), 5.9 mutation/golden/property-based (P), 5.10 integration
firewall (Y).

**Phase 6 — Verification** (`agentic_dev_protocol.md:134-148`): mostly
planned not exercised — coverage not CI-enforced, integration tests in
Wave 3, re-verification sampling manual, fixture corpus not populated,
red-team adversarial (N), perf harness (N).

**Phase 7 — Release** (`agentic_dev_protocol.md:152-164`): all N because
nothing has rolled out by design (gated on Epic G).

**Phase 8 — Operate** (`agentic_dev_protocol.md:168-197`): runbooks (Y —
six of them); telemetry, cost ledger, alerting, drills, post-mortems,
eval harness all P/N pending prod traffic.

**Phase 9 — Iterate** (`agentic_dev_protocol.md:201-213`): retros (P),
ADR discipline (N), tech-debt register (N), portability dry-run (N).

**Cross-cutting** (`agentic_dev_protocol.md:217-231`): X.1 Secrets
Adapter (P), X.2 PHI scrubbing (P), X.3 WCAG AA (P), X.4 security review
on boundary changes (P), X.5 Conventional Commits + ADRs (P), X.6
append-only audit log (Y — CS-10/11 + M-007), X.7 windows-parallel-agents
v3 (Y).

### "Most urgent" self-assessment (`agentic_dev_protocol.md:270-282`)

The doc itself names 8 items that would compound most: 3.9 ADRs;
5.9 mutation/golden/property tests; 6.4 clinical-acceptance fixtures;
6.7 CI gate checks; 8.1/8.10 observability + nurse-edit dashboard;
8.9 prompt eval harness; 1.4 cost modelling; 5.8 Phase-2 drift
prevention.

## DIS squad model

Two docs describe this: the project-level CLAUDE.md (Agentic Team
Management section, lines in CLAUDE.md as provided in the session-initial
context) and the DIS-level team docs (`RACI.md`, `session_handoff.md`,
`agentic_dev_protocol.md`).

### Spawning (project CLAUDE.md Agentic Team Management bullet 1)

> "Spawn teammates via `Agent` with `team_name` + `name` so they persist
> and are addressable by `SendMessage`. Names (not UUIDs) are canonical."

Cross-refs:
- `agentic_dev_protocol.md:110` — "Named worker agents are created once
  and reused across tickets, so context (memory, tone, conventions)
  accrues instead of being rebuilt per run."
- `RACI.md:14-16` — roles are filled by named subagents from the
  `feature-dev`, `general-purpose`, and `frontend-design` families.

### Isolation (project CLAUDE.md bullet 2)

> "Use the `windows-parallel-agents` skill for every parallel wave;
> each teammate gets its own pre-created worktree under
> `.claude/worktrees/<id>`."

Cross-ref `agentic_dev_protocol.md:111` — v3 protocol enforced, write-
path asserts, forbidden sibling/main writes.

### Dispatch & claim (project CLAUDE.md bullet 3)

> "Track work in `TaskList` (team-scoped); claim via
> `TaskUpdate(owner=<name>)`."

Cross-ref `agentic_dev_protocol.md:112` — each task carries a VERIFY
acceptance section (`verify_format.md`).

### Completion confirmation (project CLAUDE.md bullet 4)

> "Idle ≠ done. Teammates often commit silently then idle. Confirm via
> `git log` on their branch and the presence of a handoff file at
> `dis/handoffs/DIS-###.md`; then mark the task completed yourself."

Cross-refs:
- `session_handoff.md:262-265` — handoff is the *last file written before
  the final commit*; its absence is a task failure.
- `review_gates.md:193` — Gate 7 explicit "handoff exists and all
  sections filled in".

### Health-poking (project CLAUDE.md bullet 5)

> "A recurring `CronCreate` job checks teammate health every 15 min. If
> a branch shows zero commits 30+ min after spawn, send a `SendMessage`
> poke; if still stuck, `shutdown_request` + re-dispatch."

Cross-ref `agentic_dev_protocol.md:120` — `SendMessage` mid-flight
course correction.

### Where the full protocol lives (project CLAUDE.md bullet 6)

> "Full protocol: `dis/document_ingestion_service/08_team/` — RACI,
> review_gates, session_handoff, agentic_dev_protocol."

This orientation report is the readable index for that folder.

## Team drift / gaps

- **Integration gate authority vs. agentic dispatch**: `review_gates.md:205-210`
  says no emergency override on Gates 6a/6b; `incident_response.md:36-42`
  tells on-call to flip the kill switch without clinical sign-off during
  SEV1. These are consistent (killing DIS ≠ merging code) but a future
  reader might conflate them. Worth a one-line cross-ref in
  `review_gates.md`.

- **`agentic_dev_protocol.md:121` claims session handoff §4 documents
  `SendMessage` mid-flight correction implicitly**; `session_handoff.md`
  §4 is actually the feature-level template and makes no mention of
  `SendMessage`. The protocol rule lives in CLAUDE.md Agentic Team
  Management; `session_handoff.md` does not enumerate it. Minor drift.

- **`RACI.md:80-83` references reception/nurse/doctor training**; the
  training plan in `comms_and_training.md:74-126` has the matching
  materials checklist but no traceability table (which ticket generates
  which asset). A single traceability row per checkbox would close the
  gap.

- **Review-gate reviewer sampling (Gate 5 "Control 10")
  (`review_gates.md:108-110`) references `02_architecture/drift_prevention.md`
  Control 10**; orientation 02 should verify that file exists and that
  Control 10 is specifically defined.

- **`RACI.md:83` "on-call rotation defined when we have > 1 admin"** is
  the same gap flagged by `comms_and_training.md:195-201`
  (paging contacts `TBD`) and `rollout_plan.md:261` (Phase 3 entry
  requires "on-call rotation published"). Three docs say "we need this"
  — no ticket tracks it.

---

# PART 3 — RUNBOOKS (09_runbooks)

## Runbook index

From `09_runbooks/README.md:11-18` (edited for clarity with owners from
`RACI.md` and `README.md:20-28`):

| File | Trigger (what pages you here) | Owner | Primary steps summary |
| ---- | ----------------------------- | ----- | --------------------- |
| `incident_response.md` | Anything ambiguous; SEV-triage needed; any CS-# suspicion | Primary on-call (Backend); IC escalates to Clinical Reviewer for SEV1 | Severity classify → page matrix → stabilize (flip kill switch?) → snapshot evidence → comms template → kill-switch decision tree → timeline doc → blameless post-mortem within 72 h |
| `key_rotation.md` | Scheduled 90-day cycle; suspected leak (immediate, ≤ 1 h); provider-forced; employee exit (24 h) | SRE/Ops (primary on-call authorizes; Security lead co-authorizes leaks) | Mint new key at provider → set Supabase secret → redeploy Edge Functions → verify `key_fingerprint` in logs → 5 min grace → revoke old key → log to `ocr_audit_log` |
| `dr_and_backup.md` | Data loss, corruption, accidental delete; quarterly restore drill | Primary on-call (quarterly drill) | Full restore via Supabase dashboard "Restore to new project" OR PITR on RDS → schema diff → fixture re-run → CS-1/CS-3 invariants → DNS / connection-string cutover → post-mortem |
| `migration_incident.md` | A DB migration (M-001..M-009) failed partway | Primary on-call + Architect (migration tag joint review) | STOP runner; DO NOT run next migration; snapshot schema + `schema_migrations`; per-migration recovery paths; lock timeouts; batched backfills; data-safety validation |
| `provider_outage.md` | Datalab/Anthropic errors or latency spike | Primary on-call | Quick triage per-provider → automatic retry behaviour → fallback decision tree (Datalab→Claude OCR, Haiku→Sonnet) → cost ledger watch → reception comms templates → batch re-queue on recovery → CS invariants |
| `stuck_jobs.md` | SEV3 small-scope annoyances: extraction stuck in `ocr`, queue backlog, duplicate promotion (CS-11 — escalate to SEV1 if guard didn't fire), wrong confidence, `pending_review` stale forever, cost spike | Primary on-call (email/ticket, not page) | Per-scenario diagnosis SQL → fix commands → quarantine / dead-letter → regression-test fixture (`aaaa0000-0000-0000-0000-00000000000{1..5}`) |

**Conventions** (`README.md:42-49`): commands copy-pasteable,
`<ANGLE_BRACKETS>` for substitutions, POC = Supabase project
`ecywxuqhnlkjtdshpcbc`, Prod = AWS, all CS-## refer to
`01_product/clinical_safety.md`, all TDD §§ refer to
`02_architecture/tdd.md`.

**First rule** (`README.md:51-57`): *"If anything is unclear, flip the
kill switch and then investigate."* DIS is augmentation — reception
pre-DIS workflow exists, and 30 min of degraded AI is cheaper than one
wrong lab value.

## Incident response

From `incident_response.md`.

### Severity (`incident_response.md:7-13`)

| Level | Definition | Examples |
| ----- | ---------- | -------- |
| **SEV1** | Clinical-safety incident; wrong or unverified data reached a clinical table, Rx, or patient-facing view | Any CS-1/3/5/10/11/12 violation; weekly clinician audit finds verified-but-wrong; CS-8 cross-patient leak |
| **SEV2** | Service degraded but no patient harm | 5xx > 5% for 5 min; OCR outage > 15 min; queue > 200 and rising; failed migration in progress |
| **SEV3** | Individual job stuck; minor anomaly; no user-visible degradation | One extraction stuck in `ocr` > 5 min; cost spike < 3×; one-nurse UI glitch |

### Paging matrix (`incident_response.md:14-20`)

| Severity | Who pages | Within | Kept informed |
| -------- | --------- | ------ | ------------- |
| SEV1 | Primary on-call + Clinical reviewer (Dr. Goyal) + Product owner | 5 min | Hospital admin |
| SEV2 | Primary on-call | 15 min | Secondary SRE |
| SEV3 | Primary (email/ticket) | Next business day | — |

### First 15 minutes — stabilize-snapshot-comms loop
(`incident_response.md:23-79`)

**0–5 min (stabilize):** check `/dis-health`; check kill-switch state
in `dis_confidence_policy`; decide via decision tree
(`incident_response.md:82-93`); if SEV1 or worsening fast, flip kill
switch now via `update dis_confidence_policy set value='false'`.

**5–10 min (snapshot):** capture logs for `dis-ocr`, `dis-structure`,
`dis-promote` via `supabase functions logs --since 30m > /tmp/incident-*.log`;
snapshot failed extraction IDs via `\copy … to '/tmp/incident-extractions.csv'`;
queue depth; 1-hour cost ledger delta.

**10–15 min (comms):** post to `#dis-incidents` with the five-field
template (severity, summary, start, impact, current state, IC, next
update, correlation IDs); for SEV1 also phone Dr. Goyal and log time of
first clinical contact.

### Kill-switch decision tree (`incident_response.md:82-93`)

Any CS-## confirmed? → flip (no debate).
Else 5xx > 5% for 5 min? → transient provider blip < 2 min? → don't flip.
Else → flip.
Else queue > 500 or > 10/min sustained? → flip.
Else → don't flip, diagnose.

### Post-mortem (`incident_response.md:145-155`)

- **Blameless**, 72-hour max from all-clear to published review.
- Required sections: impact / timeline / root cause / contributing
  factors / action items (owner + due date).
- SEV1: review presented to clinical reviewer + product owner; **at
  least one action item must be a test** (fixture / integration /
  CI guard) that would have caught the bug.
- File in `incidents/`; action items become `post-incident`-tagged
  tickets in `07_tickets/`.

### Exit criteria (`incident_response.md:159-168`)

Kill-switch state matches intent; 5xx < 1% for 10 min; queue trending
down; no new alerts for 15 min; SEV1 — clinical reviewer confirms
suspect rows quarantined/corrected; snapshot files moved from `/tmp/`
into incident folder; all-clear comms posted with review date.

## Key rotation

From `key_rotation.md`. Covers `DATALAB_API_KEY`, `ANTHROPIC_API_KEY`,
`DATABASE_URL` / Supabase service-role key.

### Triggers (`key_rotation.md:11-17`)

| Trigger | Urgency | Authorizer |
| ------- | ------- | ---------- |
| Scheduled 90-day | Planned, business hours | Primary on-call |
| Suspected leak | **≤ 1 hour** | Primary + Security lead |
| Provider-forced | Immediate | Primary on-call |
| Employee exit | ≤ 24 h | Primary on-call |

**Rotation is cheap — when in doubt, rotate.**

### Golden rule (`key_rotation.md:21-25`)

> "**Never revoke the old key until the new one is confirmed in use.**
> Cached secrets in Edge Function runtimes live for up to 5 minutes
> (TDD §16). Revoke too early and every in-flight extraction fails."

### POC procedure (Supabase) (`key_rotation.md:28-111`)

1. Mint new key at provider dashboard; tag `dis-poc-<YYYYMMDD>`; copy
   to local scratch file.
2. For Supabase service key only (no overlap window): announce 5-min
   freeze; flip kill switch ON; reset in dashboard; set secret; redeploy;
   unflip.
3. `npx supabase secrets set DATALAB_API_KEY=<NEW>` (or ANTHROPIC…);
   `supabase secrets list` to verify redaction.
4. Redeploy `dis-ocr`, `dis-structure`, `dis-promote` — forces new
   isolate, invalidates ≤ 5-min cache.
5. Smoke-test via `dis_smoke_test.js --fixture discharge_simple`; grab
   `correlation_id`; grep logs for `key_fingerprint=<last-6>` — must
   match new key.
6. Wait ≥ 5 minutes (secret cache TTL per TDD §16); revoke old key at
   provider.
7. Log rotation to `ocr_audit_log` with `action='key_rotation'`, old +
   new fingerprints, reason.

### Prod procedure (AWS) (`key_rotation.md:113-180`)

`put-secret-value` with `AWSPENDING` → promote to `AWSCURRENT` →
`aws ecs update-service --force-new-deployment` for `dis-ocr-worker`,
`dis-structure-worker`, `dis-promote-worker` → wait for
`runningCount == desiredCount` → smoke-test → CloudWatch verify →
mark old version `AWSPREVIOUS` → after 5-min cache window, revoke.

### Verification checklist (`key_rotation.md:184-191`)

Smoke-test green; `key_fingerprint` matches new; new `dis_cost_ledger`
entry; old key rejected via direct `curl` (401); rotation row in
`ocr_audit_log`; next rotation date on calendar (90 days out).

### Rollback if new key fails (`key_rotation.md:194-204`)

Do **not** revoke old yet; re-set secret to old value + redeploy;
confirm extractions succeed; file SEV2; RCA (wrong scope? region?
propagation delay?) before retrying.

**Procedure cleanliness**: high. Every step has a command, an explicit
verification signal (`key_fingerprint`), a conservative grace window, a
log target, and a rollback. The one rough edge is the Supabase
service-role case where there's no overlap window — doc handles it via
an explicit 5-min freeze + kill switch flip, which is the right call
but depends on runbook readers noticing the §Step 1b callout.

## Disaster recovery

From `dr_and_backup.md`.

### Backup inventory (`dr_and_backup.md:7-16`)

| Asset | Medium | POC | Prod | Retention |
| ----- | ------ | --- | ---- | --------- |
| DB full dump | Supabase auto | Daily 02:00 IST | RDS PITR continuous | 30 d POC / 35 d Prod |
| DB logical dump | `pg_dump` → `documents` bucket | Daily 02:30 IST cron | S3 `dis-backups` | 90 d |
| `raw_ocr_response` | In-DB + quarterly export | Per DB freq | S3 `dis-ocr-raw` | **Forever (CS-2)** |
| `raw_structured_response` | In-DB | Per DB freq | Same | **Forever (CS-2)** |
| `documents` bucket | Supabase replication | Continuous | S3 cross-region | **Forever (CS-2 spirit)** |
| Skill/config | Git | On commit | Same | Forever (git) |
| `dis_confidence_policy` | Within DB dump | Per DB freq | Same | 90 d |

> "The only irreplaceable data is the raw OCR and raw structured
> responses (CS-2). Losing them means we cannot audit past AI
> decisions, so backup of `ocr_extractions` takes priority over every
> other recovery objective." (`dr_and_backup.md:19-22`)

### RTO / RPO targets (`dr_and_backup.md:24-29`)

| Environment | RTO | RPO |
| ----------- | --- | --- |
| POC (Supabase) | 4 hours | 24 hours |
| Prod (AWS RDS) | 1 hour | 5 minutes (PITR) |

RTO breach → escalate to SEV1 because clinical-safety impact grows with
downtime on verified data.

### Restore paths

- **POC full restore**: Supabase dashboard → Backups → "Restore to new
  project" (never over live) → verify via preview Edge Functions →
  acceptance suite → cutover by updating hardcoded URLs + redeploying
  `web/` (`dr_and_backup.md:37-49`).
- **POC logical restore** (DIS tables only): download yesterday's
  `pg_dump` from `documents/backups/` → create `dis_restore` schema →
  `pg_restore --data-only -d` for `ocr_extractions`, `ocr_audit_log`,
  `dis_jobs`, `dis_cost_ledger`, `dis_confidence_policy` → compare,
  merge, swap under kill-switch (`dr_and_backup.md:53-68`).
- **Prod PITR**: `aws rds restore-db-instance-to-point-in-time` with
  `--restore-time` → wait `available` → point preview stack →
  acceptance → promote by updating `DATABASE_URL` in Secrets Manager +
  rolling ECS (`dr_and_backup.md:74-92`).
- **Prod snapshot fallback**: `describe-db-snapshots` →
  `restore-db-instance-from-db-snapshot` (`dr_and_backup.md:94-107`).
- **Storage**: POC `supabase storage download --version <VID>`; single-
  object only. **Known gap**: "bulk recovery, request a bucket-level
  restore via Supabase support (POC). This is the single biggest gap in
  our POC DR plan — documented and tracked." (`dr_and_backup.md:121-124`).
  Prod `s3api list-object-versions` + `copy-object` from versioned
  replica.

### The irreplaceable column (`dr_and_backup.md:139-161`)

`ocr_extractions.raw_ocr_response` safeguards: never updated (RLS
forbids); weekly cron export to POC `documents/backups/raw_ocr_weekly/<YYYY-WW>.jsonl.gz`
or Prod S3 `dis-ocr-raw-prod` with **Object Lock (compliance mode, 7
years)**; quarterly audit samples + re-parses. Recovery script
`dis_restore_raw_ocr.js --mode insert-missing` — inserts only; never
overwrites (CS-2: append-only).

### Quarterly restore drill (`dr_and_backup.md:163-188`)

Owner primary on-call; cadence once per calendar quarter. Procedure:
pick backup 7–30 days old → restore to scratch (never touch live) →
point preview → run acceptance checks → tear down → log to
`incidents/dr-drill-<quarter>.md`. **Tested vs paper**: paper only
today — no drill has been run, because DIS has no prod data yet.

Pass criteria table includes: schema diff vs `expected_schema.sql`;
row counts within 5% of prior drill; clinical-acceptance fixtures pass;
CS-3 invariant holds (no `ai_extracted` with null `ocr_extraction_id`);
20/20 `raw_ocr_response` non-null; stopwatched RTO ≤ target;
`dis_enabled` in restored policy = `false`.

### Data-loss post-mortem (`dr_and_backup.md:212-221`)

Any real (non-drill) restore = SEV1 **even if recovered**. Action items
must include ≥ 1 new monitoring check that would have detected loss
sooner. Clinical reviewer signs off on all-clear.

## Runbook gaps

- **`clinical_safety.md` §Out-of-band safeguards is referenced in
  `kill_switch.md:161-163` and `rollout_plan.md:208`** but the README's
  cross-ref list (`09_runbooks/README.md:75-84`) doesn't enumerate it.
  Worth an explicit row.

- **Promised but absent**: the README's "What lives elsewhere" list
  (`09_runbooks/README.md:75-84`) mentions `05_testing/` as the home of
  acceptance fixtures; `agentic_dev_protocol.md:143` (row 6.4) says
  "corpus not yet populated". Every runbook that ends in "run
  `dis_acceptance.js`" or `dis_smoke_test.js` quietly assumes fixtures
  exist. If those fixtures lag further, DR drill pass criteria and
  key-rotation smoke test both become smoke only.

- **`incident_response.md:50-52`** refers to `supabase functions logs
  --since 30m`. The README doesn't document a retention window for
  Edge Function logs. If Supabase's default retention is short and no
  log forwarder is wired (no ticket visible), incidents older than
  retention will miss `/tmp` log snapshots.

- **`provider_outage.md:207` pins model via `DIS_STRUCTURING_MODEL`
  with a dated suffix** (e.g. `claude-haiku-4-5-20260115`);
  `feature_flags.md:124-135` flag `DIS_STRUCTURING_PROVIDER` is only
  `haiku|sonnet` (no dated pin). The runbook references a flag the
  feature-flag catalogue doesn't name. Either add `DIS_STRUCTURING_MODEL`
  to `feature_flags.md` or update the runbook to match.

- **`stuck_jobs.md:8-17` sample fixture IDs
  (`aaaa0000-0000-0000-0000-00000000000{1..5}`)** rely on
  `dis_load_test_fixtures.js` existing. That script is not referenced
  in any existing backlog ticket (orientation 02 may verify).

- **`dr_and_backup.md:121-124` bulk-recovery gap on Supabase Storage**
  is self-called-out as the "single biggest gap in our POC DR plan".
  The remediation path is "request support" — no ticket, no timer.

- **`migration_incident.md:51-59` presumes `.rollback.sql` files exist
  for every migration** (CI tests forward/back/forward). Orientation 02
  should verify M-001..M-009 all ship with a rollback.

- **Every runbook is dated 2026-04-20** (`README.md:101-103`). No
  runbook has TODOs within, but `comms_and_training.md:195-201`
  paging-contacts table is entirely TBD — that is the live gap for
  being able to execute any of these runbooks at 3 a.m.

---

# COMMON SECTIONS

## Cross-references observed

Load-bearing chains connecting 06 / 08 / 09:

- **Rollout → gates → handoffs**: `rollout_plan.md:259` "Runbook
  `09_runbooks/kill_switch.md` tested in staging and prod" gates Phase 3
  entry; `kill_switch.md:240-249` schedules the tests; `review_gates.md`
  Gate 7 enforces a handoff for every test ticket; handoff format is
  `session_handoff.md` §3.

- **Review gates → RACI → conditional sign-offs**: `review_gates.md:118-148`
  points to Clinical Reviewer and Integration Gatekeeper roles defined in
  `RACI.md:16-21`; the latter two roles are sole-veto authorities — the
  single most load-bearing team control.

- **Kill switch → incident response → post-mortem → ticket backlog**:
  `kill_switch.md:147-175` automatic triggers correspond to
  `incident_response.md:82-93` decision tree; action items from
  `incident_response.md:145-155` land as `post-incident`-tagged tickets
  in `07_tickets/`.

- **CS-##-numbered invariants** thread through every doc: `CS-1` (only
  verified promotes) is cited in `rollout_plan.md:322`, `feature_flags.md`
  kill-switch notes, `incident_response.md:10`, `provider_outage.md:190-194`;
  `CS-2` (raw forever) drives `dr_and_backup.md:18-22, 139-161`; `CS-7`
  (auto-approval off) governs `feature_flags.md:142-159` and `rollout_plan.md:320`;
  `CS-11` (dedupe) has its own section in `stuck_jobs.md:132-181` and
  migration M-007 in `migration_incident.md:127-138`; `CS-12` (reader
  filter) gates Phase 2 entry in `rollout_plan.md:197-198` and is a
  cross-phase invariant (`rollout_plan.md:323-325`).

- **ADR-003 is cited in `kill_switch.md:23-25`** as the decision that
  "kill switch returns 503" (vs. "kill switch proxies to legacy") —
  load-bearing ADR, but `agentic_dev_protocol.md:81` row 3.9 still says
  "No `adr/` folder". Contradiction: the reference exists, the folder
  doesn't (orientation 02 should confirm).

- **Handoff protocol → Gate 7 → agent dispatch**: `session_handoff.md:253-265`
  defines the mandatory SESSION HANDOFF prompt block; `review_gates.md:193`
  encodes the check; project CLAUDE.md Agentic Team Management bullet 4
  anchors the orchestrator's completion-confirmation workflow around the
  same artefact. This is the single most-used control in the build today.

## Drift, gaps, contradictions (CRITICAL)

Prioritised across all three folders.

1. **Kill-switch implementation reference vs. claimed behaviour.**
   `kill_switch.md:16-25` specifies HTTP 503 with `Retry-After` and cites
   ADR-003; `feature_flags.md:49-65` describes flag mechanics via
   `dis_runtime_flags` + `LISTEN/NOTIFY` (Path C). `agentic_dev_protocol.md:81`
   row 3.9 says ADRs don't exist. The ADR reference in `kill_switch.md`
   is therefore either (a) drift (ADR-003 does not exist), or (b) the
   ADR was created outside the documented `adrs/` folder. Orientation 02
   must confirm.

2. **Review gate 6b Integration vs. backlog VERIFY coverage.**
   `review_gates.md:132-148` asserts "no auto-merge" on `integration`-tagged
   tickets. `agentic_dev_protocol.md:129` row 5.10 confirms `integration_hold.md`
   physically holds Epic G (DIS-200..207). There is no VERIFY-* task
   named in the orchestrator handoffs that explicitly asserts the
   gatekeeper check in CI — merge protection relies on human discipline.
   This is enforceable via a GitHub branch rule; worth a ticket.

3. **Runbook references to tools not confirmed to exist.**
   - `dis_smoke_test.js` (`key_rotation.md:80, 157`)
   - `dis_requeue_failed.js` (`provider_outage.md:173-179`)
   - `dis_load_test_fixtures.js` (`stuck_jobs.md:17`)
   - `dis_acceptance.js --suite clinical-core` (`dr_and_backup.md:183, 202, migration_incident.md:199`)
   - `dis_cs_invariants.sql` (`dr_and_backup.md:206`)
   - `dis_restore_raw_ocr.js` (`dr_and_backup.md:156`)

   `agentic_dev_protocol.md:143` (row 6.4) states fixture corpus not
   yet populated; the existence/shape of these scripts needs to be
   confirmed against `radhakishan_system/scripts/` (orientation 03
   covers scripts).

4. **RACI role absent from recent ticket assignments.**
   `RACI.md:18` names Port Validator as `agent-sdk-dev:agent-sdk-verifier-ts`.
   Review gates Gate 4 (`review_gates.md:88`) encodes the check as
   "Port validator passes: no import from adapters/ inside core/ or
   ports/". Recent DIS-021* work involved core/adapter boundary fixes
   — orientation 03/05 should verify a Port-Validator sign-off actually
   happened on those PRs.

5. **Paging contacts TBD is a hard gate for multiple phases.**
   - `rollout_plan.md:261` Phase 3 entry requires on-call rotation
     published.
   - `incident_response.md:17-19` routes SEV1 to "Primary on-call +
     Clinical reviewer + Product owner within 5 min" — names only for
     Clinical reviewer (Dr. Goyal).
   - `comms_and_training.md:195-201` paging-contacts table: six rows,
     five are TBD.
   - `RACI.md:83` "on-call rotation defined when we have > 1 admin" —
     acknowledged as a pending prerequisite.

   **No ticket in any backlog tracks closure of this gap.** It is the
   single largest operational-readiness risk today.

6. **DIS_STRUCTURING_MODEL (dated pin) vs. DIS_STRUCTURING_PROVIDER (enum).**
   `provider_outage.md:207-209` references a dated-model pin flag;
   `feature_flags.md:123-135` only defines the 2-value enum. Either the
   catalogue is incomplete (feature-flag doc owes a new entry) or the
   runbook is pre-emptive. No VERIFY covers reconciliation.

7. **Training assets vs. phase gates.**
   `rollout_plan.md:193-196` lists training completion as a Phase-2
   entry criterion; `comms_and_training.md:74-126` enumerates the
   materials. None of those materials are tracked in the backlog with a
   DIS-### ID (orientation 03 tickets + orientation 01 product may
   verify). No Responsible owner per RACI row, beyond "reception lead"
   / "nurse lead" who are themselves TBD.

8. **`agentic_dev_protocol.md:121` drift** — claims `SendMessage` is
   documented in `session_handoff.md §4`; `session_handoff.md §4` is
   actually the feature-level template. Minor editorial drift.

9. **`review_gates.md:110` Control 10 reference** to
   `02_architecture/drift_prevention.md` — that file is outside this
   orientation's source paths; orientation 02 should confirm the file
   exists and Control 10 is defined (reviewer sampling % percentages).

## Refresh instructions for next session

Re-read changes since `69ce4bc` in the three source paths:

```bash
git log --name-only 69ce4bc..HEAD -- \
  dis/document_ingestion_service/06_rollout/ \
  dis/document_ingestion_service/08_team/ \
  dis/document_ingestion_service/09_runbooks/
```

Then:
- **Runbook added?** Append a new row to the Runbook index table, the
  README has likely also updated — reconcile owners and triggers. Add a
  cross-ref in the Drift/Gaps section if the runbook depends on scripts
  or fixtures not yet tracked in the backlog.
- **Review gate changed?** Update the Review Gates table, verify the
  sampling percentages in Gate 5 still match `02_architecture/drift_prevention.md`
  Control 10, and check that any new gate does not conflict with
  "no emergency override on 6a/6b".
- **RACI role changed?** Update the roles and matrix tables; verify the
  sole-veto authorities for Clinical Reviewer and Integration Gatekeeper
  are intact.
- **Feature flag added or default changed?** Update the flag catalogue
  table; check the dominance matrix for new interactions.
- **Phase exit criterion changed?** Update the corresponding Phase
  section in Part 1 and the SLO table.
- **Paging contacts finally populated?** Move them out of the gaps list
  — this is the single largest live operational risk.

Bump `last_refreshed` and `source_commit` in the frontmatter.
