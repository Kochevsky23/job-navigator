# Job Compass

Personal job-hunting web app. Scans Gmail job alert emails, scores them against your profile using Claude AI, and surfaces the best matches.

## Stack

React + TypeScript + Vite + Tailwind CSS + Supabase (DB + Edge Functions) + Anthropic Claude API

## What it does

- **Auto-scan**: Runs twice daily (7am + 7pm UTC) via pg_cron — fetches Gmail job alerts, extracts job details, fetches LinkedIn descriptions, scores against your candidate profile
- **Smart scoring**: 0–10 score based on skills match, experience fit, field relevance, and location. Hard-rejects jobs requiring 3+ years or senior titles.
- **AI tools per job**: Generate tailored CV, cover letter, interview prep Q&A, and company research — all on demand
- **Pipeline tracking**: Kanban board for Applied / Interviewing / Offer / Rejected
- **Status sync**: Detects application status changes from Gmail automatically

## Development

```bash
npm install
npm run dev
```

Deploy edge function:
```bash
npx supabase functions deploy <name> --project-ref updzignrofsvyoceeddw
```

Push DB migrations:
```bash
npx supabase db push --linked
```

See `CLAUDE.md` for full codebase map, scoring rules, and working guidelines.
