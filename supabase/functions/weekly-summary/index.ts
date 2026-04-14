import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Resend } from "npm:resend";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TARGET_EMAIL = "dorkochevsky15@gmail.com";
const APP_URL = "http://localhost:8081";


function scoreColor(score: number): string {
  if (score >= 8) return "#22c55e";
  if (score >= 6) return "#f59e0b";
  return "#94a3b8";
}

function statusColor(status: string): string {
  if (status === "Interviewing") return "#3b82f6";
  if (status === "Offer") return "#22c55e";
  if (status === "Rejected") return "#ef4444";
  if (status === "Applied") return "#f59e0b";
  return "#94a3b8";
}

function jobCard(job: any): string {
  const snippet = job.reason
    ? `<div style="color:#94a3b8;font-size:12px;margin-top:6px;line-height:1.5;">${job.reason.substring(0, 130)}${job.reason.length > 130 ? "…" : ""}</div>`
    : "";
  const link = job.job_link
    ? `<div style="margin-top:10px;"><a href="${job.job_link}" style="color:#6366f1;font-size:12px;text-decoration:none;font-weight:500;">→ View Job Listing</a></div>`
    : "";
  return `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:12px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td>
          <div style="font-weight:600;font-size:15px;color:#1e293b;">${job.role}</div>
          <div style="color:#64748b;font-size:13px;margin-top:3px;">${job.company}${job.location ? " · " + job.location : ""}</div>
          ${snippet}
        </td>
        <td width="42" valign="top" style="padding-left:12px;">
          <div style="background:${scoreColor(job.score)};color:#fff;font-weight:700;font-size:14px;border-radius:6px;padding:5px 8px;text-align:center;white-space:nowrap;">${job.score}/10</div>
        </td>
      </tr></table>
      ${link}
    </div>`;
}

