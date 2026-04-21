# Stuck Jobs & Operational Gremlins

Covers the small daily annoyances that aren't outages but still
deserve a documented fix. None of these are on-page alerts by
default (SEV3), but they escalate if clustered.

## Sample extraction IDs for testing

Use these against the scratch/staging DB for dry runs:

- `aaaa0000-0000-0000-0000-000000000001` — healthy CBC fixture
- `aaaa0000-0000-0000-0000-000000000002` — discharge summary with 7 TSB rows (CS-10 guard test)
- `aaaa0000-0000-0000-0000-000000000003` — duplicate-document fixture (CS-11 guard test)
- `aaaa0000-0000-0000-0000-000000000004` — low-confidence fixture (auto-approval blocked)
- `aaaa0000-0000-0000-0000-000000000005` — adversarial wrong-patient fixture (must reject)

Loaded by `node radhakishan_system/scripts/dis_load_test_fixtures.js`.

---

## 1. Extraction stuck in `ocr` > 5 min

### Symptoms

- `ocr_extractions.status = 'ocr'` with `updated_at > 5 min` ago.
- The nurse sees a spinner that never resolves.
- Alert `dis.stuck_in_ocr` (SEV3) fires.

### Diagnosis

```bash
# Find the culprits
psql "$DATABASE_URL" <<SQL
select id, patient_id, correlation_id, created_at, updated_at,
       now() - updated_at as stuck_for
from ocr_extractions
where status = 'ocr'
  and updated_at < now() - interval '5 min'
order by updated_at;
SQL
```

For each one, inspect the worker logs:

```bash
supabase functions logs dis-ocr --project-ref ecywxuqhnlkjtdshpcbc --since 30m \
  | grep "<CORRELATION_ID>"
```

Common causes, in order of likelihood:

1. Worker crashed mid-poll (no crash log → infra timeout).
2. Datalab accepted the job but is slow (> polling window). Check
   Datalab dashboard for job state.
3. Claimed by a dead worker (`dis_jobs.claimed_by` set, worker gone).

### Fix

```bash
# Option A — Datalab says job is still in flight: extend polling
#   (increase DIS_OCR_POLL_MAX_SEC secret, redeploy dis-ocr).
# Option B — Datalab says done/failed but our worker never saw it:
#   re-enqueue and let it idempotently reconcile.

psql "$DATABASE_URL" <<SQL
update dis_jobs
set status = 'queued', claimed_by = null, claimed_at = null, attempts = attempts + 1
where extraction_id = '<ID>' and status = 'processing';

update ocr_extractions
set status = 'queued', updated_at = now()
where id = '<ID>' and status = 'ocr';
SQL
```

Idempotency-Key on the Datalab call (TDD §Adapters) guarantees no
double-billing even if the original job eventually completes.

If more than 10 extractions are stuck simultaneously, restart the
worker function (forces a new isolate):

```bash
npx supabase functions deploy dis-ocr --project-ref ecywxuqhnlkjtdshpcbc
```

(On prod AWS: `aws ecs update-service --cluster dis-prod --service dis-ocr-worker --force-new-deployment --region ap-south-1`.)

---

## 2. Queue backlog growing

### Symptoms

- `dis_jobs` with `status='queued'` count climbing.
- Alert `dis.queue_depth_high` (SEV2 at > 200).

### Diagnosis

```bash
psql "$DATABASE_URL" <<SQL
-- Throughput
select date_trunc('minute', created_at) as minute, count(*)
from dis_jobs
where created_at > now() - interval '30 min'
group by 1 order by 1;

-- Drain rate
select date_trunc('minute', updated_at) as minute,
       sum(case when status='done' then 1 else 0 end) as drained,
       sum(case when status='failed' then 1 else 0 end) as failed
from dis_jobs
where updated_at > now() - interval '30 min'
group by 1 order by 1;

-- Per-status
select status, count(*) from dis_jobs group by status;
```

Causes and fixes:

| Cause                                 | Signal                                                        | Fix                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Worker count too low for current load | Drain rate flat, queue rising                                 | Increase concurrency (POC: bump Edge Function `max_concurrency`; Prod: `aws ecs update-service --desired-count`)                    |
| One bad document looping retries      | Same `extraction_id` reappearing with incrementing `attempts` | Mark it `dead_letter`: `update dis_jobs set status='dead_letter' where id='<ID>';` and notify reception the document was unreadable |
| Provider throttling                   | 429s in logs                                                  | Back off: lower submission rate via `DIS_JOB_RATE_LIMIT` secret                                                                     |
| Poison-pill row blocking worker       | Worker logs show crash on a specific ID                       | Quarantine: `update dis_jobs set status='quarantined' where extraction_id='<ID>';` file ticket                                      |

After any fix, watch the drain for 10 min to confirm trend reverses.

---

## 3. Duplicate promotion attempt

### Expected behavior (CS-11)

Before inserting into `lab_results`, the promotion step checks for an
existing row with the same
`(patient_id, test_name, test_date, value_numeric)`. If present, it
**skips the insert** and writes a row to `ocr_audit_log` with
`action='skip_duplicate'` and `details` naming the existing row id.

The promotion response to the client includes
`duplicates_skipped: N` so the UI can show a non-blocking notice.

### How to verify the guard fired correctly

