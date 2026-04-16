import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function isOldFormat(reason: string): boolean {
  return /^Score \d+ [-–]/.test(reason) || reason.includes("CV match:") || reason.includes("+1)") || reason.includes("+2)") || reason.includes("+3)");
}

async function generateNewReason(job: any, cvText: string): Promise<string> {
  const prompt = `You are a job-fit analyst. Write a reason explaining why this job is or isn't a good fit for this candidate.

CANDIDATE CV (excerpt):
${cvText.substring(0, 6000)}

JOB:
- Company: ${job.company}
- Role: ${job.role}
- Location: ${job.location}
- Score: ${job.score}/10
- Priority: ${job.priority}
- Experience required: ${job.exp_required || "not specified"}

Write EXACTLY 4 sentences:
Sentence 1: List the specific skills/experience from the CV that match this job's requirements (name specific tools/skills).
Sentence 2: State what requirements from the job are missing or only partially covered in the CV.
Sentence 3: Assess the experience level fit and location (candidate is from Kfar Saba area).
Sentence 4: Overall verdict — why this is or isn't a good fit.

Rules:
- Be specific — name actual skills from the CV
- No bullet points, no headers, just 4 plain sentences
- ASCII only (no Hebrew, no special characters)
- Do NOT start with "Score X" or any rating prefix

Return only the 4-sentence reason, nothing else.`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await resp.json();
  return data.content?.[0]?.text?.trim() || job.reason;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get user's CV
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("cv_text")
    .eq("id", user.id)
    .single();

  const cvText = (profile as any)?.cv_text || "";
  if (!cvText) {
    return new Response(JSON.stringify({ error: "No CV found in profile. Please upload your CV in Settings first." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get all jobs for this user
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, company, role, location, score, priority, exp_required, reason")
    .eq("user_id", user.id);

  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ updated: 0, message: "No jobs found" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Filter to old-format reasons only
  const oldJobs = jobs.filter((j: any) => isOldFormat(j.reason || ""));
  console.log(`Found ${oldJobs.length} jobs with old-format reasons out of ${jobs.length} total`);

  let updated = 0;
  for (const job of oldJobs) {
    try {
      const newReason = await generateNewReason(job, cvText);
      await supabase.from("jobs").update({ reason: newReason }).eq("id", job.id);
      updated++;
      console.log(`Updated: ${job.company} — ${job.role}`);
    } catch (e: any) {
      console.error(`Failed to update ${job.company} — ${job.role}:`, e.message);
    }
  }

  return new Response(JSON.stringify({ updated, total_old_format: oldJobs.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
