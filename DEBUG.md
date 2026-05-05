# Debug Agent — Job Navigator

A structured logging system that captures errors across frontend, edge functions, and Supabase — and surfaces them in a single dashboard.

---

## How it works

Every error gets a **Debug ID** (e.g. `A3F9C12E`) — an 8-character unique identifier you can use to trace the same failure across frontend logs, edge function logs, and the Supabase `debug_logs` table.

### What gets captured automatically

| Source | What's logged |
|--------|--------------|
| Frontend (global) | Unhandled JS exceptions, unhandled promise rejections |
| API calls (`src/lib/api.ts`) | Failed `daily-scan` and `generate-cv` invocations |
| Edge functions | Gmail token failures, Claude API failures, DB insert errors, scan crashes |

### Severity levels

| Level | When it's used |
|-------|---------------|
| `info` | Informational events (rarely stored) |
| `warning` | Non-critical issues — something degraded but didn't fail |
| `error` | A specific operation failed but the app continued |
| `critical` | The whole operation crashed (e.g. entire scan failed) |

### Modules

`frontend` · `supabase` · `edge_function` · `gmail` · `claude_api` · `database`

---

## Using the Debug Dashboard

Navigate to **`/debug`** in the app (or click **Debug** in the navbar).

You'll see:
- A count of total logs, errors, and warnings
- A filterable table with timestamp, severity, module, Debug ID, message, and suggested fix
- Click the **›** arrow to expand a row and see raw details + stack trace

---

## Adding debug logging to your own code

### Frontend (React/TypeScript)

```typescript
import { debugLog } from '@/lib/debug';

try {
  await someOperation();
} catch (err) {
  const debugId = await debugLog({
    severity: 'error',
    module: 'supabase',           // or 'frontend', 'gmail', 'claude_api', 'database'
    message: 'Profile update failed',
    error: err,
    fileName: 'src/pages/ScanSettings.tsx',
    functionName: 'handleSave',
    rawDetails: { userId: user.id }, // sensitive keys are masked automatically
  });
  toast.error(`Save failed [${debugId}]`); // show the ID to the user for tracing
}
```

### Edge Functions (Deno)

```typescript
import { createDebugLogger } from "../_shared/debug.ts";

// Create logger once per request, after you have the supabase client and userId
const debug = createDebugLogger("my-function", supabase, userId);

// Methods: debug.info / debug.warn / debug.error / debug.critical
const debugId = await debug.error("Gmail token expired", err, { emailCount: 5 });

// Include the debugId in error responses so the frontend can display it
return new Response(JSON.stringify({ error: "...", debugId }), { status: 500 });
```

---

## How to read errors

1. Note the **Debug ID** from the dashboard row or the browser console (`[DEBUG:A3F9C12E] [ERROR] [gmail] ...`)
2. Check the **Suggested Fix** — the system maps common error patterns to actionable advice
3. Expand the row to see **raw details** and **stack trace**
4. Search for the same Debug ID in Supabase → Table Editor → `debug_logs` for the full record

---

## How to test it

### Trigger a frontend error

Open the browser console on any page and run:
```javascript
throw new Error("test error from console");
```
Then navigate to `/debug` — you should see an entry with module `frontend` and severity `error`.

### Trigger an API error

Disconnect Gmail in Settings, then run a manual scan from the Dashboard. The scan will fail with a `GMAIL_RECONNECT_REQUIRED` error. Check `/debug` for the entry with module `edge_function` and suggested fix pointing to Settings.

### Test the debug utility directly

```typescript
import { debugLog } from '@/lib/debug';

await debugLog({
  severity: 'warning',
  module: 'frontend',
  message: 'Test warning',
  rawDetails: { test: true },
});
```

---

## Sensitive data protection

The following fields are **never stored** — they are automatically replaced with `[redacted]`:

- `api_key`, `apikey`
- `refresh_token`, `access_token`, `token`
- `secret`, `password`
- `cv_text`, `body`, `email_body`

Stack traces are capped at 2,000 characters. Messages are capped at 1,000 characters. No full email bodies are ever stored.

---

## Database: `debug_logs` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | Primary key |
| `debug_id` | text | 8-char unique ID for cross-system tracing |
| `created_at` | timestamptz | Auto-set |
| `severity` | text | `info` / `warning` / `error` / `critical` |
| `module` | text | Source system |
| `message` | text | Short description (max 1000 chars) |
| `file_name` | text | Source file (optional) |
| `function_name` | text | Source function (optional) |
| `stack_trace` | text | Capped at 2000 chars |
| `suggested_fix` | text | Auto-inferred from error patterns |
| `raw_details` | jsonb | Additional context (sensitive keys masked) |
| `user_id` | uuid | FK to `auth.users` |

RLS is enabled — users can only read and insert their own logs. Edge functions use the service role key, which bypasses RLS.

---

## Disabling or limiting logging in production

### Disable DB storage (log to console only)

In `src/lib/debug.ts`, comment out the `supabase.from('debug_logs').insert(...)` block.

### Log only errors and critical

Wrap the insert with a severity check:
```typescript
if (options.severity === 'error' || options.severity === 'critical') {
  await supabase.from('debug_logs').insert({ ... });
}
```

### Auto-clean old logs

Add a Supabase cron job or scheduled function to delete logs older than 30 days:
```sql
delete from debug_logs where created_at < now() - interval '30 days';
```

### Hide the Debug page from non-dev users

Remove the `{ to: '/debug', label: 'Debug', icon: Bug }` entry from `src/components/Navbar.tsx` and keep the `/debug` route — it will still be accessible by URL but not visible in the nav.
