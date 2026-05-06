-- Clean up existing scan_runs records that contain sensitive keywords in error_text
UPDATE scan_runs
SET error_text = regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(error_text,
        '(SUPABASE_[A-Z_]+)', '[ENV]', 'g'),
      '(service_role[^\s]*)', '[KEY]', 'g'),
    '(eyJ[A-Za-z0-9_-]{10,})', '[TOKEN]', 'g'),
  '(https://[^\s]+\.supabase\.co[^\s]*)', '[URL]', 'g')
WHERE error_text IS NOT NULL
  AND (
    error_text ILIKE '%SUPABASE%'
    OR error_text ILIKE '%service_role%'
    OR error_text ILIKE '%secret%'
    OR error_text ILIKE '%eyJ%'
  );

-- Delete debug_logs entries where raw_details or message contains unredacted sensitive values
-- (keeps entries where the word appears only in a key name that was already masked to "[redacted]")
DELETE FROM debug_logs
WHERE (
  (raw_details::text ILIKE '%"token"%' AND raw_details::text NOT ILIKE '%"[redacted]"%')
  OR (raw_details::text ILIKE '%"refresh_token"%' AND raw_details::text NOT ILIKE '%"[redacted]"%')
  OR (raw_details::text ILIKE '%"access_token"%' AND raw_details::text NOT ILIKE '%"[redacted]"%')
  OR (raw_details::text ILIKE '%"cv_text"%' AND raw_details::text NOT ILIKE '%"[redacted]"%')
  OR (raw_details::text ILIKE '%"email_body"%' AND raw_details::text NOT ILIKE '%"[redacted]"%')
);
