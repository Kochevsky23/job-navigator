import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { upsertVaultToken } from "../_shared/vault.ts";

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

  // Get existing vault_token_id (for update vs create)
  const { data: existingProfile } = await supabase
    .from("user_profiles")
    .select("vault_token_id")
    .eq("id", userId)
    .single();

  // Store refresh token in Vault (encrypted), save UUID reference in profile
  const vaultId = await upsertVaultToken(
    supabase,
    (existingProfile as any)?.vault_token_id ?? null,
    tokenData.refresh_token,
    userId
  );

  if (!vaultId) {
    console.error("Failed to store refresh token in vault for user:", userId);
    return Response.redirect(`${redirectUrl}?gmail=error&reason=store_failed`);
  }

  const { error: updateError } = await supabase
    .from("user_profiles")
    .update({ vault_token_id: vaultId, google_refresh_token: null })
    .eq("id", userId);

  if (updateError) {
    console.error("Failed to update vault_token_id:", updateError);
    return Response.redirect(`${redirectUrl}?gmail=error&reason=store_failed`);
  }

  return Response.redirect(`${redirectUrl}?gmail=connected`);
});
