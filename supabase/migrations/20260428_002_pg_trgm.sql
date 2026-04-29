-- ============================================================================
-- Migration: 20260428_002_pg_trgm
-- Created:   2026-04-28
-- Sprint:    1 (preparation for Sprint 2 fuzzy diagnosis match)
-- Decision:  6b (trigram similarity inside get_standard_rx)
-- Purpose:   Install the pg_trgm extension so Sprint 2 can replace the
--            current SQL ILIKE in get_standard_rx with similarity matching.
--            Idempotent: safe to re-run.
--
-- Rollback:
--   DROP EXTENSION IF EXISTS pg_trgm;
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The actual GIN trigram index on standard_prescriptions.diagnosis_name is
-- created in Sprint 2 (migration 20260501_001_stdrx_trgm_index.sql) so the
-- index ships with the code that uses it.
