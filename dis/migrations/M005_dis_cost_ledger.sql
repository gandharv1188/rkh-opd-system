-- M-005: dis_cost_ledger — append-only cost + token tracking per extraction.
--
-- Append-only via BEFORE UPDATE/DELETE triggers (same pattern as M-002).
-- cost_micro_inr is stored as integer microrupees to avoid float drift.

create table dis_cost_ledger (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  extraction_id   uuid references ocr_extractions(id) on delete set null,
  provider        text not null,
  operation       text,
  input_tokens    bigint default 0,
  output_tokens   bigint default 0,
  tokens_in       bigint default 0,
  tokens_out      bigint default 0,
  pages           int default 0,
  cost_micro_inr  bigint not null,
  correlation_id  uuid
);

create index idx_cost_ledger_ext     on dis_cost_ledger(extraction_id);
create index idx_cost_ledger_created on dis_cost_ledger(created_at);
create index idx_cost_ledger_prov    on dis_cost_ledger(provider);

create or replace function dis_cost_ledger_immutable()
returns trigger as $$
begin
  raise exception 'dis_cost_ledger is append-only';
end;
$$ language plpgsql;

create trigger trg_dis_cost_ledger_no_update
  before update on dis_cost_ledger
  for each row execute function dis_cost_ledger_immutable();

create trigger trg_dis_cost_ledger_no_delete
  before delete on dis_cost_ledger
  for each row execute function dis_cost_ledger_immutable();
