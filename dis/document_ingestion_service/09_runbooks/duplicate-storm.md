# Duplicate Upload Storm (CS-4)

When many operators upload the same physical document — a ward-round
lab report photocopy passed between nurses, a WhatsApp-forwarded PDF
pasted by three reception desks, an EMR export that a script loops
over — the system does not corrupt clinical data, but the queue,
cost ledger, and nurse UI all get noisy enough to hide real work.

This runbook is for the on-call responder. It assumes the designed-in
behavior from CS-4 holds: **every upload creates a new extraction,
but the hash-dedup path suppresses AI calls and shows the nurse a
DuplicateBanner pointing to the prior verified extraction**. No
clinical tables are mutated silently. The storm is a UX and cost
event, not a data-integrity event.

## Detection

Alert fires on any of:

- `dis.duplicate_rate_high` — `duplicate_of IS NOT NULL` share of
  new extractions in the last 15 min > 30% (baseline ~5%).
- `dis.upload_rate_spike` — extractions/min > 3× 7-day rolling
  median for the same hour-of-day.
- Manual signal: ward lead reports "everyone's upload is showing the
  yellow duplicate banner" or "queue is full of the same filename".

Cross-check: look at the `DuplicateBanner` impression count in the
UI telemetry stream — a storm produces a tight cluster on one
`payload_hash` and/or one filename.

## Severity

- **SEV3** by default. No patient harm, no data loss — CS-4 guards
  hold.
- Escalate to **SEV2** if the storm is masking a real outage
  (e.g. an upstream EMR export loop that is _also_ dropping other
  documents), or if the `dis_jobs` queue depth blocks non-duplicate
  work from running inside SLO.

## Step 1 — Confirm the storm is duplicates, not a general upload spike

You need to know whether this is "many copies of one file" (CS-4
territory, this runbook) or "one operator uploading a thousand
unique files" (rate-limit / abuse territory — see
`incident_response.md`).

```bash
psql "$DATABASE_URL" <<'SQL'
select
  payload_hash,
  count(*)                          as copies,
  count(distinct uploaded_by)       as operators,
  count(distinct patient_id)        as patients,
  min(created_at)                   as first_seen,
  max(created_at)                   as last_seen
from ocr_extractions
where created_at > now() - interval '30 min'
group by payload_hash
having count(*) > 5
order by copies desc
limit 20;
SQL
```

Interpret:

- One row with `copies` ≫ everything else → classic storm, continue.
- Many rows with modest `copies` each → not a storm; check
  `incident_response.md` for rate-limit triage instead.
- `operators = 1` on the top row → probably a script/loop, jump to
  Step 3 with the operator identified.

## Step 2 — Identify the document and the blast radius

Pull the canonical extraction (the first one that won) and its
duplicates:

```bash
psql "$DATABASE_URL" <<'SQL'
with storm as (
  select payload_hash
  from ocr_extractions
  where created_at > now() - interval '30 min'
  group by payload_hash
  order by count(*) desc
  limit 1
)
select
  e.id,
  e.patient_id,
  e.uploaded_by,
  e.duplicate_of,
  e.status,
  e.created_at,
  e.correlation_id
from ocr_extractions e
join storm s on s.payload_hash = e.payload_hash
order by e.created_at;
SQL
```

Record for the incident note:

- Canonical extraction id (`duplicate_of IS NULL`, oldest row).
- Total duplicates and distinct operators.
- Patient id(s) touched — **if duplicates span multiple
  `patient_id`**, this is a CS-7 wrong-patient signal. Escalate
  per `incident_response.md §Wrong-patient suspicion` and stop
  here; do not proceed with cleanup until that is cleared.

## Step 3 — Stop the source

Most storms have a single upstream cause. Work through these in
order:

1. **Script/loop.** If `operators = 1` and arrivals are evenly
   spaced (< 2 s apart), a client is retrying. Contact the
   operator, ask them to stop the script. If unreachable, revoke
   their short-lived upload token:

   ```bash
   supabase functions invoke dis-admin-revoke-token \
     --project-ref ecywxuqhnlkjtdshpcbc \
     --body '{"operator_id":"<UUID>","reason":"DIS-157 storm"}'
   ```

2. **Shared document URL.** If `operators > 3` and arrivals are
   bursty (many within the same minute), someone shared a link or
   forwarded a message. Post in `#ops-ward` asking people to stop
   uploading that specific filename; the DuplicateBanner already
   tells them it's a duplicate, but a human nudge lands faster.

