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
  if (!data.access_token) throw new Error("Failed to get Google access token: " + JSON.stringify(data));
  return data.access_token;
}

async function fetchJobAlertEmails(accessToken: string): Promise<string[]> {
  const after = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  const query = encodeURIComponent(`label:Job Alerts after:${after}`);
  const listResp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const listData = await listResp.json();
  if (!listData.messages || listData.messages.length === 0) return [];

  const emails: string[] = [];
  for (const msg of listData.messages) {
    const msgResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const msgData = await msgResp.json();
    const subject = msgData.payload?.headers?.find((h: any) => h.name === "Subject")?.value || "";
    const from = msgData.payload?.headers?.find((h: any) => h.name === "From")?.value || "";
    const body = extractEmailBody(msgData.payload);
    emails.push(`From: ${from}\nSubject: ${subject}\n\n${body}`);
  }
  return emails;
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return atob(base64);
  } catch {
    return "";
  }
}

function extractEmailBody(payload: any): string {
  if (!payload) return "";

  // Direct body data on the payload itself
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart: recurse into parts, prefer text/plain then text/html
  if (payload.parts && payload.parts.length > 0) {
    let plainText = "";
    let htmlText = "";
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        plainText = decodeBase64Url(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data) {
        htmlText = decodeBase64Url(part.body.data);
      } else if (part.parts) {
        // Nested multipart (e.g. multipart/alternative inside multipart/mixed)
        const nested = extractEmailBody(part);
        if (nested) plainText = plainText || nested;
      }
    }
    // Prefer plain text; fall back to HTML with tags stripped
    if (plainText) return plainText;
    if (htmlText) return htmlText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  return "";
}

