import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Helper: Extract email body from Gmail API payload ────────────────────────
function extractEmailBody(payload: any): string {
  if (payload.body?.data) {
    try {
      return atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    } catch {
      return '';
    }
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        try {
          return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
        } catch {
          continue;
        }
      }
    }
    for (const part of payload.parts) {
      const nested = extractEmailBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

// ─── Helper: Get email headers ─────────────────────────────────────────────────
function getHeader(payload: any, name: string): string {
  const header = payload.headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

// ─── Helper: Analyze email content for status keywords ────────────────────────
function analyzeEmailForStatus(subject: string, body: string, companyName?: string, emailDate?: string): string | null {
  const text = (subject + ' ' + body).toLowerCase();

  // Rejection keywords - EXPLICIT rejections only to avoid false positives
  const rejectionKeywords = [
    'we regret to inform',
    'not moving forward with your application',
    'will not be moving forward with your application',
    'decided to pursue other candidates',
    'decided to move forward with other candidates',
    'we have decided to move forward with other candidates',
    'moving forward with another applicant',
    'moving forward with another candidate',
    'position has been filled',
    'not selected for this position',
    'not selected for the position',
    'have not been selected for this position',
    'not be progressing your application',
    'will not be progressing your application',
    'we have chosen another candidate',
    'decided not to proceed with your application',
    'application was not successful',
    'your application was not successful',
    'unable to offer you the position',
    'decided to go in a different direction',
  ];

  // Offer keywords
  const offerKeywords = [
    'offer of employment',
    'pleased to offer',
    'extend an offer',
    'job offer',
    'offer letter',
    'we would like to offer you',
    'congratulations',
    'welcome to the team',
    'accept our offer',
  ];

  // Interview keywords
  const interviewKeywords = [
    'schedule an interview',
    'interview invitation',
    'would like to interview',
    'invite you to interview',
    'next step is an interview',
    'phone interview',
    'video interview',
    'in-person interview',
    'meet with',
    'available for a call',
    'discuss your application',
  ];

  // Check in priority order: offer > interview > rejection
  for (const keyword of offerKeywords) {
    if (text.includes(keyword)) {
      console.log(`[update-job-statuses] OFFER detected${companyName ? ` for ${companyName}` : ''}: keyword="${keyword}"`);
      return 'Offer';
    }
  }

  for (const keyword of interviewKeywords) {
    if (text.includes(keyword)) {
      console.log(`[update-job-statuses] INTERVIEW detected${companyName ? ` for ${companyName}` : ''}: keyword="${keyword}"`);
      return 'Interviewing';
    }
  }

  for (const keyword of rejectionKeywords) {
    if (text.includes(keyword)) {
      console.log(`[update-job-statuses]   ⚠️ REJECTION DETECTED`);
      console.log(`[update-job-statuses]   Keyword matched: "${keyword}"`);
      console.log(`[update-job-statuses]   Full email body:`);
      console.log(`[update-job-statuses]   ${body}`);
      return 'Rejected';
    }
  }

  return null; // No status change detected
}

// ─── Helper: Get access token from refresh token ───────────────────────────────
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

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Failed to refresh token: ${err}`);
  }

  const data = await resp.json();
  return data.access_token;
}

// ─── Main handler ──────────────────────────────────────────────────────────────
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
    console.error("[update-job-statuses] user has no id");
    return new Response(JSON.stringify({ error: "No authenticated user" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[update-job-statuses] Starting for user ${userId}`);

  try {

    // Get user's Google refresh token
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("google_refresh_token")
      .eq("id", userId)
      .single();

    const refreshToken = profile?.google_refresh_token;
    if (!refreshToken) {
      throw new Error("Google account not connected. Please connect your Gmail account in Settings.");
    }

    const accessToken = await getAccessToken(refreshToken);

    // Get all jobs except Archived
    const { data: jobs, error: jobsError } = await supabase
      .from("jobs")
      .select("id, company, role, status, company_domain")
      .eq("user_id", userId)
      .neq("status", "Archived");

    if (jobsError) throw new Error(`Failed to fetch jobs: ${jobsError.message}`);
    if (!jobs || jobs.length === 0) {
      console.log("[update-job-statuses] No jobs with Applied/Interviewing/Offer status");
      return new Response(
        JSON.stringify({ 
          success: true, 
          jobsChecked: 0, 
          statusesUpdated: 0,
          message: "No jobs to check"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[update-job-statuses] Found ${jobs.length} jobs to check`);

    let statusesUpdated = 0;
    const updates: Array<{ company: string; role: string; oldStatus: string; newStatus: string }> = [];

    // Check each job for email responses
    for (const job of jobs) {
      const companyName = job.company;
      
      // Always search last 14 days for status updates
      const searchDays = 14;
      
      console.log(`\n[update-job-statuses] ========== ${companyName} - ${job.role} ==========`);
      console.log(`[update-job-statuses]   Status: ${job.status}`);
      console.log(`[update-job-statuses]   Domain: ${job.company_domain || 'none'}`);
      
      // Try multiple search variations to catch different email domains
      const companyNameClean = companyName.toLowerCase().replace(/\s+/g, '');
      const searchTerms = [];

      // 1. Company domain from database
      if (job.company_domain) {
        searchTerms.push(`from:@${job.company_domain}`);
      }

      // 2. Full company name variations
      searchTerms.push(`from:"${companyName}"`);
      searchTerms.push(`subject:"${companyName}"`);

      // 3. Abbreviated domain (e.g., Applied Materials -> AM -> amat.com)
      const words = companyName.split(' ');
      if (words.length > 1) {
        const firstLetters = words.map(w => w[0].toLowerCase()).join('');
        searchTerms.push(`from:@${firstLetters}at.com`); // amat.com
        searchTerms.push(`from:@${firstLetters}.com`);   // am.com
      }

      // 4. Clean company name as domain
      searchTerms.push(`from:@${companyNameClean}.com`);

      const gmailQuery = `(${searchTerms.join(' OR ')}) newer_than:${searchDays}d`;
      const query = encodeURIComponent(gmailQuery);
      
      console.log(`[update-job-statuses]   Gmail query: "${gmailQuery}"`);

      try {
        const listResp = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=10`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!listResp.ok) {
          console.error(`[update-job-statuses] Gmail API error for ${job.company}: ${listResp.status}`);
          continue;
        }

        const listData = await listResp.json();
        if (!listData.messages || listData.messages.length === 0) {
          console.log(`[update-job-statuses]   ✗ No emails found`);
          continue;
        }

        console.log(`[update-job-statuses]   ✓ Gmail found ${listData.messages.length} email(s)`);

        // Check each email for status keywords
        let newStatus: string | null = null;
        let emailIndex = 0;
        for (const msg of listData.messages) {
          emailIndex++;
          const msgResp = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );

          if (!msgResp.ok) continue;

          const msgData = await msgResp.json();
          const subject = getHeader(msgData.payload, "Subject");
          const from = getHeader(msgData.payload, "From");
          const date = getHeader(msgData.payload, "Date");
          const body = extractEmailBody(msgData.payload);

          console.log(`[update-job-statuses]   --- Email ${emailIndex}/${listData.messages.length} ---`);
          console.log(`[update-job-statuses]   Subject: "${subject}"`);
          console.log(`[update-job-statuses]   From: "${from}"`);
          console.log(`[update-job-statuses]   Date: "${date}"`);
          console.log(`[update-job-statuses]   Body (first 500 chars): "${body.substring(0, 500)}"`);
          console.log(`[update-job-statuses]   Checking for status keywords...`);

          const detectedStatus = analyzeEmailForStatus(subject, body, companyName, date);
          if (detectedStatus) {
            newStatus = detectedStatus;
            break; // Use the first detected status
          } else {
            console.log(`[update-job-statuses]   ✗ No status keywords detected`);
          }
        }

        // Update job status if changed
        if (newStatus && newStatus !== job.status) {
          const { error: updateError } = await supabase
            .from("jobs")
            .update({ status: newStatus })
            .eq("id", job.id)
            .eq("user_id", userId);

          if (updateError) {
            console.error(`[update-job-statuses] Failed to update ${job.company}: ${updateError.message}`);
          } else {
            console.log(`[update-job-statuses] ✓ Updated ${job.company} from ${job.status} → ${newStatus}`);
            statusesUpdated++;
            updates.push({
              company: job.company,
              role: job.role,
              oldStatus: job.status,
              newStatus: newStatus,
            });
          }
        }
      } catch (emailError: any) {
        console.error(`[update-job-statuses] Error checking ${job.company}:`, emailError.message);
        continue;
      }
    }

    console.log(`[update-job-statuses] Complete: ${statusesUpdated} statuses updated`);

    return new Response(
      JSON.stringify({
        success: true,
        jobsChecked: jobs.length,
        statusesUpdated,
        updates,
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
