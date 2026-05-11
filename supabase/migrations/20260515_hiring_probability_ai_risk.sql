-- Add hiring probability and AI replaceability risk to jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hiring_probability smallint;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ai_risk text;
