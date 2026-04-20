# Data Model

All DIS tables live in the same Postgres database as the rest of the
application. Tables are prefixed `dis_` OR use verbose clinical names
(`ocr_extractions`, `ocr_audit_log`) for those that reference clinical
concepts directly.

## New tables

### `ocr_extractions` — the staging table

```sql
create table ocr_extractions (
  id                       uuid primary key default gen_random_uuid(),
  idempotency_key          uuid unique not null,
  patient_id               text not null references patients(id)  on delete restrict,
  visit_id                 uuid references visits(id)             on delete restrict,
  uploader_id              text,                                  -- operator who submitted (text for POC; later FK to users)
  source_storage_key       text not null,                         -- path in the storage bucket
  source_content_hash      text not null,                         -- sha256 of the original bytes
  document_category        text not null,                         -- lab_report / discharge_summary / etc.
  document_date            date,                                  -- from structured extraction
  status                   text not null check (status in (
                              'uploaded','preprocessing','ocr','structuring',
                              'ready_for_review','auto_approved',
                              'verified','promoted','rejected','failed')),
  routing_path             text check (routing_path in ('native_text','ocr_scan','ocr_image','office_word','office_sheet')),
  ocr_provider             text,
  ocr_provider_version     text,
  structuring_provider     text,
  structuring_provider_version text,
  schema_version           int not null default 1,                -- clinical_extraction schema version
  raw_ocr_response         jsonb,                                 -- CS-2: preserved forever
  raw_ocr_markdown         text,                                  -- markdown convenience copy
  raw_ocr_blocks           jsonb,                                 -- block list from Chandra JSON
  raw_structured_response  jsonb,                                 -- unvalidated LLM response
  structured               jsonb,                                 -- validated ClinicalExtraction
  verified_structured      jsonb,                                 -- nurse-edited version
  confidence_summary       jsonb,                                 -- {field_path: confidence}
  policy_decision          jsonb,                                 -- {auto_approved: bool, rule_results: [...]}
  version                  int not null default 1,                -- optimistic lock
  verified_by              text,
  verified_at              timestamptz,
  rejected_reason_code     text,
  rejected_reason_note     text,
  promoted_at              timestamptz,
  promotion_result         jsonb,                                 -- {labs_inserted: N, skips: [...], ...}
  error_code               text,
  error_detail             text,
  tokens_in                bigint default 0,
  tokens_out               bigint default 0,
  cost_micro_inr           bigint default 0,
  latency_ms_total         int,
  correlation_id           uuid not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index idx_ocr_ext_patient on ocr_extractions(patient_id);
create index idx_ocr_ext_visit   on ocr_extractions(visit_id);
create index idx_ocr_ext_status  on ocr_extractions(status);
create index idx_ocr_ext_created on ocr_extractions(created_at desc);
create index idx_ocr_ext_hash    on ocr_extractions(source_content_hash);
```

### `ocr_audit_log` — append-only

```sql
create table ocr_audit_log (
  id               bigserial primary key,
  extraction_id    uuid not null references ocr_extractions(id) on delete restrict,
  event_type       text not null,    -- state_transition, field_edit, approve, reject, retry, override
  actor_type       text not null check (actor_type in ('user','system')),
  actor_id         text,
  from_state       text,
  to_state         text,
  field_path       text,
  before_value     jsonb,
  after_value      jsonb,
  note             text,
  correlation_id   uuid,
  created_at       timestamptz not null default now()
);

create index idx_audit_ext on ocr_audit_log(extraction_id, created_at);

-- enforce append-only
create or replace function ocr_audit_log_immutable()
returns trigger as $$
begin
  raise exception 'ocr_audit_log is append-only';
end;
$$ language plpgsql;
create trigger trg_ocr_audit_log_no_update before update on ocr_audit_log
  for each row execute function ocr_audit_log_immutable();
create trigger trg_ocr_audit_log_no_delete before delete on ocr_audit_log
  for each row execute function ocr_audit_log_immutable();
```

### `dis_confidence_policy` — config, not code

```sql
create table dis_confidence_policy (
  id              uuid primary key default gen_random_uuid(),
  version         int not null,
  enabled         boolean not null default false,
  rules           jsonb not null,
  activated_by    text,
  activated_at    timestamptz not null default now(),
  deactivated_at  timestamptz
);
```

