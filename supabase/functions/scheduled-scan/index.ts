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
    (scheduledSecret && scheduledSecret === expectedSecret) ||
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

  // Get all users with Gmail connected and scheduled scan enabled (or all users if none have the setting yet)
  const { data: profiles, error } = await supabase
    .from("user_profiles")
    .select("id")
    .not("google_refresh_token", "is", null);

  if (error || !profiles || profiles.length === 0) {
    console.log("No users with Gmail connected, or error:", error?.message);
    return new Response(JSON.stringify({ scanned: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`Running scheduled scan for ${profiles.length} user(s)`);

  const results: { userId: string; success: boolean; error?: string }[] = [];

  for (const profile of profiles) {
    try {
      // Get user email from auth
      const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
      const userEmail = authUser?.user?.email;

      // Call daily-scan with service role key + userId
      const scanResp = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/daily-scan`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ userId: profile.id, userEmail }),
        }
      );

      if (scanResp.ok) {
        const scanData = await scanResp.json();
        console.log(`User ${profile.id}: found=${scanData.jobs_found}, added=${scanData.jobs_added}`);
        results.push({ userId: profile.id, success: true });
      } else {
        const errData = await scanResp.json().catch(() => ({}));
        console.error(`User ${profile.id} scan failed:`, errData.error);
        results.push({ userId: profile.id, success: false, error: errData.error });
      }
    } catch (e: any) {
      console.error(`User ${profile.id} exception:`, e.message);
      results.push({ userId: profile.id, success: false, error: e.message });
    }
  }

  return new Response(JSON.stringify({ scanned: profiles.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
