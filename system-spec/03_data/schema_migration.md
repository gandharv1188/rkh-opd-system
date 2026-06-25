# Data Migration — Current Supabase → Target Schema

> **Status:** TARGET-STATE rebuild specification. Build to this, not to the live
> prototype DB. This document owns the *migration of the existing data* from the
> live Supabase project (`ecywxuqhnlkjtdshpcbc`, NABH pediatric OPD, in active
> clinical use) into the target DDD-bounded-context schema.
>
> **Scope split.** The target schema's *shape* (bounded-context Postgres schemas,
> per-table columns, constraints, RLS model, audit triggers, server-side counters)
> is owned by the target-schema document (`03_data/target_schema.md`, referenced as
> "TS" below). **This document owns the journey**: table-by-table source→target
> mapping, transformation/backfill, integrity/validation, the expand→migrate→contract
> low-downtime cutover, reversibility/rollback, and the dbmate/SQL tooling that runs
> it. Where this document and an upstream study report disagree, this document wins.
>
> **Foundation.** Migration mechanics are modelled 1:1 on the verified `dis/`
> migration suite (`origin/feat/dis-plan:dis/migrations/M001–M008`, each with a
> `.rollback.sql`) and the sprint-2 baseline
> (`origin/sprint-2-saved:supabase/migrations/20260428000000_baseline_from_live.sql`).
> Those are the templates; this document extends them to the full rebuild.

---

## 0. The migration mandate, in one paragraph

The live database is a **single-schema, anon-key, no-real-RLS, text-PK, race-prone
POC** that 530 drugs / 446 protocols / real patients / real prescriptions already
depend on. The rebuild moves it to **six DDD schemas** (`catalog`, `clinical`,
`prescribing`, `identity`, `abdm`, `ops`) with uuid surrogate PKs, UHID/receipt as
UNIQUE *business* keys, server-side ID allocation, real per-role RLS, append-only
audit, a composite FK enforcing `prescriptions ↔ visits` consistency, terminology
integrity (`catalog.concepts`), and async-generation read models. **No clinical row
is ever destroyed, dropped, or hard-deleted during migration.** Every legacy row is
copied forward with a `verification_status='legacy'` provenance flag, retains its
original business key, and gains a uuid surrogate. The migration is **forward-only,
idempotent, abort-on-duplicate, and reversible at every step** via paired
`.rollback.sql` files. Cutover is **expand → backfill → dual-write → verify →
contract**, so reads/writes never see a half-migrated table.

> **Non-negotiable safety rule (CS-2 / Global CLAUDE.md).** The current schema ships
> a `drop table … cascade` "clean slate" header
> (`radhakishan_supabase_schema.sql:12–18`). **That DDL is forbidden in the rebuild.**
> Migrations are additive/forward-only. The only `DROP` permitted is `DROP INDEX
> CONCURRENTLY` of a proven-unused index, in a separate, gated contract phase.

---

## 1. Source inventory (what we are migrating *from*)

The live schema is the union of `radhakishan_supabase_schema.sql` +
`abdm_schema.sql`, captured authoritatively in
`20260428000000_baseline_from_live.sql` (13 tables, 55 indexes, 56 constraints, 22
RLS policies, 4 sequences, 4 extensions). Live row counts (diagnostic snapshot
2026-04-27, from `migration_io_indexes.sql`):

| Source table (`public.*`)      | PK type                  | ~Rows  | Nature      | Target schema → table |
| ------------------------------ | ------------------------ | ------ | ----------- | --------------------- |
| `formulary`                    | `uuid`                   | 680    | Reference KB| `catalog.drugs`       |
| `standard_prescriptions`       | `uuid`                   | 503    | Reference KB| `catalog.protocols`   |
| `loinc_investigations`         | `uuid`                   | 77,922 | Reference   | `catalog.loinc`       |
| `doctors`                      | `text` (`DR-LOKENDER`)   | ~1     | Reference   | `identity.practitioners` |
| `patients`                     | `text` (`RKH-\d{11}`)    | 570    | **Clinical**| `clinical.patients`   |
| `visits`                       | `uuid`                   | ~600+  | **Clinical**| `clinical.visits`     |
| `prescriptions`                | `text` (`RX-XXXXXXXX`)   | ~hundreds | **Clinical** | `prescribing.prescriptions` |
| `vaccinations`                 | `uuid`                   | n      | **Clinical**| `clinical.vaccinations` |
| `growth_records`               | `uuid`                   | n      | **Clinical**| `clinical.growth_records` |
| `lab_results`                  | `uuid`                   | n      | **Clinical**| `clinical.lab_results` |
| `developmental_screenings`     | `uuid`                   | n      | **Clinical**| `clinical.dev_screenings` |
| `abdm_care_contexts`           | `uuid`                   | 0      | ABDM        | `abdm.care_contexts`  |
| `abdm_consent_artefacts`       | `uuid`                   | 0      | ABDM        | `abdm.consent_artefacts` |
| *(DIS-era, if present)* `ocr_extractions`, `dis_jobs`, `ocr_audit_log`, `dis_cost_ledger` | `uuid` | n | Staging/ops | `ops.*` (already target-shaped) |

**Known data-quality defects carried by the source** (must be fixed in transform,
not papered over):

1. **Mojibake** in formulary / std-Rx JSON: `â€"` em-dash, `â€™` apostrophe,
   `Â°` degree — UTF-8 double-encoding from earlier import passes. (A scan of the
   *repo* JSON files came back clean today, but the **live rows** predate the cleaned
   JSON and must be re-scanned and fixed during ETL — do not assume parity.)
