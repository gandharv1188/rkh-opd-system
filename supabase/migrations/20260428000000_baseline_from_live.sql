-- ============================================================================
-- Migration: 20260428_000_baseline_from_live
-- Created:   2026-04-28 (captured 2026-04-29)
-- Sprint:    1 (foundation — pulled before any safety changes ship)
-- Decision:  21 (schema baseline) — pulled forward from Sprint 4 because the
--            new prescription_audit table (decision 18) would otherwise widen
--            the existing repo↔live drift instead of reconciling it.
--
-- Source:    pg_catalog of project ecywxuqhnlkjtdshpcbc, captured via the
--            read-only Supabase MCP server. Reflects EXACT live state as of
--            the capture time. Idempotent (every CREATE uses IF NOT EXISTS).
--
-- Counts captured: 13 tables, 55 indexes, 56 constraints (FK/check/unique),
--                  22 RLS policies, 4 sequences, 4 extensions, 0 triggers.
--
-- Rollback:  This is a baseline. Do NOT roll back — it's the authoritative
--            picture of the live database. If something here is wrong,
--            reconcile by writing a NEW migration on top, not by editing
--            this file.
-- ============================================================================

-- ============================================================================
-- Extensions (already enabled on live; idempotent)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- supabase_vault and pg_stat_statements are managed by the Supabase platform.
-- They are intentionally NOT created here.

-- ============================================================================
-- Tables (in FK-safe creation order: parents before children)
-- ============================================================================

-- patients (parent table — referenced by visits, growth_records, etc.)
CREATE TABLE IF NOT EXISTS public.patients (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  dob                   date,
  sex                   text,
  guardian_name         text,
  guardian_relation     text,
  contact_phone         text,
  blood_group           text,
  known_allergies       text[],
  gestational_age_weeks numeric,
  birth_weight_kg       numeric,
  is_active             boolean DEFAULT true,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  abha_number           text,
  abha_address          text,
  abha_verified         boolean DEFAULT false,
  abha_linking_token    text,
  abha_linked_at        timestamptz,
  CONSTRAINT patients_id_check                  CHECK (id ~ '^RKH-\d{11}$'),
  CONSTRAINT patients_sex_check                 CHECK (sex = ANY (ARRAY['Male'::text,'Female'::text,'Other'::text])),
  CONSTRAINT patients_gestational_age_weeks_check CHECK (gestational_age_weeks >= 22 AND gestational_age_weeks <= 44),
  CONSTRAINT patients_birth_weight_kg_check     CHECK (birth_weight_kg >= 0.3 AND birth_weight_kg <= 6.0)
);

-- doctors
CREATE TABLE IF NOT EXISTS public.doctors (
  id              text PRIMARY KEY,
  full_name       text NOT NULL,
  degree          text,
  registration_no text,
  specialisation  text,
  contact_phone   text,
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  hpr_id          text
);

-- visits (depends on patients)
CREATE TABLE IF NOT EXISTS public.visits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          text NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  visit_date          date NOT NULL DEFAULT CURRENT_DATE,
  doctor_id           text,
  weight_kg           numeric,
  height_cm           numeric,
  hc_cm               numeric,
  muac_cm             numeric,
  temp_f              numeric,
  hr_per_min          integer,
  rr_per_min          integer,
  spo2_pct            numeric,
  chief_complaints    text,
  diagnosis_codes     jsonb,
  clinical_notes      text,
  triage_score        integer,
  raw_dictation       text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  visit_summary       text,
  consultation_fee    numeric DEFAULT 0,
  payment_mode        text DEFAULT 'cash',
  payment_status      text DEFAULT 'pending',
  bp_systolic         integer,
  bp_diastolic        integer,
  map_mmhg            numeric,
  procedures          jsonb,
  attached_documents  jsonb,
  bmi                 numeric,
  vax_schedule        text,
  receipt_no          text,
  CONSTRAINT visits_weight_kg_check    CHECK (weight_kg >= 0.3 AND weight_kg <= 200),
  CONSTRAINT visits_height_cm_check    CHECK (height_cm >= 20 AND height_cm <= 220),
  CONSTRAINT visits_hc_cm_check        CHECK (hc_cm >= 15 AND hc_cm <= 60),
  CONSTRAINT visits_muac_cm_check      CHECK (muac_cm >= 5 AND muac_cm <= 30),
  CONSTRAINT visits_temp_f_check       CHECK (temp_f >= 85 AND temp_f <= 110),
  CONSTRAINT visits_hr_per_min_check   CHECK (hr_per_min >= 20 AND hr_per_min <= 300),
  CONSTRAINT visits_rr_per_min_check   CHECK (rr_per_min >= 5 AND rr_per_min <= 120),
  CONSTRAINT visits_spo2_pct_check     CHECK (spo2_pct >= 0 AND spo2_pct <= 100),
  CONSTRAINT visits_bp_systolic_check  CHECK (bp_systolic >= 30 AND bp_systolic <= 300),
  CONSTRAINT visits_bp_diastolic_check CHECK (bp_diastolic >= 20 AND bp_diastolic <= 200),
  CONSTRAINT visits_triage_score_check CHECK (triage_score >= 0 AND triage_score <= 15),
  CONSTRAINT visits_diagnosis_codes_check CHECK (diagnosis_codes IS NULL OR jsonb_typeof(diagnosis_codes) = 'array'),
  CONSTRAINT visits_procedures_check   CHECK (procedures IS NULL OR jsonb_typeof(procedures) = 'array'),
  CONSTRAINT visits_payment_mode_check CHECK (payment_mode = ANY (ARRAY['cash'::text,'upi'::text,'waived'::text])),
  CONSTRAINT visits_payment_status_check CHECK (payment_status = ANY (ARRAY['paid'::text,'pending'::text,'waived'::text])),
  CONSTRAINT visits_vax_schedule_check CHECK (vax_schedule = ANY (ARRAY['nhm'::text,'iap'::text]))
);

