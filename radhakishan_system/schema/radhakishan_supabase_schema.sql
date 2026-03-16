-- ============================================================
-- RADHAKISHAN HOSPITAL — COMPLETE SUPABASE SCHEMA
-- Pediatric & Neonatal OPD Prescription System
-- Version 2026 | Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ============================================================
-- DROP EXISTING TABLES (clean slate — comment out if updating)
-- ============================================================
drop table if exists growth_records cascade;
drop table if exists vaccinations cascade;
drop table if exists prescriptions cascade;
drop table if exists visits cascade;
drop table if exists patients cascade;
drop table if exists standard_prescriptions cascade;
drop table if exists formulary cascade;

-- ============================================================
-- 1. FORMULARY
-- One row per drug. Dosing bands, formulations, safety all
-- stored as JSONB arrays so each drug can have multiple
-- age bands, calculation methods, and formulations.
-- ============================================================
create table formulary (
  id                          uuid default gen_random_uuid() primary key,

  -- Identity
  generic_name                text not null unique,
  drug_class                  text,
  category                    text,
  brand_names                 text[],
  therapeutic_use             text[],
  licensed_in_children        text default 'true',
  -- values: 'true' | 'partial' | 'false'
  unlicensed_note             text,

  -- Formulations
  -- Each entry: {
  --   form: syrup|drops|tablet|capsule|injection|inhaler|
  --         nebulisation|sachet|cream|suppository|nasal|eye
  --   conc_qty: number (e.g. 120)
  --   conc_unit: mg|mcg|g|units|mmol|mEq
  --   per_qty: number (e.g. 5)
  --   per_unit: ml|tablet|capsule|dose|actuation
  --   route: oral|iv|im|sc|inhaled|topical|rectal|nasal|ophthalmic
  --   indian_brand: string (e.g. "Novamox 125mg/5ml")
  -- }
  formulations                jsonb,

  -- Dosing bands
  -- Each entry: {
  --   indication: string
  --   age_band: all|neonate|infant|child|adolescent|neonate-preterm
  --   ga_weeks_min: number (for preterm neonates)
  --   ga_weeks_max: number
  --   method: weight|bsa|fixed|gfr|infusion|age
  --   dose_min_qty: number
  --   dose_max_qty: number
  --   dose_unit: mg|mcg|g|units|mmol|mEq|nanomol
  --   is_per_day: boolean (true = divide by freq; false = per dose)
  --   frequency_per_day: number
  --   interval_hours: number
  --   duration_days: number
  --   duration_note: string
  --   max_single_qty: number
  --   max_single_unit: mg|mcg|g|units
  --   max_daily_qty: number
  --   max_daily_unit: mg|mcg|g|units
  --   loading_dose_qty: number
  --   loading_dose_unit: mg|mcg|units|mg/kg|mcg/kg
  --   rounding_rule: 0.5ml|0.1ml|quarter_tab|whole_unit|exact
  --   notes: string
  -- }
  dosing_bands                jsonb,

  -- Renal adjustment
  renal_adjustment_required   boolean default false,
  -- Each entry: {
  --   gfr_min: number, gfr_max: number,
  --   action: reduce_dose|extend_interval|reduce_and_extend|avoid|no_adjustment
  --   note: string
  -- }
  renal_bands                 jsonb,

  -- Hepatic adjustment
  hepatic_adjustment_required boolean default false,
  hepatic_note                text,

  -- Safety
  black_box_warnings          text[],
  contraindications           text[],
  cross_reactions             text[],
  -- Each entry: {drug, severity: black_box|major|moderate|minor, effect}
  interactions                jsonb,
  monitoring_parameters       text[],
  pediatric_specific_warnings text[],

  -- Administration
  -- Each entry: {route, reconstitution, dilution, infusion_rate, compatibility_note}
  administration              jsonb,
  food_instructions           text,
  storage_instructions        text,

  -- Pregnancy / lactation
  pregnancy_category          text,
  lactation_safe              text,
  lactation_note              text,

  -- Reference
  reference_source            text[],
  last_reviewed_date          date,
  notes                       text,

  active                      boolean default true,
  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now()
);

