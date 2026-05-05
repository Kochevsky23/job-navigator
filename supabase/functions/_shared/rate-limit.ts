import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Per-user, per-function, per-hour rate limiter using the rate_limits table.
// Returns { allowed: true } or { allowed: false, retryAfterSeconds: number }.
export async function checkRateLimit(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  functionName: string,
  maxPerHour: number,
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  try {
    const windowStart = new Date();
    windowStart.setMinutes(0, 0, 0, 0); // start of current hour

    const { count } = await supabase
      .from("rate_limits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("function_name", functionName)
      .gte("called_at", windowStart.toISOString());

    if ((count ?? 0) >= maxPerHour) {
      // Seconds until top of next hour
      const nextHour = new Date(windowStart.getTime() + 3600_000);
      const retryAfterSeconds = Math.ceil((nextHour.getTime() - Date.now()) / 1000);
      return { allowed: false, retryAfterSeconds };
    }

    // Record this call
    await supabase.from("rate_limits").insert({ user_id: userId, function_name: functionName });
    return { allowed: true };
  } catch {
    // Fail open — don't block legitimate users on rate-limit table errors
    return { allowed: true };
  }
}