-- prescriptions
CREATE TABLE IF NOT EXISTS public.prescriptions (
  id              text PRIMARY KEY,
  visit_id        uuid NOT NULL REFERENCES public.visits(id) ON DELETE RESTRICT,
  patient_id      text NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  generated_json  jsonb NOT NULL,
  medicines       jsonb,
  investigations  jsonb,
  vaccinations    jsonb,
  growth          jsonb,
  approved_by     text,
  approved_at     timestamptz,
  is_approved     boolean DEFAULT false,
  pdf_url         text,
  qr_data         jsonb,
  version         integer DEFAULT 1,
  edit_notes      text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  fhir_bundle     jsonb,
  CONSTRAINT prescriptions_medicines_check     CHECK (medicines IS NULL OR jsonb_typeof(medicines) = 'array'),
  CONSTRAINT prescriptions_investigations_check CHECK (investigations IS NULL OR jsonb_typeof(investigations) = 'array'),
  CONSTRAINT prescriptions_vaccinations_check  CHECK (vaccinations IS NULL OR jsonb_typeof(vaccinations) = 'object'),
  CONSTRAINT prescriptions_growth_check        CHECK (growth IS NULL OR jsonb_typeof(growth) = 'object'),
  CONSTRAINT prescriptions_qr_data_check       CHECK (qr_data IS NULL OR jsonb_typeof(qr_data) = 'object')
);

-- formulary
CREATE TABLE IF NOT EXISTS public.formulary (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generic_name                text NOT NULL UNIQUE,
  drug_class                  text,
  category                    text,
  brand_names                 text[],
  therapeutic_use             text[],
  licensed_in_children        text DEFAULT 'true',
  unlicensed_note             text,
  formulations                jsonb,
  dosing_bands                jsonb,
  renal_adjustment_required   boolean DEFAULT false,
  renal_bands                 jsonb,
  hepatic_adjustment_required boolean DEFAULT false,
  hepatic_note                text,
  black_box_warnings          text[],
  contraindications           text[],
  cross_reactions             text[],
  interactions                jsonb,
  monitoring_parameters       text[],
  pediatric_specific_warnings text[],
  administration              jsonb,
  food_instructions           text,
  storage_instructions        text,
  pregnancy_category          text,
  lactation_safe              text,
  lactation_note              text,
  reference_source            text[],
  last_reviewed_date          date,
  notes                       text,
  active                      boolean DEFAULT true,
  created_at                  timestamptz DEFAULT now(),
  updated_at                  timestamptz DEFAULT now(),
  snomed_code                 text,
  snomed_display              text,
  data_source                 text DEFAULT 'manual',
  CONSTRAINT formulary_licensed_in_children_check CHECK (licensed_in_children = ANY (ARRAY['true'::text,'partial'::text,'false'::text])),
  CONSTRAINT formulary_data_source_check          CHECK (data_source = ANY (ARRAY['snomed_branded'::text,'snomed_generic'::text,'orphan'::text,'manual'::text])),
  CONSTRAINT formulary_formulations_check         CHECK (formulations IS NULL OR jsonb_typeof(formulations) = 'array'),
  CONSTRAINT formulary_dosing_bands_check         CHECK (dosing_bands IS NULL OR jsonb_typeof(dosing_bands) = 'array'),
  CONSTRAINT formulary_renal_bands_check          CHECK (renal_bands IS NULL OR jsonb_typeof(renal_bands) = 'array'),
  CONSTRAINT formulary_interactions_check         CHECK (interactions IS NULL OR jsonb_typeof(interactions) = 'array'),
  CONSTRAINT formulary_administration_check       CHECK (administration IS NULL OR jsonb_typeof(administration) = 'array')
);

