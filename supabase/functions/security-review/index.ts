import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Finding {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: "Supabase RLS" | "OAuth" | "Logging" | "AI Privacy" | "Secrets" | "API Security" | "Input Validation" | "CORS" | "Other";
  area: string;
  issue: string;
  risk: string;
  recommendation: string;
  auto_fix_allowed: false;
  verified: boolean; // true = confirmed via runtime DB check, false = static/architectural
}

// ─── Static findings — known architectural risks ──────────────────────────────
// These are always included regardless of DB state.
// They reflect design decisions made in this project that carry inherent risk.

const STATIC_FINDINGS: Finding[] = [
  {
    id: "SEC-001",
    severity: "HIGH",
    category: "CORS",
    area: "All edge functions (corsHeaders)",
    issue: "All edge functions use Access-Control-Allow-Origin: * (wildcard CORS)",
    risk: "Any origin can make authenticated requests to your edge functions. If a function leaks data or accepts writes, a malicious page could exploit this.",
    recommendation: "Restrict to your app domain (e.g. your Vercel/Netlify URL) for non-public functions. Only keep * for truly public endpoints.",
    auto_fix_allowed: false,
    verified: false,
  },
  {
    id: "SEC-002",
    severity: "HIGH",
    category: "API Security",
    area: "supabase/config.toml — verify_jwt = false",
    issue: "JWT verification is disabled on: daily-scan, scheduled-scan, generate-cv, generate-cover-letter, interview-prep, company-research, cleanup-duplicates",
    risk: "Any caller without a valid token can invoke these functions. They do internal userId checks, but a misconfigured check could expose another user's data.",
    recommendation: "Enable verify_jwt=true for user-facing functions (generate-cv, generate-cover-letter, interview-prep, company-research) and add explicit JWT validation inside. Keep verify_jwt=false only for scheduled-scan (called by pg_cron).",
    auto_fix_allowed: false,
    verified: false,
  },
  {
    id: "SEC-003",
    severity: "HIGH",
    category: "API Security",
    area: "All edge functions",
    issue: "No rate limiting on any edge function",
    risk: "Endpoints can be called unlimited times — especially generate-cv / cover-letter / interview-prep. An attacker with your Supabase anon key could exhaust your Claude API budget or Resend email quota.",
    recommendation: "Add per-user rate limiting using a DB counter or Supabase's built-in rate limiting. At minimum, limit generate-* functions to N calls per user per hour.",
    auto_fix_allowed: false,
    verified: false,
  },
  {
    id: "SEC-004",
    severity: "MEDIUM",
    category: "OAuth",
    area: "user_profiles.google_refresh_token",
    issue: "Gmail OAuth refresh token stored in plaintext in user_profiles table",
    risk: "If the Supabase DB is compromised or RLS is misconfigured, refresh tokens could be extracted and used to read someone's Gmail indefinitely.",
    recommendation: "Consider encrypting refresh tokens at rest using Supabase Vault or a KMS. At minimum, ensure RLS strictly limits access so users can only read their own row.",
    auto_fix_allowed: false,
    verified: false,
  },
  {
    id: "SEC-005",
    severity: "MEDIUM",
    category: "AI Privacy",
    area: "generate-cv, generate-cover-letter, interview-prep",
    issue: "Full raw CV text (cv_text) is sent to Claude API on every generation call",
    risk: "CV contains PII: name, address, phone, employment history. This is sent to Anthropic's API. If Claude API logging is enabled or prompt data is retained, this PII could be stored externally.",
    recommendation: "Review your Anthropic API plan for data retention settings. Consider chunking or summarizing CV text instead of sending the full raw text. Ensure users consent to AI processing of their CV.",
    auto_fix_allowed: false,
    verified: false,
  },
  {
    id: "SEC-006",
    severity: "MEDIUM",
    category: "AI Privacy",
    area: "daily-scan/index.ts — Job Extractor step [4]",
    issue: "Raw Gmail email bodies are sent to Claude API for job extraction",
    risk: "Job alert emails may contain personal information, email addresses, or content the user did not intend to share with an AI. Email bodies are sent to Anthropic's API.",
    recommendation: "Truncate email bodies before sending (already capped? verify the cap). Strip any personal identifiers from email bodies before Claude sees them. Log what is sent for auditability.",
    auto_fix_allowed: false,
    verified: false,
  },
  {
    id: "SEC-007",
    severity: "MEDIUM",
    category: "OAuth",
    area: "gmail-oauth-start/index.ts — Gmail scope",
    issue: "Gmail OAuth scope should be verified to be minimal (gmail.readonly or labels only)",
    risk: "If the scope granted is too broad (e.g. full gmail access), a token leak could expose the entire Gmail account, not just job alert emails.",
    recommendation: "Verify the OAuth scope is limited to gmail.readonly or a label-scoped filter. Document the exact scopes requested in the OAuth flow.",
    auto_fix_allowed: false,
    verified: false,
  },
  {
    id: "SEC-008",
    severity: "MEDIUM",
    category: "Input Validation",
    area: "generate-cv, generate-cover-letter, interview-prep, company-research",
    issue: "jobId parameter is taken from request body without format validation before DB query",
    risk: "While Supabase parameterizes queries (no SQL injection risk), an invalid or forged jobId could query another user's job if user_id ownership check is missing or bypassed.",
    recommendation: "Add UUID format validation on jobId before the DB query. Always include .eq('user_id', userId) in job fetch queries — verify this is present in all generation functions.",
    auto_fix_allowed: false,
    verified: false,
  },
  {
    id: "SEC-009",
    severity: "MEDIUM",
    category: "Logging",
    area: "supabase/functions/_shared/debug.ts",
    issue: "Debug logs are stored in a DB table (debug_logs) visible via the /debug UI route",
    risk: "If the /debug route is accessible to all authenticated users (not just the owner), other users could see error messages, stack traces, and metadata from your app.",
    recommendation: "The /debug route is in the nav and accessible to any authenticated user. Since this is a single-user app this is low risk now, but add an admin check if you ever add multi-user support.",
    auto_fix_allowed: false,
    verified: false,
  },
  {
    id: "SEC-010",
    severity: "LOW",
    category: "Secrets",
    area: "Edge function environment variables",
    issue: "SCHEDULED_SCAN_SECRET is used as a simple shared secret for cron authentication",
    risk: "If the secret is weak, short, or rotated infrequently, it could be brute-forced or leaked. Shared secrets are weaker than asymmetric token-based auth.",
    recommendation: "Ensure SCHEDULED_SCAN_SECRET is at least 32 random characters. Rotate it periodically. Consider IP allowlisting Supabase's cron IP range as an additional layer.",
    auto_fix_allowed: false,
    verified: false,
  },
  {
    id: "SEC-011",
    severity: "LOW",
    category: "Supabase RLS",
    area: "All tables — RLS policies",
    issue: "RLS policy correctness cannot be verified at runtime — manual review required",
    risk: "If any table is missing a policy or has an overly permissive policy, users could read/write each other's data.",
    recommendation: "Run: SELECT tablename, policyname, cmd, qual FROM pg_policies WHERE schemaname='public'; in the Supabase SQL editor. Verify every table has INSERT/SELECT/UPDATE/DELETE policies that filter by auth.uid().",
    auto_fix_allowed: false,
    verified: false,
  },
  {
    id: "SEC-012",
    severity: "LOW",
    category: "Other",
    area: "Resend email digest (daily-scan)",
    issue: "Email digest includes job titles, companies, and scores — sent to user's email via Resend",
    risk: "Email delivery via third-party (Resend) means job application data touches Resend's infrastructure. Resend logs and potentially stores email content.",
    recommendation: "Review Resend's data retention policy. Consider making the digest opt-in. Ensure the Resend API key has minimal permissions (send only).",
    auto_fix_allowed: false,
    verified: false,
  },
];

