-- Near-real-time status sync (KPI #9): run status_only mode every 4 hours,
-- on top of the existing morning "scan" and evening "scan_and_status" runs,
-- now that the scan_and_status/status logic bug is fixed.

SELECT cron.schedule(
  'job-navigator-status-only',
  '0 */4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://updzignrofsvyoceeddw.supabase.co/functions/v1/scheduled-scan',
    headers := '{"Content-Type": "application/json", "x-scheduled-secret": "b7873220-e44e-4e42-a82c-87ff8f4a91cf"}'::jsonb,
    body := '{"mode": "status_only"}'::jsonb
  )
  $$
);