2. **Duplicate ICD-10 protocols** — `standard_prescriptions.icd10` is intentionally
   non-unique (e.g. `J18.9` under Respiratory vs Neonatology); the target adds a
   UNIQUE `(icd10, category, severity)` which will *reject* any true accidental dup.
3. **Free-text codes** — `icd10`, `snomed_code`, `loinc_code` are loose text with no
   FK; many rows have `NULL` or non-canonical codes.
4. **`prescriptions.patient_id` drift risk** — denormalized and consistency-enforced
   "at the application layer" only (`schema.sql:326–328`). Some rows may disagree with
   `visits.patient_id`. Must be reconciled before the composite FK is added.
5. **Verified-vs-placeholder formulary entries** — `data_source` already discriminates
   (`snomed_branded | snomed_generic | orphan | manual`); placeholder dosing bands must
   be flagged, not trusted by the dose engine.
6. **Client-allocated IDs** — `generateUHID()` (`registration.html:681`) and
   `generateReceiptNo()` (`registration.html:655`) compute `MAX(seq)+1` in the browser
   → race-prone, possibly already-skewed sequences. Migration must seed server-side
   counters from the **observed max**, not assume contiguity.

---

## 2. Tooling — dbmate + SQL, portable Supabase↔RDS

**Migration engine: dbmate** (already a `dis/` devDependency, `dbmate ^2.32.0`).
Chosen for the same reasons ADR-006 chose it for `dis/`: forward SQL + explicit
`.rollback.sql`, no ORM, schema lives only in migrations, and CI can verify
`up → down → up` + `pg_dump` schema-diff. **No Drizzle/Prisma. No ORM-generated DDL.**

```
migrations/
  20260601000000_schemas_and_extensions.sql            (+ .rollback.sql)   # EXPAND
  20260601001000_catalog_concepts.sql                  (+ .rollback.sql)   # EXPAND
  20260601002000_catalog_drugs_protocols_loinc.sql     (+ .rollback.sql)   # EXPAND
  20260601003000_identity_practitioners.sql            (+ .rollback.sql)   # EXPAND
  20260601004000_clinical_core.sql                     (+ .rollback.sql)   # EXPAND
  20260601005000_prescribing_core.sql                  (+ .rollback.sql)   # EXPAND
  20260601006000_abdm_core.sql                         (+ .rollback.sql)   # EXPAND
  20260601007000_ops_jobs_outbox_audit_idem.sql        (+ .rollback.sql)   # EXPAND
  20260601008000_server_side_counters.sql              (+ .rollback.sql)   # EXPAND
  20260602000000_backfill_catalog.sql                  (+ .rollback.sql)   # MIGRATE (ETL)
  20260602001000_backfill_clinical.sql                 (+ .rollback.sql)   # MIGRATE (ETL)
  20260602002000_backfill_prescribing.sql              (+ .rollback.sql)   # MIGRATE (ETL)
  20260602003000_reconcile_rx_patient_drift.sql        (+ .rollback.sql)   # MIGRATE
  20260603000000_validate_integrity.sql                (+ .rollback.sql)   # VERIFY (asserts)
  20260603001000_rls_policies.sql                      (+ .rollback.sql)   # EXPAND (deploy dark)
  20260604000000_contract_constraints_and_fks.sql      (+ .rollback.sql)   # CONTRACT
  20260604001000_contract_drop_unused_indexes.sql      (+ .rollback.sql)   # CONTRACT (gated, CONCURRENTLY)
```

**Naming/ordering convention** (matches sprint-2 `YYYYMMDDHHMMSS_` + the `dis/`
`Mxxx` semantics): one migration = one reversible unit; never edit a shipped
migration (reconcile with a *new* one — sprint-2 baseline rule). Every file carries a
header block (purpose, decision ref, rollback note) exactly like the sprint-2
migrations.

**Idempotency primitives** used throughout (so a partial re-run never errors):
`CREATE … IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `INSERT …
ON CONFLICT DO NOTHING`, and pre-flight `DO $$ … RAISE EXCEPTION` dry-run guards
(the `dis/` M-007 pattern).

**Portability (Supabase POC → AWS RDS prod, ADR-005).** Every migration uses **plain
Postgres 16** only — `pgcrypto` (`gen_random_uuid()`), `pg_trgm`, `plpgsql`. RLS uses
the portable `current_setting('app.role' / 'app.facility_id' / 'app.doctor_id')`
pattern (the `dis/` M-008 contract), set from the JWT at request start by the
database adapter — **identical policy file runs on Supabase and RDS**. No
`auth.role()`, no `auth.uid()`, no Supabase-proprietary function appears in any
migration. The queue table (`ops.jobs`) is Supabase/POC-only and is *skipped* when
`DIS_STACK=aws` (SQS replaces it — the `dis/` M-004 caller-filter convention).

**Execution wrapper.** A thin `scripts/migrate.sh` wraps dbmate to (a) load the
`DATABASE_URL` from `SecretsPort` (never a literal), (b) filter `ops.jobs` out on
`DIS_STACK=aws`, (c) run `dbmate up`, (d) run the post-migration `VERIFY` asserts as
a hard gate. `npx supabase db query --linked -f` is acceptable for the POC but
dbmate is the source of truth so the same files run on RDS.

---

## 3. Migration strategy — Expand / Contract, low-downtime

The migration must run against a **live clinical DB** with reception/nurse/doctor
traffic. We use the **expand–contract (parallel-change) pattern** so the old app keeps
working until the new app is verified, and there is no "big-bang" downtime window.

```
┌──────────┐   EXPAND      ┌──────────────────┐  BACKFILL   ┌──────────────────┐
│  Legacy  │  add new      │ Legacy + new     │  ETL copy   │ Legacy + new     │
│  public.*│  schemas      │ schemas (empty)  │  legacy→new │ schemas (full)   │
│  (live)  │──────────────▶│ old app untouched │────────────▶│ both populated   │
└──────────┘               └──────────────────┘             └────────┬─────────┘
                                                                      │ DUAL-WRITE
                                                                      ▼
                                              ┌──────────────────────────────────┐
                                              │ New service writes to new schema; │
                                              │ CDC/trigger mirrors deltas        │
                                              │ legacy→new during shadow window   │
                                              └───────────────┬──────────────────┘
                                                              │ VERIFY (row counts, hashes, asserts)
                                                              ▼
                                              ┌──────────────────────────────────┐
                                              │ CUTOVER: flip read/write to new   │
                                              │ schema (feature flag, see §8)     │
                                              └───────────────┬──────────────────┘
                                                              │ CONTRACT
                                                              ▼
                                              ┌──────────────────────────────────┐
                                              │ Add mandatory FKs/CHECKs/NOT NULL;│
                                              │ retire legacy public.* tables to  │
                                              │ read-only archive (NOT dropped)   │
                                              └──────────────────────────────────┘