-- Indexes
create index idx_formulary_name    on formulary(generic_name);
create index idx_formulary_cat     on formulary(category);
create index idx_formulary_active  on formulary(active);
create index idx_formulary_brands  on formulary using gin(brand_names);
create index idx_formulary_use     on formulary using gin(therapeutic_use);

-- ============================================================
-- 2. DOCTORS
-- Reference table for doctor credentials. Not FK-enforced yet
-- (POC uses free-text doctor_id). FK constraints to be added
-- in production when Supabase Auth is configured.
-- ============================================================
create table doctors (
  id              text primary key,
  -- e.g. 'DR-LOKENDER', 'DR-SWATI'
  full_name       text not null,
  degree          text,
  registration_no text,
  -- HMCI / PMC registration number
  specialisation  text,
  contact_phone   text,
  is_active       boolean default true,
  created_at      timestamptz default now()
);

-- Seed the two doctors
insert into doctors (id, full_name, degree, registration_no, specialisation) values
  ('DR-LOKENDER', 'Dr. Lokender Goyal', 'MD Pediatrics (PGI Chandigarh)', 'HMCI HN 21452 / PMC 23168', 'Pediatrics & Neonatology'),
  ('DR-SWATI', 'Dr. Swati Goyal', 'MD Pediatrics', null, 'Pediatrics & Neonatology');

