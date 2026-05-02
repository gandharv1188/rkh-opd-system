# Provider Outage Runbook

Datalab (OCR) or Anthropic (structuring / fallback OCR) has become
unresponsive or is returning errors at an elevated rate.

## Detection

Alert fires on either:

- `OCR_PROVIDER_UNAVAILABLE` count > 10 in 5 min (from `04_api/error_model.md`)
- `OCR_PROVIDER_TIMEOUT` count > 10 in 5 min
- `STRUCTURING_PROVIDER_FAILED` count > 10 in 5 min
- `STRUCTURING_SCHEMA_INVALID` sustained (different class — see §Schema drift)

Manual signal: a nurse reports "the AI reader is stuck" across
multiple uploads.

## Quick triage

```bash
# Rate of provider errors in last 15 min, grouped by provider + code
psql "$DATABASE_URL" <<SQL
select
  details->>'provider' as provider,
  error_code,
  count(*)
from ocr_extractions
where created_at > now() - interval '15 min'
  and status = 'failed'
  and error_code in ('OCR_PROVIDER_UNAVAILABLE','OCR_PROVIDER_TIMEOUT','STRUCTURING_PROVIDER_FAILED')
group by 1, 2
order by 3 desc;
SQL
```

Cross-check with the provider's status page:

- Datalab: https://status.datalab.to (or the URL listed in TDD §Adapters)
- Anthropic: https://status.anthropic.com

## Automatic behavior (designed-in)

Per TDD §Retry policy and `error_model.md`:

- Failed extractions transition to `status='failed'` with
  `error_code` populated.
- `dis_jobs` retry queue schedules retries with exponential backoff
  (base 1 s, factor 2, cap 30 s, jitter ±20%) using the same
  `Idempotency-Key`.
- UI shows the nurse: _"AI reader is temporarily unavailable — we'll
  retry in the background."_ (DIS-US-015.)
- **Crucially: no row reaches `lab_results` / `vaccinations`** while
  the provider is out — `pending_review` extractions are blocked by
  CS-1. Reception can manually enter the critical values in the
  meantime.

## Manual intervention — flip to fallback provider

DIS supports a fallback: Claude (Anthropic) can perform OCR when
Datalab is down, and Sonnet can substitute for Haiku on structuring
(higher cost, higher quality, slower). See `02_architecture/adapters.md`.

### Decision tree

```
Is Datalab down AND Anthropic up?
 ├─ YES ─► Flip DIS_OCR_PROVIDER=claude  (OCR continues via Claude)
 └─ NO ─► Is Anthropic down AND Datalab up?
          ├─ YES ─► No OCR fallback; structuring fallback: flip DIS_STRUCTURING_MODEL=claude-sonnet-4-7 (different endpoint, same provider — rarely helps). Usually: wait it out; extractions queue.
          └─ NO ─► Both down. Flip kill switch. Comms to reception. Wait.
```

### Flip the OCR fallback (POC)

```bash
npx supabase secrets set DIS_OCR_PROVIDER=claude --project-ref ecywxuqhnlkjtdshpcbc
npx supabase functions deploy dis-ocr --project-ref ecywxuqhnlkjtdshpcbc
```

Wait ~30 s for the isolate to cycle. Verify:

```bash
supabase functions logs dis-ocr --project-ref ecywxuqhnlkjtdshpcbc --since 2m | grep "provider="
```

New entries should show `provider=claude`.

### Flip the structuring fallback (POC)

```bash
npx supabase secrets set DIS_STRUCTURING_MODEL=claude-sonnet-4-7 --project-ref ecywxuqhnlkjtdshpcbc
npx supabase functions deploy dis-structure --project-ref ecywxuqhnlkjtdshpcbc
```

### Prod (AWS)

Same env vars, different mechanism:

```bash
aws ssm put-parameter --name /dis/prod/DIS_OCR_PROVIDER --value claude --overwrite --region ap-south-1
aws ecs update-service --cluster dis-prod --service dis-ocr-worker --force-new-deployment --region ap-south-1
```

## Cost awareness

Fallback is 3–5x more expensive per extraction. Watch the ledger:

```bash
psql "$DATABASE_URL" -c "select provider, sum(cost_usd), count(*) from dis_cost_ledger where created_at > now() - interval '1 hour' group by provider;"
```

If cost is diverging and the outage is expected to last > 4 hours,
consider flipping the kill switch instead (cheaper and safer — falls
back to manual entry, which is the pre-DIS workflow).

## Comms template to reception

Post to `#reception` or WhatsApp:

```
Hi team — the AI document reader is degraded right now. Please
enter lab values and vaccination records manually for the next
<~X hours> until we confirm it's back. The patient record, vitals,
and prescription pad all work as normal. Thanks for your patience.
— On-call
```

If fallback is working (just slower / more expensive), send the
"degraded but working" variant:

```
Hi team — the AI reader is running in fallback mode. You may see
results take ~30 s instead of ~10 s, but values look fine. No
action needed. — On-call
```

## Resuming after provider recovery

### Step 1 — confirm provider is up

- Provider status page says green.
- A test extraction with the clinical-acceptance fixture succeeds:
  ```bash
  node radhakishan_system/scripts/dis_smoke_test.js --fixture cbc_simple
  ```

### Step 2 — flip back to primary provider

```bash
npx supabase secrets set DIS_OCR_PROVIDER=datalab --project-ref ecywxuqhnlkjtdshpcbc
npx supabase functions deploy dis-ocr --project-ref ecywxuqhnlkjtdshpcbc
```

Confirm logs show `provider=datalab` again.

### Step 3 — batch retry failed extractions

Find everything that failed during the outage window:

```bash
psql "$DATABASE_URL" <<SQL
select id, patient_id, document_type, error_code, created_at
from ocr_extractions
where status = 'failed'
  and error_code in ('OCR_PROVIDER_UNAVAILABLE','OCR_PROVIDER_TIMEOUT')
  and created_at > now() - interval '4 hours'
order by created_at;
SQL
```

Requeue them in batches of 50 (throttled):

```bash
node radhakishan_system/scripts/dis_requeue_failed.js \
  --since "4 hours ago" \
  --error-codes OCR_PROVIDER_UNAVAILABLE,OCR_PROVIDER_TIMEOUT \
  --batch-size 50 \
  --rate 5/s
```

Watch the queue drain:

```bash
watch -n 5 'psql "$DATABASE_URL" -c "select status, count(*) from dis_jobs group by status;"'
```

### Step 4 — verify clinical invariants

```bash
# CS-1: nothing promoted unverified
psql "$DATABASE_URL" -c "select count(*) from lab_results where source='ai_extracted' and verification_status not in ('verified','auto_approved');"  # must be 0

# CS-3: every ai_extracted row has an extraction FK
psql "$DATABASE_URL" -c "select count(*) from lab_results where source='ai_extracted' and ocr_extraction_id is null;"  # must be 0
```

### Step 5 — close the incident

Follow `incident_response.md` §7 exit criteria.

## Schema drift (structuring model regression)

Different class from an outage: Anthropic is **up** but the model has
started returning malformed JSON (triggers `STRUCTURING_SCHEMA_INVALID`
after N retries, per `error_model.md`).

- Do **not** flip providers; the issue is model-side.
- Pin the model version explicitly (TDD §Adapters — configurable via
  `DIS_STRUCTURING_MODEL` with a dated suffix, e.g. `claude-haiku-4-5-20260115`).
- File a SEV2 with sample correlation IDs; attach the raw response
  from `ocr_extractions.raw_structured_response` (CS-2 preserves it).
- Engage Anthropic support if sustained.
