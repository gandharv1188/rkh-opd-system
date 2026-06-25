# 03 · Data — Target Database Schema Design

> **Status:** Authoritative target-state design. Build to **this**, not to the live `radhakishan_system/schema/radhakishan_supabase_schema.sql` + `abdm_schema.sql` prototype. Where this document and an upstream study report disagree, this document wins; where it disagrees with a verified Postgres/ABDM fact, the file author flags it.
>
> **Scope of this file:** The complete TARGET Postgres schema — bounded-context schemas, every entity/table, columns, keys (UHID + surrogate UUID), relationships, constraints, indexing, server-side ID allocation, RLS, append-only audit, and the async-generation read models — at DDL-level detail with rationale. The migration of the current live data into this schema is specified in §13.
>
> **Sibling ownership:** `02_architecture/` owns the service/compute map; `05_ai/` owns prompt/tool internals; `06_api/` owns the OpenAPI contract; `07_integrations/` owns ABDM/FHIR semantics; `08_security/` owns the full RLS/DPDP threat model (this file specifies the *schema-resident* enforcement); `09_engineering_discipline/` owns the TDD/eval/migration-CI operating model. This file is the data spine they hang off.
>
> **Provenance of every claim below:** verified this session against `origin/feat/dis-plan:dis/migrations/M001–M008` (the hexagonal foundation), `origin/sprint-2-saved:supabase/migrations/*` (prescription_audit, pg_trgm, baseline), `origin/fix/io-indexes:radhakishan_system/scripts/migration_io_indexes.sql`, and the live prototype DDL. Branch-qualified file references are inline.

---

## 0. The schema in one paragraph

Twelve-plus tables become a set of **six DDD bounded-context Postgres schemas** (`catalog`, `clinical`, `prescribing`, `identity`, `abdm`, `ops`) on one database. **Every mutable row gets a `uuid` surrogate PK** plus the platform columns `created_at / updated_at / version / correlation_id / facility_id`; **business identifiers (UHID `RKH-<FY4><MM2><SEQ5>`, receipt_no, token_no, rx receipt) are `UNIQUE` columns, never primary keys**, and are allocated **server-side under a row lock** (the prototype's client-side `MAX(seq)+1` race is deleted). **Real per-role RLS** built on `current_setting('app.role' | 'app.facility_id' | 'app.doctor_id' | 'app.patient_id')` replaces the blanket `authenticated_full_access` over an anon key; **no DELETE policy exists on any clinical, prescribing, or audit table.** The `prescriptions ↔ visits` consistency that the prototype enforced only in app code becomes a **composite foreign key**. Async prescription generation gets its schema half — `prescribing.rx_generation_jobs` + `prescribing.prescription_drafts` + `ops.outbox` — modeled 1:1 on the `dis/` job/staging/audit triad. Terminology (ICD-10 / SNOMED / LOINC) is centralized in `catalog.concepts` with FK integrity. Migrations are **forward-only dbmate with `.rollback.sql` peers** (the prototype's `drop table … cascade` monolith is forbidden), and the existing 530 drugs / 446 protocols / live patient data migrate via a reversible, abort-on-duplicate ETL (§13).

---

## 1. Design principles (the rules every table obeys)

