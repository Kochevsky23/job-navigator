import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { createDebugLogger } from "../_shared/debug.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Strip env var names, key patterns, and internal URLs from error text before storing
function sanitizeErrorText(msg: string): string {
  return msg
    .replace(/SUPABASE[_A-Z]*/g, "[ENV]")
    .replace(/CLAUDE[_A-Z]*/g, "[ENV]")
    .replace(/GOOGLE[_A-Z]*/g, "[ENV]")
    .replace(/RESEND[_A-Z]*/g, "[ENV]")
    .replace(/sk-[A-Za-z0-9-_]{10,}/g, "[KEY]")
    .replace(/Bearer [A-Za-z0-9._-]{20,}/g, "Bearer [TOKEN]")
    .replace(/https?:\/\/[^\s"']+/g, (url) => {
      try { return new URL(url).origin + "/[path]"; } catch { return "[URL]"; }
    });
}

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface EmailMessage {
  subject: string;
  from: string;
  body: string;
  internalDate: number;
}

interface ExtractedJob {
  company: string;
  role: string;
  location: string;
  linkedin_id: string;
  job_link: string;
  company_domain: string;
  exp_required: string;
  email_context: string; // snippet from email for AI fallback
}

interface JobWithDescription extends ExtractedJob {
  description: string;
  description_source: "linkedin" | "careers_page" | "email_context";
}

interface ScoredJob extends JobWithDescription {
  score: number;
  priority: string;
  reason: string;
  status: string;
  low_confidence?: boolean;
}

interface ExperienceExtraction {
  job_index: number;
  actual_exp_required: string;
  evidence: string;
}

// ─── Gmail helpers ────────────────────────────────────────────────────────────

async function getGoogleAccessToken(refreshToken: string): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await resp.json();
  if (!data.access_token) {
    if (data.error === "invalid_grant") throw new Error("GMAIL_RECONNECT_REQUIRED");
    throw new Error("Failed to get Google access token: " + JSON.stringify(data));
  }
  return data.access_token;
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try { return atob(base64); } catch { return ""; }
}

function extractEmailBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts?.length > 0) {
    let plainText = "";
    let htmlText = "";
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) plainText = decodeBase64Url(part.body.data);
      else if (part.mimeType === "text/html" && part.body?.data) htmlText = decodeBase64Url(part.body.data);
      else if (part.parts) { const nested = extractEmailBody(part); if (nested) plainText = plainText || nested; }
    }
    if (plainText) return plainText;
    if (htmlText) return htmlText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

// Strip footer boilerplate before sending to Claude — reduces noise and frees token budget.
function cleanEmailBody(body: string): string {
  return body
    .replace(/unsubscribe[\s\S]{0,400}$/im, "")
    .replace(/manage (email )?preferences[\s\S]{0,200}$/im, "")
    .replace(/view (this email|in browser)[\s\S]{0,100}/im, "")
    .replace(/\s{4,}/g, "\n\n")
    .trim()
    .slice(0, 5000);
}

// Emails whose first 600 chars match these patterns are notifications, not job listings.
const NON_JOB_BODY = /people viewed your profile|you applied to|your application (was|has been)|complete your profile|profile completeness|you have \d+ new connection|accepted your connection|commented on your post|liked your post|manage email preferences|you're all set|account created|password (reset|changed)|verify your email/i;

