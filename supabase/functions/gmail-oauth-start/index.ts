import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

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
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const redirectUrl: string = body.redirect_url || "";

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const callbackUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-oauth-callback`;

  const state = btoa(JSON.stringify({ user_id: user.id, redirect_url: redirectUrl }));

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUri,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ].join(" "),
    access_type: "offline",
    prompt: "consent", // Always re-prompt so we always get a refresh_token
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  return new Response(JSON.stringify({ url: authUrl }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
