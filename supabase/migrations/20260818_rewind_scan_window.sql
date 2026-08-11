-- Recover stranded job-alert backlog.
--
-- daily-scan's catch block used to advance last_email_scan_timestamp even when
-- the scan failed (fixed in the same change as this migration). During the
-- Claude API credit outage every run fetched the 20 oldest unprocessed emails,
-- failed, and skipped them permanently — draining ~3 months of alerts unseen.
--
-- Rewind the window 7 days so those alerts are re-fetched. Fingerprint dedup on
-- upsert prevents duplicates for anything already in the jobs table.

update user_profiles
set last_email_scan_timestamp = extract(epoch from (now() - interval '7 days'))::bigint
where id = '61ca8838-c4c2-468c-950d-b19a403477b5';
