# Job Compass — Claude Code Rules

## Caveman Mode (ALWAYS ACTIVE)

Respond in caveman mode (full intensity) every response in every chat. Drop articles, filler, pleasantries. Fragments OK. Technical precision stays. Code blocks unchanged.

Off only when user says "stop caveman" or "normal mode".

Reference: `/Users/dorkochevsky/job-navigator/.claude/skills/caveman/SKILL.md`

---

## Multi-User First (ALWAYS ACTIVE)

**Every feature, fix, and change must work for ALL users — not just the current single user.**

Rules:
- Never hardcode user IDs, emails, city names, or experience levels
- All DB queries must filter by `user_id` (RLS + explicit `.eq("user_id", userId)`)
- All scoring logic derives from `candidate_profile` per user (no hardcoded assumptions)
- All secrets/tokens stored per-user (e.g. `vault_token_id` in `user_profiles`, not a global env var)
- Cron jobs iterate all users via `user_profiles` table
- Edge functions always resolve `userId` from JWT or service-role body param — never assume single user

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
| `Dashboard.tsx` | Main dashboard — scan button, sync statuses, stats, analytics, best matches, health cards |
| `Jobs.tsx` | Full job list with filters, sort, status update |
| `Pipeline.tsx` | Kanban board by status (includes Assessment + Ghosted columns) |
| `ScanSettings.tsx` | User profile, skills, CV text, email whitelist, Gmail connect |
| `DebugDashboard.tsx` | Debug log viewer (`/debug` route) |
| `Onboarding.tsx` | First-run setup wizard |
| `GmailCallback.tsx` | OAuth callback handler |
| `SecurityReview.tsx` | Security audit results viewer (`/security` route) |

### Key Components (`src/components/`)
| File | Purpose |
|------|---------|
| `JobDetailPanel.tsx` | Side panel: score, Interview Shot bar, AI Risk chip, next_action banner, AI tools (CV, cover letter, interview prep, company research), notes, rating |
| `Navbar.tsx` | Top nav |
| `CompanyLogo.tsx` | Logo via Clearbit |
| `ProtectedRoute.tsx` | Auth guard wrapper |

### API Layer (`src/lib/`)
| File | Purpose |
|------|---------|
| `api.ts` | All edge function callers: `runDailyScan`, `syncJobStatuses`, `generateCV`, `generateCoverLetter`, `generateInterviewPrep`, `generateCompanyResearch`, `runMLFeedback`, `exportToSheets` |
| `debug.ts` | Frontend debug logger → `debug_logs` table |
| `supabase-external.ts` | `db` client (external schema) |

### Edge Functions (`supabase/functions/`)
| Function | JWT | Cron | Purpose |
|----------|-----|------|---------|
| `daily-scan` | ❌ | — | Main scan engine: Gmail → extract → score (6 factors) → upsert |
| `scheduled-scan` | ❌ | 7am + 7pm UTC | Cron entry point — invokes daily-scan for all users |
| `generate-cv` | ✅ | — | Tailored CV per job → `jobs.tailored_cv`. Rate limit: 10/hr. UUID-validates jobId. CV capped at 8K chars. |
| `generate-cover-letter` | ✅ | — | Cover letter per job → `jobs.cover_letter`. Rate limit: 10/hr. |
| `interview-prep` | ✅ | — | 10 Q&A pairs per job → `jobs.interview_prep`. Rate limit: 10/hr. |
| `company-research` | ✅ | — | Company brief per job → `jobs.company_research`. Rate limit: 20/hr. Enriched with Exa web search + salary search (optional). |
| `update-job-statuses` | ✅ | Evening only | Gmail status change detection via Claude. Assessment/Ghosted detection. next_action computation. |
| `ml-feedback` | ✅ | Daily cron | Re-score jobs using star ratings. P/R/F1 + MEDIUM recall. Versioned scoring_hints injected into daily-scan. |
| `reanalyze-jobs` | ✅ | — | Re-score all existing jobs with updated profile + 6-factor scoring |
| `security-review` | ✅ | Manual | Read-only security & privacy analysis. Returns structured findings JSON. |
| `skills-gap` | ✅ | Weekly | Weekly MCP discovery digest — Smithery + GitHub → email to all users |
| `extract-cv-text` | ✅ | — | Parse CV PDF on upload |
| `export-to-sheets` | ✅ | — | Export jobs to Google Sheets. Vault-based auth. |
| `gmail-oauth` | ✅ | — | Frontend-invoked OAuth code exchange (used by GmailCallback.tsx) |
| `gmail-oauth-start` | ✅ | — | Initiates OAuth flow → returns Google auth URL |
| `gmail-oauth-callback` | ❌ | — | Server-side OAuth redirect handler → exchanges code, stores token in Vault |

