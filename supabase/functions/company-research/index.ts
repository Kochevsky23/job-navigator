import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { jobId } = await req.json();
    if (!jobId || !UUID_RE.test(jobId)) throw new Error("Invalid jobId");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("company, role, location, description, company_domain, user_id")
      .eq("id", jobId)
      .single();
    if (jobError || !job) throw new Error("Job not found");

    const rl = await checkRateLimit(supabase, job.user_id, "company-research", 20);
    if (!rl.allowed) throw new Error(`Rate limit reached. Try again in ${Math.ceil((rl.retryAfterSeconds ?? 3600) / 60)} minutes.`);

    const prompt = `You are a company research analyst. Based on what you know about this company and the job description context, generate a concise company brief for a job candidate preparing to apply.

Company: ${job.company}
Role being applied for: ${job.role}
Location: ${job.location}
Company domain: ${job.company_domain || "unknown"}

Job description context:
${job.description?.substring(0, 2000) || "Not available"}

Write a structured company brief covering:

WHAT THEY DO
2–3 sentences: core product/service, who their customers are, what market they operate in.

SIZE & STAGE
Estimated employee count range, funding stage (bootstrapped/seed/series A-D/public), and approximate founding year if known.

TECH & TOOLS
Technologies and tools commonly used at this company (infer from the job description and what you know).

CULTURE SIGNALS
2–3 honest observations about what it's like to work there — based on the job description tone, company type, and what's publicly known. Include both positives and any realistic watch points.

WHY THIS ROLE MATTERS
How the ${job.role} position fits into the company's structure and what impact it typically has.

SMART QUESTIONS TO RESEARCH BEFORE THE INTERVIEW
2 specific things to look up or read before applying/interviewing (e.g. recent news, product launches, competitors).

Be honest and specific. If you're uncertain about something, say so briefly rather than guessing. Plain text with section headers.`;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: "You are a company research analyst who helps job candidates understand companies before applying. You give honest, practical, and specific company briefs based on what is publicly known.",
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await claudeResp.json();
    const companyResearch = claudeData.content?.[0]?.text?.trim() || "";
    if (!companyResearch) throw new Error("Claude returned empty response");

    await supabase.from("jobs").update({ company_research: companyResearch }).eq("id", jobId);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Company research error:", error);
    return new Response(JSON.stringify({ error: error.message || "Company research failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
