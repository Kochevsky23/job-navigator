import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CV_MAX_CHARS = 8000; // ~2K tokens — enough context, avoids sending full PII dump

const CV_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: Calibri, 'Segoe UI', Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.3;
  color: #000;
  background: white;
  padding: 0;
  margin: 0;
}
.cv-wrapper {
  border: 1px solid #000;
  padding: 0.45in 0.55in;
  min-height: 9.5in;
  max-width: 7.5in;
  margin: 0 auto;
  background: white;
}
.cv-name {
  text-align: center;
  font-size: 18pt;
  font-weight: bold;
  margin-bottom: 2px;
  letter-spacing: 0.02em;
}
.cv-contact {
  text-align: center;
  font-size: 10pt;
  font-weight: bold;
  margin-bottom: 1px;
}
.cv-contact a { color: #000; text-decoration: underline; }
.cv-subtitle {
  text-align: center;
  font-size: 10pt;
  font-weight: normal;
  margin-bottom: 4px;
}
.section-bar {
  background: #d9d9d9;
  text-align: center;
  padding: 1px 0;
  margin: 6px 0 3px 0;
}
.section-bar span {
  text-decoration: underline;
  font-size: 10.5pt;
  font-weight: normal;
}
.entry-header {
  font-weight: bold;
  margin-bottom: 1px;
  margin-top: 2px;
}
p { margin-bottom: 2px; }
ul {
  margin-left: 16px;
  margin-bottom: 2px;
  list-style-type: disc;
}
ul li { margin-bottom: 0px; }
.skills-category { font-weight: bold; }
@media print {
  * { box-sizing: border-box; }
  body { padding: 0; margin: 0; }
  @page { size: A4; margin: 0.25in; }
  .cv-wrapper {
    border: 1px solid #000 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    min-height: auto;
    margin: 0;
    padding: 0.35in 0.45in;
  }
  .section-bar {
    background: #d9d9d9 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`;

const STRUCTURE_EXAMPLE = `
<div class="cv-wrapper">
<div class="cv-name">Full Name</div>
<div class="cv-contact"><strong>+Phone | City, Country | <a href="mailto:email@example.com">email@example.com</a> | <a href="#">LinkedIn</a></strong></div>
<div class="cv-subtitle">Role Title | Domain | Orientation</div>

<div class="section-bar"><span>Profile</span></div>
<p><strong>Bold opening sentence tying candidate background directly to this job title and key requirements.</strong></p>
<p>Second sentence highlighting specific experience, tools, or methodologies relevant to the role.</p>
<p>Third sentence on approach, collaboration style, or career goal aligned to company context.</p>

<div class="section-bar"><span>Education</span></div>
<div class="entry-header">"Institution Name" | expected graduation: YEAR</div>
<p>B.Sc. Degree Field (Expected YEAR) | GPA: XX</p>
<p>Relevant Coursework: Course1, Course2, Course3</p>

<div class="section-bar"><span>Work Experience</span></div>
<div class="entry-header">Job Title |Company Name| YEAR-YEAR</div>
<ul>
  <li>Strong action verb + what you did + measurable result.</li>
  <li>Bullet focused on skill/tool directly matching the job.</li>
  <li>Bullet showing collaboration, ownership, or environment context.</li>
  <li>Bullet on documentation, process, or improvement.</li>
  <li>Bullet on cross-functional or team impact.</li>
</ul>

<div class="section-bar"><span>Projects</span></div>
<div class="entry-header">Project Name – Brief Tagline</div>
<ul>
  <li>What you built and why — framed for this job's domain.</li>
  <li>Specific technology or tool that matches job requirements.</li>
  <li>Quantified impact or result.</li>
  <li>System design, architecture, or data infrastructure detail.</li>
  <li>Ownership or lifecycle bullet.</li>
  <li>Security, reliability, or scale detail if relevant.</li>
  <li>Any automation or ML component.</li>
</ul>

<div class="section-bar"><span>Military Experience</span></div>
<div class="entry-header">Role, Unit | YEAR-YEAR</div>
<ul>
  <li>Leadership or ownership bullet.</li>
  <li>Precision, pressure, or data-accuracy bullet transferable to professional setting.</li>
  <li>Analytical or technical skill developed.</li>
</ul>

<div class="section-bar"><span>Skills</span></div>
<p><span class="skills-category">Programming:</span> Python, SQL, TypeScript.</p>
<p><span class="skills-category">Data &amp; BI:</span> Power BI, Excel (Advanced).</p>
<p><span class="skills-category">Backend &amp; APIs:</span> REST APIs, Supabase, PostgreSQL.</p>
<p><span class="skills-category">Frontend:</span> React.</p>
<p><span class="skills-category">AI &amp; Automation:</span> Claude API, Prompt Engineering.</p>

<div class="section-bar"><span>Additional</span></div>
<p><span class="skills-category">Languages:</span> Hebrew (Native), English (High level).</p>
</div>
`;

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
Use only these CSS classes: cv-wrapper, cv-name, cv-contact, cv-subtitle, section-bar, entry-header, skills-category.
Use only these HTML tags: div, p, ul, li, span, a, strong.
Preserve ALL real dates, names, and metrics. Never invent experience. Mirror exact terminology from the job description.
ALWAYS wrap everything in <div class="cv-wrapper">...</div>.`;

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
1. KEYWORDS: Extract exact phrases from the job description. Mirror their language precisely — if JD says "reconcile discrepancies", use that exact phrase.

2. SUBTITLE: 3-part tagline matching the role. Max 8 words total. E.g. "Finance Operations | Data Entry & Accuracy | Process Improvement".

3. PROFILE: Exactly 3 sentences. WORD LIMIT: max 13 words per sentence. First sentence bold (<strong>). Rules:
   - Sentence 1: exact job title + candidate's most relevant background. NEVER say "finance data" if candidate didn't work in finance — say "production data" or "data analytics". Count: must be ≤13 words.
   - Sentence 2: 2-3 specific hard skills from job requirements + one proof point. Count: must be ≤13 words.
   - Sentence 3: MUST name the company (${job.company}) + their domain (e.g. venture capital, fintech) + value-add. Count: must be ≤13 words.

4. SKILLS: Use EXACTLY these 5 category names — no renaming, no adding categories:
   - Programming: [languages only]
   - Data & BI: [Excel with JD techniques if mentioned: Formulas, Lookups, Filtering, Data Validation; BI tools]
   - Backend & APIs: [databases, APIs, backend tools]
   - Frontend: [frameworks]
   - AI & Automation: [AI tools, automation]
   Do NOT add Git, Version Control, or any 6th category. Reorder items most JD-relevant first.

5. EXPERIENCE: Max 5 bullets. WORD LIMIT: max 13 words per bullet. Rules:
   - Every bullet = Action verb + what + result/metric. Good example: "Maintained SQL pipelines, reducing errors and improving reporting accuracy." (10 words ✓)
   - Bad example: "Maintained and improved SQL data pipelines, ensuring data completeness and reliability for product teams." (15 words ✗ — too long, cut it)
   - REQUIRED: Every core responsibility listed in the job description must map to at least one bullet across Work Experience or Projects.
   - Mirror the exact action verbs and nouns from the JD responsibilities section.
   - Count your words before writing each bullet. If >13 → rewrite shorter.

6. PROJECTS: Max 6 bullets. WORD LIMIT: max 13 words per bullet. Every bullet shows a result, metric, or system property. Emphasize data integrity, automation, back-office relevance over frontend/UI. Count words — if >13 → cut.

7. MILITARY: Max 3 bullets. WORD LIMIT: max 13 words per bullet. Frame around precision, data accuracy, ownership, high-pressure execution. Count words — if >13 → cut.

8. ACCURACY: Never overstate experience. If candidate worked at an AI/product startup, say "production data" not "finance data". Only use "finance" if the candidate's CV explicitly mentions finance work.

9. JD COVERAGE CHECK: Read the job description above. Extract the top 5 core responsibilities. Before finalizing, verify each one maps to at least one bullet somewhere in Work Experience or Projects. If a core responsibility has no matching bullet, replace a weak bullet with one that covers it.

10. ONE PAGE: Entire CV MUST fit on one printed page. Ruthlessly cut filler words. Every bullet = one tight punchy line. No bullet wraps to line 2.

11. STRUCTURE: Always wrap everything in <div class="cv-wrapper">. Include Additional section with Languages at the bottom.

HTML STRUCTURE TO FOLLOW EXACTLY:
${STRUCTURE_EXAMPLE}

Return ONLY the HTML content starting with <div class="cv-wrapper"> and ending with </div>. No preamble, no explanation, no markdown fencing, no CSS, no DOCTYPE.`;

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