---

## Daily Scan Flow (`daily-scan/index.ts`)

```
[1] Get Google access token (refresh via GOOGLE_CLIENT_ID/SECRET from Vault via vault_token_id)
[2] Fetch Gmail emails since last_email_scan_timestamp (7-day max lookback)
    → Pre-filter to job alert senders/labels
    → Cap at 60 emails/run
[3] Load candidate_profile from user_profiles + scoring_hints from scoring_feedback
[4] Extract jobs from emails via Claude (batches of 5, parallel)
    → Model: claude-sonnet-4-20250514
    → Returns: company, role, location, linkedin_id, job_link, exp_required
[5] Fetch job descriptions (batches of 10, parallel):
    → LinkedIn guest API → up to 8000 chars stored (was 5000)
    → Company careers page (CSS selector scrape) → up to 8000 chars
    → Fallback: email_context → sets low_confidence=true
[6] Extract experience levels via Claude (batches of 10, parallel)
    → Model: claude-haiku-4-5-20251001
    → Input: up to 6000 chars of description (was 4000)
    → Returns actual_exp_required + evidence quote per job
[7] Score jobs via Claude (sequential batches of 10)
    → Model: claude-sonnet-4-20250514
    → 6-factor scoring: Skills(0-2) + Experience(0-4) + Field(0-1) + Location(0-1) + Language(0-1) + JobType(0-1)
    → Returns: score 0-10, priority, hiring_probability, ai_risk, reason (6 sentences)
[8] Upsert to jobs table (fingerprint dedup, ignoreDuplicates)
    → Cross-fingerprint dedup: after linkedin:: upsert, deletes matching meta:: duplicate
    → low_confidence update in separate pass (tolerates schema cache lag)
    → Update last_email_scan_timestamp
    → Insert scan_run record
    → Send email digest (Resend) with top HIGH priority jobs
```

**Scheduling (pg_cron — 4 jobs):**
| Name | Schedule | Mode |
|------|----------|------|
| Morning scan | 7:00 AM UTC | auto → "scan" |
| Evening scan | 7:00 PM UTC | forced "scan_and_status" + job aging |
| ML feedback | 6:00 AM UTC | standalone ml-feedback run |
| MCP digest | Sunday 8:00 AM UTC | skills-gap email |

**Job aging (evening only):** New→Old after 7 days, Old→Archive after 14 days.

**ML feedback:** Auto-triggered by scheduled-scan if >3 days stale. Needs ≥3 rated jobs. 4-5★ = positive, 1-2★ = negative, 3★ neutral (skipped). scoring_hints injected into next daily-scan prompt.

---

## AI Agents

| # | Name | Model | When | Input → Output |
|---|------|-------|------|----------------|
| 1 | Profile Parser | claude-haiku-4-5 | Once per user (cached) | Raw CV text → structured `candidate_profile` JSON |
| 2 | Job Extractor | claude-sonnet-4-20250514 | Every scan, batches of 5 | Gmail job alert emails → jobs list |
| 3 | Experience Extractor | claude-haiku-4-5-20251001 | Every scan, batches of 10 | Job descriptions (6000 chars) → `actual_exp_required` + evidence |
| 4 | Job Scorer | claude-sonnet-4-20250514 | Every scan, sequential batches of 10 | Descriptions + exp + profile → score, priority, hiring_probability, ai_risk, reason |
| 5 | CV Tailor | claude-sonnet-4-6 | On demand (score > 6) | Job + profile + raw CV → tailored CV (ATS plain text) |
| 6 | Cover Letter | claude-sonnet-4-6 | On demand | Job + profile + raw CV → 3-paragraph letter |
| 7 | Interview Prep | claude-sonnet-4-6 | On demand | Job + profile → 10 behavioral/technical Q&A pairs |
| 8 | Company Research | claude-haiku-4-5-20251001 | On demand | Company + role + description → company brief + Exa news + salary |
| 9 | ML Feedback | claude-sonnet-4-20250514 | Daily cron / manual | FP/FN job lists → pattern analysis → scoring_hints |
| 10 | MCP Digest | claude-sonnet-4-20250514 | Weekly cron | Smithery + GitHub MCP lists → top tools → email digest |

