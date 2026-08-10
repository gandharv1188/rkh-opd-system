-- M-006 rollback: drop indexes + columns added to lab_results / vaccinations.
-- Safe because every column added in M-006 is nullable or defaulted, and no
-- downstream code mandates their presence.

drop index if exists idx_lab_results_ocr_ext;
drop index if exists idx_vax_ocr_ext;

alter table lab_results
  drop column if exists ocr_extraction_id,
  drop column if exists verification_status,
  drop column if exists verified_by,
  drop column if exists verified_at;

alter table vaccinations
  drop column if exists ocr_extraction_id,
  drop column if exists verification_status,
  drop column if exists verified_by,
  drop column if exists verified_at;
