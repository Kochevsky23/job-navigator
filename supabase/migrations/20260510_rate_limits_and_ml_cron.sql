-- Per-user, per-function call rate tracking
create table if not exists public.rate_limits (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  function_name text not null,
  called_at   timestamptz default now() not null
);

create index if not exists rate_limits_lookup
  on public.rate_limits (user_id, function_name, called_at);

alter table public.rate_limits enable row level security;

-- Edge functions use service role (bypasses RLS). Users cannot read/write this table directly.
create policy "No direct user access to rate_limits"
  on public.rate_limits for all
  using (false);

-- Auto-clean calls older than 24 hours to keep the table small
-- (Runs as part of the evening scan via pg_cron; pg_cron must already be enabled.)
select cron.schedule(
  'cleanup-rate-limits-daily',
  '0 3 * * *',  -- 3 AM UTC daily
  $$delete from public.rate_limits where called_at < now() - interval '24 hours'$$
);

-- Daily ml-feedback cron (runs at 6 AM UTC, separate from the scan crons)
-- ml-feedback re-scores jobs based on user ratings. Requires at least 3 rated jobs.
select cron.schedule(
  'job-navigator-ml-feedback-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://updzignrofsvyoceeddw.supabase.co/functions/v1/ml-feedback',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer b7873220-e44e-4e42-a82c-87ff8f4a91cf"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);
