# H3: Sequential-scan / trigram index investigation

**Status:** Confirmed (code evidence). Live DB checks (pg_extension, pg_stat_statements) **NOT EXECUTED** — production read against Supabase CLI was denied by sandbox policy. Code-level evidence is unambiguous; DB confirmation is a follow-up.

## 1. pg_trgm extension status

NOT VERIFIED at runtime. Schema files (`radhakishan_system/schema/*.sql`) contain no `CREATE EXTENSION pg_trgm` and no GIN trigram indexes on `formulary`, `standard_prescriptions`, or `patients`. Combined with the high seq-scan counts in the hypothesis (5,861 / 3,467 / 1,844), the working assumption is **pg_trgm is not installed and no trigram GIN indexes exist**. To confirm, run:
`SELECT extname, extversion FROM pg_extension WHERE extname='pg_trgm';`

## 2. Search queries — `formulary`

| File:Line | Filter | Pattern type | Target column |
|---|---|---|---|
| supabase/functions/generate-prescription/index.ts:251-253 | `or=(generic_name.ilike.%25{d}%25,...)` for each drug | **contains-anywhere** | `generic_name` |
| supabase/functions/generate-prescription/index.ts:272 | full-table fetch (`active=eq.true`) for brand fallback | full scan, client-side filter on `brand_names[]` + `formulations->indian_brands` | n/a |
| supabase/functions/generate-fhir-bundle/index.ts:904, 1201 | `generic_name=ilike.{drug}` (no wildcards from caller, but ilike) | exact-ci or implicit prefix | `generic_name` |
| radhakishan_system/scripts/import_snomed_mappings.js:60 | `generic_name=ilike.{name}` | exact-ci | `generic_name` |
| radhakishan_system/scripts/integration_test.js:340, 689 | `generic_name=ilike.*X*` | contains-anywhere | `generic_name` |

Hottest path: every Claude tool call to `get_formulary` issues an `or=(...ilike.%X%...)` against `generic_name` plus a fallback **full-table scan** when brand-name lookup fails — explains the 3M tuple reads.

## 3. Search queries — `standard_prescriptions`

| File:Line | Filter | Pattern | Target |
|---|---|---|---|
| supabase/functions/generate-prescription/index.ts:336 | `icd10=ilike.{code}%25` | **prefix** | `icd10` |
| supabase/functions/generate-prescription/index.ts:347 | `diagnosis_name=ilike.%25{name}%25` | **contains-anywhere** | `diagnosis_name` |

`icd10=eq.` (line 329) is exact-match and benefits from existing btree on `icd10`.

## 4. Search queries — `patients` (bonus per task #7)

| File:Line | Filter | Pattern |
|---|---|---|
| web/registration.html:731 | `or=(name.ilike.*X*,id.ilike.*X*,contact_phone.ilike.*X*,guardian_name.ilike.*X*)` | contains-anywhere on 4 cols |
| web/patient-lookup.html:804 | `or=(name.ilike.*X*,id.ilike.*X*,contact_phone.ilike.*X*)` | contains-anywhere on 3 cols |
| supabase/functions/abdm-hip-discover/index.ts:143 | `full_name=ilike.%25{name}%25` | contains-anywhere |

## 5. pg_stat_statements query

NOT EXECUTED (DB read denied). Run when you have a window:
```
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
WHERE (query ILIKE '%formulary%' OR query ILIKE '%standard_prescriptions%' OR query ILIKE '%patients%')
  AND query ILIKE '%ilike%'
ORDER BY calls DESC LIMIT 20;
```

## 6. Proposed DDL (do NOT execute)

```sql
-- Enable extension (one-time)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- formulary (~680 rows)
CREATE INDEX CONCURRENTLY idx_formulary_generic_trgm
  ON formulary USING gin (generic_name gin_trgm_ops);
-- Optional, helps brand fallback path:
CREATE INDEX CONCURRENTLY idx_formulary_brand_names_trgm
  ON formulary USING gin (array_to_string(brand_names, ' ') gin_trgm_ops);

-- standard_prescriptions (~503 rows)
CREATE INDEX CONCURRENTLY idx_stdrx_diagnosis_trgm
  ON standard_prescriptions USING gin (diagnosis_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_stdrx_icd10_pattern
  ON standard_prescriptions (icd10 text_pattern_ops);  -- supports prefix ilike

-- patients (~thousands; growing)
CREATE INDEX CONCURRENTLY idx_patients_name_trgm
  ON patients USING gin (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_patients_guardian_trgm
  ON patients USING gin (guardian_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_patients_phone_trgm
  ON patients USING gin (contact_phone gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_patients_id_pattern
  ON patients (id text_pattern_ops);  -- UHID prefix search
```

## 7. Estimated index sizes

Trigram GIN ≈ 3–5× source text column size. All target tables are tiny:

- formulary.generic_name (~680 rows × ~25 B avg) ≈ 17 KB raw → **GIN ~80–120 KB**
- formulary brand_names (concatenated) ≈ ~50 KB raw → **GIN ~200–300 KB**
- standard_prescriptions.diagnosis_name (~503 × ~40 B) ≈ 20 KB → **GIN ~80–150 KB**
- standard_prescriptions icd10 btree → **<50 KB**
- patients.name / guardian_name / contact_phone (assume ~10k rows × 30 B) ≈ 300 KB each → **GIN ~1–2 MB each**

Total footprint: well under 10 MB. Negligible vs current seq-scan I/O cost.

## 8. Risks / caveats

- **CONCURRENTLY** requires no open long-running transaction on the table; on Supabase shared compute it normally succeeds for small tables in seconds. Will fail if run inside a transaction block (`db query` wraps statements — execute one-at-a-time, or use `psql --single-transaction=false`).
- pg_trgm `ilike` planner usage: trigram index helps `%X%`, `X%`, fuzzy. It does **NOT** help patterns shorter than 3 chars; queries on 1–2 char inputs still seq-scan.
- `or=(col1.ilike,col2.ilike,...)` PostgREST → `WHERE c1 ILIKE x OR c2 ILIKE x`. Planner uses BitmapOr across per-column GIN indexes; needs an index per searched column.
- `icd10=ilike.{code}%` (prefix) is best served by `text_pattern_ops` btree, not trigram (cheaper & supports order).
- The brand-name fallback path (line 272) currently does a **full table scan + client-side filter**. Adding trigram on `brand_names` helps only if code is changed to push the predicate to PostgREST (`brand_names_text=ilike.%X%` via a generated column or `array_to_string`). Out of scope for read-only verification but flagged.
- No autovacuum risk — small tables.

## Confidence

**High** that ilike contains-anywhere queries are the seq-scan source (direct code evidence on hot paths). **Medium-High** that pg_trgm is not installed (schema files show no extension; needs runtime confirm). Index proposals are standard, low-risk, and correctly sized.
