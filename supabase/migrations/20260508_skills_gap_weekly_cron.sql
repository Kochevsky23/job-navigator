-- Weekly Claude skills discovery: runs every Sunday at 8 AM UTC
-- skills-gap fetches Smithery registry + GitHub MCP lists + web search,
-- evaluates against Job Navigator, and emails findings via Resend.

SELECT cron.schedule(
  'job-navigator-skills-gap-weekly',
  '0 8 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://updzignrofsvyoceeddw.supabase.co/functions/v1/skills-gap',
    headers := '{"Content-Type": "application/json", "x-scheduled-secret": "b7873220-e44e-4e42-a82c-87ff8f4a91cf"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);
