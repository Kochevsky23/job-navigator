-- Debug logs table for structured error tracking across frontend, edge functions, and database
create table if not exists debug_logs (
  id          uuid        primary key default gen_random_uuid(),
  debug_id    text        not null unique,
  created_at  timestamptz not null default now(),
  severity    text        not null check (severity in ('info', 'warning', 'error', 'critical')),
  module      text        not null check (module in ('frontend', 'supabase', 'edge_function', 'gmail', 'claude_api', 'database')),
  message     text        not null,
  file_name   text,
  function_name text,
  stack_trace text,
  suggested_fix text,
  raw_details jsonb,
  user_id     uuid        references auth.users(id) on delete cascade
);

alter table debug_logs enable row level security;

-- Authenticated users can insert their own logs
create policy "debug_logs_insert_own" on debug_logs
  for insert with check (auth.uid() = user_id);

-- Authenticated users can read their own logs
create policy "debug_logs_select_own" on debug_logs
  for select using (auth.uid() = user_id);

-- Fast retrieval by user + recency
create index debug_logs_user_created_idx on debug_logs (user_id, created_at desc);
-- Fast lookup by debugId for cross-system tracing
create index debug_logs_debug_id_idx on debug_logs (debug_id);
