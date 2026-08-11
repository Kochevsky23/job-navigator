-- One-time cleanup: applications from ~3 months ago (last status scan) that are
-- still sitting in Applied/Assessment/Interviewing with no response are
-- functionally ghosted. Scoped to the single existing user account.

update jobs
set status = 'Ghosted'
where user_id = '61ca8838-c4c2-468c-950d-b19a403477b5'
  and status in ('Applied', 'Assessment', 'Interviewing');
