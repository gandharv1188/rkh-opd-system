-- ============================================================
-- RADHAKISHAN HOSPITAL — ABDM EXTENSION SCHEMA
-- Ayushman Bharat Digital Mission (ABDM) integration tables
-- and column additions for ABHA, HPR, SNOMED CT, LOINC, FHIR
-- Run AFTER radhakishan_supabase_schema.sql
-- ============================================================

-- ============================================================
-- 1. ALTER PATIENTS — ABHA (Ayushman Bharat Health Account)
-- Stores the patient's 14-digit ABHA number, ABHA address,
-- verification status, and linking token from ABDM.
-- ============================================================
alter table patients add column if not exists abha_number text;
-- 14-digit ABHA ID, e.g. "91-1234-5678-9012"

alter table patients add column if not exists abha_address text;
-- e.g. "patient@abdm"

alter table patients add column if not exists abha_verified boolean default false;

alter table patients add column if not exists abha_linking_token text;
-- 24-hour token from ABDM verification flow

alter table patients add column if not exists abha_linked_at timestamptz;

create unique index if not exists idx_patients_abha
  on patients(abha_number) where abha_number is not null;

-- ============================================================
-- 2. ALTER DOCTORS — HPR (Health Professional Registry)
-- ============================================================
alter table doctors add column if not exists hpr_id text;
-- Health Professional Registry ID

-- ============================================================
-- 3. ALTER FORMULARY — SNOMED CT coding
-- ============================================================
alter table formulary add column if not exists snomed_code text;
-- SNOMED CT code for the drug

alter table formulary add column if not exists snomed_display text;
-- SNOMED CT display name

-- ============================================================
-- 4. ALTER STANDARD PRESCRIPTIONS — SNOMED CT coding
-- ============================================================
alter table standard_prescriptions add column if not exists snomed_code text;
-- SNOMED CT code for the diagnosis

-- ============================================================
-- 5. ALTER LAB RESULTS — LOINC and SNOMED CT coding
-- ============================================================
alter table lab_results add column if not exists loinc_code text;

alter table lab_results add column if not exists snomed_code text;
-- For non-LOINC observations

-- ============================================================
-- 6. ALTER PRESCRIPTIONS — FHIR R4 bundle
-- ============================================================
alter table prescriptions add column if not exists fhir_bundle jsonb;
-- Generated FHIR R4 bundle for ABDM Health Information exchange

-- ============================================================
-- 7. ABDM CARE CONTEXTS
-- Each care context represents a linkable health record unit
-- (typically one OPD visit + its prescription) that can be
-- shared with ABDM via the HIP (Health Information Provider).
-- ============================================================
create table if not exists abdm_care_contexts (
  id                  uuid default gen_random_uuid() primary key,
  patient_id          text not null references patients(id) on delete restrict,
  visit_id            uuid references visits(id),
  prescription_id     text references prescriptions(id),

  care_context_ref    text not null,
  -- Unique reference sent to ABDM, e.g. "RKH-CC-<uuid>"
  display_text        text not null,
  -- Human-readable label, e.g. "OPD Visit - 17 Mar 2026"

  record_types        text[] not null,
  -- e.g. ARRAY['OPConsultation', 'Prescription']

  linked              boolean default false,
  linked_at           timestamptz,

  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists idx_abdm_cc_patient
  on abdm_care_contexts(patient_id);
create index if not exists idx_abdm_cc_ref
  on abdm_care_contexts(care_context_ref);

-- ============================================================
-- 8. ABDM CONSENT ARTEFACTS
-- Stores consent artefacts received from ABDM consent manager.
-- Each artefact authorises data sharing for specific record
-- types and date ranges.
-- ============================================================
create table if not exists abdm_consent_artefacts (
  id                  uuid default gen_random_uuid() primary key,
  consent_id          text not null unique,
  -- ABDM consent artefact ID

  patient_id          text references patients(id) on delete restrict,
  requester_name      text,
  purpose             text,
  -- CAREMGT, BTG, PUBHLTH, etc.

  hi_types            text[],
  -- e.g. ARRAY['OPConsultation', 'Prescription']

  date_range_from     timestamptz,
  date_range_to       timestamptz,
  expiry              timestamptz,

  status              text default 'REQUESTED'
    check (status in ('REQUESTED', 'GRANTED', 'DENIED', 'REVOKED', 'EXPIRED')),

  artefact_json       jsonb,
  -- Full ABDM consent artefact JSON

  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists idx_abdm_consent_patient
  on abdm_consent_artefacts(patient_id);
create index if not exists idx_abdm_consent_id
  on abdm_consent_artefacts(consent_id);
create index if not exists idx_abdm_consent_status
  on abdm_consent_artefacts(status);

-- ============================================================
-- 9. ROW LEVEL SECURITY — new tables
-- Policy: authenticated users have full access (POC mode).
-- Replace with per-doctor policies in production.
-- ============================================================
alter table abdm_care_contexts enable row level security;
create policy "authenticated_full_access" on abdm_care_contexts
  for all using (auth.role() = 'authenticated');

alter table abdm_consent_artefacts enable row level security;
create policy "authenticated_full_access" on abdm_consent_artefacts
  for all using (auth.role() = 'authenticated');

-- ============================================================
-- 10. UPDATED_AT TRIGGERS — new tables
-- Reuses the update_updated_at() function from the base schema.
-- ============================================================
create trigger trg_abdm_care_contexts_updated
  before update on abdm_care_contexts
  for each row execute function update_updated_at();

create trigger trg_abdm_consent_artefacts_updated
  before update on abdm_consent_artefacts
  for each row execute function update_updated_at();

-- ============================================================
-- DONE — ABDM extension schema applied
-- Altered: patients, doctors, formulary, standard_prescriptions,
--          lab_results, prescriptions
-- Created: abdm_care_contexts, abdm_consent_artefacts
-- ============================================================
