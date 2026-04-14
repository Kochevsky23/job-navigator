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

interface EmailWithTimestamp {
  subject: string;
  from: string;
  messageId: string;
  internalDate: number;
  body: string;
  fullEmail: string;
}

async function fetchJobAlertEmails(accessToken: string, lastScanTimestamp: number): Promise<EmailWithTimestamp[]> {
  const query = `(label:"Job Alerts" OR from:jobs-noreply@linkedin.com OR from:jobalerts-noreply@linkedin.com OR from:noreply@indeed.com OR from:noreply@jobnet.co.il) newer_than:7d`;
  const encodedQuery = encodeURIComponent(query);
  
  console.log(`[GMAIL] Fetching emails with query: ${query}`);
  console.log(`[GMAIL] Last scan timestamp: ${lastScanTimestamp} (${new Date(lastScanTimestamp).toISOString()})`);
  
  const emails: EmailWithTimestamp[] = [];
  let pageToken: string | undefined = undefined;
  let pageCount = 0;

  do {
    pageCount++;
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodedQuery}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const listResp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const listData = await listResp.json();

    if (!listData.messages || listData.messages.length === 0) {
      console.log(`[GMAIL] No messages found on page ${pageCount}`);
      break;
    }

    console.log(`[GMAIL] Page ${pageCount}: fetching ${listData.messages.length} email(s)`);

    for (const msg of listData.messages) {
      const msgResp = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const msgData = await msgResp.json();
      const subject = msgData.payload?.headers?.find((h: any) => h.name === "Subject")?.value || "(no subject)";
      const from = msgData.payload?.headers?.find((h: any) => h.name === "From")?.value || "(unknown sender)";
      const internalDate = parseInt(msgData.internalDate || "0", 10);
      const body = extractEmailBody(msgData.payload);
      
      emails.push({
        subject,
        from,
        messageId: msg.id,
        internalDate,
        body,
        fullEmail: `From: ${from}\nSubject: ${subject}\n\n${body}`
      });
    }

    pageToken = listData.nextPageToken;
  } while (pageToken && emails.length < 100);

  console.log(`[GMAIL] Total emails fetched: ${emails.length}`);
  
  // Filter by timestamp and sort by date (oldest first)
  const filteredEmails = emails.filter((email) => email.internalDate > lastScanTimestamp);
  const sortedEmails = filteredEmails.sort((a, b) => a.internalDate - b.internalDate);
  
  console.log(`[GMAIL] Emails after timestamp filter: ${sortedEmails.length} (filtered ${emails.length - sortedEmails.length} old emails)`);
  
  return sortedEmails;
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

