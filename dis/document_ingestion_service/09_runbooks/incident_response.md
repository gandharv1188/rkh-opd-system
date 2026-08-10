# Incident Response — Master Playbook

Start here for any DIS incident. Follow top-to-bottom. If in doubt,
**flip the kill switch first, investigate second**.

## 1. Severity definitions

| Level    | Definition                                                                                                         | Examples                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SEV1** | Clinical-safety incident. Wrong or unverified data reached a clinical table, prescription, or patient-facing view. | Any CS-1, CS-3, CS-5, CS-10, CS-11, CS-12 violation. Weekly clinician audit finds a verified-but-wrong row. Cross-patient data leak (CS-8 breach). |
| **SEV2** | Service degraded but no patient harm.                                                                              | 5xx > 5% for 5 min. OCR provider outage > 15 min. Queue backlog > 200 and growing. Failed migration in progress.                                   |
| **SEV3** | Individual job stuck or minor anomaly. No user-visible degradation.                                                | Single extraction stuck in `ocr` > 5 min. Cost spike < 3x. UI confidence display glitch for one nurse.                                             |

## 2. Paging matrix (see `08_team/RACI.md`)

| Severity | Page                                                            | Within            | Keep informed  |
| -------- | --------------------------------------------------------------- | ----------------- | -------------- |
| SEV1     | Primary on-call + Clinical reviewer (Dr. Goyal) + Product owner | 5 min             | Hospital admin |
| SEV2     | Primary on-call                                                 | 15 min            | Secondary SRE  |
| SEV3     | Primary on-call (email/ticket, not page)                        | Next business day | —              |

## 3. First 15 minutes (the stabilize-snapshot-comms loop)

### 3a. Stabilize (minutes 0–5)

```bash
# a. Check service health
curl -s https://ecywxuqhnlkjtdshpcbc.supabase.co/functions/v1/dis-health | jq .

# b. Check kill-switch state
psql "$DATABASE_URL" -c "select key, value from dis_confidence_policy where key='dis_enabled';"

# c. Decide: flip kill switch? (see tree below in §4)
```

If SEV1 or trend is worsening fast — **flip the kill switch now**:

```bash
psql "$DATABASE_URL" -c "update dis_confidence_policy set value='false', updated_at=now(), updated_by='oncall:<NAME>' where key='dis_enabled';"
```

Reception immediately falls back to pre-DIS manual-entry workflow.

### 3b. Snapshot state (minutes 5–10)

Capture evidence **before** anything else changes:

```bash
# Correlation IDs from the last 30 min of errors
supabase functions logs dis-ocr --project-ref ecywxuqhnlkjtdshpcbc --since 30m > /tmp/incident-$(date +%s)-ocr.log
supabase functions logs dis-structure --project-ref ecywxuqhnlkjtdshpcbc --since 30m > /tmp/incident-$(date +%s)-structure.log
supabase functions logs dis-promote --project-ref ecywxuqhnlkjtdshpcbc --since 30m > /tmp/incident-$(date +%s)-promote.log

# Snapshot affected extraction IDs
psql "$DATABASE_URL" -c "\copy (select id, status, error_code, correlation_id, created_at from ocr_extractions where created_at > now() - interval '30 min' and status in ('failed','error')) to '/tmp/incident-extractions.csv' csv header"

# Queue depth
psql "$DATABASE_URL" -c "select status, count(*) from dis_jobs group by status;"

# Cost ledger delta
psql "$DATABASE_URL" -c "select provider, sum(cost_usd) from dis_cost_ledger where created_at > now() - interval '1 hour' group by provider;"
```

### 3c. Begin comms (minutes 10–15)

Post in `#dis-incidents` channel using this template:

```
[SEV<1|2|3>] DIS <one-line summary>
Start: <HH:MM IST>
Impact: <what users / patients see>
Current state: <kill-switch ON|OFF, provider <up|down>, queue depth N>
IC (incident commander): <name>
Next update: in 30 min
Correlation IDs: <3-5 sample IDs>
```

For SEV1, also ring Dr. Goyal directly and note time of first clinical
contact in the timeline.

## 4. Kill-switch decision tree

```
Is any CS-## safeguard confirmed violated?
 ├─ YES ──────────────────────────────► FLIP KILL SWITCH (no debate)
 └─ NO ──► Is 5xx rate > 5% for 5 min?
          ├─ YES ─► Is the cause clearly a single transient provider blip (< 2 min)?
          │         ├─ YES ─► Do NOT flip. Monitor. Provider retry will recover.
          │         └─ NO  ─► FLIP KILL SWITCH.
          └─ NO  ─► Is queue backlog > 500 or growing at > 10/min sustained?
                    ├─ YES ─► FLIP KILL SWITCH (prevent data-loss risk on requeue).
                    └─ NO  ─► Do not flip. Proceed to diagnosis.
```

Unflip only when: root cause confirmed fixed, verification fixtures
pass, and clinical reviewer concurs (for SEV1 origin).

```bash
psql "$DATABASE_URL" -c "update dis_confidence_policy set value='true', updated_at=now(), updated_by='oncall:<NAME>:unflip' where key='dis_enabled';"
```

## 5. Incident timeline template

Create a file `incidents/YYYY-MM-DD-<slug>.md` and fill as you go:

```
# Incident <slug>

- Severity: SEV<1|2|3>
- Detected: <HH:MM IST> via <alert name | user report | audit>
- Declared: <HH:MM IST>
- IC: <name>
- Scribe: <name>
- Resolved: <HH:MM IST>
- Duration: <mm:ss>

## Impact
- Users affected: <N nurses / all reception>
- Patients affected: <N extractions, list IDs>
- Clinical rows affected: <N, by table>
- Data loss: <none | describe>

## Timeline (IST)
- HH:MM  Alert fired: <rule>
- HH:MM  <action>
- HH:MM  Kill switch flipped / unflipped / n/a
- HH:MM  Root cause identified: <one line>
- HH:MM  Fix deployed: <commit sha>
- HH:MM  Unflipped, monitoring
- HH:MM  All-clear

## Root cause (2-3 sentences)

## Contributing factors

## What went well

## What went badly

## Action items
- [ ] <owner> <date>  <item>
```

## 6. Post-incident review

- **Blameless.** Never names-and-shames. Focus on systems.
- **72-hour max** from all-clear to published review.
- Required sections: impact, timeline, root cause, contributing
  factors, action items (each with owner + due date).
- For SEV1: review presented to clinical reviewer and product owner;
  at least one action item must be a test (fixture, integration, or
  CI guard) that would have caught this bug.
- File stored in `incidents/` alongside the timeline doc.
- Action items tracked in `07_tickets/` as new tickets tagged
  `post-incident`.

## 7. Exit criteria (all-clear)

Before declaring resolved:

- [ ] Kill switch state matches intent (usually ON again).
- [ ] 5xx rate < 1% for 10 consecutive minutes.
- [ ] Queue depth trending down.
- [ ] No new alerts for 15 min.
- [ ] For SEV1: clinical reviewer confirms any suspect rows are
      quarantined / corrected.
- [ ] Snapshot files moved from `/tmp/` into the incident folder.
- [ ] Comms update posted: "All-clear at HH:MM. Review by <date>."