```

**Phases mapped to the migration files in §2:**

| Phase     | Files                          | What runs live | Downtime |
| --------- | ------------------------------ | -------------- | -------- |
| **Expand**   | `…000000`–`…008000`         | Create schemas/tables/counters **alongside** `public.*`. Old app unaffected. | **Zero** |
| **Backfill** | `…backfill_*`, `…reconcile_*` | ETL-copy legacy → new with `verification_status='legacy'`. Re-runnable. | **Zero** (reads only on legacy) |
| **Dual-write** | (app code, not SQL) + delta-sync triggers | New service writes new schema; a trigger/outbox mirrors any *new legacy writes* forward during the shadow window. | **Zero** |
| **Verify**   | `…validate_integrity`        | Hard asserts (counts, content hashes, FK pre-checks). Aborts on any mismatch. | **Zero** |
| **Cutover**  | feature flag flip (§8)       | Read/write traffic moves to new schema. RLS already deployed dark. | **Seconds** (flag flip) |
| **Contract** | `…contract_*`                | Promote nullable FKs/CHECKs to mandatory; drop proven-unused indexes (CONCURRENTLY). Legacy tables → read-only. | **Zero** |

**Why dual-write and not a freeze.** A returning patient mid-consult, a nurse saving
vitals, and a doctor signing a Rx may all be in flight during cutover. Dual-write +
delta-sync means the new schema is already current at the instant of the flag flip,
so cutover is a sub-second flag change rather than a maintenance window. If the
clinic's true traffic permits a short off-hours window (it is a single-site OPD),
the dual-write trigger layer MAY be omitted in favour of a brief read-only window —
but the expand/backfill/verify/contract spine is unchanged.

---

## 4. Table-by-table mapping, transformation & backfill

Conventions for *every* target row (TS §"Every mutable table"): new `id uuid`
surrogate; `created_at`/`updated_at` preserved from source where present (else
backfilled to source `created_at`); `version int default 1`; `correlation_id` set to
a single well-known "legacy-migration" uuid so audit can identify migrated rows;
`facility_id` set to the single Radhakishan facility uuid (multi-site is future, but
the column ships now for RLS scoping). Legacy business keys (`UHID`, `RX-…`,
`receipt_no`) are retained as **UNIQUE business columns**, never as the PK.

### 4.1 `catalog` (reference KB — `formulary`, `standard_prescriptions`, `loinc_investigations`)

These are **idempotent seed-style backfills** (the digest: "Keep 530 drugs / 446
protocols as idempotent seed scripts"). They are reference data, not patient data, so
they may be re-derived from the cleaned repo JSON rather than only copied from live —
but the live rows are the source of truth for any hand-edits, so the ETL **copies
live, then reconciles against repo JSON, preferring live for clinician edits**.

#### `formulary` → `catalog.drugs`

| Source column                          | Target column                    | Transform |
| -------------------------------------- | -------------------------------- | --------- |
| `id` (uuid)                            | `legacy_id` (uuid, kept)         | copy; new `id` = `gen_random_uuid()` (or reuse legacy uuid as surrogate — preferred to keep FK joins stable) |
| `generic_name` (UNIQUE)                | `generic_name` (UNIQUE business) | **mojibake-fix** (`â€"`→`—`, `â€™`→`’`, `Â°`→`°`); trim; collapse whitespace |
| `snomed_code`, `snomed_display`        | → FK to `catalog.concepts`       | upsert into `concepts(system='SNOMED', code, display)`; store `snomed_concept_id` FK; keep raw in `snomed_code_raw` for audit |
| `drug_class`,`category`,`brand_names[]`,`therapeutic_use[]` | same | copy; mojibake-fix text |
| `formulations` (jsonb[])               | `formulations` (jsonb[])         | **Ajv-validate** against `formulary.v1.json`; mojibake-fix string leaves; rows failing validation → quarantine table `catalog._drugs_quarantine`, NOT silently dropped |
| `dosing_bands` (jsonb[])               | `dosing_bands` (jsonb[]) + **validated columns/CHECKs** | Ajv-validate; project the dose-engine-critical fields (`method`, `dose_min/max_qty`, `dose_unit`, `is_per_day`, `frequency_per_day`, `max_single_qty`, `max_daily_qty`, `rounding_rule`) into typed columns the engine relies on (TS); set `dosing_provenance` = `verified` vs `placeholder` from `data_source` + a band-completeness heuristic |
| `data_source`                          | `data_source`                    | copy (drives verified/placeholder split) |
| renal/hepatic/safety/admin jsonb+text[]| same                             | copy; mojibake-fix |
| `active`,`created_at`,`updated_at`     | same                             | copy |
| —                                      | `verification_status`            | `'legacy'` |
| —                                      | `facility_id`,`version`,`correlation_id` | facility uuid / `1` / legacy-migration uuid |