| # | Principle | Why | Enforcement |
|---|---|---|---|
| **P1** | **Surrogate UUID PK on every mutable table** (`id uuid primary key default gen_random_uuid()`). | Stable identity independent of business meaning; FK targets never change; safe to expose. Matches `dis/` M001–M005 wholesale. | DDL convention; lint in migration CI. |
| **P2** | **Business keys are `UNIQUE` columns, not PKs.** UHID, receipt_no, token_no, rx receipt. | Business keys carry meaning that can be re-issued, corrected, or formatted differently per facility; a PK must be immutable and meaningless. The prototype's `patients.id = UHID` and `prescriptions.id = RX-…` are the root of the allocation race. | `UNIQUE` constraints + server-side allocator (P9). |
| **P3** | **Platform columns on every mutable table:** `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, `version int not null default 1`, `correlation_id uuid`, `facility_id uuid not null`. | Optimistic locking (→ 409 `VersionConflictError`), per-request tracing, multi-site tenancy + RLS scope, audit-by-construction. | `update_updated_at()` trigger + `bump_version()` trigger (§11). |
| **P4** | **DDD bounded-context schemas.** `catalog · clinical · prescribing · identity · abdm · ops`. | Aligns the database with the service decomposition in `02_architecture`; per-schema GRANTs become an extra defense layer; the anon role never touches clinical schemas. | `CREATE SCHEMA` + per-role `GRANT USAGE`. |
| **P5** | **No ORM. Schema lives only in migrations** (ADR-006, verified on `dis/`). DDL is the source of truth; TS types are generated/handwritten against it, never the reverse. | Avoids the dual-source-of-truth drift class; keeps SQL reviewable. | Fitness rule `core_no_sql_literals`; `postgres` (porsager) parameterized `sql`. |
| **P6** | **Append-only audit & immutability for clinical evidence.** `ops.audit_log`, `ops.cost_ledger`, signed prescriptions, and `prescription_audit` are write-once; `BEFORE UPDATE/DELETE` triggers `RAISE`. | NABH traceability + DPDP accountability + tamper-evidence survive even a misconfigured RLS policy. Exact pattern from `dis/migrations/M002_ocr_audit_log.sql` and `M005_dis_cost_ledger.sql`. | Immutability triggers (§11.3). |
| **P7** | **No DELETE policy on clinical / prescribing / abdm / audit tables.** Soft-state only (`is_active`, `status`, `superseded`). | Clinical rows are never destroyed (CS-2). `dis/` M008 deliberately omits DELETE policies. | RLS: only SELECT/INSERT/UPDATE policies defined (§12). |
| **P8** | **Real RLS keyed on JWT-derived session settings**, portable across Supabase and AWS RDS. `current_setting('app.role', true)` etc., set at request start by the database adapter from verified JWT claims. | Replaces the single biggest DPDP/NABH/CERT-In liability — a blanket policy over a client-reachable anon key. Exact pattern from `dis/migrations/M008_rls_policies.sql`. | RLS policies (§12) + adapter `setSessionVars`. |
| **P9** | **Server-side, lock-protected ID allocation** via `SECURITY DEFINER` functions over counter tables. | Kills the client-side `MAX(seq)+1` race for UHID / receipt / token. | `clinical.next_uhid()`, `clinical.next_receipt_no()`, `clinical.next_token_no()`, `prescribing.next_rx_receipt()` (§4). |
| **P10** | **Composite & terminology FKs enforce in the database what app code currently hopes.** `(visit_id, patient_id)` composite FK; coded fields FK into `catalog.concepts`. | The prototype admits `prescriptions.patient_id` can drift from `visits.patient_id` ("Consistency enforced at application layer"). The DB must enforce it. | Composite FK + `concepts` FKs (§5, §3). |
| **P11** | **Money as integer micro-units; never float.** `cost_micro_inr bigint`, `consultation_fee_paise int`. | Avoids float drift in cost ledgers and billing. Matches `dis/` `cost_micro_inr` convention. | Column types. |
| **P12** | **Polymorphic clinical data stays JSONB *behind a contract*.** `dosing_bands`, `formulations`, generated Rx JSON stay JSONB **plus** an Ajv schema enforced in CI and at write, **plus** the scalar columns the dose engine reads promoted to typed/CHECK'd columns. | Genuinely polymorphic; rigid columns would explode. But the dose engine's inputs must be queryable and constrained. | `jsonb_typeof` CHECKs + Ajv `formulary.v1.json` + promoted columns (§3.1). |
| **P13** | **Forward-only migrations with reversible peers.** dbmate `NNN_name.sql` + `NNN_name.rollback.sql`; CI verifies up→down→up + pg_dump schema-diff. **No `drop table … cascade` shipped as DDL.** | The prototype ships a destructive "clean slate" monolith (`radhakishan_supabase_schema.sql` lines 12–18). One mis-run drops live patient data. | Migration CI gate (owned by `09_engineering_discipline`). |

---

## 2. Bounded-context schema map

```
┌──────────────── PostgreSQL 16 (one database, six schemas) ────────────────┐
│                                                                            │
│  catalog        Reference / knowledge base (slow-changing, governed)       │
│    ├─ concepts                 ICD-10 / SNOMED / LOINC terminology spine    │
│    ├─ formulary                530 drugs (JSONB dosing_bands + promoted)    │
│    ├─ formulary_review         six-eye provenance for formulary rows        │
│    ├─ standard_prescriptions   446 ICD-10 protocols (pg_trgm fuzzy match)   │
│    └─ clinical_reference       skill .md reference registry (Storage keys)  │
│                                                                            │
│  clinical       Patient longitudinal record (the EMR core)                 │
│    ├─ patients                 UHID, demographics, allergies, ABHA, neonatal│
│    ├─ guardian_consents        DPDP child-data consent artefacts            │
│    ├─ visits                   per-visit encounter (composite key target)   │
│    ├─ vitals                   1:1-per-visit anthropometry + vitals (split) │
│    ├─ lab_results              structured labs + LOINC + OCR provenance     │
│    ├─ growth_records           WHO/IAP/Fenton z-scores (engine-computed)    │
│    ├─ vaccinations             IAP/NHM history + OCR provenance + dedupe    │
│    ├─ developmental_screenings domain assessments                          │
│    ├─ ocr_extractions          DIS staging (never direct-writes clinical)   │
│    └─ uhid_counter / receipt_counter / token_counter   allocation state     │
│                                                                            │
│  prescribing    Generation, drafts, signed Rx, safety, versions            │
│    ├─ rx_generation_jobs       async job read model (status machine)        │
│    ├─ prescription_drafts      AI/speculative drafts (pending_review)       │
│    ├─ prescriptions            signed, immutable Rx + composite FK          │
│    ├─ rx_versions              append-only edit history of signed Rx        │
│    ├─ safety_checks            per-Rx allergy/interaction/max-dose outcomes │
│    └─ prescription_audit       per-generation telemetry (one row/attempt)   │
│                                                                            │
│  identity       Actors, roles, facility (the RLS subject side)             │
│    ├─ facilities               multi-site; HFR id, NABH, ABDM bridge ids    │
│    ├─ practitioners            doctors/nurses; HPR id, registration         │
│    ├─ users                    auth principals ↔ practitioner               │
│    └─ user_roles               (user, facility, role) grants                │
│                                                                            │
│  abdm        ABDM/FHIR exchange (anti-corruption around the gateway)        │
│    ├─ care_contexts            linkable record units (visit+Rx)             │
│    ├─ consent_artefacts        HIP/HIU consent (granted/revoked/expired)    │
│    ├─ fhir_bundles             generated FHIR R4 bundles + content hash     │
│    ├─ abdm_outbox              reliable outbound callbacks (at-least-once)   │
│    └─ abdm_inbox               idempotent inbound callback dedupe            │
│                                                                            │
│  ops         Cross-cutting infrastructure (the spine of P3/P6)             │
│    ├─ jobs                     generic Postgres queue (POC; SQS on AWS)      │
│    ├─ outbox                   transactional event dispatch (CQRS)          │
│    ├─ audit_log                append-only, immutable, every command/event  │
│    ├─ idempotency_keys         write-dedup for Idempotency-Key header        │
│    ├─ cost_ledger              append-only token/cost per generation         │
│    └─ confidence_policy        single-active-row config (DIS promotion gate)│
└────────────────────────────────────────────────────────────────────────────┘
```

**Why six schemas, not one `public`:** the prototype lives entirely in `public`, so the anon role can read every clinical row. Schema separation lets us GRANT at the schema grain — `GRANT USAGE ON SCHEMA clinical TO doctor_role, nurse_role, service_role` and **never** to `anon` — making "anon reaches PHI" structurally impossible rather than policy-dependent. It also mirrors the bounded contexts in `02_architecture/backend_services.md` 1:1, so a context owns its tables.

**Extensions required** (created in the first migration; all available on Supabase and AWS RDS):

```sql
create extension if not exists pgcrypto;   -- gen_random_uuid()  (dis/ M001)
create extension if not exists pg_trgm;    -- fuzzy diagnosis / drug search (sprint-2 + io-indexes)
create extension if not exists btree_gin;  -- composite GIN for partial-text + active filters
-- citext is intentionally NOT used; we normalise case in functional lower() indexes instead.
```

---

## 3. `catalog` — knowledge base (governed, contract-tested)

### 3.1 `catalog.formulary` — 530 drugs

Keeps the prototype's JSONB-heavy shape (genuinely polymorphic: a drug has N formulations × M dosing bands × renal/hepatic bands) **but adds the governance the dose engine and AI depend on**: a six-eye `verification_status`, promoted scalar columns, a SNOMED FK into `concepts`, and an Ajv contract.

```sql
create table catalog.formulary (
  id                          uuid primary key default gen_random_uuid(),
  facility_id                 uuid not null references identity.facilities(id),  -- shared catalog uses the "global" facility row
  -- ── Identity (business key) ──────────────────────────────────────────────
  generic_name                text not null,
  generic_name_normalized     text generated always as (lower(btrim(generic_name))) stored,
  snomed_concept_id           uuid references catalog.concepts(id),  -- system='SNOMED'
  drug_class                  text,
  category                    text,
  brand_names                 text[] not null default '{}',
  therapeutic_use             text[] not null default '{}',
  licensed_in_children        boolean not null default true,
  unlicensed_note             text,
  -- ── Provenance / governance (six-eye) ───────────────────────────────────
  data_source                 text not null default 'manual'
                                check (data_source in ('snomed_branded','snomed_generic','orphan','manual')),
  verification_status         text not null default 'placeholder'
                                check (verification_status in ('verified','placeholder','legacy','deprecated')),
  -- ── Polymorphic JSONB (Ajv-validated formulary.v1.json) ─────────────────
  formulations                jsonb not null default '[]'
                                check (jsonb_typeof(formulations) = 'array'),
  dosing_bands                jsonb not null default '[]'
                                check (jsonb_typeof(dosing_bands) = 'array'),
  renal_bands                 jsonb check (renal_bands is null or jsonb_typeof(renal_bands) = 'array'),
  interactions                jsonb check (interactions is null or jsonb_typeof(interactions) = 'array'),
  administration              jsonb check (administration is null or jsonb_typeof(administration) = 'array'),
  -- ── Promoted scalar columns the dose engine / safety reads (P12) ────────
  renal_adjustment_required   boolean not null default false,
  hepatic_adjustment_required boolean not null default false,
  hepatic_note                text,
  max_single_qty              numeric,     -- absolute ceiling regardless of band (engine cross-check)
  max_single_unit             text,
  max_daily_qty               numeric,
  max_daily_unit              text,
  -- ── Safety arrays ───────────────────────────────────────────────────────
  black_box_warnings          text[] not null default '{}',
  contraindications           text[] not null default '{}',
  cross_reactions             text[] not null default '{}',   -- allergy cross-sensitivity (engine reads)
  monitoring_parameters       text[] not null default '{}',
  pediatric_specific_warnings text[] not null default '{}',
  -- ── Administration / pregnancy / reference ──────────────────────────────
  food_instructions           text,
  storage_instructions        text,
  pregnancy_category          text,
  lactation_safe              text,
  lactation_note              text,
  reference_source            text[] not null default '{}',
  last_reviewed_date          date,
  notes                       text,
  active                      boolean not null default true,
  -- ── Platform columns (P3) ───────────────────────────────────────────────
  version                     int  not null default 1,
  correlation_id              uuid,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint uq_formulary_generic unique (generic_name)
);

create unique index uq_formulary_generic_norm on catalog.formulary (generic_name_normalized);
create index idx_formulary_cat        on catalog.formulary (category);
create index idx_formulary_active     on catalog.formulary (active) where active;
create index idx_formulary_brands     on catalog.formulary using gin (brand_names);
create index idx_formulary_use        on catalog.formulary using gin (therapeutic_use);
create index idx_formulary_interactions on catalog.formulary using gin (interactions);
create index idx_formulary_dosing     on catalog.formulary using gin (dosing_bands);
create index idx_formulary_verif      on catalog.formulary (verification_status);
-- The IO-budget index (origin/fix/io-indexes §3 — the most expensive live query):
create index idx_formulary_generic_trgm on catalog.formulary using gin (generic_name gin_trgm_ops);
create index idx_formulary_generic_lower on catalog.formulary (generic_name_normalized text_pattern_ops);
```

**`dosing_bands` JSONB element contract** (frozen as `formulary.v1.json`, Ajv-enforced at write and in CI — these are the exact fields the pure dose engine consumes; see `02_architecture` for `ComputeDoseParams`):

```jsonc
{
  "indication": "string",
  "age_band": "all|neonate|infant|child|adolescent|neonate-preterm",
  "ga_weeks_min": "number?", "ga_weeks_max": "number?",
  "method": "weight|bsa|fixed|gfr|infusion|age",
  "dose_min_qty": "number", "dose_max_qty": "number",
  "dose_unit": "mg|mcg|g|units|mmol|mEq|nanomol",
  "is_per_day": "boolean",
  "frequency_per_day": "number", "interval_hours": "number?",
  "duration_days": "number?", "duration_note": "string?",
  "max_single_qty": "number?", "max_single_unit": "mg|mcg|g|units?",
  "max_daily_qty": "number?",  "max_daily_unit": "mg|mcg|g|units?",
  "loading_dose_qty": "number?", "loading_dose_unit": "mg|mcg|units|mg/kg|mcg/kg?",
  "rounding_rule": "0.5ml|0.1ml|quarter_tab|whole_unit|exact",
  "notes": "string?"
}
```

**Rationale for keeping JSONB:** a single drug (e.g. amoxicillin) has distinct bands for neonate-preterm vs infant vs child, weight vs BSA methods, and 3–4 Indian formulations. Flattening to columns would force either a band-rows table with 20 nullable columns or an explosion of `*_neonate` / `*_infant` columns. JSONB + Ajv + the GIN indexes give queryability where it matters (`dosing_bands @> '[{"method":"bsa"}]'`) while the **promoted `max_single_*` / `max_daily_*` columns** give the server a tolerance-free, indexable ceiling for its byte-for-byte dose re-check (the engine separation in `05_ai/`). The AI never receives raw JSONB; `condenseDrugForAI()` token-strips it (sprint-2 pattern).

### 3.2 `catalog.standard_prescriptions` — 446 ICD-10 protocols

```sql
create table catalog.standard_prescriptions (
  id                       uuid primary key default gen_random_uuid(),
  facility_id              uuid not null references identity.facilities(id),
  icd10_concept_id         uuid references catalog.concepts(id),   -- system='ICD10'
  snomed_concept_id        uuid references catalog.concepts(id),   -- system='SNOMED'
  icd10                    text,                                    -- denormalised display copy
  diagnosis_name           text not null,
  category                 text,
  severity                 text not null default 'any',
  first_line_drugs         jsonb check (first_line_drugs  is null or jsonb_typeof(first_line_drugs)  = 'array'),
  second_line_drugs        jsonb check (second_line_drugs is null or jsonb_typeof(second_line_drugs) = 'array'),
  investigations           jsonb check (investigations    is null or jsonb_typeof(investigations)    = 'array'),
  duration_days_default    integer,
  counselling              text[] not null default '{}',
  warning_signs            jsonb check (warning_signs is null or jsonb_typeof(warning_signs) = 'array'),
  referral_criteria        text,
  hospitalisation_criteria text,
  expected_course          text,
  key_clinical_points      text[] not null default '{}',
  severity_assessment      jsonb,
  monitoring_parameters    jsonb,
  notes                    text,
  source                   text,
  guideline_changes        text,
  last_reviewed_date       date,
  active                   boolean not null default true,
  version                  int  not null default 1,
  correlation_id           uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- The integrity fix: same ICD-10 may recur across category/severity, but the
  -- triple must be unique so get_standard_rx returns one deterministic protocol.
  constraint uq_stdrx_icd10_cat_sev unique (icd10, category, severity)
);

