// Shared debug logger for Supabase Edge Functions (Deno runtime)
// Import in edge functions: import { createDebugLogger } from "../_shared/debug.ts";

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type DebugSeverity = "info" | "warning" | "error" | "critical";
export type DebugModule =
  | "frontend"
  | "supabase"
  | "edge_function"
  | "gmail"
  | "claude_api"
  | "database";

const SENSITIVE_KEYS = new Set([
  "api_key", "apikey", "refresh_token", "access_token", "token",
  "secret", "password", "cv_text", "email_body", "body",
  "google_refresh_token", "google_access_token", "client_secret",
  "service_role_key", "anon_key", "authorization", "private_key",
  "email_body_raw", "email_text", "email_html",
]);

const FIX_MAP: Array<[RegExp, string]> = [
  [/GMAIL_RECONNECT_REQUIRED|invalid_grant/i, "Gmail token expired — user needs to reconnect Gmail in Settings"],
  [/gmail/i, "Gmail API error — check OAuth token validity"],
  [/401|unauthorized/i, "Authentication failed — check API keys or session"],
  [/429|rate.?limit/i, "Rate limit hit — implement exponential backoff"],
  [/claude|anthropic/i, "Claude API error — check CLAUDE_API_KEY environment variable"],
  [/json|parse|syntax/i, "Failed to parse API response — check response format"],
  [/duplicate|unique.*violation/i, "Duplicate record — job may already exist in DB"],
  [/timeout/i, "Request timed out — try again or increase timeout"],
  [/resend/i, "Resend email error — check RESEND_API_KEY environment variable"],
];

function inferFix(text: string): string | undefined {
  for (const [pattern, fix] of FIX_MAP) {
    if (pattern.test(text)) return fix;
  }
  return undefined;
}

function maskSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      result[k] = "[redacted]";
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      result[k] = maskSensitive(v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

export interface EdgeDebugLogger {
  info(message: string, details?: Record<string, unknown>): Promise<string>;
  warn(message: string, error?: unknown, details?: Record<string, unknown>): Promise<string>;
  error(message: string, error?: unknown, details?: Record<string, unknown>): Promise<string>;
  critical(message: string, error?: unknown, details?: Record<string, unknown>): Promise<string>;
}

/**
 * Creates a structured logger for an edge function.
 *
 * Usage:
 *   const debug = createDebugLogger("daily-scan", supabase, userId);
 *   const debugId = await debug.error("Gmail fetch failed", err, { emailCount: 5 });
 *   return new Response(JSON.stringify({ error: "...", debugId }), { status: 500 });
 */
export function createDebugLogger(
  functionName: string,
  supabase: SupabaseClient,
  userId?: string,
  module: DebugModule = "edge_function",
): EdgeDebugLogger {
  async function persist(
    severity: DebugSeverity,
    message: string,
    error?: unknown,
    rawDetails?: Record<string, unknown>,
  ): Promise<string> {
    const debugId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const errorText = error instanceof Error ? error.message : String(error ?? "");
    const suggestedFix = inferFix(`${message} ${errorText}`);
    const stackTrace =
      error instanceof Error && error.stack ? error.stack.slice(0, 2000) : undefined;
    const maskedDetails = rawDetails ? maskSensitive(rawDetails) : undefined;

    const prefix = `[DEBUG:${debugId}] [${severity.toUpperCase()}] [${functionName}]`;
    if (severity === "error" || severity === "critical") {
      console.error(prefix, message, error ?? "");
    } else if (severity === "warning") {
      console.warn(prefix, message);
    } else {
      console.log(prefix, message);
    }
    if (suggestedFix) console.log("  → Fix:", suggestedFix);

    try {
      await supabase.from("debug_logs").insert({
        debug_id: debugId,
        severity,
        module,
        message: message.slice(0, 1000),
        function_name: functionName,
        stack_trace: stackTrace ?? null,
        suggested_fix: suggestedFix ?? null,
        raw_details: maskedDetails ?? null,
        user_id: userId ?? null,
      });
    } catch (e) {
      console.warn("[debug] Failed to store log:", e);
    }

    return debugId;
  }

  return {
    info: (msg, details) => persist("info", msg, undefined, details),
    warn: (msg, err, details) => persist("warning", msg, err, details),
    error: (msg, err, details) => persist("error", msg, err, details),
    critical: (msg, err, details) => persist("critical", msg, err, details),
  };
}
