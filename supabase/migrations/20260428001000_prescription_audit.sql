-- ============================================================================
-- Migration: 20260428_001_prescription_audit
-- Created:   2026-04-28
-- Sprint:    1 (Stop the bleeding)
-- Decision:  18 (instrumentation table from doc 15)
-- Purpose:   Capture per-generation telemetry for AI prescription generation.
--            One row per generation attempt (including retries and fallback).
--            Foundation for: omission/addition rate dashboards, NABH audit
--            trail, prompt-iteration metrics.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.prescription_audit;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.prescription_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id text REFERENCES public.prescriptions(id) ON DELETE SET NULL,
  visit_id        uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  patient_id      text,                                      -- masked in logs; full value here for analytics
  attempt_number  smallint NOT NULL DEFAULT 1,               -- 1 = first attempt, 2 = auto-retry
  meta_mode       text NOT NULL,                             -- 'tool-use' | 'fallback-single-shot'
  stop_reason     text,                                      -- 'end_turn' | 'max_tokens' | 'tool_use' | etc.
  input_tokens    integer,
  output_tokens   integer,
  rounds          smallint,                                  -- tool-use loop rounds consumed
  tools_called    text[],                                    -- e.g. {get_formulary, get_standard_rx}
  requested_meds  text[],                                    -- AI-extracted from doctor's note
  emitted_meds    text[],                                    -- drugs in final medicines[] array
  omitted_meds    jsonb,                                     -- [{name, reason}, ...]
  added_meds      text[],                                    -- emitted but NOT in requested_meds (Std Rx ON only)
  severity_server text,                                      -- 'high' | 'moderate' | 'low'
  severity_ai     text,                                      -- 'high' | 'moderate' | 'low'
  severity_final  text,                                      -- max(server, ai)
  verifier_flags  jsonb,                                     -- reserved for Sprint 4 verifier; null until then
  warnings        text[],                                    -- e.g. {'completeness_mismatch', 'devanagari_missing'}
  duration_ms     integer,                                   -- end-to-end Edge Function duration
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescription_audit_prescription_id
  ON public.prescription_audit (prescription_id);

CREATE INDEX IF NOT EXISTS idx_prescription_audit_visit_id
  ON public.prescription_audit (visit_id);

CREATE INDEX IF NOT EXISTS idx_prescription_audit_created_at
  ON public.prescription_audit (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prescription_audit_meta_mode
  ON public.prescription_audit (meta_mode);

-- RLS: same anon_full_access policy as the rest of the schema for now (Sprint 1 scope).
-- Per-role RLS arrives in Sprint 4 (decision 22 Phase B).
ALTER TABLE public.prescription_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY prescription_audit_anon_full_access
  ON public.prescription_audit
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.prescription_audit IS
  'Per-generation telemetry for AI prescription generation. One row per attempt. Created 2026-04-28 (Sprint 1, decision 18).';
