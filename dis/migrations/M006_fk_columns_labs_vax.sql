-- M-006: Add FK + verification columns to lab_results and vaccinations.
--
-- CAUTION: lab_results and vaccinations live in the Radhakishan POC DB. This
-- migration is additive (ALTER TABLE ADD COLUMN IF NOT EXISTS, NULLABLE FK)
-- and therefore safe to apply mechanically — but any run against LIVE data
-- requires clinical sign-off per Epic G / rollout_plan.md (Stage C gate).
-- Staging-only application in this wave per CRITICAL rule 1.
--
-- verification_status default 'legacy' matches the brief's backfill target
-- for rows that pre-date DIS. The backfill is idempotent and only touches
-- rows where verification_status IS NULL AND source IS NOT NULL (i.e. rows
-- created by the legacy registration flow).
--
-- Uses IF NOT EXISTS so a partial re-run does not error.

alter table lab_results
  add column if not exists ocr_extraction_id    uuid references ocr_extractions(id) on delete restrict,
  add column if not exists verification_status  text not null default 'legacy'
    check (verification_status in ('legacy','verified','ai_extracted','auto_approved','manual')),
  add column if not exists verified_by          text,
  add column if not exists verified_at          timestamptz;

alter table vaccinations
  add column if not exists ocr_extraction_id    uuid references ocr_extractions(id) on delete restrict,
  add column if not exists verification_status  text not null default 'legacy'
    check (verification_status in ('legacy','verified','ai_extracted','auto_approved','manual')),
  add column if not exists verified_by          text,
  add column if not exists verified_at          timestamptz;

-- Backfill: legacy rows inherit 'legacy' status. Idempotent — a second run
-- finds no matches because the first run set every candidate row.
update lab_results
   set verification_status = 'legacy'
 where verification_status is null
   and source is not null;

-- vaccinations has no `source` column; mark all pre-DIS rows as 'legacy'
-- where the column was just defaulted. No-op after first run.
update vaccinations
   set verification_status = 'legacy'
 where verification_status is null;

create index if not exists idx_lab_results_ocr_ext on lab_results(ocr_extraction_id);
create index if not exists idx_vax_ocr_ext         on vaccinations(ocr_extraction_id);
