-- ============================================================================
-- Migration: 20260502000000_stdrx_trgm_index
-- Created:   2026-05-02
-- Sprint:    2 (decision 6b)
-- Purpose:   GIN trigram index on standard_prescriptions.diagnosis_name to
--            enable similarity matching inside get_standard_rx tool. Replaces
--            the brittle ILIKE-only matching that misses common abbreviations
--            like "AOM" → "Acute Otitis Media".
--
-- Depends:   pg_trgm extension (installed in 20260428002000_pg_trgm.sql)
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_stdpx_name_trgm;
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_stdpx_name_trgm
  ON public.standard_prescriptions
  USING gin (diagnosis_name gin_trgm_ops);

COMMENT ON INDEX public.idx_stdpx_name_trgm IS
  'GIN trigram index for fuzzy diagnosis matching via pg_trgm similarity(). Sprint 2 (2026-05-02, decision 6b).';