async function analyzeWithClaude(emails: string[], cvText: string): Promise<JobFromClaude[]> {
  const truncatedCV = cvText.length > 2000 ? cvText.substring(0, 2000) + "\n[CV TRUNCATED]" : cvText;
  const truncatedEmails = emails.map(e => e.length > 5000 ? e.substring(0, 5000) + "\n[EMAIL TRUNCATED]" : e);
  const emailContent = truncatedEmails.join("\n\n---\n\n");
  
  console.log(`[CLAUDE] Processing ${emails.length} emails, total content: ${emailContent.length} chars`);

  const prompt = `You are a strict job-fit scoring assistant. Score each job against the candidate's ACTUAL CV using the 4-factor algorithm below.

STEP 1 — Read the CV carefully. Extract:
- Candidate's city/location
- Real experience level (years, internships, student jobs)
- Actual technical skills and tools listed
- Education level and field
- Languages spoken

STEP 2 — Extract ALL unique jobs from the email alerts below. For each job, extract:
- company
- role
- location
- exp_required
- job_link
- linkedin_id (from URL if available)
- company_domain (from email or link)

STEP 3 — Score each job using this 4-factor algorithm:

Factor 1: Location Match (0-3 points)
- Same city as candidate: 3 points
- Remote or "עבודה מרחוק": 3 points
- Different city in same country: 1 point
- Different country: 0 points

Factor 2: Experience Match (0-3 points)
- Job requires 0-2 years AND candidate has 0-2 years: 3 points
- Job requires 3+ years AND candidate has 3+ years: 3 points
- Job requires 3+ years BUT candidate has 0-2 years: 0 points (REJECT)
- Job requires 0-2 years BUT candidate has 5+ years: 1 point

Factor 3: Skills Match (0-3 points)
- 80%+ of required skills in CV: 3 points
- 50-79% of required skills in CV: 2 points
- 20-49% of required skills in CV: 1 point
- <20% of required skills in CV: 0 points

Factor 4: Field Match (0-3 points)
- Exact field match (e.g., Data Analyst for Data Analyst): 3 points
- Related field (e.g., BI for Data Analyst): 2 points
- Transferable field (e.g., Operations for Data Analyst): 1 point
- Unrelated field: 0 points

Total Score = Factor1 + Factor2 + Factor3 + Factor4 (0-12)

Priority Assignment:
- 10-12 points: "TOP MATCH"
- 7-9 points: "GOOD FIT"
- 4-6 points: "MAYBE"
- 0-3 points: "REJECTED"

IMPORTANT:
- If experience mismatch (candidate has 0-2 years but job requires 3+): priority = "REJECTED", score ≤ 3
- Extract EVERY job from the emails, up to 50 jobs
- Return ONLY valid JSON

CV:
${truncatedCV}

EMAILS:
${emailContent}

Return JSON:
{
  "jobs": [
    {
      "company": "...",
      "role": "...",
      "location": "...",
      "score": 0-12,
      "priority": "TOP MATCH|GOOD FIT|MAYBE|REJECTED",
      "exp_required": "...",
      "job_link": "...",
      "linkedin_id": "...",
      "company_domain": "...",
      "reason": "Brief explanation of score",
      "status": "New"
    }
  ]
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
  console.log(`[CLAUDE] Response length: ${text.length} chars`);

  let parsed: any;
  const jsonMatch = text.match(/\{[\s\S]*"jobs"[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in Claude response");
  }

  const jsonStr = jsonMatch[0];
  try {
    parsed = JSON.parse(jsonStr);
    console.log(`[CLAUDE] Extracted ${parsed.jobs?.length || 0} jobs`);
  } catch {
    const jobMatches = [...jsonStr.matchAll(/\{[^{}]*"company"[^{}]*\}/g)];
    if (jobMatches.length > 0) {
      parsed = { jobs: jobMatches.map(m => JSON.parse(m[0])) };
      console.log(`[CLAUDE] Regex-extracted ${jobMatches.length} jobs from malformed JSON`);
    } else {
      throw new Error("Failed to parse JSON from Claude");
    }
  }

  return parsed.jobs || [];
}

function smartFilterEmails(emails: EmailWithTimestamp[]): EmailWithTimestamp[] {
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
    /newsletters-noreply@linkedin/i,
    /invitation to connect/i,
    /wants to connect/i,
    /accepted your invitation/i
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

  const filtered = emails.filter(email => {
    const subject = email.subject;
    const from = email.from;
    
    const isSkippable = skipPatterns.some(pattern => pattern.test(subject) || pattern.test(from));
    if (isSkippable) {
      console.log(`[FILTER] Skipping: "${subject}"`);
      return false;
    }
    
    const isJobEmail = jobIndicators.some(pattern => pattern.test(subject) || pattern.test(from));
    if (!isJobEmail) {
      console.log(`[FILTER] Skipping non-job: "${subject}"`);
      return false;
    }
    
    return true;
  });

  console.log(`[FILTER] Filtered ${emails.length} → ${filtered.length} job emails`);
  return filtered;
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

  try {
    console.log(`[SCAN] Starting incremental scan for user ${userId}`);

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("cv_text, google_refresh_token, last_email_scan_timestamp")
      .eq("user_id", userId)
      .single();

    if (!profile) {
      throw new Error("User profile not found");
    }

    const googleRefreshToken = (profile as any)?.google_refresh_token;
    if (!googleRefreshToken) {
      throw new Error("Google account not connected. Please reconnect Gmail in Settings.");
    }

    const cvText = profile?.cv_text || "";
    const lastScanTimestamp = (profile as any)?.last_email_scan_timestamp || 0;

    console.log(`[SCAN] Last scan: ${lastScanTimestamp} (${new Date(lastScanTimestamp).toISOString()})`);

    const accessToken = await getGoogleAccessToken(googleRefreshToken);

    // Fetch and filter emails
    const allEmails = await fetchJobAlertEmails(accessToken, lastScanTimestamp);
    const filteredEmails = smartFilterEmails(allEmails);
    
    // Take only first 10 emails
    const MAX_EMAILS_PER_RUN = 10;
    const emailsToProcess = filteredEmails.slice(0, MAX_EMAILS_PER_RUN);
    
    console.log(`[SCAN] Processing ${emailsToProcess.length}/${filteredEmails.length} emails (max ${MAX_EMAILS_PER_RUN})`);

    if (emailsToProcess.length === 0) {
      console.log(`[SCAN] No new emails to process`);
      return new Response(JSON.stringify({ 
        success: true, 
        jobsAdded: 0, 
        emailsProcessed: 0,
        message: "No new emails to process"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Process in batches of 5
    const BATCH_SIZE = 5;
    let totalJobsInserted = 0;
    let latestEmailTimestamp = lastScanTimestamp;

    for (let i = 0; i < emailsToProcess.length; i += BATCH_SIZE) {
      const batch = emailsToProcess.slice(i, i + BATCH_SIZE);
      const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(emailsToProcess.length / BATCH_SIZE);
      
      console.log(`\n[BATCH ${batchIndex}/${totalBatches}] Processing ${batch.length} emails`);
      
      for (const email of batch) {
        console.log(`[BATCH ${batchIndex}]   - "${email.subject}" (${new Date(email.internalDate).toISOString()})`);
      }

      // Extract jobs from batch
      const claudeCall = await callClaudeWithRetry(
        async () => await analyzeWithClaude(batch.map(e => e.fullEmail), cvText),
        (attempt, delayMs, err) => {
          console.log(`[BATCH ${batchIndex}] Retry ${attempt}/3 in ${delayMs}ms: ${err?.message}`);
        },
      );

      if (!claudeCall.ok) {
        console.error(`[BATCH ${batchIndex}] Failed: ${claudeCall.error}`);
        continue;
      }

      const jobs = claudeCall.value || [];
      console.log(`[BATCH ${batchIndex}] Extracted ${jobs.length} jobs`);

      // Insert jobs immediately
      if (jobs.length > 0) {
        const rowsToInsert = jobs.map(job => ({
          user_id: userId,
          company: job.company || "Unknown",
          role: job.role || "Unknown",
          location: job.location || "",
          score: job.score || 0,
          priority: job.priority || "MAYBE",
          exp_required: job.exp_required || "",
          job_link: job.job_link || "",
          linkedin_id: job.linkedin_id || "",
          company_domain: job.company_domain || "",
          reason: job.reason || "",
          status: "New",
          fingerprint: `${job.company}-${job.role}-${job.location}`.toLowerCase().replace(/\s+/g, "-"),
        }));

        const { data: inserted, error: insertError } = await supabase
          .from("jobs")
          .upsert(rowsToInsert, { onConflict: "fingerprint", ignoreDuplicates: true })
          .select("fingerprint");

        if (insertError) {
          console.error(`[BATCH ${batchIndex}] Insert error:`, insertError);
        } else {
          const insertedCount = inserted?.length || 0;
          totalJobsInserted += insertedCount;
          console.log(`[BATCH ${batchIndex}] Inserted ${insertedCount}/${jobs.length} jobs (${jobs.length - insertedCount} duplicates)`);
        }
      }

      // Update latest timestamp
      for (const email of batch) {
        if (email.internalDate > latestEmailTimestamp) {
          latestEmailTimestamp = email.internalDate;
        }
      }
    }

    // Update last_email_scan_timestamp
    if (latestEmailTimestamp > lastScanTimestamp) {
      const { error: updateError } = await supabase
        .from("user_profiles")
        .update({ last_email_scan_timestamp: latestEmailTimestamp })
        .eq("user_id", userId);

      if (updateError) {
        console.error(`[SCAN] Failed to update timestamp:`, updateError);
      } else {
        console.log(`[SCAN] Updated last_email_scan_timestamp to ${latestEmailTimestamp} (${new Date(latestEmailTimestamp).toISOString()})`);
      }
    }

    console.log(`\n[SCAN] Complete: ${totalJobsInserted} jobs inserted, ${emailsToProcess.length} emails processed`);

    return new Response(JSON.stringify({
      success: true,
      jobsAdded: totalJobsInserted,
      emailsProcessed: emailsToProcess.length,
      lastScanTimestamp: latestEmailTimestamp
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error(`[SCAN] Error:`, error);
    return new Response(JSON.stringify({ error: error.message || "Scan failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
