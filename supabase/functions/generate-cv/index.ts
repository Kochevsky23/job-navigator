import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CV_MAX_CHARS = 8000; // ~2K tokens — enough context, avoids sending full PII dump

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CV_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: Calibri, 'Segoe UI', Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.4;
  color: #000;
  background: white;
  padding: 0.7in 0.8in;
  max-width: 8.27in;
  margin: 0 auto;
}
.cv-name {
  text-align: center;
  font-size: 20pt;
  font-weight: bold;
  margin-bottom: 3px;
}
.cv-contact {
  text-align: center;
  font-size: 10pt;
  margin-bottom: 8px;
}
.cv-contact a { color: #000; text-decoration: none; }
.section-bar {
  background: #e0e0e0;
  text-align: center;
  padding: 1px 0;
  margin: 10px 0 5px 0;
}
.section-bar span {
  text-decoration: underline;
  font-size: 11pt;
}
.entry-header {
  font-weight: bold;
  margin-bottom: 2px;
}
p { margin-bottom: 4px; }
ul {
  margin-left: 20px;
  margin-bottom: 5px;
}
ul li { margin-bottom: 1px; }
.skills-category { font-weight: bold; }
@media print {
  * { box-sizing: border-box; }
  body { padding: 0.5in; margin: 0; }
  @page { size: A4; margin: 0; }
  .section-bar {
    background: #e0e0e0 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`;

const STRUCTURE_EXAMPLE = `
<div class="cv-name">Full Name</div>
<div class="cv-contact">Phone | City, Country | email@example.com | LinkedIn</div>

<div class="section-bar"><span>Profile</span></div>
<p>Opening profile sentence bold and strong.</p>
<p>Second sentence with skills and impact.</p>
<p>Third sentence with collaboration/ownership.</p>

<div class="section-bar"><span>Education</span></div>
<div class="entry-header">"Institution Name" | Expected graduation: YEAR</div>
<p>Degree and field of study.</p>
<p>GPA: XX | Brief academic note.</p>
<p>Relevant coursework: Course1, Course2, Course3.</p>
<div class="entry-header">"School Name" | YEAR–YEAR</div>
<p>Brief description of high school achievement.</p>

<div class="section-bar"><span>Work Experience</span></div>
<div class="entry-header">Job Title | Company Name | YEAR-YEAR</div>
<ul>
  <li>Bullet one with strong action verb and measurable result.</li>
  <li>Bullet two focusing on relevant skills.</li>
  <li>Bullet three with context/environment.</li>
</ul>

<div class="section-bar"><span>Projects</span></div>
<div class="entry-header">Project Name – Brief Tagline | Personal Project</div>
<ul>
  <li>Tech-focused bullet with specific tools mentioned.</li>
  <li>Impact or result bullet.</li>
  <li>Architecture or system design bullet.</li>
</ul>

<div class="section-bar"><span>Military Experience</span></div>
<div class="entry-header">Role | Unit | YEAR-YEAR</div>
<ul>
  <li>Leadership bullet.</li>
  <li>Responsibility bullet transferable to professional environment.</li>
</ul>

<div class="section-bar"><span>Skills</span></div>
<p><span class="skills-category">Personal Skills:</span> Skill1, Skill2, Skill3.</p>
<p><span class="skills-category">Technical Skills:</span> Tech1, Tech2, Tech3.</p>
<p><span class="skills-category">AI Development:</span> Tool1, Tool2.</p>
<p><span class="skills-category">Languages:</span> Language1 (level), Language2 (level).</p>
`;

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
      .select("*")
      .eq("id", jobId)
      .single();
    if (jobError || !job) throw new Error("Job not found");

    // Rate limit: 10 CV generations per user per hour
    const rl = await checkRateLimit(supabase, job.user_id, "generate-cv", 10);
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
      cp.years_of_experience && `Experience level: ${cp.years_of_experience}`,
      cp.city && `City: ${cp.city}`,
    ].filter(Boolean).join("\n");

    const systemPrompt = `You are an expert resume writer specializing in tech industry ATS optimization.
You generate tailored HTML resumes that exactly follow the visual structure shown to you.
Output ONLY the inner HTML body content — no DOCTYPE, no <html>, no <head>, no <body> tags, no CSS.
Use only these CSS classes: cv-name, cv-contact, section-bar, entry-header, skills-category.
Use only these HTML tags: div, p, ul, li, span, a.
Preserve ALL real dates, names, and metrics. Never invent experience. Mirror exact terminology from the job description.`;

    const userPrompt = `TARGET JOB:
Company: ${job.company}
Role: ${job.role}
Location: ${job.location}
Experience Required: ${job.exp_required || "Not specified"}

JOB DESCRIPTION:
${(job.description?.trim() || "Not available — use role and reason as context.").substring(0, 3000)}

AI MATCH REASON:
${job.reason}

CANDIDATE BACKGROUND:
${candidateContext || "See CV below"}

FULL CV (source of truth for all facts):
${cvText.substring(0, CV_MAX_CHARS)}

TAILORING RULES:
1. KEYWORDS: Extract exact tech terms from job description. Mirror their language precisely.
2. PROFILE: 3-4 lines. Open with the exact job title or close variant. Mention 2-3 specific technologies from the job description.
3. SKILLS: Reorder so job-matching skills appear first. Include every matching tech the candidate has.
4. EXPERIENCE: Rewrite bullets to foreground relevance. Strong action verbs. Preserve all real metrics.
5. PROJECTS: Emphasize tech that matches the job. Use the exact technology names from the job description.
6. PRESERVE: All dates, employer names, job titles, school names, GPA, real achievements.

HTML STRUCTURE TO FOLLOW EXACTLY:
${STRUCTURE_EXAMPLE}

Return ONLY the inner HTML body content following the structure above. No preamble, no explanation, no markdown fencing, no CSS, no DOCTYPE.`;

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
        max_tokens: 4096,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const claudeData = await claudeResp.json();
    const bodyHtml = claudeData.content?.[0]?.text?.trim() || "";
    if (!bodyHtml) throw new Error("Claude returned empty CV");

    // Wrap in full HTML document with embedded CSS
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CV – ${job.company} – ${job.role}</title>
<style>${CV_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

    await supabase.from("jobs").update({ tailored_cv: fullHtml }).eq("id", jobId);

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
