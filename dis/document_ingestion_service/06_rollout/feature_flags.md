# DIS Feature Flags

> Catalogue of every flag that governs DIS behaviour. No other flags
> may be introduced without updating this file. Flags are read from the
> source listed under "Evaluated in"; changing a flag requires the change
> path documented below and leaves an entry in `ocr_audit_log` (or
> `dis_config_audit` for global flags).
>
> References: `rollout_plan.md`, `kill_switch.md`,
> `clinical_safety.md` (CS-1…CS-12), TDD §3 (boundaries), §9 (OCR
> providers), §10 (structuring), §12 (confidence policy).

## How to read this document

For each flag:

- **Name** — exact env-var / DB-row name. No renames without a migration.
- **Type** — `bool` | `string` | `int` | `csv`.
- **Default** — value at launch, before anyone has touched it.
- **Evaluated in** — where the flag is read: Edge Function, browser,
  DB policy, or a combination.
- **How to change** — Supabase CLI / Supabase dashboard / DB row /
  deploy env; who can do it.
- **Audit** — what row is written when it changes.
- **Depends on** — other flags it interacts with.

---

## 1. `DIS_ENABLED`

Global on/off for DIS. When `false`, `/ingest` returns 503
`service_disabled` and the browser falls back to legacy `process-document`.

| Attribute     | Value                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Type          | `bool`                                                                                                                            |
| Default       | `false` (becomes `true` at Phase 0 in dev, Phase 1 in prod)                                                                       |
| Evaluated in  | Edge Function `dis-ingest`, Edge Function `dis-verify`, browser (registration.html upload router)                                 |
| How to change | `npx supabase secrets set DIS_ENABLED=true --project-ref <id>` (prod), redeploy is NOT required — Edge Functions read per-request |
| Audit         | `dis_config_audit` row: `flag, old_value, new_value, actor_id, changed_at`                                                        |
| Depends on    | None. This is the master switch.                                                                                                  |

When `false`, all other flags are ignored.

---

## 2. `DIS_KILL_SWITCH`

Instant escape hatch. When `true`, `/ingest` routes the request to the
legacy `process-document` handler (HTTP proxy, same request body). New
DIS extractions are not created. In-flight DIS extractions finish and
remain in `ocr_extractions` (per `kill_switch.md`).

| Attribute     | Value                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type          | `bool`                                                                                                                                                                                                        |
| Default       | `false`                                                                                                                                                                                                       |
| Evaluated in  | Edge Function `dis-ingest` (first thing checked, before any adapter call)                                                                                                                                     |
| How to change | (a) `supabase secrets set DIS_KILL_SWITCH=true`, OR (b) Supabase dashboard → Project Settings → Edge Functions → Secrets, OR (c) DB row in `dis_runtime_flags` (hot reload within 60 s via Postgres `LISTEN`) |
| Audit         | `dis_config_audit` + Slack webhook to `#dis-rollout`                                                                                                                                                          |
| Depends on    | Overrides everything else below when `true`.                                                                                                                                                                  |

Target RTO: flip-to-effect ≤ 5 min (TDD §18). See `kill_switch.md` for
the full procedure.

---

## 3. `DIS_SHADOW_MODE`

When `true`, DIS runs the full pipeline but `PromotionService.promote()`
throws `ShadowModePromotionBlocked`. Extractions land in
`ocr_extractions` with `status = pending_review`. No writes occur in
`lab_results` / `vaccinations` / `visits.attached_documents.ocr_*`.

| Attribute     | Value                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Type          | `bool`                                                                                                             |
| Default       | `true` at Phase 1 start; `false` from Phase 2 onward                                                               |
| Evaluated in  | Edge Function `dis-ingest`, Edge Function `dis-verify` (rejects approve calls with 423 `shadow_mode_active`)       |
| How to change | `supabase secrets set DIS_SHADOW_MODE=false`                                                                       |
| Audit         | `dis_config_audit`                                                                                                 |
| Depends on    | `DIS_ENABLED=true`. Mutually exclusive with Phase 2 opt-in — flipping this to `false` implies Phase 2 is starting. |

---

## 4. `DIS_OPT_IN_OPERATORS`

Comma-separated list of Supabase `auth.users.id` values allowed to route
uploads to DIS during Phase 2. Special value `*` = everyone (Phase 3).

| Attribute     | Value                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Type          | `csv` (UUIDs)                                                                                                                                |
| Default       | `""` (empty list)                                                                                                                            |
| Evaluated in  | Browser (registration.html, to choose upload target) AND Edge Function `dis-ingest` (defense in depth: rejects 403 if caller is not in list) |
| How to change | `supabase secrets set DIS_OPT_IN_OPERATORS="uuid-1,uuid-2"`                                                                                  |
| Audit         | `dis_config_audit` records the full new list + diff (added / removed user IDs)                                                               |
| Depends on    | `DIS_ENABLED=true`, `DIS_SHADOW_MODE=false`.                                                                                                 |

The browser evaluation is a UX nicety; the server evaluation is the
security boundary.

---

## 5. `DIS_OCR_PROVIDER`

Which OCR adapter the structuring pipeline calls (TDD §9.3).

| Attribute     | Value                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| Type          | `string` enum: `datalab` \| `claude` \| `onprem`                                                          |
| Default       | `datalab`                                                                                                 |
| Evaluated in  | Edge Function `dis-ingest` (adapter factory)                                                              |
| How to change | `supabase secrets set DIS_OCR_PROVIDER=claude`                                                            |
| Audit         | `dis_config_audit` + every extraction row records the resolved provider in `ocr_extractions.ocr_provider` |
| Depends on    | `DIS_ENABLED=true`. Per-request override via `x-ocr-provider` header requires service-role auth.          |

