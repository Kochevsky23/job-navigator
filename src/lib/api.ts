const CLOUD_URL = import.meta.env.VITE_SUPABASE_URL;
const CLOUD_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export async function runDailyScan(): Promise<{ jobs_found: number; jobs_added: number }> {
  const resp = await fetch(`${CLOUD_URL}/functions/v1/daily-scan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CLOUD_KEY}`,
    },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Scan failed' }));
    throw new Error(err.error || 'Scan failed');
  }
  return resp.json();
}

export async function generateCV(jobId: string): Promise<{ success: boolean }> {
  const resp = await fetch(`${CLOUD_URL}/functions/v1/generate-cv`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CLOUD_KEY}`,
    },
    body: JSON.stringify({ jobId }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'CV generation failed' }));
    throw new Error(err.error || 'CV generation failed');
  }
  return resp.json();
}
