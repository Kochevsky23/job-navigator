# Job Navigator — Project Context (as of 2026-05-02)

## Who I Am
Student (experience_level: "student") based in **Kfar Saba, Israel**. Building and maintaining my own job-hunting web app to scan LinkedIn for jobs matching my profile. Full-stack: React/TypeScript frontend + Supabase edge functions.

**My candidate profile:**
- experience_level: "student", years_of_experience: 0
- city: "Kfar Saba"
- education_field: "Industrial Engineering and Management"
- domains: data analytics, supply chain, BI
- languages: Hebrew, English

---

## Project Overview

**Job Navigator** — personal job-hunting web app.
**Stack:** React + TypeScript + Vite + Tailwind CSS + Supabase (DB + Edge Functions) + Anthropic Claude API

**Repo:** `/Users/dorkochevsky/job-navigator`
**Supabase project ID:** `cpcqgzzntbxfjnjohttr`

### Key File Paths
- `supabase/functions/daily-scan/index.ts` — daily job scan + scoring (main engine)
- `supabase/functions/reanalyze-jobs/index.ts` — re-score existing jobs from Settings UI
- `supabase/functions/generate-cv/index.ts` — tailored CV generation per job
- `supabase/functions/scheduled-scan/index.ts` — cron entry point, triggers daily-scan for all users
- `supabase/functions/update-job-statuses/index.ts` — detects application status changes from Gmail
- `supabase/functions/cleanup-duplicates/index.ts` — deduplication utility
- `supabase/config.toml` — verify_jwt = false for: daily-scan, scheduled-scan, generate-cv, cleanup-duplicates
- `src/components/JobDetailPanel.tsx` — job detail sheet with CV generation, notes, ratings
- `src/integrations/supabase/types.ts` — DB type definitions

### Deploy Commands
```
cd /Users/dorkochevsky/job-navigator && npx supabase functions deploy daily-scan
cd /Users/dorkochevsky/job-navigator && npx supabase functions deploy reanalyze-jobs
cd /Users/dorkochevsky/job-navigator && npx supabase functions deploy generate-cv
cd /Users/dorkochevsky/job-navigator && npx supabase functions deploy scheduled-scan
```

### Env Vars
- **Auto-injected into all edge functions:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **In Supabase secrets:** `CLAUDE_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `SCHEDULED_SCAN_SECRET`
- ⚠️ ALWAYS use `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — NOT `EXTERNAL_SUPABASE_URL` (not set, will break)

---

## Database Schema (key fields)

### `jobs` table
| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK to user_profiles |
| company | text | |
| role | text | |
| location | text | |
| score | int | 0–10 |
| priority | text | HIGH / MEDIUM / LOW / REJECTED |
| status | text | New / Old / Archive / Applied / Interviewing / Offer |
| reason | text | Claude's 6-8 sentence explanation |
| description | text | Full job description |
| description_source | text | linkedin / careers_page / ai_generated |
| tailored_cv | text | Claude-generated CV (nullable) |
| notes | text | User notes (nullable) |
| user_score | int | User's 1-5 star rating (nullable) |
| applied_at | timestamptz | When user marked applied (nullable) |
| alert_date | timestamptz | When email alert was received |
| linkedin_id | text | LinkedIn job ID |
| job_link | text | Direct link to job (company careers page) |
| company_domain | text | For logo fetching |
| exp_required | text | From email subject (unreliable — see scoring) |

### `user_profiles` table
| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK (matches auth.users) |
| cv_text | text | Raw CV text uploaded by user |
| candidate_profile | jsonb | Structured profile (see below) |
| full_name | text | |
| google_refresh_token | text | Gmail OAuth token |

### `candidate_profile` jsonb structure
```json
{
  "name": "",
  "experience_level": "student|fresh_graduate|junior|mid|senior",
  "years_of_experience": 0,
  "skills": [],
  "education_field": "",
  "degree_level": "",
  "graduation_year": null,
  "domains": [],
  "city": "",
  "languages": [],
  "job_type": ""
}
```

---

## Scoring Logic (CURRENT — updated 2026-05-02)

### Hard Rejection Rules
1. Job explicitly requires 3+ years → score=0, priority=REJECTED
2. Title contains Senior/Lead/Principal/Manager/Director/Head/VP/Architect/Chief → REJECTED
3. exp_required contains "Mid-level", "Mid level", "Mid" → REJECTED
4. Domain far outside candidate's skills (pure finance, legal, medical, civil engineering) → REJECTED

