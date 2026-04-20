# DIS Kill Switch Runbook

> The kill switch is the single fastest way to revert to the legacy
> `process-document` path without a code deploy. It exists because DIS
> is verification-gated clinical software: when in doubt, fall back.
>
> **Recovery Time Objective (RTO):** flip to full effect in ≤ 5 minutes
> (TDD §18).
>
> References: `feature_flags.md` §2, `rollout_plan.md`,
> `clinical_safety.md` CS-1…CS-12.

## What the kill switch does

When `DIS_KILL_SWITCH=true`:

1. Edge Function `dis-ingest` reads the flag as the first instruction
   and returns an HTTP-307 proxy to the legacy `process-document`
   handler with the original request body unchanged. The browser sees
   the legacy response. No DIS extraction row is created.
2. `dis-verify` (approve/reject) continues to operate on already-
   created extractions. This is intentional: nurses can still verify
   or reject anything already in the queue.
3. `PromotionService.promote()` still honours verified approvals so
   that work-in-progress is not orphaned.
4. The realtime status channel stops emitting new events for new
   uploads (nothing new arrives).
5. The shadow-diff worker (Phase 1 only) is paused if
   `DIS_SHADOW_MODE` is still `true` at kill time.

Net effect: the hospital continues functioning on the legacy pipeline
exactly as before DIS.

## What the kill switch does NOT do

- It does NOT delete any rows in `ocr_extractions` or `ocr_audit_log`.
- It does NOT roll back already-promoted `lab_results` / `vaccinations`.
- It does NOT disable the verification UI for existing `pending_review`
  extractions — nurses can still finish the queue.
- It does NOT change `DIS_AUTO_APPROVAL_ENABLED` (which is `false`
  anyway at launch per CS-7).

---

## How to flip it (three paths, in order of speed)

### Path A — Supabase CLI (fastest, ~60 s to effect)

```bash
# From any machine with supabase CLI + access to the prod project
npx supabase secrets set DIS_KILL_SWITCH=true --project-ref ecywxuqhnlkjtdshpcbc

# Verify
npx supabase secrets list --project-ref ecywxuqhnlkjtdshpcbc | grep DIS_KILL_SWITCH
```

Edge Functions pick up the new secret on the next cold start. To force
immediate propagation, either wait up to 60 s for natural rotation, or:

```bash
# Touch the function to force a fresh instance
npx supabase functions deploy dis-ingest --project-ref ecywxuqhnlkjtdshpcbc --no-verify-jwt
```

### Path B — Supabase dashboard (UI, ~2 min)

1. Open https://supabase.com/dashboard/project/ecywxuqhnlkjtdshpcbc
2. Left nav → **Project Settings** → **Edge Functions** → **Secrets**.
3. Find `DIS_KILL_SWITCH`. Click **Edit**. Set value to `true`. Save.
4. Left nav → **Edge Functions** → **dis-ingest**. Click **Deploy** (no
   code change needed; this forces a fresh instance that reads the new
   secret).

### Path C — Hot DB row (sub-minute, does not require redeploy)

The function also consults `dis_runtime_flags`. If CLI and dashboard
are both unreachable:

```sql
-- Open Supabase SQL editor
INSERT INTO dis_runtime_flags (flag_name, value, updated_by)
VALUES ('DIS_KILL_SWITCH', 'true', auth.uid())
ON CONFLICT (flag_name) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = now(),
      updated_by = EXCLUDED.updated_by;

NOTIFY dis_runtime_flags, 'DIS_KILL_SWITCH';
```

Each Edge Function instance holds a Postgres `LISTEN dis_runtime_flags`
channel and flips its in-memory flag within seconds.

### Vercel path (when the admin dashboard ships on Vercel)

If/when `/admin/metrics` UI is hosted on Vercel:

```bash
vercel env add DIS_KILL_SWITCH production
# enter "true" when prompted
vercel deploy --prod
```

The Edge Functions are the source of truth — the Vercel flag is only
for the admin UI's own behaviour.

---

## How to detect it has taken effect

Three independent signals, all must show within 5 minutes of flip:

1. **Log line.** Every request to `/ingest` emits JSON Lines. Look for:

   ```
   {"level":"info","event":"kill_switch_active","route":"legacy_proxy","request_id":"…"}
   ```

   In Supabase dashboard → Edge Functions → dis-ingest → Logs, filter
   on `event = "kill_switch_active"`. Expected rate ≈ incoming upload
   rate (should match legacy baseline).

2. **Metric.** `/admin/metrics` field `kill_switch_requests_per_min > 0`
   and `dis_extractions_created_per_min == 0` sustained for 2 minutes.

3. **SQL probe.**
   ```sql
   SELECT COUNT(*) FROM ocr_extractions
   WHERE created_at > now() - interval '2 minutes';
   ```
   Should be 0 after kill-switch takes effect (modulo in-flight when
   flip happened).

