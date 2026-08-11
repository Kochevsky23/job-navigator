import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createDebugLogger } from "../_shared/debug.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LEN = 4000;
const HISTORY_LIMIT = 20;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let userId: string | undefined;
  const debug = createDebugLogger("chat-agent", supabase, undefined, "claude_api");

  try {
    const { message, jobId } = await req.json();
    if (!message || typeof message !== "string" || !message.trim()) {
      throw new Error("Message is required");
    }
    if (message.length > MAX_MESSAGE_LEN) {
      throw new Error(`Message too long (max ${MAX_MESSAGE_LEN} chars)`);
    }
    if (jobId && !UUID_RE.test(jobId)) throw new Error("Invalid jobId");

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");
    userId = user.id;

    const rl = await checkRateLimit(supabase, userId, "chat-agent", 30);
    if (!rl.allowed) throw new Error(`Rate limit reached. Try again in ${Math.ceil((rl.retryAfterSeconds ?? 3600) / 60)} minutes.`);

    // ── Load candidate profile ─────────────────────────────────────────────
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("candidate_profile, full_name")
      .eq("id", userId)
      .single();

    // ── Load job context, if this conversation is about a specific job ────
    let jobContext = "";
    if (jobId) {
      const { data: job } = await supabase
        .from("jobs")
        .select("company, role, location, description, score, priority, reason, status, hiring_probability, ai_risk, next_action")
        .eq("id", jobId)
        .eq("user_id", userId)
        .single();
      if (job) {
        jobContext = `\nTHE USER IS ASKING ABOUT THIS SPECIFIC JOB:
Company: ${job.company}
Role: ${job.role}
Location: ${job.location}
Status: ${job.status}
Match score: ${job.score}/10 (${job.priority})
Hiring probability: ${job.hiring_probability ?? "n/a"}/10
AI risk: ${job.ai_risk ?? "n/a"}
Recommended next action: ${job.next_action ?? "none set"}
Why it scored this way: ${job.reason ?? "n/a"}
Job description (excerpt): ${(job.description ?? "").slice(0, 2000)}
`;
      }
    }

    // ── Aggregate pipeline stats for general questions ─────────────────────
    const { data: statusCounts } = await supabase
      .from("jobs")
      .select("status, priority")
      .eq("user_id", userId);
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const row of statusCounts ?? []) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      byPriority[row.priority] = (byPriority[row.priority] ?? 0) + 1;
    }

    // ── Load conversation history ───────────────────────────────────────────
    let historyQuery = supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    historyQuery = jobId ? historyQuery.eq("job_id", jobId) : historyQuery.is("job_id", null);
    const { data: historyRows } = await historyQuery;
    const history = (historyRows ?? []).reverse();

    const systemPrompt = `You are the Job Compass AI Assistant — a career coach and job-search copilot built into a job-search management app.

USER PROFILE:
${JSON.stringify(profile?.candidate_profile ?? {}, null, 2)}
User's name: ${profile?.full_name ?? "the user"}

PIPELINE OVERVIEW:
Jobs by status: ${JSON.stringify(byStatus)}
Jobs by priority: ${JSON.stringify(byPriority)}
${jobContext}

You help the user with: recommending what to do next in their job search, explaining match scores and priorities, practicing interview questions and giving feedback on their answers, general job-search strategy advice, and interpreting their pipeline data. Be concise, specific, and practical — reference the user's actual profile and data above rather than generic advice. If asked to run interview practice, ask one question at a time and give feedback after each answer.`;

    const messages = [
      ...history.map((m: any) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages,
      }),
    });

    const claudeData = await claudeResp.json();
    if (!claudeResp.ok) {
      await debug.error("Claude API error", undefined, { status: claudeResp.status, claudeData });
      throw new Error(claudeData?.error?.message || `Claude API error (${claudeResp.status})`);
    }
    const reply = claudeData.content?.[0]?.text?.trim() || "";
    if (!reply) {
      await debug.error("Claude returned no text content", undefined, { claudeData });
      throw new Error("Claude returned empty response");
    }

    const { error: insertError } = await supabase.from("chat_messages").insert([
      { user_id: userId, job_id: jobId ?? null, role: "user", content: message },
      { user_id: userId, job_id: jobId ?? null, role: "assistant", content: reply },
    ]);
    if (insertError) await debug.warn("Failed to persist chat messages", insertError, { userId });

    return new Response(
      JSON.stringify({ reply }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    const debugId = await debug.error("Chat agent failed", error, { userId });
    return new Response(JSON.stringify({ error: error.message || "Chat agent failed", debugId }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