async function fetchJobAlertEmails(accessToken: string, afterTimestamp: number): Promise<EmailMessage[]> {
  const query = encodeURIComponent(
    `(label:"Job Alerts" OR from:jobs-noreply@linkedin.com OR from:jobalerts-noreply@linkedin.com OR from:noreply@indeed.com OR from:noreply@jobnet.co.il OR from:alerts@glassdoor.com) after:${afterTimestamp}`
  );

  const emails: EmailMessage[] = [];
  let pageToken: string | undefined;

  do {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const listResp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const listData = await listResp.json();
    if (!listData.messages || listData.messages.length === 0) break;

    const msgResponses = await Promise.all(
      listData.messages.map((msg: any) =>
        fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then(r => r.json())
      )
    );

    for (const msgData of msgResponses) {
      const subject = msgData.payload?.headers?.find((h: any) => h.name === "Subject")?.value || "";
      const from = msgData.payload?.headers?.find((h: any) => h.name === "From")?.value || "";
      const internalDate = parseInt(msgData.internalDate || "0", 10);
      const body = extractEmailBody(msgData.payload);
      emails.push({ subject, from, body, internalDate });
    }

    pageToken = listData.nextPageToken;
  } while (pageToken && emails.length < 200);

  const JOB_SENDERS = /linkedin\.com|indeed\.com|jobnet\.co\.il|glassdoor\.com|alljob\.co\.il|drushim\.co\.il|jobmaster\.co\.il|comeet\.com|smartrecruiters\.com|lever\.co|greenhouse\.io|workable\.com/i;
  const JOB_SUBJECTS = /job|position|role|hiring|career|vacanc|analyst|engineer|developer|operations|student|intern|משרה|עבודה|דרוש|לתפקיד/i;

  const jobEmails = emails.filter(e => JOB_SENDERS.test(e.from) || JOB_SUBJECTS.test(e.subject));

  // Body-based filter: drop emails whose opening text matches known non-job patterns
  const alertEmails = jobEmails.filter(e => {
    if (e.body.length < 80) return false;
    return !NON_JOB_BODY.test(e.body.slice(0, 600));
  });
  console.log(`[GMAIL] ${emails.length} fetched → ${jobEmails.length} job-filter → ${alertEmails.length} body-filter`);

  return alertEmails.sort((a, b) => a.internalDate - b.internalDate);
}

// ─── Candidate profile ────────────────────────────────────────────────────────

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
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
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

// ─── Hard rejection rules ─────────────────────────────────────────────────────

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

// ─── Stage 1: Extract job metadata from emails (no scoring) ───────────────────

