export type Priority = 'HIGH' | 'MEDIUM' | 'LOW' | 'REJECTED';
export type JobStatus = 'New' | 'Applied' | 'Interviewing' | 'Offer' | 'Rejected';

export interface Job {
  id: string;
  created_at: string;
  company: string;
  role: string;
  location: string;
  score: number;
  priority: Priority;
  reason: string;
  exp_required: string;
  job_link: string;
  status: JobStatus;
  fingerprint: string;
  alert_date: string | null;
  tailored_cv: string | null;
  applied_at: string | null;
}

export interface ScanRun {
  id: string;
  started_at: string;
  success: boolean;
  jobs_found: number;
  jobs_added: number;
  error_text: string | null;
}