Only the most recent row with `deactivated_at IS NULL` is active.

### `dis_jobs` — POC queue backing

```sql
create table dis_jobs (
  id             bigserial primary key,
  topic          text not null,
  payload        jsonb not null,
  available_at   timestamptz not null default now(),
  attempts       int not null default 0,
  max_attempts   int not null default 5,
  locked_until   timestamptz,
  locked_by      text,
  last_error     text,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create index idx_dis_jobs_ready on dis_jobs(topic, available_at) where completed_at is null;
```

On AWS this table is not used — SQS replaces it.

### `dis_cost_ledger`

```sql
create table dis_cost_ledger (
  id               bigserial primary key,
  extraction_id    uuid references ocr_extractions(id) on delete set null,
  provider         text not null,
  operation        text not null,            -- 'ocr' | 'structuring'
  tokens_in        bigint default 0,
  tokens_out       bigint default 0,
  pages            int default 0,
  cost_micro_inr   bigint not null,          -- stored as integer microrupees
  correlation_id   uuid,
  created_at       timestamptz not null default now()
);
create index idx_cost_ledger_created on dis_cost_ledger(created_at);
```

## Modifications to existing tables

### `lab_results`

```sql
alter table lab_results add column if not exists ocr_extraction_id uuid references ocr_extractions(id) on delete restrict;
alter table lab_results add column if not exists verification_status text default 'verified' check (verification_status in ('verified','ai_extracted','auto_approved','manual'));
alter table lab_results add column if not exists verified_by text;
alter table lab_results add column if not exists verified_at timestamptz;

-- duplicate-row guard (CS-11)
create unique index if not exists uniq_lab_dedupe
  on lab_results (patient_id, test_name, test_date, coalesce(value_numeric::text, value));
```

Existing rows: set `verification_status` backfill:
- rows with `source='manual'` → `'manual'`
- rows with `source='ai_extracted'` → `'ai_extracted'` (legacy)
- rows with `source='upload'` → `'verified'`

### `vaccinations`

```sql
alter table vaccinations add column if not exists ocr_extraction_id uuid references ocr_extractions(id) on delete restrict;
alter table vaccinations add column if not exists verification_status text default 'verified' check (verification_status in ('verified','ai_extracted','auto_approved','manual'));
alter table vaccinations add column if not exists verified_by text;
alter table vaccinations add column if not exists verified_at timestamptz;

create unique index if not exists uniq_vax_dedupe
  on vaccinations (patient_id, vaccine_name, date_given, coalesce(dose_number, 0));
```

### `visits.attached_documents`

JSONB structure unchanged. New optional keys added per entry by the
promotion step:

```jsonc
{
  "url": "...",
  "category": "...",
  "ocr_summary": "...",
  "ocr_extraction_id": "uuid",
  "ocr_verification_status": "verified | pending_review | rejected"
}
```

## RLS policies

Supabase-style RLS (generic so it ports):

```sql
alter table ocr_extractions enable row level security;

create policy extractions_read on ocr_extractions for select
  using (
    current_setting('app.role', true) in ('service','admin','nurse')
    or current_setting('app.patient_id', true) = patient_id
  );

create policy extractions_insert on ocr_extractions for insert
  with check (current_setting('app.role', true) in ('service'));

create policy extractions_update on ocr_extractions for update
  using (current_setting('app.role', true) in ('service','nurse','admin'));
```

No DELETE policy — rows are never deleted (CS-2).

## Retention

- `ocr_extractions`: indefinite (clinical record).
- `ocr_audit_log`: indefinite.
- `dis_jobs`: rows removed 30 days after `completed_at`.
- `dis_cost_ledger`: indefinite (finance archive); may be rolled up
  monthly after 1 year.

## Foreign-key topology

```
patients ──┬── ocr_extractions
           │
visits ────┴── ocr_extractions

ocr_extractions ── ocr_audit_log
ocr_extractions ── dis_cost_ledger
ocr_extractions ── lab_results        (ocr_extraction_id)
ocr_extractions ── vaccinations        (ocr_extraction_id)
```

All `ON DELETE RESTRICT`. Deletion of an extraction requires explicit
admin action and leaves an audit trail.