async function fetchCVFromDrive(accessToken: string): Promise<string> {
  const query = encodeURIComponent("name='Dor_Kochevsky_CV_Main'");
  const searchResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchResp.json();
  if (!searchData.files || searchData.files.length === 0) return "CV not found on Google Drive";

  const file = searchData.files[0];
  let exportUrl: string;
  if (file.mimeType === "application/vnd.google-apps.document") {
    exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
  } else {
    exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
  }
  const cvResp = await fetch(exportUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  return await cvResp.text();
}

interface JobFromClaude {
  company: string;
  role: string;
  location: string;
  score: number;
  priority: string;
  exp_required: string;
  job_link: string;
  linkedin_id: string;
  reason: string;
  status: string;
}

async function analyzeWithClaude(emails: string[], cvText: string): Promise<JobFromClaude[]> {
  // Truncate inputs to keep token count manageable
  const truncatedCV = cvText.length > 6000 ? cvText.substring(0, 6000) + "\n[CV TRUNCATED]" : cvText;
  const truncatedEmails = emails.map(e => e.length > 3000 ? e.substring(0, 3000) + "\n[EMAIL TRUNCATED]" : e);
  const emailContent = truncatedEmails.join("\n\n---\n\n");

  const prompt = `You are a strict job-fit scoring assistant. Your task is to extract jobs from email alerts and score each one against the candidate's ACTUAL CV.

STEP 1 — Read the CV below carefully. Extract:
- Real experience level (years, internships, student jobs)
- Actual technical skills listed
- Education level and field
- Languages spoken

STEP 2 — Extract up to 15 unique jobs from the email alerts below. If there are more than 15, pick the most relevant ones.

STEP 3 — For each job, score fit 1-10 using this STRICT rubric:
- 9-10: PERFECT FIT — job explicitly targets students/graduates, matches CV skills exactly, no experience required
- 7-8: GOOD FIT — entry level, 0-2 years exp, mostly matches CV skills and field
- 5-6: POSSIBLE FIT — junior but not explicit about students, partial skills match
- 3-4: WEAK FIT — some experience required (1-3 years), or field is tangential to CV
- 1-2: REJECTED — senior role, wrong field entirely, requires experience candidate clearly doesn't have

BE STRICT. Most jobs should score 4-6. Only score 8+ if the job EXPLICITLY targets students or fresh graduates AND matches CV skills. Justify every score.

STEP 4 — Assign priority based on score:
- HIGH: score 7-10 (strong junior fit)
- MEDIUM: score 5-6 (possible fit)
- LOW: score 3-4 (weak fit)
- REJECTED: score 1-2 (filtered out)

STEP 5 — Auto-REJECT (score 1, priority REJECTED) if:
- Title contains Senior/Lead/Principal/Manager/Director/Head/Staff/Architect
- Requires 3+ years experience
- Completely unrelated to data/analytics/operations/IE/business analysis/project management

For each job provide: company, role, location, job_link (use the BASE URL only — remove all tracking parameters like trackingId, refId, lipi, midToken, trk etc. If no clean URL exists, use empty string), exp_required, reason.

REASON FORMAT (mandatory — follow this exactly):
"Score X — [why this score]. [experience required vs Dor's level as 3rd year IE student]. [specific skills match/mismatch from CV]."
Example good reason: "Score 7 — entry-level data analyst, 0-1yr exp fits Dor's student status. Requires SQL and Excel which Dor has. Operations focus matches IE background."
Example bad reason: "Good fit for candidate" — NEVER write vague reasons like this.

Keep job_link URLs short (base URL only, no tracking params).

===== CANDIDATE CV =====
${truncatedCV}

===== RECENT JOB ALERT EMAILS =====
${emailContent}

Return ONLY valid JSON with no trailing commas:
{
  "jobs": [{
    "company": "", "role": "", "location": "", "score": 0, "priority": "", "exp_required": "", "job_link": "", "reason": "", "status": "New"
  }]
}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await resp.json();
  if (!data.content?.[0]?.text) throw new Error("Claude returned no content: " + JSON.stringify(data));

  const text = data.content[0].text;
  
  // Try to extract JSON robustly by finding balanced braces
  let jsonStr = "";
  const startIdx = text.indexOf("{");
  if (startIdx === -1) throw new Error("No JSON found in Claude response");
  
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    jsonStr += ch;
    if (depth === 0) break;
  }
  
  // Clean common JSON issues: trailing commas before ] or }
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");
  
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e: any) {
    // Response was likely truncated — try to salvage by finding the last complete job object
    console.error("JSON parse failed, attempting salvage. Error:", e.message);
    
    // Find the last complete "}" before the truncation point
    const lastCompleteObj = jsonStr.lastIndexOf('"status": "New"');
    if (lastCompleteObj > 0) {
      // Find the closing brace of that object
      const closingBrace = jsonStr.indexOf("}", lastCompleteObj);
      if (closingBrace > 0) {
        const salvaged = jsonStr.substring(0, closingBrace + 1) + "]}";
        try {
          parsed = JSON.parse(salvaged.replace(/,\s*([}\]])/g, "$1"));
          console.log(`Salvaged ${parsed.jobs?.length || 0} jobs from truncated response`);
        } catch {
          // Last resort: try to extract individual job objects
          console.error("Salvage also failed");
          throw new Error("Failed to parse Claude JSON: " + e.message);
        }
      } else {
        throw new Error("Failed to parse Claude JSON: " + e.message);
      }
    } else {
      throw new Error("Failed to parse Claude JSON: " + e.message);
    }
  }
  
  return parsed.jobs || [];
}

async function generateCVForJob(job: any, cvText: string): Promise<string> {
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

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
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

  const data = await resp.json();
  return data.content?.[0]?.text || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("EXTERNAL_SUPABASE_URL")!,
    Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!
  );

  let jobsFound = 0;
  let jobsAdded = 0;

  try {
    // 1. Get Google access token
    const accessToken = await getGoogleAccessToken();

    // 2. Fetch emails
    const emails = await fetchJobAlertEmails(accessToken);
    if (emails.length === 0) {
      // No emails, save scan and return
      await supabase.from("scan_runs").insert({
        success: true,
        jobs_found: 0,
        jobs_added: 0,
      });
      return new Response(JSON.stringify({ jobs_found: 0, jobs_added: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Fetch CV from Drive
    const cvText = await fetchCVFromDrive(accessToken);

    // 4. Analyze with Claude
    const jobs = await analyzeWithClaude(emails, cvText);
    jobsFound = jobs.length;

    // 5. Post-process: enforce hard scoring rules
    const SENIOR_TITLES = /\b(senior|lead|principal|manager|director|head|vp|staff|architect)\b/i;
    const HIGH_EXP = /\b(3\+|4\+|5\+|6\+|7\+|8\+|3-5|5-7|3 years|4 years|5 years)\b/i;
    const RELEVANT_FIELDS = /\b(data|analy|operations|business|project.?manag|supply.?chain|logistics|industrial.?engineer|BI|reporting|excel|sql|python|planning|procurement)\b/i;

    for (const job of jobs) {
      const title = (job.role || '').trim();
      const exp = (job.exp_required || '').trim();

      // Hard rule: senior titles → max score 3, REJECTED
      if (SENIOR_TITLES.test(title)) {
        job.score = Math.min(job.score, 3);
        job.priority = "REJECTED";
        if (!job.reason.includes("senior")) {
          job.reason = `Score ${job.score} — title contains senior-level keyword, not suitable for student. ${job.reason}`;
        }
      }

      // Hard rule: high experience → max score 3, REJECTED
      if (HIGH_EXP.test(exp)) {
        job.score = Math.min(job.score, 3);
        job.priority = "REJECTED";
        if (!job.reason.includes("experience")) {
          job.reason = `Score ${job.score} — requires ${exp} experience, Dor is a 3rd year student. ${job.reason}`;
        }
      }

      // Hard rule: unrelated field → max score 4, LOW
      if (!RELEVANT_FIELDS.test(title) && !RELEVANT_FIELDS.test(job.reason)) {
        job.score = Math.min(job.score, 4);
        if (job.priority !== "REJECTED") job.priority = "LOW";
      }

      // Ensure priority matches score
      if (job.score <= 2) job.priority = "REJECTED";
      else if (job.score <= 4 && job.priority !== "REJECTED") job.priority = "LOW";
      else if (job.score <= 6 && job.priority === "HIGH") job.priority = "MEDIUM";
    }

    // 6. Clean up job links and insert new jobs — skip duplicates entirely
    for (const job of jobs) {
      // Normalize LinkedIn URLs: remove /comm/ and strip query params
      if (job.job_link) {
        job.job_link = job.job_link.replace(/linkedin\.com\/comm\/jobs/gi, "linkedin.com/jobs");
        // Strip query params from LinkedIn job URLs, keeping just the path
        job.job_link = job.job_link.replace(/(linkedin\.com\/jobs\/view\/\d+\/?)(\?.*)?$/i, "$1");
      }

      const link = job.job_link?.trim().toLowerCase();
      const hasValidLink = link && link.startsWith("http");
      const fingerprint = hasValidLink
        ? `link::${link}`
        : `meta::${(job.company || '').trim().toLowerCase()}__${(job.role || '').trim().toLowerCase()}__${(job.location || '').trim().toLowerCase()}`;

      // Check by fingerprint — if exists, skip entirely
      const { data: existing } = await supabase
        .from("jobs")
        .select("id")
        .eq("fingerprint", fingerprint)
        .limit(1)
        .maybeSingle();

      if (existing) continue;

      // Also check by company + role to catch near-duplicates
      const { data: byCompanyRole } = await supabase
        .from("jobs")
        .select("id")
        .ilike("company", (job.company || '').trim())
        .ilike("role", (job.role || '').trim())
        .limit(1)
        .maybeSingle();

      if (byCompanyRole) continue;

      // New job — insert
      const { error: insertError } = await supabase.from("jobs").insert({
        company: job.company,
        role: job.role,
        location: job.location,
        score: job.score,
        priority: job.priority,
        reason: job.reason,
        exp_required: job.exp_required,
        job_link: job.job_link,
        status: job.status || "New",
        fingerprint,
        alert_date: new Date().toISOString(),
      });

      // If unique constraint catches it, just skip
      if (insertError) {
        if (insertError.code === "23505") continue; // unique violation
        console.error("Insert error:", insertError);
      } else {
        jobsAdded++;
      }
    }

    // 6. Auto-generate CVs for high-scoring jobs
    const { data: highScoreJobs } = await supabase
      .from("jobs")
      .select("*")
      .gt("score", 6)
      .is("tailored_cv", null)
      .neq("priority", "REJECTED");

    if (highScoreJobs && highScoreJobs.length > 0) {
      for (const hsJob of highScoreJobs) {
        try {
          const tailoredCV = await generateCVForJob(hsJob, cvText);
          if (tailoredCV) {
            await supabase.from("jobs").update({ tailored_cv: tailoredCV }).eq("id", hsJob.id);
          }
          // Wait 4 seconds between CV generations
          await new Promise((r) => setTimeout(r, 4000));
        } catch (e) {
          console.error(`CV generation failed for job ${hsJob.id}:`, e);
        }
      }
    }

    // 7. Save scan result
    await supabase.from("scan_runs").insert({
      success: true,
      jobs_found: jobsFound,
      jobs_added: jobsAdded,
    });

    return new Response(JSON.stringify({ jobs_found: jobsFound, jobs_added: jobsAdded }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Scan error:", error);
    await supabase.from("scan_runs").insert({
      success: false,
      jobs_found: jobsFound,
      jobs_added: jobsAdded,
      error_text: error.message || "Unknown error",
    });
    return new Response(JSON.stringify({ error: error.message || "Scan failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
