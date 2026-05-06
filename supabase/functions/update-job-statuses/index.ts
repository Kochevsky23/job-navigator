import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  reason: string;
}

async function analyzeEmailsWithClaude(
  emails: EmailSummary[],
  jobs: { company: string; role: string; status: string }[]
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

Return ONLY a valid JSON array, no explanation, no markdown:
[
  {
    "emailIndex": 1,
    "company": "exact company name from the tracked list",
    "newStatus": "Applied" | "Interviewing" | "Rejected" | "Offer",
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
    // Strip markdown code blocks if present
    const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(json) as ClaudeMatch[];
  } catch {
    console.error('[claude] Failed to parse response:', text);
    return [];
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
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

    // Determine sync cutoff:
    // - lookbackDays param (manual button) → always use N days ago
    // - stored timestamp (cron) → incremental since last run
    // - fallback → 7 days ago
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

    // Fetch all actionable jobs
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

    // ── Step 1: One broad Gmail search for all application-status emails ─────
    const broadQuery = [
      // Application / status
      'subject:application', 'subject:"your application"', 'subject:"application status"',
      'subject:"thank you for applying"', 'subject:candidacy',
      // Rejection
      'subject:rejected', 'subject:"not moving forward"', 'subject:"other candidates"',
      'subject:unfortunately', 'subject:"position filled"', 'subject:"not selected"',
      // Interview / scheduling
      'subject:interview', 'subject:screening', 'subject:"phone call"', 'subject:"next step"',
      'subject:"let\'s talk"', 'subject:"schedule a call"', 'subject:calendly',
      'subject:greenhouse', 'subject:lever', 'subject:"final round"',
      // Offer
      'subject:offer', 'subject:congratulations', 'subject:"employment offer"',
      // Hebrew
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

    // ── Step 2: Fetch metadata (subject + from + snippet) in parallel ─────────
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

    // ── Step 3: Claude analyses all emails against all companies in one call ──
    const matches = await analyzeEmailsWithClaude(
      emails,
      jobs.map(j => ({ company: j.company, role: j.role, status: j.status }))
    );

    console.log(`[update-job-statuses] Claude identified ${matches.length} match(es)`);

    // ── Step 4: Apply updates ─────────────────────────────────────────────────
    let statusesUpdated = 0;
    const updates: Array<{ company: string; role: string; oldStatus: string; newStatus: string }> = [];

    const statusRank: Record<string, number> = { New: 0, Old: 0, Applied: 1, Interviewing: 2, Offer: 3, Rejected: 3 };

    for (const match of matches) {
      const job = jobs.find(j => j.company === match.company);
      if (!job) {
        console.warn(`[claude] Match for unknown company: ${match.company}`);
        continue;
      }

      // Never downgrade
      if ((statusRank[match.newStatus] ?? 0) <= (statusRank[job.status] ?? 0)) {
        console.log(`[${match.company}] Skipping — would downgrade ${job.status} → ${match.newStatus}`);
        continue;
      }

      console.log(`[${match.company}] ${job.status} → ${match.newStatus} | ${match.reason}`);

      const updateData: Record<string, any> = { status: match.newStatus };
      if (match.newStatus === 'Applied') updateData.applied_at = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("jobs").update(updateData).eq("id", job.id).eq("user_id", userId);

      if (!updateError) {
        statusesUpdated++;
        updates.push({ company: job.company, role: job.role, oldStatus: job.status, newStatus: match.newStatus });
        // Update local copy so duplicates in Claude response don't double-apply
        job.status = match.newStatus;
      }
    }

    // ── Step 5: Advance timestamp + save status changes for Pipeline ─────────
    const profileUpdate: Record<string, any> = { last_status_sync_timestamp: nowSec };
    if (updates.length > 0) {
      profileUpdate.last_status_changes = {
        scanned_at: new Date().toISOString(),
        changes: updates,
      };
    }
    await supabase.from("user_profiles")
      .update(profileUpdate)
      .eq("id", userId);

    console.log(`[update-job-statuses] Done: ${statusesUpdated} updated. Timestamp → ${nowSec}`);
    return new Response(
      JSON.stringify({ success: true, jobsChecked: jobs.length, emailsFound: emails.length, statusesUpdated, updates }),
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
