import { supabase } from '@/integrations/supabase/client';

export async function runDailyScan(): Promise<{
  jobs_found: number;
  jobs_added: number;
  jobs_skipped_duplicate?: number;
  jobs_skipped_error?: number;
  skipped_details?: { company: string; role: string; reason: string }[];
}> {
  const { data, error } = await supabase.functions.invoke('daily-scan');
  if (error) throw new Error(error.message || 'Scan failed');
  return data;
}

export async function generateCV(jobId: string): Promise<{ success: boolean }> {
  const { data, error } = await supabase.functions.invoke('generate-cv', {
    body: { jobId },
  });
  if (error) throw new Error(error.message || 'CV generation failed');
  return data;
}
