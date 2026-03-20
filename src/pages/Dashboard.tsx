import { useEffect, useState } from 'react';
import { db } from '@/lib/supabase-external';
import { runDailyScan } from '@/lib/api';
import { Job, ScanRun } from '@/types/database';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Briefcase, AlertTriangle, FileText, Loader2, Radar, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import JobDetailPanel from '@/components/JobDetailPanel';

const priorityClass: Record<string, string> = {
  HIGH: 'bg-priority-high priority-high border',
  MEDIUM: 'bg-priority-medium priority-medium border',
  LOW: 'bg-priority-low priority-low border',
  REJECTED: 'bg-priority-rejected priority-rejected border',
};

function CompanyAvatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className="h-10 w-10 rounded-xl flex items-center justify-center text-xs font-bold text-white shrink-0"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 60% 45%), hsl(${(hue + 40) % 360} 70% 55%))` }}
    >
      {initials}
    </div>
  );
}

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
      db.from('scan_runs').select('*').order('started_at', { ascending: false }).limit(7),
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
        <div
          className="glass-card rounded-xl p-5 border-b-2 border-b-muted-foreground/30 animate-fade-up"
          style={{ animationDelay: '320ms' }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Last Scan</span>
            <Clock className="h-4 w-4 text-muted-foreground opacity-60" />
          </div>
          {lastScan ? (
            <div>
              <p className="text-sm font-semibold">
                {format(new Date(lastScan.started_at), 'MMM d, HH:mm')}
              </p>
              <Badge
                variant={lastScan.success ? 'default' : 'destructive'}
                className="mt-1.5 text-xs"
              >
                {lastScan.success ? 'Success' : 'Failed'}
              </Badge>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No scans yet</p>
          )}
        </div>
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

      {/* Recent Scans */}
      <div className="animate-fade-up" style={{ animationDelay: '500ms' }}>
        <h2 className="text-lg font-display font-semibold mb-4">Recent Scans</h2>
        <div className="glass-card rounded-xl overflow-hidden">
          {scans.length === 0 ? (
            <p className="text-muted-foreground text-sm p-6">No scan history yet. Run your first scan!</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-[hsl(var(--glass-border)/0.3)]">
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Time</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Status</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Found</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Added</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.map((s) => (
                  <TableRow key={s.id} className="border-b border-[hsl(var(--glass-border)/0.2)] hover:bg-[hsl(var(--glass-border)/0.15)] transition-colors">
                    <TableCell className="text-sm">{format(new Date(s.started_at), 'MMM d, HH:mm')}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        s.success
                          ? 'bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]'
                          : 'bg-[hsl(var(--destructive)/0.12)] text-destructive'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${s.success ? 'bg-[hsl(var(--success))]' : 'bg-destructive'}`} />
                        {s.success ? 'Success' : 'Failed'}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">{s.jobs_found}</TableCell>
                    <TableCell className="tabular-nums">{s.jobs_added}</TableCell>
                    <TableCell className="text-xs text-destructive max-w-[200px] truncate">
                      {s.error_text || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

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