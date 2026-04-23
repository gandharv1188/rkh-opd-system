# Runbook: Schema Drift (Claude model update breaks v1)

**Scope:** Document Ingestion Service (DIS) extraction pipeline. Triggers when a Claude model upgrade (e.g., Sonnet 4.6 → 4.7, Haiku 4.5 → 4.6) produces outputs that no longer validate against the v1 extraction JSON schema.

**Owner:** DIS on-call.
**Related:** DIS-030 (Pydantic validator), DIS-031 (prompt loader), DIS-051 (Haiku adapter).

---

## Step 1 — Detect

Schema drift surfaces as a spike in `SchemaValidationError` after a model version change.

Signals to check:
- Metric: `dis.extraction.schema_validation_error_rate` — alert fires if > 2% over a 15-min window (baseline < 0.3%).
- Log filter: `level=ERROR AND event=schema_validation_failed` in the extraction Edge Function logs.
- Queue depth: `extraction_failed` state count in `dis_documents` grows abnormally.
- Correlate with deploy log / `ANTHROPIC_API_MODEL` env change timestamp.

Confirm drift (vs. transient API issue) by checking that failures concentrate on specific fields rather than scattered timeouts.

---

## Step 2 — Triage

Identify the blast radius before acting.

1. Pull the last 50 failed extractions and run DIS-030's validator in verbose mode:
   ```
   npm run dis:validate -- --source failed --limit 50 --verbose
   ```
   The validator (DIS-030) emits per-field Pydantic error paths (e.g., `patient.dob: expected string, got null`).
2. Bucket errors by field path. A single dominant path (>70% of failures) means a localized prompt/schema mismatch. A long tail means broader model-behavior shift.
3. Check DIS-051 Haiku adapter output if the failing model is Haiku — adapter-layer normalization may be dropping fields the new model emits.
4. Capture one representative raw Claude response for post-mortem (store in `dis/incidents/<DATE>/sample.json`).

**Decision point:** if validator error rate > 10% of live traffic, proceed to Step 3 immediately. Otherwise continue triaging.

---

## Step 3 — Stopgap

Stabilize before fixing.

1. **Pin the model.** Roll `ANTHROPIC_API_MODEL` back to the last-known-good version via Supabase secrets:
   ```
   npx supabase secrets set ANTHROPIC_API_MODEL=claude-sonnet-4-6 --project-ref ecywxuqhnlkjtdshpcbc
   ```
   DIS-031 (prompt loader) reads this env on cold start; redeploy the Edge Function to force a reload.
2. **Kill-switch** (if pinning is not enough — e.g., old model is retired): flip `DIS_EXTRACTION_ENABLED=false`. The ingestion pipeline queues documents in `pending_extraction` without calling Claude. Patient-facing UX degrades gracefully (manual entry fallback).
3. Announce in #dis-oncall with incident ID, affected field(s), and pinned model version.

Proceed only once the error-rate metric returns below alert threshold.

---

## Step 4 — Fix

Two paths depending on triage outcome.

**Path A — Prompt hotfix (preferred for narrow drift):**
- Update the extraction prompt in `dis/src/core/prompts/extraction_v1.md` (owned by DIS-031).
- Add an explicit instruction targeting the drifted field (e.g., "Always emit `dob` as ISO-8601 string; if unknown, emit `null`, never omit the key").
- Test against the captured failure sample; require 20/20 pass before merging.
- Deploy. Unpin the model (Step 3.1 reversed) and watch the metric for 30 min.

**Path B — Schema v2 (required if the new model's output shape is structurally different and the change is desirable):**
- Draft `dis/src/core/schemas/extraction_v2.py` alongside v1. Do NOT mutate v1 — legacy extractions must keep validating.
- Update DIS-030 validator to select schema version from a `schema_version` column on `dis_documents` (default `v1`).
- Cut new extractions over to v2 behind a flag. Leave v1 live for read paths.

Either way: add a regression test to `dis/tests/fixtures/model_drift/<incident_id>.json` so the failure mode is covered going forward.

---

## Step 5 — Migrate

Clean up documents that fell into the `failed` state during the incident window.

1. Query affected rows:
   ```sql
   SELECT id FROM dis_documents
   WHERE state = 'extraction_failed'
     AND updated_at BETWEEN '<incident_start>' AND '<incident_end>';
   ```
2. Re-queue via the back-fill job:
   ```
   npm run dis:backfill -- --state extraction_failed --since <incident_start>
   ```
   The job re-runs extraction against the fixed prompt/schema and transitions successful rows to `extracted`.
3. Spot-check 10 back-filled extractions manually before declaring the migration complete.
4. For rows that still fail after back-fill, escalate to the data-quality triage queue — they are likely source-document issues, not drift.

---

## Step 6 — Post-mortem

Within 48 hours of resolution:

1. Write the incident up in `dis/incidents/<DATE>-schema-drift/postmortem.md`. Cover: detection latency, root cause (model version, field, prompt gap), customer impact (# docs delayed), what the stopgap bought.
2. Add action items:
   - Does DIS-030's validator need stricter pre-production coverage (golden fixtures per model version)?
   - Should DIS-031 gate model upgrades behind a canary (e.g., 5% traffic for 24h before full cutover)?
   - Is the `schema_version` column present on `dis_documents`? If not, file a follow-up.
3. Update this runbook with anything learned (failure signatures, new metrics, better back-fill queries).
4. Review with the DIS squad at the next weekly; close the incident ticket only after action items have owners.
