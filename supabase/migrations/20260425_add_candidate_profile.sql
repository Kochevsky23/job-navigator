-- Add candidate_profile column to store structured profile derived from CV.
-- Generated once on first scan (or when CV changes) and cached to avoid re-parsing each scan.
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS candidate_profile jsonb DEFAULT NULL;
