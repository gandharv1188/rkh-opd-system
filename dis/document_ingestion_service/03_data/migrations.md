# Migration Plan

Migrations are plain SQL files in `dis/migrations/` run by `dbmate`
(or `node-pg-migrate`). Each has a corresponding `.rollback.sql`.

## Order of migrations (non-breaking by design)

All migrations are **additive and reversible** until the cutover
migration (M-008), which is applied only after feature-flag default
rollout.

### M-001: Create `ocr_extractions`

Adds the staging table and indexes. No clinical impact.

### M-002: Create `ocr_audit_log` with append-only triggers

Adds audit log. Safe.

### M-003: Create `dis_confidence_policy`

Adds policy table + seeds row with `enabled=false`.

### M-004: Create `dis_jobs` (POC only — AWS uses SQS)

Env-gated: only runs when `DIS_STACK=supabase`.

### M-005: Create `dis_cost_ledger`

Append-only cost tracking.

### M-006: Add nullable columns to `lab_results` and `vaccinations`

- `ocr_extraction_id` nullable FK
- `verification_status` NOT NULL with DEFAULT (existing rows get default)
- `verified_by`, `verified_at` nullable

Backfill step inside the migration sets `verification_status` based on
the legacy `source` column.

### M-007: Add unique dedupe indexes

`uniq_lab_dedupe`, `uniq_vax_dedupe`. Migration includes a dry-run
check: if any duplicates exist, migration aborts and prints a list for
manual resolution.

### M-008: RLS policies on `ocr_extractions` and related

Non-breaking — pre-existing tables retain their policies.

### M-009 (cutover, applied post-rollout): make FK mandatory on new rows

```sql
alter table lab_results add constraint lab_results_extraction_or_source
  check (
    ocr_extraction_id is not null
    or verification_status in ('manual','verified') -- manual entry is still allowed
  );
```

## Reversibility

Each migration has a `.rollback.sql`:

- M-001 to M-005: `DROP TABLE … CASCADE`.
- M-006: `ALTER TABLE … DROP COLUMN …`.
- M-007: `DROP INDEX …`.
- M-008: `DROP POLICY …`.
- M-009: `DROP CONSTRAINT …`.

Rollback scripts are tested in CI — a migration cannot merge if its
rollback doesn't restore the schema to the previous state byte-for-byte
(checked via `pg_dump --schema-only` diff).

## Execution workflow

**POC (Supabase):**

```
dbmate -d dis/document_ingestion_service/03_data/migrations up
```

**Prod (AWS):**
Same command with a different `DATABASE_URL`. The migration set is
identical.

## CI guardrails

- **Schema-drift detector.** CI compares the live schema to the
  migrated schema and fails if they diverge.
- **Forward + backward test.** CI runs every migration up, then down,
  then up again, verifying schema match at each stop.
- **Data-safety test.** For M-006 and M-009, CI loads a fixture of
  realistic legacy rows and asserts all of them still satisfy the new
  constraints after migration.

## Runbook link

See `09_runbooks/migration_incident.md` for how to respond if a
migration fails mid-way in production.
