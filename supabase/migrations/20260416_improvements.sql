-- Feature 6: user_score for feedback loop (1-5 stars)
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS user_score integer CHECK (user_score >= 1 AND user_score <= 5);

-- Feature 1: scheduled scan setting per user
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS scheduled_scan_enabled boolean DEFAULT false;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS scheduled_scan_hour integer DEFAULT 7 CHECK (scheduled_scan_hour >= 0 AND scheduled_scan_hour <= 23);

-- Enable pg_cron and pg_net for scheduled scans
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule the daily scan at 7 AM UTC every day
-- NOTE: After deploying, update the x-scheduled-secret value with the actual SCHEDULED_SCAN_SECRET
SELECT cron.schedule(
  'job-navigator-daily-scan',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://updzignrofsvyoceeddw.supabase.co/functions/v1/scheduled-scan',
    headers := '{"Content-Type": "application/json", "x-scheduled-secret": "b7873220-e44e-4e42-a82c-87ff8f4a91cf"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);
