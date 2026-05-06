import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders } from "../_shared/cors.ts";

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
    // Surface scope issue clearly
    if (err.includes("invalid_grant") || err.includes("invalid_scope")) {
      throw new Error("REAUTH_REQUIRED");
    }
    throw new Error(`Token refresh failed: ${err}`);
  }
  const data = await resp.json();
  return data.access_token;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Get refresh token
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("google_refresh_token, full_name")
      .eq("id", user.id)
      .single();

    if (!profile?.google_refresh_token) {
      return new Response(JSON.stringify({ error: "Gmail not connected." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken: string;
    try {
      accessToken = await getAccessToken(profile.google_refresh_token);
    } catch (e: any) {
      if (e.message === "REAUTH_REQUIRED") {
        return new Response(JSON.stringify({ error: "REAUTH_REQUIRED", message: "Reconnect Gmail to grant Sheets access." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }

    // Fetch all jobs (exclude Archive)
    const { data: jobs, error: jobsError } = await supabase
      .from("jobs")
      .select("company, role, location, score, priority, status, alert_date, applied_at, job_link, reason, notes, user_score")
      .eq("user_id", user.id)
      .neq("status", "Archive")
      .order("score", { ascending: false });

    if (jobsError) throw new Error(`Failed to fetch jobs: ${jobsError.message}`);

    const title = `Job Pipeline — ${profile.full_name || "Job Navigator"} (${new Date().toLocaleDateString('en-GB')})`;

    // Create spreadsheet
    const createResp = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: { title },
        sheets: [{
          properties: { title: "Pipeline", gridProperties: { frozenRowCount: 1 } },
        }],
      }),
    });

    if (!createResp.ok) {
      const err = await createResp.text();
      if (createResp.status === 403) {
        return new Response(JSON.stringify({ error: "REAUTH_REQUIRED", message: "Reconnect Gmail to grant Sheets access." }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`Sheets create failed: ${err}`);
    }

    const sheet = await createResp.json();
    const spreadsheetId = sheet.spreadsheetId;
    const spreadsheetUrl = sheet.spreadsheetUrl;

    // Build rows: header + data
    const header = ["Company", "Role", "Location", "Score", "Priority", "Status", "Alert Date", "Applied Date", "My Rating", "Job Link", "AI Reason", "My Notes"];
    const rows = (jobs || []).map(j => [
      j.company ?? "",
      j.role ?? "",
      j.location ?? "",
      j.score ?? "",
      j.priority ?? "",
      j.status ?? "",
      j.alert_date ? j.alert_date.slice(0, 10) : "",
      j.applied_at ? j.applied_at.slice(0, 10) : "",
      j.user_score ?? "",
      j.job_link ?? "",
      j.reason ?? "",
      j.notes ?? "",
    ]);

    const values = [header, ...rows];

    // Write data
    const updateResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pipeline!A1:L${values.length}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values }),
      }
    );

    if (!updateResp.ok) throw new Error(`Sheets write failed: ${await updateResp.text()}`);

    // Bold header row via batchUpdate
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 } } },
              fields: "userEnteredFormat(textFormat,backgroundColor)",
            },
          },
          {
            autoResizeDimensions: {
              dimensions: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: 12 },
            },
          },
        ],
      }),
    });

    console.log(`[export-to-sheets] Created sheet: ${spreadsheetUrl} with ${rows.length} jobs`);

    return new Response(
      JSON.stringify({ success: true, url: spreadsheetUrl, jobCount: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[export-to-sheets] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Export failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
