# Key Rotation Runbook

Covers rotation of the three secrets DIS depends on:

- `DATALAB_API_KEY` — OCR provider.
- `ANTHROPIC_API_KEY` — structuring LLM (Haiku) and Claude fallback OCR.
- `DATABASE_URL` / Supabase service-role key — DB credentials.

## When to rotate

| Trigger                                                                          | Urgency                        | Who authorizes                  |
| -------------------------------------------------------------------------------- | ------------------------------ | ------------------------------- |
| Scheduled 90-day cycle                                                           | Planned, business-hours window | Primary on-call                 |
| Suspected leak (key visible in a log, screenshot, client-side, or public commit) | **Immediate — within 1 hour**  | Primary on-call + Security lead |
| Provider-forced rotation (Datalab / Anthropic revokes)                           | Immediate                      | Primary on-call                 |
| Employee with access leaves                                                      | Within 24 h                    | Primary on-call                 |

Rotation is cheap — when in doubt, rotate.

## Golden rule

**Never revoke the old key until the new one is confirmed in use.**
Cached secrets in Edge Function runtimes live for up to 5 minutes (TDD
§16). Revoke too early and every in-flight extraction fails.

---

## POC procedure (Supabase)

### Step 1 — mint a new key at the provider

- **Datalab:** dashboard → API keys → "Create". Tag `dis-poc-<YYYYMMDD>`.
- **Anthropic:** console.anthropic.com → API Keys → Create Key. Tag
  `dis-poc-<YYYYMMDD>`.
- **Supabase service key:** Project Settings → API → "Reset service
  role". **Warning:** this replaces the only service key immediately,
  so this flow is different — see §Step 1b.

Copy the new value into a local scratch file (shred after).

### Step 1b — special handling for Supabase service role

Because Supabase only keeps one service key at a time, there is no
overlap window. To minimize risk:

1. Announce a 5-minute freeze in `#dis-incidents`.
2. Flip kill switch ON: `update dis_confidence_policy set value='false' where key='dis_enabled';`
3. Reset the key in the Supabase dashboard.
4. Proceed to Step 2 with the new value, redeploy Edge Functions.
5. Unflip kill switch.

### Step 2 — set the new secret

```bash
# Datalab
npx supabase secrets set DATALAB_API_KEY="<NEW_VALUE>" --project-ref ecywxuqhnlkjtdshpcbc

# Anthropic
npx supabase secrets set ANTHROPIC_API_KEY="<NEW_VALUE>" --project-ref ecywxuqhnlkjtdshpcbc

# Verify it's set (value will be redacted)
npx supabase secrets list --project-ref ecywxuqhnlkjtdshpcbc
```

### Step 3 — redeploy Edge Functions to pick up the new secret

```bash
npx supabase functions deploy dis-ocr          --project-ref ecywxuqhnlkjtdshpcbc
npx supabase functions deploy dis-structure    --project-ref ecywxuqhnlkjtdshpcbc
npx supabase functions deploy dis-promote      --project-ref ecywxuqhnlkjtdshpcbc
```

Redeploy forces a new isolate, invalidating the ≤5-min secret cache.

### Step 4 — verify new key in use

Trigger a test extraction using the clinical-acceptance fixture:

```bash
cd radhakishan_system/scripts
node dis_smoke_test.js --fixture discharge_simple --project-ref ecywxuqhnlkjtdshpcbc
```

Grab the `correlation_id` from the output, then confirm the provider
call used the new key:

```bash
supabase functions logs dis-ocr --project-ref ecywxuqhnlkjtdshpcbc --since 2m \
  | grep "<CORRELATION_ID>" \
  | grep "key_fingerprint"
```

The log line includes `key_fingerprint=<last-6-chars>`. It must match
the new key's last 6 characters, not the old key's.

### Step 5 — old-key grace period

Wait **at least 5 minutes** after last redeploy before revoking old key
(secret cache TTL, TDD §16).

