import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...(init || {}),
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

function buildGoogleAuthUrl(clientId: string, redirectUri: string, userId: string): string {
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("scope", [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.labels",
  ].join(" "));
  authUrl.searchParams.set("state", userId);
  return authUrl.toString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("Missing Google OAuth env vars");

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    const { code, redirect_uri, action, user_id } = body;

    // get_auth_url: no auth needed — just builds a Google OAuth redirect URL
    if (action === "get_auth_url") {
      if (!user_id || typeof user_id !== "string") {
        return jsonResponse({ error: "Missing user_id" }, { status: 400 });
      }
      const callbackRedirectUri = typeof redirect_uri === "string" && redirect_uri
        ? redirect_uri
        : `${new URL(req.url).origin}/onboarding/gmail-callback`;
      return jsonResponse({
        url: buildGoogleAuthUrl(clientId, callbackRedirectUri, user_id),
        redirect_uri: callbackRedirectUri,
      });
    }

    // code exchange: use user_id from body (the OAuth code itself proves authorization)
    const userId = typeof user_id === "string" && user_id ? user_id : null;
    if (!userId) {
      return jsonResponse({ error: "Missing user_id" }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    if (!code || typeof code !== "string") {
      return jsonResponse({ error: "Missing code" }, { status: 400 });
    }

    const finalRedirectUri = typeof redirect_uri === "string" && redirect_uri
      ? redirect_uri
      : `${new URL(req.url).origin}/onboarding/gmail-callback`;

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: finalRedirectUri,
      }),
    });

    const tokenData: any = await tokenResp.json().catch(() => null);
    if (!tokenResp.ok) {
      return jsonResponse({ error: tokenData || "Token exchange failed" }, { status: 400 });
    }

    const refreshToken = tokenData?.refresh_token;
    if (!refreshToken) {
      return jsonResponse({ error: "No refresh token returned (try re-consenting)" }, { status: 400 });
    }

    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update({ google_refresh_token: refreshToken } as any)
      .eq("id", userId);

    if (updateError) throw new Error(updateError.message);

    return jsonResponse({ success: true });
  } catch (error: any) {
    console.error("gmail-oauth error:", error.message, error.stack);
    return jsonResponse({ error: error?.message || "Unknown error", stack: error?.stack }, { status: 500 });
  }
});
