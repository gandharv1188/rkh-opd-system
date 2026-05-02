-- M-002: ocr_audit_log — append-only via BEFORE UPDATE/DELETE triggers.
--
-- Per TDD §14 + CS-3: every state transition, field edit, approve/reject, and
-- override must be recorded and NEVER mutated. Triggers raise exception on
-- UPDATE/DELETE so the append-only invariant survives even misconfigured RLS.
--
-- Portability: plain Postgres 16, plpgsql (core, always available).

create table ocr_audit_log (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  event           text not null,
  event_type      text,
  actor           text,
  actor_type      text check (actor_type is null or actor_type in ('user','system')),
  actor_id        text,
  subject_id      uuid,
  extraction_id   uuid references ocr_extractions(id) on delete restrict,
  from_state      text,
  to_state        text,
  field_path      text,
  before          jsonb,
  after           jsonb,
  before_value    jsonb,
  after_value     jsonb,
  note            text,
  correlation_id  uuid
);

create index idx_audit_ext     on ocr_audit_log(extraction_id, created_at);
create index idx_audit_subject on ocr_audit_log(subject_id);
create index idx_audit_corr    on ocr_audit_log(correlation_id);

create or replace function ocr_audit_log_immutable()
returns trigger as $$
begin
  raise exception 'ocr_audit_log is append-only';
end;
$$ language plpgsql;

create trigger trg_ocr_audit_log_no_update
  before update on ocr_audit_log
  for each row execute function ocr_audit_log_immutable();

create trigger trg_ocr_audit_log_no_delete
  before delete on ocr_audit_log
  for each row execute function ocr_audit_log_immutable();
