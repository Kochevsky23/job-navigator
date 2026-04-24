import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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
  if (!data.access_token) {
    if (data.error === "invalid_grant") throw new Error("GMAIL_RECONNECT_REQUIRED");
    throw new Error("Failed to get Google access token: " + JSON.stringify(data));
  }
  return data.access_token;
}

interface EmailMessage {
  subject: string;
  from: string;
  body: string;
  internalDate: number; // milliseconds
}

async function fetchJobAlertEmails(accessToken: string, afterTimestamp: number): Promise<EmailMessage[]> {
  // afterTimestamp is in seconds (Unix); Gmail `after:` filter also uses seconds
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

    console.log(`[GMAIL] Page: fetching ${listData.messages.length} message(s)`);

    // Fetch all messages in parallel
    const msgResponses = await Promise.all(
      listData.messages.map((msg: any) =>
        fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        ).then(r => r.json())
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

  console.log(`[GMAIL] Total fetched: ${emails.length}`);

  // Pre-filter: keep only emails that are clearly job alerts
  const JOB_SENDERS = /linkedin\.com|indeed\.com|jobnet\.co\.il|glassdoor\.com|alljob\.co\.il|drushim\.co\.il|jobmaster\.co\.il|comeet\.com|smartrecruiters\.com|lever\.co|greenhouse\.io|workable\.com/i;
  const JOB_SUBJECTS = /job|position|role|hiring|career|vacanc|analyst|engineer|developer|operations|student|intern|משרה|עבודה|דרוש|לתפקיד/i;

  const jobEmails = emails.filter(e =>
    JOB_SENDERS.test(e.from) || JOB_SUBJECTS.test(e.subject)
  );
  console.log(`[GMAIL] After job-filter: ${jobEmails.length}/${emails.length}`);

  // Sort oldest-first — we process in chronological order so no opportunities are missed
  return jobEmails.sort((a, b) => a.internalDate - b.internalDate);
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

async function sendEmailDigest(userEmail: string, addedJobs: JobFromClaude[]): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey || addedJobs.length === 0) return;
  const highJobs = addedJobs.filter(j => j.priority === "HIGH").slice(0, 5);
  if (highJobs.length === 0) return;

  const rows = highJobs.map(j => `
    <tr style="border-bottom:1px solid #2a2a3a">
      <td style="padding:10px 8px;font-weight:600">${j.company}</td>
      <td style="padding:10px 8px">${j.role}</td>
      <td style="padding:10px 8px;text-align:center;font-weight:700;color:#00f08e">${j.score}/10</td>
      <td style="padding:10px 8px;color:#888">${j.location}</td>
    </tr>`).join("");

  const html = `
    <div style="background:#0e0e1a;color:#e8e8f0;font-family:sans-serif;padding:32px;border-radius:12px;max-width:600px">
      <h2 style="color:#00f08e;margin-top:0">Job Compass — ${addedJobs.length} new job${addedJobs.length !== 1 ? "s" : ""} found</h2>
      <p style="color:#888">Top HIGH priority matches:</p>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="color:#888;font-size:12px;border-bottom:1px solid #2a2a3a">
          <th style="padding:8px;text-align:left">Company</th>
          <th style="padding:8px;text-align:left">Role</th>
          <th style="padding:8px;text-align:center">Score</th>
          <th style="padding:8px;text-align:left">Location</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:24px;font-size:13px;color:#666">Open Job Compass to view all jobs and apply.</p>
    </div>`;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: "Job Compass <onboarding@resend.dev>",
        to: [userEmail],
        subject: `Job Compass: ${addedJobs.length} new job${addedJobs.length !== 1 ? "s" : ""} — ${highJobs.length} HIGH priority`,
        html,
      }),
    });
    console.log(`Email digest sent to ${userEmail}`);
  } catch (e: any) {
    console.error("Failed to send email digest:", e.message);
  }
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

