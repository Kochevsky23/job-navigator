# Job Compass – Claude Code Rules

## Caveman Mode (ALWAYS ACTIVE)

Respond in caveman mode (full intensity) every response in every chat. Drop articles, filler, pleasantries. Fragments OK. Technical precision stays. Code blocks unchanged.

Off only when user says "stop caveman" or "normal mode".

Reference: `/Users/dorkochevsky/job-navigator/.claude/skills/caveman/SKILL.md`

---

## Session Management

### "Session Ended"
When user says "Session Ended":
1. Update ALL memory files in `/Users/dorkochevsky/.claude/projects/-Users-dorkochevsky-job-navigator/memory/` with every important change, new file, deployment, or decision from this session.
2. Write bullet-point summary in chat of everything done.

### "Session Started"
When user says "Session Started":
1. Read all memory files in the path above.
2. Acknowledge current project state.
3. Ask what to work on or continue from last session.

---

## Project Context

- **Stack**: React + TypeScript + Vite + Tailwind CSS + Supabase (DB + Edge Functions) + Anthropic Claude API
- **Supabase project**: `updzignrofsvyoceeddw` (job-compass-v2, Tokyo)
- **Deploy**: `npx supabase functions deploy <name> --project-ref updzignrofsvyoceeddw` (always from `/Users/dorkochevsky/job-navigator/`, never from worktree)
- **DB push**: `npx supabase db push --linked` (config.toml project_id = `cpcqgzzntbxfjnjohttr`)
- **Dev server**: runs from worktree dir. Check active worktree: `lsof -i :8080 -sTCP:LISTEN | grep node` then `lsof -p <PID> | grep cwd`. **Always edit files in the worktree** — HMR updates browser. Do NOT edit main project src files.
- **Worktrees**: `/Users/dorkochevsky/job-navigator/.claude/worktrees/<name>/`
- **Memory files**: `/Users/dorkochevsky/.claude/projects/-Users-dorkochevsky-job-navigator/memory/`
- **GitHub**: `https://github.com/Kochevsky23/job-navigator.git`

---

## Codebase Map

### Pages (`src/pages/`)
| File | Purpose |
|------|---------|
| `Dashboard.tsx` | Main dashboard — scan button, sync statuses, stats, analytics, best matches |
| `Jobs.tsx` | Full job list with filters, sort, status update |
| `Pipeline.tsx` | Kanban board by status |
| `ScanSettings.tsx` | User profile, skills, CV text, email whitelist |
| `DebugDashboard.tsx` | Debug log viewer (`/debug` route) |
| `Onboarding.tsx` | First-run setup wizard |
| `GmailCallback.tsx` | OAuth callback handler |

### Key Components (`src/components/`)
| File | Purpose |
|------|---------|
| `JobDetailPanel.tsx` | Side panel for job details — score, AI tools (CV, cover letter, interview prep, company research), notes, rating |
| `Navbar.tsx` | Top nav |
| `CompanyLogo.tsx` | Logo via Clearbit |

### API Layer (`src/lib/`)
| File | Purpose |
|------|---------|
| `api.ts` | All edge function callers: `runDailyScan`, `syncJobStatuses`, `generateCV`, `generateCoverLetter`, `generateInterviewPrep`, `generateCompanyResearch`, `runMLFeedback` |
| `debug.ts` | Frontend debug logger → `debug_logs` table |
| `supabase-external.ts` | `db` client (external schema) |

### Edge Functions (`supabase/functions/`)
| Function | Trigger | Purpose |
|----------|---------|---------|
| `daily-scan` | Cron (every 2h) + manual | Gmail → extract jobs → score → upsert |
| `scheduled-scan` | Cron wrapper | Invokes daily-scan on schedule |
| `generate-cv` | Manual | Generate tailored CV for a job |
| `generate-cover-letter` | Manual | Generate cover letter |
| `interview-prep` | Manual | Generate interview prep notes |
| `company-research` | Manual | Generate company research |
| `update-job-statuses` | Manual (Sync Statuses btn) | Scan Gmail for status changes (applied/rejected/interview) |
| `ml-feedback` | Cron (daily) | Re-score jobs based on user ratings |
| `gmail-oauth` / `gmail-oauth-start` / `gmail-oauth-callback` | Auth flow | Gmail OAuth |
| `reanalyze-jobs` | Manual | Re-score existing jobs with updated profile |
| `skills-gap` | Cron (weekly) | Identify missing skills |
| `extract-cv-text` | On CV upload | Parse CV PDF |

### Daily Scan Flow (daily-scan/index.ts)
```
[1] Get Google access token
[2] Fetch Gmail emails since last_email_scan_timestamp
[3] Load candidate profile from user_profiles (cached)
[4] Extract jobs from emails via Claude (batched)
[5] Fetch LinkedIn descriptions for each job
[6] Score jobs via Claude (exp extraction + scoring)
[7] Upsert to jobs table (fingerprint dedup), update timestamp, insert scan_run
```

### DB Tables
**`jobs`** — main table
```
id, user_id, created_at, company, role, location, score(0-10), priority(HIGH|MEDIUM|LOW|REJECTED),
reason, exp_required, job_link, linkedin_id, company_domain, fingerprint, alert_date, status,
tailored_cv, cover_letter, interview_prep, company_research, notes, user_score, applied_at,
description, low_confidence
```

**`scan_runs`** — scan history
```
id, user_id, started_at, success, jobs_found, jobs_added, error_text
```

**`user_profiles`** — candidate data
```
id(=user_id), name, city, skills[], experience_level, last_email_scan_timestamp, ...
```

**`debug_logs`** — frontend/edge errors
```
id, created_at, severity, module, message, debug_id, suggested_fix, raw_details
```

### Scoring Logic (see memory/scoring_logic.md for full details)
- Hard reject: 3+ yrs required, Senior/Lead/Manager titles, Mid-level exp
- Score 0–10: Skills(0-3) + Experience fit(0-5) + Field relevance(0-1) + Location(0-1)
- Priority: HIGH=8-10, MEDIUM=5-7, LOW=2-4, REJECTED=0-1
- Show Generate CV button only if `score > 6`

### Fingerprint Strategy
- LinkedIn job: `linkedin::<id>`
- Has valid URL: `link::<url>`
- Fallback: `meta::<company>__<role>__<location>`