**Token optimization:** All Claude calls use prompt caching (`anthropic-beta: prompt-caching-2024-07-31`). Static content marked `cache_control: {type: "ephemeral"}`. Saves ~60-70% on repeated static content within a scan run.

---

## Scoring Logic (UPDATED 2026-05-24 — session 7)

### 6 Factors, 10 pts total

Both `daily-scan` and `reanalyze-jobs` call `buildHardRejectionRules(profile)` and `buildFactor2Examples(profile)` — fully profile-aware, branches on `experience_level`.

### Universal Hard Rejection Rules (ALL levels)
- **U1. Language mismatch**: Job mandates language not in candidate profile → Factor 5=0; if non-negotiable → REJECTED
- **U2. Professional license** (CPA, CFA, Bar exam, PE, PMP, Actuary, Medical) → REJECTED for student/fresh_graduate
- **U3. Active security clearance required** → cap hiring_probability at 2
- **U4. Vague description** (<150 meaningful chars) → cap total score at 5

### Per-Level Hard Rejections

**student / fresh_graduate:**
1. Requires 3+ years → REJECTED (still score other factors, F2=0, cap at 4)
2. Title has Senior/Lead/Principal/Director/Head/VP/Architect/Chief → score=0, REJECTED
3. Title has "Manager" + mid/senior exp → score=0, REJECTED (except PM targeting juniors)
4. `exp_required` = "Mid-level" → REJECTED (F2=0, cap at 4)
5. Description says "no students" / "students not eligible" → score=0, REJECTED
6. Domain completely unrelated to candidate's education/domains → score=0-1, REJECTED

**junior:** Requires 5+yr → REJECTED | Title Director/VP/Head/C-level → REJECTED | Unrelated domain → REJECTED

**mid:** Title VP/C-level/Chief → REJECTED | Student-only internship → REJECTED | Unrelated domain → REJECTED

**senior:** C-level (unless IC/director-targeted) → REJECTED | Student-only → REJECTED | Unrelated domain → REJECTED

### Factor Weights (0–10 total)
| Factor | Points | Details |
|--------|--------|---------|
| Skills Match | 0–2 | 2=70%+, 1=35-69%, 0=<35% of required skills |
| **Experience Fit** | **0–4** | **Primary factor. Per-level scale below.** |
| Field & Domain | 0–1 | Domain/industry/education field match |
| Location Fit | 0–1 | Within ~40km of candidate city |
| **Language Match** | **0–1** | **NEW: all mandatory languages in candidate profile** |
| **Job Type Alignment** | **0–1** | **NEW: role type matches candidate preference** |

### Factor 2 Scale (0–4 pts per level)
- **student**: 4=student/intern explicit, 3=entry/grad, 2=junior, 1=not specified, 0=years required/Mid-level
- **junior**: 4=junior/1-3yr, 3=entry/grad, 2=mid/junior-mid, 1=not specified, 0=4+yr
- **mid**: 4=mid/3-5yr, 3=junior-mid/3+yr, 2=senior/5-7yr or over-qual, 1=not specified, 0=student/8+yr
- **senior**: 4=senior/lead/6+yr, 3=mid-senior/5+yr, 2=mid/3-5yr, 1=not specified, 0=student-only

### Score Caps
- Location >40km → Factor 4=0 AND cap total at 7
- student/fresh_grad targeting junior → cap at 7
- Description <150 chars → cap at 5
- Security clearance required → cap hiring_probability at 2

### Priority Thresholds (updated 2026-05-24)
| Score | Priority |
|-------|----------|
| **7–10** | **HIGH** ← was 8-10 before 2026-05-24 |
| **5–6** | **MEDIUM** ← was 5-7 |
| 2–4 | LOW |
| 0–1 | REJECTED |

Post-scoring: priority re-derived from score EXCEPT if Claude returned REJECTED (hard rules always preserved).

### Hiring Probability (0–10)
8 signals: experience fit, company prestige barrier, junior-friendliness, skills overlap, application accessibility (Easy Apply +1), competition signal (>200 applicants -2), role specificity, certification/clearance barrier (-3).

### AI Risk (Low/Medium/High)
- **High**: data entry, manual reporting, ERP ticketing, basic admin, call center
- **Medium**: non-technical BA, generalist ops, standard BI, coordinator, HR
- **Low**: data engineering, ML/AI, automation, product analytics, SWE, research

