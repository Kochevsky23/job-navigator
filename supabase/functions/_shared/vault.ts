import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Fetch a decrypted vault secret by UUID.
 * Requires service_role client.
 */
export async function getVaultToken(
  supabase: SupabaseClient,
  vaultTokenId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_decrypted_secret", {
    secret_id: vaultTokenId,
  });
  if (error || !data) {
    console.error("[vault] getVaultToken failed:", error?.message);
    return null;
  }
  return data as string;
}

/**
 * Create or update a vault secret for a user's Gmail token.
 * Pass existingVaultId = null to create, UUID to update.
 * Returns the vault secret UUID to store in user_profiles.vault_token_id.
 */
export async function upsertVaultToken(
  supabase: SupabaseClient,
  existingVaultId: string | null,
  token: string,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc("upsert_vault_secret", {
    p_secret_id: existingVaultId ?? null,
    p_secret: token,
    p_name: `gmail_token_${userId}`,
  });
  if (error || !data) {
    console.error("[vault] upsertVaultToken failed:", error?.message);
    return null;
  }
  return data as string;
}
