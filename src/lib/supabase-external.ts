// Re-export the Lovable Cloud Supabase client as `db` for backward compatibility
import { supabase } from '@/integrations/supabase/client';
export const db = supabase;
