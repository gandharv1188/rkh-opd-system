-- M-007: Dedupe unique indexes on lab_results + vaccinations (CS-11).
--
-- Partial unique index: only rows with ocr_extraction_id IS NOT NULL are
-- constrained. Legacy / manually entered rows are excluded so existing data
-- cannot accidentally trip the constraint.
--
-- Pre-flight dry-run: if the DIS-originated partition already contains
-- duplicates the migration aborts with RAISE EXCEPTION and prints the key
-- tuples so an operator can investigate before retrying.
--
-- NOTE: test_name_normalized, value_numeric, vaccine_name_normalized are
-- columns the brief references but that do not exist on the current POC
-- schema. To stay portable and avoid coupling this migration to a follow-on
-- normalisation migration, we dedupe on the columns that DO exist today
-- (test_name, test_date, value, value_numeric for labs; vaccine_name,
-- date_given, dose_number for vax). A later migration can add normalised
-- columns and replace these indexes.

do $$
declare
  lab_dup_count int;
  vax_dup_count int;
  lab_dup_sample text;
  vax_dup_sample text;
begin
  select count(*), string_agg(dup_key, ', ')
    into lab_dup_count, lab_dup_sample
  from (
    select patient_id || ':' || test_name || ':' || test_date::text as dup_key
      from lab_results
     where ocr_extraction_id is not null
     group by patient_id, test_name, test_date, coalesce(value_numeric::text, value)
    having count(*) > 1
     limit 10
  ) d;

  if lab_dup_count > 0 then
    raise exception
      'M-007 aborted: % duplicate lab_results rows with ocr_extraction_id exist. Sample keys: %',
      lab_dup_count, lab_dup_sample;
  end if;

  select count(*), string_agg(dup_key, ', ')
    into vax_dup_count, vax_dup_sample
  from (
    select patient_id || ':' || vaccine_name || ':' || date_given::text as dup_key
      from vaccinations
     where ocr_extraction_id is not null
     group by patient_id, vaccine_name, date_given, coalesce(dose_number, 0)
    having count(*) > 1
     limit 10
  ) d;

  if vax_dup_count > 0 then
    raise exception
      'M-007 aborted: % duplicate vaccinations rows with ocr_extraction_id exist. Sample keys: %',
      vax_dup_count, vax_dup_sample;
  end if;
end $$;

create unique index uniq_lab_dedupe
  on lab_results (patient_id, test_name, test_date, coalesce(value_numeric::text, value))
  where ocr_extraction_id is not null;

create unique index uniq_vax_dedupe
  on vaccinations (patient_id, vaccine_name, date_given, coalesce(dose_number, 0))
  where ocr_extraction_id is not null;
