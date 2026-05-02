-- M-008 rollback: drop every policy added + disable RLS on DIS-owned tables.

drop policy if exists extractions_read   on ocr_extractions;
drop policy if exists extractions_insert on ocr_extractions;
drop policy if exists extractions_update on ocr_extractions;

drop policy if exists audit_read   on ocr_audit_log;
drop policy if exists audit_insert on ocr_audit_log;

drop policy if exists jobs_all on dis_jobs;

drop policy if exists cost_read   on dis_cost_ledger;
drop policy if exists cost_insert on dis_cost_ledger;

alter table ocr_extractions   disable row level security;
alter table ocr_audit_log     disable row level security;
alter table dis_jobs          disable row level security;
alter table dis_cost_ledger   disable row level security;
