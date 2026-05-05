# Job Navigator — AI Agents & Features

## AI Agents

| # | Name | Model | Triggered | Input | Output |
|---|------|-------|-----------|-------|--------|
| 1 | Profile Parser | Haiku 4.5 | Once per user (cached in DB) | Raw CV text | Structured `candidate_profile` JSON |
| 2 | Job Extractor | Sonnet 4.5 | Every scan — parallel batches of 5 emails | Gmail job alert emails | List of jobs: company, role, location, linkedin_id, exp label |
| 3 | Experience Extractor | Haiku 4.5 | Every scan & re-score — batches of 10 | Job descriptions + email exp label | `actual_exp_required` + evidence quote per job |
| 4 | Job Scorer | Sonnet 4.5 | Every scan & re-score — sequential batches of 10 | Descriptions + pre-extracted exp level + candidate profile | score (0–10), priority, reason (6–8 sentences) |
| 5 | CV Tailor | Sonnet 4.6 | On demand (user clicks "Generate CV") | Job description + candidate profile + raw CV | Full tailored CV (ATS-optimized plain text) |
| 6 | Cover Letter Writer | Sonnet 4.6 | On demand (user clicks "Generate Cover Letter") | Job description + candidate profile + raw CV | 3-paragraph professional cover letter |
| 7 | Interview Prep | Sonnet 4.6 | On demand (user clicks "Interview Prep") | Job description + candidate profile | 10 Q&A pairs: behavioral, technical, company-specific |
| 8 | Company Research | Haiku 4.5 | On demand (user clicks "Company Research") | Company name + role + job description | Company brief: size, industry, culture, pros/cons |
| 9 | Skills Gap Analyzer | Sonnet 4.5 | On demand (from Settings) | Candidate profile + last 50 job descriptions | Ranked list of missing skills with frequency |

---

## Features

### Automatic (cron-triggered)

| Feature | Schedule | Function | What it does |
|---------|----------|----------|--------------|
| Morning Scan | 7:00 AM UTC | `scheduled-scan` → `daily-scan` | Scans Gmail for new job alerts, scores them, sends email digest |
| Evening Scan | 7:00 PM UTC | `scheduled-scan` → `daily-scan` + `update-job-statuses` | Same as morning + detects application status changes from Gmail + sends follow-up reminders for Applied jobs > 7 days |
| Job Aging | Evening scan only | `daily-scan` | New → Old after 7 days, Old → Archive after 14 days |

### On-Demand (user-triggered)

| Feature | Trigger | Function | What it does |
|---------|---------|----------|--------------|
| Manual Scan | "Scan Now" button | `daily-scan` | Same as morning scan, runs immediately |
| Re-score All Jobs | Settings button | `reanalyze-jobs` | Re-scores all jobs with current profile + scoring weights. Processes 20 jobs per HTTP call. |
| Generate CV | Job detail panel (score > 6) | `generate-cv` | Tailors CV for specific job, saves to `jobs.tailored_cv` |
| Generate Cover Letter | Job detail panel (score > 6) | `generate-cover-letter` | Writes cover letter for specific job, saves to `jobs.cover_letter` |
| Interview Prep | Job detail panel (Applied jobs) | `interview-prep` | Generates 10 interview Q&A pairs, saves to `jobs.interview_prep` |
| Company Research | Job detail panel | `company-research` | Generates company brief, saves to `jobs.company_research` |
| Skills Gap Report | Settings page | `skills-gap` | Analyzes which required skills appear most in jobs the user doesn't match on |

---

## Scoring Logic

### Hard Rejection Rules (student/fresh_graduate)
- Job title contains Senior / Lead / Principal / Director / Head / VP / Architect / Chief → score = 0, REJECTED
- Requires 3+ years experience → REJECTED (but other factors still scored)
- exp_required is "Mid-level" → REJECTED
- Domain completely unrelated to candidate (legal, medical, civil engineering) → score 0-1, REJECTED

### Factor Weights (0–10 total)
| Factor | Points | Notes |
|--------|--------|-------|
| Skills Match | 0–3 | 80%+ = 3, 50-79% = 2, 25-49% = 1 |
| **Experience Level Fit** | **0–5** | **Primary factor — 50% of score** |
| Field Relevance | 0–1 | Domain/education match |
| Location Fit | 0–1 | Within ~40km of candidate city |

### Priority Thresholds
- HIGH: 8–10
- MEDIUM: 5–7
- LOW: 2–4
- REJECTED: 0–1 (or hard-rejected by rules above)

---

## Token Optimization

All Claude API calls use **prompt caching** (`anthropic-beta: prompt-caching-2024-07-31`):
- Static content (system instructions, candidate profile, scoring rules) is marked with `cache_control: {type: "ephemeral"}`
- Variable content (job lists) is sent fresh each call
- Savings: ~60–70% token reduction on repeated static content within a scan run

---

## Edge Function Registry

| Function | JWT | Caller | Notes |
|----------|-----|--------|-------|
| `daily-scan` | ❌ (disabled) | Frontend, scheduled-scan | Main scan engine |
| `scheduled-scan` | ❌ (disabled) | pg_cron (2x daily) | Cron entry point |
| `generate-cv` | ❌ (disabled) | Frontend | On-demand CV generation |
| `generate-cover-letter` | ❌ (disabled) | Frontend | On-demand cover letter |
| `interview-prep` | ❌ (disabled) | Frontend | On-demand interview prep |
| `company-research` | ❌ (disabled) | Frontend | On-demand company brief |
| `skills-gap` | ✅ (required) | Frontend | User-scoped skills analysis |
| `reanalyze-jobs` | ✅ (required) | Frontend (Settings) | Re-score existing jobs |
| `update-job-statuses` | ✅ (required) | daily-scan (internal) | Gmail status detection |
| `cleanup-duplicates` | ❌ (disabled) | Manual / admin | Deduplication utility |
