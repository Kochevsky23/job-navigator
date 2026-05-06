# Job Compass — Claude Code Rules

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
3. Generate a **To-Do List** for this session: unfinished tasks from last session + recommendations based on current state.
4. Ask what to work on or continue from last session.

---

## Critical Working Rules

### Frontend / src changes (React, TypeScript, CSS)
1. **Edit files in MAIN project dir** (`/Users/dorkochevsky/job-navigator/src/`)
2. **Immediately rsync to running worktree** so browser reflects changes:
   ```bash
   # Find running worktree path first:
   RUNNING_WT=$(lsof -i :8080 -sTCP:LISTEN | grep node | awk '{print $2}' | xargs -I{} lsof -p {} 2>/dev/null | grep cwd | awk '{print $NF}')
   # Sync src:
   rsync -a --delete /Users/dorkochevsky/job-navigator/src/ $RUNNING_WT/src/
   ```
3. **Commit + push from main dir**: `cd /Users/dorkochevsky/job-navigator && git add ... && git commit && git push origin main`

**Why:** Editing main = single source of truth + always committed. Old strategy (edit worktree → rsync → commit main separately) was error-prone and left main stale.

### Edge function changes
- Always edit + deploy from MAIN dir (worktrees don't have supabase CLI context)
- Deploy: `cd /Users/dorkochevsky/job-navigator && npx supabase functions deploy <name> --project-ref updzignrofsvyoceeddw`
- Commit + push after deploy

### General
- Worktrees live at: `/Users/dorkochevsky/job-navigator/.claude/worktrees/<name>/`
- Find running worktree: `lsof -i :8080 -sTCP:LISTEN | grep node | awk '{print $2}' | xargs -I{} lsof -p {} 2>/dev/null | grep cwd | awk '{print $NF}'`
- GitHub: `https://github.com/Kochevsky23/job-navigator.git`

---

## Project Context

- **Stack**: React + TypeScript + Vite + Tailwind CSS + Supabase (DB + Edge Functions) + Anthropic Claude API
- **Supabase project**: `updzignrofsvyoceeddw` (job-compass-v2, Tokyo)
- **config.toml project_id**: `cpcqgzzntbxfjnjohttr` (used by `db push --linked`)
- **Deploy function**: `cd /Users/dorkochevsky/job-navigator && npx supabase functions deploy <name> --project-ref updzignrofsvyoceeddw`
- **DB push**: `cd /Users/dorkochevsky/job-navigator && npx supabase db push --linked`
- **Dev server**: `npm run dev` from worktree dir. HMR active — file saves update browser instantly.
- **CRITICAL — edit main, rsync to running worktree**: Edit `src/` in `/Users/dorkochevsky/job-navigator/src/`, then rsync to running worktree so browser updates. See Critical Working Rules above.
- **Memory files**: `/Users/dorkochevsky/.claude/projects/-Users-dorkochevsky-job-navigator/memory/`

### Env Vars (edge functions)
Auto-injected: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
In Supabase Secrets: `CLAUDE_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `SCHEDULED_SCAN_SECRET`
⚠️ Always use `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — `EXTERNAL_SUPABASE_URL` is NOT set.
Optional enrichment keys (add to Supabase Secrets to enable): `EXA_API_KEY` (web search + salary benchmarking in company-research — both use Exa).

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
| `JobDetailPanel.tsx` | Side panel: score, AI tools (CV, cover letter, interview prep, company research), notes, rating. CollapsibleSection component handles all 4 AI tools uniformly. CV shows only when score > 6. |
| `Navbar.tsx` | Top nav |
| `CompanyLogo.tsx` | Logo via Clearbit |

### API Layer (`src/lib/`)
| File | Purpose |
|------|---------|
| `api.ts` | All edge function callers: `runDailyScan`, `syncJobStatuses`, `generateCV`, `generateCoverLetter`, `generateInterviewPrep`, `generateCompanyResearch`, `runMLFeedback` |
| `debug.ts` | Frontend debug logger → `debug_logs` table |
| `supabase-external.ts` | `db` client (external schema) |

### Edge Functions (`supabase/functions/`)
| Function | JWT | Cron | Purpose |
|----------|-----|------|---------|
| `daily-scan` | ❌ | — | Main scan engine: Gmail → extract → score → upsert |
| `scheduled-scan` | ❌ | 7am + 7pm UTC | Cron entry point — invokes daily-scan for all users |
| `generate-cv` | ✅ | — | Tailored CV per job → `jobs.tailored_cv`. Rate limit: 10/hr. UUID-validates jobId. CV capped at 8K chars. |
| `generate-cover-letter` | ✅ | — | Cover letter per job → `jobs.cover_letter`. Rate limit: 10/hr. |
| `interview-prep` | ✅ | — | 10 Q&A pairs per job → `jobs.interview_prep`. Rate limit: 10/hr. |
| `company-research` | ✅ | — | Company brief per job → `jobs.company_research`. Rate limit: 20/hr. Enriched with Exa web search + Exa salary search (optional — skipped if `EXA_API_KEY` absent). |
| `update-job-statuses` | ✅ | Evening only | Gmail status change detection via Claude (claude-haiku-4-5). Uses `CLAUDE_API_KEY`. |
| `ml-feedback` | ✅ | Daily cron | Re-score jobs using user star ratings as ground truth. Computes precision/recall/F1 metrics. Does NOT run inside daily-scan — separate cron. |
| `security-review` | ✅ | Manual | Read-only security & privacy analysis. 12 static architectural checks + runtime DB checks. Returns structured findings JSON. |
| `reanalyze-jobs` | ✅ | — | Re-score all existing jobs with updated profile |
| `skills-gap` | ✅ | Weekly | Weekly Claude/MCP discovery digest: scrapes Smithery registry + awesome-mcp-servers + official MCP servers, asks Claude to pick top tools relevant to Job Compass, emails all users |
| `extract-cv-text` | ✅ | — | Parse CV PDF on upload |
| `gmail-oauth` / `gmail-oauth-start` / `gmail-oauth-callback` | ✅ | — | Gmail OAuth flow |

---

## Daily Scan Flow (`daily-scan/index.ts`)

```
[1] Get Google access token (refresh via GOOGLE_CLIENT_ID/SECRET)
[2] Fetch Gmail emails since last_email_scan_timestamp (7-day max lookback)
    → Pre-filter to job alert senders/labels
    → Cap at 60 emails/run
[3] Load candidate_profile from user_profiles (cached in DB)
[4] Extract jobs from emails via Claude (batches of 5, parallel)
    → Model: claude-sonnet-4-5
    → Returns: company, role, location, linkedin_id, job_link, exp_required
[5] Fetch job descriptions (batches of 10, parallel):
    → LinkedIn guest API: linkedin.com/jobs-guest/jobs/api/jobPosting/{id}
    → Company careers page (CSS selector scrape)
    → Fallback: email_context (snippet from email body) — sets low_confidence=true
[6] Extract experience levels via Claude (batches of 10)
    → Model: claude-haiku-4-5-20251001
    → Returns actual_exp_required + evidence quote per job
[6] Score jobs via Claude (sequential batches of 10)
    → Model: claude-sonnet-4-5
    → Returns: score 0-10, priority, reason
[7] Upsert to jobs table (fingerprint dedup, ignoreDuplicates)
    → low_confidence update in separate pass (tolerates schema cache lag)
    → Update last_email_scan_timestamp
    → Insert scan_run record
    → Send email digest (Resend) with top HIGH priority jobs
```

**Scheduling (pg_cron — exactly 2 jobs):**
| Name | Schedule | Mode |
|------|----------|------|
| Morning scan | 7:00 AM UTC | auto → "scan" |
| Evening scan | 7:00 PM UTC | forced "scan_and_status" + job aging |

**Job aging (evening only):** New→Old after 7 days, Old→Archive after 14 days.

**ML feedback:** `ml-feedback` is called inside `scheduled-scan` automatically (every run, if not called in last 3 days). Also has a standalone cron at 6 AM UTC (`job-navigator-ml-feedback-daily`). Needs ≥3 rated jobs. Treats 4-5★ as positive, 1-2★ as negative, 3★ neutral (skipped). Computes precision/recall/F1.

---

## AI Agents

| # | Name | Model | When | Input → Output |
|---|------|-------|------|----------------|
| 1 | Profile Parser | claude-haiku-4-5 | Once per user (cached) | Raw CV text → structured `candidate_profile` JSON |
| 2 | Job Extractor | claude-sonnet-4-5 | Every scan, batches of 5 | Gmail job alert emails → jobs list |
| 3 | Experience Extractor | claude-haiku-4-5 | Every scan, batches of 10 | Job descriptions → `actual_exp_required` + evidence |
| 4 | Job Scorer | claude-sonnet-4-5 | Every scan, sequential batches of 10 | Descriptions + exp + profile → score, priority, reason |
| 5 | CV Tailor | claude-sonnet-4-6 | On demand (score > 6) | Job + profile + raw CV → tailored CV (ATS plain text) |
| 6 | Cover Letter | claude-sonnet-4-6 | On demand | Job + profile + raw CV → 3-paragraph letter |
| 7 | Interview Prep | claude-sonnet-4-6 | On demand | Job + profile → 10 behavioral/technical Q&A pairs |
| 8 | Company Research | claude-haiku-4-5 | On demand | Company + role + description → company brief |
| 9 | MCP Digest | claude-sonnet-4-20250514 | Weekly cron | Smithery + GitHub MCP lists → top tools ranked for Job Compass → email digest to all users |

**Token optimization:** All Claude calls use prompt caching (`anthropic-beta: prompt-caching-2024-07-31`). Static content (system prompt, profile, scoring rules) marked `cache_control: {type: "ephemeral"}`. Saves ~60-70% on repeated static content within a scan run.

---

## Scoring Logic

Scoring is **fully profile-aware** — rules derive from `candidate_profile.experience_level` per user. Both `daily-scan` and `reanalyze-jobs` call `buildHardRejectionRules(profile)` and `buildFactor2Examples(profile)` which branch on level.

### Hard Rejection Rules (per experience level)

**student / fresh_graduate:**
1. Requires 3+ years → REJECTED
2. Title has Senior/Lead/Principal/Manager(mid+)/Director/Head/VP/Architect/Chief → REJECTED
3. `exp_required` is "Mid-level" → REJECTED
4. Domain completely unrelated to candidate's education/domains → REJECTED

**junior:**
1. Requires 5+ years → REJECTED
2. Title has Director/VP/Head/C-level/Chief → REJECTED
3. Domain completely unrelated → REJECTED

**mid:**
1. Title has VP/C-level/Chief → REJECTED
2. Student-only internship → REJECTED
3. Domain completely unrelated → REJECTED

**senior:**
1. C-level role (CEO/CTO/COO/etc.) unless explicitly targets senior IC/director → REJECTED
2. Student-only/intern-only → REJECTED
3. Domain completely unrelated → REJECTED

### Two-Step Experience Extraction
Email `exp_required` field is **UNRELIABLE** — often "Not specified" even when description is explicit.
- STEP 1: Scan full description for actual experience requirement
- CRITICAL: Use MINIMUM/REQUIRED only — never "preferred"/"advantage"
  - "required: 2+ yrs" + "preferred: 3-5 yrs" → use "2+ years"
  - Range "2-5 years" → use lower bound "2+ years"
- STEP 2: Apply hard rejection rules using extracted level (not email label)

### Factor Weights (0–10 total)
| Factor | Points | Details |
|--------|--------|---------|
| Skills Match | 0–3 | 3=80%+, 2=50-79%, 1=25-49%, 0=<25% |
| **Experience Fit** | **0–5** | **Primary factor (50% of score)** |
| Field Relevance | 0–1 | Domain/education match |
| Location Fit | 0–1 | Within ~40km of candidate city |

**FACTOR 2 scale (all levels — 5=perfect fit, 4=one step away, 3=near fit, 2=unspecified, 1=clear gap, 0=hard reject)**

Per-level scoring guides live in `buildHardRejectionRules()` in both `daily-scan` and `reanalyze-jobs`. Examples:
- student: 5=student/intern, 4=entry/grad, 3=junior, 2=unspecified, 1=1-3yrs, 0=3+yrs/mid
- junior: 5=1-3yr junior, 4=entry(over-qualified ok), 3=mid/junior-mid, 2=unspecified, 1=4-5yrs, 0=5+yrs
- mid: 5=3-5yr mid, 4=junior-mid/"3+ yrs", 3=senior/"5-7yrs", 2=unspecified/over-qualified, 1=8+yrs, 0=student-only
- senior: 5=senior/lead/6+yrs, 4=mid-senior/"5+yrs", 3=mid/"3-5yrs", 2=unspecified, 1=junior/entry, 0=student-only

**Caps (all levels):** Location >40km → FACTOR 4=0 AND cap 7. Student/fresh_graduate: junior/entry-junior role → also cap 7.

### Priority Thresholds
HIGH: 8-10 · MEDIUM: 5-7 · LOW: 2-4 · REJECTED: 0-1

Post-scoring: priority re-derived from score EXCEPT if Claude returned REJECTED (hard rules always preserved).

---

## Database Schema

### `jobs` table
```
id, user_id, created_at
company, role, location, score(0-10), priority(HIGH|MEDIUM|LOW|REJECTED)
reason, exp_required, description, low_confidence(bool, default false)
job_link, linkedin_id, company_domain, fingerprint, alert_date, status
tailored_cv, cover_letter, interview_prep, company_research
notes, user_score(1-5), applied_at
```

**Fingerprint strategy:**
- Has linkedin_id → `linkedin::<id>`
- Has valid URL → `link::<url>`
- Fallback → `meta::<company>__<role>__<location>`

**Status values:** `New | Old | Applied | Interviewing | Offer | Rejected | Archive`

### `scan_runs` table
```
id, user_id, started_at, success, jobs_found, jobs_added, error_text
```

### `user_profiles` table
```
id (= auth.users id), full_name, cv_text, candidate_profile(jsonb)
google_refresh_token, last_email_scan_timestamp
```

### `candidate_profile` JSON structure
```json
{
  "name": "", "experience_level": "student|fresh_graduate|junior|mid|senior",
  "years_of_experience": 0, "skills": [], "education_field": "",
  "degree_level": "", "graduation_year": null, "domains": [],
  "city": "", "languages": [], "job_type": ""
}
```

### `debug_logs` table
```
id, debug_id(8-char), created_at, severity(info|warning|error|critical)
module(frontend|supabase|edge_function|gmail|claude_api|database)
message, file_name, function_name, stack_trace, suggested_fix, raw_details(jsonb), user_id
```

---

## Debug System

Every error gets an 8-char **Debug ID** traceable across frontend, edge functions, and `debug_logs` table.

**View logs:** `/debug` route in the app.

### Add logging — Frontend
```typescript
import { debugLog } from '@/lib/debug';
const debugId = await debugLog({
  severity: 'error',
  module: 'supabase',
  message: 'Profile update failed',
  error: err,
  fileName: 'src/pages/ScanSettings.tsx',
  functionName: 'handleSave',
  rawDetails: { userId: user.id },
});
toast.error(`Save failed [${debugId}]`);
```

### Add logging — Edge Functions
```typescript
import { createDebugLogger } from "../_shared/debug.ts";
const debug = createDebugLogger("my-function", supabase, userId);
const debugId = await debug.error("Gmail token expired", err, { emailCount: 5 });
return new Response(JSON.stringify({ error: "...", debugId }), { status: 500 });
```

**Sensitive keys auto-redacted:** `api_key`, `token`, `refresh_token`, `secret`, `password`, `cv_text`, `email_body`

---

## Key Bug Fixes (for historical context)

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| `supabaseUrl is required` in generate-cv | Used `EXTERNAL_SUPABASE_URL` (not set) | Changed to `SUPABASE_URL` |
| Wrong candidate_profile fields | `cp.years_experience`, `cp.preferred_locations` | Fixed to `cp.years_of_experience`, `cp.city` |
| Exp extraction picking "preferred" level | No "minimum vs preferred" rules in STEP 1 prompt | Added CRITICAL RULES section |
| Evening cron ran "scan" not "scan_and_status" | Body was `{}`, auto-detect defaulted to "scan" | Migration to send `{"mode": "scan_and_status"}` |
| CV download was .md not PDF | Old `URL.createObjectURL` approach | Replaced with `window.open` + `window.print()` |
| `low_confidence` upsert crash | Column not in PostgREST schema cache | Upsert without column, separate tolerant update pass |
| 0 jobs added every scan | `low_confidence` crash aborted upsert | Fixed by separating upsert payload from flag update |
| Train AI button shown in Dashboard | Removed — redundant, cron handles it automatically | Deleted button + handler |
| `update-job-statuses` auth error: "Could not resolve authentication method" | Used `ANTHROPIC_API_KEY` (not set); secret name is `CLAUDE_API_KEY` | Changed env var reference on line 51 |
| Scoring hardcoded to student/Israel | `buildHardRejectionRules` had no FACTOR 2 guide for junior/mid; senior returned `""`; examples in scoring prompt hardcoded "student →" | Added `buildFactor2Examples(profile)` helper; full FACTOR 2 guides + location caps for all levels in both `daily-scan` and `reanalyze-jobs` |
| CORS wildcard `*` on gen functions (SEC-001) | All functions used `Access-Control-Allow-Origin: *` | New `_shared/cors.ts` — `getCorsHeaders(req)` restricts to `job-navigator.vercel.app` + localhost. Applied to all 4 gen functions. |
| scan_runs error_text leaks env var names (SEC-RT-004) | `error.message` stored raw — could contain `SUPABASE_URL`, key values | `sanitizeErrorText()` added to `daily-scan` — strips `[ENV]`/`[KEY]`/`[TOKEN]`/`[URL]` patterns before storing |
| debug.ts missing sensitive keys (SEC-RT-001) | `google_refresh_token`, `client_secret`, `service_role_key` not in redaction list | Added 7 more keys to `SENSITIVE_KEYS` in `_shared/debug.ts` |
| /debug shows all users' logs (SEC-009) | No `user_id` filter in query | Added `eq('user_id', user.id)` filter in `DebugDashboard.tsx` |
| Company research based on Claude knowledge only | No real-time data | Exa Search (recent news) + Brave Search (salary data) added to `company-research`; both optional, graceful fallback |
