-- Migration: Add missing columns to live Supabase DB
-- Run: npx supabase db query --linked -f radhakishan_system/scripts/migrate_add_columns.sql

ALTER TABLE visits ADD COLUMN IF NOT EXISTS bmi numeric;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS vax_schedule text CHECK (vax_schedule IN ('nhm', 'iap'));
ALTER TABLE visits ADD COLUMN IF NOT EXISTS receipt_no text;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS consultation_fee numeric DEFAULT 0;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS payment_mode text DEFAULT 'cash';
ALTER TABLE visits ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending';
ALTER TABLE visits ADD COLUMN IF NOT EXISTS procedures jsonb;
