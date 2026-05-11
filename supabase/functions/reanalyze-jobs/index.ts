import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { createDebugLogger } from "../_shared/debug.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CandidateProfile {
  name: string;
  experience_level: "student" | "fresh_graduate" | "junior" | "mid" | "senior";
  years_of_experience: number;
  skills: string[];
  education_field: string;
  degree_level: string;
  graduation_year: number | null;
  domains: string[];
  city: string;
  languages: string[];
  job_type: string;
}

interface JobRow {
  id: string;
  company: string;
  role: string;
  location: string;
  exp_required: string | null;
  description: string | null;
  linkedin_id: string | null;
  job_link: string | null;
  company_domain: string | null;
}

interface ScoredJob {
  id: string;
  score: number;
  priority: string;
  hiring_probability: number | null;
  ai_risk: string | null;
  reason: string;
  actual_exp_required?: string | null;
}

interface ExperienceExtraction {
  job_index: number;
  actual_exp_required: string;
  evidence: string;
}

function buildFactor2Examples(profile: CandidateProfile): string {
  const level = profile.experience_level;
  if (level === "student" || level === "fresh_graduate") {
    return `- 5 pts: Job targets exactly this level (student/intern role, "Student program", "Trainee")
- 4 pts: One step away (entry-level/graduate role, "0-1 year", "Fresh graduate")
- 3 pts: Near fit with manageable gap (junior role, "Entry/Junior")
- 2 pts: Level not stated anywhere — uncertain
- 1 pt: Clear gap (1-3 years required)
- 0 pts: Major mismatch — apply hard rejection rules above`;
  }
  if (level === "junior") {
    return `- 5 pts: Job targets exactly this level (junior/1-3 year role)
- 4 pts: Entry-level role (slight over-qualification, still good)
- 3 pts: Mid-level or "junior-mid" role (manageable gap)
- 2 pts: Level not stated anywhere — uncertain
- 1 pt: Clear gap (4-5 years required)
- 0 pts: Major mismatch — apply hard rejection rules above`;
  }
  if (level === "mid") {
    return `- 5 pts: Job targets exactly this level (mid-level/3-5 year role)
- 4 pts: Junior-mid or "3+ years" (good fit)
- 3 pts: Senior or "5-7 years" (manageable stretch)
- 2 pts: Level not stated anywhere — uncertain
- 1 pt: Significant gap (8+ years required) or junior-only (over-qualified)
- 0 pts: Major mismatch — apply hard rejection rules above`;
  }
  if (level === "senior") {
    return `- 5 pts: Job targets exactly this level (senior/lead/6+ year role)
- 4 pts: Mid-senior or "5+ years" (good fit)
- 3 pts: Mid-level (slight under-targeting, may still fit)
- 2 pts: Level not stated anywhere — uncertain
- 1 pt: Junior/entry-only (over-qualified)
- 0 pts: Student-only internship — apply hard rejection rules above`;
  }
  return `- 5 pts: Job targets exactly the candidate's level
- 4 pts: One step away
- 3 pts: Near fit with manageable gap
- 2 pts: Level not stated anywhere — uncertain
- 1 pt: Clear gap
- 0 pts: Major mismatch — apply hard rejection rules above`;
}