// ─── Runtime checks — queries the DB for actual evidence ─────────────────────

async function runRuntimeChecks(supabase: ReturnType<typeof createClient>, userId: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Check 1: debug_logs for sensitive data patterns
  const sensitivePatterns = ["token", "refresh_token", "access_token", "password", "secret", "cv_text", "email_body"];
  try {
    const { data: sensitiveLogs } = await supabase
      .from("debug_logs")
      .select("id, message, raw_details, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (sensitiveLogs && sensitiveLogs.length > 0) {
      let sensitiveHitCount = 0;
      for (const log of sensitiveLogs) {
        const raw = JSON.stringify(log.raw_details || {}).toLowerCase();
        const msg = (log.message || "").toLowerCase();
        if (sensitivePatterns.some(p => raw.includes(p) || msg.includes(p))) {
          sensitiveHitCount++;
        }
      }
      if (sensitiveHitCount > 0) {
        findings.push({
          id: "SEC-RT-001",
          severity: "HIGH",
          category: "Logging",
          area: "debug_logs table",
          issue: `${sensitiveHitCount} debug log entries contain potentially sensitive field names (token, secret, cv_text, email_body, or password) in message or raw_details`,
          risk: "Sensitive data in logs can be read by anyone with DB access or who can view the /debug dashboard.",
          recommendation: "Review these log entries in /debug. Ensure the debug logger's sensitive-key redaction list covers all fields. Consider purging old logs with sensitive data.",
          auto_fix_allowed: false,
          verified: true,
        });
      }
    }
  } catch { /* non-critical */ }

  // Check 2: jobs with null user_id (data isolation breach risk)
  try {
    const { count } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .is("user_id", null);

    if ((count ?? 0) > 0) {
      findings.push({
        id: "SEC-RT-002",
        severity: "HIGH",
        category: "Supabase RLS",
        area: "jobs table",
        issue: `${count} job rows have NULL user_id — these are not user-scoped and could be visible to all users if RLS uses auth.uid() = user_id check`,
        risk: "Rows with null user_id bypass RLS policies that filter by user_id, potentially exposing them to all users.",
        recommendation: "Run: DELETE FROM jobs WHERE user_id IS NULL; or assign correct user_id. Then add a DB constraint: ALTER TABLE jobs ALTER COLUMN user_id SET NOT NULL;",
        auto_fix_allowed: false,
        verified: true,
      });
    }
  } catch { /* non-critical */ }

  // Check 3: error messages in debug_logs that expose internal details
  try {
    const { data: errorLogs } = await supabase
      .from("debug_logs")
      .select("message, stack_trace")
      .eq("user_id", userId)
      .in("severity", ["error", "critical"])
      .not("stack_trace", "is", null)
      .limit(50);

    if (errorLogs && errorLogs.length > 5) {
      findings.push({
        id: "SEC-RT-003",
        severity: "LOW",
        category: "Logging",
        area: "debug_logs — error entries with stack traces",
        issue: `${errorLogs.length} error/critical logs contain stack traces stored in the database`,
        risk: "Stack traces can expose internal file paths, function names, and library versions. If the /debug page is ever publicly accessible, this is a data leak vector.",
        recommendation: "Stack traces are valuable for debugging but should be access-controlled. Ensure /debug is behind authentication (it currently is via ProtectedRoute).",
        auto_fix_allowed: false,
        verified: true,
      });
    }
  } catch { /* non-critical */ }

  // Check 4: recent scan_runs — check for error patterns
  try {
    const { data: failedScans } = await supabase
      .from("scan_runs")
      .select("error_text, started_at")
      .eq("user_id", userId)
      .eq("success", false)
      .order("started_at", { ascending: false })
      .limit(10);

    const exposingErrors = (failedScans || []).filter(s =>
      s.error_text && (
        s.error_text.includes("SUPABASE") ||
        s.error_text.includes("key") ||
        s.error_text.includes("token") ||
        s.error_text.includes("secret")
      )
    );
    if (exposingErrors.length > 0) {
      findings.push({
        id: "SEC-RT-004",
        severity: "MEDIUM",
        category: "Logging",
        area: "scan_runs.error_text",
        issue: `${exposingErrors.length} failed scan records contain error messages with sensitive keywords (SUPABASE, key, token, secret)`,
        risk: "Error messages stored in scan_runs may expose internal configuration details that help an attacker understand your infrastructure.",
        recommendation: "Sanitize error messages before storing in scan_runs. Strip environment variable names, key patterns, and internal URLs from error_text.",
        auto_fix_allowed: false,
        verified: true,
      });
    }
  } catch { /* non-critical */ }

  // Check 5: verify env vars presence (not values — just confirms they exist)
  const requiredEnvVars = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CLAUDE_API_KEY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "RESEND_API_KEY",
    "SCHEDULED_SCAN_SECRET",
  ];
  const missingVars = requiredEnvVars.filter(v => !Deno.env.get(v));
  if (missingVars.length > 0) {
    findings.push({
      id: "SEC-RT-005",
      severity: "CRITICAL",
      category: "Secrets",
      area: "Edge function environment variables",
      issue: `Missing required environment variables: ${missingVars.join(", ")}`,
      risk: "Missing env vars will cause runtime crashes that may expose error details. Functions that need these vars will fail silently or throw.",
      recommendation: `Set the missing variables in Supabase Dashboard → Edge Functions → Secrets: ${missingVars.join(", ")}`,
      auto_fix_allowed: false,
      verified: true,
    });
  }

  return findings;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Require JWT — security review must be user-authenticated
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const save = body.save === true; // optionally persist results to DB

    // Run static + runtime checks
    const runtimeFindings = await runRuntimeChecks(supabase, user.id);
    const allFindings = [...STATIC_FINDINGS, ...runtimeFindings];

    const summary = {
      total_findings: allFindings.length,
      critical: allFindings.filter(f => f.severity === "CRITICAL").length,
      high: allFindings.filter(f => f.severity === "HIGH").length,
      medium: allFindings.filter(f => f.severity === "MEDIUM").length,
      low: allFindings.filter(f => f.severity === "LOW").length,
    };

    const result = {
      success: true,
      checked_at: new Date().toISOString(),
      checks_performed: {
        static_architectural: STATIC_FINDINGS.length,
        runtime_db: runtimeFindings.length,
        note: "Static findings reflect known architectural patterns. Runtime findings are verified against live DB state.",
      },
      summary,
      findings: allFindings,
    };

    // Optionally save to security_reviews table
    if (save) {
      await supabase.from("security_reviews").insert({
        user_id: user.id,
        summary,
        findings: allFindings,
        status: "completed",
        source: "manual",
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
