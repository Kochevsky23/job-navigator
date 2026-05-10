-- SEC-004: Encrypt Gmail refresh tokens using Supabase Vault
-- Protects user tokens in multi-user context — vault adds app-level encryption
-- on top of existing Postgres at-rest encryption.

-- 1. Add vault_token_id column to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vault_token_id uuid;

-- 2. Helper: read a vault secret (service_role only via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.get_decrypted_secret(secret_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = vault, public, extensions
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = secret_id;
$$;

-- 3. Helper: create or update a vault secret, returns the secret UUID
CREATE OR REPLACE FUNCTION public.upsert_vault_secret(
  p_secret_id uuid,
  p_secret text,
  p_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public, extensions
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_secret_id IS NULL THEN
    v_id := vault.create_secret(p_secret, p_name);
  ELSE
    PERFORM vault.update_secret(p_secret_id, p_secret);
    v_id := p_secret_id;
  END IF;
  RETURN v_id;
END;
$$;

-- 4. Helper: delete a vault secret
CREATE OR REPLACE FUNCTION public.delete_vault_secret(secret_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = vault, public, extensions
AS $$
  DELETE FROM vault.secrets WHERE id = secret_id;
$$;

-- 5. Migrate existing plain-text tokens to vault
DO $$
DECLARE
  r RECORD;
  v_id uuid;
BEGIN
  FOR r IN
    SELECT id, google_refresh_token
    FROM user_profiles
    WHERE google_refresh_token IS NOT NULL
      AND vault_token_id IS NULL
  LOOP
    v_id := vault.create_secret(
      r.google_refresh_token,
      'gmail_token_' || r.id::text
    );
    UPDATE user_profiles
    SET vault_token_id = v_id,
        google_refresh_token = NULL
    WHERE id = r.id;
    RAISE NOTICE 'Migrated vault token for user %', r.id;
  END LOOP;
END;
$$;