**Contract test gate:** the `formulary.v1.json` Ajv schema is enforced **at write
time and in CI** (digest §5). Any row that the dose engine could mis-read (missing
`dose_unit`, non-numeric `dose_max_qty`, unknown `rounding_rule`) is quarantined and
surfaced for six-eye review — it never reaches `catalog.drugs`.

#### `standard_prescriptions` → `catalog.protocols`

| Source                                   | Target | Transform |
| ---------------------------------------- | ------ | --------- |
| `icd10` (non-unique)                     | `icd10` + FK to `concepts(system='ICD10')` | normalise case/format; upsert concept; validate |
| `diagnosis_name`                         | `diagnosis_name` | mojibake-fix; trim. **`pg_trgm` GIN index** for fuzzy match (`idx_protocols_name_trgm`, gin_trgm_ops) — port from sprint-2 `20260502000000_stdrx_trgm_index.sql` |
| `category`,`severity`                    | same   | normalise `severity` to enum domain (`mild|moderate|severe|any`) |
| `first_line_drugs`,`second_line_drugs` (jsonb[]) | same | Ajv-validate; cross-check each `drug` resolves to a `catalog.drugs.generic_name` → unresolved → `protocol_warnings[]`, not a hard fail |
| `investigations`,`warning_signs`, etc.   | same   | copy; mojibake-fix |
| `snomed_code`                            | → `concepts` FK | upsert/validate |
| —                                        | `UNIQUE (icd10, category, severity)` | **dedup pre-flight** (see §5.2): true dups abort the migration with the offending tuples printed |

#### `loinc_investigations` → `catalog.loinc`

Bulk copy 77,922 rows verbatim (static reference); `loinc_code` UNIQUE retained;
mojibake-fix `component`/`long_name`. No transform beyond schema relocation.
Carry forward the trigram-search indexes from `migration_io_indexes.sql` §8.

### 4.2 `identity` (`doctors` → `identity.practitioners`)

| Source                     | Target | Transform |
| -------------------------- | ------ | --------- |
| `id` (`DR-LOKENDER`, text) | `legacy_code` (UNIQUE business) | new `id uuid` surrogate; `legacy_code` kept so existing `visits.doctor_id`/`prescriptions.approved_by` joins remap |
| `full_name`,`degree`,`registration_no`,`specialisation`,`contact_phone`,`is_active` | same | copy |
| `hpr_id`                   | `hpr_id` | copy (ABDM HPR) |
| —                          | `role` | seed `'doctor'`; reception/nurse/admin users created fresh (no legacy source) |

A **`identity._practitioner_id_map (legacy_code → id)`** table is produced so the
clinical/prescribing backfills can rewrite `doctor_id`/`approved_by` text references
to uuid FKs.

### 4.3 `clinical` (patients, visits, vitals, labs, growth, vax, dev-screenings)

This is **patient data** — copied forward, never re-derived, always
`verification_status='legacy'`.

#### `patients` → `clinical.patients`

| Source                                  | Target | Transform |
| --------------------------------------- | ------ | --------- |
| `id` (`RKH-\d{11}` text PK)             | `uhid` (UNIQUE business) | retain verbatim; new `id uuid` surrogate. **`patients._uhid_id_map (uhid → id)`** produced for child-table remap |
| `name`,`dob`,`sex`,`guardian_*`,`contact_phone`,`blood_group`,`known_allergies[]` | same | copy; mojibake-fix `name`/`guardian_name` |
| `gestational_age_weeks`,`birth_weight_kg` | same | copy (neonatal) |
| `abha_*` (number/address/verified/token/linked_at) | same → `clinical.patients` ABHA fields | copy; keep UNIQUE partial index on `abha_number` |
| `is_active`,`created_at`,`updated_at`   | same   | copy |
| —                                       | `guardian_consent` (DPDP) | **NULL for legacy rows** + a `consent_status='pending_recapture'` flag: DPDP guardian consent (digest §8) was never captured by the old flow, so it is recaptured at the patient's next visit, not fabricated |
| —                                       | `facility_id`,`version`,`correlation_id` | facility uuid / `1` / legacy-migration uuid |

#### `visits` → `clinical.visits`

| Source                | Target | Transform |
| --------------------- | ------ | --------- |
| `id` (uuid PK)        | `id` (reuse legacy uuid as surrogate) | keep — preserves all child FKs (prescriptions, vax, growth, labs, dev-screen, abdm) |
| `patient_id` (text)   | `patient_id` (uuid FK) | remap via `_uhid_id_map`; **also retain `patient_uhid` denormalized** so the composite FK `(visit_id, patient_id)` and legacy queries both work |
| `doctor_id` (text)    | `doctor_id` (uuid FK)  | remap via `_practitioner_id_map`; unmatched → NULL + warning |
| all vitals/anthropometry/clinical/billing columns | same | copy verbatim (CHECK ranges already match TS) |
| `raw_dictation`,`visit_summary`,`attached_documents`,`diagnosis_codes`,`procedures` | same | copy; mojibake-fix free text |
| `receipt_no`          | `receipt_no` (UNIQUE business) | copy; feed server-side counter seed (§5.3) |

