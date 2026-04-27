# 10 — Index Proposal (live diagnostic, 2026-04-27)

> Read-only proposal driven by `pg_stat_statements` and
> `pg_stat_user_tables` taken from the live Supabase project
> `ecywxuqhnlkjtdshpcbc` on 2026-04-27. **No DDL has been executed.**
> The migration SQL ready for off-hours run is committed alongside this
> doc as `radhakishan_system/scripts/migration_io_indexes.sql`.

---

## 1. Purpose

Close Fix-4 in `09-findings-and-action-plan.md` ("Add fast-search
indexes for drug / diagnosis / patient search"). Reduce shared-buffer
hits and total query time on the 4 search-heavy public tables:
`formulary`, `standard_prescriptions`, `patients`,
`loinc_investigations`. Document the unused indexes that should be
dropped in a separate, later phase.

---

## 2. What the diagnostic showed today

Numbers below are live counters at the time of the snapshot
(2026-04-27, ~22:30 IST).

### 2.1 Sizes

| Table                    | Rows    | Heap   | Indexes | TOAST   | Total    |
|--------------------------|---------|--------|---------|---------|----------|
| `loinc_investigations`   | 77,922  | 40 MB  | 19 MB   |   48 kB | 59 MB    |
| `formulary`              | 680     | 2.6 MB | 992 kB  | 5.4 MB  | 9.1 MB   |
| `prescriptions`          | 520     | 736 kB | 168 kB  | 6.5 MB  | 7.6 MB   |
| `visits`                 | 658     | 992 kB | 152 kB  | 1.3 MB  | 2.4 MB   |
| `standard_prescriptions` | 503     | 1.3 MB | 328 kB  | 736 kB  | 2.4 MB   |
| `lab_results`            | 549     | 264 kB |  80 kB  |   32 kB | 376 kB   |
| `patients`               | 570     |  80 kB | 104 kB  |   40 kB | 224 kB   |
| `growth_records`         | 407     |  72 kB |  96 kB  |   32 kB | 200 kB   |
| `vaccinations`           | 128     |  24 kB |  64 kB  |   40 kB | 128 kB   |

Database total: 95 MB. Cache hit ratio: **100%** on heap and on
index — the IO budget is being burned in wasted *work* (rows examined,
buffers touched), not disk reads.

### 2.2 Seq-scan / index-scan and tuples read

| Table                    | Rows    | seq_scan | seq_tup_read | idx_scan | %seq |
|--------------------------|---------|---------:|-------------:|---------:|-----:|
| `loinc_investigations`   | 77,922  |       93 |    6,021,399 |  249,321 |  0.0 |
| `formulary`              | 680     |    5,869 |    3,036,726 |   14,502 | 28.8 |
| `standard_prescriptions` | 503     |    3,473 |    1,637,421 |    4,509 | 43.5 |
| `patients`               | 570     |    1,844 |      230,598 |    8,123 | 18.5 |
| `prescriptions`          | 520     |      341 |       74,563 |   12,383 |  2.7 |
| `vaccinations`           | 128     |      361 |       17,761 |    4,472 |  7.5 |
| `visits`                 | 658     |      396 |        9,450 |   52,811 |  0.7 |
| `growth_records`         | 407     |      225 |        3,361 |    2,791 |  7.5 |
| `lab_results`            | 549     |       87 |          309 |    3,813 |  2.2 |

### 2.3 Top application queries by total time

| total_seconds | calls | mean_ms | shape (truncated) |
|--------------:|------:|--------:|-------------------|
| 1,563.2 | 1,598 |  978.21 | `SELECT generic_name, dosing_bands, formulations, contraindications, interactions, ... FROM formulary WHERE (generic_name ilike $1 OR generic_name ilike $2 OR ...) AND active` |
|   398.6 | 1,542 |  258.47 | `SELECT icd10, diagnosis_name, snomed_code, first_line_drugs, ... FROM standard_prescriptions WHERE icd10 ilike $1 AND active` |
|   145.8 |   255 |  571.71 | `SELECT generic_name, drug_class, formulations, dosing_bands, ... FROM formulary WHERE (generic_name ilike $1 OR generic_name ilike $2 ...) AND active` |
|    65.4 |    55 | 1188.50 | `SELECT * FROM loinc_investigations WHERE component ilike $1 OR long_name ilike $2 OR related_names ilike $3 ORDER BY common_test_rank` |
|    50.0 |   174 |  287.16 | (formulary multi-OR ilike, full-fields variant) |
|    43.5 |   198 |  219.75 | (standard_prescriptions ICD prefix + active) |
|    43.3 |   291 |  148.92 | (standard_prescriptions ICD prefix + active) |
|    37.9 | 2,520 |   15.05 | `SELECT * FROM patients WHERE id = ANY($1) AND is_active=true` (PK lookup — already fast) |
|    27.6 |   262 |  105.53 | `SELECT snomed_code, snomed_display FROM formulary WHERE generic_name ilike $1` |
|     5.9 |   945 |    6.21 | `SELECT * FROM patients WHERE (name ilike $1 OR id ilike $2 OR contact_phone ilike $3 OR guardian_name ilike $4) AND is_active` |

The `realtime.wal` polling at 4,312 s is an unrelated infrastructure
query — addressed by Fix-3 (turn off Realtime publication) in doc 09.

### 2.4 Extensions

`pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`,
`uuid-ossp` are installed. **`pg_trgm` is NOT installed** — must be
enabled before any trigram index can be created.

---

## 3. Per-table proposals

Order of statements follows lowest-risk first. All sizes are estimates
from row counts × average key length; verify after build with
`pg_size_pretty(pg_relation_size('<index>'))`.

| # | Table                    | Columns               | Rows   | seq_scan | Proposed index                                                          | Size est. | Confidence |
|--:|--------------------------|-----------------------|-------:|---------:|-------------------------------------------------------------------------|-----------|------------|
| 1 | `standard_prescriptions` | `lower(icd10)`        |    503 |    3,473 | btree text_pattern_ops `idx_stdpx_icd10_lower`                          | ~16 kB    | High       |
| 2 | `standard_prescriptions` | `lower(diagnosis_name)` | 503  |    3,473 | btree text_pattern_ops `idx_stdpx_name_lower`                           | ~32 kB    | High       |
| 3 | `formulary`              | `lower(generic_name)` |    680 |    5,869 | btree text_pattern_ops `idx_formulary_generic_name_lower`               | ~80 kB    | High       |
| 4 | `standard_prescriptions` | `lower(diagnosis_name)` | 503  |    3,473 | gin trgm `idx_stdpx_name_trgm`                                          | ~120 kB   | High       |
| 5 | `formulary`              | `lower(generic_name)` |    680 |    5,869 | gin trgm `idx_formulary_generic_name_trgm`                              | ~180 kB   | High       |
| 6 | `patients`               | `lower(name)`         |    570 |    1,844 | gin trgm `idx_patients_name_trgm`                                       | ~80 kB    | High       |
| 7 | `patients`               | `lower(guardian_name)`|    570 |    1,844 | gin trgm `idx_patients_guardian_name_trgm`                              | ~80 kB    | Medium     |
| 8 | `loinc_investigations`   | `lower(component)`    | 77,922 |       93 | gin trgm `idx_loinc_component_trgm`                                     | ~3–5 MB   | Med-High   |
| 9 | `loinc_investigations`   | `lower(long_name)`    | 77,922 |       93 | gin trgm `idx_loinc_long_name_trgm`                                     | ~5–8 MB   | Med-High   |

Total estimated index addition: **~9–14 MB** on a 95 MB database.

The lowercased / `text_pattern_ops` btrees handle left-anchored
`generic_name ILIKE 'amox%'`-style queries (the dominant Edge-Function
shape). The trigram GINs handle non-anchored `%cold%` searches the
prescription pad sends. Both are needed because PostgreSQL will
choose whichever the planner finds cheaper for a given pattern.

---

## 4. Why each index is safe

- **Additive.** No row data is changed; existing indexes are not
  modified or dropped by this migration.
- **CONCURRENTLY.** Every `CREATE INDEX` uses `CONCURRENTLY` so writes
  to the underlying table are not blocked. Reads are also unaffected
  during the build.
- **Independently revertible.** Each index can be removed with a
  single `DROP INDEX CONCURRENTLY` without touching the others.
- **Idempotent.** `IF NOT EXISTS` guards each statement so a partial
  re-run is safe.
- **No transaction wrapper.** CONCURRENTLY indexes cannot run inside
  an explicit transaction — the migration file does not wrap them.
- **One statement at a time.** The reviewer (orchestrator) is
  expected to apply statements individually with a verification query
  between each (§7 below).

---

## 5. Why each index helps

### Statements 1-3 — functional btree on `lower(col) text_pattern_ops`

PostgreSQL's plain btree on a text column does **not** answer `ILIKE`
queries. The planner falls back to a sequential scan. Two ways to fix
this:

1. `text_pattern_ops` btree on the column directly — fixes
   `LIKE 'pattern%'` (case-sensitive, left-anchored).
2. `text_pattern_ops` btree on `lower(col)` — fixes
   `lower(col) LIKE lower($1)` for any case.

PostgREST translates `column.ilike.pat` into `column ILIKE $1`, which
PostgreSQL rewrites internally as `lower(column) LIKE lower($1)` only
if a matching expression index exists. The functional index in
statements 1-3 makes that rewrite efficient and is **the single
cheapest win** in this proposal — sub-millisecond build, ~16-80 kB
each, immediately picked up by the planner after `ANALYZE`.

### Statements 4-9 — GIN trigram indexes (`gin_trgm_ops`)

For non-anchored `ILIKE '%pattern%'` queries the btree is useless. A
trigram GIN index decomposes each text value into 3-character grams
and indexes the set; any `%pat%` query matches a few grams and
intersects the posting lists. Build is fast on these small tables;
loinc_investigations at 78k rows takes ~5-30 s.

The existing `idx_loinc_search` GIN tsvector index (12 MB) is
**unused for the pad's queries** because the pad sends `ilike`, not
`@@ to_tsquery`. The two new trigram GINs on `component` and
`long_name` close that gap. (We do not propose dropping
`idx_loinc_search` yet — its `idx_scan` count is non-zero and it may
serve a different consumer.)

---

## 6. Order of application

Apply one statement at a time, off clinic hours, each in its own
`npx supabase db query --linked -f` invocation. The migration file's
header reiterates this.

```
0. CREATE EXTENSION IF NOT EXISTS pg_trgm;          # one-time prereq
1. idx_stdpx_icd10_lower                            # smallest, lowest risk
2. idx_stdpx_name_lower
3. idx_formulary_generic_name_lower
   ANALYZE public.standard_prescriptions;
   ANALYZE public.formulary;
   --- measure: re-run section 8b of diagnose_io.sql, expect Top-10
       formulary/stdpx total_seconds to drop sharply ---
4. idx_stdpx_name_trgm
5. idx_formulary_generic_name_trgm
6. idx_patients_name_trgm
   ANALYZE public.standard_prescriptions;
   ANALYZE public.formulary;
   ANALYZE public.patients;
   --- measure ---
7. idx_patients_guardian_name_trgm                  # only if §7 EXPLAIN
                                                    #   still shows Bitmap-Or
                                                    #   missing guardian path
8. idx_loinc_component_trgm
9. idx_loinc_long_name_trgm
   ANALYZE public.loinc_investigations;
   --- final measure ---
```

Total wall-clock at the database is well under 1 minute including
`ANALYZE`s. The cautious between-step verification is what makes this
"this week, off-hours" rather than a single deploy.

---

## 7. Verification queries (run BEFORE and AFTER each index)

Replace the literal pattern with whatever the user is actually
typing (e.g. `Amox%`, `J18%`, `cold%`). The `BUFFERS` clause is what
matters — fewer `shared hit` buffers after = fewer IO budget points
spent. Capture both the plan node (`Index Scan` vs `Seq Scan`) and
the buffer count.

### 7.1 formulary generic-name search (top burner)

```
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT generic_name, dosing_bands, formulations
  FROM public.formulary
 WHERE generic_name ILIKE 'Amox%'
   AND active = true
 LIMIT 50;
```

Before: expect `Seq Scan on formulary` with `Buffers: shared hit=~150`.
After idx_formulary_generic_name_lower: expect `Index Scan` and
`Buffers: shared hit < 10`.

### 7.2 formulary fuzzy search

```
EXPLAIN (ANALYZE, BUFFERS)
SELECT generic_name FROM public.formulary
 WHERE generic_name ILIKE '%cef%' AND active = true LIMIT 20;
```

After idx_formulary_generic_name_trgm: expect `Bitmap Index Scan on
idx_formulary_generic_name_trgm`.

### 7.3 standard_prescriptions ICD-10 prefix

```
EXPLAIN (ANALYZE, BUFFERS)
SELECT icd10, diagnosis_name FROM public.standard_prescriptions
 WHERE icd10 ILIKE 'J18%' AND active = true LIMIT 20;
```

### 7.4 standard_prescriptions name fuzzy

```
EXPLAIN (ANALYZE, BUFFERS)
SELECT diagnosis_name FROM public.standard_prescriptions
 WHERE diagnosis_name ILIKE '%pneumonia%' AND active = true LIMIT 20;
```

### 7.5 patients combo search

```
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name FROM public.patients
 WHERE (name ILIKE '%arjun%' OR guardian_name ILIKE '%arjun%')
   AND is_active = true
 ORDER BY name
 LIMIT 50;
```

After idx_patients_name_trgm (and #7 if added): expect `BitmapOr` over
two trigram bitmaps.

### 7.6 loinc_investigations component

```
EXPLAIN (ANALYZE, BUFFERS)
SELECT loinc_code, component, long_name
  FROM public.loinc_investigations
 WHERE (component ILIKE '%glucose%' OR long_name ILIKE '%glucose%')
   AND active = true
 ORDER BY common_test_rank ASC NULLS LAST
 LIMIT 50;
```

After both loinc trigram indexes: expect `BitmapOr` plus a sort node
on `common_test_rank` — buffers should drop from thousands to tens.

### 7.7 Aggregate verification — re-run the diagnostic

After all indexes are in place, run

```
bash radhakishan_system/scripts/run_diagnose2.sh
```

and compare:

- Section 2 — `formulary`/`standard_prescriptions`/`patients` seq_scan
  counts should grow much more slowly per minute of clinic time than
  before.
- Section 8b — the top formulary multi-OR ilike entry should drop from
  978 ms mean to <10 ms.

---

## 8. Currently-unused indexes (drop separately, later)

From `pg_stat_user_indexes WHERE idx_scan = 0` (excluding PK / UNIQUE):

| index_name                | table                     | size    | reason it's unused |
|---------------------------|---------------------------|---------|--------------------|
| `idx_loinc_component`     | loinc_investigations      | 2,976 kB| superseded by trigram GIN proposed in §3 |
| `idx_formulary_brands`    | formulary                 |   272 kB| brand search not done via `text[] @> ARRAY[]` op |
| `idx_formulary_use`       | formulary                 |   224 kB| therapeutic_use never WHERE-filtered |
| `idx_formulary_snomed`    | formulary (partial)       |    80 kB| FHIR reads SELECT all, no WHERE filter |
| `idx_lab_test`            | lab_results               |    16 kB| lab queries are patient_id-keyed |
| `idx_patients_active`     | patients                  |    16 kB| boolean low-selectivity; planner ignores |
| `idx_vax_due`             | vaccinations              |    16 kB| "due" computed client-side |
| `idx_devscreen_patient`   | developmental_screenings  |    16 kB| shadowed by composite (patient_id, screening_date desc) |
| `idx_abdm_cc_ref`         | abdm_care_contexts        |     8 kB| table empty |
| `idx_abdm_consent_id`     | abdm_consent_artefacts    |     8 kB| duplicates UNIQUE constraint index |
| `idx_abdm_consent_status` | abdm_consent_artefacts    |     8 kB| table empty |

**Recommendation:** keep these in place until the new indexes have
been live for 7+ days and Section 7's verification confirms the new
indexes carry the load. Then `pg_stat_reset()` once and re-check
`idx_scan` counters before dropping. The DROP statements are written
out (commented) at the bottom of `migration_io_indexes.sql`.

We do **not** include `idx_loinc_search` (12 MB GIN tsvector) on the
drop list yet — its `idx_scan` is non-zero in the live snapshot,
suggesting another consumer (possibly the standard_rx page) does use
the tsvector form. Verify before dropping.

---

## 9. Rollback for each index

Each statement is independently revertible. The exact one-liner:

```
DROP INDEX CONCURRENTLY IF EXISTS public.<index_name>;
```

If `CREATE EXTENSION pg_trgm` was run and we later want to remove it,
**all dependent indexes (#4–#9) must be dropped first**:

```
DROP INDEX CONCURRENTLY IF EXISTS public.idx_loinc_long_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_loinc_component_trgm;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_patients_guardian_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_patients_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_formulary_generic_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_stdpx_name_trgm;
DROP EXTENSION pg_trgm;
```

---

## 10. Open questions

1. **Does `idx_loinc_search` actually serve any current code path?** Its
   `idx_scan` is non-zero but I couldn't find an `@@ to_tsquery` call
   site in `web/` or `supabase/functions/`. Worth grepping before any
   DROP decision; if truly unused, the 12 MB reclaim is the largest
   single win in §8.
2. **Is `idx_formulary_snomed` cold because nothing currently filters
   on snomed_code, or because the FHIR generator reads the whole row?**
   If a future ABDM query starts using `WHERE snomed_code = $1`, the
   partial index would matter again — re-evaluate before dropping.
3. **`idx_patients_guardian_name_trgm` — is it worth adding now?**
   Patient lookup at 5.9 s total time is not a top burner. I propose
   it conditionally (#7 in the migration) so the orchestrator can
   skip if step 6 alone reduces the pattern to acceptable.
4. **pg_trgm CREATE rights.** Confirm the role used by
   `npx supabase db query --linked` has `CREATE` on the database. If
   not, enable from Studio → Database → Extensions before running the
   migration.
5. **`text_pattern_ops` vs `varchar_pattern_ops`.** The columns are
   `text`; `text_pattern_ops` is the right operator class.
6. **Statement timeout.** Supabase pooled connections sometimes carry
   a `statement_timeout` short enough to interrupt the loinc trigram
   builds. Run those two from a session with `SET statement_timeout = 0;`
   prepended in the same script file.
7. **Re-run cadence.** I recommend re-running `run_diagnose2.sh`
   immediately after step 3 (functional btrees) and again after step
   6 (patient/formulary trigrams). The two checkpoints let the
   orchestrator stop early if the IO budget recovers without the
   loinc_investigations indexes.

---

_Last reviewed: 2026-04-27. Author: io-indexes worktree, agent A._
