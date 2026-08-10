---
meta: source-manifest
written: 2026-04-22
source_commit: 69ce4bc
---

# Source Manifest — Orientation Package

> Aggregated record of which source paths each of the six orientation reports covers. Use this as the index when running the refresh protocol. Canonical per-report coverage lives in each report's own frontmatter; this file is the aggregated view.

## Report → source-paths index

| Report | Primary source paths | Cross-references |
|--------|----------------------|------------------|
| `01-overview-product.md` | `dis/document_ingestion_service/00_overview/` `dis/document_ingestion_service/01_product/` | `02_architecture/` (cross-ref only), `08_team/RACI.md` (clinical reviewer), `07_tickets/` (ticket traceability) |
| `02-architecture.md` | `dis/document_ingestion_service/02_architecture/` (incl. all `adrs/`) | `00_overview/` (north star), `04_api/` (HTTP surface), `05_testing/` (verify format), `07_tickets/` (VERIFY gates), `08_team/` (review gates) |
| `03-data-api-testing.md` | `dis/document_ingestion_service/03_data/` `dis/document_ingestion_service/04_api/` `dis/document_ingestion_service/05_testing/` | `02_architecture/` (ports, ADRs), `01_product/clinical_safety.md` (CS-1..CS-12), `06_rollout/` (kill-switch 503), `07_tickets/backlog.md` (VERIFY) |
| `04-rollout-team-runbooks.md` | `dis/document_ingestion_service/06_rollout/` `dis/document_ingestion_service/08_team/` `dis/document_ingestion_service/09_runbooks/` | `02_architecture/` (ADR-003 kill-switch), `07_tickets/integration_hold.md` (Epic G gate), `04_api/error_model.md`, `CLAUDE.md §Agentic Team Management` |
| `05-tickets-handoffs.md` | `dis/document_ingestion_service/07_tickets/` `dis/handoffs/DIS-*.md` `dis/handoffs/DOC-*.md` `dis/handoffs/DRIFT-*.md` `dis/handoffs/sessions/` | `02_architecture/adrs/` (ADR citations), `08_team/session_handoff.md` (template), `11_session_transcripts/` (existence-only, not enumerated) |
| `06-code-reality-audit.md` | `dis/src/` `dis/tests/` `dis/migrations/` `dis/scripts/` `dis/package.json` `dis/tsconfig.json` `dis/vitest.config.ts` `dis/eslint.config.mjs` `dis/Dockerfile` `dis/CHANGELOG.md` `dis/DEPS_REQUIRED.md` | `07_tickets/done.md` (cross-check claims), `02_architecture/adapters.md` (expected adapter inventory), `02_architecture/tdd.md` (expected components) |

## Files NOT under any report (and why)

- `dis/document_ingestion_service/11_session_transcripts/*.jsonl` — session log files. Historical, not load-bearing. Filename-level existence is noted in `05-tickets-handoffs.md` but contents are not parsed.
- `dis/document_ingestion_service/10_handoff/` — **deprecated directory.** Its 8 files were moved to `dis/handoffs/sessions/` on 2026-04-22; the directory now contains only `.gitkeep`. 119 stale references to this path still exist across 20 other files (see README §4 F2).
- `dis/handoffs/orientation/` — this very package. Self-reference; excluded to avoid recursion.
- `dis/node_modules/` — dependency tree; excluded universally.
- Repo root files outside `dis/` — `web/`, `radhakishan_system/`, `supabase/`, `scripts/`, etc. These are the pre-DIS POC system. DIS is a replacement service for part of it (`supabase/functions/process-document`). The broader POC is governed by the project-root `CLAUDE.md` and not under DIS orientation scope.

## How to use this manifest

When refreshing a report, run the relevant `git log` against the paths in the primary column. The cross-references column tells you where a *secondary* source drift might affect this report without being "in" its primary scope — for example, an ADR change in `02_architecture/adrs/` directly belongs to `02-architecture.md`, but it will often show up in `03-data-api-testing.md` (OpenAPI contract) and `04-rollout-team-runbooks.md` (kill-switch runbook) as secondary impact.

Start with primary. Extend to cross-references only if a primary change flags a contract that another report references. This keeps refresh cost bounded.

## Version

- Written: 2026-04-22, source commit `69ce4bc`.
- Next session: if this manifest's own content has drifted (a new numbered folder appeared, a report changed scope), update this file in the same commit as the affected report's refresh.