-- standard_prescriptions
CREATE TABLE IF NOT EXISTS public.standard_prescriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  icd10                    text,
  diagnosis_name           text NOT NULL,
  category                 text,
  severity                 text DEFAULT 'any',
  first_line_drugs         jsonb,
  second_line_drugs        jsonb,
  investigations           jsonb,
  duration_days_default    integer,
  counselling              text[],
  referral_criteria        text,
  hospitalisation_criteria text,
  notes                    text,
  source                   text,
  last_reviewed_date       date,
  active                   boolean DEFAULT true,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  guideline_changes        text,
  snomed_code              text,
  warning_signs            jsonb,
  expected_course          text,
  key_clinical_points      text[],
  severity_assessment      jsonb,
  monitoring_parameters    jsonb,
  snomed_display           text,
  CONSTRAINT standard_prescriptions_first_line_drugs_check  CHECK (first_line_drugs IS NULL OR jsonb_typeof(first_line_drugs) = 'array'),
  CONSTRAINT standard_prescriptions_second_line_drugs_check CHECK (second_line_drugs IS NULL OR jsonb_typeof(second_line_drugs) = 'array'),
  CONSTRAINT standard_prescriptions_investigations_check    CHECK (investigations IS NULL OR jsonb_typeof(investigations) = 'array')
);

-- vaccinations
CREATE TABLE IF NOT EXISTS public.vaccinations (
  id            integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  patient_id    text REFERENCES public.patients(id) ON DELETE RESTRICT,
  vaccine_name  text NOT NULL,
  dose_number   integer,
  date_given    date,
  next_due_date date,
  batch_number  text,
  given_by      text,
  visit_id      uuid REFERENCES public.visits(id),
  free_or_paid  text,
  route         text,
  site          text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  CONSTRAINT vaccinations_free_or_paid_check CHECK (free_or_paid = ANY (ARRAY['free_uip'::text,'paid'::text]))
);

