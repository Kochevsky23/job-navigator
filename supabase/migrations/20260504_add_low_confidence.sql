-- Mark jobs where Claude had low confidence during extraction
-- (missing location, vague title, no experience requirement stated, etc.)
-- Used in the Jobs UI to flag entries that may need manual review.
alter table jobs add column if not exists low_confidence boolean default false;