#### `vaccinations`, `growth_records`, `lab_results`, `developmental_screenings`

Uniform pattern: reuse legacy uuid PK as surrogate; remap `patient_id` text→uuid via
`_uhid_id_map`; remap `visit_id` (already uuid) verbatim; copy all measurement/result
columns; set `verification_status` — **`lab_results`/`vaccinations` already gained the
`verification_status`/`ocr_extraction_id`/`verified_by`/`verified_at` columns via the
`dis/` M-006 migration**, so reuse those exactly (default `'legacy'`); `growth_records`
and `developmental_screenings` get the same four columns added in the EXPAND phase.
LOINC/SNOMED text codes on `lab_results` are upserted into `catalog.concepts` and FK'd.

### 4.4 `prescribing` (`prescriptions` + `prescription_audit`)

#### `prescriptions` → `prescribing.prescriptions`

| Source                       | Target | Transform |
| ---------------------------- | ------ | --------- |
| `id` (`RX-XXXXXXXX` text PK) | `rx_no` (UNIQUE business) | retain verbatim; new `id uuid` surrogate |
| `visit_id` (uuid)            | `visit_id` (uuid FK)   | copy |
| `patient_id` (text, denormalized) | `patient_id` (uuid FK) | remap via `_uhid_id_map` **after reconciliation** (§4.5) |
| `generated_json`,`medicines`,`investigations`,`vaccinations`,`growth` (jsonb) | same | copy; mojibake-fix string leaves |
| `approved_by`               | `signed_by` (uuid FK)  | remap via `_practitioner_id_map` |
| `is_approved`,`approved_at`,`pdf_url`,`qr_data`,`edit_notes` | same | copy |
| `version`                   | maps to `rx_versions` model | legacy single-row → seed `prescribing.rx_versions` with the one historical version; signed Rx become **immutable** (TS: edits → new `rx_versions` rows) |
| `fhir_bundle` (jsonb)       | `abdm.fhir_bundles`    | relocate to ABDM schema, FK back to prescription |
| —                           | `content_hash`         | compute SHA-256 over canonical Rx JSON for signed rows (tamper-evidence, TS) |
| —                           | `verification_status`  | `'legacy'`; signed legacy Rx are trusted as historically-signed but flagged migrated |

#### `prescription_audit` → `prescribing.prescription_audit`

Already target-shaped (sprint-2 `20260428001000_prescription_audit.sql`): copy
verbatim; remap `prescription_id`/`visit_id`. **Forward-extend** with the async-job
columns (`meta_mode`, `stop_reason`, `tools_called[]`, `requested/emitted/omitted/added`,
`severity_*`, `warnings[]`, `duration_ms`) which already exist — the new
`prescribing.rx_generation_jobs` read model is *net-new* (no legacy source; starts
empty).

### 4.5 `prescriptions.patient_id` drift reconciliation (`…reconcile_rx_patient_drift.sql`)

Before any composite FK is added, reconcile the denormalized column:

```sql
-- VERIFY pass: list every prescription whose denormalized patient_id
-- disagrees with its visit's patient_id (the consistency the prototype
-- enforced only in app code, schema.sql:326-328).
do $$
declare drift_count int; drift_sample text;
begin
  select count(*), string_agg(p.id || ' (rx=' || p.patient_id ||
                               ' / visit=' || v.patient_id || ')', ', ')
    into drift_count, drift_sample
  from public.prescriptions p
  join public.visits v on v.id = p.visit_id
  where p.patient_id is distinct from v.patient_id
  limit 20;

  if drift_count > 0 then
    raise exception
      'RX↔visit patient drift: % rows. The visit is authoritative; '
      'reconcile before composite FK. Sample: %', drift_count, drift_sample;
  end if;
end $$;
```

**Policy: the *visit* is authoritative.** Drifting rows have their
`prescribing.prescriptions.patient_id` set to `visits.patient_id` (remapped to uuid),
and the original value preserved in `ops.audit_log` for forensic review. Only after
drift = 0 does `…contract_constraints_and_fks.sql` add the composite FK
`(visit_id, patient_id) REFERENCES clinical.visits(id, patient_id)`.

### 4.6 `abdm` (`abdm_care_contexts`, `abdm_consent_artefacts`)

Both live tables are **empty** (0 rows, per `migration_io_indexes.sql`). Migration is
schema-only: create `abdm.care_contexts` / `abdm.consent_artefacts` with uuid surrogate
PKs, remapped FKs, plus the net-new `abdm.fhir_bundles` (relocated from
`prescriptions.fhir_bundle`), `abdm.outbox`, `abdm.inbox`. No data backfill needed —
this de-risks the ABDM cutover entirely.

### 4.7 `ops` (jobs, outbox, audit, idempotency, cost ledger)

If the DIS-era tables (`ocr_extractions`, `dis_jobs`, `ocr_audit_log`,
`dis_cost_ledger`) are present on live (the `dis/` M-001…M-005 set), they relocate to
`ops.*` / `clinical.ocr_extractions` verbatim (they are already target-shaped with
uuid PKs, append-only audit, immutability triggers). Otherwise they ship fresh in the
EXPAND phase. The new `ops.outbox` (event dispatch), `ops.idempotency_keys` (port the
`dis/` M-001 `idempotency_keys`), and `ops.audit_log` (append-only, BEFORE
UPDATE/DELETE raise — the `dis/` M-002 pattern) start empty.

