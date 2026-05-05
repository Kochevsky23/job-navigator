-- Add a second daily scan at 7 PM UTC (in addition to existing 7 AM UTC scan)
-- This keeps each scan smaller (~12 hours of emails instead of 24) and reduces timeout risk

SELECT cron.schedule(
  'job-navigator-evening-scan',
  '0 19 * * *',
  $$
  SELECT net.http_post(
    url := 'https://updzignrofsvyoceeddw.supabase.co/functions/v1/scheduled-scan',
    headers := '{"Content-Type": "application/json", "x-scheduled-secret": "b7873220-e44e-4e42-a82c-87ff8f4a91cf"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);
