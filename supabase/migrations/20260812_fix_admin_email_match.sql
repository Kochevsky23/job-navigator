-- The 20260809 migration set is_admin by joining auth.users.email, which didn't
-- match (0 rows updated) — the account's auth email differs from the profile's
-- displayed email. user_profiles.email is confirmed correct via Settings UI.

update user_profiles
set is_admin = true
where email = 'dorkochevsky15@gmail.com';