---

## 5. Integrity, validation & the fixes for the critical flaws

### 5.1 Server-side ID allocation (kills the `MAX(seq)+1` race)

The browser computes UHID/receipt/token sequences (`registration.html:655,681`),
which races under concurrent registration. The target replaces this with a
row-locked counter exposed through a `SECURITY DEFINER` function (TS), and the
migration **seeds the counter from the observed live max**, not from a contiguity
assumption:

```sql
-- 20260601008000_server_side_counters.sql  (EXPAND)
create table clinical.uhid_counter (
  fy_code  text not null,         -- e.g. '2526'
  month    int  not null check (month between 1 and 12),
  last_seq int  not null default 0,
  primary key (fy_code, month)
);

-- Seed from live max so the first new UHID continues the live sequence.
-- substring(id from 5 for 4) = fyStart+fyEnd, from 9 for 2 = month, from 11 = seq
insert into clinical.uhid_counter (fy_code, month, last_seq)
select substring(uhid from 5 for 4)              as fy_code,
       (substring(uhid from 9 for 2))::int       as month,
       max((substring(uhid from 11))::int)       as last_seq
from clinical.patients
group by 1, 2
on conflict (fy_code, month) do update
  set last_seq = greatest(clinical.uhid_counter.last_seq, excluded.last_seq);
```

The allocator (`SECURITY DEFINER`): `UPDATE clinical.uhid_counter SET last_seq =
last_seq + 1 WHERE … RETURNING last_seq` under the implicit row lock — atomic, no
race. Identical pattern for `receipt_no` (`RKH-RCT-YYMMDD-NNN`) and `token_no`,
seeded from `max(receipt_no sequence-suffix)` per day. **All client-side allocation
is deleted in the frontend rebuild.**

### 5.2 Dedup pre-flight (abort-on-duplicate, `dis/` M-007 pattern)

Each backfill that introduces a new UNIQUE constraint runs a `DO $$ … RAISE
EXCEPTION` dry-run first, so a constraint violation **aborts with the offending keys
printed** rather than failing opaquely mid-`CREATE UNIQUE INDEX`:

```sql
-- Before catalog.protocols UNIQUE (icd10, category, severity)
do $$
declare dup_count int; dup_sample text;
begin
  select count(*), string_agg(k, ', ') into dup_count, dup_sample
  from (
    select icd10 || '|' || coalesce(category,'∅') || '|' || coalesce(severity,'any') as k
    from public.standard_prescriptions
    group by 1 having count(*) > 1 limit 10
  ) d;
  if dup_count > 0 then
    raise exception 'protocols dedupe abort: % colliding (icd10,category,severity). Sample: %',
      dup_count, dup_sample;
  end if;
end $$;
```

The same guard protects `catalog.drugs.generic_name`, `clinical.patients.uhid`,
`prescribing.prescriptions.rx_no`, `clinical.lab_results`/`vaccinations` dedupe
(reuse the `dis/` M-007 partial-unique indexes verbatim for OCR-originated rows).

### 5.3 Terminology integrity (`catalog.concepts`)

ICD-10 / SNOMED / LOINC are promoted from loose text to FK'd concepts:

```sql
create table catalog.concepts (
  id      uuid primary key default gen_random_uuid(),
  system  text not null check (system in ('ICD10','SNOMED','LOINC')),
  code    text not null,
  display text,
  unique (system, code)
);
```

Backfill upserts every distinct `(system, code)` seen across `formulary.snomed_code`,
`standard_prescriptions.icd10`/`snomed_code`, `lab_results.loinc_code`/`snomed_code`
(`ON CONFLICT DO NOTHING`), then adds nullable FK columns to the owning tables and
populates them. Codes that fail a format check are kept in `*_code_raw` columns and
flagged — **never discarded** (auditability). FKs become *mandatory* only in the
CONTRACT phase, and only for systems that fully reconcile.

### 5.4 Validation gate (`…validate_integrity.sql` — VERIFY, hard asserts)

A single migration of `RAISE EXCEPTION`-on-failure asserts, run before cutover and
re-runnable any time. It is the **machine-checkable definition of "the migration is
correct"**:

| Assert | Check |
| ------ | ----- |
| **Row-count parity** | `count(clinical.patients)` = `count(public.patients)`; same for every clinical/catalog table minus documented quarantine counts |
| **No orphans** | every `clinical.visits.patient_id` resolves in `clinical.patients`; every child FK resolves |
| **RX↔visit drift = 0** | §4.5 reconciliation passed |
| **Composite-FK pre-check** | every `(visit_id, patient_id)` in `prescribing.prescriptions` exists in `clinical.visits(id, patient_id)` |
| **Concept coverage** | % of ICD10/SNOMED/LOINC codes resolved ≥ target threshold; unresolved listed (warn, not fail) |
| **Content-hash spot-check** | for a sample of patients/prescriptions, `md5`/canonical-JSON of legacy row = canonical of migrated row (proves no silent field loss) |
| **Counter monotonicity** | `clinical.uhid_counter.last_seq` ≥ max legacy seq for every `(fy_code, month)` |
| **No mojibake remains** | `NOT EXISTS (… WHERE name ~ 'Ã|â€|Â°')` across migrated text columns |
| **Quarantine accounted** | `count(catalog._drugs_quarantine)` matches the expected ETL-reject list (no silent drops) |