3. **EMR export loop.** If `uploaded_by` is a service account,
   page the integrations on-call — the storm is upstream, not in
   DIS. Do not mutate DIS state; wait for them to quiesce the
   source.

Do not delete the duplicates yet. CS-4 forbids silent cleanup of
extraction rows; we need them for audit.

## Step 4 — Drain the queue without starving real work

During a storm, `dis_jobs` can fill with duplicate entries. Because
the AI adapters are skipped on the hash-dedup path, most of these
jobs are cheap — but they still consume queue slots and log volume.

1. Check queue pressure:

   ```bash
   psql "$DATABASE_URL" <<'SQL'
   select status, count(*) from dis_jobs
   where created_at > now() - interval '30 min'
   group by status;
   SQL
   ```

2. If non-duplicate work is stalling (`status='queued'` p95 wait
   > 30 s for non-duplicate extractions), temporarily raise the
   worker concurrency:

   ```bash
   supabase secrets set --project-ref ecywxuqhnlkjtdshpcbc \
     DIS_WORKER_CONCURRENCY=<current + 4>
   # Redeploy the worker function so the new env takes effect.
   npx supabase functions deploy dis-worker \
     --project-ref ecywxuqhnlkjtdshpcbc
   ```

   Reset this after the storm subsides (Step 6).

3. If duplicates keep piling up faster than they drain, and the
   source in Step 3 is not controllable (e.g. EMR vendor), enable
   the filename rate-limit for the offending `uploaded_by`:

   ```bash
   supabase functions invoke dis-admin-rate-limit \
     --project-ref ecywxuqhnlkjtdshpcbc \
     --body '{"operator_id":"<UUID>","rpm":6,"ttl_minutes":60}'
   ```

   This is a per-operator limit, not global. Note it in the
   incident ticket — it auto-expires in 60 min.

## Step 5 — Reassure the nurses and verify CS-4 held

Storms rattle the floor even when nothing is broken. Before you
close out, confirm the safety invariants and communicate.

1. **Verify no clinical tables were written by duplicates.** Pick
   three duplicate extraction ids from Step 2 and confirm they did
   not produce rows in `clinical_*` tables:

   ```bash
   psql "$DATABASE_URL" <<'SQL'
   select e.id, e.duplicate_of,
          (select count(*) from clinical_lab_results  r where r.extraction_id = e.id) as lab_rows,
          (select count(*) from clinical_diagnoses    d where d.extraction_id = e.id) as dx_rows,
          (select count(*) from clinical_medications  m where m.extraction_id = e.id) as med_rows
   from ocr_extractions e
   where e.id = any($1::uuid[]);
   SQL
   ```

   All three counts MUST be zero on rows where `duplicate_of` is
   set. If any row is non-zero, CS-4 has been violated — page the
   platform lead immediately, do not close the incident.

2. Confirm the canonical extraction is in a terminal state
   (`verified`, `rejected`, or `needs_review`) and the
   DuplicateBanner on each duplicate points at it.

3. Post a short update in `#ops-ward`:

   > Duplicate-upload storm on `<filename>` triaged. You may see
   > the yellow "this document was already read" banner — that's
   > expected, the prior reading is safe. No patient records were
   > changed. Nothing for you to do.

## Step 6 — Stand down and file the after-action

1. Revert any temporary changes:
   - Restore `DIS_WORKER_CONCURRENCY` to its prior value and
     redeploy.
   - Confirm any per-operator rate-limit from Step 4.3 has
     expired, or remove it manually.

2. Leave the duplicate extraction rows in place. **Do not**
   `DELETE` them — they are the audit record that CS-4 was
   upheld. If volume becomes a problem, a retention job (not this
   runbook) archives them after 90 days.

3. Fill in the incident log template at
   `10_handoff/incident_log_template.md` with:
   - canonical extraction id, payload_hash, operator(s), patient(s);
   - peak duplicates/min and total duplicates;
   - upstream cause (script, share, EMR loop, unknown);
   - any mitigations applied and when they were reverted;
   - whether CS-4 held (expected: yes).

4. If the same `payload_hash` storms twice in a week, open a
   follow-up ticket to teach the upstream source to check the
   `DuplicateBanner` response and stop retrying — the fix is
   upstream, not here.

## Related

- CS-4 spec: `01_product/clinical_safety.md §CS-4`
- DuplicateBanner component (DIS-122): shows the canonical
  extraction link to the nurse.
- Content-hash dedup path: `02_architecture/tdd.md §Idempotency`
  and `src/core/content-hash.ts`.
- General incident flow: `incident_response.md`.
- Stuck-job triage (different class, not storm): `stuck_jobs.md`.
