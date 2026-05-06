import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.39.0";
import { getCorsHeaders } from "../_shared/cors.ts";

function getHeader(payload: any, name: string): string {
  const header = payload.headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

// ─── Gmail auth ───────────────────────────────────────────────────────────────
async function getAccessToken(refreshToken: string): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID"),
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) throw new Error(`Failed to refresh token: ${await resp.text()}`);
  const data = await resp.json();
  return data.access_token;
}

// ─── Claude analysis ──────────────────────────────────────────────────────────
interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  snippet: string;
}

interface ClaudeMatch {
  emailIndex: number;
  company: string;
  newStatus: 'Applied' | 'Interviewing' | 'Rejected' | 'Offer';
  confidence: number;
  reason: string;
}

interface PendingChange {
  jobId: string;
  company: string;
  role: string;
  oldStatus: string;
  newStatus: string;
  confidence: number;
  reason: string;
}

async function analyzeEmailsWithClaude(
  emails: EmailSummary[],
  jobs: { id: string; company: string; role: string; status: string }[]
): Promise<ClaudeMatch[]> {
  const anthropic = new Anthropic({ apiKey: Deno.env.get("CLAUDE_API_KEY")! });

  const companyList = jobs
    .map(j => `- "${j.company}" | role: ${j.role} | current status: ${j.status}`)
    .join('\n');

  const emailList = emails
    .map((e, i) => `[${i + 1}]\nFrom: ${e.from}\nSubject: ${e.subject}\nSnippet: ${e.snippet}`)
    .join('\n\n');

  const prompt = `You are analyzing job application emails to detect status changes for a job seeker.

The user is tracking these companies:
${companyList}

Here are recent emails that may contain application status updates:
${emailList}

For each email that represents a status update for any tracked company, identify the match.
Match companies even when the sender differs from the company name — examples:
- "PMI Careers" or "Philip Morris" emails → "Philip Morris International"
- "Workday HRHPI" or "workdayhpi@hp.com" → "HP"
- "cisco@myworkday.com" or "Cisco Recruiting" → "Cisco"
- LinkedIn notification about a company → that company
- Any ATS/recruiting system mentioning the company in subject or snippet

Status definitions:
- "Applied": application was received / confirmed by the company
- "Interviewing": invited for an interview or screening call
- "Rejected": not moving forward, chose other candidates, position filled, "less suitable", etc.
- "Offer": job offer was extended

Rules:
- Only include matches where you are confident the email relates to a tracked company
- Never downgrade a status (e.g., if current is "Interviewing", don't return "Applied")
- If an email could match multiple companies, pick the most likely one
- Understand both English and Hebrew emails
- "We'll be in touch" / "will contact you soon" = NOT a rejection, skip it
- Conditional offers ("pending background check") still count as "Offer"
- Automated "application received" confirmations = "Applied" only if status is currently New/Old

CRITICAL — rejection signals always win:
- If subject or snippet contains: "unfortunately", "not moving forward", "other candidates", "not selected", "position filled", "decided to move forward with", "לא נוכל", "מצטערים", "לא עברת", "chose other" → classify as "Rejected" regardless of the sending platform
- Greenhouse, Lever, Workday, SmartRecruiters, Taleo send BOTH rejections AND interview invites — do NOT infer "Interviewing" just because the email comes from one of these ATS platforms
- Only classify as "Interviewing" when subject/snippet explicitly mentions: interview, screening call, schedule a call, next step, meet with us, calendly link, availability, "let's talk", "we'd like to speak" — AND there are no rejection keywords present

CONFIDENCE SCORING — include a confidence value (0.0–1.0) per match:
- 1.0: Explicit rejection/offer/interview keyword in subject, unambiguous
- 0.9: Clear match with strong signal in snippet
- 0.8: Good match, minor ambiguity (e.g. company inferred from ATS sender)
- 0.7: Likely match but email is generic or sender indirect
- 0.6: Plausible match, some ambiguity in company or status
- Below 0.6: Do not include — too uncertain

Return ONLY a valid JSON array, no explanation, no markdown:
[
  {
    "emailIndex": 1,
    "company": "exact company name from the tracked list",
    "newStatus": "Applied" | "Interviewing" | "Rejected" | "Offer",
    "confidence": 0.95,
    "reason": "one sentence explaining the match"
  }
]

If no emails match any tracked company, return: []`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '[]';

  try {
    const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(json) as ClaudeMatch[];
  } catch {
    console.error('[claude] Failed to parse response:', text);
    return [];
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Auth: accept JWT or service role key
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isServiceCall = token === serviceRoleKey;

  let userId: string;
  let lookbackDays: number | null = null;

  if (isServiceCall) {
    const body = await req.json().catch(() => ({}));
    userId = body.userId;
    if (body.lookbackDays) lookbackDays = Number(body.lookbackDays);
    if (!userId) return new Response(JSON.stringify({ error: "userId required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } else {
    const body = await req.json().catch(() => ({}));
    if (body.lookbackDays) lookbackDays = Number(body.lookbackDays);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    userId = user.id;
  }

  console.log(`[update-job-statuses] Starting for user ${userId}`);

  try {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("google_refresh_token, last_status_sync_timestamp")
      .eq("id", userId)
      .single();

    const refreshToken = profile?.google_refresh_token;
    if (!refreshToken) throw new Error("Gmail not connected.");

    const nowSec = Math.floor(Date.now() / 1000);
    const sevenDaysAgoSec = nowSec - 7 * 24 * 60 * 60;
    let cutoffSec: number;
    let cutoffReason: string;
    if (lookbackDays !== null) {
      cutoffSec = nowSec - lookbackDays * 24 * 60 * 60;
      cutoffReason = `manual lookback ${lookbackDays}d`;
    } else if ((profile as any)?.last_status_sync_timestamp) {
      cutoffSec = (profile as any).last_status_sync_timestamp;
      cutoffReason = 'incremental since last sync';
    } else {
      cutoffSec = sevenDaysAgoSec;
      cutoffReason = 'first sync — defaulting to 7 days ago';
    }
    const syncCutoffDate = new Date(cutoffSec * 1000).toISOString().slice(0, 10).replace(/-/g, '/');
    console.log(`[update-job-statuses] Sync cutoff: ${syncCutoffDate} (${cutoffReason})`);

    const accessToken = await getAccessToken(refreshToken);

    const { data: jobs, error: jobsError } = await supabase
      .from("jobs")
      .select("id, company, role, status, company_domain, alert_date")
      .eq("user_id", userId)
      .in("status", ["New", "Old", "Applied", "Interviewing"])
      .order("alert_date", { ascending: false });

    if (jobsError) throw new Error(`Failed to fetch jobs: ${jobsError.message}`);
    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ success: true, jobsChecked: 0, statusesUpdated: 0, emailsFound: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[update-job-statuses] ${jobs.length} jobs to check`);

    const broadQuery = [
      'subject:application', 'subject:"your application"', 'subject:"application status"',
      'subject:"thank you for applying"', 'subject:candidacy',
      'subject:rejected', 'subject:"not moving forward"', 'subject:"other candidates"',
      'subject:unfortunately', 'subject:"position filled"', 'subject:"not selected"',
      'subject:interview', 'subject:screening', 'subject:"phone call"', 'subject:"next step"',
      'subject:"let\'s talk"', 'subject:"schedule a call"', 'subject:calendly',
      'subject:greenhouse', 'subject:lever', 'subject:"final round"',
      'subject:offer', 'subject:congratulations', 'subject:"employment offer"',
      'subject:מועמד', 'subject:ראיון', 'subject:"הצעת עבודה"',
      'subject:"לא נוכל"', 'subject:"מצטערים"', 'subject:"לא עברת"',
      'subject:"שלב הבא"', 'subject:גיוס',
    ].join(' OR ');

    const gmailSearchQuery = `(${broadQuery}) after:${syncCutoffDate}`;
    console.log(`[update-job-statuses] Gmail query: ${gmailSearchQuery}`);

    const listResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(gmailSearchQuery)}&maxResults=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!listResp.ok) throw new Error(`Gmail search failed: ${await listResp.text()}`);
    const listData = await listResp.json();
    const emailIds: { id: string }[] = listData.messages || [];

    console.log(`[update-job-statuses] Found ${emailIds.length} relevant email(s)`);

    if (emailIds.length === 0) {
      await supabase.from("user_profiles").update({ last_status_sync_timestamp: nowSec }).eq("id", userId);
      return new Response(
        JSON.stringify({ success: true, jobsChecked: jobs.length, statusesUpdated: 0, emailsFound: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const metaResults = await Promise.all(
      emailIds.map(async ({ id }) => {
        try {
          const resp = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!resp.ok) return null;
          const data = await resp.json();
          return {
            id,
            from: getHeader(data.payload, 'From'),
            subject: getHeader(data.payload, 'Subject'),
            snippet: (data.snippet || '').slice(0, 400),
          } as EmailSummary;
        } catch {
          return null;
        }
      })
    );

    const emails = metaResults.filter((e): e is EmailSummary => e !== null);
    console.log(`[update-job-statuses] Fetched metadata for ${emails.length} email(s)`);

    const matches = await analyzeEmailsWithClaude(
      emails,
      jobs.map(j => ({ id: j.id, company: j.company, role: j.role, status: j.status }))
    );

    console.log(`[update-job-statuses] Claude identified ${matches.length} match(es)`);

    // ── Step 4: Split high/low confidence, apply high-confidence immediately ──
    const CONFIDENCE_THRESHOLD = 0.8;
    let statusesUpdated = 0;
    const updates: Array<{ company: string; role: string; oldStatus: string; newStatus: string }> = [];
    const pendingChanges: PendingChange[] = [];

    const statusRank: Record<string, number> = { New: 0, Old: 0, Applied: 1, Interviewing: 2, Offer: 3, Rejected: 3 };

    for (const match of matches) {
      const job = jobs.find(j => j.company === match.company);
      if (!job) {
        console.warn(`[claude] Match for unknown company: ${match.company}`);
        continue;
      }

      if ((statusRank[match.newStatus] ?? 0) <= (statusRank[job.status] ?? 0)) {
        console.log(`[${match.company}] Skipping — would downgrade ${job.status} → ${match.newStatus}`);
        continue;
      }

      const confidence = match.confidence ?? 1.0;

      if (confidence >= CONFIDENCE_THRESHOLD) {
        console.log(`[${match.company}] AUTO-APPLY (${confidence}) ${job.status} → ${match.newStatus} | ${match.reason}`);

        const updateData: Record<string, any> = { status: match.newStatus };
        if (match.newStatus === 'Applied') updateData.applied_at = new Date().toISOString();

        const { error: updateError } = await supabase
          .from("jobs").update(updateData).eq("id", job.id).eq("user_id", userId);

        if (!updateError) {
          statusesUpdated++;
          updates.push({ company: job.company, role: job.role, oldStatus: job.status, newStatus: match.newStatus });
          job.status = match.newStatus;
        }
      } else {
        console.log(`[${match.company}] PENDING-REVIEW (${confidence}) ${job.status} → ${match.newStatus} | ${match.reason}`);
        pendingChanges.push({
          jobId: job.id,
          company: job.company,
          role: job.role,
          oldStatus: job.status,
          newStatus: match.newStatus,
          confidence,
          reason: match.reason,
        });
      }
    }

    // ── Step 5: Save timestamp, auto-applied changes, and pending changes ─────
    const profileUpdate: Record<string, any> = { last_status_sync_timestamp: nowSec };
    if (updates.length > 0) {
      profileUpdate.last_status_changes = {
        scanned_at: new Date().toISOString(),
        changes: updates,
      };
    }
    if (pendingChanges.length > 0) {
      profileUpdate.pending_status_changes = {
        generated_at: new Date().toISOString(),
        changes: pendingChanges,
      };
    } else {
      // Clear stale pending changes from previous runs
      profileUpdate.pending_status_changes = null;
    }

    await supabase.from("user_profiles")
      .update(profileUpdate)
      .eq("id", userId);

    console.log(`[update-job-statuses] Done: ${statusesUpdated} auto-applied, ${pendingChanges.length} pending review.`);
    return new Response(
      JSON.stringify({
        success: true,
        jobsChecked: jobs.length,
        emailsFound: emails.length,
        statusesUpdated,
        updates,
        pendingCount: pendingChanges.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[update-job-statuses] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to update job statuses" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
