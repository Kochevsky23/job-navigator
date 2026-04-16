import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  if (!data.access_token) throw new Error("Failed to get Google access token: " + JSON.stringify(data));
  return data.access_token;
}

async function fetchJobAlertEmails(accessToken: string, afterTimestamp: number): Promise<string[]> {
  const query = encodeURIComponent(`label:Job Alerts after:${afterTimestamp}`);
  const listResp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const listData = await listResp.json();
  if (!listData.messages || listData.messages.length === 0) return [];

  // Fetch all messages in parallel instead of sequentially
  const msgResponses = await Promise.all(
    listData.messages.map((msg: any) =>
      fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      ).then(r => r.json())
    )
  );

  return msgResponses.map((msgData: any) => {
    const subject = msgData.payload?.headers?.find((h: any) => h.name === "Subject")?.value || "";
    const from = msgData.payload?.headers?.find((h: any) => h.name === "From")?.value || "";
    const body = extractEmailBody(msgData.payload);
    return `From: ${from}\nSubject: ${subject}\n\n${body}`;
  });
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
  company_domain: string;
  reason: string;
  status: string;
}

async function analyzeWithClaude(emails: string[], cvText: string): Promise<JobFromClaude[]> {
  // Use more CV text for better matching, and more per-email for digest emails
  const truncatedCV = cvText.length > 10000 ? cvText.substring(0, 10000) + "\n[CV TRUNCATED]" : cvText;
  const truncatedEmails = emails.map(e => e.length > 10000 ? e.substring(0, 10000) + "\n[EMAIL TRUNCATED]" : e);
  const emailContent = truncatedEmails.join("\n\n---\n\n");

  const prompt = `You are an expert job-fit analyst. Your task is to extract EVERY job listing from the emails and score each one carefully against the candidate's CV.

===== CANDIDATE CV =====
${truncatedCV}
===== END CV =====

STEP 1 — Read the CV thoroughly and note:
- Candidate's city (for location scoring)
- Years of experience and current student status
- Every technical skill, tool, and language explicitly mentioned
- Education field and degree level
- Industry domains they have worked in

STEP 2 — Extract EVERY job listing from the emails below.
IMPORTANT: Many emails are digest-style and contain MULTIPLE job listings. You MUST extract every single job you find — do not stop at 30. Extract up to 60 jobs total.
Each job listing usually has: company name, job title, location, and a link.

STEP 3 — Score each job on 4 factors (max 10 total):

FACTOR 1 — CV SKILLS MATCH (0-4 pts)
Read the job's stated requirements carefully. Compare each requirement against what is explicitly in the CV.
- 4 pts: 80%+ of stated requirements are directly covered by the CV (exact skills, tools, experience)
- 3 pts: 60-80% of requirements covered
- 2 pts: 40-60% covered
- 1 pt: 20-40% covered
- 0 pts: less than 20% covered
Be specific — only count skills that are actually in the CV, not assumed.

FACTOR 2 — EXPERIENCE LEVEL FIT (0-3 pts)
- 3 pts: explicitly says "student", "internship", "entry level", "0-1 years", "fresh graduate", "50%", "משרת סטודנט", "התמחות"
- 2 pts: "junior", "1-2 years", or no experience requirement stated
- 1 pt: "2-3 years experience"
- 0 pts: "3+ years", or title contains Senior/Lead/Principal/Manager/Director/Head/VP/Staff/Architect → force REJECTED

FACTOR 3 — LOCATION (0-2 pts)
Use the candidate's city from the CV.
- 2 pts: same city as candidate OR within 10km
- 1 pt: commutable distance (~40km, e.g. Tel Aviv metro area from Kfar Saba)
- 0 pts: far away (Haifa, Jerusalem, Be'er Sheva, south) OR remote → remote = force REJECTED

FACTOR 4 — FIELD RELEVANCE (0-1 pt)
- 1 pt: data analysis, BI, business intelligence, analytics, business analysis, operations, industrial engineering, supply chain, logistics, product, finance analytics, data science, reporting
- 0 pts: unrelated (pure sales, HR, marketing only, civil/mechanical engineering, law, etc.)

PRIORITY:
- HIGH: 8-10
- MEDIUM: 5-7
- LOW: 3-4
- REJECTED: 1-2, OR senior/manager title, OR remote, OR 3+ years required

REASON (mandatory, 3-4 sentences):
Sentence 1: List the specific skills/experience from the CV that match this job's requirements (be specific with tool/skill names).
Sentence 2: State what requirements from the job are missing or only partially covered in the CV.
Sentence 3: Assess the experience level fit and location.
Sentence 4: Overall verdict — why this is or isn't a good fit.
Example: "Your SQL data pipeline work at Noogata and KPI dashboard experience directly match the data analysis requirements. Python and Excel are listed in both CV and job, though the job also requires Tableau which is not in your CV. Entry-level position fits your student status, and Tel Aviv is commutable from Kfar Saba. Strong overall match — the missing Tableau skill is learnable and should not be a blocker."
Do NOT write vague reasons. Be specific to THIS candidate's CV and THIS job's requirements.

LINK EXTRACTION:
- job_link: direct company careers URL only. Empty string if none found.
- linkedin_id: numeric ID from LinkedIn URL only (e.g. "4385024025"). Empty string if none.
- NEVER put a linkedin.com URL in job_link.

COMPANY DOMAIN: the company's main website domain. Use your knowledge of the company.

===== JOB ALERT EMAILS =====
${emailContent}
===== END EMAILS =====

Return ONLY valid JSON. ASCII characters only (no Hebrew, no special quotes, no newlines inside strings):
{
  "jobs": [{
    "company": "", "role": "", "location": "", "score": 0, "priority": "", "exp_required": "", "job_link": "", "linkedin_id": "", "company_domain": "", "reason": "", "status": "New"
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
  // Remove control characters that break JSON (keep spaces)
  jsonStr = jsonStr.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e: any) {
    console.error("JSON parse failed, attempting regex extraction. Error:", e.message);
    
    try {
      // Extract individual job objects using regex
      const jobMatches: any[] = [];
      const jobRegex = /"company"\s*:\s*"([^"]*)"\s*,\s*"role"\s*:\s*"([^"]*)"\s*,\s*"location"\s*:\s*"([^"]*)"\s*,\s*"score"\s*:\s*(\d+)\s*,\s*"priority"\s*:\s*"([^"]*)"\s*,\s*"exp_required"\s*:\s*"([^"]*)"\s*,\s*"job_link"\s*:\s*"([^"]*)"\s*,\s*"linkedin_id"\s*:\s*"([^"]*)"\s*,\s*"company_domain"\s*:\s*"([^"]*)"\s*,\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"status"\s*:\s*"([^"]*)"/g;
      
      let match;
      while ((match = jobRegex.exec(jsonStr)) !== null) {
        jobMatches.push({
          company: match[1], role: match[2], location: match[3],
          score: parseInt(match[4]), priority: match[5], exp_required: match[6],
          job_link: match[7], linkedin_id: match[8], company_domain: match[9],
          reason: match[10], status: match[11]
        });
      }
      
      if (jobMatches.length > 0) {
        parsed = { jobs: jobMatches };
        console.log(`Regex-extracted ${jobMatches.length} jobs from malformed JSON`);
      } else {
        // Fallback: truncation salvage
        const lastComplete = jsonStr.lastIndexOf('"status"');
        if (lastComplete > 0) {
          const closingBrace = jsonStr.indexOf("}", lastComplete);
          if (closingBrace > 0) {
            const salvaged = jsonStr.substring(0, closingBrace + 1) + "]}";
            parsed = JSON.parse(salvaged.replace(/,\s*([}\]])/g, "$1"));
            console.log(`Salvaged ${parsed.jobs?.length || 0} jobs`);
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
    } catch {
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

  // Use Cloud Supabase (auto-set env vars)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Extract user from JWT
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = user.id;

  // Fetch user's profile for CV text and Gmail credentials
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("cv_text, full_name, city, google_refresh_token")
    .eq("id", userId)
    .single();

  // Determine how far back to look — since last successful scan, or 48h fallback
  const { data: lastScan } = await supabase
    .from("scan_runs")
    .select("started_at")
    .eq("user_id", userId)
    .eq("success", true)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fallbackAfter = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
  const afterTimestamp = lastScan?.started_at
    ? Math.floor(new Date(lastScan.started_at).getTime() / 1000)
    : fallbackAfter;
  console.log(`Scanning emails after: ${new Date(afterTimestamp * 1000).toISOString()} (${lastScan ? "last scan" : "48h fallback"})`);

  let jobsFound = 0;
  let jobsAdded = 0;
  const skippedDetails: { company: string; role: string; reason: string }[] = [];

  try {
    // 1. Get Google access token — use user's own token, fall back to shared env var
    const refreshToken = (profile as any)?.google_refresh_token || Deno.env.get("GOOGLE_REFRESH_TOKEN");
    if (!refreshToken) {
      throw new Error("Gmail not connected. Please connect your Gmail account in Settings.");
    }
    console.log("Step 1: Getting Google access token...");
    const accessToken = await getGoogleAccessToken(refreshToken);
    console.log("Step 1: OK");

    // 2. Fetch emails since last scan
    console.log("Step 2: Fetching emails...");
    const emails = await fetchJobAlertEmails(accessToken, afterTimestamp);
    console.log(`Step 2: Got ${emails.length} emails`);
    if (emails.length === 0) {
      await supabase.from("scan_runs").insert({
        user_id: userId,
        success: true,
        jobs_found: 0,
        jobs_added: 0,
      });
      return new Response(JSON.stringify({ jobs_found: 0, jobs_added: 0, jobs_skipped_duplicate: 0, jobs_skipped_error: 0, skipped_details: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Get CV text — prefer user's stored CV, fallback to Google Drive
    let cvText = profile?.cv_text || "";
    console.log(`Step 3: CV from profile: ${cvText ? cvText.length + " chars" : "none, fetching from Drive"}`);
    if (!cvText) {
      cvText = await fetchCVFromDrive(accessToken);
      console.log(`Step 3: CV from Drive: ${cvText.length} chars`);
    }

    // 4. Analyze with Claude
    console.log("Step 4: Calling Claude...");
    const jobs = await analyzeWithClaude(emails, cvText);
    console.log(`Step 4: Claude returned ${jobs.length} jobs`);
    jobsFound = jobs.length;

    // 5. Post-process: enforce hard scoring rules
    const SENIOR_TITLES = /\b(senior|lead|principal|manager|director|head|vp|staff|architect)\b/i;
    const HIGH_EXP = /\b(3\+|4\+|5\+|6\+|7\+|8\+|3-5|5-7|3 years|4 years|5 years)\b/i;
    const RELEVANT_FIELDS = /\b(data|analy|operations|business|project.?manag|supply.?chain|logistics|industrial.?engineer|BI|reporting|excel|sql|python|planning|procurement|product)\b/i;
    const REMOTE_JOB = /\b(remote|עבודה מרחוק|work from home|WFH)\b/i;

    for (const job of jobs) {
      const title = (job.role || '').trim();
      const exp = (job.exp_required || '').trim();
      const location = (job.location || '').trim();

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

      // Hard rule: remote jobs → REJECTED
      if (REMOTE_JOB.test(location) || REMOTE_JOB.test(title)) {
        job.priority = "REJECTED";
        if (!job.reason.includes("remote")) {
          job.reason = `${job.reason} [Remote job — auto-rejected per policy.]`;
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
      // Extract linkedin_id from job_link if it's a LinkedIn URL
      if (job.job_link) {
        const linkedinMatch = job.job_link.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i);
        if (linkedinMatch) {
          if (!job.linkedin_id) job.linkedin_id = linkedinMatch[1];
          job.job_link = "";
        }
      }

      // Clean linkedin_id to just digits
      if (job.linkedin_id) {
        const idMatch = job.linkedin_id.match(/(\d+)/);
        job.linkedin_id = idMatch ? idMatch[1] : "";
      }

      // Fallback: if no job_link and we have linkedin_id, construct LinkedIn URL as job_link
      // so every job has at least one working link
      const hasCompanyLink = job.job_link?.trim() && job.job_link.trim().startsWith("http");
      if (!hasCompanyLink && !job.linkedin_id) {
        // No link at all — leave as is (rare edge case)
      }

      // Build fingerprint
      const linkedinFp = job.linkedin_id ? `linkedin::${job.linkedin_id}` : "";
      const linkFp = job.job_link?.trim().toLowerCase();
      const hasValidLink = linkFp && linkFp.startsWith("http");
      const fingerprint = linkedinFp
        || (hasValidLink ? `link::${linkFp}` : `meta::${(job.company || '').trim().toLowerCase()}__${(job.role || '').trim().toLowerCase()}__${(job.location || '').trim().toLowerCase()}`);

      // Check by fingerprint — if exists, skip entirely
      const { data: existing } = await supabase
        .from("jobs")
        .select("id")
        .eq("fingerprint", fingerprint)
        .limit(1)
        .maybeSingle();

      if (existing) {
        console.log(`SKIP duplicate fingerprint: ${job.company} — ${job.role} (fp: ${fingerprint})`);
        skippedDetails.push({ company: job.company, role: job.role, reason: "duplicate_fingerprint" });
        continue;
      }

      // Also check by company + role to catch near-duplicates
      const { data: byCompanyRole } = await supabase
        .from("jobs")
        .select("id")
        .ilike("company", (job.company || '').trim())
        .ilike("role", (job.role || '').trim())
        .limit(1)
        .maybeSingle();

      if (byCompanyRole) {
        console.log(`SKIP duplicate company+role: ${job.company} — ${job.role}`);
        skippedDetails.push({ company: job.company, role: job.role, reason: "duplicate_company_role" });
        continue;
      }

      // New job — insert
      const { error: insertError } = await supabase.from("jobs").insert({
        user_id: userId,
        company: job.company,
        role: job.role,
        location: job.location,
        score: job.score,
        priority: job.priority,
        reason: job.reason,
        exp_required: job.exp_required,
        job_link: (job.job_link?.trim() && job.job_link.trim().startsWith("http")) ? job.job_link : null,
        linkedin_id: job.linkedin_id || null,
        company_domain: job.company_domain || null,
        status: job.status || "New",
        fingerprint,
        alert_date: new Date().toISOString(),
      });

      if (insertError) {
        if (insertError.code === "23505") {
          console.log(`SKIP unique constraint: ${job.company} — ${job.role}`);
          skippedDetails.push({ company: job.company, role: job.role, reason: "duplicate_constraint" });
        } else {
          console.error(`SKIP insert error: ${job.company} — ${job.role}:`, insertError);
          skippedDetails.push({ company: job.company, role: job.role, reason: `error: ${insertError.message}` });
        }
      } else {
        jobsAdded++;
      }
    }

    // 6. Save scan result (CV generation moved to on-demand via generate-cv function)
    await supabase.from("scan_runs").insert({
      user_id: userId,
      success: true,
      jobs_found: jobsFound,
      jobs_added: jobsAdded,
    });

    const skipDuplicate = skippedDetails.filter(s => s.reason.startsWith("duplicate")).length;
    const skipError = skippedDetails.filter(s => s.reason.startsWith("error")).length;

    console.log(`Scan complete: found=${jobsFound}, added=${jobsAdded}, skipped_duplicate=${skipDuplicate}, skipped_error=${skipError}`);
    for (const s of skippedDetails) {
      console.log(`  Skipped: ${s.company} — ${s.role} [${s.reason}]`);
    }

    return new Response(JSON.stringify({
      jobs_found: jobsFound,
      jobs_added: jobsAdded,
      jobs_skipped_duplicate: skipDuplicate,
      jobs_skipped_error: skipError,
      skipped_details: skippedDetails,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Scan error:", error);
    await supabase.from("scan_runs").insert({
      user_id: userId,
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
