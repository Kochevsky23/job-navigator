-- Admin role, chat agent (UC-08), admin-visibility RLS (UC-09)

-- 1. Admin flag on user_profiles
alter table user_profiles add column if not exists is_admin boolean not null default false;

update user_profiles
set is_admin = true
where id = (select id from auth.users where email = 'dorkochevsky15@gmail.com');

-- 2. Chat agent message history
create table if not exists chat_messages (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  job_id      uuid        references jobs(id) on delete cascade,
  role        text        not null check (role in ('user', 'assistant')),
  content     text        not null,
  created_at  timestamptz not null default now()
);

alter table chat_messages enable row level security;

create policy "chat_messages_select_own" on chat_messages
  for select using (auth.uid() = user_id);

create policy "chat_messages_insert_own" on chat_messages
  for insert with check (auth.uid() = user_id);

create index chat_messages_user_created_idx on chat_messages (user_id, created_at);
create index chat_messages_job_idx on chat_messages (job_id) where job_id is not null;

-- 3. Admin-bypass read access for cross-user monitoring (UC-09)
create policy "debug_logs_select_admin" on debug_logs
  for select using (
    exists (select 1 from user_profiles where id = auth.uid() and is_admin)
  );

create policy "scan_runs_select_admin" on public.scan_runs
  for select using (
    exists (select 1 from user_profiles where id = auth.uid() and is_admin)
  );