-- ============================================================
-- 3. STANDARD PRESCRIPTIONS
-- Keyed by ICD-10 code. Used to pre-populate the prescription
-- generator when a diagnosis is selected.
-- ============================================================
create table standard_prescriptions (
  id                    uuid default gen_random_uuid() primary key,

  icd10                 text,
  -- Not unique: same ICD-10 code may have different protocols by category/severity
  -- (e.g., J18.9 Pneumonia under Respiratory vs Neonatology)
  diagnosis_name        text not null,
  category              text,
  severity              text default 'any',

  -- First-line drugs
  -- Each entry: {
  --   drug: string (generic name — must match formulary)
  --   dose_qty: number, dose_unit: string, dose_basis: per_kg|per_m2|per_dose
  --   is_per_day: boolean, frequency_per_day: number
  --   duration_days: number, route: string, notes: string
  -- }
  first_line_drugs      jsonb,
  second_line_drugs     jsonb,

  -- Investigations to order with this diagnosis
  -- Each entry: {name, indication, urgency: same-day|routine}
  investigations        jsonb,

  duration_days_default integer,
  counselling           text[],
  referral_criteria     text,
  hospitalisation_criteria text,
  notes                 text,
  source                text,
  last_reviewed_date    date,

  active                boolean default true,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create index idx_stdpx_icd10  on standard_prescriptions(icd10);
create index idx_stdpx_name   on standard_prescriptions(diagnosis_name);
create index idx_stdpx_cat    on standard_prescriptions(category);
create index idx_stdpx_active on standard_prescriptions(active);

-- ============================================================
-- 3. PATIENTS
-- ============================================================
create table patients (
  id              text primary key
    check (id ~ '^RKH-\d{11}$'),
  -- Format: RKH-YYMM##### (prefix + 11 digits)
  -- YY = FY start year, YY = FY end year, MM = month, ##### = sequential
  -- Example: RKH-25260300001 = FY 2025-26, March, patient #00001

  name            text not null,
  dob             date,
  sex             text,
  guardian_name   text,
  guardian_relation text,
  contact_phone   text,

  blood_group     text,
  known_allergies text[],
  -- e.g. {'Penicillin', 'Sulfa drugs', 'Peanuts'} or empty

  -- Neonatal fields
  gestational_age_weeks numeric check (gestational_age_weeks between 22 and 44),
  birth_weight_kg       numeric check (birth_weight_kg between 0.3 and 6.0),

  is_active       boolean default true,

  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index idx_patients_name   on patients(name);
create index idx_patients_active on patients(is_active);

-- ============================================================
-- 4. VISITS
-- ============================================================
create table visits (
  id              uuid default gen_random_uuid() primary key,
  patient_id      text not null references patients(id) on delete restrict,

  visit_date      date not null default current_date,
  doctor_id       text,
  -- 'DR-LOKENDER' | 'DR-SWATI' etc.

  -- Anthropometry at this visit
  weight_kg       numeric check (weight_kg between 0.3 and 200),
  height_cm       numeric check (height_cm between 20 and 220),
  hc_cm           numeric check (hc_cm between 15 and 60),
  muac_cm         numeric check (muac_cm between 5 and 30),

  -- Vitals
  temp_f          numeric check (temp_f between 85 and 110),
  hr_per_min      integer check (hr_per_min between 20 and 300),
  rr_per_min      integer check (rr_per_min between 5 and 120),
  spo2_pct        numeric check (spo2_pct between 0 and 100),

  -- Clinical
  chief_complaints    text,
  diagnosis_codes     jsonb,
  -- [{icd10, name, type: provisional|final}]
  clinical_notes      text,
  triage_score        integer check (triage_score between 0 and 15),

  -- Doctor's raw dictation (saved for audit)
  raw_dictation       text,

  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index idx_visits_patient      on visits(patient_id);
create index idx_visits_date         on visits(visit_date);
create index idx_visits_patient_date on visits(patient_id, visit_date desc);

-- ============================================================
-- 5. PRESCRIPTIONS
-- ============================================================
create table prescriptions (
  id              text primary key,
  -- Format: RX-XXXXXXXX

  visit_id        uuid not null references visits(id) on delete restrict,
  patient_id      text not null references patients(id) on delete restrict,

  -- Full generated prescription JSON (as produced by AI)
  generated_json  jsonb not null,

  -- Individual sections for querying
  medicines       jsonb,
  investigations  jsonb,
  vaccinations    jsonb,
  growth          jsonb,

  -- Approval
  approved_by     text,
  approved_at     timestamptz,
  is_approved     boolean default false,

  -- Output
  pdf_url         text,
  -- Supabase Storage URL
  qr_data         jsonb,
  -- {rx_id, uhid, pt_name, date, dx_codes, hash}

  -- Versions (if doctor edits after AI generation)
  version         integer default 1,
  edit_notes      text,

  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index idx_rx_patient  on prescriptions(patient_id);
create index idx_rx_visit    on prescriptions(visit_id);
create index idx_rx_approved on prescriptions(is_approved);
create index idx_rx_date     on prescriptions(created_at);

-- ============================================================
-- 6. VACCINATIONS
-- ============================================================
create table vaccinations (
  id              serial primary key,
  patient_id      text references patients(id) on delete restrict,

  vaccine_name    text not null,
  dose_number     integer,
  date_given      date,
  next_due_date   date,
  batch_number    text,
  given_by        text,
  -- doctor / nurse name
  visit_id        uuid references visits(id),
  free_or_paid    text,
  -- 'free_uip' | 'paid'
  route           text,
  site            text,

  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index idx_vax_patient      on vaccinations(patient_id);
create index idx_vax_due          on vaccinations(next_due_date);
create index idx_vax_patient_name on vaccinations(patient_id, vaccine_name);

-- ============================================================
-- 7. GROWTH RECORDS
-- ============================================================
create table growth_records (
  id              serial primary key,
  patient_id      text references patients(id) on delete restrict,
  visit_id        uuid references visits(id),

  recorded_date   date default current_date,

  -- Measurements
  weight_kg       numeric,
  height_cm       numeric,
  hc_cm           numeric,
  muac_cm         numeric,

  -- WHO Z-scores
  waz             numeric,
  -- weight-for-age
  haz             numeric,
  -- height-for-age
  whz             numeric,
  -- weight-for-height (BMI equivalent)
  hcaz            numeric,
  -- head circumference-for-age

  -- Classification
  chart_used      text,
  -- WHO2006 | IAP2015 | Fenton2013
  classification  text,
  -- e.g. 'Well nourished' | 'MAM' | 'SAM' | 'Underweight'

  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index idx_growth_patient      on growth_records(patient_id);
create index idx_growth_patient_date on growth_records(patient_id, recorded_date desc);

-- ============================================================
-- 8. DEVELOPMENTAL SCREENINGS
-- Structured storage for developmental assessments, separate
-- from prescriptions.generated_json for queryability.
-- ============================================================
create table developmental_screenings (
  id              serial primary key,
  patient_id      text not null references patients(id) on delete restrict,
  visit_id        uuid references visits(id),
  screening_date  date default current_date,

  -- Tool used
  tool_used       text,
  -- e.g. 'TDSC' | 'DDST-II' | 'M-CHAT-R' | 'HINE' | 'ASQ' | 'LEST' | 'IAP Card'

  -- Findings
  gross_motor     text,
  fine_motor      text,
  language        text,
  social          text,
  cognitive       text,
  overall_result  text,
  -- e.g. 'Normal' | 'Suspect' | 'Delayed' | 'At risk'

  -- Red flags
  red_flags       text[],
  -- e.g. {'No social smile by 3mo', 'No babbling by 9mo'}

  -- Action
  referral_needed boolean default false,
  referral_to     text,
  -- e.g. 'Developmental Pediatrician' | 'Speech Therapy' | 'Neurology'
  notes           text,

  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index idx_devscreen_patient on developmental_screenings(patient_id);
create index idx_devscreen_date    on developmental_screenings(patient_id, screening_date desc);

-- ============================================================
-- 9. ROW LEVEL SECURITY
-- Enabled on all tables. Current policy: authenticated users
-- have full access. Per-doctor policies to be added when
-- Supabase Auth is configured with doctor logins.
-- ============================================================
alter table formulary enable row level security;
alter table standard_prescriptions enable row level security;
alter table patients enable row level security;
alter table visits enable row level security;
alter table prescriptions enable row level security;
alter table vaccinations enable row level security;
alter table growth_records enable row level security;
alter table developmental_screenings enable row level security;

-- Policy: authenticated users can perform all operations
-- Replace with per-doctor policies in production
create policy "authenticated_full_access" on formulary
  for all using (auth.role() = 'authenticated');
create policy "authenticated_full_access" on standard_prescriptions
  for all using (auth.role() = 'authenticated');
create policy "authenticated_full_access" on patients
  for all using (auth.role() = 'authenticated');
create policy "authenticated_full_access" on visits
  for all using (auth.role() = 'authenticated');
create policy "authenticated_full_access" on prescriptions
  for all using (auth.role() = 'authenticated');
create policy "authenticated_full_access" on vaccinations
  for all using (auth.role() = 'authenticated');
create policy "authenticated_full_access" on growth_records
  for all using (auth.role() = 'authenticated');
create policy "authenticated_full_access" on developmental_screenings
  for all using (auth.role() = 'authenticated');

-- ============================================================
-- 10. UPDATED_AT TRIGGER
-- Automatically updates the updated_at column on any change
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_formulary_updated
  before update on formulary
  for each row execute function update_updated_at();

create trigger trg_stdpx_updated
  before update on standard_prescriptions
  for each row execute function update_updated_at();

create trigger trg_patients_updated
  before update on patients
  for each row execute function update_updated_at();

create trigger trg_prescriptions_updated
  before update on prescriptions
  for each row execute function update_updated_at();

create trigger trg_visits_updated
  before update on visits
  for each row execute function update_updated_at();

create trigger trg_vaccinations_updated
  before update on vaccinations
  for each row execute function update_updated_at();

create trigger trg_growth_records_updated
  before update on growth_records
  for each row execute function update_updated_at();

create trigger trg_devscreenings_updated
  before update on developmental_screenings
  for each row execute function update_updated_at();

-- ============================================================
-- DONE — schema is ready
-- Tables created: formulary, doctors, standard_prescriptions, patients,
--                 visits, prescriptions, vaccinations,
--                 growth_records
-- ============================================================
