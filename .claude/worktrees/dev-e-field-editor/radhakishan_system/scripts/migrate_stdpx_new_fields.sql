-- Add new clinical fields to standard_prescriptions
ALTER TABLE standard_prescriptions ADD COLUMN IF NOT EXISTS expected_course text;
ALTER TABLE standard_prescriptions ADD COLUMN IF NOT EXISTS key_clinical_points text[];
ALTER TABLE standard_prescriptions ADD COLUMN IF NOT EXISTS severity_assessment jsonb;
ALTER TABLE standard_prescriptions ADD COLUMN IF NOT EXISTS monitoring_parameters jsonb;