### Two-Step Experience Extraction
Email `exp_required` is UNRELIABLE. Haiku agent re-reads full description (6000 chars):
- Use MINIMUM/REQUIRED only — never "preferred"/"nice to have"
- Range "2-5 years" → lower bound "2+ years"
- Hard rejection rules applied on extracted level, not email label

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
hiring_probability(0-10), ai_risk(Low|Medium|High)
next_action(text), next_action_due_at(timestamptz)
```

**Fingerprint strategy** (all lowercase):
- Has linkedin_id → `linkedin::<id>`
- Has valid URL → `link::<url>`
- Fallback → `meta::<company>__<role>__<location>`
- Cross-fp dedup: when linkedin:: inserted, matching meta:: deleted automatically

**Status values:** `New | Old | Applied | Assessment | Interviewing | Offer | Rejected | Ghosted | Archive`

### `scan_runs` table
```
id, user_id, started_at, success, jobs_found, jobs_added, error_text
```

### `user_profiles` table
```
id (= auth.users id), full_name, cv_text, candidate_profile(jsonb)
vault_token_id (uuid → Supabase Vault, source of truth for Gmail token)
google_refresh_token (NULL — migrated to Vault)
last_email_scan_timestamp, linkedin_url
pending_status_changes(jsonb), scoring_feedback(jsonb)
```

### `scoring_feedback` JSON structure (in user_profiles)
```json
{
  "last_updated": "",
  "labeled_count": 0,
  "metrics": { "precision": 0, "recall": 0, "f1": 0, "accuracy": 0, "mediumRecall": 0, "TP": 0, "FP": 0, "TN": 0, "FN": 0 },
  "insights": "",
  "scoring_hints": "CALIBRATION FROM USER FEEDBACK..."
}
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

**View logs:** `/debug` route in the app. Filtered by `user_id` (secure).

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

**Sensitive keys auto-redacted:** `api_key`, `token`, `refresh_token`, `secret`, `password`, `cv_text`, `email_body`, `google_refresh_token`, `client_secret`, `service_role_key`

---

## Key Bug Fixes (historical context)

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Qualifications cut off in scoring | Description capped at 5000 chars, qualifications at end of page | Raised to 8000 chars fetch + 6000 chars Claude input (session 7) |
| Case duplicates: NICE vs NiCE | Same job in 2 emails — one with linkedin_id (→ linkedin:: fp), one without (→ meta:: fp) | Cross-fp dedup: after linkedin:: upsert, delete matching meta:: (session 7) |
| Recall 48% — many good MEDIUM jobs missed | HIGH threshold ≥8 too strict; 34 score-7 jobs user liked were MEDIUM | Lowered HIGH to ≥7, MEDIUM to 5-6 (session 7) |
| ml-feedback stale threshold + weak model | "HIGH=8+" reference + Haiku model | Fixed to "HIGH=7-10" + Sonnet model (session 7) |
| `supabaseUrl is required` in generate-cv | Used `EXTERNAL_SUPABASE_URL` (not set) | Changed to `SUPABASE_URL` |
| Exp extraction picking "preferred" level | No "minimum vs preferred" rules | Added CRITICAL RULES section |
| Scoring hardcoded to student/Israel | No per-level FACTOR 2 guides | `buildFactor2Examples(profile)` for all levels |
| Evening cron ran "scan" not "scan_and_status" | Body was `{}` | Migration to send `{"mode": "scan_and_status"}` |
| `low_confidence` upsert crash | Column not in PostgREST schema cache | Separate tolerant update pass |
| 0 jobs added every scan | `low_confidence` crash aborted upsert | Fixed by separating upsert payload |
| `update-job-statuses` auth error | Used `ANTHROPIC_API_KEY` (not set) | Changed to `CLAUDE_API_KEY` |
| CORS wildcard `*` on gen functions | All functions used wildcard | `_shared/cors.ts` — origin-restricted to job-navigator.vercel.app |
| scan_runs leaks env var names | `error.message` stored raw | `sanitizeErrorText()` strips sensitive patterns |
| /debug shows all users' logs | No `user_id` filter | Added `.eq('user_id', user.id)` in DebugDashboard |
| scheduled-scan found 0 users | Filtered by `google_refresh_token` (now NULL) | Changed to filter by `vault_token_id` |
| gen functions: no ownership check | Anyone with a jobId UUID could generate | JWT auth + `.eq("user_id", user.id)` on all 4 gen functions |
