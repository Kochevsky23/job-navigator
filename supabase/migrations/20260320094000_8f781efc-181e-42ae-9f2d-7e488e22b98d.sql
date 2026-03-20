
CREATE TABLE public.jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  company TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  location TEXT DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'LOW',
  reason TEXT DEFAULT '',
  exp_required TEXT DEFAULT '',
  job_link TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'New',
  fingerprint TEXT UNIQUE,
  alert_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
  tailored_cv TEXT,
  applied_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE public.scan_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL DEFAULT false,
  jobs_found INTEGER NOT NULL DEFAULT 0,
  jobs_added INTEGER NOT NULL DEFAULT 0,
  error_text TEXT
);

ALTER TABLE public.jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_runs DISABLE ROW LEVEL SECURITY;