async function analyzeWithClaude(
  emailTexts: string[],
  cvText: string,
  candidateCity: string
): Promise<JobFromClaude[]> {
  const truncatedCV = cvText.length > 10000 ? cvText.substring(0, 10000) + "\n[CV TRUNCATED]" : cvText;
  const truncatedEmails = emailTexts.map(e => e.length > 6000 ? e.substring(0, 6000) + "\n[EMAIL TRUNCATED]" : e);
  const emailContent = truncatedEmails.join("\n\n---\n\n");

  const prompt = `You are an expert job-fit analyst. Extract EVERY job listing shown in the emails and score each against the candidate's CV.

===== CANDIDATE CV =====
${truncatedCV}
===== END CV =====

CANDIDATE'S CITY: ${candidateCity || "— infer from CV"}

STEP 1 — Read the CV carefully and detect:
- Candidate's city/location (use the provided city above; if blank, infer from CV)
- Experience level: student / fresh graduate / junior (<2 yrs) / mid (2-5 yrs) / senior (5+ yrs)
- Every explicit skill, tool, programming language, and framework written in the CV
- Education field and degree level
- Industry domains and job types in their experience

STEP 2 — Extract EVERY job listing that is shown in the email body. Many emails are digests containing multiple job cards — extract all of them. If a job title is in Hebrew or another language, translate it to English for the "role" field. Extract up to 60 jobs total.

STEP 3 — Score each job out of 10 using these 4 factors:

FACTOR 1 — SKILLS MATCH (0-4 pts) — CRITICAL
Compare the job's required skills/tools with what is explicitly listed in the candidate's CV.
- 4 pts: 80%+ of the job's requirements are explicitly in the CV
- 3 pts: 60-79% covered
- 2 pts: 40-59% covered
- 1 pt: 20-39% covered
- 0 pts: less than 20% covered
Only count skills explicitly written in the CV. Do not assume or infer.

FACTOR 2 — EXPERIENCE LEVEL FIT (0-4 pts) — EQUALLY CRITICAL
How well does the job's required experience match the candidate's actual level from their CV?
- 4 pts: Perfect fit — job targets exactly the candidate's level (e.g., student/intern for a student, junior for a junior)
- 3 pts: Near fit — slight gap, workable
- 2 pts: Partial — job wants 1-2 years more than candidate has
- 1 pt: Significant gap
- 0 pts: Major mismatch (e.g., job requires 3+ years and candidate is a student/fresh graduate, or vice versa)

FACTOR 3 — FIELD RELEVANCE (0-1 pt)
Does this job belong to a domain relevant to the candidate's education and experience?
- 1 pt: Relevant or adjacent field
- 0 pts: Unrelated field

FACTOR 4 — LOCATION FIT (0-1 pt)
Based on the candidate's city (${candidateCity || "see CV"}) and the job's stated location.
- 1 pt: Same city, commutable (~40km), or same metro region
- 0 pts: Different region, different country, or explicitly remote/WFH
Judge distance realistically from the candidate's actual city.

PRIORITY ASSIGNMENT (total out of 10):
- HIGH: 8-10
- MEDIUM: 5-7
- LOW: 2-4
- REJECTED: 0-1

CONTEXTUAL HARD RULES — Apply based on the candidate's level you detect from the CV:

If candidate is a STUDENT or FRESH GRADUATE (no full-time work experience or <1 year):
- Jobs explicitly requiring 3+ years → force REJECTED, score ≤ 1
- Titles with Senior/Lead/Principal/Manager/Director/Head/VP/Architect → force REJECTED, score ≤ 1

If candidate is JUNIOR (1-2 years experience):
- Jobs requiring 5+ years → force REJECTED
- Titles with Director/VP/Head/C-level → force REJECTED

If candidate is MID-LEVEL (3-5 years):
- Titles with VP/C-level → force REJECTED
- Student-only internships → cap at LOW

REASON — Write exactly 6 to 8 sentences covering ALL of these:
1. Which specific skills and tools from the CV match this job's requirements (name them)
2. What skills or requirements this job needs that are NOT in the CV
3. How the experience level requirement compares to the candidate's actual level
4. Location: how far is the job from the candidate's city and is it commutable
5. Field/domain: how closely this job's domain matches the candidate's background
6. A key strength the candidate has for this specific role
7. The main risk or concern about applying
8. Final verdict with a clear recommendation

Be specific. Name actual tools, cities, and companies. No generic sentences.

LINK EXTRACTION:
- job_link: direct company careers URL only. Empty string if none. NEVER put linkedin.com in job_link.
- linkedin_id: numeric ID from LinkedIn job URL (e.g. from "linkedin.com/jobs/view/4385024025" → "4385024025"). Empty string if none.

COMPANY DOMAIN: the company's main website domain (e.g. "wix.com"). Empty string if unknown.

===== JOB ALERT EMAILS =====
${emailContent}
===== END EMAILS =====

Return ONLY valid JSON. ASCII characters only — no Hebrew, no special quotes, no newlines inside string values:
{
  "jobs": [
    {
      "company": "",
      "role": "",
      "location": "",
      "score": 0,
      "priority": "",
      "exp_required": "",
      "job_link": "",
      "linkedin_id": "",
      "company_domain": "",
      "reason": "",
      "status": "New"
    }
  ]
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

  // Extract JSON by matching balanced braces
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

  jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");
  // Strip all non-printable and non-ASCII characters (Hebrew, special quotes, etc.)
  // that break JSON.parse — this is the main source of parse failures
  jsonStr = jsonStr.replace(/[^\x20-\x7E\n\r\t]/g, "");

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e: any) {
    console.error("JSON parse failed:", e.message);
    try {
      // Regex fallback for malformed JSON
      const jobMatches: any[] = [];
      const jobRegex = /"company"\s*:\s*"([^"]*)"\s*,\s*"role"\s*:\s*"([^"]*)"\s*,\s*"location"\s*:\s*"([^"]*)"\s*,\s*"score"\s*:\s*(\d+)\s*,\s*"priority"\s*:\s*"([^"]*)"\s*,\s*"exp_required"\s*:\s*"([^"]*)"\s*,\s*"job_link"\s*:\s*"([^"]*)"\s*,\s*"linkedin_id"\s*:\s*"([^"]*)"\s*,\s*"company_domain"\s*:\s*"([^"]*)"\s*,\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"status"\s*:\s*"([^"]*)"/g;
      let match;
      while ((match = jobRegex.exec(jsonStr)) !== null) {
        jobMatches.push({
          company: match[1], role: match[2], location: match[3],
          score: parseInt(match[4]), priority: match[5], exp_required: match[6],
          job_link: match[7], linkedin_id: match[8], company_domain: match[9],
          reason: match[10], status: match[11],
        });
      }
      if (jobMatches.length > 0) {
        parsed = { jobs: jobMatches };
        console.log(`Regex-extracted ${jobMatches.length} jobs`);
      } else {
        throw e;
      }
    } catch {
      throw new Error("Failed to parse Claude JSON: " + e.message);
    }
  }

  return parsed.jobs || [];
}

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

  // Fetch profile — includes last_email_scan_timestamp for precise windowing
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("cv_text, full_name, city, google_refresh_token, last_email_scan_timestamp")
    .eq("id", userId)
    .single();

  // Determine scan window:
  // - Use last_email_scan_timestamp (internalDate of last processed email, in seconds) if available
  // - Fallback: 7 days ago
  const storedTimestamp = (profile as any)?.last_email_scan_timestamp || 0;
  const fallbackAfter = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const afterTimestamp = storedTimestamp > 0 ? storedTimestamp : fallbackAfter;
  console.log(`Scanning emails after: ${new Date(afterTimestamp * 1000).toISOString()} (${storedTimestamp > 0 ? "last email timestamp" : "7-day fallback"})`);

  let jobsFound = 0;
  let jobsAdded = 0;
  const skippedDetails: { company: string; role: string; reason: string }[] = [];

  try {
    const refreshToken = (profile as any)?.google_refresh_token;
    if (!refreshToken) throw new Error("Gmail not connected. Please connect your Gmail account in Settings.");

    console.log("Step 1: Getting Google access token...");
    const accessToken = await getGoogleAccessToken(refreshToken);
    console.log("Step 1: OK");

    console.log("Step 2: Fetching emails...");
    const emails = await fetchJobAlertEmails(accessToken, afterTimestamp);
    console.log(`Step 2: Got ${emails.length} emails`);

    if (emails.length === 0) {
      await supabase.from("scan_runs").insert({ user_id: userId, success: true, jobs_found: 0, jobs_added: 0 });
      return new Response(
        JSON.stringify({ jobs_found: 0, jobs_added: 0, jobs_skipped_duplicate: 0, jobs_skipped_error: 0, skipped_details: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cap at 60 emails per scan to avoid Supabase's ~60s function timeout.
    // The timestamp is set to the last email we ACTUALLY processed,
    // so the next scan picks up exactly where this one left off.
    const MAX_EMAILS_PER_SCAN = 60;
    const emailsToProcess = emails.slice(0, MAX_EMAILS_PER_SCAN);
    const remaining = emails.length - emailsToProcess.length;
    if (remaining > 0) {
      console.log(`[SCAN] Processing ${emailsToProcess.length}/${emails.length} emails — ${remaining} will be picked up next scan`);
    }

    // last_email_scan_timestamp = internalDate (seconds) of the last email we process this run
    const maxEmailTimestampMs = emailsToProcess[emailsToProcess.length - 1].internalDate;
    const maxEmailTimestampSec = Math.floor(maxEmailTimestampMs / 1000);

    const cvText = (profile as any)?.cv_text || "";
    if (!cvText) throw new Error("No CV found. Please upload your CV in Settings.");
    const candidateCity = (profile as any)?.city || "";
    console.log(`Step 3: CV: ${cvText.length} chars, city: ${candidateCity || "unknown"}`);

    // Convert emails to plain text strings for Claude
    const emailTexts = emailsToProcess.map(e => `From: ${e.from}\nSubject: ${e.subject}\n\n${e.body}`);

    // Batch 20 emails per Claude call to stay well under the token limit
    const BATCH_SIZE = 20;
    const allJobs: JobFromClaude[] = [];
    const totalBatches = Math.ceil(emailTexts.length / BATCH_SIZE);

    for (let i = 0; i < emailTexts.length; i += BATCH_SIZE) {
      const batch = emailTexts.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`Step 4 [${batchNum}/${totalBatches}]: Claude analyzing ${batch.length} emails...`);
      const batchJobs = await analyzeWithClaude(batch, cvText, candidateCity);
      console.log(`Step 4 [${batchNum}/${totalBatches}]: Got ${batchJobs.length} jobs`);
      allJobs.push(...batchJobs);
    }

    jobsFound = allJobs.length;
    console.log(`Step 4: Total jobs from all batches: ${jobsFound}`);

    // Re-derive priority from score as a safety check (Claude may drift)
    for (const job of allJobs) {
      if (job.score >= 8) job.priority = "HIGH";
      else if (job.score >= 5) job.priority = "MEDIUM";
      else if (job.score >= 2) job.priority = "LOW";
      else job.priority = "REJECTED";
    }

    // Clean up links and insert, skipping duplicates
    for (const job of allJobs) {
      // If job_link is a LinkedIn URL, move the ID to linkedin_id and clear job_link
      if (job.job_link) {
        const linkedinMatch = job.job_link.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i);
        if (linkedinMatch) {
          if (!job.linkedin_id) job.linkedin_id = linkedinMatch[1];
          job.job_link = "";
        }
      }
      // Strip non-digit chars from linkedin_id
      if (job.linkedin_id) {
        const idMatch = job.linkedin_id.match(/(\d+)/);
        job.linkedin_id = idMatch ? idMatch[1] : "";
      }

      // Build fingerprint — prefer LinkedIn ID, then direct link, then company+role+location
      const linkedinFp = job.linkedin_id ? `linkedin::${job.linkedin_id}` : "";
      const linkFp = job.job_link?.trim().toLowerCase();
      const hasValidLink = linkFp && linkFp.startsWith("http");
      const fingerprint = linkedinFp
        || (hasValidLink ? `link::${linkFp}` : `meta::${(job.company || "").trim().toLowerCase()}__${(job.role || "").trim().toLowerCase()}__${(job.location || "").trim().toLowerCase()}`);

      const { data: existing } = await supabase
        .from("jobs").select("id").eq("fingerprint", fingerprint).limit(1).maybeSingle();
      if (existing) {
        skippedDetails.push({ company: job.company, role: job.role, reason: "duplicate_fingerprint" });
        continue;
      }

      const { data: byCompanyRole } = await supabase
        .from("jobs").select("id")
        .ilike("company", (job.company || "").trim())
        .ilike("role", (job.role || "").trim())
        .limit(1).maybeSingle();
      if (byCompanyRole) {
        skippedDetails.push({ company: job.company, role: job.role, reason: "duplicate_company_role" });
        continue;
      }

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
          skippedDetails.push({ company: job.company, role: job.role, reason: "duplicate_constraint" });
        } else {
          skippedDetails.push({ company: job.company, role: job.role, reason: `error: ${insertError.message}` });
        }
      } else {
        jobsAdded++;
      }
    }

    // Update last_email_scan_timestamp to the internalDate of the last email we fetched.
    // Next scan will start from this point — ensures no emails are ever missed.
    await supabase
      .from("user_profiles")
      .update({ last_email_scan_timestamp: maxEmailTimestampSec })
      .eq("id", userId);
    console.log(`Updated last_email_scan_timestamp to ${maxEmailTimestampSec} (${new Date(maxEmailTimestampMs).toISOString()})`);

    await supabase.from("scan_runs").insert({
      user_id: userId,
      success: true,
      jobs_found: jobsFound,
      jobs_added: jobsAdded,
    });

    if (jobsAdded > 0 && userEmail) {
      const addedJobsList = allJobs.filter(j => j.priority !== "REJECTED").slice(0, jobsAdded);
      await sendEmailDigest(userEmail, addedJobsList);
    }

    const skipDuplicate = skippedDetails.filter(s => s.reason.startsWith("duplicate")).length;
    const skipError = skippedDetails.filter(s => s.reason.startsWith("error")).length;
    console.log(`Scan complete: found=${jobsFound}, added=${jobsAdded}, skipped_duplicate=${skipDuplicate}, skipped_error=${skipError}`);

    return new Response(
      JSON.stringify({ jobs_found: jobsFound, jobs_added: jobsAdded, jobs_skipped_duplicate: skipDuplicate, jobs_skipped_error: skipError, skipped_details: skippedDetails }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Scan error:", error);
    await supabase.from("scan_runs").insert({
      user_id: userId,
      success: false,
      jobs_found: jobsFound,
      jobs_added: jobsAdded,
      error_text: error.message || "Unknown error",
    });
    return new Response(
      JSON.stringify({ error: error.message || "Scan failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
