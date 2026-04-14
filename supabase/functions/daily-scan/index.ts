import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 45000, ...rest } = init;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...(rest as RequestInit), signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isTransientClaudeFailure(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  if (!msg) return true;
  return (
    msg.includes("overloaded") ||
    msg.includes("rate") ||
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("temporary") ||
    msg.includes("claude returned no content") ||
    msg.includes("no json found")
  );
}

async function callClaudeWithRetry<T>(
  fn: () => Promise<T>,
  onRetry: (attempt: number, delayMs: number, err: any) => void,
): Promise<{ ok: true; value: T; retriesUsed: number } | { ok: false; error: string; retriesUsed: number }> {
  const delays = [2000, 5000, 10000];
  let retriesUsed = 0;

  for (let attempt = 0; attempt < delays.length + 1; attempt++) {
    try {
      const value = await fn();
      return { ok: true, value, retriesUsed };
    } catch (err: any) {
      const transient = isTransientClaudeFailure(err);
      if (!transient || attempt >= delays.length) {
        return { ok: false, error: String(err?.message || err), retriesUsed };
      }
      const delayMs = delays[attempt];
      retriesUsed++;
      onRetry(attempt + 1, delayMs, err);
      await sleep(delayMs);
    }
  }

  return { ok: false, error: "Unknown Claude retry failure", retriesUsed };
}

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

interface EmailMeta { 
  subject: string; 
  from: string; 
  messageId: string;
}

interface FetchEmailsResult { 
  emails: string[]; 
  emailMeta: EmailMeta[];
  emailsMatched: number;
  emailsFetched: number;
  emailsSkippedDueToLimit: number;
  queryUsed: string;
}

async function fetchJobAlertEmails(accessToken: string, sinceTimestamp: number, maxEmailsPerRun: number): Promise<FetchEmailsResult> {
  const query = `(label:"Job Alerts" OR from:jobs-noreply@linkedin.com OR from:jobalerts-noreply@linkedin.com OR from:noreply@indeed.com OR from:noreply@jobnet.co.il) newer_than:7d`;
  const encodedQuery = encodeURIComponent(query);
  
  console.log(`[daily-scan] ========== STARTING FRESH SCAN ==========`);
  console.log(`[daily-scan] Search query: ${query}`);
  console.log(`[daily-scan] Date: ${new Date().toISOString()}`);
  
  const emails: string[] = [];
  const emailMeta: EmailMeta[] = [];
  let emailsMatched = 0;
  let pageToken: string | undefined = undefined;
  let pageCount = 0;

  // Pagination loop: fetch all pages, but stop early when maxEmailsPerRun is reached
  do {
    pageCount++;
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodedQuery}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const listResp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const listData = await listResp.json();

    if (pageCount === 1) {
      emailsMatched = listData.resultSizeEstimate ?? 0;
      console.log(`[GMAIL] Gmail API returned ${emailsMatched} email(s) total`);
    }

    if (!listData.messages || listData.messages.length === 0) {
      break;
    }

    console.log(`[GMAIL] Page ${pageCount}: fetching ${listData.messages.length} email(s)`);

    for (const msg of listData.messages) {
      if (emails.length >= maxEmailsPerRun) {
        console.log(`[GMAIL] Reached MAX_EMAILS_PER_RUN=${maxEmailsPerRun}, stopping early`);
        break;
      }
      const msgResp = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const msgData = await msgResp.json();
      const subject = msgData.payload?.headers?.find((h: any) => h.name === "Subject")?.value || "(no subject)";
      const from = msgData.payload?.headers?.find((h: any) => h.name === "From")?.value || "(unknown sender)";
      const date = msgData.payload?.headers?.find((h: any) => h.name === "Date")?.value || "(no date)";
      const body = extractEmailBody(msgData.payload);
      console.log(`[GMAIL]   Email ${emails.length + 1}:`);
      console.log(`[GMAIL]     From: ${from}`);
      console.log(`[GMAIL]     Subject: "${subject}"`);
      console.log(`[GMAIL]     Date: ${date}`);
      console.log(`[GMAIL]     Body preview (300 chars): ${body.substring(0, 300)}`);
      emails.push(`From: ${from}\nSubject: ${subject}\n\n${body}`);
      emailMeta.push({ subject, from, messageId: msg.id });
    }

    if (emails.length >= maxEmailsPerRun) break;

    pageToken = listData.nextPageToken;
  } while (pageToken);

  console.log(`[GMAIL] Pagination complete: ${pageCount} page(s), ${emails.length} email(s) fetched`);

  // Filter to only job-related emails
  const skipPatterns = [
    /profile views/i,
    /has a new post/i,
    /shared an article/i,
    /commented on/i,
    /liked your/i,
    /connection request/i,
    /endorsement/i,
    /congratulations/i,
    /recommendations/i,
    /updates-noreply@linkedin/i,
    /messages-noreply@linkedin/i,
    /newsletters-noreply@linkedin/i
  ];
  
  const jobIndicators = [
    /is hiring/i,
    /new job/i,
    /job alert/i,
    /posted on/i,
    /position/i,
    /role/i,
    /opportunity/i,
    /jobalerts-noreply@linkedin/i,
    /jobs-noreply@linkedin/i
  ];

  const filteredEmails: string[] = [];
  const filteredMeta: EmailMeta[] = [];
  
  for (let i = 0; i < emails.length; i++) {
    const meta = emailMeta[i];
    const subject = meta.subject;
    const from = meta.from;
    
    // Skip non-job emails
    const isSkippable = skipPatterns.some(pattern => 
      pattern.test(subject) || pattern.test(from)
    );
    
    if (isSkippable) {
      console.log(`[FILTER] Skipping non-job email: "${subject}"`);
      continue;
    }
    
    // Only process emails that mention jobs/hiring
    const isJobEmail = jobIndicators.some(pattern => 
      pattern.test(subject) || pattern.test(from)
    );
    
    if (!isJobEmail) {
      console.log(`[FILTER] Skipping non-job email: "${subject}"`);
      continue;
    }
    
    filteredEmails.push(emails[i]);
    filteredMeta.push(meta);
  }

  console.log(`[FILTER] Filtered ${emails.length} → ${filteredEmails.length} job emails`);

  const emailsSkippedDueToLimit = Math.max(0, emailsMatched - emails.length);

  return { 
    emails: filteredEmails, 
    emailMeta: filteredMeta, 
    emailsMatched,
    emailsFetched: filteredEmails.length,
    emailsSkippedDueToLimit,
    queryUsed: query,
  };
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

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts && payload.parts.length > 0) {
    let plainText = "";
    let htmlText = "";
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        plainText = decodeBase64Url(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data) {
        htmlText = decodeBase64Url(part.body.data);
      } else if (part.parts) {
        const nested = extractEmailBody(part);
        if (nested) plainText = plainText || nested;
      }
    }
    if (plainText) return plainText;
    if (htmlText) return htmlText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  return "";
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

