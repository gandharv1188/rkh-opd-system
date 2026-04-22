-- M-001: ocr_extractions staging table + idempotency_keys
--
-- Creates the DIS pipeline's primary staging table where every document
-- ingestion lands and progresses through its lifecycle states. Also provisions
-- the generic idempotency_keys table consumed by dis/src/core/idempotency-store.ts
-- (DIS-025). Keeping both in the same migration is deliberate: both ship with
-- the first DIS release and share no dependencies on later migrations, and
-- avoiding a separate M-001a keeps the `npx dbmate up` ordering unambiguous.
--
-- Portability: plain Postgres 16. Uses pgcrypto's gen_random_uuid() per
-- portability.md §Database portability (available on both Supabase and AWS RDS).
-- No Supabase-specific features used.
--
-- CS-2 / CS-3: raw_ocr_response and raw_structured_response are preserved
-- forever (clinical audit trail). No DELETE policy is added here; M-008 adds
-- RLS without a DELETE policy so rows become de-facto immutable-by-RLS.

create extension if not exists pgcrypto;

create table ocr_extractions (
  id                            uuid primary key default gen_random_uuid(),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  version                       int not null default 1,
  correlation_id                uuid not null,
  idempotency_key               uuid unique not null,
  status                        text not null check (status in (
                                   'uploaded','preprocessing','ocr','structuring',
                                   'ready_for_review','auto_approved',
                                   'verified','promoted','rejected','failed')),
  patient_id                    text not null,
  visit_id                      uuid,
  uploader_id                   text,
  document_type                 text,
  document_date                 date,
  file_url                      text,
  source_storage_key            text,
  content_hash                  text,
  source_content_hash           text,
  routing_path                  text check (routing_path in (
                                   'native_text','ocr_scan','ocr_image',
                                   'office_word','office_sheet')),
  ocr_provider                  text,
  ocr_provider_version          text,
  structuring_provider          text,
  structuring_provider_version  text,
  schema_version                int not null default 1,
  raw_response                  jsonb,
  raw_ocr_response              jsonb,
  raw_ocr_markdown              text,
  raw_ocr_blocks                jsonb,
  raw_structured_response       jsonb,
  structured                    jsonb,
  verified_structured           jsonb,
  confidence_scores             jsonb,
  confidence_summary            jsonb,
  verification_state            jsonb,
  policy_decision               jsonb,
  verified_by                   text,
  verified_at                   timestamptz,
  rejected_reason_code          text,
  rejected_reason_note          text,
  promoted_at                   timestamptz,
  promotion_result              jsonb,
  error_code                    text,
  error_detail                  text,
  tokens_in                     bigint default 0,
  tokens_out                    bigint default 0,
  cost_micro_inr                bigint default 0,
  latency_ms_total              int,
  parent_extraction_id          uuid references ocr_extractions(id) on delete restrict
);

create index idx_ocr_ext_patient on ocr_extractions(patient_id);
create index idx_ocr_ext_visit   on ocr_extractions(visit_id);
create index idx_ocr_ext_status  on ocr_extractions(status);
create index idx_ocr_ext_idem    on ocr_extractions(idempotency_key);
create index idx_ocr_ext_created on ocr_extractions(created_at desc);
create index idx_ocr_ext_hash    on ocr_extractions(content_hash);

-- idempotency_keys: consumed by dis/src/core/idempotency-store.ts (DIS-025).
-- Schema matches IdempotencyStore's SELECT/INSERT fragments exactly.
create table idempotency_keys (
  key           text primary key,
  payload_hash  text not null,
  created_at    timestamptz not null default now()
);
