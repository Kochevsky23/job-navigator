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

  // Get all users with Gmail connected
  const { data: profiles, error } = await supabase
    .from("user_profiles")
    .select("id")
    .not("google_refresh_token", "is", null);

  if (error || !profiles || profiles.length === 0) {
    console.log("No users with Gmail connected:", error?.message);
    return new Response(JSON.stringify({ triggered: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`Triggering scheduled scan for ${profiles.length} user(s)`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  // Build scan tasks — run in background so we can respond immediately
  const scanTask = (async () => {
    for (const profile of profiles) {
      try {
        const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
        const userEmail = authUser?.user?.email;

        const resp = await fetch(`${supabaseUrl}/functions/v1/daily-scan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ userId: profile.id, userEmail }),
        });

        const result = await resp.json().catch(() => ({}));
        if (resp.ok) {
          console.log(`User ${profile.id}: found=${result.jobs_found}, added=${result.jobs_added}`);
        } else {
          console.error(`User ${profile.id} failed:`, result.error);
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
