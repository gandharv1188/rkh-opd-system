#!/usr/bin/env bash
# Runs each diagnostic section separately so one failure doesn't abort the rest.
# Output: radhakishan_system/scripts/diagnose_io.out.txt

set -u
OUT="radhakishan_system/scripts/diagnose_io.out.txt"
: > "$OUT"

run() {
  local title="$1"; shift
  local sql="$1"; shift
  echo "================================================================"  | tee -a "$OUT"
  echo "  $title"                                                           | tee -a "$OUT"
  echo "================================================================"  | tee -a "$OUT"
  npx --yes supabase db query --linked "$sql" 2>&1 | tee -a "$OUT"
  echo ""                                                                   | tee -a "$OUT"
}

run "1. Database size" \
"SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;"

run "1b. Top 25 tables by total size" \
"SELECT schemaname, relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid))  AS total_size,
  pg_size_pretty(pg_relation_size(relid))        AS heap_size,
  pg_size_pretty(pg_indexes_size(relid))         AS index_size,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid) - pg_indexes_size(relid)) AS toast_size,
  n_live_tup AS live_rows
 FROM pg_stat_user_tables
 WHERE schemaname='public'
 ORDER BY pg_total_relation_size(relid) DESC
 LIMIT 25;"

run "2. Seq scans vs index scans" \
"SELECT relname AS table_name, n_live_tup AS rows, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch,
  CASE WHEN seq_scan + idx_scan > 0 THEN ROUND(100.0 * seq_scan/(seq_scan+idx_scan),1) END AS pct_seq_scans
 FROM pg_stat_user_tables
 WHERE schemaname='public' AND n_live_tup > 50
 ORDER BY seq_tup_read DESC
 LIMIT 25;"

run "3. Existing indexes" \
"SELECT t.relname AS table_name, i.relname AS index_name,
  pg_size_pretty(pg_relation_size(i.oid)) AS index_size,
  ix.indisunique AS is_unique, ix.indisprimary AS is_pk,
  pg_get_indexdef(i.oid) AS definition
 FROM pg_class t
 JOIN pg_index ix ON t.oid=ix.indrelid
 JOIN pg_class i ON i.oid=ix.indexrelid
 JOIN pg_namespace n ON n.oid=t.relnamespace
 WHERE n.nspname='public' AND t.relkind='r'
 ORDER BY t.relname, i.relname;"

run "4. Unused non-unique indexes" \
"SELECT s.relname AS table_name, s.indexrelname AS index_name,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size, s.idx_scan
 FROM pg_stat_user_indexes s
 JOIN pg_index i ON i.indexrelid=s.indexrelid
 WHERE s.schemaname='public' AND s.idx_scan=0 AND NOT i.indisunique AND NOT i.indisprimary
 ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 25;"

run "5. Dead tuples / autovacuum" \
"SELECT relname AS table_name, n_live_tup, n_dead_tup,
  CASE WHEN n_live_tup>0 THEN ROUND(100.0*n_dead_tup/n_live_tup,1) END AS pct_dead,
  last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
 FROM pg_stat_user_tables WHERE schemaname='public'
 ORDER BY n_dead_tup DESC LIMIT 15;"

run "6. Cache hit ratios" \
"SELECT 'index' AS scope,
  ROUND(100.0*SUM(idx_blks_hit)/NULLIF(SUM(idx_blks_hit+idx_blks_read),0),2) AS pct_hit
 FROM pg_statio_user_indexes
 UNION ALL
 SELECT 'heap',
  ROUND(100.0*SUM(heap_blks_hit)/NULLIF(SUM(heap_blks_hit+heap_blks_read),0),2)
 FROM pg_statio_user_tables;"

run "7. Per-table IO" \
"SELECT relname AS table_name, heap_blks_read, heap_blks_hit,
  toast_blks_read, toast_blks_hit, idx_blks_read, idx_blks_hit
 FROM pg_statio_user_tables
 WHERE schemaname='public'
 ORDER BY heap_blks_read + COALESCE(toast_blks_read,0) + idx_blks_read DESC
 LIMIT 15;"

run "8a. pg_stat_statements installed?" \
"SELECT extname, extversion FROM pg_extension WHERE extname='pg_stat_statements';"

run "8b. Top IO queries (if extension present)" \
"SELECT LEFT(query,200) AS query_preview, calls,
  ROUND(total_exec_time::numeric/1000,1) AS total_seconds,
  ROUND(mean_exec_time::numeric,2) AS mean_ms,
  shared_blks_read AS disk_reads, shared_blks_hit AS cache_hits,
  CASE WHEN shared_blks_read+shared_blks_hit>0
   THEN ROUND(100.0*shared_blks_read/(shared_blks_read+shared_blks_hit),2) END AS pct_disk
 FROM pg_stat_statements
 WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
 ORDER BY shared_blks_read DESC LIMIT 20;"

run "9. Long-running queries" \
"SELECT pid, state, NOW()-query_start AS duration, wait_event_type, wait_event, LEFT(query,200) AS query
 FROM pg_stat_activity
 WHERE state != 'idle' AND NOW()-query_start > INTERVAL '30 seconds'
 ORDER BY duration DESC;"

run "10. All public tables" \
"SELECT table_name,
  (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name=t.table_name AND c.table_schema='public') AS column_count
 FROM information_schema.tables t
 WHERE table_schema='public' ORDER BY table_name;"

echo "Done. Output in $OUT"
