import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getGoogleAccessToken(): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error("Failed to get Google access token");
  return data.access_token;
}

async function fetchCVFromDrive(accessToken: string): Promise<string> {
  const query = encodeURIComponent("name='Dor_Kochevsky_CV_Main'");
  const searchResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchResp.json();
  if (!searchData.files?.length) return "CV not found";

  const file = searchData.files[0];
  const exportUrl = file.mimeType === "application/vnd.google-apps.document"
    ? `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`
    : `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;

  const cvResp = await fetch(exportUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  return await cvResp.text();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId } = await req.json();
    if (!jobId) throw new Error("jobId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: job, error } = await supabase.from("jobs").select("*").eq("id", jobId).single();
    if (error || !job) throw new Error("Job not found");

    const accessToken = await getGoogleAccessToken();
    const cvText = await fetchCVFromDrive(accessToken);

    const prompt = `You are a senior CV expert. Tailor this CV for the specific job.

BASE CV:
${cvText}

TARGET JOB:
- Company: ${job.company}
- Role: ${job.role}
- Location: ${job.location}
- Fit Score: ${job.score}/10
- Reason: ${job.reason}

RULES:
- Keep everything truthful, do not invent experience
- Rewrite wording to be more impactful
- Prioritize relevance to this job

STRUCTURE:
Full Name
Location | Email | Phone | LinkedIn

PROFESSIONAL SUMMARY
3-4 strong lines tailored to the job

SKILLS
Data / Programming / Tools / Business

EXPERIENCE
Role | Company | Dates
- 4-6 strong bullets

PROJECTS

EDUCATION

LANGUAGES

Return only the CV text.`;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await claudeResp.json();
    const tailoredCV = claudeData.content?.[0]?.text || "";
    if (!tailoredCV) throw new Error("Claude returned empty CV");

    await supabase.from("jobs").update({ tailored_cv: tailoredCV }).eq("id", jobId);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("CV generation error:", error);
    return new Response(JSON.stringify({ error: error.message || "CV generation failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