Cutover is **blocked** until this migration exits 0. CI runs it against a restored
prod snapshot in staging (digest §10 "shadow before cutover").

### 5.5 Real RLS, deployed dark (`…rls_policies.sql`)

Per-role portable RLS (the `dis/` M-008 contract) is created **before** cutover but is
harmless while the legacy anon path is still serving, because the new service sets
`app.role`/`app.facility_id` per request and the legacy path doesn't touch the new
schemas. Roles: `reception`, `nurse`, `doctor`, `service`, `admin`. **No DELETE policy
on any `clinical.*` / `prescribing.*` / `*.audit_log` table** (immutability invariant).
The anon key never reaches clinical schemas. Append-only audit triggers (BEFORE
UPDATE/DELETE raise) are installed on `ops.audit_log` and `prescribing.rx_versions`
in the same wave (the `dis/` M-002 pattern).

---

## 6. Reversibility & rollback

**Principle:** every migration is reversible, and the legacy `public.*` tables are the
ultimate rollback target — they are **never dropped**, only retired to read-only after
a stable cutover. There is always a known-good state to return to.

### 6.1 Per-migration rollback (dbmate `.rollback.sql`)

Every forward migration ships a paired `.rollback.sql` (the `dis/` M-001…M-008
convention). CI enforces `dbmate up → down → up` + `pg_dump --schema-only` diff = empty
(ADR-006). Rollback semantics per phase:

| Phase | `.rollback.sql` does | Data safety |
| ----- | -------------------- | ----------- |
| EXPAND | `DROP SCHEMA … CASCADE` of the *new, empty* schema objects | Safe — new schemas hold no authoritative data yet |
| BACKFILL | `TRUNCATE` the migrated target tables (legacy `public.*` untouched) | Safe — legacy data intact; re-run backfill to redo |
| VERIFY | no-op (read-only asserts) | — |
| RLS / counters | drop policies / drop counter table | Safe |
| CONTRACT | **the hard rollback boundary** — see §6.2 | Constrained |

**Baselines are never rolled back** (sprint-2 rule): the live baseline and the
EXPAND-phase schema creation are reconciled forward, never reversed destructively.

### 6.2 Cutover rollback (the real-world plan)

| When failure detected | Rollback action | RTO |
| --------------------- | --------------- | --- |
| **Before cutover** (EXPAND/BACKFILL/VERIFY fails) | `dbmate down` the backfill; fix ETL; re-run. Legacy app never noticed. | minutes |
| **At cutover** (flag flipped, smoke test fails) | **Flip the feature flag back** to legacy schema (§8). New writes during the window are mirrored back via the dual-write trigger / replayed from `ops.outbox`. | seconds |
| **Post-cutover, pre-CONTRACT** | Flag back to legacy; reconcile any new-schema-only writes back to `public.*` via a reverse-sync script (the dual-write trigger is bidirectional during the shadow window). Because CONTRACT (mandatory FKs, legacy retirement) has *not* run, `public.*` is still fully writable. | minutes |
| **Post-CONTRACT** | Legacy is read-only but **still present**. Roll back = re-enable legacy writes (drop the read-only RLS), flag to legacy, forward-fix the new schema offline. No data is lost because nothing was dropped. | < 1 hour |

