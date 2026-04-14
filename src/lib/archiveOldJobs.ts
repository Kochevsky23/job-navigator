import { supabase } from '@/integrations/supabase/client';

export async function archiveOldJobs() {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('jobs')
    .update({ status: 'Archived' } as any)
    .eq('status', 'New')
    .lt('created_at', cutoff)
    .select('id');

  if (error) throw error;
  return { archivedCount: (data || []).length };
}