Then revoke the old key at the provider dashboard.

### Step 6 — log the rotation

```bash
psql "$DATABASE_URL" <<SQL
insert into ocr_audit_log (actor, action, details)
values ('oncall:<NAME>', 'key_rotation',
        jsonb_build_object('provider','datalab','old_fingerprint','<OLD6>','new_fingerprint','<NEW6>','reason','<scheduled|leak|etc>'));
SQL
```

---

## Prod procedure (AWS Secrets Manager)

### Step 1 — stage new version

```bash
aws secretsmanager put-secret-value \
  --secret-id dis/prod/datalab-api-key \
  --secret-string "<NEW_VALUE>" \
  --version-stages AWSPENDING \
  --region ap-south-1
```

### Step 2 — promote to AWSCURRENT

```bash
aws secretsmanager update-secret-version-stage \
  --secret-id dis/prod/datalab-api-key \
  --version-stage AWSCURRENT \
  --move-to-version-id "$(aws secretsmanager describe-secret --secret-id dis/prod/datalab-api-key --region ap-south-1 --query 'VersionIdsToStages' --output json | jq -r 'to_entries[] | select(.value[] == "AWSPENDING") | .key')" \
  --remove-from-version-id "$(aws secretsmanager describe-secret --secret-id dis/prod/datalab-api-key --region ap-south-1 --query 'VersionIdsToStages' --output json | jq -r 'to_entries[] | select(.value[] == "AWSCURRENT") | .key')" \
  --region ap-south-1
```

### Step 3 — rolling restart of ECS tasks

```bash
aws ecs update-service \
  --cluster dis-prod \
  --service dis-ocr-worker \
  --force-new-deployment \
  --region ap-south-1

aws ecs update-service --cluster dis-prod --service dis-structure-worker --force-new-deployment --region ap-south-1
aws ecs update-service --cluster dis-prod --service dis-promote-worker   --force-new-deployment --region ap-south-1
```

Wait for `runningCount == desiredCount` on all three.

### Step 4 — verify new key in use

Same as POC Step 4 but against the prod smoke endpoint:

```bash
node dis_smoke_test.js --fixture discharge_simple --env prod
```

Inspect CloudWatch Logs group `/dis/prod/ocr`:

```bash
aws logs filter-log-events \
  --log-group-name /dis/prod/ocr \
  --filter-pattern "<CORRELATION_ID>" \
  --region ap-south-1
```

### Step 5 — mark the old version deprecated

```bash
aws secretsmanager update-secret-version-stage \
  --secret-id dis/prod/datalab-api-key \
  --version-stage AWSPREVIOUS \
  --remove-from-version-id "<OLD_VERSION_ID>" \
  --region ap-south-1
```

After the 5-minute cache window, revoke the old key at the provider.

---

## Verification checklist (both environments)

- [ ] Smoke-test extraction completed successfully with new key.
- [ ] `key_fingerprint` in logs matches new key.
- [ ] `dis_cost_ledger` shows a new entry after rotation.
- [ ] Old key rejected when tested directly (`curl` with old key → 401).
- [ ] Rotation row written to `ocr_audit_log`.
- [ ] Next rotation date added to calendar (90 days out).

## Rollback if the new key fails

1. **Do not** revoke the old key yet (that's why we wait 5 min).
2. Re-set the secret to the old value:
   ```bash
   npx supabase secrets set DATALAB_API_KEY="<OLD_VALUE>" --project-ref ecywxuqhnlkjtdshpcbc
   npx supabase functions deploy dis-ocr --project-ref ecywxuqhnlkjtdshpcbc
   ```
   (AWS equivalent: move `AWSCURRENT` back to the prior version id.)
3. Confirm extractions succeed again.
4. File a SEV2 incident. Root-cause the new-key failure (wrong scope?
   wrong region? provider delay propagating?) before retrying.
