import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/supabase-external';
import { runDailyScan, syncJobStatuses } from '@/lib/api';
import { Job, ScanRun } from '@/types/database';
import { Badge } from '@/components/ui/badge';
import { Briefcase, AlertTriangle, FileText, Loader2, Radar, ArrowRight, CheckCircle2, XCircle, Send, BarChart3, User, MapPin, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import JobDetailPanel from '@/components/JobDetailPanel';
import CompanyLogo from '@/components/CompanyLogo';

const priorityClass: Record<string, string> = {
  HIGH: 'bg-priority-high priority-high border',
  MEDIUM: 'bg-priority-medium priority-medium border',
  LOW: 'bg-priority-low priority-low border',
  REJECTED: 'bg-priority-rejected priority-rejected border',
};

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: 'hsl(155 100% 49%)',
  MEDIUM: 'hsl(38 92% 50%)',
  LOW: 'hsl(25 95% 53%)',
  REJECTED: 'hsl(0 72% 51%)',
};

const SCORE_COLORS = [
  'hsl(0 72% 51%)', 'hsl(0 72% 51%)', 'hsl(0 72% 51%)',
  'hsl(25 95% 53%)', 'hsl(25 95% 53%)',
  'hsl(38 92% 50%)', 'hsl(38 92% 50%)', 'hsl(38 92% 50%)',
  'hsl(155 100% 49%)', 'hsl(155 100% 49%)', 'hsl(155 100% 49%)',
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function MetricArc({ value, label, description }: { value: number | null; label: string; description: string }) {
  const pct = value !== null ? value * 100 : 0;
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = value !== null ? circumference - (pct / 100) * circumference : circumference;
  const color = value === null ? 'hsl(225 12% 35%)'
    : value >= 0.7 ? 'hsl(155 100% 49%)'
    : value >= 0.5 ? 'hsl(38 92% 50%)'
    : 'hsl(0 72% 51%)';
  const bgColor = value === null ? 'transparent'
    : value >= 0.7 ? 'hsl(155 100% 49% / 0.06)'
    : value >= 0.5 ? 'hsl(38 92% 50% / 0.06)'
    : 'hsl(0 72% 51% / 0.06)';
  const borderColor = value === null ? 'hsl(232 18% 22%)'
    : value >= 0.7 ? 'hsl(155 100% 49% / 0.2)'
    : value >= 0.5 ? 'hsl(38 92% 50% / 0.2)'
    : 'hsl(0 72% 51% / 0.2)';

  return (
    <div className="flex flex-col items-center gap-3 p-4 rounded-xl border flex-1"
      style={{ backgroundColor: bgColor, borderColor }}>
      <div className="relative">
        <svg className="-rotate-90" width="92" height="92" viewBox="0 0 92 92">
          <circle cx="46" cy="46" r={radius} fill="none" stroke="hsl(232 18% 18%)" strokeWidth="6" />
          <circle
            cx="46" cy="46" r={radius} fill="none"
            stroke={color} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1s ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-display font-bold tabular-nums" style={{ color }}>
            {value !== null ? `${Math.round(pct)}%` : '—'}
          </span>
        </div>
      </div>
      <div className="text-center">
        <p className="font-semibold text-sm">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{description}</p>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 8 ? 'hsl(155 100% 49%)' : score >= 6 ? 'hsl(38 92% 50%)' : 'hsl(0 72% 51%)';
  const bg = score >= 8 ? 'hsl(155 100% 49% / 0.12)' : score >= 6 ? 'hsl(38 92% 50% / 0.12)' : 'hsl(0 72% 51% / 0.12)';
  const border = score >= 8 ? 'hsl(155 100% 49% / 0.3)' : score >= 6 ? 'hsl(38 92% 50% / 0.3)' : 'hsl(0 72% 51% / 0.3)';
  return (
    <span className="rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums border"
      style={{ color, backgroundColor: bg, borderColor: border }}>
      {score}/10
    </span>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const [scanning, setScanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
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
      supabase.from('user_profiles').select('full_name, avatar_url').eq('id', user.id).single()
        .then(({ data }) => {
          if (data) {
            setUserName((data as any).full_name?.split(' ')[0] || '');
            setAvatarUrl((data as any).avatar_url || '');
          }
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


  const handleSyncStatuses = async () => {
    setSyncing(true);
    try {
      const result = await syncJobStatuses();
      if (result.statusesUpdated === 0) {
        toast.info(`Scanned ${result.emailsFound ?? 0} emails across ${result.jobsChecked} jobs — no status changes detected`);
      } else {
        const details = result.updates
          .map((u: any) => `${u.company}: ${u.oldStatus} → ${u.newStatus}`)
          .join(', ');
        toast.success(`${result.statusesUpdated} status${result.statusesUpdated === 1 ? '' : 'es'} updated: ${details}`);
        fetchData();
      }
    } catch (e: any) {
      toast.error(e.message || 'Status sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const highPriority = jobs.filter(j => j.priority === 'HIGH').length;
  const cvsGenerated = jobs.filter(j => j.tailored_cv).length;
  const appliedCount = jobs.filter(j => j.status === 'Applied' || j.status === 'Interviewing' || j.status === 'Offer').length;
  const lastScan = scans[0];

  const topJobs = [...jobs]
    .sort((a, b) => b.score - a.score)
    .filter(j => j.priority !== 'REJECTED')
    .slice(0, 5);

  const scoreDistribution = Array.from({ length: 11 }, (_, i) => ({
    score: i.toString(),
    count: jobs.filter(j => j.score === i).length,
    fill: SCORE_COLORS[i],
  })).filter(d => d.count > 0);

  const priorityBreakdown = ['HIGH', 'MEDIUM', 'LOW', 'REJECTED']
    .map(p => ({ name: p, value: jobs.filter(j => j.priority === p).length, color: PRIORITY_COLORS[p] }))
    .filter(d => d.value > 0);

  const totalPriority = priorityBreakdown.reduce((s, p) => s + p.value, 0);

  // Application pipeline
  const pipeline = [
    { label: 'New', count: jobs.filter(j => j.status === 'New').length, color: 'hsl(214 100% 65%)' },
    { label: 'Applied', count: jobs.filter(j => j.status === 'Applied').length, color: 'hsl(38 92% 50%)' },
    { label: 'Interviewing', count: jobs.filter(j => j.status === 'Interviewing').length, color: 'hsl(155 100% 49%)' },
    { label: 'Offer', count: jobs.filter(j => j.status === 'Offer').length, color: 'hsl(155 100% 70%)' },
  ];
  const maxPipelineCount = Math.max(...pipeline.map(s => s.count), 1);

  // ML metrics
  const rated = jobs.filter(j => j.user_score !== null && j.user_score !== undefined);
  const hasMetrics = rated.length >= 3;
  let precision: number | null = null, recall: number | null = null, accuracy: number | null = null;
  let TP = 0, FP = 0, FN = 0, TN = 0;
  if (hasMetrics) {
    TP = rated.filter(j => j.user_score! >= 4 && j.priority === 'HIGH').length;
    FP = rated.filter(j => j.user_score! <= 2 && j.priority === 'HIGH').length;
    FN = rated.filter(j => j.user_score! >= 4 && j.priority !== 'HIGH').length;
    TN = rated.filter(j => j.user_score! <= 2 && j.priority !== 'HIGH').length;
    precision = TP + FP > 0 ? TP / (TP + FP) : null;
    recall = TP + FN > 0 ? TP / (TP + FN) : null;
    accuracy = TP + TN + FP + FN > 0 ? (TP + TN) / (TP + TN + FP + FN) : null;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const stats = [
    { label: 'Total Jobs', value: jobs.length, icon: Briefcase, iconBg: 'bg-primary/10', iconColor: 'text-primary', accent: 'hsl(155 100% 49%)' },
    { label: 'High Priority', value: highPriority, icon: AlertTriangle, iconBg: 'bg-[hsl(var(--priority-high)/0.12)]', iconColor: 'text-[hsl(var(--priority-high))]', accent: 'hsl(155 100% 49%)' },
    { label: 'Applied', value: appliedCount, icon: Send, iconBg: 'bg-accent/10', iconColor: 'text-accent', accent: 'hsl(214 100% 65%)' },
    { label: 'CVs Generated', value: cvsGenerated, icon: FileText, iconBg: 'bg-primary/10', iconColor: 'text-primary', accent: 'hsl(155 100% 49%)' },
  ];

  return (
    <div className="container py-6 md:py-8 space-y-6 md:space-y-8">

      {/* Hero */}
      <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-up glass-card rounded-2xl p-5 md:p-6 overflow-hidden">
        <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{
          background: 'radial-gradient(ellipse 60% 100% at 100% 50%, hsl(155 100% 49% / 0.04), transparent)',
        }} />
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Profile"
              className="h-12 w-12 md:h-14 md:w-14 rounded-full object-cover ring-2 ring-primary/20 ring-offset-2 ring-offset-background shrink-0" />
          ) : (
            <div className="h-12 w-12 md:h-14 md:w-14 rounded-full bg-primary/10 flex items-center justify-center ring-2 ring-primary/20 ring-offset-2 ring-offset-background shrink-0">
              <User className="h-6 w-6 text-primary/50" />
            </div>
          )}
          <div>
            <h1 className="text-2xl md:text-3xl font-display font-bold tracking-tight leading-tight">
              {getGreeting()}, <span className="gradient-text">{userName || 'there'}</span> 👋
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
          </div>
        </div>
        <div className="flex flex-col sm:items-end gap-2">
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={handleScan}
              disabled={scanning || syncing}
              className={`btn-gradient flex items-center justify-center gap-2 text-sm flex-1 sm:flex-initial ${scanning ? '' : 'animate-pulse-glow'}`}
            >
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
              {scanning ? 'Scanning...' : 'Find New Jobs'}
            </button>
            <button
              onClick={handleSyncStatuses}
              disabled={scanning || syncing}
              title="Sync job statuses from Gmail"
              className="flex items-center justify-center gap-2 text-sm rounded-xl border border-[hsl(var(--glass-border)/0.5)] px-4 py-2 hover:bg-[hsl(var(--glass-border)/0.2)] transition-colors disabled:opacity-50"
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncing ? 'Syncing...' : 'Sync Statuses'}
            </button>
          </div>
          {/* Last Scan inline below button */}
          {lastScan && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {lastScan.success
                ? <CheckCircle2 className="h-3 w-3 text-[hsl(var(--success))] shrink-0" />
                : <XCircle className="h-3 w-3 text-destructive shrink-0" />}
              <span>
                Last scan {format(new Date(lastScan.started_at), 'MMM d') === format(new Date(), 'MMM d')
                  ? `today at ${format(new Date(lastScan.started_at), 'HH:mm')}`
                  : format(new Date(lastScan.started_at), 'MMM d')}
              </span>
              {lastScan.success && lastScan.jobs_added > 0 && (
                <span className="text-[hsl(var(--success))] font-medium">· +{lastScan.jobs_added} new</span>
              )}
              {!lastScan.success && <span className="text-destructive">· failed</span>}
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className="glass-card rounded-xl p-4 md:p-5 animate-fade-up relative overflow-hidden"
            style={{ animationDelay: `${(i + 1) * 70}ms`, borderTop: `2px solid ${s.accent}40` }}
          >
            <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${s.accent}60, transparent)` }} />
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-3xl md:text-4xl font-display font-bold tabular-nums leading-none">{s.value}</p>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-2 block">{s.label}</span>
              </div>
              <div className={`h-9 w-9 rounded-xl ${s.iconBg} flex items-center justify-center shrink-0`}>
                <s.icon className={`h-4 w-4 ${s.iconColor}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Best Matches */}
      {topJobs.length > 0 && (
        <div className="animate-fade-up" style={{ animationDelay: '350ms' }}>
          <h2 className="text-base font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider text-xs">Best Matches</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2 snap-x snap-mandatory">
            {topJobs.map((job) => {
              const scoreColor = job.score >= 8 ? 'hsl(155 100% 49%)' : job.score >= 6 ? 'hsl(38 92% 50%)' : 'hsl(0 72% 51%)';
              return (
                <div
                  key={job.id}
                  onClick={() => setSelectedJob(job)}
                  className="glass-card glass-hover rounded-xl p-4 min-w-[210px] max-w-[240px] snap-start cursor-pointer flex flex-col gap-3 shrink-0"
                >
                  <div className="flex items-center gap-2.5">
                    <CompanyLogo name={job.company} domain={(job as any).company_domain} jobLink={job.job_link} />
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate leading-tight" dir="auto">{job.company}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5" dir="auto">{job.role}</p>
                    </div>
                  </div>
                  {/* Score bar */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <ScoreBadge score={job.score} />
                      <Badge className={`${priorityClass[job.priority]} text-xs`}>{job.priority}</Badge>
                    </div>
                    <div className="h-1 rounded-full bg-[hsl(var(--glass-border)/0.3)]">
                      <div className="h-1 rounded-full transition-all duration-700"
                        style={{ width: `${job.score * 10}%`, backgroundColor: scoreColor }} />
                    </div>
                  </div>
                  {job.location && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate" dir="auto">{job.location}</span>
                    </div>
                  )}
                  <button className="flex items-center justify-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80 transition-colors mt-auto group">
                    View details
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Analytics */}
      {jobs.length > 0 && (
        <div className="animate-fade-up space-y-4" style={{ animationDelay: '450ms' }}>
          <h2 className="text-base font-display font-semibold text-muted-foreground uppercase tracking-wider text-xs flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5" />
            Analytics
          </h2>

          {/* ML Metrics */}
          {hasMetrics && (
            <div className="glass-card rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-sm">AI Scoring Quality</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    How well the AI predicts your preferences · based on {rated.length} rated jobs
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>★★★★+ = liked &nbsp;|&nbsp; ★★ or less = disliked</p>
                </div>
              </div>
              <div className="flex gap-3">
                <MetricArc value={precision} label="Precision" description={`${TP}/(${TP}+${FP}) — HIGH jobs you liked`} />
                <MetricArc value={recall} label="Recall" description={`${TP}/(${TP}+${FN}) — liked jobs marked HIGH`} />
                <MetricArc value={accuracy} label="Accuracy" description={`${TP+TN}/${TP+TN+FP+FN} — correct overall`} />
              </div>
            </div>
          )}

          {/* Score Distribution + Priority Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Score Distribution */}
            <div className="glass-card rounded-xl p-4 md:p-5">
              <h3 className="text-sm font-semibold mb-1">Score Distribution</h3>
              <p className="text-xs text-muted-foreground mb-4">How jobs are spread across fit scores</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={scoreDistribution} barSize={22} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <XAxis dataKey="score" tick={{ fontSize: 11, fill: 'hsl(225 12% 50%)' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: 'hsl(232 18% 22% / 0.5)', radius: 4 }}
                    contentStyle={{ backgroundColor: 'hsl(232 22% 13%)', border: '1px solid hsl(232 18% 22%)', borderRadius: '8px', fontSize: '12px' }}
                    labelStyle={{ color: 'hsl(220 15% 93%)' }}
                    itemStyle={{ color: 'hsl(220 15% 93%)' }}
                    formatter={(v: any) => [`${v} jobs`, 'Count']}
                    labelFormatter={(l) => `Score ${l}`}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {scoreDistribution.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Priority Breakdown */}
            <div className="glass-card rounded-xl p-4 md:p-5">
              <h3 className="text-sm font-semibold mb-1">Priority Breakdown</h3>
              <p className="text-xs text-muted-foreground mb-4">{totalPriority} jobs classified</p>
              <div className="flex items-center gap-6">
                <div className="relative shrink-0">
                  <ResponsiveContainer width={140} height={140}>
                    <PieChart>
                      <Pie
                        data={priorityBreakdown}
                        cx="50%" cy="50%"
                        innerRadius={38} outerRadius={60}
                        dataKey="value" strokeWidth={0} paddingAngle={2}
                      >
                        {priorityBreakdown.map((entry, idx) => (
                          <Cell key={idx} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-display font-bold tabular-nums">{totalPriority}</span>
                    <span className="text-[10px] text-muted-foreground">total</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2.5 flex-1">
                  {priorityBreakdown.map(p => (
                    <div key={p.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                          <span className="text-muted-foreground">{p.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold tabular-nums">{p.value}</span>
                          <span className="text-muted-foreground/60">{Math.round(p.value / totalPriority * 100)}%</span>
                        </div>
                      </div>
                      <div className="h-1 rounded-full bg-[hsl(var(--glass-border)/0.3)]">
                        <div className="h-1 rounded-full transition-all duration-700"
                          style={{ width: `${p.value / totalPriority * 100}%`, backgroundColor: p.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Application Pipeline */}
          <div className="glass-card rounded-xl p-4 md:p-5">
            <h3 className="text-sm font-semibold mb-1">Application Pipeline</h3>
            <p className="text-xs text-muted-foreground mb-4">Your job search funnel</p>
            <div className="space-y-3">
              {pipeline.map(s => (
                <div key={s.label} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-20 shrink-0">{s.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-[hsl(var(--glass-border)/0.3)]">
                    <div
                      className="h-2 rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.max((s.count / maxPipelineCount) * 100, s.count > 0 ? 4 : 0)}%`,
                        backgroundColor: s.color,
                        opacity: s.count > 0 ? 1 : 0.3,
                      }}
                    />
                  </div>
                  <span className="text-xs font-bold tabular-nums w-6 text-right"
                    style={{ color: s.count > 0 ? s.color : 'hsl(225 12% 35%)' }}>
                    {s.count}
                  </span>
                </div>
              ))}
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
