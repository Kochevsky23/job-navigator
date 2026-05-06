-- Add pending_status_changes column for low-confidence status update review
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS pending_status_changes jsonb;
