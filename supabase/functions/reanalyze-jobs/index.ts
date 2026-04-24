import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function isOldFormat(reason: string): boolean {
  return /^Score \d+ [-–]/.test(reason) || reason.includes("CV match:") || reason.includes("+1)") || reason.includes("+2)") || reason.includes("+3)");
}

async function rescoreJob(job: any, cvText: string): Promise<{ score: number; priority: string; reason: string }> {
  const SENIOR_TITLES = /\b(senior|lead|principal|manager|director|head|vp|staff|architect)\b/i;
  const HIGH_EXP = /\b(3\+|4\+|5\+|6\+|7\+|8\+|3-5|5-7|3 years|4 years|5 years)\b/i;
  const REMOTE_JOB = /\b(remote|עבודה מרחוק|work from home|WFH)\b/i;
  const RELEVANT_FIELDS = /\b(data|analy|operations|business|project.?manag|supply.?chain|logistics|industrial.?engineer|BI|reporting|excel|sql|python|planning|procurement|product)\b/i;

  const prompt = `You are a job-fit analyst. Score this job against the candidate's CV and write a 4-sentence reason.

CANDIDATE CV (excerpt):
${cvText.substring(0, 8000)}

JOB:
- Company: ${job.company}
- Role: ${job.role}
- Location: ${job.location}
- Experience required: ${job.exp_required || "not specified"}

SCORING (max 10 total):

FACTOR 1 — CV SKILLS MATCH (0-4 pts)
- 4 pts: 80%+ of requirements directly in CV
- 3 pts: 60-80% covered
- 2 pts: 40-60% covered
- 1 pt: 20-40% covered
- 0 pts: <20% covered

FACTOR 2 — EXPERIENCE LEVEL FIT (0-3 pts)
- 3 pts: student/internship/entry-level/0-1 years/50%
- 2 pts: junior/1-2 years or no requirement stated
- 1 pt: 2-3 years
- 0 pts: 3+ years OR Senior/Lead/Manager/Director title → force REJECTED

FACTOR 3 — LOCATION (0-2 pts)
Candidate is from Kfar Saba area.
- 2 pts: same city or within 10km
- 1 pt: commutable (~40km, Tel Aviv metro)
- 0 pts: far (Haifa, Jerusalem, Be'er Sheva) or remote → force REJECTED

FACTOR 4 — FIELD RELEVANCE (0-1 pt)
- 1 pt: data, analytics, BI, business, operations, industrial engineering, supply chain, product
- 0 pts: unrelated

PRIORITY:
- HIGH: 8-10
- MEDIUM: 5-7
- LOW: 3-4
- REJECTED: 1-2, OR senior title, OR remote, OR 3+ years

REASON (4 sentences):
Sentence 1: Specific matching skills from CV.
Sentence 2: Missing requirements.
Sentence 3: Experience level and location fit.
Sentence 4: Overall verdict.

Return ONLY JSON (ASCII only, no Hebrew):
{"score": 0, "priority": "", "reason": ""}`;

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
  const text = data.content?.[0]?.text?.trim() || "";

  let parsed: any;
  try {
    const startIdx = text.indexOf("{");
    const endIdx = text.lastIndexOf("}");
    if (startIdx !== -1 && endIdx !== -1) {
      parsed = JSON.parse(text.substring(startIdx, endIdx + 1));
    }
  } catch {
    // fallback: keep original
    return { score: job.score, priority: job.priority, reason: job.reason };
  }

  if (!parsed?.score || !parsed?.priority || !parsed?.reason) {
    return { score: job.score, priority: job.priority, reason: job.reason };
  }

  let { score, priority, reason } = parsed;
  score = Math.max(1, Math.min(10, Math.round(score)));

  // Enforce hard rules
  if (SENIOR_TITLES.test(job.role)) { score = Math.min(score, 3); priority = "REJECTED"; }
  if (HIGH_EXP.test(job.exp_required || "")) { score = Math.min(score, 3); priority = "REJECTED"; }
  if (REMOTE_JOB.test(job.location || "") || REMOTE_JOB.test(job.role || "")) { priority = "REJECTED"; }
  if (!RELEVANT_FIELDS.test(job.role) && !RELEVANT_FIELDS.test(reason)) {
    score = Math.min(score, 4);
    if (priority !== "REJECTED") priority = "LOW";
  }
  if (score <= 2) priority = "REJECTED";
  else if (score <= 4 && priority !== "REJECTED") priority = "LOW";
  else if (score <= 6 && priority === "HIGH") priority = "MEDIUM";

  return { score, priority, reason };
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

  // forceAll=true: rescore ALL jobs (score+priority+reason) against new CV
  // forceAll=false (default): only fix old-format reason text
  const body = await req.json().catch(() => ({}));
  const forceAll = body.forceAll === true;

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

  let jobsToProcess: any[];
  if (forceAll) {
    // Rescore everything — skip only REJECTED jobs to save tokens
    jobsToProcess = jobs.filter((j: any) => j.priority !== "REJECTED");
    console.log(`forceAll: rescoring ${jobsToProcess.length} non-rejected jobs out of ${jobs.length} total`);
  } else {
    // Only fix old-format reasons
    jobsToProcess = jobs.filter((j: any) => isOldFormat(j.reason || ""));
    console.log(`Found ${jobsToProcess.length} jobs with old-format reasons out of ${jobs.length} total`);
  }

  let updated = 0;
  for (const job of jobsToProcess) {
    try {
      if (forceAll) {
        const { score, priority, reason } = await rescoreJob(job, cvText);
        await supabase.from("jobs").update({ score, priority, reason }).eq("id", job.id);
        console.log(`Rescored: ${job.company} — ${job.role}: ${job.score}→${score}, ${job.priority}→${priority}`);
      } else {
        const newReason = await generateNewReason(job, cvText);
        await supabase.from("jobs").update({ reason: newReason }).eq("id", job.id);
        console.log(`Updated reason: ${job.company} — ${job.role}`);
      }
      updated++;
    } catch (e: any) {
      console.error(`Failed to update ${job.company} — ${job.role}:`, e.message);
    }
  }

  return new Response(JSON.stringify({ updated, total_processed: jobsToProcess.length, forceAll }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
