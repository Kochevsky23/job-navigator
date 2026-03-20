import { supabase } from '@/integrations/supabase/client';

const CLOUD_URL = import.meta.env.VITE_SUPABASE_URL;

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session?.access_token}`,
  };
}

export async function runDailyScan(): Promise<{
  jobs_found: number;
  jobs_added: number;
  jobs_skipped_duplicate?: number;
  jobs_skipped_error?: number;
  skipped_details?: { company: string; role: string; reason: string }[];
}> {
  const headers = await getAuthHeaders();
  const resp = await fetch(`${CLOUD_URL}/functions/v1/daily-scan`, {
    method: 'POST',
    headers,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Scan failed' }));
    throw new Error(err.error || 'Scan failed');
  }
  return resp.json();
}

export async function generateCV(jobId: string): Promise<{ success: boolean }> {
  const headers = await getAuthHeaders();
  const resp = await fetch(`${CLOUD_URL}/functions/v1/generate-cv`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jobId }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'CV generation failed' }));
    throw new Error(err.error || 'CV generation failed');
  }
  return resp.json();
}