create index idx_stdrx_icd10        on catalog.standard_prescriptions (icd10) where icd10 is not null;
create index idx_stdrx_icd10_lower  on catalog.standard_prescriptions (lower(icd10) text_pattern_ops);     -- io-indexes §1
create index idx_stdrx_name_lower   on catalog.standard_prescriptions (lower(diagnosis_name) text_pattern_ops); -- io-indexes §2
create index idx_stdrx_name_trgm    on catalog.standard_prescriptions using gin (diagnosis_name gin_trgm_ops);  -- sprint-2 (AOM→Acute Otitis Media)
create index idx_stdrx_cat          on catalog.standard_prescriptions (category);
create index idx_stdrx_active       on catalog.standard_prescriptions (active) where active;
```

The `UNIQUE (icd10, category, severity)` is the decisive change: the prototype explicitly left ICD-10 non-unique with no replacement constraint, so two `J18.9` rows in the same category/severity could silently both match. ICD-10-first lookup with `diagnosis_name` fuzzy fallback (`pg_trgm similarity()`) is the tool contract in `05_ai/`.

### 3.3 `catalog.concepts` — terminology spine (NEW; the integrity backbone)

```sql
create table catalog.concepts (
  id            uuid primary key default gen_random_uuid(),
  system        text not null check (system in ('ICD10','SNOMED','LOINC')),
  code          text not null,
  display       text not null,
  parent_code   text,                     -- hierarchy navigation (ICD-10 chapters, SNOMED IS-A)
  is_active      boolean not null default true,
  attributes    jsonb,                    -- LOINC: component/property/scale; SNOMED: semantic tag
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_concepts_system_code unique (system, code)
);
create index idx_concepts_system_code on catalog.concepts (system, code);
create index idx_concepts_display_trgm on catalog.concepts using gin (display gin_trgm_ops);
```

This absorbs the prototype's standalone `loinc_investigations` (77,922 rows — io-indexes diagnostic) as `WHERE system='LOINC'`, and gives `formulary.snomed_concept_id`, `standard_prescriptions.icd10_concept_id`, `lab_results.loinc_concept_id`, and `visits.diagnosis_codes` real FK targets. **Codes are validated on write**: an `INSERT` into a coded clinical column whose `(system,code)` is absent from `concepts` is rejected by the FK. The 77k LOINC rows justify the GIN trgm index for the registration lab autocomplete.

### 3.4 `catalog.clinical_reference` — skill reference registry

Small registry mapping the 11 `references/*.md` clinical files to their Storage keys + content hash, so the `get_reference` tool resolves a name → a versioned Storage object rather than a hardcoded path, and we can cache-bust on update.

```sql
create table catalog.clinical_reference (
  id            uuid primary key default gen_random_uuid(),
  ref_name      text not null unique,        -- 'nabh_compliance', 'neonatal_dosing', ...
  storage_key   text not null,               -- website/skill/references/<file>.md
  content_hash  text not null,
  version       int not null default 1,
  updated_at    timestamptz not null default now()
);
```

---

## 4. Server-side ID allocation (kills the `MAX(seq)+1` race)

The prototype allocates UHID, receipt_no, and token_no on the client by reading the current max and adding one — a textbook lost-update race under concurrent reception desks. The target replaces all of it with **counter tables + `SECURITY DEFINER` allocator functions** that take a row lock via `UPDATE … RETURNING`.

```sql
-- ── UHID: RKH-<FY4><MM2><SEQ5> (Indian financial-year scoped, monthly sequence) ──
create table clinical.uhid_counter (
  facility_id  uuid not null references identity.facilities(id),
  fy_code      text not null,        -- e.g. '2526'  (FY 2025-26)
  month        smallint not null check (month between 1 and 12),
  last_seq     int not null default 0,
  primary key (facility_id, fy_code, month)
);

create function clinical.next_uhid(p_facility uuid, p_fy text, p_month smallint)
returns text
language plpgsql
security definer
set search_path = clinical, pg_temp
as $$
declare v_seq int;
begin
  insert into clinical.uhid_counter (facility_id, fy_code, month, last_seq)
       values (p_facility, p_fy, p_month, 1)
  on conflict (facility_id, fy_code, month)
       do update set last_seq = clinical.uhid_counter.last_seq + 1
  returning last_seq into v_seq;                         -- row-locked, atomic
  -- %05s zero-pads SEQ to 5; total = 11 digits = FY4 (e.g. '2526') + MM2 + SEQ5:
  return format('RKH-%s%02s%05s', p_fy, p_month, v_seq); -- RKH-<FY4><MM2><SEQ5>, e.g. RKH-25260600042
end;
$$;
revoke all on function clinical.next_uhid(uuid,text,smallint) from public;
grant execute on function clinical.next_uhid(uuid,text,smallint) to reception_role, service_role;
```

`receipt_counter` (`RKH-RCT-YYMMDD-NNN`, day-scoped) and `token_counter` (per-facility-per-day OPD token) follow the same `UPSERT … RETURNING` shape via `clinical.next_receipt_no()` and `clinical.next_token_no()`; `prescribing.next_rx_receipt()` mints the human-facing Rx receipt. The format CHECK on `patients.uhid` (`^RKH-\d{11}$`) is retained as a belt-and-braces guard. **All client-side allocation is deleted** — reception calls these functions through the API, never computes a sequence.

---

## 5. `clinical` — the longitudinal patient record

### 5.1 `clinical.patients`

```sql
create table clinical.patients (
  id                     uuid primary key default gen_random_uuid(),       -- surrogate PK (P1)
  facility_id            uuid not null references identity.facilities(id),
  uhid                   text not null,                                     -- business key (P2)
  uhid_normalized        text generated always as (upper(uhid)) stored,
  name                   text not null,
  dob                    date,
  sex                    text check (sex in ('male','female','other')),  -- lowercase tokens; API form 'M'|'F'|'O' (adapter-mapped, §04_api/api_contracts §3.1)
  guardian_name          text,
  guardian_relation      text,
  contact_phone          text,
  blood_group            text check (blood_group is null or
                            blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown')),
  known_allergies        text[] not null default '{}',
  -- Neonatal (chip auto-activates client-side; values persisted here)
  gestational_age_weeks  numeric check (gestational_age_weeks between 22 and 44),
  birth_weight_kg        numeric check (birth_weight_kg between 0.3 and 6.0),
  birth_datetime         timestamptz,
  -- ABDM / ABHA (from abdm_schema.sql, promoted into the base table)
  abha_number            text,
  abha_address           text,
  abha_verified          boolean not null default false,
  abha_linking_token     text,
  abha_linked_at         timestamptz,
  -- Lifecycle + platform
  is_active              boolean not null default true,
  verification_status    text not null default 'manual'
                            check (verification_status in ('manual','legacy','verified')),
  version                int  not null default 1,
  correlation_id         uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint uq_patients_uhid          unique (facility_id, uhid),
  constraint chk_patients_uhid_format  check (uhid ~ '^RKH-\d{11}$')
);

create unique index uq_patients_uhid_norm on clinical.patients (facility_id, uhid_normalized);
create unique index uq_patients_abha on clinical.patients (abha_number) where abha_number is not null;
create index idx_patients_name      on clinical.patients (name);
create index idx_patients_name_trgm on clinical.patients using gin (name gin_trgm_ops);  -- io-indexes (search-on-keystroke)
create index idx_patients_phone     on clinical.patients (contact_phone) where contact_phone is not null;
create index idx_patients_active    on clinical.patients (is_active) where is_active;
```

### 5.2 `clinical.guardian_consents` — DPDP child-data consent (NEW)

DPDP Act 2023 + Rules 2025 are in force and ~every patient is a child (<18). The healthcare exemption covers routine service delivery but is scope-limited, so guardian consent must be **captured, timestamped, and withdrawable** — distinct from ABDM consent artefacts (which govern *sharing*, not *processing*).

```sql
create table clinical.guardian_consents (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references identity.facilities(id),
  patient_id      uuid not null references clinical.patients(id) on delete restrict,
  guardian_name   text not null,
  guardian_relation text not null,
  purpose         text not null,                 -- 'opd_care' | 'ai_assisted_rx' | ...
  notice_version  text not null,                 -- which plain-language notice was shown
  consent_given   boolean not null,
  consent_method  text not null check (consent_method in ('verbal_witnessed','signed','digital')),
  given_at        timestamptz not null default now(),
  withdrawn_at    timestamptz,                   -- withdrawal path (DPDP requirement)
  correlation_id  uuid,
  created_at      timestamptz not null default now()
);
create index idx_consent_patient on clinical.guardian_consents (patient_id);
-- Supports the fail-closed AI-gate lookup (C6): an active 'ai_assisted_rx' consent
-- (consent_given AND withdrawn_at IS NULL) is REQUIRED at the RequestGeneration command
-- boundary before any AI-assisted generation (incl. speculative) may enqueue;
-- absence/withdrawal → 403 CONSENT_REQUIRED. See 04_api/api_contracts §4.1, error_model §5.2.
create index idx_consent_active
  on clinical.guardian_consents (patient_id, purpose)
  where consent_given and withdrawn_at is null;
```

### 5.3 `clinical.visits` — the encounter (composite-key target)

The clinical narrative stays, but **anthropometry + vitals move to `clinical.vitals`** (§5.4) to separate "what was measured" from "the encounter", and the **billing block stays** but money is integer paise (P11). The critical addition for §6 is the composite unique key `(id, patient_id)` that `prescriptions` references.

```sql
create table clinical.visits (
  id                uuid primary key default gen_random_uuid(),
  facility_id       uuid not null references identity.facilities(id),
  patient_id        uuid not null references clinical.patients(id) on delete restrict,
  visit_date        date not null default current_date,
  token_no          text,
  receipt_no        text,
  doctor_id         uuid references identity.practitioners(id),
  -- Clinical narrative
  chief_complaints  text,
  diagnosis_codes   jsonb check (diagnosis_codes is null or jsonb_typeof(diagnosis_codes) = 'array'),
                    -- [{concept_id, system:'ICD10', code, name, type:'provisional'|'final'}]
  clinical_notes    text,
  triage_score      integer check (triage_score between 0 and 15),
  vax_schedule      text check (vax_schedule in ('nhm','iap')),
  raw_dictation     text,                          -- auto-saved doctor's note (dedup'd via command bus)
  visit_summary     text,                          -- AI summary for returning patients
  attached_documents jsonb,
  -- Billing (integer paise — P11)
  consultation_fee_paise integer not null default 0,
  payment_mode      text not null default 'cash'
                      check (payment_mode in ('cash','upi','card','insurance','free')),
  payment_status    text not null default 'pending'
                      check (payment_status in ('pending','paid','waived')),
  procedures        jsonb,
  -- Platform
  version           int  not null default 1,
  correlation_id    uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- THE composite key that lets prescriptions FK on (visit_id, patient_id) — P10
  constraint uq_visits_id_patient unique (id, patient_id)
);

create index idx_visits_patient       on clinical.visits (patient_id);
create index idx_visits_date          on clinical.visits (visit_date);
create index idx_visits_patient_date  on clinical.visits (patient_id, visit_date desc);
create index idx_visits_doctor_date   on clinical.visits (doctor_id, visit_date desc);
```

### 5.4 `clinical.vitals` — anthropometry + vitals (split from visits)

One row per measurement event per visit (usually one nurse-station capture, but supports re-measurement). Range CHECKs are ported verbatim from the prototype's `visits` table — they are clinically validated.

```sql
create table clinical.vitals (
  id            uuid primary key default gen_random_uuid(),
  facility_id   uuid not null references identity.facilities(id),
  visit_id      uuid not null references clinical.visits(id) on delete restrict,
  patient_id    uuid not null references clinical.patients(id) on delete restrict,
  measured_at   timestamptz not null default now(),
  measured_by   uuid references identity.practitioners(id),
  weight_kg     numeric check (weight_kg between 0.3 and 200),
  height_cm     numeric check (height_cm between 20 and 220),
  hc_cm         numeric check (hc_cm between 15 and 60),
  muac_cm       numeric check (muac_cm between 5 and 30),
  temp_f        numeric check (temp_f between 90 and 108),
  hr_per_min    integer check (hr_per_min between 30 and 300),
  rr_per_min    integer check (rr_per_min between 5 and 120),
  spo2_pct      numeric check (spo2_pct between 50 and 100),
  bp_systolic   integer check (bp_systolic between 30 and 250),
  bp_diastolic  integer check (bp_diastolic between 15 and 150),
  map_mmhg      numeric check (map_mmhg between 20 and 200),
  bmi           numeric,
  version       int not null default 1,
  correlation_id uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_vitals_visit   on clinical.vitals (visit_id);
create index idx_vitals_patient on clinical.vitals (patient_id, measured_at desc);
```

### 5.5 `clinical.lab_results`

Ports the prototype + the `dis/` M006/M007 OCR-provenance and dedupe columns, with LOINC as an FK into `concepts`.

```sql
create table clinical.lab_results (
  id                  uuid primary key default gen_random_uuid(),
  facility_id         uuid not null references identity.facilities(id),
  patient_id          uuid not null references clinical.patients(id) on delete restrict,
  visit_id            uuid references clinical.visits(id) on delete restrict,
  loinc_concept_id    uuid references catalog.concepts(id),     -- system='LOINC'
  snomed_concept_id   uuid references catalog.concepts(id),     -- non-LOINC observations
  test_name           text not null,
  test_name_normalized text generated always as (lower(btrim(test_name))) stored,
  test_category       text,                                     -- Hematology|Biochemistry|Microbiology|Imaging
  value               text not null,
  value_numeric       numeric,
  unit                text,
  reference_range     text,
  flag                text check (flag in ('normal','low','high','critical','abnormal')),
  test_date           date not null default current_date,
  lab_name            text,
  -- DIS / OCR provenance (dis/ M006)
  source              text not null default 'manual' check (source in ('manual','ai_extracted','upload')),
  ocr_extraction_id   uuid references clinical.ocr_extractions(id) on delete restrict,
  verification_status text not null default 'manual'
                        check (verification_status in ('legacy','verified','ai_extracted','auto_approved','manual')),
  verified_by         text,
  verified_at         timestamptz,
  notes               text,
  version             int not null default 1,
  correlation_id      uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_lab_patient      on clinical.lab_results (patient_id);
create index idx_lab_patient_date on clinical.lab_results (patient_id, test_date desc);
create index idx_lab_test         on clinical.lab_results (test_name_normalized);
create index idx_lab_ocr_ext      on clinical.lab_results (ocr_extraction_id);
-- Dedupe (dis/ M007) — only OCR-originated rows are constrained; legacy/manual excluded:
create unique index uniq_lab_dedupe
  on clinical.lab_results (patient_id, test_name_normalized, test_date, coalesce(value_numeric::text, value))
  where ocr_extraction_id is not null;
```

### 5.6 `clinical.growth_records`

WHO/IAP/Fenton z-scores are **computed by the deterministic `GrowthEnginePort`** (same source-of-truth discipline as dosing — AI does no arithmetic), then persisted here.

```sql
create table clinical.growth_records (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references identity.facilities(id),
  patient_id     uuid not null references clinical.patients(id) on delete restrict,
  visit_id       uuid references clinical.visits(id) on delete restrict,
  recorded_date  date not null default current_date,
  weight_kg      numeric, height_cm numeric, hc_cm numeric, muac_cm numeric,
  waz numeric, haz numeric, whz numeric, hcaz numeric,   -- engine output
  chart_used     text check (chart_used in ('WHO2006','IAP2015','Fenton2013')),
  classification text,                                    -- 'Well nourished'|'MAM'|'SAM'|'Underweight'
  age_basis      text check (age_basis in ('chronological','corrected')),  -- preterm rule (P-corrected)
  engine_version text,                                    -- which GrowthEngine release computed this
  version        int not null default 1,
  correlation_id uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_growth_patient      on clinical.growth_records (patient_id);
create index idx_growth_patient_date on clinical.growth_records (patient_id, recorded_date desc);
```

### 5.7 `clinical.vaccinations`

Ports prototype + `dis/` M006/M007 provenance/dedupe. The IAP/NHM mutual-exclusivity is a *visit-level* selection (`visits.vax_schedule`); per-dose rows here record what was administered.

```sql
create table clinical.vaccinations (
  id                  uuid primary key default gen_random_uuid(),
  facility_id         uuid not null references identity.facilities(id),
  patient_id          uuid not null references clinical.patients(id) on delete restrict,
  visit_id            uuid references clinical.visits(id) on delete restrict,
  vaccine_name        text not null,
  vaccine_name_normalized text generated always as (lower(btrim(vaccine_name))) stored,
  dose_number         integer,
  date_given          date,
  next_due_date       date,
  batch_number        text,
  given_by            uuid references identity.practitioners(id),
  free_or_paid        text check (free_or_paid in ('free_uip','paid')),
  route               text, site text,
  -- DIS / OCR provenance (dis/ M006)
  ocr_extraction_id   uuid references clinical.ocr_extractions(id) on delete restrict,
  verification_status text not null default 'manual'
                        check (verification_status in ('legacy','verified','ai_extracted','auto_approved','manual')),
  verified_by         text, verified_at timestamptz,
  version             int not null default 1,
  correlation_id      uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_vax_patient      on clinical.vaccinations (patient_id);
create index idx_vax_due          on clinical.vaccinations (next_due_date);
create index idx_vax_patient_name on clinical.vaccinations (patient_id, vaccine_name_normalized);
create unique index uniq_vax_dedupe
  on clinical.vaccinations (patient_id, vaccine_name_normalized, date_given, coalesce(dose_number, 0))
  where ocr_extraction_id is not null;
```

### 5.8 `clinical.developmental_screenings`

Ported as-is from the prototype (structure is sound), with platform columns added and `patient_id`/`visit_id` re-pointed to UUID FKs.

### 5.9 `clinical.ocr_extractions` — DIS staging (adopted from `dis/` M001)

Adopted **wholesale** from `dis/migrations/M001_ocr_extractions.sql`. It is the anti-corruption staging boundary: OCR output lands here and **never direct-writes a clinical table**; promotion into `lab_results` / `vaccinations` happens only through the single `promotion.ts` command behind the `confidence_policy` gate (CS-7). Full column set per M001 (status lifecycle `uploaded → … → promoted | rejected | failed`, raw + structured + verified payloads preserved forever per CS-2/CS-3, token/cost columns, `parent_extraction_id` self-FK). Lives in `clinical` (not `ops`) because its rows are patient-scoped and RLS-bound to `patient_id`.

---

## 6. `prescribing` — generation, drafts, signed Rx, safety (the async-fix heartland)

This is where the latency fix gets its schema half and where the prototype's weakest integrity (denormalized `patient_id` "enforced at application layer") is hardened.

### 6.1 `prescribing.rx_generation_jobs` — the async read model

```sql
create table prescribing.rx_generation_jobs (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references identity.facilities(id),
  visit_id        uuid not null references clinical.visits(id) on delete restrict,
  patient_id      uuid not null references clinical.patients(id) on delete restrict,
  -- State machine (mirrors core/state-machine.ts transitions)
  status          text not null default 'queued'
                    check (status in ('queued','generating','streaming','draft_ready',
                                      'superseded','failed','timeout')),
  -- Speculative-generation keys (§2 of architecture — the headline UX)
  speculative     boolean not null default false,
  content_hash    text not null,           -- hash({note, patient_context_version, selected_sections})
  superseded_by   uuid references prescribing.rx_generation_jobs(id),
  -- Idempotency + tracing
  idempotency_key text not null,
  correlation_id  uuid not null,
  -- Telemetry (cost as integer micro-INR — P11)
  model_id        text,                    -- the model actually used (audit; resolved from ModelPolicyPort)
  tokens_in       bigint default 0,
  tokens_out      bigint default 0,
  cost_micro_inr  bigint default 0,
  latency_ms      integer,
  error_code      text, error_detail text,
  version         int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_rxjob_idem unique (idempotency_key)
);
-- Only ONE live (non-superseded, non-terminal) job per (visit, content_hash):
create unique index uq_rxjob_live_hash
  on prescribing.rx_generation_jobs (visit_id, content_hash)
  where status in ('queued','generating','streaming');
create index idx_rxjob_visit  on prescribing.rx_generation_jobs (visit_id, created_at desc);
create index idx_rxjob_status on prescribing.rx_generation_jobs (status);
```

The partial unique index `uq_rxjob_live_hash` is what makes **last-write-wins speculative generation** safe at the data layer: a newer note hash supersedes the in-flight one; you cannot have two live jobs for the same content. When the doctor clicks Generate and the current note hash matches a `draft_ready` job, review opens at ~0 ms.

### 6.2 `prescribing.prescription_drafts` — AI drafts (pending_review)

```sql
create table prescribing.prescription_drafts (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references identity.facilities(id),
  job_id          uuid not null references prescribing.rx_generation_jobs(id) on delete restrict,
  visit_id        uuid not null references clinical.visits(id) on delete restrict,
  patient_id      uuid not null references clinical.patients(id) on delete restrict,
  content_hash    text not null,
  status          text not null default 'pending_review'
                    check (status in ('pending_review','superseded','promoted','discarded')),
  generated_json  jsonb not null,          -- full AI draft (Ajv core_prompt schema validated)
  medicines       jsonb check (medicines      is null or jsonb_typeof(medicines)      = 'array'),
  investigations  jsonb check (investigations is null or jsonb_typeof(investigations) = 'array'),
  vaccinations    jsonb check (vaccinations   is null or jsonb_typeof(vaccinations)   = 'object'),
  growth          jsonb check (growth         is null or jsonb_typeof(growth)         = 'object'),
  provenance      jsonb,                    -- per-line: ai_generated | clinician_edited (UI distinguishes)
  version         int not null default 1,
  correlation_id  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_draft_visit on prescribing.prescription_drafts (visit_id, created_at desc);
create index idx_draft_job   on prescribing.prescription_drafts (job_id);
```

**Clinical-safety invariant (CS-1/CS-7, symmetric-actor seam):** a draft is `pending_review` until a human `SignOff` command promotes it. Identical fail-closed gate to OCR `promotion.ts`. Going AI-first later = an additive subscriber that emits `SignOff` autonomously — no schema change.

### 6.3 `prescribing.prescriptions` — signed, immutable Rx (composite FK)

```sql
create table prescribing.prescriptions (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references identity.facilities(id),
  rx_receipt      text not null,                         -- business key (server-allocated)
  visit_id        uuid not null,
  patient_id      uuid not null,
  draft_id        uuid references prescribing.prescription_drafts(id),
  generated_json  jsonb not null,
  medicines       jsonb check (medicines      is null or jsonb_typeof(medicines)      = 'array'),
  investigations  jsonb check (investigations is null or jsonb_typeof(investigations) = 'array'),
  vaccinations    jsonb check (vaccinations   is null or jsonb_typeof(vaccinations)   = 'object'),
  growth          jsonb check (growth         is null or jsonb_typeof(growth)         = 'object'),
  -- Sign-off (the only path to this table)
  signed_by       uuid not null references identity.practitioners(id),
  signed_at       timestamptz not null default now(),
  -- Tamper-evidence (replaces the forgeable 6-char client-salt QR hash)
  content_hash    text not null,                         -- SHA-256 of canonical signed payload
  signature_jws   text,                                  -- ES256 JWS (SignaturePort) — verify.html calls server
  -- ABDM/FHIR (generated off-edge after PrescriptionSigned)
  fhir_bundle_id  uuid references abdm.fhir_bundles(id),
  pdf_url         text,
  version         int not null default 1,                -- always 1; edits go to rx_versions
  correlation_id  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_rx_receipt unique (rx_receipt),
  -- THE composite FK — DB enforces prescriptions.patient_id == visits.patient_id (P10):
  constraint fk_rx_visit_patient
    foreign key (visit_id, patient_id)
    references clinical.visits (id, patient_id) on delete restrict
);
create index idx_rx_patient on prescribing.prescriptions (patient_id);
create index idx_rx_visit   on prescribing.prescriptions (visit_id);
create index idx_rx_date     on prescribing.prescriptions (created_at desc);
create index idx_rx_signedby on prescribing.prescriptions (signed_by, signed_at desc);
```

A signed prescription is **immutable**: an `is_approved` boolean has no meaning here (presence in this table *is* the approval). Any post-sign edit creates a new `rx_versions` row, not an in-place UPDATE. An immutability trigger (§11.3) blocks UPDATE of the clinical payload columns; only nullable downstream pointers (`fhir_bundle_id`, `pdf_url`) may be set once.

> **There is no `status` column on `prescribing.prescriptions` (C4).** The API's `status:'signed'` is **synthetic** — derived from row existence at serialization, never read from or written to a column. The mutable pre-sign lifecycle lives on the **draft** (`prescription_drafts.status ∈ {pending_review, superseded, promoted, discarded}`) and the **job** (`rx_generation_jobs.status ∈ {queued, generating, streaming, draft_ready, superseded, failed, timeout}`). Consequently there is **no `signed` value in any generation-job enum** — `signed` is reachable only by inserting a row here via a human `SignOff` command (the clinical-safety invariant). See `04_api/api_contracts.md §4.7`.

### 6.4 `prescribing.rx_versions` — append-only edit history

```sql
create table prescribing.rx_versions (
  id              uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references prescribing.prescriptions(id) on delete restrict,
  version_no      int  not null,
  generated_json  jsonb not null,
  content_hash    text not null,
  edited_by       uuid not null references identity.practitioners(id),
  edit_note       text,
  created_at      timestamptz not null default now(),
  constraint uq_rxver unique (prescription_id, version_no)
);
```

### 6.5 `prescribing.safety_checks` — per-Rx safety outcomes

The structured result of the dose-engine + allergy + interaction re-check (the server's byte-for-byte recompute). One row per draft/prescription evaluation.

```sql
create table prescribing.safety_checks (
  id              uuid primary key default gen_random_uuid(),
  draft_id        uuid references prescribing.prescription_drafts(id) on delete restrict,
  prescription_id uuid references prescribing.prescriptions(id) on delete restrict,
  overall_status  text not null check (overall_status in ('SAFE','REVIEW_REQUIRED')),  -- UPPER_SNAKE stored/wire; "REVIEW REQUIRED" (space) is display-only (C3)
  severity_final  text check (severity_final in ('none','moderate','high')),  -- gate three-tier (C3); audit 'low' maps to 'none' at the gate
  allergy_flags   jsonb,    -- [{drug, allergen, cross_reaction, severity}]
  interaction_flags jsonb,  -- [{drug_a, drug_b, severity, effect}]
  max_dose_flags  jsonb,    -- [{drug, computed, ceiling, exceeded}]
  engine_version  text,     -- dose-engine release that produced this
  created_at      timestamptz not null default now(),
  constraint chk_safety_target check (draft_id is not null or prescription_id is not null)
);
create index idx_safety_draft on prescribing.safety_checks (draft_id);
create index idx_safety_rx     on prescribing.safety_checks (prescription_id);
```

### 6.6 `prescribing.prescription_audit` — per-generation telemetry (ported from sprint-2)

Ported from `origin/sprint-2-saved:supabase/migrations/20260428001000_prescription_audit.sql` — **one row per generation attempt incl. retries/fallback**. The only changes: UUID FKs (not text), it lives in `prescribing`, and the RLS becomes the real per-role policy (not `anon_full_access`). Columns retained verbatim: `attempt_number`, `meta_mode`, `stop_reason`, `input/output_tokens`, `rounds`, `tools_called[]`, `requested/emitted/omitted/added_meds`, `severity_server/ai/final`, `verifier_flags`, `warnings[]`, `duration_ms`. It is **append-only** (immutability trigger), unlike the prototype.

```sql
create table prescribing.prescription_audit (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid references prescribing.rx_generation_jobs(id) on delete set null,
  prescription_id uuid references prescribing.prescriptions(id) on delete set null,
  visit_id        uuid references clinical.visits(id) on delete set null,
  patient_id      uuid,                              -- masked in logs; full here for analytics
  attempt_number  smallint not null default 1,
  meta_mode       text not null,                     -- 'tool-use' | 'fallback-single-shot'
  model_id        text,                              -- actual model used (NOT a hardcoded literal)
  stop_reason     text,
  input_tokens    integer, output_tokens integer,
  rounds          smallint,
  tools_called    text[],
  requested_meds  text[], emitted_meds text[],
  omitted_meds    jsonb,  added_meds text[],
  severity_server text, severity_ai text, severity_final text,
  verifier_flags  jsonb,  warnings text[],
  duration_ms     integer,
  cache_read_input_tokens integer,                   -- prompt-caching audit (must be non-zero — §2 caching)
  created_at      timestamptz not null default now()
);
create index idx_rxaudit_job   on prescribing.prescription_audit (job_id);
create index idx_rxaudit_visit on prescribing.prescription_audit (visit_id);
create index idx_rxaudit_created on prescribing.prescription_audit (created_at desc);
create index idx_rxaudit_mode  on prescribing.prescription_audit (meta_mode);
```

---

## 7. `identity` — actors, roles, facility (the RLS subject side)

```sql
create table identity.facilities (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,        -- 'RKH'
  name          text not null,               -- 'Radhakishan Hospital'
  hfr_id        text,                         -- Health Facility Registry (ABDM prereq — config/secret, NOT source)
  nabh_accreditation text,
  abdm_hip_id   text, abdm_hiu_id text,
  address       jsonb,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table identity.practitioners (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references identity.facilities(id),
  code            text not null,               -- 'DR-LOKENDER' (legacy business id)
  full_name       text not null,
  degree          text,
  registration_no text,                         -- HMC/PMC
  hpr_id          text,                         -- Health Professional Registry (ABDM)
  specialisation  text,
  contact_phone   text,
  role_kind       text not null default 'doctor'
                    check (role_kind in ('doctor','nurse','reception','admin')),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_practitioner_code unique (facility_id, code)
);

create table identity.users (
  id              uuid primary key default gen_random_uuid(),   -- maps to Supabase Auth uid
  practitioner_id uuid references identity.practitioners(id),
  email           text unique,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create table identity.user_roles (
  user_id     uuid not null references identity.users(id) on delete restrict,
  facility_id uuid not null references identity.facilities(id),
  role        text not null check (role in ('reception','nurse','doctor','service','admin')),
  granted_at  timestamptz not null default now(),
  primary key (user_id, facility_id, role)
);
```

The seed doctor (`DR-LOKENDER`, "Dr. Lokender Goyal", HMC HN 21452 / PMC 23168, Pediatrics & Neonatology) migrates from the prototype's `doctors` table into `identity.practitioners` with `role_kind='doctor'`. The RLS session settings `app.role`, `app.facility_id`, `app.doctor_id`, `app.patient_id` are derived from `user_roles` + JWT claims at request start.

---

## 8. `abdm` — ABDM/FHIR exchange (anti-corruption)

```sql
create table abdm.care_contexts (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid not null references identity.facilities(id),
  patient_id       uuid not null references clinical.patients(id) on delete restrict,
  visit_id         uuid references clinical.visits(id) on delete restrict,
  prescription_id  uuid references prescribing.prescriptions(id) on delete restrict,
  care_context_ref text not null unique,        -- 'RKH-CC-<uuid>'
  display_text     text not null,
  record_types     text[] not null,             -- ['OPConsultation','Prescription',...]
  linked           boolean not null default false,
  linked_at        timestamptz,
  version          int not null default 1, correlation_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_abdm_cc_patient on abdm.care_contexts (patient_id);

create table abdm.consent_artefacts (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references identity.facilities(id),
  consent_id      text not null unique,         -- ABDM artefact id
  patient_id      uuid references clinical.patients(id) on delete restrict,
  requester_name  text, purpose text,           -- CAREMGT|BTG|PUBHLTH
  hi_types        text[],
  date_range_from timestamptz, date_range_to timestamptz, expiry timestamptz,
  status          text not null default 'REQUESTED'
                    check (status in ('REQUESTED','GRANTED','DENIED','REVOKED','EXPIRED')),
  artefact_json   jsonb,
  version         int not null default 1, correlation_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_abdm_consent_patient on abdm.consent_artefacts (patient_id);
create index idx_abdm_consent_status  on abdm.consent_artefacts (status);

create table abdm.fhir_bundles (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references identity.facilities(id),
  prescription_id uuid references prescribing.prescriptions(id) on delete restrict,
  visit_id        uuid references clinical.visits(id) on delete restrict,
  bundle_type     text not null,                -- OPConsultation|Prescription|DiagnosticReport|ImmunizationRecord
  bundle_json     jsonb not null,
  content_hash    text not null,                -- tamper-evidence + dedupe
  signature_jws   text,                         -- Bundle.signature (ES256)
  fhir_validated  boolean not null default false,  -- CI/runtime FHIR-validator gate result
  created_at      timestamptz not null default now()
);
create index idx_fhir_rx on abdm.fhir_bundles (prescription_id);

-- Reliable callback delivery (replaces the prototype's fire-and-forget):
create table abdm.abdm_outbox (
  id              uuid primary key default gen_random_uuid(),
  topic           text not null,                -- 'hip.data-transfer','consent.on-notify',...
  payload         jsonb not null,
  status          text not null default 'pending'
                    check (status in ('pending','sent','failed','dead')),
  attempts        int not null default 0, max_attempts int not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index idx_abdm_outbox_ready on abdm.abdm_outbox (next_attempt_at) where status = 'pending';

create table abdm.abdm_inbox (
  id              uuid primary key default gen_random_uuid(),
  request_id      text not null unique,         -- ABDM transaction id → idempotent dedupe
  topic           text not null,
  payload         jsonb not null,
  received_at     timestamptz not null default now()
);
```

ABDM/FHIR generation runs **off-edge, event-driven**: `PrescriptionSigned` enqueues an `ops.jobs` row → worker builds the bundle via the pure `NrcesR4Adapter` (takes data, not a DB — kills the N+1 formulary re-fetch in the prototype builder) → writes `abdm.fhir_bundles` → `abdm_outbox` delivers. Sign-off never blocks on it.

---

## 9. `ops` — cross-cutting infrastructure

These five tables are adopted near-verbatim from the verified `dis/` migrations; they are the mechanism behind P3/P6/P9 and the async fix.

| Table | Source | Role |
|---|---|---|
| `ops.jobs` | `dis/ M004 dis_jobs` | Postgres queue (POC). Columns: `topic, payload, available_at, status('pending'…'dead'), attempts, max_attempts, locked_until, locked_by, last_error`. **Partial index** `(topic, available_at) where completed_at is null` for cheap ready-job polling. On AWS, `DIS_STACK=aws` skips this migration and uses SQS. |
| `ops.outbox` | new (CQRS) | Transactional event dispatch. A command writes its domain rows **and** an `outbox` row in one transaction; a dispatcher relays to subscribers (SSE relay, ABDM handler, projections). Guarantees at-least-once event delivery without 2-phase commit. |
| `ops.audit_log` | `dis/ M002` pattern | **Append-only, immutable** (`BEFORE UPDATE/DELETE` triggers `RAISE`). One row per command/event: `event, event_type, actor, actor_type, actor_id, subject_id, from_state, to_state, field_path, before, after, note, correlation_id`. Replaces heuristic `console.log`. The NABH/DPDP accountability spine. |
| `ops.idempotency_keys` | `dis/ M001` | `key text primary key, payload_hash text, created_at`. Backs `Idempotency-Key`-mandatory writes. |
| `ops.cost_ledger` | `dis/ M005` pattern | **Append-only** token/cost per generation. `cost_micro_inr bigint` integer micro-units (P11). Immutability triggers. |
| `ops.confidence_policy` | `dis/ M003` | Single-active-row config for the OCR promotion gate. Partial unique index `((true)) where deactivated_at is null and enabled = true`; seeded **disabled** so nothing auto-approves until an admin flips it (CS-7). |

```sql
-- ops.outbox (the one net-new ops table):
create table ops.outbox (
  id             uuid primary key default gen_random_uuid(),
  aggregate      text not null,            -- 'prescription' | 'visit' | 'extraction' ...
  aggregate_id   uuid not null,
  event_type     text not null,            -- 'PrescriptionSigned','DraftReady',...
  payload        jsonb not null,
  correlation_id uuid not null,
  status         text not null default 'pending' check (status in ('pending','dispatched','failed')),
  attempts       int not null default 0,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz
);
create index idx_outbox_pending on ops.outbox (created_at) where status = 'pending';
```

---

## 10. Entity-relationship overview

```
identity.facilities ─1──┬─< identity.practitioners ─1──< identity.users ─1──< identity.user_roles
                        │
catalog.concepts ─┐     │   (every *.facility_id ──> facilities.id ; RLS scope)
   ▲ ▲ ▲          │     │
   │ │ └─ LOINC ──┼─────┼────────────< clinical.lab_results.loinc_concept_id
   │ └─── SNOMED ─┼──< catalog.formulary.snomed_concept_id
   └───── ICD10 ──┴──< catalog.standard_prescriptions.icd10_concept_id
                                         │
clinical.patients ─1──┬─< clinical.guardian_consents                    │ (lookup at generation)
                      ├─< clinical.visits ─1──┬─< clinical.vitals        │
                      │        │ (id,patient_id) UNIQUE                  │
                      │        │        ▲ composite FK                   │
                      ├─< clinical.lab_results                           │
                      ├─< clinical.growth_records                        │
                      ├─< clinical.vaccinations                          │
                      ├─< clinical.developmental_screenings              │
                      └─< clinical.ocr_extractions ─(promotion)─> labs/vax
                               │
prescribing.rx_generation_jobs ─1──< prescribing.prescription_drafts ─(SignOff)─┐
        │ (visit_id, patient_id)                                                 │
        └──────────────────────────────────────────────> prescribing.prescriptions
                                                              │  (visit_id,patient_id) ──FK──> visits(id,patient_id)
                                                              ├─< prescribing.rx_versions
                                                              ├─< prescribing.safety_checks
                                                              ├─< prescribing.prescription_audit
                                                              └──> abdm.fhir_bundles ──> abdm.care_contexts
                                                                       abdm.consent_artefacts / outbox / inbox

ops.{jobs · outbox · audit_log · idempotency_keys · cost_ledger · confidence_policy}  ── cross-cuts all of the above
```

**FK delete behaviour:** every clinical/prescribing FK is `ON DELETE RESTRICT` (P7 — rows are never deleted; RESTRICT is the loud failure if anyone tries). `ocr_extraction_id`, `superseded_by`, and audit back-references use `RESTRICT` or `SET NULL` as appropriate so audit rows survive even if a forward pointer is cleared.

---

## 11. Triggers, generated columns, and immutability

### 11.1 `updated_at` (ported from prototype, applied to every mutable table)
```sql
create or replace function ops.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
-- create trigger trg_<t>_updated before update on <schema>.<t>
--   for each row execute function ops.touch_updated_at();
```

### 11.2 Optimistic-lock version bump (P3)
```sql
create or replace function ops.bump_version() returns trigger as $$
begin
  if new.version <> old.version then
    raise exception 'VersionConflict on % (expected %, got %)', tg_relname, old.version, new.version
      using errcode = '40001';            -- maps to API 409 VersionConflictError
  end if;
  new.version = old.version + 1; return new;
end; $$ language plpgsql;
```
Callers send the version they read; a mismatch (someone else wrote in between) raises → API 409.

### 11.3 Append-only / signed-Rx immutability (P6) — the `dis/` M002/M005 pattern
```sql
create or replace function ops.reject_mutation() returns trigger as $$
begin raise exception '% is append-only / immutable', tg_relname; end; $$ language plpgsql;

create trigger trg_auditlog_no_update before update on ops.audit_log
  for each row execute function ops.reject_mutation();
create trigger trg_auditlog_no_delete before delete on ops.audit_log
  for each row execute function ops.reject_mutation();
-- Same for ops.cost_ledger, prescribing.prescription_audit, prescribing.rx_versions.
```
Signed `prescribing.prescriptions` uses a narrower guard: a `BEFORE UPDATE` trigger that raises if any clinical payload column (`generated_json`, `medicines`, `signed_by`, `content_hash`, `signature_jws`) changes; only `fhir_bundle_id`/`pdf_url` may transition once from NULL.

### 11.4 Generated columns
`*_normalized` columns (`generic_name_normalized`, `uhid_normalized`, `test_name_normalized`, `vaccine_name_normalized`) are `GENERATED ALWAYS AS (...) STORED` so dedupe unique indexes and case-insensitive lookups are deterministic and index-backed without functional-index pitfalls in `ON CONFLICT`.

---

## 12. Row-Level Security (real, portable, no-DELETE)

**Pattern (verified on `dis/ M008`):** every clinical/prescribing/abdm/identity table `ENABLE ROW LEVEL SECURITY`; policies read `current_setting('app.role', true)` and `current_setting('app.facility_id', true)`, set by the database adapter from verified JWT claims at request start. **Identical on Supabase and AWS RDS** (no `auth.*()` Supabase-isms). The anon role is **never granted USAGE on `clinical`, `prescribing`, `abdm`** schemas.

| Role | `catalog` | `clinical` | `prescribing` | `abdm` | `ops` |
|---|---|---|---|---|---|
| `reception` | read | read patients/visits; insert patients/visits/consents | read drafts | — | — |
| `nurse` | read | read; insert vitals/labs/vax/growth | read drafts/safety | — | — |
| `doctor` | read | read | read all; insert drafts→sign; insert rx_versions | read | — |
| `service` (workers) | read/write | read/write (promotion) | read/write (generation) | read/write | read/write |
| `admin` | read/write | read | read | read | read |

**Facility scoping** is `AND`ed into every clinical policy: `using (facility_id = current_setting('app.facility_id', true)::uuid)`. **No policy defines `FOR DELETE`** on clinical, prescribing, abdm, or audit tables (P7) — DELETE is structurally impossible regardless of role. Example:

```sql
alter table clinical.patients enable row level security;
create policy patients_read on clinical.patients for select
  using (
    facility_id = current_setting('app.facility_id', true)::uuid
    and ( current_setting('app.role', true) in ('reception','nurse','doctor','service','admin')
          or current_setting('app.patient_id', true) = id::text )
  );
create policy patients_insert on clinical.patients for insert
  with check (current_setting('app.role', true) in ('reception','service'));
create policy patients_update on clinical.patients for update
  using (current_setting('app.role', true) in ('reception','doctor','service','admin'));
-- (no DELETE policy)
```

The full per-table policy matrix and the JWT→session-var mapping live in `08_security/`; this file fixes the schema-resident invariants (enable RLS, no DELETE, facility scope, role check).

---

## 13. Migration of the current live data (forward-only, reversible, abort-on-duplicate)

**Baseline source:** `origin/sprint-2-saved:supabase/migrations/20260428000000_baseline_from_live.sql` — a pg_dump of the live 14-table `public` schema. The target is reached by **additive, reversible dbmate migrations** (never the prototype's `drop … cascade`).

| Step | Action | Pattern / source | Safety |
|---|---|---|---|
| **1** | Create the six target schemas + extensions + `identity.facilities` "RKH" + "global" rows, empty. | new migration `001` | Non-destructive; runs alongside live `public`. |
| **2** | **ETL-clean** `formulary` / `standard_prescriptions` JSON: fix mojibake (`â€"` em-dash corruption), dedupe ICD-10 protocols into `(icd10,category,severity)`, split `verification_status` verified vs placeholder, map free-text ICD-10/SNOMED/LOINC into `catalog.concepts`. | offline ETL → idempotent seed scripts | Dry-run + Ajv `formulary.v1.json` gate before load. |
| **3** | Backfill `clinical.patients/visits/...` from live rows with `verification_status='legacy'`. | `dis/ M006` 'legacy' convention | Additive; idempotent (only NULL→legacy). |
| **4** | Generate uuid surrogate PKs; **retain UHID/receipt/token/RX as UNIQUE business columns**; build a `legacy_id → uuid` crosswalk table to re-point FKs. | new migration | Crosswalk kept until cutover for rollback. |
| **5** | **Dry-run dedupe, abort-on-duplicate.** Pre-flight `DO $$ … RAISE EXCEPTION` blocks for labs/vax before creating the partial unique dedupe indexes. | `dis/ M007` verbatim | Migration aborts and prints sample keys if duplicates exist. |
| **6** | **Reconcile `prescriptions.patient_id` drift against `visits`** before adding the composite FK. Rows where `rx.patient_id <> visit.patient_id` are quarantined to a `prescribing.fk_reconcile_quarantine` table for manual review. | new migration | Composite FK added **only after** quarantine is empty. |
| **7** | **Cutover migration** making FKs/constraints mandatory (composite FK, concept FKs, NOT NULL `facility_id`, server-side allocators) — applied only after shadow rollout proves the new path. | `dis/ M009`-style cutover | Feature-flag ladder + kill-switch (`09_engineering_discipline`). |
| **8** | Roll in the justified indexes from `origin/fix/io-indexes:migration_io_indexes.sql` (formulary/std-rx/patients trgm + lower() btree), **verifying no duplicates vs the baseline indexes**. Keep 530 drugs / 446 protocols as **idempotent seed scripts**. | io-indexes (CONCURRENTLY) | `CREATE INDEX … CONCURRENTLY IF NOT EXISTS`; one statement at a time. |

**Migration CI gate (owned by `09_engineering_discipline`, stated here for completeness):** every migration ships `NNN_name.sql` + `NNN_name.rollback.sql`; CI runs up→down→up and diffs `pg_dump --schema-only` to prove reversibility and that the rollback restores the prior shape. **No migration in this repo may contain `DROP TABLE … CASCADE`** against a populated table — a lint blocks it.

---

## 14. Index strategy summary (the IO-budget rationale)

The live diagnostic (io-indexes header, 2026-04-27) showed seq-scan-on-every-keystroke against four reference tables with millions of `tup_read` despite a 100% cache-hit ratio — i.e. the cost is planner work + rows-examined, not disk. The target index set is therefore deliberate, not blanket:

| Table | Query shape | Index | Why |
|---|---|---|---|
| `catalog.formulary` | `generic_name ILIKE 'amox%'` (the single most expensive live query) | `gin (generic_name gin_trgm_ops)` + `(generic_name_normalized text_pattern_ops)` | trgm for infix, lower-btree for left-anchored prefix. |
| `catalog.standard_prescriptions` | `icd10 ILIKE 'J18%'`, `diagnosis_name ILIKE`, fuzzy `AOM` | `lower(icd10) text_pattern_ops`, `lower(diagnosis_name) text_pattern_ops`, `gin(diagnosis_name gin_trgm_ops)` | left-anchored ICD + fuzzy name (sprint-2 + io-indexes). |
| `clinical.patients` | search-on-keystroke by name/phone | `gin(name gin_trgm_ops)`, `(contact_phone)` | reception/doctor combo-box. |
| `catalog.concepts` (incl. 77k LOINC) | lab autocomplete | `(system,code)` unique + `gin(display gin_trgm_ops)` | code lookup + fuzzy display. |
| `clinical.visits` | "patient's visits, newest first" | `(patient_id, visit_date desc)` | the dominant clinical read. |
| `prescribing.rx_generation_jobs` | "is there a live job for this content hash?" | partial unique `(visit_id, content_hash) where status in (live)` | speculative last-write-wins. |
| `ops.jobs` / `abdm.abdm_outbox` / `ops.outbox` | "next ready job/event" | partial index `where status='pending'` (or `completed_at is null`) | cheap queue polling without scanning done rows. |

GIN trgm indexes are created `CONCURRENTLY` during migration (no write lock); partial indexes keep them small by excluding inactive/terminal rows.

---

## 15. Decisions & resolved tensions (decisive)

| Decision | Choice | Rejected alternative | Rationale |
|---|---|---|---|
| **PK strategy** | UUID surrogate everywhere; UHID/receipt as UNIQUE columns | UHID as text PK (prototype) | A meaningful PK is the root of the allocation race and makes FKs brittle. |
| **Schema organization** | Six bounded-context schemas | One `public` (prototype) | Anon-reaches-PHI becomes structurally impossible via per-schema GRANT. |
| **JSONB vs columns** | JSONB for genuinely polymorphic clinical data + Ajv contract + promoted scalar ceilings | Fully normalised band tables | Bands are N×M polymorphic; the engine needs queryable ceilings, not 20 nullable columns. |
| **Vitals** | Split `clinical.vitals` from `visits` | Vitals inline on `visits` (prototype) | Separates "measured" from "encounter"; supports re-measurement; cleaner growth-engine input. |
| **Drafts vs prescriptions** | Two tables: mutable `prescription_drafts` (pending_review) → immutable `prescriptions` (signed) | One `prescriptions` table with `is_approved` flag (prototype) | The fail-closed clinical invariant + immutability need distinct tables; enables the symmetric-actor AI-first add-on with no schema change. |
| **prescriptions↔visits consistency** | Composite FK `(visit_id, patient_id)` | "enforced at application layer" (prototype's own words) | The DB must enforce the invariant; app code already proved insufficient. |
| **Terminology** | Central `catalog.concepts` with FKs | Free-text ICD/SNOMED/LOINC columns | Code validation on write; absorbs 77k LOINC; one place for hierarchy. |
| **ID allocation** | Server-side `SECURITY DEFINER` + counter rows under lock | Client `MAX(seq)+1` (prototype) | Eliminates the lost-update race across concurrent reception desks. |
| **Audit** | Append-only `ops.audit_log` + immutability triggers + `prescription_audit` per attempt | `console.log` heuristics (prototype) | NABH/DPDP traceability that survives misconfigured RLS. |
| **Migrations** | Forward-only dbmate + `.rollback.sql` + CI up/down/up | `drop table … cascade` monolith (prototype) | One mis-run of the prototype DDL drops live patient data. |
| **Money** | Integer micro/paise (`cost_micro_inr`, `consultation_fee_paise`) | numeric/float | No float drift in ledgers/billing. |

---

## 16. Open items to confirm against verified facts (flag, don't guess)

1. **Supabase `SECURITY DEFINER` + `search_path` hardening:** confirm the allocator functions' `set search_path = clinical, pg_temp` is sufficient under Supabase's role model before relying on it as the only allocation path (low risk; pattern is standard).
2. **`generated always as … stored` + `ON CONFLICT` on the generated column:** Postgres 16 supports unique indexes on stored generated columns; confirm the `ON CONFLICT (facility_id, fy_code, month)` allocator and the dedupe indexes interact as intended in the target PG version.
3. **77k-row `catalog.concepts` LOINC load** within the migration window — load as an idempotent seed *after* schema cutover, not inside the structural migration, to keep the structural migration fast and reversible.
4. **ABDM prereqs are config/secrets, not schema:** `facilities.hfr_id` and `practitioners.hpr_id` are columns here but their *values* (live HFR/HPR ids) come from `SecretsPort`/config, not seeded source — the `HOSPITAL.hfr_id=""` baked-in blocker must not recur.

---

### Key file references (branch-qualified)

- **Hexagonal foundation (`origin/feat/dis-plan`):** `dis/migrations/M001_ocr_extractions.sql` (staging + idempotency_keys), `M002_ocr_audit_log.sql` (append-only triggers), `M003_dis_confidence_policy.sql` (single-active-row config), `M004_dis_jobs.sql` (Postgres queue + partial ready index), `M005_dis_cost_ledger.sql` (append-only cost), `M006_fk_columns_labs_vax.sql` (OCR provenance + 'legacy' backfill), `M007_dedupe_unique_indexes.sql` (abort-on-duplicate partial unique), `M008_rls_policies.sql` (portable `current_setting` RLS, no DELETE).
- **Clinical brain (`origin/sprint-2-saved`):** `supabase/migrations/20260428000000_baseline_from_live.sql` (pg_dump baseline = migration source), `20260428001000_prescription_audit.sql` (per-generation telemetry, ported), `20260428002000_pg_trgm.sql` + `20260502000000_stdrx_trgm_index.sql` (fuzzy diagnosis), `supabase/functions/_shared/dose-engine.ts` (`ComputeDoseParams`/`ComputeDoseResult` — the formulary contract consumer).
- **IO indexes (`origin/fix/io-indexes`):** `radhakishan_system/scripts/migration_io_indexes.sql` (trgm + lower-btree on formulary/std-rx/patients; live seq-scan diagnostic).
- **Prototype (port-from, then retire):** `radhakishan_system/schema/radhakishan_supabase_schema.sql` (10 base tables + the `drop … cascade` anti-pattern + `MAX(seq)+1` allocation), `radhakishan_system/schema/abdm_schema.sql` (ABHA/HPR/SNOMED/FHIR columns + care_contexts/consent_artefacts).
