-- One-time cleanup: delete all jobs to start fresh with the new scoring algorithm
DELETE FROM jobs;

-- Also reset scan timestamp so next scan re-processes the full 7-day window
UPDATE user_profiles
SET last_email_scan_timestamp = 0;