function buildHardRejectionRules(profile: CandidateProfile): string {
  if (profile.experience_level === "student" || profile.experience_level === "fresh_graduate") {
    const levelDesc = profile.experience_level === "student"
      ? "student (currently enrolled, 0-1 year experience, not yet graduated)"
      : "fresh graduate (recently graduated, <1 year work experience)";
    return `HARD REJECTION RULES (MANDATORY — apply BEFORE scoring, zero exceptions):

EXPERIENCE-BASED REJECTIONS — priority MUST be REJECTED, but still score the other factors:
1. Job explicitly requires 3+ years of experience → priority MUST be REJECTED. Still evaluate FACTOR 1 (skills), FACTOR 3 (field), FACTOR 4 (location) normally. Set FACTOR 2 = 0 (experience mismatch). Cap total score at 4.
3. exp_required contains "Mid-level", "Mid level", "Mid", "mid-level", "mid level" (as experience label) → priority MUST be REJECTED. Still evaluate FACTOR 1, FACTOR 3, FACTOR 4 normally. Set FACTOR 2 = 0. Cap total score at 4.

TITLE/DOMAIN REJECTIONS — score MUST be 0, no need to evaluate further:
2. Job title contains Senior / Lead / Principal / Director / Head / VP / Architect / Chief → score MUST be 0, priority MUST be REJECTED
2b. Job title contains "Manager" AND exp_required is Mid-level, Senior, or requires 3+ years → score MUST be 0, priority MUST be REJECTED (Exception: "Project Manager", "Product Manager", or similar manager roles targeting juniors/entry-level are allowed — evaluate exp_required to decide)
4. Job requires domain expertise in a field completely unrelated to the candidate's education (${profile.education_field}) and domains (${profile.domains.join(", ")}) — e.g. a pure legal, medical, or civil engineering role for someone in ${profile.education_field} → score MUST be 0-1, priority MUST be REJECTED

EXPERIENCE LEVEL FIT — MANDATORY SCORING GUIDE FOR ${profile.experience_level.toUpperCase().replace("_", " ")}:
Use these rules to score FACTOR 2. This candidate is a ${levelDesc}:
- exp_required explicitly says "Student", "Intern", "Trainee", "Student/Intern", "Student level", "Student program" → FACTOR 2 = 5 pts (perfect fit)
- exp_required says "Entry level", "Entry", "Graduate", "0-1 year", "Fresh graduate" → FACTOR 2 = 4 pts (excellent fit)
- exp_required says "Junior", "Entry/Junior", "Entry to junior", "Entry-to-junior" → FACTOR 2 = 3 pts (near fit, 1 year gap)
- exp_required says "Not specified" or is unclear → FACTOR 2 = 2 pts (treat conservatively — cannot confirm ${profile.experience_level}-appropriate)
- exp_required says "1-2 years", "1-3 years", "2+ years", "Junior-Mid", "Junior to mid", "Entry-to-mid", "Entry to mid", "entry to mid level" → FACTOR 2 = 1 pt (clear gap)
- 3+ years, Mid-level → FACTOR 2 = 0 pts (see hard rejection above)

SCORE CAPS (apply after scoring, before final output):
- If exp_required is "Junior", "Entry/Junior" → cap total score at 7 (MEDIUM max). ${profile.experience_level === "student" ? "Student" : "Fresh graduate"} targeting junior role is a near-fit but not HIGH priority.
- If job location is clearly more than 40km from ${profile.city} → FACTOR 4 = 0 pts AND cap total score at 7 (MEDIUM max).`;
  }
  if (profile.experience_level === "junior") {
    return `HARD REJECTION RULES (MANDATORY — zero exceptions):
1. Job explicitly requires 5+ years → score MUST be 0, priority MUST be REJECTED
2. Job title contains Director / VP / Head / C-level / Chief → score MUST be 0, priority MUST be REJECTED
3. Job requires domain expertise completely unrelated to the candidate's education (${profile.education_field}) and domains (${profile.domains.join(", ")}) → score MUST be 0-1, priority MUST be REJECTED

EXPERIENCE LEVEL FIT — MANDATORY SCORING GUIDE FOR JUNIOR:
Use these rules to score FACTOR 2. This candidate is a junior (1-3 years full-time experience):
- exp_required "Junior", "1-3 years", "1-2 years", "2 years", "Entry/Junior", "Entry-to-junior" → FACTOR 2 = 5 pts (perfect fit)
- exp_required "Entry", "Entry-level", "Graduate", "0-1 year", "Fresh graduate" → FACTOR 2 = 4 pts (good fit, slight over-qualification)
- exp_required "Mid", "Mid-level", "Junior-Mid", "2-4 years", "3 years" → FACTOR 2 = 3 pts (near fit, manageable gap)
- exp_required "Not specified" or is unclear → FACTOR 2 = 2 pts (conservative)
- exp_required "4-5 years" → FACTOR 2 = 1 pt (clear gap)
- 5+ years → FACTOR 2 = 0 pts (see hard rejection above)

SCORE CAPS (apply after scoring, before final output):
- If job location is clearly more than 40km from ${profile.city} → FACTOR 4 = 0 pts AND cap total score at 7 (MEDIUM max).`;
  }
  if (profile.experience_level === "mid") {
    return `HARD REJECTION RULES (MANDATORY — zero exceptions):
1. Job title contains VP / C-level / Chief → score MUST be 0, priority MUST be REJECTED
2. Student-only internship → score MUST be 0-1, priority MUST be REJECTED
3. Job requires domain expertise completely unrelated to the candidate's education (${profile.education_field}) and domains (${profile.domains.join(", ")}) → score MUST be 0-1, priority MUST be REJECTED

EXPERIENCE LEVEL FIT — MANDATORY SCORING GUIDE FOR MID-LEVEL:
Use these rules to score FACTOR 2. This candidate is a mid-level (3-6 years full-time experience):
- exp_required "Mid", "Mid-level", "3-5 years", "4 years", "4+ years", "3-4 years" → FACTOR 2 = 5 pts (perfect fit)
- exp_required "Junior-Mid", "Junior to mid", "3+ years", "2-4 years" → FACTOR 2 = 4 pts (good fit)
- exp_required "Senior", "5-7 years", "5+ years" → FACTOR 2 = 3 pts (stretch, manageable)
- exp_required "Not specified" → FACTOR 2 = 2 pts (uncertain)
- exp_required "Junior", "Entry", "Entry-level", "1-2 years" → FACTOR 2 = 2 pts (over-qualified, may still be ok)
- 8+ years required → FACTOR 2 = 1 pt (significant gap)
- Student-only → FACTOR 2 = 0 pts (see hard rejection above)

SCORE CAPS (apply after scoring, before final output):
- If job location is clearly more than 40km from ${profile.city} → FACTOR 4 = 0 pts AND cap total score at 7 (MEDIUM max).`;
  }
  if (profile.experience_level === "senior") {
    return `HARD REJECTION RULES (MANDATORY — zero exceptions):
1. C-level roles (CEO, CTO, COO, CFO, etc.) unless the description explicitly targets senior IC or director-level → score MUST be 0, priority MUST be REJECTED
2. Student-only / intern-only positions → score MUST be 0-1, priority MUST be REJECTED
3. Job requires domain expertise completely unrelated to the candidate's education (${profile.education_field}) and domains (${profile.domains.join(", ")}) → score MUST be 0-1, priority MUST be REJECTED

EXPERIENCE LEVEL FIT — MANDATORY SCORING GUIDE FOR SENIOR:
Use these rules to score FACTOR 2. This candidate is a senior (6+ years full-time experience):
- exp_required "Senior", "Lead", "6+ years", "7+ years", "8 years", "5-8 years" → FACTOR 2 = 5 pts (perfect fit)
- exp_required "Mid-Senior", "5+ years", "5-7 years", "4-6 years" → FACTOR 2 = 4 pts (good fit)
- exp_required "Mid", "3-5 years", "Mid-level" → FACTOR 2 = 3 pts (slightly under-targeting, may still apply)
- exp_required "Not specified" → FACTOR 2 = 2 pts (uncertain)
- exp_required "Junior", "Entry", "Entry-level", "1-2 years" → FACTOR 2 = 1 pt (over-qualified)
- Student-only → FACTOR 2 = 0 pts (see hard rejection above)

SCORE CAPS (apply after scoring, before final output):
- If job location is clearly more than 40km from ${profile.city} → FACTOR 4 = 0 pts AND cap total score at 7 (MEDIUM max).`;
  }
  return "";
}

