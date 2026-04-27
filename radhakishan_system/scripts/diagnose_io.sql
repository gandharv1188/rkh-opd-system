-- =====================================================================
-- Supabase Disk-IO Diagnostic — read-only
-- =====================================================================
-- Run:  npx supabase db query --linked -f radhakishan_system/scripts/diagnose_io.sql > diagnose_io.out.txt
-- Then paste diagnose_io.out.txt back to Claude.
--
-- Pure SELECT against pg_catalog + pg_stat_* views. No app tables touched.
-- Safe to run during clinic hours.
-- =====================================================================

\echo '================================================================'
\echo '  SECTION 1 — Database size & top tables (incl. TOAST/JSONB)'
\echo '================================================================'
SELECT
  pg_size_pretty(pg_database_size(current_database())) AS database_size;

SELECT
  schemaname,
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid))  AS total_size,
  pg_size_pretty(pg_relation_size(relid))        AS heap_size,
  pg_size_pretty(pg_indexes_size(relid))         AS index_size,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid) - pg_indexes_size(relid)) AS toast_size,
  n_live_tup                                     AS live_rows
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 25;

\echo ''
\echo '================================================================'
\echo '  SECTION 2 — Sequential scans vs index scans (the smoking gun)'
\echo '================================================================'
-- High seq_scan + high seq_tup_read on a big table = missing index.
SELECT
  relname             AS table_name,
  n_live_tup          AS rows,
  seq_scan,
  seq_tup_read,
  idx_scan,
  idx_tup_fetch,
  CASE WHEN seq_scan + idx_scan > 0
       THEN ROUND(100.0 * seq_scan / (seq_scan + idx_scan), 1)
       ELSE NULL
  END AS pct_seq_scans
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND n_live_tup > 50            -- ignore tiny lookup tables
ORDER BY seq_tup_read DESC
LIMIT 25;

\echo ''
\echo '================================================================'
\echo '  SECTION 3 — Existing indexes on public schema'
\echo '================================================================'
SELECT
  t.relname                 AS table_name,
  i.relname                 AS index_name,
  pg_size_pretty(pg_relation_size(i.oid)) AS index_size,
  ix.indisunique            AS is_unique,
  ix.indisprimary           AS is_pk,
  pg_get_indexdef(i.oid)    AS definition
FROM pg_class t
JOIN pg_index ix ON t.oid = ix.indrelid
JOIN pg_class i  ON i.oid = ix.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relkind = 'r'
ORDER BY t.relname, i.relname;

\echo ''
\echo '================================================================'
\echo '  SECTION 4 — Unused indexes (candidates for removal)'
\echo '================================================================'
-- Indexes that have never been used (idx_scan = 0) waste write IO on every insert/update.
SELECT
  s.relname        AS table_name,
  s.indexrelname   AS index_name,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
  s.idx_scan
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.schemaname = 'public'
  AND s.idx_scan = 0
  AND NOT i.indisunique          -- never drop a unique index without thought
  AND NOT i.indisprimary
ORDER BY pg_relation_size(s.indexrelid) DESC
LIMIT 25;

\echo ''
\echo '================================================================'
\echo '  SECTION 5 — Table bloat / dead tuples (autovacuum signal)'
\echo '================================================================'
-- High n_dead_tup and stale last_autovacuum = bloat → extra IO on every read.
SELECT
  relname                 AS table_name,
  n_live_tup              AS live_rows,
  n_dead_tup              AS dead_rows,
  CASE WHEN n_live_tup > 0 THEN ROUND(100.0 * n_dead_tup / n_live_tup, 1) ELSE NULL END AS pct_dead,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC
LIMIT 15;

\echo ''
\echo '================================================================'
\echo '  SECTION 6 — Cache hit ratios (should be > 99% in steady state)'
\echo '================================================================'
SELECT
  'index hit ratio' AS metric,
  ROUND(100.0 * SUM(idx_blks_hit) / NULLIF(SUM(idx_blks_hit + idx_blks_read), 0), 2) AS pct
FROM pg_statio_user_indexes
UNION ALL
SELECT
  'heap hit ratio',
  ROUND(100.0 * SUM(heap_blks_hit) / NULLIF(SUM(heap_blks_hit + heap_blks_read), 0), 2)
FROM pg_statio_user_tables;

\echo ''
\echo '================================================================'
\echo '  SECTION 7 — Per-table heap+toast read IO (the actual disk hits)'
\echo '================================================================'
SELECT
  relname                 AS table_name,
  heap_blks_read          AS heap_disk_reads,
  heap_blks_hit           AS heap_cache_hits,
  toast_blks_read         AS toast_disk_reads,
  toast_blks_hit          AS toast_cache_hits,
  idx_blks_read           AS idx_disk_reads,
  idx_blks_hit            AS idx_cache_hits
FROM pg_statio_user_tables
WHERE schemaname = 'public'
ORDER BY heap_blks_read + COALESCE(toast_blks_read,0) + idx_blks_read DESC
LIMIT 15;

\echo ''
\echo '================================================================'
\echo '  SECTION 8 — pg_stat_statements: top IO-burning queries'
\echo '================================================================'
-- Only works if pg_stat_statements extension is enabled.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
    RAISE NOTICE 'pg_stat_statements not enabled — skipping. Enable in Studio → Database → Extensions for query-level visibility.';
  END IF;
END $$;

SELECT
  LEFT(query, 200)                                AS query_preview,
  calls,
  ROUND(total_exec_time::numeric / 1000, 1)        AS total_seconds,
  ROUND(mean_exec_time::numeric, 2)                AS mean_ms,
  shared_blks_read                                 AS disk_reads,
  shared_blks_hit                                  AS cache_hits,
  CASE WHEN shared_blks_read + shared_blks_hit > 0
       THEN ROUND(100.0 * shared_blks_read / (shared_blks_read + shared_blks_hit), 2)
       ELSE NULL
  END AS pct_disk
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY shared_blks_read DESC
LIMIT 20;

\echo ''
\echo '================================================================'
\echo '  SECTION 9 — Currently-running queries longer than 30s'
\echo '================================================================'
SELECT
  pid,
  state,
  NOW() - query_start AS duration,
  wait_event_type,
  wait_event,
  LEFT(query, 200) AS query
FROM pg_stat_activity
WHERE state != 'idle'
  AND NOW() - query_start > INTERVAL '30 seconds'
ORDER BY duration DESC;

\echo ''
\echo '================================================================'
\echo '  SECTION 10 — Tables in the public schema (for drift check)'
\echo '================================================================'
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
ORDER BY table_name;

\echo ''
\echo '================================================================'
\echo '  Diagnostic complete.'
\echo '================================================================'
