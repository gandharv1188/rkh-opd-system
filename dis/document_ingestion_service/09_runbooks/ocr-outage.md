# Runbook: OCR Provider Outage

**Incident class:** External OCR provider degraded or unavailable — DIS pipeline cannot extract text from uploaded documents (lab reports, imaging, discharge summaries).

**Owner / on-call:** DIS squad — `dev-a-ocr` primary, `team-lead` escalation. Paged via PagerDuty rotation `DIS-ONCALL` (placeholder).

**Estimated impact:** Document ingestion stalls; uploaded PDFs/images sit in `pending_ocr` state. Registration flow still accepts uploads (they enqueue). Prescription Pad cannot surface freshly uploaded lab values until OCR resumes. Retroactive catch-up required once provider returns.

---

## Step 1 — Detect

**Signals that mean OCR is down:**
- Grafana alert `dis_ocr_error_rate > 20%` sustained 5 min.
- CloudWatch / Supabase Logs: repeated 5xx or timeout from the OCR Edge Function (`dis-ocr-extract`).
- `documents` table: rows with `ocr_status = 'failed'` or `ocr_status = 'pending'` growing > 10/min.
- User reports from registration desk: "upload spinner never finishes" or "lab values missing".

**First 60 seconds:** open the DIS observability dashboard, confirm the spike is provider-wide (not a single bad file). Note incident start time — needed for post-mortem.

## Step 2 — Triage

Determine **which** provider is failing:

1. Check `DIS_OCR_PROVIDER` env on the Edge Function. Current value = primary.
2. **If primary is Datalab Chandra:** check https://status.datalab.to — upstream outage? Rate-limit? Auth failure (expired key)?
3. **If primary is Claude Vision:** check https://status.anthropic.com — API degraded? Our `ANTHROPIC_API_KEY` still valid? Quota exceeded?
4. Tail Edge Function logs: `npx supabase functions logs dis-ocr-extract --project-ref ecywxuqhnlkjtdshpcbc` — look for the actual error string (401/403 = auth; 429 = rate limit; 5xx = provider down; network timeout = connectivity).

Record finding in the incident channel before moving to Step 3. If the failure is **our bug** (bad payload, schema change), stop the runbook and fix forward instead of flipping the kill-switch.

## Step 3 — Kill-switch

If error rate > 20% sustained 5 min **and** the cause is confirmed provider-side:

1. Set feature flag `DIS_KILL_SWITCH=true` (Supabase secrets or `app_config` row — see `dis/document_ingestion_service/05_config/feature_flags.md`).
2. Legacy flow takes over: registration page falls back to free-text lab entry + document upload without OCR extraction. Users unblocked; files queued for later processing.
3. Announce in #ops-alerts: "DIS OCR kill-switch engaged at HH:MM. Legacy upload path live. ETA TBD."

The kill-switch must flip cleanly with zero deploy — if it requires a code push, that is a runbook bug; file a ticket.

## Step 4 — Fall-back

Switch to the **secondary** OCR provider:

- If **Datalab** is down → `npx supabase secrets set DIS_OCR_PROVIDER=claude_vision --project-ref ecywxuqhnlkjtdshpcbc`.
- If **Claude Vision** is down → `npx supabase secrets set DIS_OCR_PROVIDER=datalab --project-ref ecywxuqhnlkjtdshpcbc`.

Redeploy the function (secrets pick up on next cold start; force with `npx supabase functions deploy dis-ocr-extract`). Once secondary is live, disengage the kill-switch (`DIS_KILL_SWITCH=false`) so new uploads flow through OCR again. Monitor error rate for 10 min; if secondary also fails, re-engage kill-switch and escalate.

## Step 5 — Recovery

1. Confirm primary provider is healthy (status page green, manual test via `curl` against OCR endpoint with a sample PDF).
2. Flip `DIS_OCR_PROVIDER` back to primary (if it is cheaper / preferred).
3. **Drain the backlog:** run `scripts/dis/reprocess_failed_ocr.js` to re-enqueue rows with `ocr_status IN ('failed','pending')` from the incident window. Watch the queue depth fall to zero.
4. Spot-check 5 reprocessed documents: open in Prescription Pad, confirm extracted text matches the original.
5. Close the incident in the ops channel with start/end timestamps and total docs reprocessed.

## Step 6 — Post-mortem

Within 48 hours:

1. Write incident report in `dis/document_ingestion_service/10_incidents/YYYY-MM-DD-ocr-outage.md`. Use the standard 5-section template (summary, timeline, root cause, impact, action items).
2. If anything in this runbook was wrong, stale, or missing — **update this file in the same PR as the incident report**. Runbooks rot silently; the only defence is the discipline of editing them after every use.
3. File action items as tickets (DIS-###). Typical items: improve alerting threshold, add automated kill-switch, reduce secondary-provider cold-start, pre-warm secondary credentials.
