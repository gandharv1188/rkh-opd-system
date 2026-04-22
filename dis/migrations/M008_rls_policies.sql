-- M-008: RLS policies on DIS-owned tables.
--
-- Uses the generic current_setting('app.user_id') / current_setting('app.role')
-- pattern per portability.md §Database portability, so the same policy file
-- works on Supabase and AWS RDS. Wiring (dis/src/adapters/database/
-- supabase-postgres.ts setSessionVars) sets these from JWT claims or service
-- identity at request start.
--
-- No DELETE policy is defined on any DIS table — clinical rows are never
-- deleted (CS-2). Pre-existing tables (lab_results, vaccinations) keep their
-- current policies unchanged.

alter table ocr_extractions   enable row level security;
alter table ocr_audit_log     enable row level security;
alter table dis_jobs          enable row level security;
alter table dis_cost_ledger   enable row level security;

-- ocr_extractions: service / admin / nurse read; service writes; nurse/admin update.
create policy extractions_read on ocr_extractions for select
  using (
    current_setting('app.role', true) in ('service','admin','nurse')
    or current_setting('app.patient_id', true) = patient_id
  );

create policy extractions_insert on ocr_extractions for insert
  with check (current_setting('app.role', true) in ('service'));

create policy extractions_update on ocr_extractions for update
  using (current_setting('app.role', true) in ('service','nurse','admin'));

-- ocr_audit_log: service / admin read everything; nurse reads own extraction
-- audits via join pattern the app layer implements. Only service inserts.
create policy audit_read on ocr_audit_log for select
  using (current_setting('app.role', true) in ('service','admin','nurse'));

create policy audit_insert on ocr_audit_log for insert
  with check (current_setting('app.role', true) in ('service'));

-- dis_jobs: service-only. Workers run under 'service'.
create policy jobs_all on dis_jobs for all
  using (current_setting('app.role', true) = 'service')
  with check (current_setting('app.role', true) = 'service');

-- dis_cost_ledger: service writes, admin reads.
create policy cost_read on dis_cost_ledger for select
  using (current_setting('app.role', true) in ('service','admin'));

create policy cost_insert on dis_cost_ledger for insert
  with check (current_setting('app.role', true) = 'service');
