# Security & Privacy Review Agent-lite

## What it does

Read-only analysis of security and privacy risks across the Job Compass project.

Runs two classes of checks:

1. **Static architectural findings** — Known risks baked into the current design (CORS config, JWT settings, data sent to AI, token storage). Always included regardless of DB state.
2. **Runtime DB findings** — Actual queries against live data (debug_logs for sensitive patterns, jobs with null user_id, scan_runs error messages, env var presence).

Returns structured JSON findings with severity, category, risk explanation, and a specific recommendation. Nothing is changed automatically.

---

## What it does NOT do

- Does not modify any data, config, or settings
- Does not check actual Supabase RLS policy SQL (requires Supabase Studio or SQL editor)
- Does not scan source code files at runtime (edge functions cannot read the filesystem)
- Does not connect to external services or run network requests
- Does not auto-fix any finding (`auto_fix_allowed: false` on every item)
- Does not send any user data (CV, emails, tokens) to Claude or any external API

---

## Why it is read-only

Security tools that auto-remediate can cause outages, lock users out, or silently break functionality. Every finding requires a human decision before action. The agent surfaces the problem and gives a specific recommendation — you decide what to do and when.

---

## How to run

### From the UI
Navigate to **`/security`** in the app → click **Run Security Review**.

Optional: click **Save Results** to persist the findings to the `security_reviews` table for historical comparison.

### Via API (curl)
```bash
curl -X POST https://updzignrofsvyoceeddw.supabase.co/functions/v1/security-review \
  -H "Authorization: Bearer <your-user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"save": false}'
```

To save results to DB: `{"save": true}`

### Deploy the function
```bash
cd /Users/dorkochevsky/job-navigator
npx supabase functions deploy security-review --project-ref updzignrofsvyoceeddw
```

### Push the migration
```bash
npx supabase db push --linked
```

---

## Example output

```json
{
  "success": true,
  "checked_at": "2026-05-05T12:00:00.000Z",
  "checks_performed": {
    "static_architectural": 12,
    "runtime_db": 3,
    "note": "Static findings reflect known architectural patterns. Runtime findings are verified against live DB state."
  },
  "summary": {
    "total_findings": 15,
    "critical": 0,
    "high": 3,
    "medium": 6,
    "low": 3
  },
  "findings": [
    {
      "id": "SEC-001",
      "severity": "HIGH",
      "category": "CORS",
      "area": "All edge functions (corsHeaders)",
      "issue": "All edge functions use Access-Control-Allow-Origin: * (wildcard CORS)",
      "risk": "Any origin can make authenticated requests to your edge functions.",
      "recommendation": "Restrict to your app domain for non-public functions.",
      "auto_fix_allowed": false,
      "verified": false
    }
  ]
}
```

---

## Severity definitions

| Level | Meaning |
|-------|---------|
| CRITICAL | Immediate action required — active vulnerability or confirmed data exposure |
| HIGH | Significant risk that should be addressed soon |
| MEDIUM | Real risk but lower likelihood or impact — fix in next sprint |
| LOW | Best-practice gap — low immediate risk, worth noting |

---

## Checks performed

### Static (architectural — always included)
| ID | Category | What is checked |
|----|----------|----------------|
| SEC-001 | CORS | Wildcard CORS on all edge functions |
| SEC-002 | API Security | verify_jwt=false on user-facing functions |
| SEC-003 | API Security | No rate limiting on any edge function |
| SEC-004 | OAuth | Gmail refresh token stored plaintext in DB |
| SEC-005 | AI Privacy | Full CV text sent to Claude API |
| SEC-006 | AI Privacy | Raw email bodies sent to Claude API |
| SEC-007 | OAuth | Gmail OAuth scope breadth |
| SEC-008 | Input Validation | jobId not UUID-validated before DB query |
| SEC-009 | Logging | /debug route accessible to all authenticated users |
| SEC-010 | Secrets | SCHEDULED_SCAN_SECRET strength |
| SEC-011 | Supabase RLS | RLS policy correctness (requires manual SQL check) |
| SEC-012 | Other | Email digest sent via third-party Resend |

### Runtime (DB-verified)
| ID | What is checked |
|----|----------------|
| SEC-RT-001 | debug_logs entries containing sensitive keywords |
| SEC-RT-002 | jobs rows with null user_id |
| SEC-RT-003 | Error logs with stack traces stored in DB |
| SEC-RT-004 | scan_runs error_text containing sensitive keywords |
| SEC-RT-005 | Required environment variables present |

---

## RLS manual check (required — agent cannot do this automatically)

Run in Supabase SQL editor:
```sql
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;
```

Verify every table has policies filtering by `auth.uid() = user_id`.

---

## Future improvements

1. **Scheduled runs** — Add a weekly cron to auto-run and email findings summary
2. **Diff mode** — Compare current findings against last saved review to show what improved/regressed
3. **RLS introspection** — Query `pg_policies` directly inside the edge function (currently requires service role + careful scoping)
4. **Source code scanning** — Static analysis of edge function source via a separate CI step (not feasible at runtime)
5. **Claude summarization** — Optionally send sanitized finding IDs and categories (no PII) to Claude for prioritization advice
6. **Severity thresholds** — Fail a CI check if any CRITICAL findings exist
