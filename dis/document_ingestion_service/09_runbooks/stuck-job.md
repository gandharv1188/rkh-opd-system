# Runbook: Stuck Job (processing state past SLA)

**Scope:** An OCR extraction job has remained in `status = 'processing'` longer than the agreed SLA (15 min soft, 30 min hard). This runbook drives from detection to retry or manual failure, then post-mortem.

**Pager severity:** P2 if one job > 30 min; P1 if `queue_depth` > 50 or `stuck_jobs_total` > 5 concurrently.

**Pre-reqs:** psql access to the DIS database, `kubectl`/container access to OCR worker, an operator token for `POST /extractions/:id/retry`.

---

## Step 1 — Detect the stuck-job condition

Two signals trigger this runbook:

1. **Prometheus alert `DISQueueDepthHigh`** — fires when `dis_queue_depth` gauge exceeds 50 for > 5 min, or `dis_job_age_seconds{quantile="0.95"}` exceeds 900 s.
2. **Per-job age probe** — a synthetic check that SELECTs the oldest processing job every minute and alerts when `age(updated_at)` > 15 min.

Confirm the alert in Grafana (`DIS / Queue Health` board). If the `queue_depth` gauge is flat but `job_age` is climbing, a single worker is wedged on one job rather than a backlog — skip the scale-out branch.

Record the alert start time; it anchors the post-mortem clock.

## Step 2 — Identify the stuck job id(s)

Run against the DIS database:

```sql
SELECT extraction_id, status, updated_at, worker_id, retry_count
FROM ocr_extractions
WHERE status = 'processing'
  AND updated_at < NOW() - interval '15 minutes'
ORDER BY updated_at ASC;
```

For each row, note `extraction_id`, the owning `worker_id`, and `retry_count`. If `retry_count >= 3`, this job has already been retried — jump to Step 5 (manual fail) after diagnosis.

If the query returns zero rows but the alert is still firing, the alert is stale — silence it for 10 min and re-poll. Do not clear the alert until the gauge confirms.

## Step 3 — Diagnose the failure mode

Classify the root cause before touching the job:

- **Worker down.** `kubectl get pods -l app=ocr-worker` — if the `worker_id` from Step 2 is not present, the pod crashed and released the lease without updating status. Safe to retry.
- **OCR hung.** Pod is `Running` but CPU is idle. Exec in and check `ps auxf` for a zombie `tesseract`/`pdftoppm` child. Capture `kubectl logs <pod> --tail=200` into the incident channel. Unsafe to retry until worker is restarted.
- **Structuring loop.** Pod is `Running`, CPU pinned at 100%, logs show repeated `structuring: retry N` lines. This is an infinite retry inside the LLM structuring step. Kill the pod; the lease expires after 2 min and the job becomes retryable.

Write the diagnosis into the incident ticket before moving on — Step 6 depends on it.

## Step 4 — Retry via the operator endpoint

For each stuck `extraction_id` that is safe to retry:

```bash
curl -sS -X POST "https://dis.internal/extractions/${EXTRACTION_ID}/retry" \
  -H "Authorization: Bearer ${OPERATOR_TOKEN}" \
  -H "X-Reason: stuck-job-runbook"
```

Expected response: `202 Accepted` with `{"status":"queued","retry_count":<n+1>}`. The endpoint is idempotent — a duplicate POST within 30 s returns the same payload.

Verify the job left `processing`:

```sql
SELECT status, retry_count, updated_at
FROM ocr_extractions
WHERE extraction_id = :id;
```

Within 60 s the row should be `queued` or have advanced to `completed`/`failed`. If it is still `processing` with an unchanged `updated_at`, the retry endpoint did not preempt the lease — proceed to Step 5.

## Step 5 — Mark as failed manually if retry is exhausted

When `retry_count >= 3`, or the retry endpoint cannot dislodge the job, fail it manually and let the caller re-submit:

```sql
UPDATE ocr_extractions
SET status = 'failed',
    error_code = 'STUCK_MANUAL_FAIL',
    error_message = 'Marked failed by runbook after stuck >15m; see incident ' || :incident_id,
    updated_at = NOW()
WHERE extraction_id = :id
  AND status = 'processing';
```

Confirm exactly **one** row was updated. Then notify the upstream submitter (document_id owner) via the standard incident comms template — they need to re-queue the document.

If more than five jobs hit this branch in a single incident, escalate to on-call engineering before continuing; the underlying worker fault is unresolved.

## Step 6 — Post-mortem

Within 24 h of incident close:

- File a post-mortem doc under `dis/document_ingestion_service/10_postmortems/YYYY-MM-DD-stuck-jobs.md` using the standard template.
- Capture: alert timeline (Step 1), affected `extraction_id`s (Step 2), diagnosis class (Step 3), retry outcomes (Step 4), manual fails (Step 5), and a root-cause hypothesis.
- File follow-up tickets for any worker-side fix (OCR timeout guard, structuring loop cap, lease-expiry tuning).
- Update this runbook if the failure mode does not fit the three classes in Step 3 — add a new diagnosis branch rather than a one-off note in the post-mortem.

Close the incident only after the post-mortem doc is linked in the ticket.