`onprem` is a stub in v1 and will return 501 until the on-prem adapter
ships.

---

## 6. `DIS_STRUCTURING_PROVIDER`

Which LLM adapter turns OCR output into the `ClinicalExtraction` schema
(TDD §10.2).

| Attribute     | Value                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| Type          | `string` enum: `haiku` \| `sonnet`                                                                                |
| Default       | `haiku`                                                                                                           |
| Evaluated in  | Edge Function `dis-ingest` (adapter factory)                                                                      |
| How to change | `supabase secrets set DIS_STRUCTURING_PROVIDER=sonnet`                                                            |
| Audit         | `dis_config_audit` + every extraction row records the resolved provider in `ocr_extractions.structuring_provider` |
| Depends on    | `DIS_ENABLED=true`.                                                                                               |

Escalation rule (future): if Haiku returns `confidence < 0.6` on key
fields, retry with Sonnet. Not enabled at launch.

---

## 7. `DIS_AUTO_APPROVAL_ENABLED`

Master switch for confidence-gated auto-approval (TDD §12, CS-7).
**Mandated `false` at launch** by clinical_safety.md CS-7. Any change
requires a separate governance ticket signed off by the clinical lead.

| Attribute     | Value                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Type          | `bool`                                                                                                                          |
| Default       | `false`                                                                                                                         |
| Evaluated in  | Edge Function `dis-ingest` (PromotionService)                                                                                   |
| How to change | Governance ticket → update row in `dis_confidence_policy` (`enabled: true`, bump `version`, set `activated_by`, `activated_at`) |
| Audit         | `dis_confidence_policy` is append-only; old rows remain. Also `dis_config_audit`.                                               |
| Depends on    | `DIS_ENABLED=true`, clinical-lead sign-off per CS-7.                                                                            |

This flag is not toggleable via env var — it is a database-controlled
policy so that the audit record lives next to the clinical tables.

---

## 8. `DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE`

Threshold below which a PDF is treated as a scan and routed through OCR
instead of native-text extraction (TDD §7 file routing).

| Attribute     | Value                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Type          | `int`                                                                                                                           |
| Default       | `100`                                                                                                                           |
| Evaluated in  | Edge Function `dis-ingest` (FileRouter)                                                                                         |
| How to change | `supabase secrets set DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE=150`                                                                   |
| Audit         | `dis_config_audit`. Each extraction records the resolved path in `ocr_extractions.file_route` (`NATIVE_TEXT` / `OCR_SCAN` / …). |
| Depends on    | `DIS_ENABLED=true`.                                                                                                             |

---

## 9. `DIS_MAX_PAGES`

Hard cap on pages per document (TDD §8 preprocessing).

| Attribute     | Value                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| Type          | `int`                                                                    |
| Default       | `50`                                                                     |
| Evaluated in  | Edge Function `dis-ingest` (Preprocessor)                                |
| How to change | `supabase secrets set DIS_MAX_PAGES=75`                                  |
| Audit         | `dis_config_audit`. Requests exceeding the cap get 413 `too_many_pages`. |
| Depends on    | `DIS_ENABLED=true`.                                                      |

---

## 10. `DIS_MAX_UPLOAD_MB`

Client-side and server-side file-size guard (DIS-US-001).

| Attribute     | Value                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type          | `int` (MB)                                                                                                                                                                              |
| Default       | `20`                                                                                                                                                                                    |
| Evaluated in  | Browser (pre-upload check in registration.html) AND Edge Function `dis-ingest` (HTTP 413 on oversize)                                                                                   |
| How to change | `supabase secrets set DIS_MAX_UPLOAD_MB=30`. Browser reads the same value from an injected `<meta name="dis-max-upload-mb">` populated at render by the Edge Function serving the page. |
| Audit         | `dis_config_audit`                                                                                                                                                                      |
| Depends on    | `DIS_ENABLED=true`.                                                                                                                                                                     |

---

## Flag interaction matrix (who dominates whom)

```
DIS_ENABLED=false        → everything off. Legacy only.
DIS_KILL_SWITCH=true     → legacy, regardless of all other flags.
DIS_SHADOW_MODE=true     → DIS runs but cannot promote. Opt-in list ignored.
DIS_SHADOW_MODE=false
  + OPT_IN_OPERATORS=""  → DIS reachable only by service-role callers.
  + OPT_IN_OPERATORS=… → listed operators route to DIS; others → legacy.
  + OPT_IN_OPERATORS=*   → everyone routes to DIS.
DIS_AUTO_APPROVAL_ENABLED is independent and always gated by
dis_confidence_policy.enabled (CS-7).
```

## Audit trail schema (for reference)

```sql
CREATE TABLE dis_config_audit (
  id BIGSERIAL PRIMARY KEY,
  flag_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT
);

CREATE TABLE dis_runtime_flags (
  flag_name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);
```

All flag reads hit the Secrets adapter (env) first; `DIS_KILL_SWITCH`
additionally consults `dis_runtime_flags` via Postgres `LISTEN/NOTIFY`
for sub-minute propagation without a redeploy.

## What is NOT a feature flag

The following are configuration and live in different places:

- Confidence thresholds per field → `dis_confidence_policy` rows.
- Prompt versions → `prompts/structuring.md` git history (TDD §10.2).
- JSON schema versions → `schemas/clinical_extraction.vN.json` files.
- Nurse-visible copy → UI code, not flags.

Anything clinically significant that changes behaviour must be a row in
an audit-logged table, not a free-floating env var.
