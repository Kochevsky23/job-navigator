-- Add last_status_sync_timestamp to user_profiles
-- Tracks when update-job-statuses last ran (Unix seconds), same pattern as last_email_scan_timestamp
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS last_status_sync_timestamp bigint DEFAULT NULL;
