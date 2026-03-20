import { useEffect, useState } from 'react';
import { db } from '@/lib/supabase-external';
import { runDailyScan } from '@/lib/api';
import { Job, ScanRun } from '@/types/database';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Briefcase, AlertTriangle, FileText, Loader2, Radar, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { format } from 'date-fns';
import JobDetailPanel from '@/components/JobDetailPanel';
import CompanyLogo from '@/components/CompanyLogo';

const priorityClass: Record<string, string> = {
  HIGH: 'bg-priority-high priority-high border',
  MEDIUM: 'bg-priority-medium priority-medium border',
  LOW: 'bg-priority-low priority-low border',
  REJECTED: 'bg-priority-rejected priority-rejected border',
};


function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 8 ? 'score-pill-high' : score >= 6 ? 'score-pill-medium' : 'score-pill-low';
  return (
    <span className={`${cls} rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums`}>
      {score}/10
    </span>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const fetchData = async () => {
    const [jobsRes, scansRes] = await Promise.all([
      db.from('jobs').select('*'),
      db.from('scan_runs').select('*').order('started_at', { ascending: false }).limit(1),
    ]);
    if (jobsRes.data) setJobs(jobsRes.data as unknown as Job[]);
    if (scansRes.data) setScans(scansRes.data as unknown as ScanRun[]);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleScan = async () => {
    setScanning(true);
    try {
      const result = await runDailyScan();
      toast.success(`Scan complete! Found ${result.jobs_found} jobs, added ${result.jobs_added} new.`);
      fetchData();
    } catch (e: any) {
      toast.error(e.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const todayJobs = jobs.filter(j => {
    const d = new Date(j.created_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });
  const highPriority = jobs.filter(j => j.priority === 'HIGH').length;
  const cvsGenerated = jobs.filter(j => j.tailored_cv).length;
  const lastScan = scans[0];

  const topJobs = [...todayJobs]
    .sort((a, b) => b.score - a.score)
    .filter(j => j.priority !== 'REJECTED')
    .slice(0, 5);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const stats = [
    { label: 'Jobs Today', value: todayJobs.length, icon: Briefcase, color: 'primary' as const },
    { label: 'High Priority', value: highPriority, icon: AlertTriangle, color: 'high' as const },
    { label: 'CVs Generated', value: cvsGenerated, icon: FileText, color: 'accent' as const },
  ];

  const borderColorMap = {
    primary: 'border-b-primary',
    high: 'border-b-[hsl(var(--priority-high))]',
    accent: 'border-b-accent',
  };

  const iconColorMap = {
    primary: 'text-primary',
    high: 'text-[hsl(var(--priority-high))]',
    accent: 'text-accent',
  };

  return (
    <div className="container py-8 space-y-8">
      {/* Hero */}
      <div className="flex items-end justify-between animate-fade-up" style={{ animationDelay: '0ms' }}>
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight" style={{ lineHeight: '1.1' }}>
            {getGreeting()}, <span className="gradient-text">Dor</span> 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {format(new Date(), 'EEEE, MMMM d, yyyy')}
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className={`btn-gradient flex items-center gap-2 text-base ${scanning ? '' : 'animate-pulse-glow'}`}
        >
          {scanning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Radar className="h-5 w-5" />}
          {scanning ? 'Scanning...' : 'Find New Jobs'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`glass-card rounded-xl p-5 border-b-2 ${borderColorMap[s.color]} animate-fade-up`}
            style={{ animationDelay: `${(i + 1) * 80}ms` }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{s.label}</span>
              <s.icon className={`h-4 w-4 ${iconColorMap[s.color]} opacity-60`} />
            </div>
            <p className="text-3xl font-display font-bold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Last Scan Status */}
      <div className="animate-fade-up" style={{ animationDelay: '320ms' }}>
        {lastScan ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {lastScan.success ? (
              <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))] shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive shrink-0" />
            )}
            <span>
              Last scan: {format(new Date(lastScan.started_at), 'MMM d') === format(new Date(), 'MMM d')
                ? `Today at ${format(new Date(lastScan.started_at), 'HH:mm')}`
                : format(new Date(lastScan.started_at), 'MMM d \'at\' HH:mm')}
            </span>
            {lastScan.success && lastScan.jobs_added > 0 && (
              <span className="text-[hsl(var(--success))] font-medium">+ {lastScan.jobs_added} new jobs</span>
            )}
            {lastScan.success && lastScan.jobs_added === 0 && (
              <span className="text-muted-foreground">· no new jobs</span>
            )}
            {!lastScan.success && (
              <span className="text-destructive font-medium">· failed</span>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No scans yet. Run your first scan!</p>
        )}
      </div>

      {/* Best Matches */}
      {topJobs.length > 0 && (
        <div className="animate-fade-up" style={{ animationDelay: '400ms' }}>
          <h2 className="text-lg font-display font-semibold mb-4">Best Matches Today</h2>
          <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 snap-x snap-mandatory">
            {topJobs.map((job) => (
              <div
                key={job.id}
                onClick={() => setSelectedJob(job)}
                className="glass-card glass-hover rounded-xl p-4 min-w-[220px] max-w-[260px] snap-start cursor-pointer flex flex-col gap-3"
              >
                <div className="flex items-center gap-3">
                  <CompanyAvatar name={job.company} />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate" dir="auto">{job.company}</p>
                    <p className="text-xs text-muted-foreground truncate" dir="auto">{job.role}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ScoreBadge score={job.score} />
                  <Badge className={`${priorityClass[job.priority]} text-xs`}>{job.priority}</Badge>
                </div>
                <button className="flex items-center justify-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80 transition-colors mt-auto group">
                  View details
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}


      <JobDetailPanel
        job={selectedJob}
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        onUpdate={() => {
          fetchData();
          setSelectedJob(null);
        }}
      />
    </div>
  );
}