### Two-Step Scoring Process

**STEP 1 — Extract Real Experience Requirement from full job description**
- Email `exp_required` is UNRELIABLE (often "Not specified" even when description is clear)
- Scan ENTIRE description (Qualifications, Requirements, About You sections)
- English patterns: "X years of experience", "entry level", "recent graduate", "junior", "mid-level", "1-2 years", etc.
- Hebrew patterns: "ניסיון של X שנים", "סטודנט", "התמחות", "ללא ניסיון", "בוגר טרי", etc.
- **CRITICAL: Always use MINIMUM/REQUIRED, never "preferred" or "advantage"**
  - "required: 2+ years" AND "preferred: 3-5 years" → use "2+ years"
  - Range "2-5 years" → use lower bound "2+ years"
  - "Requirements"/"Must have" = required; "Nice to have"/"Preferred"/"Advantage" = optional, ignore

**STEP 2 — Apply hard rejection rules using actual_exp_required from STEP 1** (not the email label)

**STEP 3 — Score non-rejected jobs (0–10 total)**

### Factor Weights
| Factor | Points | Description |
|--------|--------|-------------|
| FACTOR 1 — Skills Match | 0–3 pts | 3=80%+ covered, 2=50-79%, 1=25-49%, 0=<25% |
| **FACTOR 2 — Experience Level Fit** | **0–5 pts** | **PRIMARY FACTOR (50% of score)** |
| FACTOR 3 — Field Relevance | 0–1 pt | Domain/education match |
| FACTOR 4 — Location Fit | 0–1 pt | Within ~40km of candidate city |

**FACTOR 2 scoring guide (student candidate):**
- 5 pts: Student/intern role (exact match)
- 4 pts: Entry-level/graduate role
- 3 pts: Junior role (manageable gap)
- 2 pts: Level not stated anywhere — uncertain
- 1 pt: 1-3 years required (clear gap)
- 0 pts: Major mismatch → hard reject

### Score Caps
- Junior/Entry-Junior roles → cap at 7 (MEDIUM max)
- Location >40km from candidate city → FACTOR 4=0 AND cap at 7
- "Not specified" naturally maxes at 7 with new weights (2+3+1+1), no extra cap needed

### Priority Thresholds
- HIGH: 8–10
- MEDIUM: 5–7
- LOW: 2–4
- REJECTED: 0–1

### Post-scoring priority re-derivation
Score → priority recalculated EXCEPT if Claude returned REJECTED (hard rules always preserved).

---

## Edge Functions Detail

### daily-scan
- Entry point for scheduled and manual scans
- Gmail fetch: 7-day lookback, filters by job alert labels/senders
- Deduplication by fingerprint/linkedin_id before insert
- **Description fetching (per job):** LinkedIn guest API → company careers page → Claude AI fallback
  - LinkedIn: `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{linkedin_id}`
  - Careers page: tries common CSS selectors, falls back to full-page strip
  - AI fallback: claude-haiku-4-5-20251001, generates realistic 150-250 word description
  - Descriptions fetched 10 at a time in parallel
- **Scoring:** claude-sonnet-4-20250514, sequential batches of 10
- **Multi-user:** each user's own `candidate_profile` used for scoring
- Sends email digest via Resend (top HIGH priority jobs) after scan
- Deployed ✅

### reanalyze-jobs
- Frontend: Settings page "Re-score All Jobs" button
- Processes 50 jobs per HTTP call (MAX_JOBS_PER_RUN=50), batches of 10 (BATCH_SIZE=10)
- Sequential batches (NOT parallel — prevents Anthropic rate limiting)
- Models: claude-sonnet-4-20250514 for scoring, claude-haiku-4-5-20251001 for profile generation
- Retry: 3 attempts, 3s delay between retries
- Scoped to authenticated user's own jobs
- Deployed ✅

### generate-cv
- Takes `{ jobId }` in request body
- Fetches job + user profile from DB via `job.user_id`
- Uses `cv_text` (raw CV) from `user_profiles`
- Builds tailored CV prompt with: full job description, company, role, experience required, candidate skills/background, `reason` field
- Model: claude-sonnet-4-6, max_tokens: 4096
- Saves result to `jobs.tailored_cv` column
- Error if no CV uploaded: "No CV found. Please upload your CV in Settings first."
- verify_jwt = false
- Deployed ✅

