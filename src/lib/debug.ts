import { supabase } from '@/integrations/supabase/client';

export type DebugSeverity = 'info' | 'warning' | 'error' | 'critical';
export type DebugModule = 'frontend' | 'supabase' | 'edge_function' | 'gmail' | 'claude_api' | 'database';

export interface DebugOptions {
  severity: DebugSeverity;
  module: DebugModule;
  message: string;
  error?: unknown;
  fileName?: string;
  functionName?: string;
  suggestedFix?: string;
  rawDetails?: Record<string, unknown>;
}

// Keys whose values must never be stored
const SENSITIVE_KEYS = new Set([
  'api_key', 'apikey', 'refresh_token', 'access_token', 'token',
  'secret', 'password', 'cv_text', 'body', 'email_body',
]);

const FIX_MAP: Array<[RegExp, string]> = [
  [/GMAIL_RECONNECT_REQUIRED|invalid_grant/i, 'Gmail token expired — go to Settings and reconnect Gmail'],
  [/gmail/i, 'Check Gmail OAuth connection in Settings'],
  [/401|unauthorized/i, 'Session expired — try logging out and back in'],
  [/403|forbidden/i, 'Insufficient permissions for this operation'],
  [/429|rate.?limit/i, 'Rate limit hit — wait a few minutes and try again'],
  [/claude|anthropic/i, 'Claude API error — check if the API key is valid'],
  [/network|fetch failed|econnrefused/i, 'Network error — check internet connection'],
  [/json|parse|syntax/i, 'Unexpected response format from the API'],
  [/duplicate|unique.*violation|already exists/i, 'Duplicate entry — this record already exists'],
  [/timeout/i, 'Request timed out — try again'],
  [/storage|upload/i, 'File upload error — check file size and format'],
];

function inferSuggestedFix(message: string, error?: unknown): string | undefined {
  const text = [
    message,
    error instanceof Error ? error.message : String(error ?? ''),
  ].join(' ').toLowerCase();
  for (const [pattern, fix] of FIX_MAP) {
    if (pattern.test(text)) return fix;
  }
  return undefined;
}

function maskSensitiveData(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[redacted]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = maskSensitiveData(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Central debug logger. Logs to console and stores in debug_logs table.
 * Returns the debugId so you can trace the same event across frontend,
 * edge functions, and Supabase.
 *
 * Example:
 *   const debugId = await debugLog({
 *     severity: 'error',
 *     module: 'gmail',
 *     message: 'Gmail token refresh failed',
 *     error: err,
 *   });
 *   toast.error(`Scan failed [${debugId}]`);
 */
export async function debugLog(options: DebugOptions): Promise<string> {
  const debugId = crypto.randomUUID().slice(0, 8).toUpperCase();

  const suggestedFix = options.suggestedFix ?? inferSuggestedFix(options.message, options.error);
  const stackTrace =
    options.error instanceof Error && options.error.stack
      ? options.error.stack.slice(0, 2000)
      : undefined;
  const rawDetails = options.rawDetails ? maskSensitiveData(options.rawDetails) : undefined;

  // Console output — always happens regardless of DB availability
  const prefix = `[DEBUG:${debugId}] [${options.severity.toUpperCase()}] [${options.module}]`;
  const args: unknown[] = [prefix, options.message];
  if (options.error) args.push(options.error);
  if (suggestedFix) args.push('→ Fix:', suggestedFix);

  if (options.severity === 'critical' || options.severity === 'error') {
    console.error(...args);
  } else if (options.severity === 'warning') {
    console.warn(...args);
  } else {
    console.log(...args);
  }

  // Persist to Supabase — only when user is authenticated; never throws
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('debug_logs').insert({
        debug_id: debugId,
        severity: options.severity,
        module: options.module,
        message: options.message.slice(0, 1000),
        file_name: options.fileName ?? null,
        function_name: options.functionName ?? null,
        stack_trace: stackTrace ?? null,
        suggested_fix: suggestedFix ?? null,
        raw_details: rawDetails ?? null,
        user_id: user.id,
      });
    }
  } catch {
    // Debug logging must never crash the app
  }

  return debugId;
}
