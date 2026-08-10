# Migration Incident Runbook

A DIS schema migration (M-001..M-009 per `03_data/migrations.md`) has
failed partway. This runbook gets you to a known-good state without
making things worse.

## Hard rules

1. **Stop the migration runner immediately.** Do not let it auto-retry.
2. **Do NOT run subsequent migrations.** Skipping forward while a
   previous migration is half-applied corrupts schema state in a way
   that rollback scripts cannot recover from.
3. **Snapshot before touching anything.** The DB state at time-of-failure
   is the only reliable witness for root cause.
4. No DDL by hand. Every change goes through a `.sql` file checked
   into `dis/migrations/` (even emergency fixes).

## Symptoms → classification

| Symptom                                                                     | Class                               | First instinct                                                                                  |
| --------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `dbmate` exits non-zero; `schema_migrations` has no new row                 | **Transaction rolled back cleanly** | Safe. Fix the SQL, retry.                                                                       |
| `dbmate` exits non-zero; `schema_migrations` **has** the new row            | **Partial apply**                   | Dangerous. Migration committed partway via `BEGIN`/`COMMIT` mismatch. Investigate before retry. |
| PG error: `canceling statement due to lock timeout`                         | **Lock timeout**                    | App traffic holding locks. See §Lock timeouts.                                                  |
| PG error: `canceling statement due to statement timeout`                    | **Statement timeout**               | Large backfill on a hot table. See §Long backfills.                                             |
| CI passes, prod fails with `duplicate key value violates unique constraint` | **Data drift**                      | Prod has duplicate rows that the fixture didn't have. See M-007 path.                           |
| Migration runs, `pg_dump --schema-only` diff shows drift                    | **Non-deterministic migration**     | Block merge. Fix migration idempotency.                                                         |

## First 10 minutes

```bash
# 1. Stop any retry loop / CI rerun (cancel the workflow)
# 2. Snapshot schema + migration table
pg_dump --schema-only "$DATABASE_URL" > /tmp/dis-schema-$(date +%s).sql
psql "$DATABASE_URL" -c "\copy (select * from schema_migrations order by version) to '/tmp/dis-migrations-state.csv' csv header"

# 3. Capture the locks and running statements
psql "$DATABASE_URL" -c "select pid, state, wait_event_type, wait_event, query_start, substr(query,1,120) from pg_stat_activity where state != 'idle' order by query_start;"
psql "$DATABASE_URL" -c "select relation::regclass, mode, granted, pid from pg_locks where not granted;"

# 4. Flip the DIS kill switch (writes stop; reads still work)
psql "$DATABASE_URL" -c "update dis_confidence_policy set value='false', updated_at=now(), updated_by='oncall:migration-incident' where key='dis_enabled';"
```

File a SEV2 incident. Escalate to SEV1 only if clinical tables
(`lab_results`, `vaccinations`) show constraint violations that could
block reads.

## Recovery paths per migration

Every migration has a matching `.rollback.sql` in the same folder
(`03_data/migrations.md` §Reversibility). Rollback is the default
recovery path — it is tested in CI (forward/back/forward).

### M-001: Create `ocr_extractions`

- Partial apply → run rollback (`DROP TABLE ocr_extractions CASCADE`).
- Safe because no clinical data depends on it yet.
- Retry forward after fixing SQL.

### M-002: Create `ocr_audit_log` with append-only triggers

- Partial apply → rollback drops the triggers and the table.
- Safe at this stage (no writers yet).

### M-003: Create `dis_confidence_policy`

- Partial apply → rollback drops the table.
- **Caveat:** if the table exists but the seed row is missing, DIS
  will treat `dis_enabled` as undefined. Safer to complete the insert
  manually from the migration:

```sql
insert into dis_confidence_policy (key, value, updated_by)
values ('dis_enabled', 'false', 'migration:M-003-recovery')
on conflict (key) do nothing;
```

### M-004: Create `dis_jobs` (POC only)

- Env-gated; only runs when `DIS_STACK=supabase`.
- Partial apply → rollback (`DROP TABLE dis_jobs`).
- If prod AWS path was accidentally exposed to this migration, abort
  and file a separate ticket — prod uses SQS, not this table.

### M-005: Create `dis_cost_ledger`

- Append-only. Partial apply → rollback is safe.

### M-006: Add nullable columns to `lab_results` and `vaccinations` + backfill

