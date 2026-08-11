-- Second rewind. After 20260818 rewound to -7d, four scans advanced the window
-- 2026-08-04 -> 2026-08-07 while reporting "success, 0 jobs": every extraction
-- batch was failing, and the allExtracted.length === 0 branch advanced the
-- timestamp regardless, so the emails were skipped without ever being read.
-- Extraction failures now throw instead (same change as this migration).

update user_profiles
set last_email_scan_timestamp = extract(epoch from (now() - interval '7 days'))::bigint
where id = '61ca8838-c4c2-468c-950d-b19a403477b5';