async function analyzeWithClaude(emails: string[], cvText: string, learningContext = ''): Promise<JobFromClaude[]> {
  const truncatedCV = cvText.length > 2000 ? cvText.substring(0, 2000) + "\n[CV TRUNCATED]" : cvText;
  const truncatedEmails = emails.map(e => e.length > 5000 ? e.substring(0, 5000) + "\n[EMAIL TRUNCATED]" : e);
  const emailContent = truncatedEmails.join("\n\n---\n\n");
  
  console.log(`[CLAUDE] Email truncation: ${emails.filter((e, i) => e.length > 5000).length}/${emails.length} emails truncated (limit: 5000 chars)`);
  console.log(`[CLAUDE] Total email content length: ${emailContent.length} chars`);

  const prompt = `You are a strict job-fit scoring assistant. Score each job against the candidate's ACTUAL CV using the 4-factor algorithm below.

STEP 1 — Read the CV carefully. Extract:
- Candidate's city/location
- Real experience level (years, internships, student jobs)
- Actual technical skills and tools listed
- Education level and field
- Languages spoken

STEP 2 — Extract ALL unique jobs from the email alerts below (up to 50 jobs). Each LinkedIn job alert email typically contains 5-10 jobs, so extract every single job listing you find.

STEP 3 — Score each job using ALL 4 FACTORS and sum them (max 10):

FACTOR 1 — CV KEYWORD MATCH (up to 4 points)
Count how many of the job's requirements appear in the CV:
- 4 points: 80%+ of requirements match CV
- 3 points: 60-80% match
- 2 points: 40-60% match
- 1 point: 20-40% match
- 0 points: less than 20% match

FACTOR 2 — JOB LEVEL FIT (up to 3 points)
- 3 points: explicitly says "student position", "משרת סטודנט", "internship", "התמחות", "entry level", "0 years experience", "fresh graduate", "academy", "graduate program", or "junior"
- 2 points: says "1-2 years experience", or experience requirement is unclear/not mentioned
- 1 point: says "2-3 years experience"
- 0 points: description explicitly requires "3+ years" or explicitly describes "senior-level responsibilities" → also force priority REJECTED

CRITICAL RULE — TITLE vs DESCRIPTION: A title containing "Manager", "Senior", "Lead", or similar does NOT automatically lower the score or force REJECTED. Always read the actual job description. If the description says "entry level", "0-2 years", "student", "academy", "junior", or "graduate program", it is still a good fit regardless of the title. Only penalize for seniority if the DESCRIPTION explicitly requires 3+ years of experience or senior-level responsibilities.

FACTOR 3 — LOCATION (up to 2 points)
Extract the candidate's city from their CV, then:
- 2 points: job is in the same city as candidate
- 1 point: job is within ~40km of candidate's city (e.g. nearby cities in the same metro area)
- 0 points: job is far from candidate's city (different region)
- If job is REMOTE: score 0 points AND set priority to REJECTED (ignore remote jobs)
- If location not mentioned: 1 point (assume possible)

FACTOR 4 — FIELD RELEVANCE (up to 1 point)
- 1 point: role is directly related to data, analytics, BI, business analysis, operations, industrial engineering, product, supply chain, logistics
- 0 points: unrelated field (marketing, sales, civil engineering, law, accounting, etc.) → also force priority LOW

FINAL SCORE = Factor1 + Factor2 + Factor3 + Factor4 (max 10)

PRIORITY RULES:
- HIGH: score 7-10
- MEDIUM: score 5-6
- LOW: score 3-4
- REJECTED: score 1-2, OR remote job, OR description explicitly requires 3+ years experience
- NOTE: never set REJECTED based on title alone — always check the actual requirements first

REASON FORMAT (mandatory — two sentences, no score points):
"Requirements: [extract the actual skills, tools, years of experience, responsibilities, and location directly from the job posting]. Match: [explain specifically which of the candidate's skills match and what gaps or concerns exist]."
Example: "Requirements: 2+ years data analysis, SQL pipelines, Python (pandas/numpy), Power BI dashboards, stakeholder reporting, Ramat Gan office. Match: Strong SQL and Python match, KPI dashboard experience relevant, student status may be a concern for seniority expectations, missing Power BI specifically."
NEVER write point scores or factor breakdowns in the reason field. NEVER write vague reasons like "Good fit for candidate".

LINK EXTRACTION RULES (mandatory — every job MUST have at least one link):
- job_link: the DIRECT company career page URL (e.g. careers.company.com/job/123). If no company URL found, set to empty string "".
- linkedin_id: if a LinkedIn URL exists, extract ONLY the numeric job ID (e.g. "4385024025"). If no LinkedIn URL, use empty string "".
- NEVER store a linkedin.com URL in job_link.
- Every job MUST have at least one of job_link or linkedin_id filled.

COMPANY DOMAIN (mandatory):
- company_domain: the company's main website domain (e.g. "google.com", "playtika.com", "tevapharm.com", "siemens-energy.com")
- If you know the company, provide their actual domain
- If unsure, guess based on the company name (e.g. "Acme Corp" → "acmecorp.com")
- Never leave company_domain empty

===== CANDIDATE CV =====
${truncatedCV}
${learningContext ? `\n===== USER FEEDBACK ON PAST SCORING =====\n${learningContext}\n` : ''}
===== RECENT JOB ALERT EMAILS =====
${emailContent}

Return ONLY valid JSON with no trailing commas. Use only ASCII characters in all string values (no Hebrew, no special quotes, no newlines inside strings):
{
  "jobs": [{
    "company": "", "role": "", "location": "", "score": 0, "priority": "", "exp_required": "", "job_link": "", "linkedin_id": "", "company_domain": "", "reason": "", "status": "New"
  }]
}`;

  const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
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
    timeoutMs: 60000,
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Claude API error ${resp.status}: ${JSON.stringify(data)}`);
  }
  if (!data.content?.[0]?.text) throw new Error("Claude returned no content: " + JSON.stringify(data));

  const text = data.content[0].text;
  console.log(`[CLAUDE] Raw response length: ${text.length} chars`);
  console.log(`[CLAUDE] Response preview (first 500 chars): ${text.substring(0, 500)}`);

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
  jsonStr = jsonStr.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
    console.log(`[PARSE] Successfully parsed JSON with ${parsed.jobs?.length || 0} jobs`);
  } catch (e: any) {
    console.error("JSON parse failed, attempting regex extraction. Error:", e.message);

    try {
      const jobMatches: any[] = [];
      const jobRegex = /"company"\s*:\s*"([^"]*)"\s*,\s*"role"\s*:\s*"([^"]*)"\s*,\s*"location"\s*:\s*"([^"]*)"\s*,\s*"score"\s*:\s*(\d+)\s*,\s*"priority"\s*:\s*"([^"]*)"\s*,\s*"exp_required"\s*:\s*"([^"]*)"\s*,\s*"job_link"\s*:\s*"([^"]*)"\s*,\s*"linkedin_id"\s*:\s*"([^"]*)"\s*,\s*"company_domain"\s*:\s*"([^"]*)"\s*,\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"status"\s*:\s*"([^"]*)"/g;

      let match;
      while ((match = jobRegex.exec(jsonStr)) !== null) {
        jobMatches.push({
          company: match[1],
          role: match[2],
          location: match[3],
          score: parseInt(match[4]),
          priority: match[5],
          exp_required: match[6],
          job_link: match[7],
          linkedin_id: match[8],
          company_domain: match[9],
          reason: match[10],
          status: match[11],
        });
      }

      if (jobMatches.length > 0) {
        parsed = { jobs: jobMatches };
        console.log(`[PARSE] Regex-extracted ${jobMatches.length} jobs from malformed JSON`);
        console.log(`[PARSE] Malformed JSON length: ${jsonStr.length} chars`);
      } else {
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

interface EmailDebug {
  subject: string;
  from: string;
  messageId: string;
  jobsExtracted: number;
  jobsInserted: number;
  jobsSkipped: number;
  skipReasons: string[];
}

interface ClaudeBatchDebug {
  batchIndex: number;
  emailsInBatch: number;
  retryCount: number;
  status: "succeeded" | "failed";
  failureReason?: string;
}

interface ScanSummary {
  success: boolean;
  status: "success" | "partial_success" | "failed";
  queryUsed: string;
  dateRangeUsed: string;
  emailsMatched: number;
  emailsFetched: number;
  emailsProcessed: number;
  emailsSkippedDueToLimit: number;
  jobsExtractedRaw: number;
  jobsValidated: number;
  jobsInserted: number;
  jobsSkippedDuplicate: number;
  jobsSkippedInvalid: number;
  claudeBatchesAttempted: number;
  claudeBatchesSucceeded: number;
  claudeBatchesFailed: number;
  claudeRetriesUsed: number;
  batchesSkippedDueToLimit: number;
  statusUpdates: { company: string; role: string; old_status: string; new_status: string }[];
  claudeBatches: ClaudeBatchDebug[];
  debug: EmailDebug[];
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
  const userId = user.id;
  if (!userId) {
    console.error("daily-scan: user has no id, aborting to prevent inserting jobs without user_id");
    return new Response(JSON.stringify({ error: "No authenticated user" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("cv_text, full_name, city, google_refresh_token")
    .eq("id", userId)
    .single();

  const statusUpdates: { company: string; role: string; old_status: string; new_status: string }[] = [];
  const emailDebugList: EmailDebug[] = [];

  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let sinceTimestamp = Math.floor(sevenDaysAgoMs / 1000);
  let dateRangeUsed = `Last 7 days (since ${new Date(sevenDaysAgoMs).toISOString()})`;
  
  try {
    const { data: lastScan } = await supabase
      .from("scan_runs")
      .select("created_at")
      .eq("user_id", userId)
      .eq("success", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (lastScan?.created_at) {
      const lastScanMs = new Date(lastScan.created_at).getTime();
      if (lastScanMs > Date.now() - 30 * 24 * 60 * 60 * 1000) {
        sinceTimestamp = Math.floor(lastScanMs / 1000);
        dateRangeUsed = `Since last scan (${lastScan.created_at})`;
        console.log(`[GMAIL] Scanning since last successful scan: ${lastScan.created_at}`);
      } else {
        console.log(`[GMAIL] Last scan too old, falling back to 7-day window`);
      }
    } else {
      console.log(`[GMAIL] No previous scan found, using 7-day fallback`);
    }
  } catch {
    console.log(`[GMAIL] Could not read last scan timestamp, using 7-day fallback`);
  }

  try {
    const googleRefreshToken = (profile as any)?.google_refresh_token;
    if (!googleRefreshToken) {
      throw new Error("Google account not connected. Please reconnect Gmail in Settings or Onboarding.");
    }
    const accessToken = await getGoogleAccessToken(googleRefreshToken);

    const MAX_EMAILS_PER_RUN = 20; // Process 20 emails for reliability

    const { emails, emailMeta, emailsMatched, emailsFetched, emailsSkippedDueToLimit, queryUsed } = await fetchJobAlertEmails(accessToken, sinceTimestamp, MAX_EMAILS_PER_RUN);
    
    if (emails.length === 0) {
      await supabase.from("scan_runs").insert({
        user_id: userId,
        success: true,
        jobs_found: 0,
        jobs_added: 0,
      });
      
      const summary: ScanSummary = {
        success: true,
        status: "success",
        queryUsed,
        dateRangeUsed,
        emailsMatched,
        emailsFetched,
        emailsProcessed: 0,
        emailsSkippedDueToLimit,
        jobsExtractedRaw: 0,
        jobsValidated: 0,
        jobsInserted: 0,
        jobsSkippedDuplicate: 0,
        jobsSkippedInvalid: 0,
        claudeBatchesAttempted: 0,
        claudeBatchesSucceeded: 0,
        claudeBatchesFailed: 0,
        claudeRetriesUsed: 0,
        batchesSkippedDueToLimit: 0,
        statusUpdates: [],
        claudeBatches: [],
        debug: [],
      };
      
      return new Response(JSON.stringify(summary), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cvText = profile?.cv_text || "";

    // Simple sequential batch processing
    const BATCH_SIZE = 5; // 5 emails per batch
    const totalBatches = Math.ceil(emails.length / BATCH_SIZE);
    
    console.log(`\n[SUMMARY] Email Processing:`);
    console.log(`  - Total emails matched: ${emailsMatched}`);
    console.log(`  - Filtered to job emails: ${emails.length}`);
    console.log(`  - Emails per batch: ${BATCH_SIZE}`);
    console.log(`  - Total batches: ${totalBatches}`);
    console.log(`  - Processing: SEQUENTIAL (no parallel)\n`);

    // Process batches sequentially
    const allJobs: JobFromClaude[] = [];
    const claudeBatches: ClaudeBatchDebug[] = [];
    let claudeBatchesAttempted = 0;
    let claudeBatchesSucceeded = 0;
    let claudeBatchesFailed = 0;
    let claudeRetriesUsed = 0;
    
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      const meta = emailMeta.slice(i, i + BATCH_SIZE);
      const batchIndex = Math.floor(i / BATCH_SIZE);
      
      console.log(`[BATCH ${batchIndex + 1}/${totalBatches}] Processing ${batch.length} emails`);
      for (let j = 0; j < meta.length; j++) {
        console.log(`[BATCH ${batchIndex + 1}]   Email ${j + 1}: "${meta[j].subject}"`);
      }
      
      claudeBatchesAttempted++;
      
      try {
        const claudeCall = await callClaudeWithRetry(
          async () => await analyzeWithClaude(batch, cvText, ""),
          (attempt, delayMs, err) => {
            console.log(`[BATCH ${batchIndex + 1}] Retry ${attempt}/3 in ${delayMs}ms: ${String(err?.message || err)}`);
          },
        );
        
        claudeRetriesUsed += claudeCall.retriesUsed;
        
        if (!claudeCall.ok) {
          console.error(`[BATCH ${batchIndex + 1}] Failed: ${claudeCall.error}`);
          claudeBatchesFailed++;
          claudeBatches.push({
            batchIndex,
            emailsInBatch: batch.length,
            retryCount: claudeCall.retriesUsed,
            status: "failed",
            failureReason: claudeCall.error
          });
          continue;
        }
        
        const jobs = claudeCall.value || [];
        console.log(`[BATCH ${batchIndex + 1}] Extracted ${jobs.length} jobs`);
        allJobs.push(...jobs);
        claudeBatchesSucceeded++;
        claudeBatches.push({
          batchIndex,
          emailsInBatch: batch.length,
          retryCount: claudeCall.retriesUsed,
          status: "succeeded"
        });
      } catch (error: any) {
        console.error(`[BATCH ${batchIndex + 1}] Exception:`, error);
        claudeBatchesFailed++;
        claudeBatches.push({
          batchIndex,
          emailsInBatch: batch.length,
          retryCount: 0,
          status: "failed",
          failureReason: error.message
        });
      }
    }

    const batchesSkippedDueToLimit = 0;
    const emailsProcessed = emails.length;
    const jobsExtractedRaw = allJobs.length;
    
    console.log(`\n[COMPLETE] Total jobs extracted: ${jobsExtractedRaw}`);
    console.log(`[COMPLETE] Batches succeeded: ${claudeBatchesSucceeded}/${claudeBatchesAttempted}`);
    
    if (allJobs.length > 0) {
      console.log(`[EXTRACT] Jobs extracted by Claude:`);
      for (let i = 0; i < Math.min(allJobs.length, 20); i++) {
        console.log(`[EXTRACT]   ${i + 1}. ${allJobs[i].company}: ${allJobs[i].role} (Score: ${allJobs[i].score}, Priority: ${allJobs[i].priority})`);
      }
      if (allJobs.length > 20) {
        console.log(`[EXTRACT]   ... and ${allJobs.length - 20} more jobs`);
      }
    }

    const SENIOR_TITLES = /\b(senior|lead|principal|manager|director|head|vp|staff|architect)\b/i;
    const HIGH_EXP = /\b(3\+|4\+|5\+|6\+|7\+|8\+|3-5|5-7|3 years|4 years|5 years)\b/i;
    const RELEVANT_FIELDS = /\b(data|analy|operations|business|project.?manag|supply.?chain|logistics|industrial.?engineer|BI|reporting|excel|sql|python|planning|procurement|product)\b/i;
    const REMOTE_JOB = /\b(remote|עבודה מרחוק|work from home|WFH)\b/i;

    const rowsToInsert: any[] = [];
    for (const job of allJobs) {
      const title = (job.role || '').trim();
      const exp = (job.exp_required || '').trim();
      const location = (job.location || '').trim();

      if (HIGH_EXP.test(exp)) {
        job.score = Math.min(job.score, 3);
        job.priority = "REJECTED";
        if (!job.reason.includes("experience")) {
          job.reason = `Score ${job.score} — requires ${exp} experience, Dor is a 3rd year student. ${job.reason}`;
        }
      }

      if (REMOTE_JOB.test(location) || REMOTE_JOB.test(title)) {
        job.priority = "REJECTED";
        if (!job.reason.includes("remote")) {
          job.reason = `${job.reason} [Remote job — auto-rejected per policy.]`;
        }
      }

      if (!RELEVANT_FIELDS.test(title) && !RELEVANT_FIELDS.test(job.reason)) {
        job.score = Math.min(job.score, 4);
        if (job.priority !== "REJECTED") job.priority = "LOW";
      }

      if (job.score <= 2) {
        job.priority = "REJECTED";
      } else if (job.priority !== "REJECTED") {
        if (job.score >= 7) job.priority = "HIGH";
        else if (job.score >= 5) job.priority = "MEDIUM";
        else if (job.score >= 3) job.priority = "LOW";
        else job.priority = "REJECTED";
      }
    }

    const jobsValidated = allJobs.length;
    let jobsInserted = 0;
    let jobsSkippedDuplicate = 0;
    let jobsSkippedInvalid = 0;

    // Per-email tracking
    const emailJobMap = new Map<string, { inserted: number; skipped: number; reasons: string[] }>();
    for (const meta of emailMeta) {
      emailJobMap.set(meta.messageId, { inserted: 0, skipped: 0, reasons: [] });
    }

    for (const job of allJobs) {
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

      const hasCompanyLink = job.job_link?.trim() && job.job_link.trim().startsWith("http");

      const linkedinFp = job.linkedin_id ? `linkedin::${job.linkedin_id}` : "";
      const linkFp = job.job_link?.trim().toLowerCase();
      const hasValidLink = linkFp && linkFp.startsWith("http");
      const fingerprint = linkedinFp
        || (hasValidLink ? `link::${linkFp}` : `meta::${(job.company || '').trim().toLowerCase()}__${(job.role || '').trim().toLowerCase()}__${(job.location || '').trim().toLowerCase()}`);

      rowsToInsert.push({
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
        __debug_company: job.company,
        __debug_role: job.role,
        __debug_fingerprint: fingerprint,
      });
    }

    if (rowsToInsert.length > 0) {
      console.log(`\n[INSERT] Attempting to insert ${rowsToInsert.length} jobs...`);
      
      const insertPayload = rowsToInsert.map(({ __debug_company, __debug_role, __debug_fingerprint, ...row }) => row);
      const { data: upserted, error: upsertError } = await supabase
        .from("jobs")
        .upsert(insertPayload, { onConflict: 'fingerprint', ignoreDuplicates: true })
        .select('id,fingerprint');

      if (upsertError) {
        console.error(`[FAIL] bulk upsert error:`, upsertError);
        jobsSkippedInvalid += rowsToInsert.length;
        for (const meta of emailMeta) {
          const tracking = emailJobMap.get(meta.messageId);
          if (tracking) tracking.reasons.push(`error: ${upsertError.message}`);
        }
      } else {
        const insertedFingerprints = new Set<string>((upserted || []).map((r: any) => r.fingerprint));
        for (const row of rowsToInsert) {
          const fp = row.__debug_fingerprint;
          if (insertedFingerprints.has(fp)) {
            console.log(`[INSERT] ✓ ${row.__debug_company} - ${row.__debug_role} (score: ${row.score}, priority: ${row.priority})`);
            jobsInserted++;
          } else {
            console.log(`[SKIP] Duplicate: ${row.__debug_company} - ${row.__debug_role}`);
            jobsSkippedDuplicate++;
          }
        }
      }
    }

    // Build per-email debug
    for (const meta of emailMeta) {
      const tracking = emailJobMap.get(meta.messageId) || { inserted: 0, skipped: 0, reasons: [] };
      emailDebugList.push({
        subject: meta.subject,
        from: meta.from,
        messageId: meta.messageId,
        jobsExtracted: tracking.inserted + tracking.skipped,
        jobsInserted: tracking.inserted,
        jobsSkipped: tracking.skipped,
        skipReasons: tracking.reasons,
      });
    }

    const isFullFailure = emailsFetched > 0 && jobsInserted === 0 && claudeBatchesSucceeded === 0;
    const scanStatus: ScanSummary["status"] = isFullFailure ? "failed" : "success";
    const successFlag = scanStatus !== "failed";

    const partialMsg = null;

    await supabase.from("scan_runs").insert({
      user_id: userId,
      success: successFlag,
      jobs_found: jobsExtractedRaw,
      jobs_added: jobsInserted,
      error_text: partialMsg,
    });

    console.log(`\n[daily-scan] ========== SCAN COMPLETE ==========`);
    console.log(`[daily-scan] Total emails processed: ${emailsProcessed}`);
    console.log(`[daily-scan] Total jobs found: ${jobsExtractedRaw}`);
    console.log(`[daily-scan] Total jobs added: ${jobsInserted}`);
    console.log(`[daily-scan] Total duplicates skipped: ${jobsSkippedDuplicate}`);

    const summary: ScanSummary = {
      success: successFlag,
      status: scanStatus,
      queryUsed,
      dateRangeUsed,
      emailsMatched,
      emailsFetched,
      emailsProcessed,
      emailsSkippedDueToLimit,
      jobsExtractedRaw,
      jobsValidated,
      jobsInserted,
      jobsSkippedDuplicate,
      jobsSkippedInvalid,
      claudeBatchesAttempted,
      claudeBatchesSucceeded,
      claudeBatchesFailed,
      claudeRetriesUsed,
      batchesSkippedDueToLimit,
      statusUpdates,
      claudeBatches,
      debug: emailDebugList,
    };

    console.log(`[SUMMARY] Scan complete:`, JSON.stringify(summary, null, 2));

    const httpStatus = scanStatus === "failed" ? 500 : 200;
    return new Response(JSON.stringify(summary), {
      status: httpStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Scan error:", error);
    await supabase.from("scan_runs").insert({
      user_id: userId,
      success: false,
      jobs_found: 0,
      jobs_added: 0,
      error_text: error.message || "Unknown error",
    });
    return new Response(JSON.stringify({ error: error.message || "Scan failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