- **Most dangerous migration.** Touches clinical tables.
- If the `ALTER TABLE ADD COLUMN` succeeded but the backfill
  `UPDATE … SET verification_status = …` failed partway:
  - Do **NOT** rollback immediately. Rollback drops the new columns,
    which loses the partial backfill work.
  - Instead, complete the backfill manually in a new fix-forward
    migration `M-006a-complete-backfill.sql`:

```sql
update lab_results
set verification_status = case
  when source = 'manual' then 'manual'
  when source = 'upload' then 'verified'
  else 'verified'   -- legacy rows predate DIS; treat as verified
end
where verification_status is null;

update vaccinations
set verification_status = case
  when source = 'manual' then 'manual'
  else 'verified'
end
where verification_status is null;
```

- Verify no NULLs remain before proceeding:

```bash
psql "$DATABASE_URL" -c "select count(*) from lab_results where verification_status is null;"
psql "$DATABASE_URL" -c "select count(*) from vaccinations where verification_status is null;"
```

Both must return `0`.

### M-007: Add unique dedupe indexes

- The migration's built-in dry-run step aborts if duplicates exist.
- If aborted: it printed a list. Resolve duplicates manually:

```bash
psql "$DATABASE_URL" -c "\copy (select patient_id, test_name, test_date, value_numeric, count(*) from lab_results group by 1,2,3,4 having count(*) > 1) to '/tmp/lab-dupes.csv' csv header"
```

- Review with clinical reviewer. Decide keep-newest vs. merge-notes.
  Apply deletes in a scripted migration `M-007-dedupe-data.sql`, then
  re-run M-007.

### M-008: RLS policies

- Rollback drops the policies. Safe — pre-existing policies remain.
- If you accidentally locked yourself out (the service role lost
  access), connect using the Supabase dashboard SQL editor (runs as
  `postgres`), drop the offending policy, and re-run the migration
  with the fix.

### M-009 (cutover): FK / CHECK constraint

- This is applied only after feature-flag default rollout (`06_rollout`).
- Failure symptom: `check constraint "lab_results_extraction_or_source" is violated by some row`.
- Means some row is neither tied to an extraction nor `source in
('manual','verified')`. Find them:

```sql
select id, source, verification_status, ocr_extraction_id
from lab_results
where ocr_extraction_id is null
  and verification_status not in ('manual','verified');
```

- Backfill those rows' `verification_status` to `'verified'` (they
  predate DIS), then retry M-009.
- **Do not** relax the CHECK constraint.

## Lock timeouts

- Someone (app traffic) holds a long transaction on the target table.
- Option A: wait. Most are < 60 s on POC traffic volumes.
- Option B: kill the blocker (only if you identify it — `pg_stat_activity`).
  ```sql
  select pg_cancel_backend(<pid>);
  ```
- Option C: flip kill switch (pauses DIS writes), then retry.

## Long backfills (M-006)

If the backfill is slow on large tables, batch it:

```sql
-- Run this repeatedly until 0 rows updated
with batch as (
  select id from lab_results where verification_status is null limit 10000
)
update lab_results set verification_status = 'verified'
where id in (select id from batch);
```

## Data-safety validation before resuming

Before unflipping the kill switch:

```bash
# a. Schema matches expected
pg_dump --schema-only "$DATABASE_URL" | diff - dis/document_ingestion_service/03_data/expected_schema.sql

# b. CS-3 invariant holds (every DIS-sourced clinical row has an extraction FK)
psql "$DATABASE_URL" -c "select count(*) from lab_results where source='ai_extracted' and ocr_extraction_id is null;"  # must be 0

# c. Clinical-acceptance fixtures still pass
node radhakishan_system/scripts/dis_acceptance.js --suite clinical-core
```

All three must pass.

## Escalation if unrecoverable

If after 2 hours you cannot get the schema back to a known state:

1. Declare SEV1 (schema corruption is a clinical-safety risk).
2. Freeze all DIS writes (kill switch remains ON).
3. Page Clinical reviewer + Product owner.
4. Consider point-in-time restore from the last known-good snapshot
   (see `dr_and_backup.md`). PITR is acceptable because DIS tables
   are young and the pre-DIS clinical tables restore cleanly to their
   pre-migration shape.
5. Do not merge any further DIS PRs until schema is verified clean.