### scheduled-scan
- Cron entry point — called by pg_cron twice daily
- Gets all users with Gmail connected (`google_refresh_token IS NOT NULL`)
- Calls `daily-scan` for each user sequentially
- **Auto-detects mode by UTC hour:** utcHour >= 16 → `scan_and_status`, else → `scan`
- Body param `mode` can override auto-detection
- Returns immediately, scans run in background via `EdgeRuntime.waitUntil()`
- verify_jwt = false

### update-job-statuses
- Called in evening scan only (`scan_and_status` mode)
- Detects application status changes from Gmail (no Claude — no API cost)

---

## Cron Jobs (pg_cron) — CURRENT STATE

**Exactly 2 cron jobs. No backup/duplicate crons.**

| Name | Schedule | Body | Mode |
|------|----------|------|------|
| Morning scan | 7:00 AM UTC | `{}` | auto-detects → "scan" |
| Evening scan | 7:00 PM UTC | `{"mode": "scan_and_status"}` | forced → "scan_and_status" |

Evening cron was fixed via migration `20260501_fix_evening_cron_mode.sql` — was previously sending `{}` which always defaulted to "scan" mode (no status updates or job aging).

### Job Aging (evening scan only)
- New → Old after 7 days
- Old → Archive after 14 days
- Archive runs before Old aging to avoid double-stepping in one run

---

## Frontend Notes (JobDetailPanel.tsx)

- Notes and userScore state synced via `prevJobId` pattern (no broken useState side effects)
- **CV download:** opens formatted HTML in new browser tab, auto-triggers `window.print()` for save-as-PDF. No library needed.
- Generate CV button only shows when: `job.score > 6` AND `job.priority !== 'REJECTED'`
- "Mark as Applied" button hidden once status is Applied/Interviewing/Offer
- User star rating (1-5) saved to `jobs.user_score` — toggles off if same star clicked again

---

## Current State & TODOs (as of 2026-05-02)

### What's done ✅
- All edge functions deployed with latest scoring weights and bug fixes
- 2 pg_cron jobs, clean (morning + evening)
- Evening cron correctly triggers `scan_and_status` mode
- generate-cv fully fixed (correct env vars, correct field names)
- Experience level is now 50% of score (PRIMARY FACTOR — 0-5 pts)
- STEP 1 "minimum vs preferred" critical rules in both daily-scan and reanalyze-jobs
- Dead code removed: `NavLink.tsx`, `rescore-jobs/`, `weekly-summary/`

### TODOs
1. **Run "Re-score All Jobs"** in Settings — apply new weights to existing DB jobs
2. **Verify tonight's evening scan** (7pm UTC) — first time it runs correctly with `scan_and_status` mode
3. **Monitor experience extraction** — verify STEP 1 picks minimum/required level (not preferred/advantage) on next scan

### Watch Points
- pg_net can silently drop HTTP requests. If scan seems to not run, check `cron.job_run_details` and `net._http_response` in DB.
- If user's `cv_text` is empty, generate-cv throws "No CV found. Please upload your CV in Settings first."

---

## Bug Fixes History (for reference)

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| `supabaseUrl is required` in generate-cv | Used `EXTERNAL_SUPABASE_URL` (not set) | Changed to `SUPABASE_URL` (auto-injected) |
| Wrong candidate_profile fields in generate-cv | `cp.years_experience`, `cp.preferred_locations` | Fixed to `cp.years_of_experience`, `cp.city` |
| Experience extraction picking preferred level | STEP 1 prompt had no "minimum vs preferred" rules | Added CRITICAL RULES section to both functions |
| Evening cron always ran in "scan" mode | Body was `{}`, auto-detect defaulted to "scan" | Migration to send `{"mode": "scan_and_status"}` |
| CV download was .md file not PDF | Old implementation used `URL.createObjectURL` | Replaced with `window.open` + `window.print()` |
| Broken useState hook in JobDetailPanel | `useState(() => { if (job) setNotes(...) })` is a no-op | Removed; prevJobId pattern handles state sync |
| pg_net dropped HTTP request silently | pg_net background worker didn't deliver | Added auto-mode detection as resilience; no hard fix possible |
| MAX_JOBS_PER_RUN temporal dead zone | Variable declared after use | Moved declaration to top of function |
| Parallel scoring caused rate limiting | Promise.all() on Claude calls | Changed to sequential for-loop |
