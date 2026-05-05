-- Security review results storage
create table if not exists public.security_reviews (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  summary    jsonb not null,
  findings   jsonb not null,
  status     text not null default 'completed',
  source     text not null default 'manual'
);

alter table public.security_reviews enable row level security;

-- Users can only see and insert their own reviews
create policy "Users read own security reviews"
  on public.security_reviews for select
  using (auth.uid() = user_id);

create policy "Users insert own security reviews"
  on public.security_reviews for insert
  with check (auth.uid() = user_id);

-- No update/delete from frontend — reviews are append-only records
