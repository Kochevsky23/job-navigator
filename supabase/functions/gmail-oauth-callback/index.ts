import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  // Fallback redirect in case we can't parse state
  let redirectUrl = "https://job-navigator.vercel.app/settings";

  if (errorParam) {
    return Response.redirect(`${redirectUrl}?gmail=error&reason=${encodeURIComponent(errorParam)}`);
  }

  if (!code || !stateParam) {
    return Response.redirect(`${redirectUrl}?gmail=error&reason=missing_params`);
  }

  let userId: string;
  try {
    const state = JSON.parse(atob(stateParam));
    userId = state.user_id;
    if (state.redirect_url) redirectUrl = state.redirect_url;
  } catch {
    return Response.redirect(`${redirectUrl}?gmail=error&reason=invalid_state`);
  }

  if (!userId) {
    return Response.redirect(`${redirectUrl}?gmail=error&reason=missing_user_id`);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const callbackUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-oauth-callback`;

  // Exchange authorization code for tokens
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      redirect_uri: callbackUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenResp.json();

  if (!tokenData.refresh_token) {
    console.error("No refresh_token in token response:", JSON.stringify(tokenData));
    return Response.redirect(`${redirectUrl}?gmail=error&reason=no_refresh_token`);
  }

  // Store refresh token in user's profile
  const { error: updateError } = await supabase
    .from("user_profiles")
    .update({ google_refresh_token: tokenData.refresh_token })
    .eq("id", userId);

  if (updateError) {
    console.error("Failed to store refresh token:", updateError);
    return Response.redirect(`${redirectUrl}?gmail=error&reason=store_failed`);
  }

  return Response.redirect(`${redirectUrl}?gmail=connected`);
});
