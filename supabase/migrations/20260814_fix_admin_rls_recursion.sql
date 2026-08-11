-- BUGFIX: the admin-bypass policies added in 20260809/20260811 used
-- "exists (select ... from user_profiles where ... is_admin)" inline in a
-- policy ON user_profiles itself. Checking that row re-invoked user_profiles'
-- own select policies (including this one) -> infinite recursion -> Postgres
-- error 42P17 -> PostgREST 500 on EVERY query against user_profiles (Navbar,
-- Settings, Admin console, all broken).
--
-- Fix: a SECURITY DEFINER helper function. Functions created by migrations
-- are owned by the table owner, which bypasses RLS by default, so the lookup
-- inside the function does not re-trigger any policy.

create or replace function public.is_current_user_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from user_profiles where id = auth.uid()), false);
$$;

drop policy if exists "user_profiles_select_admin" on user_profiles;
drop policy if exists "debug_logs_select_admin" on debug_logs;
drop policy if exists "scan_runs_select_admin" on public.scan_runs;
drop policy if exists "jobs_select_admin" on jobs;

create policy "user_profiles_select_admin" on user_profiles
  for select using (public.is_current_user_admin());

create policy "debug_logs_select_admin" on debug_logs
  for select using (public.is_current_user_admin());

create policy "scan_runs_select_admin" on public.scan_runs
  for select using (public.is_current_user_admin());

create policy "jobs_select_admin" on jobs
  for select using (public.is_current_user_admin());
