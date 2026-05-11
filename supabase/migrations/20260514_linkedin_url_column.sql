-- Add dedicated linkedin_url column to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS linkedin_url text;