async function extractJobsFromEmails(emailTexts: string[]): Promise<ExtractedJob[]> {
  const emailContent = emailTexts
    .map(e => e.length > 5000 ? e.substring(0, 5000) + "\n[TRUNCATED]" : e)
    .join("\n\n---\n\n");

  const prompt = `You are a job listing extractor. Extract every job listing from these job alert emails.

STEP 1 — Extract ALL job listings. Many emails are digests with multiple job cards — extract every single one.
STEP 2 — Translate ALL titles and fields to English (e.g. "סטודנט לחשבונאות" → "Student Accounting Position").
STEP 3 — For each job, capture:
- company: company name in English
- role: job title in English (translate accurately — "חשבונאות" = Accounting, "הנדסה" = Engineering, "פיתוח" = Development, etc.)
- location: city/region in English
- linkedin_id: numeric LinkedIn job ID from a URL like /jobs/view/1234567890 (empty string if not LinkedIn)
- job_link: direct company careers page URL if present; empty string if only LinkedIn URL
- company_domain: company website domain e.g. "wix.com" (empty string if unknown)
- exp_required: experience level label as written (e.g. "Student level", "Entry level", "Junior", "Mid-level", "Not specified")
- email_context: a 1-2 sentence summary of this job from the email (company, role, what they do)

Return ONLY valid JSON, ASCII only, no Hebrew in output:
{
  "jobs": [
    {
      "company": "",
      "role": "",
      "location": "",
      "linkedin_id": "",
      "job_link": "",
      "company_domain": "",
      "exp_required": "",
      "email_context": ""
    }
  ]
}

===== JOB ALERT EMAILS =====
${emailContent}
===== END =====`;

  let data: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
    });
    data = await resp.json();
    if (data.content?.[0]?.text) break;
    if (attempt < 3) {
      console.warn(`[extract] No content (attempt ${attempt}/3, type=${data.type}, stop=${data.stop_reason}), retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (!data.content?.[0]?.text) {
    console.error(`[extract] Claude error after 3 attempts: type=${data.type}, error=${JSON.stringify(data.error)}, stop=${data.stop_reason}`);
    throw new Error("Claude returned no content in extraction after 3 attempts");
  }

  const text = data.content[0].text;
  const startIdx = text.indexOf("{");
  if (startIdx === -1) return [];
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
    return (parsed.jobs || []) as ExtractedJob[];
  } catch {
    // JSON parse failed — retry once using assistant prefill to force valid JSON output.
    console.warn("[extract] JSON parse failed, retrying with assistant prefill...");
    const PREFILL = '{"jobs": [';
    const retryResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          { role: "user", content: prompt },
          { role: "assistant", content: PREFILL },
        ],
      }),
    });
    const retryData = await retryResp.json();
    const retryText = retryData.content?.[0]?.text;
    if (!retryText) return [];
    const retryFull = (PREFILL + retryText).replace(/,\s*([}\]])/g, "$1").replace(/[^\x20-\x7E\n\r\t]/g, "");
    try {
      const parsed = JSON.parse(retryFull);
      console.log(`[extract] Prefill retry succeeded: ${(parsed.jobs || []).length} jobs`);
      return (parsed.jobs || []) as ExtractedJob[];
    } catch {
      console.error("[extract] Prefill retry also failed, returning empty");
      return [];
    }
  }
}

// ─── Stage 2: Fetch job description ──────────────────────────────────────────

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

    // Extract the main description block
    const markupMatch = html.match(/class="show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (markupMatch) {
      const text = stripHtml(markupMatch[1]);
      if (text.length > 100) return text.substring(0, 3000);
    }

    // Fallback: description section
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

    // Try common job description containers
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

    // Generic fallback: strip full page and return first meaty block
    const stripped = stripHtml(html);
    const lines = stripped.split("\n").filter(l => l.trim().length > 40);
    if (lines.length > 5) return lines.slice(0, 40).join("\n").substring(0, 3000);

    return null;
  } catch {
    return null;
  }
}

async function fetchJobDescription(job: ExtractedJob): Promise<{ description: string; source: "linkedin" | "careers_page" | "email_context" }> {
  // 1. Try LinkedIn
  if (job.linkedin_id) {
    const desc = await fetchLinkedInDescription(job.linkedin_id);
    if (desc) {
      console.log(`  [desc] LinkedIn OK: ${job.company} — ${job.role}`);
      return { description: desc, source: "linkedin" };
    }
    console.log(`  [desc] LinkedIn failed for ${job.linkedin_id}`);
  }

  // 2. Try company careers page
  if (job.job_link && job.job_link.startsWith("http") && !job.job_link.includes("linkedin.com")) {
    const desc = await fetchCareersPageDescription(job.job_link);
    if (desc) {
      console.log(`  [desc] Careers page OK: ${job.company} — ${job.role}`);
      return { description: desc, source: "careers_page" };
    }
    console.log(`  [desc] Careers page failed for ${job.job_link}`);
  }

  // 3. Fall back to email context — honest uncertainty beats hallucinated content
  console.log(`  [desc] Email context fallback: ${job.company} — ${job.role}`);
  const desc = job.email_context || `${job.role} at ${job.company}, ${job.location}. Experience required: ${job.exp_required || "not specified"}.`;
  return { description: desc, source: "email_context" };
}

// Fetch descriptions for all jobs, 10 at a time in parallel
async function fetchAllDescriptions(jobs: ExtractedJob[]): Promise<JobWithDescription[]> {
  const CONCURRENCY = 10;
  const results: JobWithDescription[] = [];

  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(async job => {
        const { description, source } = await fetchJobDescription(job);
        return { ...job, description, description_source: source };
      })
    );
    results.push(...fetched);
    console.log(`[desc] Batch ${Math.floor(i / CONCURRENCY) + 1}: fetched ${fetched.length} descriptions`);
  }

  return results;
}

// ─── Stage 2.5: Extract experience level (dedicated agent) ───────────────────

async function extractExperienceLevelsBatch(jobs: JobWithDescription[], batchNum: number, totalBatches: number): Promise<ExperienceExtraction[]> {
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

async function extractAllExperienceLevels(jobs: JobWithDescription[]): Promise<ExperienceExtraction[]> {
  const BATCH_SIZE = 10;
  const allResults: ExperienceExtraction[] = [];
  const totalBatches = Math.ceil(jobs.length / BATCH_SIZE);

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`[exp] Batch ${batchNum}/${totalBatches}: extracting experience levels for ${batch.length} jobs...`);

    const results = await extractExperienceLevelsBatch(batch, batchNum, totalBatches);

    // Re-index results to be absolute (not batch-relative)
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

// ─── Stage 3: Score jobs with descriptions ────────────────────────────────────

async function scoreJobBatch(jobs: JobWithDescription[], profile: CandidateProfile, experienceLevels: ExperienceExtraction[], batchStartIndex: number, scoringHints = ""): Promise<ScoredJob[]> {
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
Description Source: ${j.description_source}
Job Description:
${j.description.substring(0, 3000)}`;
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
- 0 pts: Unrelated domain

FACTOR 4 — LOCATION FIT (0-1 pt)
Candidate city: ${profile.city}
- 1 pt: Same city, commutable (~40 km), or same metro
- 0 pts: Different region or explicitly remote/WFH

PRIORITY from score:
- HIGH: 8-10
- MEDIUM: 5-7
- LOW: 2-4
- REJECTED: 0-1

REASON — Exactly 6-8 sentences:
1. Which skills from the profile match what the job description requires (name them)
2. What the job description requires that is NOT in the profile
3. Experience level comparison
4. Location: distance from ${profile.city}
5. Domain/field match
6. Key strength for this role
7. Main risk or concern
8. Final recommendation

Be specific. Name actual tools and cities. No generic sentences.

${scoringHints ? `\n${scoringHints}\n` : ""}
Return ONLY valid JSON, ASCII only:
{
  "results": [
    {
      "job_index": 1,
      "actual_exp_required": "",
      "score": 0,
      "priority": "",
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
        max_tokens: 6144,
        system: [{ type: "text", text: "You are an expert job-fit analyst. Score each job against the candidate profile. The job descriptions are the primary source of truth for scoring — use them carefully.", cache_control: { type: "ephemeral" } }],
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
    if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
  }
  if (!data.content?.[0]?.text) throw new Error("Claude returned no content after 3 attempts");

  const text = data.content[0].text;
  const startIdx = text.indexOf("{");
  if (startIdx === -1) throw new Error("No JSON in scoring response");
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
  try { parsed = JSON.parse(jsonStr); } catch { throw new Error("Failed to parse scoring JSON"); }

  return (parsed.results || []).map((r: any) => {
    const job = jobs[r.job_index - 1];
    if (!job) return null;
    return { ...job, score: r.score, priority: r.priority, reason: r.reason, status: "New", actual_exp_required: r.actual_exp_required || null };
  }).filter(Boolean) as ScoredJob[];
}

async function scoreAllJobs(jobs: JobWithDescription[], profile: CandidateProfile, scoringHints = ""): Promise<ScoredJob[]> {
  // Extract experience levels with dedicated agent before scoring
  console.log("[exp] Extracting experience levels...");
  const experienceLevels = await extractAllExperienceLevels(jobs);
  console.log(`[exp] Done — ${experienceLevels.length} levels extracted`);

  const BATCH_SIZE = 10;
  const batches: JobWithDescription[][] = [];
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    batches.push(jobs.slice(i, i + BATCH_SIZE));
  }

  const allScored: ScoredJob[] = [];
  for (let idx = 0; idx < batches.length; idx++) {
    console.log(`[score] Batch ${idx + 1}/${batches.length}: scoring ${batches[idx].length} jobs...`);
    try {
      const scored = await scoreJobBatch(batches[idx], profile, experienceLevels, idx * BATCH_SIZE, scoringHints);
      allScored.push(...scored);
      console.log(`[score] Batch ${idx + 1}/${batches.length}: done`);
    } catch (err: any) {
      console.error(`[score] Batch ${idx + 1}/${batches.length}: FAILED — ${err.message}. Skipping batch.`);
    }
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

  return allScored;
}

// ─── Email digest ─────────────────────────────────────────────────────────────

interface FollowupJob { company: string; role: string; applied_at: string; }

async function sendEmailDigest(userEmail: string, addedJobs: ScoredJob[], followupJobs: FollowupJob[] = []): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return;
  if (addedJobs.length === 0 && followupJobs.length === 0) return;

  // Top 5 by score: HIGH first, then MEDIUM to fill slots
  const sorted = [...addedJobs].sort((a, b) => b.score - a.score);
  const topJobs = sorted.slice(0, 5);
  const hasHigh = topJobs.some(j => j.priority === "HIGH");
  const subheading = hasHigh ? "Top HIGH priority matches:" : "Top matches from this scan:";

  const newJobsSection = topJobs.length > 0 ? `
      <h2 style="color:#00f08e;margin-top:0">Job Compass — ${addedJobs.length} new job${addedJobs.length !== 1 ? "s" : ""} found</h2>
      <p style="color:#aaa;margin-bottom:16px">${subheading}</p>
      <table style="width:100%;border-collapse:collapse;table-layout:fixed">
        <thead><tr style="background:#1a1a2e;border-bottom:2px solid #00f08e">
          <th style="padding:10px 8px;width:22%;text-align:left;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap">Company</th>
          <th style="padding:10px 8px;width:40%;text-align:left;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase">Role</th>
          <th style="padding:10px 8px;width:13%;text-align:center;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap">Score</th>
          <th style="padding:10px 8px;width:25%;text-align:left;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase">Location</th>
        </tr></thead>
        <tbody>${topJobs.map(j => `
    <tr style="border-bottom:1px solid #2a2a3a">
      <td style="padding:10px 8px;width:22%;color:#00f08e;font-weight:700;font-size:14px">${j.company}</td>
      <td style="padding:10px 8px;width:42%;color:#e8e8f0;font-size:14px">${j.role}</td>
      <td style="padding:10px 8px;width:10%;text-align:center;font-weight:700;color:#00f08e;font-size:15px">${j.score}/10</td>
      <td style="padding:10px 8px;width:26%;color:#aaaacc;font-size:13px">${j.location}</td>
    </tr>`).join("")}</tbody>
      </table>` : "";

  const followupSection = followupJobs.length > 0 ? `
      <h3 style="color:#f0a500;margin-top:28px;margin-bottom:8px">Follow-up Reminders</h3>
      <p style="color:#aaa;font-size:13px;margin-bottom:12px">These applications haven't had a response in 7+ days — consider following up:</p>
      ${followupJobs.map(j => {
        const days = Math.floor((Date.now() - new Date(j.applied_at).getTime()) / 86400000);
        return `<div style="background:#1a1a2e;border-left:3px solid #f0a500;padding:10px 14px;margin-bottom:8px;border-radius:4px">
          <span style="color:#f0a500;font-weight:700;font-size:14px">${j.company}</span>
          <span style="color:#aaa;font-size:13px;margin-left:8px">${j.role}</span>
          <span style="color:#666;font-size:12px;margin-left:8px">${days} days ago</span>
        </div>`;
      }).join("")}` : "";

  const html = `
    <div style="background:#0e0e1a;font-family:sans-serif;padding:32px;border-radius:12px;max-width:600px">
      ${newJobsSection}
      ${followupSection}
      <p style="margin-top:24px;font-size:13px;color:#888">Open Job Compass to view all jobs and apply.</p>
    </div>`;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: "Job Compass <onboarding@resend.dev>",
        to: [userEmail],
        subject: `Job Compass: ${addedJobs.length} new job${addedJobs.length !== 1 ? "s" : ""}${hasHigh ? ` — HIGH priority matches` : ""}${followupJobs.length > 0 ? ` · ${followupJobs.length} follow-up` : ""}`,
        html,
      }),
    });
    console.log(`Email digest sent to ${userEmail}`);
  } catch (e: any) {
    console.error("Failed to send email digest:", e.message);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isServiceCall = token === serviceRoleKey;

  let userId: string;
  let userEmail: string | undefined;

  if (isServiceCall) {
    const body = await req.json().catch(() => ({}));
    userId = body.userId;
    userEmail = body.userEmail;
    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required for service calls" }), {
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
    userEmail = user.email;
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("cv_text, full_name, city, google_refresh_token, last_email_scan_timestamp, candidate_profile, scoring_feedback")
    .eq("id", userId)
    .single();

  const storedTimestamp = (profile as any)?.last_email_scan_timestamp || 0;
  const fallbackAfter = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const afterTimestamp = storedTimestamp > 0 ? storedTimestamp : fallbackAfter;
  console.log(`Scanning emails after: ${new Date(afterTimestamp * 1000).toISOString()}`);

  const debug = createDebugLogger("daily-scan", supabase, userId, "edge_function");

  let jobsFound = 0;
  let jobsAdded = 0;
  let maxEmailTimestampSec = 0; // hoisted so catch block can advance the timestamp on failure

  try {
    const refreshToken = (profile as any)?.google_refresh_token;
    if (!refreshToken) throw new Error("Gmail not connected. Please connect your Gmail account in Settings.");

    console.log("[1] Getting Google access token...");
    const accessToken = await getGoogleAccessToken(refreshToken);

    console.log("[2] Fetching emails...");
    const emails = await fetchJobAlertEmails(accessToken, afterTimestamp);
    console.log(`[2] Got ${emails.length} emails`);

    if (emails.length === 0) {
      await supabase.from("scan_runs").insert({ user_id: userId, success: true, jobs_found: 0, jobs_added: 0 });
      return new Response(
        JSON.stringify({ jobs_found: 0, jobs_added: 0, jobs_skipped_duplicate: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const MAX_EMAILS_PER_SCAN = 20;
    const emailsToProcess = emails.slice(0, MAX_EMAILS_PER_SCAN);
    maxEmailTimestampSec = Math.floor(emailsToProcess[emailsToProcess.length - 1].internalDate / 1000);

    const cvText = (profile as any)?.cv_text || "";
    if (!cvText) throw new Error("No CV found. Please upload your CV in Settings.");
    const candidateCity = (profile as any)?.city || "";

    let candidateProfile: CandidateProfile = (profile as any)?.candidate_profile as CandidateProfile;
    if (!candidateProfile) {
      console.log("[3] Generating candidate profile from CV...");
      candidateProfile = await generateCandidateProfile(cvText, candidateCity);
      await supabase.from("user_profiles").update({ candidate_profile: candidateProfile }).eq("id", userId);
    } else {
      console.log(`[3] Using cached profile — level: ${candidateProfile.experience_level}`);
    }
    const scoringHints: string = (profile as any)?.scoring_feedback?.scoring_hints || "";

    // Stage 1: Extract job metadata from emails (5 emails per batch, parallel)
    console.log("[4] Extracting jobs from emails...");
    const EXTRACT_BATCH = 5;
    const emailTexts = emailsToProcess.map(e => `From: ${e.from}\nSubject: ${e.subject}\n\n${cleanEmailBody(e.body)}`);
    const extractBatches: string[][] = [];
    for (let i = 0; i < emailTexts.length; i += EXTRACT_BATCH) {
      extractBatches.push(emailTexts.slice(i, i + EXTRACT_BATCH));
    }

    const extractResults = await Promise.all(
      extractBatches.map((batch, idx) => {
        console.log(`[4] Extract batch ${idx + 1}/${extractBatches.length}...`);
        return extractJobsFromEmails(batch).catch((err: any) => {
          console.error(`[4] Extract batch ${idx + 1} failed: ${err.message}. Skipping.`);
          return [] as ExtractedJob[];
        });
      })
    );
    const allExtracted: ExtractedJob[] = extractResults.flat();
    console.log(`[4] Extracted ${allExtracted.length} jobs total`);

    if (allExtracted.length === 0) {
      await supabase.from("user_profiles").update({ last_email_scan_timestamp: maxEmailTimestampSec }).eq("id", userId);
      await supabase.from("scan_runs").insert({ user_id: userId, success: true, jobs_found: 0, jobs_added: 0 });
      return new Response(
        JSON.stringify({ jobs_found: 0, jobs_added: 0, jobs_skipped_duplicate: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cap jobs to score: each scoring batch takes ~45s, and we have ~95s left after extraction.
    // That allows exactly 2 batches (20 jobs). Cap here before fetching descriptions too.
    const MAX_JOBS_TO_SCORE = 10; // 2 scoring batches × ~50s each hits the 150s timeout; 1 batch keeps us at ~90s
    const jobsToProcess = allExtracted.length > MAX_JOBS_TO_SCORE
      ? allExtracted.slice(0, MAX_JOBS_TO_SCORE)
      : allExtracted;
    if (allExtracted.length > MAX_JOBS_TO_SCORE) {
      console.log(`[4] Capping to ${MAX_JOBS_TO_SCORE} jobs for scoring (extracted ${allExtracted.length})`);
    }

    // Stage 2: Fetch job descriptions (10 concurrent)
    console.log("[5] Fetching job descriptions...");
    const jobsWithDescriptions = await fetchAllDescriptions(jobsToProcess);
    const linkedinCount = jobsWithDescriptions.filter(j => j.description_source === "linkedin").length;
    const careersCount = jobsWithDescriptions.filter(j => j.description_source === "careers_page").length;
    const emailCtxCount = jobsWithDescriptions.filter(j => j.description_source === "email_context").length;
    console.log(`[5] Descriptions: ${linkedinCount} LinkedIn, ${careersCount} careers page, ${emailCtxCount} email context`);

    // Stage 3: Score jobs with descriptions (10 per batch, sequential)
    console.log("[6] Scoring jobs...");
    const scoredJobs = await scoreAllJobs(jobsWithDescriptions, candidateProfile, scoringHints);
    jobsFound = scoredJobs.length;
    console.log(`[6] Scored ${jobsFound} jobs`);

    // Build DB rows
    const rowsToUpsert = scoredJobs.map(job => {
      if (job.job_link) {
        const linkedinMatch = job.job_link.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i);
        if (linkedinMatch) {
          if (!job.linkedin_id) job.linkedin_id = linkedinMatch[1];
          job.job_link = "";
        }
      }
      if (job.linkedin_id) {
        const idMatch = job.linkedin_id.match(/(\d+)/);
        job.linkedin_id = idMatch ? idMatch[1] : "";
      }
      const linkedinFp = job.linkedin_id ? `linkedin::${job.linkedin_id}` : "";
      const linkFp = job.job_link?.trim().toLowerCase();
      const hasValidLink = linkFp && linkFp.startsWith("http");
      const fingerprint = linkedinFp
        || (hasValidLink ? `link::${linkFp}` : `meta::${(job.company || "").trim().toLowerCase()}__${(job.role || "").trim().toLowerCase()}__${(job.location || "").trim().toLowerCase()}`);

      return {
        user_id: userId,
        company: job.company,
        role: job.role,
        location: job.location,
        score: job.score,
        priority: job.priority,
        reason: job.reason,
        exp_required: (job as any).actual_exp_required || job.exp_required,
        description: job.description || null,
        job_link: (job.job_link?.trim() && job.job_link.trim().startsWith("http")) ? job.job_link : null,
        linkedin_id: job.linkedin_id || null,
        company_domain: job.company_domain || null,
        status: job.status || "New",
        fingerprint,
        alert_date: new Date().toISOString(),
        _is_low_confidence: job.description_source === "email_context",
      };
    });

    // Separate low_confidence flag from upsert payload to avoid schema cache issues
    const upsertPayload = rowsToUpsert.map(({ _is_low_confidence: _, ...row }) => row);
    const lowConfidenceFingerprints = rowsToUpsert
      .filter(r => r._is_low_confidence)
      .map(r => r.fingerprint);

    const { data: upserted, error: upsertError } = await supabase
      .from("jobs")
      .upsert(upsertPayload, { onConflict: "fingerprint", ignoreDuplicates: true })
      .select("fingerprint");

    if (upsertError) {
      await debug.error(`DB upsert failed`, new Error(upsertError.message), { jobsFound });
      console.error("Upsert error:", upsertError.message);
    } else {
      jobsAdded = upserted?.length || 0;
      console.log(`[7] Upserted: ${jobsAdded} new, ${rowsToUpsert.length - jobsAdded} duplicates skipped`);
      // Mark email-context jobs as low_confidence in a separate pass (tolerates schema cache lag)
      if (lowConfidenceFingerprints.length > 0) {
        try {
          await supabase.from("jobs")
            .update({ low_confidence: true })
            .in("fingerprint", lowConfidenceFingerprints);
        } catch { /* non-critical — column may not be in schema cache yet */ }
      }
    }

    // Always advance the timestamp so the next scan doesn't reprocess these emails
    await supabase.from("user_profiles").update({ last_email_scan_timestamp: maxEmailTimestampSec }).eq("id", userId);
    await supabase.from("scan_runs").insert({ user_id: userId, success: true, jobs_found: jobsFound, jobs_added: jobsAdded });

    if (userEmail) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: followupJobs } = await supabase
        .from("jobs")
        .select("company, role, applied_at")
        .eq("user_id", userId)
        .eq("status", "Applied")
        .lt("applied_at", sevenDaysAgo)
        .order("applied_at", { ascending: true })
        .limit(5);
      await sendEmailDigest(userEmail, scoredJobs.filter(j => j.priority !== "REJECTED"), followupJobs || []);
    }

    console.log(`Scan complete: found=${jobsFound}, added=${jobsAdded}`);
    return new Response(
      JSON.stringify({ jobs_found: jobsFound, jobs_added: jobsAdded, jobs_skipped_duplicate: jobsFound - jobsAdded, description_sources: { linkedin: linkedinCount, careers_page: careersCount, email_context: emailCtxCount } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Scan error:", error);
    const debugId = await debug.critical(`Scan failed: ${error.message || "Unknown error"}`, error, { jobsFound, jobsAdded });
    // Advance timestamp even on failure so next scan doesn't reprocess the same emails
    if (typeof maxEmailTimestampSec !== "undefined" && maxEmailTimestampSec > 0) {
      await supabase.from("user_profiles").update({ last_email_scan_timestamp: maxEmailTimestampSec }).eq("id", userId);
      console.log(`[catch] Advanced timestamp to ${maxEmailTimestampSec} despite error`);
    }
    await supabase.from("scan_runs").insert({
      user_id: userId,
      success: false,
      jobs_found: jobsFound,
      jobs_added: jobsAdded,
      error_text: sanitizeErrorText(error.message || "Unknown error"),
    });
    return new Response(
      JSON.stringify({ error: error.message || "Scan failed", debugId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
