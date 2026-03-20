import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/supabase-external';
import { runDailyScan } from '@/lib/api';
import { Job, ScanRun } from '@/types/database';
import { Badge } from '@/components/ui/badge';
import { Briefcase, AlertTriangle, FileText, Loader2, Radar, ArrowRight, CheckCircle2, XCircle, Send, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
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

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: 'hsl(155 100% 49%)',
  MEDIUM: 'hsl(38 92% 50%)',
  LOW: 'hsl(25 95% 53%)',
  REJECTED: 'hsl(0 72% 51%)',
};

const SCORE_COLORS = ['hsl(0 72% 51%)', 'hsl(0 72% 51%)', 'hsl(0 72% 51%)', 'hsl(25 95% 53%)', 'hsl(25 95% 53%)', 'hsl(38 92% 50%)', 'hsl(38 92% 50%)', 'hsl(38 92% 50%)', 'hsl(155 100% 49%)', 'hsl(155 100% 49%)', 'hsl(155 100% 49%)'];

export default function Dashboard() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [userName, setUserName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  const fetchData = async () => {
    const [jobsRes, scansRes] = await Promise.all([
      db.from('jobs').select('*'),
      db.from('scan_runs').select('*').order('started_at', { ascending: false }).limit(1),
    ]);
    if (jobsRes.data) setJobs(jobsRes.data as unknown as Job[]);
    if (scansRes.data) setScans(scansRes.data as unknown as ScanRun[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    if (user) {
      supabase.from('user_profiles').select('full_name').eq('id', user.id).single()
        .then(({ data }) => {
          if (data) setUserName((data as any).full_name?.split(' ')[0] || '');
        });
    }
  }, [user]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const result = await runDailyScan();
      const skipped = (result.jobs_skipped_duplicate || 0) + (result.jobs_skipped_error || 0);
      let msg = `Found ${result.jobs_found} jobs, added ${result.jobs_added} new.`;
      if (skipped > 0) {
        msg += ` Skipped ${skipped} (${result.jobs_skipped_duplicate || 0} duplicates`;
        if (result.jobs_skipped_error) msg += `, ${result.jobs_skipped_error} errors`;
        msg += `)`;
      }
      toast.success(msg);
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
  const appliedCount = jobs.filter(j => j.status === 'Applied' || j.status === 'Interviewing' || j.status === 'Offer').length;
  const lastScan = scans[0];

  const topJobs = [...todayJobs]
    .sort((a, b) => b.score - a.score)
    .filter(j => j.priority !== 'REJECTED')
    .slice(0, 5);

  // Analytics data
  const scoreDistribution = Array.from({ length: 11 }, (_, i) => ({
    score: i.toString(),
    count: jobs.filter(j => j.score === i).length,
    fill: SCORE_COLORS[i],
  })).filter(d => d.count > 0);

  const priorityBreakdown = ['HIGH', 'MEDIUM', 'LOW', 'REJECTED']
    .map(p => ({ name: p, value: jobs.filter(j => j.priority === p).length, color: PRIORITY_COLORS[p] }))
    .filter(d => d.value > 0);

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
    { label: 'Applied', value: appliedCount, icon: Send, color: 'accent' as const },
    { label: 'CVs Generated', value: cvsGenerated, icon: FileText, color: 'primary' as const },
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
    <div className="container py-6 md:py-8 space-y-6 md:space-y-8">
      {/* Hero */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 animate-fade-up" style={{ animationDelay: '0ms' }}>
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold tracking-tight" style={{ lineHeight: '1.1' }}>
            {getGreeting()}, <span className="gradient-text">{userName || 'there'}</span> 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {format(new Date(), 'EEEE, MMMM d, yyyy')}
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className={`btn-gradient flex items-center justify-center gap-2 text-base w-full sm:w-auto ${scanning ? '' : 'animate-pulse-glow'}`}
        >
          {scanning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Radar className="h-5 w-5" />}
          {scanning ? 'Scanning...' : 'Find New Jobs'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`glass-card rounded-xl p-4 md:p-5 border-b-2 ${borderColorMap[s.color]} animate-fade-up`}
            style={{ animationDelay: `${(i + 1) * 80}ms` }}
          >
            <div className="flex items-center justify-between mb-2 md:mb-3">
              <span className="text-[10px] md:text-xs font-medium text-muted-foreground uppercase tracking-wider">{s.label}</span>
              <s.icon className={`h-3.5 w-3.5 md:h-4 md:w-4 ${iconColorMap[s.color]} opacity-60`} />
            </div>
            <p className="text-2xl md:text-3xl font-display font-bold tabular-nums">{s.value}</p>
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
          <div className="flex gap-3 md:gap-4 overflow-x-auto pb-2 -mx-2 px-2 snap-x snap-mandatory">
            {topJobs.map((job) => (
              <div
                key={job.id}
                onClick={() => setSelectedJob(job)}
                className="glass-card glass-hover rounded-xl p-4 min-w-[200px] md:min-w-[220px] max-w-[260px] snap-start cursor-pointer flex flex-col gap-3"
              >
                <div className="flex items-center gap-3">
                  <CompanyLogo name={job.company} domain={(job as any).company_domain} jobLink={job.job_link} />
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

      {/* Analytics */}
      {jobs.length > 0 && (
        <div className="animate-fade-up" style={{ animationDelay: '480ms' }}>
          <h2 className="text-lg font-display font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-accent" />
            Analytics
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Score Distribution */}
            <div className="glass-card rounded-xl p-4 md:p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Score Distribution</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={scoreDistribution} barSize={20}>
                  <XAxis dataKey="score" tick={{ fontSize: 11, fill: 'hsl(225 12% 50%)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(225 12% 50%)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(232 22% 13%)', border: '1px solid hsl(232 18% 22%)', borderRadius: '8px', fontSize: '12px' }}
                    labelStyle={{ color: 'hsl(220 15% 93%)' }}
                    itemStyle={{ color: 'hsl(220 15% 93%)' }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {scoreDistribution.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Priority Breakdown */}
            <div className="glass-card rounded-xl p-4 md:p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Priority Breakdown</h3>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie
                      data={priorityBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={50}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {priorityBreakdown.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-2">
                  {priorityBreakdown.map(p => (
                    <div key={p.name} className="flex items-center gap-2 text-xs">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                      <span className="text-muted-foreground">{p.name}</span>
                      <span className="font-bold tabular-nums ml-auto">{p.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
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
