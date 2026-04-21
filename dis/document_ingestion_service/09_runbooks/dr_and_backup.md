# Disaster Recovery & Backup Runbook

Covers data loss, corruption, accidental delete, and the quarterly
restore drill.

## What is backed up

| Asset                                     | Medium                                         | Frequency (POC)        | Frequency (Prod)            | Retention                 |
| ----------------------------------------- | ---------------------------------------------- | ---------------------- | --------------------------- | ------------------------- |
| DB — full dump                            | Supabase daily automatic backup                | Daily 02:00 IST        | RDS continuous (PITR)       | 30 d POC / 35 d Prod      |
| DB — logical dump (redundancy)            | `pg_dump` to `documents` bucket                | Daily 02:30 IST (cron) | Daily to S3 `dis-backups`   | 90 d                      |
| `ocr_extractions.raw_ocr_response`        | Within DB + quarterly export to object storage | See DB frequency       | S3 `dis-ocr-raw`            | **Forever** (CS-2)        |
| `ocr_extractions.raw_structured_response` | Within DB                                      | See DB frequency       | Same                        | **Forever** (CS-2)        |
| `documents` bucket (uploaded files)       | Supabase storage replication                   | Continuous             | S3 cross-region replication | **Forever** (CS-2 spirit) |
| Skill / config files in `website/skill/`  | Git is source of truth                         | On commit              | Same                        | Forever (git)             |
| `dis_confidence_policy` state             | DB dump includes it                            | See DB frequency       | Same                        | 90 d                      |

The only irreplaceable data is the raw OCR and raw structured
responses (CS-2). Losing them means we cannot audit past AI
decisions, so backup of `ocr_extractions` takes priority over every
other recovery objective.

## RTO / RPO targets

| Environment                | RTO (recovery time) | RPO (data loss window) |
| -------------------------- | ------------------- | ---------------------- |
| POC (Supabase)             | 4 hours             | 24 hours               |
| Prod (AWS, post-migration) | 1 hour              | 5 minutes (via PITR)   |

If a real incident looks like it will exceed RTO, escalate to SEV1
(clinical-safety impact grows with downtime on verified data).

## Restore — DB (POC, Supabase)

### Full restore from Supabase backup

1. In the Supabase dashboard → Project Settings → Backups, identify the
   target backup timestamp.
2. **Do not restore over the live project.** Create a restore project
   first, verify, then promote.
   ```
   Supabase dashboard → Backups → "Restore to new project"
   ```
3. Once the restore project is healthy, point a preview Edge Function
   deployment at it and run the acceptance suite (see §Verifying a
   restore).
4. Only after verification, switch DNS / connection strings (or, for
   the prescription webapp, update hardcoded Supabase URLs in a new
   `web/` deployment) to the restored project.

### Logical restore (targeted recovery)

If only DIS tables are damaged and the pre-DIS clinical tables are
intact, restore just the DIS tables from the nightly `pg_dump`:

```bash
# Download the latest dump from the documents bucket
curl -H "apikey: $SUPABASE_SERVICE_KEY" \
  "https://ecywxuqhnlkjtdshpcbc.supabase.co/storage/v1/object/documents/backups/pg_dump_$(date -d yesterday +%Y%m%d).sql.gz" \
  -o /tmp/dis-dump.sql.gz
gunzip /tmp/dis-dump.sql.gz

# Restore only DIS tables into a scratch schema
psql "$DATABASE_URL" -c "create schema dis_restore;"
pg_restore --schema=public --table=ocr_extractions --table=ocr_audit_log \
           --table=dis_jobs --table=dis_cost_ledger --table=dis_confidence_policy \
           --data-only -d "$DATABASE_URL" /tmp/dis-dump.sql
```

Then compare, merge, and swap under a window where the kill switch
is on.

## Restore — DB (Prod, AWS RDS)

### Point-in-time restore (preferred)

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier dis-prod \
  --target-db-instance-identifier dis-prod-restore-$(date +%Y%m%d%H%M) \
  --restore-time "2026-04-20T10:15:00Z" \
  --region ap-south-1
```

Wait for status `available`, then:

```bash
aws rds describe-db-instances \
  --db-instance-identifier dis-prod-restore-... \
  --query "DBInstances[0].Endpoint.Address" \
  --region ap-south-1
```

Point a preview stack at the new endpoint. Run acceptance. Promote by
updating `DATABASE_URL` in Secrets Manager and rolling ECS services.

### Snapshot restore (fallback)

```bash
aws rds describe-db-snapshots --db-instance-identifier dis-prod \
  --snapshot-type automated --region ap-south-1 \
  --query "DBSnapshots[?SnapshotCreateTime>'2026-04-19'].[DBSnapshotIdentifier,SnapshotCreateTime]"

aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier dis-prod-restore-$(date +%Y%m%d%H%M) \
  --db-snapshot-identifier <SNAPSHOT_ID> \
  --region ap-south-1
```

## Restore — Storage buckets

### Supabase (POC)

Storage has versioning + soft-delete. Recover a single deleted
object:

```bash
npx supabase storage download --project-ref ecywxuqhnlkjtdshpcbc \
  documents/<path>  --version <VERSION_ID>
```

For bulk recovery, request a bucket-level restore via Supabase
support (POC). This is the single biggest gap in our POC DR plan —
documented and tracked.

### S3 (Prod)

With cross-region replication + versioning:

```bash
aws s3api list-object-versions --bucket dis-documents-prod --prefix "<PREFIX>"
aws s3api copy-object \
  --bucket dis-documents-prod \
  --copy-source "dis-documents-prod/<KEY>?versionId=<VID>" \
  --key "<KEY>" \
  --region ap-south-1
```

## The irreplaceable column: `ocr_extractions.raw_ocr_response`

CS-2 requires this column's contents are preserved forever. Specific
safeguards:

1. Column is **never updated** by app code (enforced by RLS policy
   that forbids UPDATE on this column).
2. Weekly cron exports it to an immutable object-storage location:
   - POC: `documents/backups/raw_ocr_weekly/<YYYY-WW>.jsonl.gz`
   - Prod: S3 `dis-ocr-raw-prod` with Object Lock (compliance mode, 7 years).
3. Quarterly audit (§Quarterly drill) includes pulling a random sample
   from the weekly export and re-parsing it.

If a DB restore loses any `raw_ocr_response` rows that are still
present in the weekly exports, merge them back in:

```bash
node radhakishan_system/scripts/dis_restore_raw_ocr.js \
  --from documents/backups/raw_ocr_weekly/2026-W16.jsonl.gz \
  --mode insert-missing
```

The script only INSERTs extractions whose `id` does not already
exist — it never overwrites (CS-2: append-only).

## Quarterly restore drill

**Owner:** Primary on-call. **Frequency:** once per calendar quarter.

### Procedure

1. Pick a backup from 7–30 days ago (not the newest; exercise age).
2. Restore to a scratch project/instance (never touch live).
3. Point a preview of the webapp + Edge Functions at the scratch DB.
4. Run the pass-criteria checks below.
5. Tear down the scratch environment.
6. Log results in `incidents/dr-drill-<quarter>.md` with timings.

### Pass criteria

| Check                             | Command                                                     | Expected                 |
| --------------------------------- | ----------------------------------------------------------- | ------------------------ |
| Schema matches head               | `pg_dump --schema-only` vs. `03_data/expected_schema.sql`   | No diff                  |
| Row counts plausible              | `select count(*) from ocr_extractions;`                     | Within 5% of prior drill |
| Clinical-acceptance fixtures pass | `node dis_acceptance.js --suite clinical-core`              | All pass                 |
| CS-3 invariant holds              | no `ai_extracted` lab rows with null `ocr_extraction_id`    | 0                        |
| Raw OCR retrievable               | random sample of 20 rows return non-null `raw_ocr_response` | 20/20                    |
| RTO actual vs target              | stopwatch from "restore initiated" to "acceptance green"    | ≤ target                 |
| Kill switch default               | `dis_enabled` in restored policy                            | `false`                  |

If any check fails, file a SEV2 ticket, fix, and re-drill within 30 d.

## Verifying a restore (any scenario)

Before redirecting live traffic to a restored DB:

```bash
# 1. Schema
pg_dump --schema-only "$RESTORED_DB_URL" | diff - dis/document_ingestion_service/03_data/expected_schema.sql

# 2. Row-count sanity (compare to monitoring dashboard's last-known-good)
psql "$RESTORED_DB_URL" -c "select 'ocr_extractions' t, count(*) from ocr_extractions union all select 'lab_results', count(*) from lab_results union all select 'vaccinations', count(*) from vaccinations;"

# 3. Run clinical-acceptance fixtures against the restored DB
DATABASE_URL="$RESTORED_DB_URL" node radhakishan_system/scripts/dis_acceptance.js --suite clinical-core

# 4. CS invariants (CS-1, CS-3, CS-12)
psql "$RESTORED_DB_URL" -f radhakishan_system/scripts/dis_cs_invariants.sql
```

Every check green → proceed to cutover. One red → stop, investigate,
do not cut over.

## Data loss post-mortem

For any real (non-drill) restore event:

- File a SEV1 incident (data-loss is always SEV1, even if recovered).
- Timeline must include: last known good state, detection, restore
  start, cutover, all-clear.
- Action items must include at least one new monitoring/alerting
  check that would have detected the loss sooner.
- Clinical reviewer signs off before "all-clear".