```bash
psql "$DATABASE_URL" <<SQL
select ol.created_at, ol.actor, ol.details
from ocr_audit_log ol
where ol.action = 'skip_duplicate'
  and ol.details->>'extraction_id' = '<EXTRACTION_ID>'
order by ol.created_at desc;
SQL
```

### What to do if the guard **didn't** fire (i.e. a duplicate lab row appears)

This is a CS-11 violation → **SEV1**.

1. Flip the kill switch immediately.
2. Find the duplicate pair:
   ```sql
   select id, patient_id, test_name, test_date, value_numeric,
          ocr_extraction_id, created_at
   from lab_results
   where patient_id = '<PATIENT_ID>' and test_name = '<NAME>'
   order by created_at;
   ```
3. Do **not** delete the duplicate by hand — preserve evidence.
4. Page clinical reviewer. Decide together which row is clinically
   authoritative; supersede the other via the UI's supersede action
   (which writes an audit row), not by `DELETE`.
5. Root-cause: the guard lives in `supabase/functions/dis-promote/`
   around the `SELECT … FOR UPDATE` before INSERT. Common bugs:
   - Case-mismatch on `test_name` (fix: compare `lower(test_name)`).
   - Timezone-mismatch on `test_date` (fix: compare date, not timestamptz).
   - Missing `FOR UPDATE`, permitting a race.
     Write a regression test using the fixture
     `aaaa0000-0000-0000-0000-000000000003` before shipping the fix.

---

## 4. Nurse reports UI shows wrong confidence

### Symptom

Nurse says: "It's showing 95% confidence but the value is clearly
wrong" — or — "It's showing 50% confidence when the OCR reading is
correct and crisp."

### Reproduction

Ask the nurse for:

- `extraction_id` (visible in the verification panel footer).
- Screenshot of the panel.

Then:

```bash
psql "$DATABASE_URL" <<SQL
select id,
       status,
       confidence_policy_id,
       raw_ocr_response->'confidence' as ocr_confidence,
       raw_structured_response->'fields' as structured_fields,
       structured_confidence,
       displayed_confidence
from ocr_extractions
where id = '<ID>';
SQL
```

Compare:

- `raw_ocr_response->'confidence'` — Datalab's per-token confidence.
- `raw_structured_response` — Haiku's per-field confidence.
- `structured_confidence` — what the confidence-policy computed.
- `displayed_confidence` — what the UI actually rendered.

### Where the bug likely is

| Mismatch pattern                                                  | Likely location                                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ocr_confidence` high, `structured_confidence` low, UI shows high | **Structuring adapter** — UI is reading the wrong field. Check `web/dis_verify.html` binding.                  |
| `structured_confidence` differs from `displayed_confidence`       | **Confidence policy** in `supabase/functions/dis-structure/confidence.ts`. Likely a wrong min/max aggregation. |
| Both raw confidences OK, `displayed_confidence` null              | Confidence policy not applied (row predates `dis_confidence_policy` seed). Re-run policy job.                  |
| Displayed confidence changes on page refresh                      | Caching bug in the webapp. Not a DIS bug.                                                                      |

### Fix path

1. File as SEV3 with the extraction_id and expected-vs-actual.
2. Add the extraction_id to the confidence-regression fixture set.
3. Patch the specific layer (adapter or policy).
4. Auto-approval remains disabled by default (CS-7), so a
   miscalibrated confidence can't silently promote. Reassure the
   nurse — they still verify by hand.

---

## 5. Extraction stuck in `pending_review` forever

### Symptom

Extraction is complete but no nurse has reviewed it. Piles up in
queue dashboards.

### Diagnosis

```bash
psql "$DATABASE_URL" -c "select count(*), max(now() - updated_at) as oldest from ocr_extractions where status = 'pending_review';"
```

If `oldest > 48 h` and count > 20, workflow is backing up. This is
a **product/process** issue, not a tech one.

### Fix

- Not a code fix. Escalate to product owner (see `08_team/RACI.md`)
  to discuss with reception about daily review cadence.
- Consider enabling the weekly clinician-audit sweep on the backlog
  (see `clinical_safety.md` §Out-of-band safeguards).

Never "auto-age-out" pending reviews. CS-1, CS-4, CS-5 all forbid it:
the extraction stays `pending_review` until a human acts or the
nurse explicitly rejects.

---

## 6. Cost ledger spike (SEV3)

### Symptom

Alert: daily cost in `dis_cost_ledger` > 2x 7-day moving average.

### Diagnosis

```bash
psql "$DATABASE_URL" <<SQL
select provider, model,
       date_trunc('hour', created_at) as hour,
       count(*) as calls,
       sum(cost_usd) as cost
from dis_cost_ledger
where created_at > now() - interval '24 hours'
group by 1,2,3
order by 3 desc;
SQL
```

Common causes:

- **Retry storm** on a broken fixture — same extraction_id consuming
  repeated provider calls. Fix: find and quarantine (§2 dead_letter).
- **Fallback still active** after a provider outage — someone forgot
  to flip `DIS_OCR_PROVIDER` back to `datalab`. Check current value:
  ```bash
  npx supabase secrets list --project-ref ecywxuqhnlkjtdshpcbc | grep DIS_OCR_PROVIDER
  ```
- **Unexpected traffic** (reception onboarded extra staff). Benign.
  Note in the weekly ops review.

Keep the alert — a persistent spike over days becomes a SEV2.
