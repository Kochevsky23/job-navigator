-- Add columns for new AI-generated features
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cover_letter text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS interview_prep text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_research text;
