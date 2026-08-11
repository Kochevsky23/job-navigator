-- Extend admin-bypass read access to jobs + user_profiles for the admin console's
-- per-user summary (job counts, user list). debug_logs/scan_runs were covered in
-- 20260809_admin_chat_and_status.sql.

create policy "jobs_select_admin" on jobs
  for select using (
    exists (select 1 from user_profiles where id = auth.uid() and is_admin)
  );

create policy "user_profiles_select_admin" on user_profiles
  for select using (
    exists (select 1 from user_profiles p where p.id = auth.uid() and p.is_admin)
  );