function statusCard(job: any): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;"><tr>
      <td style="padding:12px 16px;">
        <span style="font-weight:600;font-size:14px;color:#1e293b;">${job.role}</span>
        <span style="color:#94a3b8;font-size:13px;"> at </span>
        <span style="font-size:14px;color:#475569;">${job.company}</span>
      </td>
      <td style="padding:12px 16px;" align="right">
        <span style="background:${statusColor(job.status)};color:#fff;font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;">${job.status}</span>
      </td>
    </tr></table>`;
}

function topCard(job: any, rank: number): string {
  const link = job.job_link
    ? `<div style="margin-top:10px;"><a href="${job.job_link}" style="color:#6366f1;font-size:12px;text-decoration:none;font-weight:500;">→ View Job Listing</a></div>`
    : "";
  return `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:12px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="36" valign="top">
          <div style="width:28px;height:28px;background:#6366f1;color:#fff;font-weight:700;font-size:14px;border-radius:50%;text-align:center;line-height:28px;">${rank}</div>
        </td>
        <td style="padding-left:10px;">
          <div style="font-weight:600;font-size:15px;color:#1e293b;">${job.role}</div>
          <div style="color:#64748b;font-size:13px;margin-top:3px;">${job.company}${job.location ? " · " + job.location : ""} · Score: <strong>${job.score}/10</strong></div>
        </td>
      </tr></table>
      ${link}
    </div>`;
}

function buildEmailHtml(opts: {
  highJobs: any[];
  statusJobs: any[];
  topUnapplied: any[];
  stats: { total: number; highCount: number; appliedCount: number; cvsCount: number };
  weekStart: string;
  weekEnd: string;
}): string {
  const { highJobs, statusJobs, topUnapplied, stats, weekStart, weekEnd } = opts;

  const noHighMsg = `<div style="color:#94a3b8;font-size:14px;padding:20px;background:#f8fafc;border-radius:8px;text-align:center;">No HIGH priority jobs found this week.</div>`;

  const statusSection = statusJobs.length > 0 ? `
    <div style="margin-bottom:32px;">
      <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0 0 4px 0;">📋 Applications in Progress</h2>
      <div style="font-size:13px;color:#94a3b8;margin-bottom:16px;">${statusJobs.length} active application${statusJobs.length !== 1 ? "s" : ""}</div>
      ${statusJobs.map(statusCard).join("")}
    </div>` : "";

  const topSection = topUnapplied.length > 0 ? `
    <div style="margin-bottom:32px;">
      <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0 0 4px 0;">🎯 Top Matches You Haven't Applied To Yet</h2>
      <div style="font-size:13px;color:#94a3b8;margin-bottom:16px;">Your highest-scoring unapplied HIGH priority jobs</div>
      ${topUnapplied.map((j, i) => topCard(j, i + 1)).join("")}
    </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Job Compass Weekly Summary</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.07);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:32px 32px 24px;">
      <div style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">🧭 Job Compass</div>
      <div style="color:#c7d2fe;font-size:14px;margin-top:4px;">Weekly Summary · ${weekStart} – ${weekEnd}</div>
    </div>

    <!-- Stats Bar -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
      <tr>
        <td width="25%" style="text-align:center;padding:18px 0;border-right:1px solid #e2e8f0;">
          <div style="font-size:26px;font-weight:700;color:#1e293b;">${stats.total}</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:3px;text-transform:uppercase;letter-spacing:0.6px;">Jobs Scanned</div>
        </td>
        <td width="25%" style="text-align:center;padding:18px 0;border-right:1px solid #e2e8f0;">
          <div style="font-size:26px;font-weight:700;color:#6366f1;">${stats.highCount}</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:3px;text-transform:uppercase;letter-spacing:0.6px;">High Priority</div>
        </td>
        <td width="25%" style="text-align:center;padding:18px 0;border-right:1px solid #e2e8f0;">
          <div style="font-size:26px;font-weight:700;color:#f59e0b;">${stats.appliedCount}</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:3px;text-transform:uppercase;letter-spacing:0.6px;">Applied</div>
        </td>
        <td width="25%" style="text-align:center;padding:18px 0;">
          <div style="font-size:26px;font-weight:700;color:#22c55e;">${stats.cvsCount}</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:3px;text-transform:uppercase;letter-spacing:0.6px;">CVs Generated</div>
        </td>
      </tr>
    </table>

    <!-- Body -->
    <div style="padding:28px 32px;">

      <!-- High Priority Jobs -->
      <div style="margin-bottom:32px;">
        <h2 style="font-size:16px;font-weight:700;color:#1e293b;margin:0 0 4px 0;">⭐ New HIGH Priority Jobs This Week</h2>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:16px;">${highJobs.length} job${highJobs.length !== 1 ? "s" : ""} found</div>
        ${highJobs.length > 0 ? highJobs.map(jobCard).join("") : noHighMsg}
      </div>

      ${statusSection}
      ${topSection}

      <!-- CTA -->
      <div style="text-align:center;padding-top:20px;border-top:1px solid #f1f5f9;">
        <a href="${APP_URL}/jobs" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;font-weight:600;font-size:14px;padding:13px 30px;border-radius:8px;text-decoration:none;">View in Job Compass →</a>
        <div style="color:#cbd5e1;font-size:11px;margin-top:16px;">Job Compass · Weekly Summary · ${new Date().getFullYear()}</div>
      </div>

    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // 1. Resolve user by email (service role allows admin lookup)
    const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) throw new Error(`Failed to list users: ${usersError.message}`);
    const user = (users as any[]).find((u) => u.email === TARGET_EMAIL);
    if (!user) throw new Error(`User ${TARGET_EMAIL} not found in auth.users`);
    const userId = user.id;

    // 2. Date range
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const weekStart = fmt(sevenDaysAgo);
    const weekEnd = fmt(now);

    // 3. Jobs added this week
    const { data: weeklyJobs, error: jobsError } = await supabase
      .from("jobs")
      .select("id, company, role, location, score, priority, status, reason, job_link, tailored_cv")
      .eq("user_id", userId)
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("score", { ascending: false });
    if (jobsError) throw new Error(`Failed to fetch weekly jobs: ${jobsError.message}`);
    const weekJobs: any[] = weeklyJobs || [];

    // 4. All active applications (Applied / Interviewing / Offer) across all time
    const { data: activeApps } = await supabase
      .from("jobs")
      .select("id, company, role, status, score, job_link")
      .eq("user_id", userId)
      .in("status", ["Applied", "Interviewing", "Offer"])
      .order("score", { ascending: false });
    const statusJobs: any[] = activeApps || [];

    // 5. Build segments
    const highJobs = weekJobs.filter((j) => j.priority === "HIGH");
    const topUnapplied = weekJobs
      .filter((j) => j.status === "New" && j.priority === "HIGH")
      .slice(0, 3);
    const stats = {
      total: weekJobs.length,
      highCount: highJobs.length,
      appliedCount: statusJobs.length,
      cvsCount: weekJobs.filter((j) => j.tailored_cv).length,
    };

    // 6. Send email via Resend
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
    const subject = `📊 Job Compass Weekly: ${stats.total} scanned · ${stats.highCount} HIGH priority`;
    const html = buildEmailHtml({ highJobs, statusJobs, topUnapplied, stats, weekStart, weekEnd });
    const { error: sendError } = await resend.emails.send({
      from: "Job Compass <onboarding@resend.dev>",
      to: TARGET_EMAIL,
      subject,
      html,
    });
    if (sendError) throw new Error(`Resend failed: ${JSON.stringify(sendError)}`);

    console.log(`[weekly-summary] Sent to ${TARGET_EMAIL}. Stats: ${JSON.stringify(stats)}`);
    return new Response(JSON.stringify({ success: true, stats, emailSentTo: TARGET_EMAIL }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[weekly-summary] Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