// ─── Description fetch helpers ────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchWithTimeout(url: string, timeoutMs: number, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
};

async function fetchLinkedInDescription(linkedinId: string): Promise<string | null> {
  try {
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${linkedinId}`;
    const resp = await fetchWithTimeout(url, 5000, { headers: BROWSER_HEADERS });
    if (!resp.ok) return null;
    const html = await resp.text();
    const markupMatch = html.match(/class="show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (markupMatch) {
      const text = stripHtml(markupMatch[1]);
      if (text.length > 100) return text.substring(0, 3000);
    }
    const sectionMatch = html.match(/<section[^>]*description[^>]*>([\s\S]*?)<\/section>/i);
    if (sectionMatch) {
      const text = stripHtml(sectionMatch[1]);
      if (text.length > 100) return text.substring(0, 3000);
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchCareersPageDescription(jobLink: string): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout(jobLink, 4000, { headers: BROWSER_HEADERS });
    if (!resp.ok) return null;
    const html = await resp.text();
    const patterns = [
      /class="[^"]*(?:job-description|jobDescription|job_description|description|posting-description)[^"]*"[^>]*>([\s\S]{200,3000}?)<\/(?:div|section|article)>/i,
      /<(?:div|section|article)[^>]*id="[^"]*(?:description|job-detail)[^"]*"[^>]*>([\s\S]{200,3000}?)<\/(?:div|section|article)>/i,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const text = stripHtml(match[1]);
        if (text.length > 150) return text.substring(0, 3000);
      }
    }
    const stripped = stripHtml(html);
    const lines = stripped.split("\n").filter(l => l.trim().length > 40);
    if (lines.length > 5) return lines.slice(0, 40).join("\n").substring(0, 3000);
    return null;
  } catch {
    return null;
  }
}

async function resolveDescription(job: JobRow): Promise<string> {
  if (job.description && job.description.length > 100) return job.description;

  if (job.linkedin_id) {
    const desc = await fetchLinkedInDescription(job.linkedin_id);
    if (desc) return desc;
  }
  if (job.job_link && job.job_link.startsWith("http") && !job.job_link.includes("linkedin.com")) {
    const desc = await fetchCareersPageDescription(job.job_link);
    if (desc) return desc;
  }

  // Fall back to minimal known facts — honest uncertainty beats hallucinated content
  return `${job.role} at ${job.company}, ${job.location}. Experience required: ${job.exp_required || "not specified"}.`;
}

async function extractExperienceLevelsBatch(
  jobs: { company: string; role: string; exp_required: string | null; description: string }[],
  batchNum: number,
  totalBatches: number
): Promise<ExperienceExtraction[]> {
  const jobList = jobs.map((j, i) =>
    `JOB ${i + 1}:
Company: ${j.company}
Role: ${j.role}
Email exp label (UNRELIABLE): ${j.exp_required || "Not specified"}
Description:
${j.description.substring(0, 2000)}`
  ).join("\n\n---\n\n");

  const staticInstructions = `CRITICAL RULES (follow strictly):
1. Always extract the MINIMUM/REQUIRED level — never the "preferred", "nice to have", or "advantage" level.
2. If both required and preferred are stated (e.g. "required: 2+ years" AND "preferred: 3-5 years") → use "2+ years".
3. For ranges like "2-5 years" → use the lower bound: "2+ years".
4. Sections labeled "Requirements", "Must have", "Qualifications" = required.
5. Sections labeled "Nice to have", "Preferred", "Advantage", "Bonus" = optional — ignore these for this task.
6. The email exp label is UNRELIABLE — read the description, not the label.
7. If the job title contains "Student", "Intern", "Trainee" → that is the experience level even if the description is vague.

Hebrew patterns to find:
- "ניסיון של X שנים" / "לפחות X שנים" / "X שנות ניסיון" → "X+ years"
- "סטודנט" / "בוגר טרי" / "ללא ניסיון" / "התמחות" → "Student/Intern"
- "ג'וניור" → "Junior"
- "מידלוול" / "מיד לוול" → "Mid-level"

Standardized output values — use exactly one of:
"Student/Intern", "Entry level", "Junior", "1-2 years", "2+ years", "3+ years", "5+ years", "Mid-level", "Not specified"

Use "Not specified" ONLY if the description truly contains no experience signal anywhere.

Return ONLY valid JSON, ASCII only:
{
  "results": [
    {
      "job_index": 1,
      "actual_exp_required": "...",
      "evidence": "exact quote from description that led to this answer (max 100 chars)"
    }
  ]
}`;

  let data: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: [{ type: "text", text: "You are a job experience-level extraction specialist. Your ONLY task is to find the MINIMUM required experience level from each job description.", cache_control: { type: "ephemeral" } }],
        messages: [{
          role: "user",
          content: [
            { type: "text", text: staticInstructions, cache_control: { type: "ephemeral" } },
            { type: "text", text: `===== JOBS =====\n${jobList}\n===== END =====` },
          ],
        }],
      }),
    });
    data = await resp.json();
    if (data.content?.[0]?.text) break;
    if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
  }

  if (!data.content?.[0]?.text) {
    console.error(`[exp] Batch ${batchNum}/${totalBatches}: no response from Claude`);
    return jobs.map((_, i) => ({ job_index: i + 1, actual_exp_required: "Not specified", evidence: "extraction failed" }));
  }

  const text = data.content[0].text;
  const startIdx = text.indexOf("{");
  if (startIdx === -1) return jobs.map((_, i) => ({ job_index: i + 1, actual_exp_required: "Not specified", evidence: "no JSON returned" }));

  let depth = 0, jsonStr = "";
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    jsonStr += ch;
    if (depth === 0) break;
  }
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1").replace(/[^\x20-\x7E\n\r\t]/g, "");

  try {
    const parsed = JSON.parse(jsonStr);
    return (parsed.results || []) as ExperienceExtraction[];
  } catch {
    return jobs.map((_, i) => ({ job_index: i + 1, actual_exp_required: "Not specified", evidence: "JSON parse failed" }));
  }
}

async function extractAllExperienceLevels(
  jobs: { company: string; role: string; exp_required: string | null; description: string }[]
): Promise<ExperienceExtraction[]> {
  const BATCH_SIZE = 10;
  const allResults: ExperienceExtraction[] = [];
  const totalBatches = Math.ceil(jobs.length / BATCH_SIZE);

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`[exp] Batch ${batchNum}/${totalBatches}: extracting experience levels for ${batch.length} jobs...`);

    const results = await extractExperienceLevelsBatch(batch, batchNum, totalBatches);
    const offset = i;
    const reindexed = results.map(r => ({ ...r, job_index: r.job_index + offset }));
    allResults.push(...reindexed);

    for (const r of reindexed) {
      const job = jobs[r.job_index - 1];
      if (job) console.log(`  [exp] ${job.company} — ${job.role}: "${r.actual_exp_required}" (${r.evidence.substring(0, 80)})`);
    }
  }

  return allResults;
}

async function generateCandidateProfile(cvText: string, city: string): Promise<CandidateProfile> {
  const truncatedCV = cvText.length > 12000 ? cvText.substring(0, 12000) + "\n[CV TRUNCATED]" : cvText;

  const prompt = `You are an expert HR analyst. Read this CV and extract a structured candidate profile.

===== CV =====
${truncatedCV}
===== END CV =====

Return ONLY valid JSON (ASCII only, no Hebrew, no special characters):
{
  "name": "candidate full name",
  "experience_level": "student OR fresh_graduate OR junior OR mid OR senior",
  "years_of_experience": 0,
  "skills": ["list", "every", "explicit", "skill", "tool", "language", "framework"],
  "education_field": "e.g. Industrial Engineering and Management",
  "degree_level": "Bachelor OR Master OR PhD OR Associate",
  "graduation_year": null,
  "domains": ["e.g. data analytics", "supply chain", "business intelligence"],
  "city": "${city || "extract from CV"}",
  "languages": ["e.g. Hebrew", "English"],
  "job_type": "student_position OR internship OR full_time_junior OR full_time_mid OR full_time_senior"
}

Rules for experience_level:
- student: currently enrolled in university, 0-1 year work experience
- fresh_graduate: recently graduated, <1 year work experience
- junior: 1-3 years full-time work experience
- mid: 3-6 years full-time work experience
- senior: 6+ years

Be exhaustive with skills — list every tool, language, framework, and software explicitly mentioned.`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await resp.json();
  const text = data.content?.[0]?.text || "";
  const startIdx = text.indexOf("{");
  if (startIdx === -1) throw new Error("No JSON in profile response");
  let depth = 0, jsonStr = "";
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    jsonStr += ch;
    if (depth === 0) break;
  }
  jsonStr = jsonStr.replace(/[^\x20-\x7E\n\r\t]/g, "");
  return JSON.parse(jsonStr) as CandidateProfile;
}

async function rescoreJobBatch(jobs: JobRow[], profile: CandidateProfile, descriptions: string[], experienceLevels: ExperienceExtraction[], batchStartIndex: number, scoringHints = ""): Promise<ScoredJob[]> {
  const hardRules = buildHardRejectionRules(profile);

  const jobList = jobs.map((j, i) => {
    const absoluteIndex = batchStartIndex + i + 1;
    const exp = experienceLevels.find(e => e.job_index === absoluteIndex);
    return `JOB ${i + 1}:
Company: ${j.company}
Role: ${j.role}
Location: ${j.location || "unknown"}
Email Exp Label (unreliable): ${j.exp_required || "not specified"}
Pre-extracted Experience Requirement: ${exp?.actual_exp_required || "Not specified"} (evidence: "${exp?.evidence || "n/a"}")
Job Description:
${(descriptions[i] || "Not available").substring(0, 3000)}`;
  }).join("\n\n---\n\n");

  const staticContent = `===== CANDIDATE PROFILE =====
Name: ${profile.name}
Experience Level: ${profile.experience_level} (${profile.years_of_experience} year(s) total work experience)
Education: ${profile.degree_level} in ${profile.education_field}${profile.graduation_year ? `, graduating ${profile.graduation_year}` : ""}
Skills: ${profile.skills.join(", ")}
Domains: ${profile.domains.join(", ")}
City: ${profile.city}
Languages: ${profile.languages.join(", ")}
Seeking: ${profile.job_type}
===== END PROFILE =====

${hardRules}

STEP 1 — EXPERIENCE REQUIREMENT (PRE-EXTRACTED):
A dedicated experience extraction agent has already identified the minimum required experience for each job. It is provided in the job data as "Pre-extracted Experience Requirement". Use this value directly — do NOT re-extract from the description. Only override if the pre-extracted value is obviously wrong given the job title (e.g. title says "Student" but extraction says "3+ years").

Use the Pre-extracted Experience Requirement as your actual_exp_required in the output.

STEP 2 — Apply hard rejection rules using the pre-extracted actual_exp_required, NOT the email label.

STEP 3 — For jobs NOT hard-rejected, score out of 10 using the job description to evaluate each factor:

FACTOR 1 — SKILLS MATCH (0-3 pts)
Read the job description and identify what skills/tools are required. Then check how many the candidate has.
- 3 pts: 80%+ of requirements covered by candidate's skills
- 2 pts: 50-79% covered
- 1 pt: 25-49% covered
- 0 pts: <25% covered — most required skills missing
Only count skills listed in the candidate profile. Do not infer.

FACTOR 2 — EXPERIENCE LEVEL FIT (0-5 pts) — PRIMARY FACTOR
This is the most important factor. Seniority mismatch is a hard blocker regardless of skills.
${buildFactor2Examples(profile)}

FACTOR 3 — FIELD RELEVANCE (0-1 pt)
- 1 pt: Job domain matches candidate's domains or education
- 0 pts: Unrelated

FACTOR 4 — LOCATION FIT (0-1 pt)
Candidate city: ${profile.city}
- 1 pt: Same city, commutable (~40 km), or same metro
- 0 pts: Different region or explicitly remote/WFH

PRIORITY from score:
- HIGH: 8-10
- MEDIUM: 5-7
- LOW: 2-4
- REJECTED: 0-1

HIRING PROBABILITY (0-10) — Realistic chance of getting a recruiter response:
- Experience fit: perfect level match +3, acceptable gap +1, large gap -3
- Company prestige barrier: Big tech (Google/Meta/Amazon/Apple/Microsoft/Nvidia) for student/junior = max 4; mid-size tech = up to 7; startups/SMBs = up to 9
- Junior-friendliness: explicit "student"/"graduate"/"entry-level" language +2; no junior signals at senior-heavy company -2
- Skills overlap: strong technical match +2; weak match -2
- Role clarity: clear specific JD = easier to target (higher); vague JD = lower
Scale: 9-10=excellent shot, 7-8=good chance, 5-6=possible but competitive, 3-4=long shot, 1-2=very unlikely, 0=essentially impossible

AI REPLACEABILITY RISK — How automatable is this role in the next 3-5 years?
- High: primarily manual reporting, data entry, Excel copy-paste, ERP ticketing, basic ops coordination
- Medium: business analyst, generalist ops, standard BI reporting, coordinator roles
- Low: data engineering, ML/AI roles, automation builder, product analytics, technical roles requiring judgment or creativity

REASON — 5 sentences, strategic and specific:
1. Skills: which specific tools/skills from the profile match the JD requirements (name them)
2. Gap: main missing skill or experience concern
3. Strategic value: why this role does or doesn't compound the candidate's skills and career trajectory
4. Hiring probability: one sentence explaining the probability score (company type, experience fit, competition level)
5. Verdict: clear final recommendation

Be specific. Name actual tools and cities. No generic sentences.

${scoringHints ? `\n${scoringHints}\n` : ""}
Return ONLY valid JSON. ASCII only — no Hebrew, no special quotes, no newlines inside strings:
{
  "results": [
    {
      "job_index": 1,
      "actual_exp_required": "",
      "score": 0,
      "priority": "",
      "hiring_probability": 0,
      "ai_risk": "Low",
      "reason": ""
    }
  ]
}`;

  let data: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: [{ type: "text", text: "You are an expert job-fit analyst. Score each job against the candidate profile. The job descriptions are the primary source of truth — use them to identify required skills, domain, and seniority.", cache_control: { type: "ephemeral" } }],
        messages: [{
          role: "user",
          content: [
            { type: "text", text: staticContent, cache_control: { type: "ephemeral" } },
            { type: "text", text: `===== JOBS TO SCORE =====\n${jobList}\n===== END JOBS =====` },
          ],
        }],
      }),
    });
    data = await resp.json();
    if (data.content?.[0]?.text) break;
    if (attempt < 3) {
      console.warn(`Claude returned no content (attempt ${attempt}/3), retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (!data.content?.[0]?.text) throw new Error("Claude returned no content after 3 attempts");

  const text = data.content[0].text;
  const startIdx = text.indexOf("{");
  if (startIdx === -1) throw new Error("No JSON in response");
  let depth = 0, jsonStr = "";
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    jsonStr += ch;
    if (depth === 0) break;
  }
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1").replace(/[^\x20-\x7E\n\r\t]/g, "");

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Failed to parse Claude JSON for batch");
  }

  return (parsed.results || []).map((r: any) => ({
    id: jobs[r.job_index - 1]?.id,
    score: r.score,
    priority: r.priority,
    hiring_probability: r.hiring_probability ?? null,
    ai_risk: r.ai_risk || null,
    reason: r.reason,
    actual_exp_required: r.actual_exp_required || null,
  })).filter((r: ScoredJob) => r.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let debug: ReturnType<typeof createDebugLogger> | null = null;

  try {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isServiceCall = token === serviceRoleKey;

  let userId: string;

  if (isServiceCall) {
    const body = await req.json().catch(() => ({}));
    userId = body.userId;
    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    userId = user.id;
  }

  debug = createDebugLogger("reanalyze-jobs", supabase, userId, "edge_function");

  const body = await req.json().catch(() => ({}));
  const forceAll: boolean = body?.forceAll === true;
  const offset: number = body?.offset || 0;

  // Fetch user profile
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("cv_text, city, candidate_profile, scoring_feedback")
    .eq("id", userId)
    .single();

  const cvText = (profile as any)?.cv_text || "";
  if (!cvText) {
    return new Response(JSON.stringify({ error: "No CV found. Please upload your CV in Settings." }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Load or generate candidate profile
  let candidateProfile: CandidateProfile = (profile as any)?.candidate_profile as CandidateProfile;
  if (!candidateProfile) {
    console.log("Generating candidate profile from CV...");
    candidateProfile = await generateCandidateProfile(cvText, (profile as any)?.city || "");
    await supabase.from("user_profiles").update({ candidate_profile: candidateProfile }).eq("id", userId);
    console.log(`Profile generated — level: ${candidateProfile.experience_level}, skills: ${candidateProfile.skills.length}`);
  } else {
    console.log(`Using cached profile — level: ${candidateProfile.experience_level}, city: ${candidateProfile.city}`);
  }
  const scoringHints: string = (profile as any)?.scoring_feedback?.scoring_hints || "";

  const MAX_JOBS_PER_RUN = 20;

  // Get total count first, then fetch the current page
  let countQuery = supabase.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (!forceAll) countQuery = countQuery.neq("priority", "REJECTED");
  const { count: totalCount } = await countQuery;
  const total = totalCount || 0;

  let query = supabase
    .from("jobs")
    .select("id, company, role, location, exp_required, description, linkedin_id, job_link")
    .eq("user_id", userId);
  if (!forceAll) query = query.neq("priority", "REJECTED");
  query = query.range(offset, offset + MAX_JOBS_PER_RUN - 1);

  const { data: jobs, error: jobsError } = await query;
  if (jobsError) {
    return new Response(JSON.stringify({ error: jobsError.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ updated: 0, total, remaining: 0, message: "No jobs to re-score" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const jobsToProcess = jobs as JobRow[];
  const nextOffset = offset + jobsToProcess.length;
  const remaining = Math.max(0, total - nextOffset);
  console.log(`Re-scoring ${jobsToProcess.length} jobs (offset=${offset}, total=${total}, remaining after=${remaining})...`);

  // 10 jobs per batch, run all batches in parallel (max 5 batches = max 5 concurrent Claude calls)
  const BATCH_SIZE = 10;
  const batches: JobRow[][] = [];
  for (let i = 0; i < jobsToProcess.length; i += BATCH_SIZE) {
    batches.push(jobsToProcess.slice(i, i + BATCH_SIZE));
  }

  console.log(`Running ${batches.length} batch(es) sequentially...`);

  // Resolve all descriptions first
  const allDescriptions: string[] = [];
  const newDescriptionMap = new Map<string, string>();

  for (let idx = 0; idx < batches.length; idx++) {
    const batch = batches[idx];
    console.log(`Batch ${idx + 1}/${batches.length}: resolving descriptions for ${batch.length} jobs...`);
    const descriptions = await Promise.all(batch.map(job => resolveDescription(job)));
    batch.forEach((job, i) => {
      if ((!job.description || job.description.length < 100) && descriptions[i]) {
        newDescriptionMap.set(job.id, descriptions[i]);
      }
    });
    allDescriptions.push(...descriptions);
  }

  // Extract experience levels for all jobs with dedicated agent
  console.log("[exp] Extracting experience levels...");
  const expInputs = jobsToProcess.map((j, i) => ({
    company: j.company,
    role: j.role,
    exp_required: j.exp_required,
    description: allDescriptions[i] || "",
  }));
  const experienceLevels = await extractAllExperienceLevels(expInputs);
  console.log(`[exp] Done — ${experienceLevels.length} levels extracted`);

  // Score all batches using pre-extracted experience levels
  const allScored: ScoredJob[] = [];
  for (let idx = 0; idx < batches.length; idx++) {
    const batch = batches[idx];
    const batchDescriptions = allDescriptions.slice(idx * BATCH_SIZE, idx * BATCH_SIZE + batch.length);
    console.log(`Batch ${idx + 1}/${batches.length}: scoring...`);
    const scored = await rescoreJobBatch(batch, candidateProfile, batchDescriptions, experienceLevels, idx * BATCH_SIZE, scoringHints);
    console.log(`Batch ${idx + 1}/${batches.length}: done`);
    allScored.push(...scored);
  }

  // Re-derive priority from score, but preserve Claude's REJECTED (hard rules applied)
  for (const job of allScored) {
    if (job.priority === "REJECTED") {
      // Keep REJECTED — hard rejection rule was applied, score may still be > 0 for skills info
    } else if (job.score >= 8) job.priority = "HIGH";
    else if (job.score >= 5) job.priority = "MEDIUM";
    else if (job.score >= 2) job.priority = "LOW";
    else job.priority = "REJECTED";
  }

  const updates = await Promise.all(
    allScored
      .filter(j => j.id)
      .map(j => {
        const freshDescription = newDescriptionMap.get(j.id);
        return supabase
          .from("jobs")
          .update({
            score: j.score,
            priority: j.priority,
            hiring_probability: j.hiring_probability ?? null,
            ai_risk: j.ai_risk || null,
            reason: j.reason,
            ...(freshDescription ? { description: freshDescription } : {}),
            ...(j.actual_exp_required ? { exp_required: j.actual_exp_required } : {}),
          })
          .eq("id", j.id)
          .eq("user_id", userId);
      })
  );

  const errorCount = updates.filter(u => u.error).length;
  const updated = updates.length - errorCount;

  console.log(`Re-score complete: ${updated}/${jobsToProcess.length} updated, ${errorCount} errors, ${remaining} remaining`);

  return new Response(
    JSON.stringify({ updated, total, processed: jobsToProcess.length, remaining, nextOffset, errors: errorCount }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
  } catch (err: any) {
    console.error("Unhandled error:", err?.message || err);
    const debugId = debug ? await debug.critical(`Reanalyze failed: ${err?.message || "Unknown error"}`, err) : undefined;
    return new Response(
      JSON.stringify({ error: err?.message || "Internal server error", ...(debugId ? { debugId } : {}) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
