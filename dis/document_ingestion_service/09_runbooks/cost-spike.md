# Runbook: Cost Spike

Triggered when daily LLM/OCR spend exceeds the configured DIS budget or the
`cost_micro_inr_total` metric jumps above normal baseline. Goal: cap bleeding
fast, then find root cause.

Related: DIS-149 (cost ledger), DIS-165 (daily-budget guardrail).

## Step 1 — Detect

Signals:

- PagerDuty / Prometheus alert: `dis_daily_cost_inr > DIS_DAILY_BUDGET_INR * 0.8`
  (warn) or `> 1.0` (critical). Sourced from `cost_micro_inr_total` counter
  defined in DIS-149.
- DIS-165 guardrail returns `budget_exceeded: true` on the `/ingest` path and
  starts rejecting new jobs with `429 BUDGET_EXCEEDED`.
- Finance dashboard (Grafana `dis-cost`) shows a step-change in hourly spend.

Capture a snapshot of the alert payload (timestamp, provider, amount) before
touching anything.

## Step 2 — Triage (which adapter is bleeding?)

Query the cost ledger (DIS-149) to isolate the offender:

```sql
SELECT provider,
       operation,
       COUNT(*)          AS calls,
       SUM(cost_micro_inr) / 1e6 AS inr_spent,
       AVG(cost_micro_inr) / 1e6 AS inr_per_call
FROM   dis_cost_ledger
WHERE  created_at >= date_trunc('day', now())
GROUP  BY provider, operation
ORDER  BY inr_spent DESC;
```

Compare against the previous 7-day baseline (same query with
`created_at BETWEEN now() - interval '8 days' AND now() - interval '1 day'`).

Classify:

- **Volume spike** — `calls` is 5-10x baseline, `inr_per_call` unchanged.
- **Unit-cost spike** — `calls` flat, `inr_per_call` jumped (model switch,
  retry loop, long prompts).
- **New provider/operation** — row that did not exist yesterday.

## Step 3 — Cap the bleed

Immediate mitigations, in order of preference:

1. Lower the daily budget so DIS-165 starts shedding load:
   `supabase secrets set DIS_DAILY_BUDGET_INR=<half-current>` and redeploy the
   affected Edge Functions.
2. If a single adapter is the culprit, activate its kill-switch feature flag
   (`DIS_ADAPTER_<NAME>_ENABLED=false`) — this is faster than a budget change
   because it takes effect on next request without waiting for the guardrail
   to re-read config.
3. If retries are the cause, drop the retry cap
   (`DIS_ADAPTER_MAX_RETRIES=1`) to stop amplifying the bill while you
   investigate.

Post in `#dis-incidents` with the mitigation applied and the expected effect.

## Step 4 — Root-cause

Work down this checklist in order:

- **Looped retries** — grep Edge Function logs for repeated `retry_attempt`
  on the same `job_id`. Common after a transient provider 5xx that got
  reclassified as retryable.
- **Prompt injection / runaway input** — check `dis_jobs.input_size_bytes`
  p99 for today vs baseline. A single tenant uploading 10 MB OCR PDFs can
  quintuple spend.
- **Silent model switch** — diff the adapter config (`git log -p -- 
  supabase/functions/<adapter>/config.ts`) for the last 48 h. An accidental
  bump from a cheap to an expensive model is the usual culprit.
- **Cache miss regression** — compare cache hit-rate metric
  (`dis_cache_hits_total / dis_cache_lookups_total`) against baseline. A
  schema/key change can zero the hit-rate and 10x cost overnight.
- **Abusive tenant** — `GROUP BY tenant_id` in the Step 2 query. A single
  tenant above 50 % of daily spend warrants a tenant-scoped rate limit.

Record findings in the incident ticket with ledger-row IDs as evidence.

## Step 5 — Recover and post-mortem

1. Undo the temporary caps (restore `DIS_DAILY_BUDGET_INR`, re-enable the
   adapter flag) only after the root cause is fixed and a regression test
   has been added.
2. Verify: watch `cost_micro_inr_total` for one hour post-restore. Rate
   should match pre-incident baseline within 10 %.
3. Write the post-mortem in `dis/document_ingestion_service/10_incidents/`
   within 48 h. Must include: detection-to-mitigation time, INR over-spend,
   root cause, corrective actions.
4. Tune the budget: if the spike was legitimate growth, raise
   `DIS_DAILY_BUDGET_INR` with a PR that cites the new baseline. If it was
   abuse, lower it and add the tenant rate-limit.
5. File follow-up tickets for any missing observability that slowed Step 2
   (e.g. if you could not attribute spend to a tenant, that is a gap).