If any of the three signals disagree after 5 minutes, assume the flip
did not fully propagate: redo Path A with a forced redeploy, then Path
C as a belt-and-braces step.

---

## When to use the kill switch

### Automatic triggers (alert → page → on-call flips switch)

- **Error rate > 5% over any 10-minute window.** Measured as
  `count(status='failed') / count(new extractions)` in `ocr_extractions`.
  Monitored by the admin metrics job; fires a PagerDuty-style webhook.
- **P95 end-to-end latency > 180 s over any 10-minute window.**
- **Any row written to `lab_results` or `vaccinations` where the
  linked `ocr_extractions.status != 'verified'`** — this would be a
  CS-1 violation. DB trigger alerts immediately.
- **Datalab provider outage** sustained > 15 min AND `DIS_OCR_PROVIDER`
  is not switchable to `claude` fast enough.

### Manual triggers

- **Clinical-safety incident.** Any report from a clinician that a
  verified lab value appears wrong. Flip first, investigate later (CS-#
  "Out-of-band safeguards"). See `comms_and_training.md` for the
  escalation path.
- **Suspected prompt regression.** Sudden spike in edit rate or reject
  rate that correlates with a prompt/model deploy.
- **Data-exfiltration concern / key compromise.** Flip the switch, then
  rotate keys per `09_runbooks/key_rotation.md`.
- **Supabase platform incident** that degrades DIS specifically (e.g.
  pg_cron failure preventing queue drains).

On-call may flip the switch at their discretion; they do not need
clinical-lead sign-off to turn DIS **off**. They DO need sign-off to
turn it back on (see "un-flip" below).

---

## Downstream effects after the flip

Immediately:

- New uploads go through legacy. Reception UX is unchanged — the same
  "AI summary" etc. appears because legacy still writes to
  `visits.attached_documents.ocr_*` as it always has.
- In-flight DIS extractions (state `preprocessing` / `ocr` /
  `structuring`) continue to their natural terminal state — success
  writes to `ocr_extractions` only; failure writes to `ocr_extractions`
  with `status='failed'`. **No clinical tables are touched** by these
  finishers while `DIS_SHADOW_MODE=true`; during non-shadow phases, a
  verified extraction would still be allowed to promote through the
  nurse UI. That is intentional: don't orphan nurse work.
- Nurses can still open `pending_review` items and verify/reject them.
  This drains the queue and does not recreate the incident.

Within 10 minutes:

- Admin metrics show `kill_switch_requests_per_min` matching upload
  rate; `dis_extractions_created_per_min` is 0.
- Shadow-diff worker (if running) has paused; no new rows in
  `dis_shadow_diffs`.

Within 24 hours (manual steps owned by on-call + engineering lead):

- Incident report drafted in `09_runbooks/incidents/<date>-dis-killed.md`.
- Comms sent per `comms_and_training.md` §"Rollback announcement".

---

## How to un-flip (turn DIS back on)

**Do not simply reverse the flag.** If DIS was killed because of a
clinical-safety incident, the path back is:

1. Engineering lead writes the RCA in
   `09_runbooks/incidents/<date>-dis-killed.md` — root cause, evidence,
   fix.
2. Fix merged to `main` and deployed.
3. Red-team adversarial fixtures re-run — all must pass.
4. **Re-enter shadow mode for at least 48 h.** Set:
   - `DIS_KILL_SWITCH=false`
   - `DIS_SHADOW_MODE=true`
   - `DIS_OPT_IN_OPERATORS=""`
     During this period, the diff worker runs and agreement metrics are
     re-validated (see `rollout_plan.md` Phase 1 exit criteria).
5. Clinical lead reviews shadow metrics and explicitly signs off on
   resuming the previous phase (2 or 3).
6. Set `DIS_SHADOW_MODE=false` and restore the operator list.

If DIS was killed for non-safety reasons (e.g. Datalab outage), the
shadow-mode re-soak may be shortened to 4 hours, but the RCA and
clinical-lead sign-off are still required.

Every un-flip is logged in `dis_config_audit` with a mandatory `reason`
field referencing the RCA document.

---

## Test schedule

- **Quarterly game day.** On-call engineer flips the kill switch on a
  Tuesday morning with 24 h notice to reception. Confirm all three
  detection signals. Un-flip within 1 h after verifying effect.
  Document drift from the 5-minute RTO target.
- **Before every phase transition.** `kill_switch.md` is executed in
  staging as a precondition for entering Phase 2 and Phase 3.
- **After every Edge Function deploy.** CI runs a synthetic request
  that forces `DIS_KILL_SWITCH=true` in a test project and asserts the
  legacy-proxy path responds correctly.

## Known limitations

- If Supabase is itself down, no path works. In that case the hospital
  is already down and kill switch is moot.
- If the legacy `process-document` function has been deleted (Phase 4+),
  the kill switch no longer has a legacy target — at that point, the
  rollback strategy is "redeploy legacy from git history" rather than
  a flag flip. This is called out in `rollout_plan.md` Phase 4.
