import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduled-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: accept either x-scheduled-secret header or service role key
  const scheduledSecret = req.headers.get("x-scheduled-secret");
  const authHeader = req.headers.get("Authorization") || "";
  const expectedSecret = Deno.env.get("SCHEDULED_SCAN_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const isAuthorized =
    (scheduledSecret && expectedSecret && scheduledSecret === expectedSecret) ||
    authHeader.replace("Bearer ", "") === serviceRoleKey;

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey
  );

  // mode: "scan" = find new jobs only (morning)
  //        "scan_and_status" = find new jobs + age + detect status changes (evening)
  // Auto-detected from UTC hour when not passed explicitly (19:00 UTC = evening run).
  const body = await req.json().catch(() => ({}));
  const utcHour = new Date().getUTCHours();
  const autoMode: "scan" | "scan_and_status" = utcHour >= 16 ? "scan_and_status" : "scan";
  const mode: "scan" | "scan_and_status" =
    body.mode === "scan_and_status" ? "scan_and_status" :
    body.mode === "scan" ? "scan" :
    autoMode;

  // Get all users with Gmail connected (vault_token_id is source of truth)
  const { data: profiles, error } = await supabase
    .from("user_profiles")
    .select("id")
    .not("vault_token_id", "is", null);

  if (error || !profiles || profiles.length === 0) {
    console.log("No users with Gmail connected:", error?.message);
    return new Response(JSON.stringify({ triggered: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`Mode: ${mode} | Users: ${profiles.length}`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  // Build tasks — run in background so we can respond immediately
  const scanTask = (async () => {
    for (const profile of profiles) {
      try {
        // ── Both modes: find and score new jobs (Claude) ──────────────────────
        const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
        const userEmail = authUser?.user?.email;

        const scanResp = await fetch(`${supabaseUrl}/functions/v1/daily-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({ userId: profile.id, userEmail }),
        });
        const scanResult = await scanResp.json().catch(() => ({}));
        if (scanResp.ok) {
          console.log(`User ${profile.id}: found=${scanResult.jobs_found}, added=${scanResult.jobs_added}`);
        } else {
          console.error(`User ${profile.id} scan failed:`, scanResult.error);
        }

        // ── Morning only (mode !== scan_and_status): age jobs + sync statuses ───
        if (mode !== "scan_and_status") {
          const sevenDaysAgo    = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString();
          const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

          await supabase.from("jobs")
            .update({ status: "Archive" })
            .eq("user_id", profile.id)
            .in("status", ["New", "Old"])
            .lt("alert_date", fourteenDaysAgo);

          await supabase.from("jobs")
            .update({ status: "Old" })
            .eq("user_id", profile.id)
            .eq("status", "New")
            .lt("alert_date", sevenDaysAgo);

          console.log(`User ${profile.id}: aging done`);

          const statusResp = await fetch(`${supabaseUrl}/functions/v1/update-job-statuses`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({ userId: profile.id }),
          });
          const statusResult = await statusResp.json().catch(() => ({}));
          if (statusResp.ok) {
            console.log(`User ${profile.id}: ${statusResult.statusesUpdated} statuses updated`);
            if ((statusResult.updates || []).length > 0) {
              await supabase.from("user_profiles").update({
                last_status_changes: {
                  scanned_at: new Date().toISOString(),
                  changes: statusResult.updates,
                },
              }).eq("id", profile.id);
            }
          } else {
            console.error(`User ${profile.id} status update failed:`, statusResult.error);
          }
        }

        // ── Every run: auto ml-feedback if not run in last 3 days ────────────
        try {
          const { data: prof } = await supabase.from("user_profiles")
            .select("scoring_feedback")
            .eq("id", profile.id)
            .single();
          const lastRun = (prof as any)?.scoring_feedback?.last_updated;
          const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
          const needsFeedback = !lastRun || new Date(lastRun).getTime() < threeDaysAgo;
          if (needsFeedback) {
            const mlResp = await fetch(`${supabaseUrl}/functions/v1/ml-feedback`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
              body: JSON.stringify({ userId: profile.id }),
            });
            const mlResult = await mlResp.json().catch(() => ({}));
            if (mlResp.ok && mlResult.success) {
              console.log(`User ${profile.id}: ml-feedback updated scoring hints`);
            } else {
              console.log(`User ${profile.id}: ml-feedback skipped — ${mlResult.message || mlResult.error || "unknown"}`);
            }
          } else {
            console.log(`User ${profile.id}: ml-feedback skipped (ran ${Math.round((Date.now() - new Date(lastRun).getTime()) / 3600000)}h ago)`);
          }
        } catch (mlErr: any) {
          console.error(`User ${profile.id} ml-feedback error:`, mlErr.message);
        }
      } catch (e: any) {
        console.error(`User ${profile.id} exception:`, e.message);
      }
    }
  })();

  // Register as background work so it completes after response is sent
  // @ts-ignore — EdgeRuntime is available in Supabase edge runtime
  if (typeof EdgeRuntime !== "undefined") {
    // @ts-ignore
    EdgeRuntime.waitUntil(scanTask);
  }

  // Return immediately — scans run in background
  return new Response(
    JSON.stringify({ triggered: profiles.length, message: "Scans started in background" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
