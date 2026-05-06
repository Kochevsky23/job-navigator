import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CV_MAX_CHARS = 8000;

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

    const rl = await checkRateLimit(supabase, job.user_id, "generate-cover-letter", 10);
    if (!rl.allowed) throw new Error(`Rate limit reached. Try again in ${Math.ceil((rl.retryAfterSeconds ?? 3600) / 60)} minutes.`);

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("cv_text, candidate_profile, full_name")
      .eq("id", job.user_id)
      .single();

    const cvText = profile?.cv_text?.trim();
    if (!cvText) throw new Error("No CV found. Please upload your CV in Settings first.");

    const cp = profile?.candidate_profile || {};
    const candidateContext = [
      cp.education_field && `Education: ${cp.education_field}`,
      cp.domains?.length && `Domains: ${cp.domains.join(", ")}`,
      cp.skills?.length && `Skills: ${cp.skills.join(", ")}`,
      cp.years_of_experience != null && `Years of experience: ${cp.years_of_experience}`,
      cp.city && `City: ${cp.city}`,
    ].filter(Boolean).join("\n");

    const prompt = `You are an expert cover letter writer. Write a compelling, personalized cover letter for this specific job application.

TARGET JOB:
Company: ${job.company}
Role: ${job.role}
Location: ${job.location}
Experience Required: ${job.exp_required || "Not specified"}

FULL JOB DESCRIPTION:
${job.description?.trim() || "Not available — use the role title as context."}

CANDIDATE BACKGROUND:
${candidateContext || "See CV below"}

AI SCORING NOTES (why this job matched the candidate):
${job.reason || "Not available"}

CANDIDATE CV (for background context — do NOT copy paste, synthesize):
${cvText.substring(0, CV_MAX_CHARS)}

INSTRUCTIONS:
1. Opening paragraph: Hook the reader. State the role, express genuine enthusiasm for this specific company (mention something real about them from the job description). Connect one key strength of the candidate to the company's needs.
2. Middle paragraph: Highlight 2–3 specific, quantifiable achievements or experiences from the CV that directly address the job requirements. Mirror the language from the job description. Be concrete.
3. Closing paragraph: Reinforce fit, express eagerness for next steps, and close confidently.

RULES:
- Total length: 250–320 words. Three paragraphs only.
- Address the company by name throughout.
- Use first person ("I").
- No generic filler ("I am writing to apply for..."). Start with substance.
- Do not invent experience or metrics not in the CV.
- Output ONLY the body of the letter (no date, no address header, no signature line). Plain text.`;

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
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: "You are an expert cover letter writer specializing in helping candidates stand out. You write concise, specific, and compelling cover letters that get interviews.",
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await claudeResp.json();
    const coverLetter = claudeData.content?.[0]?.text?.trim() || "";
    if (!coverLetter) throw new Error("Claude returned empty cover letter");

    await supabase.from("jobs").update({ cover_letter: coverLetter }).eq("id", jobId);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Cover letter error:", error);
    return new Response(JSON.stringify({ error: error.message || "Cover letter generation failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
