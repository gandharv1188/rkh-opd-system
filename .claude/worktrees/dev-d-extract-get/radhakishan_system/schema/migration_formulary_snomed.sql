-- ============================================================
-- MIGRATION: Add SNOMED code + data source tagging to formulary
-- Run via: npx supabase db query --linked -f radhakishan_system/schema/migration_formulary_snomed.sql
-- ============================================================

-- 1. Add snomed_code column (SNOMED CT concept ID for the generic drug)
ALTER TABLE formulary ADD COLUMN IF NOT EXISTS snomed_code text;

-- 2. Add data_source enum tag
--    snomed_branded = has SNOMED code + branded children with full formulation data
--    snomed_generic = has SNOMED code but no branded children in India extension
--    orphan         = no SNOMED code (rare biologics, OTC supplements, etc.)
--    manual         = manually added entry (not from SNOMED extraction)
ALTER TABLE formulary ADD COLUMN IF NOT EXISTS data_source text
  DEFAULT 'manual'
  CHECK (data_source IN ('snomed_branded', 'snomed_generic', 'orphan', 'manual'));

-- 3. Index for efficient filtering by data source and snomed_code
CREATE INDEX IF NOT EXISTS idx_formulary_snomed ON formulary(snomed_code) WHERE snomed_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_formulary_datasource ON formulary(data_source);

-- 4. Update schema comment for formulations JSONB
-- The formulations column now stores ABDM FHIR-aligned structure:
-- {
--   form, form_snomed_code, route,
--   ingredients: [{name, snomed_code, is_active, is_primary,
--                  strength_numerator, strength_numerator_unit,
--                  strength_denominator, strength_denominator_unit}],
--   indian_brands: [{name, manufacturer, snomed_code, verified_on}],
--   indian_conc_note, display_name
-- }
COMMENT ON COLUMN formulary.formulations IS 'ABDM FHIR R4 aligned: ingredients[] with strength numerator/denominator, indian_brands[] with SNOMED codes';
COMMENT ON COLUMN formulary.snomed_code IS 'SNOMED CT concept ID for the generic (Clinical Drug) concept';
COMMENT ON COLUMN formulary.data_source IS 'Data provenance: snomed_branded, snomed_generic, orphan, manual';
