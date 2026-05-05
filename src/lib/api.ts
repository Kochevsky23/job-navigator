import { supabase } from '@/integrations/supabase/client';
import { debugLog } from '@/lib/debug';

export async function runDailyScan(): Promise<{
  jobs_found: number;
  jobs_added: number;
  jobs_skipped_duplicate?: number;
  jobs_skipped_error?: number;
  skipped_details?: { company: string; role: string; reason: string }[];
}> {
  const { data, error } = await supabase.functions.invoke('daily-scan');
  if (error) {
    let msg = error.message || 'Scan failed';
    try {
      const body = await (error as any).context?.json?.();
      if (body?.error) msg = body.error;
    } catch {}
    await debugLog({ severity: 'error', module: 'edge_function', message: `daily-scan failed: ${msg}`, error, functionName: 'runDailyScan', fileName: 'src/lib/api.ts' });
    throw new Error(msg);
  }
  return data;
}

export async function syncJobStatuses(): Promise<{
  success: boolean;
  jobsChecked: number;
  emailsFound: number;
  statusesUpdated: number;
  updates: { company: string; role: string; oldStatus: string; newStatus: string }[];
}> {
  const { data, error } = await supabase.functions.invoke('update-job-statuses', {
    body: { lookbackDays: 7 },
  });
  if (error) {
    let msg = error.message || 'Status sync failed';
    try {
      const body = await (error as any).context?.json?.();
      if (body?.error) msg = body.error;
    } catch {}
    await debugLog({ severity: 'error', module: 'edge_function', message: `update-job-statuses failed: ${msg}`, error, functionName: 'syncJobStatuses', fileName: 'src/lib/api.ts' });
    throw new Error(msg);
  }
  return data;
}

export async function generateCV(jobId: string): Promise<{ success: boolean }> {
  const { data, error } = await supabase.functions.invoke('generate-cv', { body: { jobId } });
  if (error) {
    await debugLog({ severity: 'error', module: 'edge_function', message: `generate-cv failed: ${error.message || 'CV generation failed'}`, error, functionName: 'generateCV', fileName: 'src/lib/api.ts', rawDetails: { jobId } });
    throw new Error(error.message || 'CV generation failed');
  }
  return data;
}

export async function generateCoverLetter(jobId: string): Promise<{ success: boolean }> {
  const { data, error } = await supabase.functions.invoke('generate-cover-letter', { body: { jobId } });
  if (error) {
    await debugLog({ severity: 'error', module: 'edge_function', message: `generate-cover-letter failed: ${error.message || 'Cover letter generation failed'}`, error, functionName: 'generateCoverLetter', fileName: 'src/lib/api.ts', rawDetails: { jobId } });
    throw new Error(error.message || 'Cover letter generation failed');
  }
  return data;
}

export async function generateInterviewPrep(jobId: string): Promise<{ success: boolean }> {
  const { data, error } = await supabase.functions.invoke('interview-prep', { body: { jobId } });
  if (error) {
    await debugLog({ severity: 'error', module: 'edge_function', message: `interview-prep failed: ${error.message || 'Interview prep generation failed'}`, error, functionName: 'generateInterviewPrep', fileName: 'src/lib/api.ts', rawDetails: { jobId } });
    throw new Error(error.message || 'Interview prep generation failed');
  }
  return data;
}

export async function generateCompanyResearch(jobId: string): Promise<{ success: boolean }> {
  const { data, error } = await supabase.functions.invoke('company-research', { body: { jobId } });
  if (error) {
    await debugLog({ severity: 'error', module: 'edge_function', message: `company-research failed: ${error.message || 'Company research failed'}`, error, functionName: 'generateCompanyResearch', fileName: 'src/lib/api.ts', rawDetails: { jobId } });
    throw new Error(error.message || 'Company research failed');
  }
  return data;
}

export async function runMLFeedback(): Promise<{
  success: boolean;
  metrics?: { precision: number | null; recall: number | null; f1: number | null; accuracy: number | null; TP: number; FP: number; TN: number; FN: number };
  insights?: string;
  scoring_hints?: string;
  message?: string;
  labeled_count?: number;
}> {
  const { data, error } = await supabase.functions.invoke('ml-feedback');
  if (error) {
    await debugLog({ severity: 'error', module: 'edge_function', message: `ml-feedback failed: ${error.message || 'ML feedback failed'}`, error, functionName: 'runMLFeedback', fileName: 'src/lib/api.ts' });
    throw new Error(error.message || 'ML feedback failed');
  }
  return data;
}

export async function fetchSkillsGap(): Promise<{
  gap_skills: { skill: string; frequency: number; priority: string; context: string; learn_tip: string }[];
  summary: string;
  strongest_areas: string[];
}> {
  const { data, error } = await supabase.functions.invoke('skills-gap');
  if (error) {
    await debugLog({ severity: 'error', module: 'edge_function', message: `skills-gap failed: ${error.message || 'Skills gap analysis failed'}`, error, functionName: 'fetchSkillsGap', fileName: 'src/lib/api.ts' });
    throw new Error(error.message || 'Skills gap analysis failed');
  }
  return data;
}
