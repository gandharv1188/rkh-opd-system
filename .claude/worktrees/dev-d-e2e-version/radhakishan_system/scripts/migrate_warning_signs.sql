-- Add warning_signs column to standard_prescriptions table
ALTER TABLE standard_prescriptions ADD COLUMN IF NOT EXISTS warning_signs jsonb;
