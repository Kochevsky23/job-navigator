import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
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
      .select("*")
      .eq("id", jobId)
      .single();
    if (jobError || !job) throw new Error("Job not found");

    const rl = await checkRateLimit(supabase, job.user_id, "interview-prep", 10);
    if (!rl.allowed) throw new Error(`Rate limit reached. Try again in ${Math.ceil((rl.retryAfterSeconds ?? 3600) / 60)} minutes.`);

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("cv_text, candidate_profile, full_name")
      .eq("id", job.user_id)
      .single();

    const cp = profile?.candidate_profile || {};
    const candidateContext = [
      cp.name && `Name: ${cp.name}`,
      cp.education_field && `Education: ${cp.education_field}`,
      cp.domains?.length && `Domains: ${cp.domains.join(", ")}`,
      cp.skills?.length && `Skills: ${cp.skills.join(", ")}`,
      cp.experience_level && `Experience level: ${cp.experience_level}`,
    ].filter(Boolean).join("\n");

    const prompt = `You are an expert interview coach. Generate targeted interview preparation for this specific job and candidate.

TARGET JOB:
Company: ${job.company}
Role: ${job.role}
Experience Required: ${job.exp_required || "Not specified"}

JOB DESCRIPTION:
${job.description?.trim() || "Not available — use the role title as context."}

CANDIDATE:
${candidateContext}

AI SCORING NOTES (why this job matched):
${job.reason || "Not available"}

Generate exactly 10 interview questions with answer frameworks, grouped into 4 categories:

CATEGORY 1 — BEHAVIORAL (3 questions)
Questions starting with "Tell me about a time..." or "Describe a situation where...". Based on what this specific role requires.

CATEGORY 2 — TECHNICAL / DOMAIN (4 questions)
Specific to the tools, skills, and domain mentioned in the job description. Use the actual technologies listed.

CATEGORY 3 — COMPANY & ROLE FIT (2 questions)
Questions about why this company, why this role, career goals — tailored to ${job.company} specifically.

CATEGORY 4 — CANDIDATE'S QUESTION TO ASK (1 question)
One smart question the candidate should ask the interviewer that shows genuine interest and insight about ${job.company}.

For each question, provide:
- The question itself
- A 3–5 sentence answer framework (what to cover, not a script)
- One concrete example or talking point from the candidate's background

Format as plain text with clear section headers. Be specific — mention actual tools, actual company context, actual skills from the profile.`;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        system: [
          {
            type: "text",
            text: "You are an expert interview coach who helps candidates prepare for specific job interviews. You give practical, actionable advice tailored to the exact role and company.",
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await claudeResp.json();
    const interviewPrep = claudeData.content?.[0]?.text?.trim() || "";
    if (!interviewPrep) throw new Error("Claude returned empty response");

    await supabase.from("jobs").update({ interview_prep: interviewPrep }).eq("id", jobId);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Interview prep error:", error);
    return new Response(JSON.stringify({ error: error.message || "Interview prep generation failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