-- growth_records
CREATE TABLE IF NOT EXISTS public.growth_records (
  id             integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  patient_id     text REFERENCES public.patients(id) ON DELETE RESTRICT,
  visit_id       uuid REFERENCES public.visits(id),
  recorded_date  date DEFAULT CURRENT_DATE,
  weight_kg      numeric,
  height_cm      numeric,
  hc_cm          numeric,
  muac_cm        numeric,
  waz            numeric,
  haz            numeric,
  whz            numeric,
  hcaz           numeric,
  chart_used     text,
  classification text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- lab_results
CREATE TABLE IF NOT EXISTS public.lab_results (
  id              integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  patient_id      text NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  visit_id        uuid REFERENCES public.visits(id),
  test_name       text NOT NULL,
  test_category   text,
  value           text NOT NULL,
  value_numeric   numeric,
  unit            text,
  reference_range text,
  flag            text,
  test_date       date NOT NULL DEFAULT CURRENT_DATE,
  lab_name        text,
  source          text DEFAULT 'manual',
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  loinc_code      text,
  snomed_code     text,
  CONSTRAINT lab_results_flag_check   CHECK (flag = ANY (ARRAY['normal'::text,'low'::text,'high'::text,'critical'::text,'abnormal'::text])),
  CONSTRAINT lab_results_source_check CHECK (source = ANY (ARRAY['manual'::text,'ai_extracted'::text,'upload'::text]))
);

-- developmental_screenings
CREATE TABLE IF NOT EXISTS public.developmental_screenings (
  id              integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  patient_id      text NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  visit_id        uuid REFERENCES public.visits(id),
  screening_date  date DEFAULT CURRENT_DATE,
  tool_used       text,
  gross_motor     text,
  fine_motor      text,
  language        text,
  social          text,
  cognitive       text,
  overall_result  text,
  red_flags       text[],
  referral_needed boolean DEFAULT false,
  referral_to     text,
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- abdm_care_contexts
CREATE TABLE IF NOT EXISTS public.abdm_care_contexts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        text NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  visit_id          uuid REFERENCES public.visits(id),
  prescription_id   text REFERENCES public.prescriptions(id),
  care_context_ref  text NOT NULL,
  display_text      text NOT NULL,
  record_types      text[] NOT NULL,
  linked            boolean DEFAULT false,
  linked_at         timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- abdm_consent_artefacts
CREATE TABLE IF NOT EXISTS public.abdm_consent_artefacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id      text NOT NULL UNIQUE,
  patient_id      text REFERENCES public.patients(id) ON DELETE RESTRICT,
  requester_name  text,
  purpose         text,
  hi_types        text[],
  date_range_from timestamptz,
  date_range_to   timestamptz,
  expiry          timestamptz,
  status          text DEFAULT 'REQUESTED',
  artefact_json   jsonb,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT abdm_consent_artefacts_status_check CHECK (status = ANY (ARRAY['REQUESTED'::text,'GRANTED'::text,'DENIED'::text,'REVOKED'::text,'EXPIRED'::text]))
);

-- loinc_investigations (reference data, ~74,000 rows on live)
CREATE TABLE IF NOT EXISTS public.loinc_investigations (
  loinc_code         text PRIMARY KEY,
  component          text NOT NULL,
  long_name          text NOT NULL,
  short_name         text,
  display_name       text,
  consumer_name      text,
  class              text NOT NULL,
  class_type         text,
  system_specimen    text,
  property           text,
  scale              text,
  method             text,
  example_units      text,
  example_ucum_units text,
  order_obs          text,
  related_names      text,
  common_test_rank   integer DEFAULT 0,
  common_order_rank  integer DEFAULT 0,
  active             boolean DEFAULT true
);

-- ============================================================================
-- Indexes (55 captured live)
-- ============================================================================

-- abdm_care_contexts
CREATE INDEX IF NOT EXISTS idx_abdm_cc_patient ON public.abdm_care_contexts (patient_id);
CREATE INDEX IF NOT EXISTS idx_abdm_cc_ref     ON public.abdm_care_contexts (care_context_ref);

-- abdm_consent_artefacts
CREATE INDEX IF NOT EXISTS idx_abdm_consent_id      ON public.abdm_consent_artefacts (consent_id);
CREATE INDEX IF NOT EXISTS idx_abdm_consent_patient ON public.abdm_consent_artefacts (patient_id);
CREATE INDEX IF NOT EXISTS idx_abdm_consent_status  ON public.abdm_consent_artefacts (status);

-- developmental_screenings
CREATE INDEX IF NOT EXISTS idx_devscreen_patient ON public.developmental_screenings (patient_id);
CREATE INDEX IF NOT EXISTS idx_devscreen_date    ON public.developmental_screenings (patient_id, screening_date DESC);

-- formulary
CREATE INDEX IF NOT EXISTS idx_formulary_active     ON public.formulary (active);
CREATE INDEX IF NOT EXISTS idx_formulary_brands     ON public.formulary USING gin (brand_names);
CREATE INDEX IF NOT EXISTS idx_formulary_cat        ON public.formulary (category);
CREATE INDEX IF NOT EXISTS idx_formulary_datasource ON public.formulary (data_source);
CREATE INDEX IF NOT EXISTS idx_formulary_name       ON public.formulary (generic_name);
CREATE INDEX IF NOT EXISTS idx_formulary_snomed     ON public.formulary (snomed_code) WHERE snomed_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_formulary_use        ON public.formulary USING gin (therapeutic_use);

-- growth_records
CREATE INDEX IF NOT EXISTS idx_growth_patient      ON public.growth_records (patient_id);
CREATE INDEX IF NOT EXISTS idx_growth_patient_date ON public.growth_records (patient_id, recorded_date DESC);

-- lab_results
CREATE INDEX IF NOT EXISTS idx_lab_patient      ON public.lab_results (patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_patient_date ON public.lab_results (patient_id, test_date DESC);
CREATE INDEX IF NOT EXISTS idx_lab_test         ON public.lab_results (test_name);

-- loinc_investigations
CREATE INDEX IF NOT EXISTS idx_loinc_class     ON public.loinc_investigations (class);
CREATE INDEX IF NOT EXISTS idx_loinc_component ON public.loinc_investigations (component);
CREATE INDEX IF NOT EXISTS idx_loinc_rank      ON public.loinc_investigations (common_test_rank) WHERE common_test_rank > 0;
CREATE INDEX IF NOT EXISTS idx_loinc_search    ON public.loinc_investigations USING gin (
  to_tsvector('english'::regconfig, ((((component || ' ') || COALESCE(long_name, '')) || ' ') || COALESCE(related_names, '')))
);

-- patients
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_abha ON public.patients (abha_number) WHERE abha_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patients_active      ON public.patients (is_active);
CREATE INDEX IF NOT EXISTS idx_patients_name        ON public.patients (name);

-- prescriptions
CREATE INDEX IF NOT EXISTS idx_rx_approved ON public.prescriptions (is_approved);
CREATE INDEX IF NOT EXISTS idx_rx_date     ON public.prescriptions (created_at);
CREATE INDEX IF NOT EXISTS idx_rx_patient  ON public.prescriptions (patient_id);
CREATE INDEX IF NOT EXISTS idx_rx_visit    ON public.prescriptions (visit_id);

-- standard_prescriptions
CREATE INDEX IF NOT EXISTS idx_stdpx_active ON public.standard_prescriptions (active);
CREATE INDEX IF NOT EXISTS idx_stdpx_cat    ON public.standard_prescriptions (category);
CREATE INDEX IF NOT EXISTS idx_stdpx_icd10  ON public.standard_prescriptions (icd10);
CREATE INDEX IF NOT EXISTS idx_stdpx_name   ON public.standard_prescriptions (diagnosis_name);

-- vaccinations
CREATE INDEX IF NOT EXISTS idx_vax_due           ON public.vaccinations (next_due_date);
CREATE INDEX IF NOT EXISTS idx_vax_patient       ON public.vaccinations (patient_id);
CREATE INDEX IF NOT EXISTS idx_vax_patient_name  ON public.vaccinations (patient_id, vaccine_name);

-- visits
CREATE INDEX IF NOT EXISTS idx_visits_date         ON public.visits (visit_date);
CREATE INDEX IF NOT EXISTS idx_visits_patient      ON public.visits (patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_patient_date ON public.visits (patient_id, visit_date DESC);

-- ============================================================================
-- Row-Level Security (live policies — anon_full_access for POC, authenticated_full_access for logged-in)
-- Sprint 4 will replace anon_full_access with per-role policies (decision 22 Phase B).
-- ============================================================================

ALTER TABLE public.patients                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formulary                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standard_prescriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vaccinations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_records           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_results              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.developmental_screenings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abdm_care_contexts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abdm_consent_artefacts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loinc_investigations     ENABLE ROW LEVEL SECURITY;

-- Policies (idempotent-ish: drop-then-create since CREATE POLICY has no IF NOT EXISTS)
DO $$
DECLARE
  t text;
  tables_with_anon       text[] := ARRAY['developmental_screenings','doctors','formulary','growth_records','lab_results','patients','prescriptions','standard_prescriptions','vaccinations','visits'];
  tables_with_auth       text[] := ARRAY['abdm_care_contexts','abdm_consent_artefacts','developmental_screenings','formulary','growth_records','patients','prescriptions','standard_prescriptions','vaccinations','visits'];
BEGIN
  FOREACH t IN ARRAY tables_with_anon LOOP
    EXECUTE format('DROP POLICY IF EXISTS anon_full_access ON public.%I', t);
    EXECUTE format('CREATE POLICY anon_full_access ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)', t);
  END LOOP;

  FOREACH t IN ARRAY tables_with_auth LOOP
    EXECUTE format('DROP POLICY IF EXISTS authenticated_full_access ON public.%I', t);
    EXECUTE format('CREATE POLICY authenticated_full_access ON public.%I FOR ALL TO public USING (auth.role() = ''authenticated'')', t);
  END LOOP;

  -- loinc_investigations has its own policy names
  DROP POLICY IF EXISTS anon_full_access_loinc ON public.loinc_investigations;
  CREATE POLICY anon_full_access_loinc ON public.loinc_investigations FOR ALL TO anon USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS anon_read_loinc ON public.loinc_investigations;
  CREATE POLICY anon_read_loinc ON public.loinc_investigations FOR SELECT TO anon USING (true);
END
$$;

-- ============================================================================
-- Notes
-- ============================================================================
-- - All sequences (developmental_screenings_id_seq, growth_records_id_seq,
--   lab_results_id_seq, vaccinations_id_seq) are auto-created by the
--   GENERATED BY DEFAULT AS IDENTITY clauses above; no separate CREATE
--   SEQUENCE needed.
-- - Live database has 0 user-defined triggers.
-- - Storage buckets (website, prescriptions, documents) are NOT in this
--   migration — they are managed via the Supabase dashboard or the
--   `supabase/storage_policies.sql` file scheduled for Sprint 5.
