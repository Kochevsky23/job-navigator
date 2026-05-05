-- Fix evening cron: was sending empty body (mode="scan"), must send mode="scan_and_status"
-- so that job aging and status detection actually run in the evening.

SELECT cron.unschedule('job-navigator-evening-scan');

SELECT cron.schedule(
  'job-navigator-evening-scan',
  '0 19 * * *',
  $$
  SELECT net.http_post(
    url := 'https://updzignrofsvyoceeddw.supabase.co/functions/v1/scheduled-scan',
    headers := '{"Content-Type": "application/json", "x-scheduled-secret": "b7873220-e44e-4e42-a82c-87ff8f4a91cf"}'::jsonb,
    body := '{"mode": "scan_and_status"}'::jsonb
  )
  $$
);