**This is why CONTRACT is the last, separately-gated phase and why it never drops a
clinical table.** The only destructive operation anywhere in the plan is `DROP INDEX
CONCURRENTLY` of indexes with `idx_scan = 0` (the `migration_io_indexes.sql` "DO NOT
RUN AS PART OF" list), and even that runs only after 7+ days of new-index settling and
a `pg_stat_reset()` re-check, in its own migration, fully reversible by re-creating
the index.

### 6.3 Backups & point-in-time

A `pg_dump` (custom-format) of the full live DB is taken immediately before EXPAND and
again immediately before CONTRACT, stored via `StoragePort` (encrypted, access-logged,
no PHI in filename). Supabase PITR (or RDS automated snapshots on AWS) is the
last-resort floor. Restore drill is rehearsed in staging against a prod snapshot as
part of the shadow rollout (§8) — an untested backup is not a backup.

---

## 7. Handling the three load-bearing legacy datasets

### 7.1 Existing prescriptions (clinical-legal records)

Signed legacy prescriptions are **immutable historical-legal artifacts**. They are
copied with `verification_status='legacy'`, a computed `content_hash`, their single
historical version seeded into `prescribing.rx_versions`, and their `fhir_bundle`
relocated to `abdm.fhir_bundles`. They are **trusted as historically signed** (not
re-validated against the new dose engine, which would be anachronistic), but flagged
`migrated` so the provenance is auditable. Their PDFs (`pdf_url`) and QR payloads
(`qr_data`) are preserved byte-for-byte — reprints of old Rx must reproduce the
original document. New tamper-evident signing (ES256 JWS `SignaturePort`, TS §7) applies
to Rx generated *after* cutover only; legacy QR hashes are honoured read-only by the
verify endpoint with a "legacy-format" badge.

### 7.2 Existing patients (DPDP child-data)

Every patient row is copied forward (never re-keyed away from its UHID). The DPDP
**guardian-consent gap** (the old flow never captured it) is handled honestly:
`guardian_consent = NULL`, `consent_status = 'pending_recapture'`. Consent is captured
at the patient's **next visit** through the rebuilt registration flow — the migration
does **not** fabricate a consent record. Returning-patient lookups work immediately
(UHID/name/guardian/phone trigram search indexes carried from
`migration_io_indexes.sql` §6–7); a non-blocking banner prompts reception to capture
consent on next contact.

### 7.3 The formulary KB (dose-engine safety dependency)

The 530-drug / 446-protocol KB is the dose engine's source of truth, so its migration
is the **highest-integrity** path: Ajv-validated at write time, verified-vs-placeholder
split surfaced explicitly, dose-engine-critical fields projected into typed CHECK'd
columns, unresolved drug↔protocol references warned (not dropped), and any row the
engine could mis-read quarantined for six-eye review. The KB is also reproducible from
the idempotent seed scripts (cleaned repo JSON) — so if a placeholder band is later
corrected, re-seeding is a single idempotent `ON CONFLICT DO UPDATE`, not a migration.

---

## 8. Cutover orchestration & shadow rollout

Tied to the digest's feature-flag ladder (`ENABLED → SHADOW → OPT_IN_OPERATORS → *`)
+ kill-switch (digest §10):

1. **Staging dress-rehearsal.** Restore a prod snapshot to staging; run the *entire*
   migration chain (EXPAND→CONTRACT) + `…validate_integrity.sql`; run the generation
   eval set and the FHIR snapshot tests against migrated data. Gate: green.
2. **Shadow.** In prod, EXPAND + BACKFILL + dual-write triggers active. The new service
   runs **read-only / shadow** — speculative generation runs against migrated data and
   its output is *diffed against legacy Edge output*, but the doctor still signs via the
   legacy path. Surfaces silent data-shape regressions before any clinician depends on
   the new schema.
3. **Opt-in operators.** A subset of reception/nurse/doctor sessions flip to the new
   schema via flag. Real writes go to the new schema; dual-write mirrors back so a
   rollback loses nothing.
4. **Full cutover.** Flag → `*`. `…validate_integrity.sql` re-run as the final gate.
5. **Stabilise, then CONTRACT.** After a defined stable window (e.g. 7 days, matching
   the index-settling window), run `…contract_*`: promote FKs/CHECKs/NOT NULL to
   mandatory, set `public.*` read-only (RLS revoke of write), drop proven-unused
   indexes CONCURRENTLY. Legacy tables remain as a read-only archive indefinitely.

The **kill-switch** (Hono middleware, 503-on-writes) and the per-request
`correlation_id` make any cutover incident bounded and traceable — every migrated row
carries the legacy-migration `correlation_id`, so a post-incident audit can isolate
exactly which rows the migration touched.

---

## 9. Acceptance criteria (Definition of Done for this migration)

- [ ] All EXPAND/BACKFILL/VERIFY/CONTRACT migrations + `.rollback.sql` pass `dbmate up→down→up` and `pg_dump` schema-diff in CI.
- [ ] `…validate_integrity.sql` exits 0 against a restored prod snapshot in staging (row-count parity, zero orphans, zero RX↔visit drift, composite-FK pre-check passes, no mojibake remains, quarantine accounted).
- [ ] Server-side `clinical.uhid_counter` / receipt / token counters seeded from live max; no client-side allocation path remains in the rebuilt frontend.
- [ ] `catalog.concepts` populated; ICD10/SNOMED/LOINC FKs added; unresolved-code report produced and reviewed.
- [ ] `formulary.v1.json` Ajv schema enforced at write time + CI; quarantine table empty or fully accounted; verified-vs-placeholder dosing split surfaced.
- [ ] Composite FK `(visit_id, patient_id)` and per-role portable RLS live; no DELETE policy on any clinical/audit table; append-only audit triggers active.
- [ ] Every legacy clinical row present in the target with `verification_status='legacy'`, original business key retained, and provenance auditable.
- [ ] Legacy `public.*` tables present and read-only (not dropped); rollback drill rehearsed in staging; pre-EXPAND and pre-CONTRACT `pg_dump` backups stored and a restore tested.
- [ ] Signed legacy prescriptions immutable, content-hashed, PDFs/QR preserved byte-for-byte; legacy QR honoured read-only with a legacy-format badge.

---

## 10. Cross-references

| Concern | Owning document |
| ------- | --------------- |
| Target schema shape (tables/columns/constraints/RLS model/triggers/counters) | `03_data/target_schema.md` (TS) |
| Backend service decomposition, job queue, off-edge worker | `02_architecture/backend_services.md` |
| AI generation / dose-engine separation / `prescription_audit` semantics | `06` (AI orchestration) |
| ABDM/FHIR data (`abdm.fhir_bundles`, care contexts, consent) | `07` (API + ABDM) |
| DPDP guardian consent, PII boundaries, audit/compliance | `01_product/clinical_safety.md`, security review (`09`) |
| TDD/eval gates that *enforce* the validation asserts here | `09_engineering_discipline/` (quality gates, evals, testing strategy) |

**Key source files this migration is built from (read-only):**
`radhakishan_system/schema/radhakishan_supabase_schema.sql`,
`radhakishan_system/schema/abdm_schema.sql`,
`origin/sprint-2-saved:supabase/migrations/{20260428000000_baseline_from_live,20260428001000_prescription_audit,20260428002000_pg_trgm,20260502000000_stdrx_trgm_index}.sql`,
`origin/feat/dis-plan:dis/migrations/M001–M008` (+ `.rollback.sql`),
`origin/fix/io-indexes:radhakishan_system/scripts/migration_io_indexes.sql`,
`web/registration.html` (`generateUHID:681`, `generateReceiptNo:655` — the client-side race being eliminated).
