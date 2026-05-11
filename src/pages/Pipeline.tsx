import { useEffect, useState } from 'react';
import { db } from '@/lib/supabase-external';
import { Job, JobStatus } from '@/types/database';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Badge } from '@/components/ui/badge';
import { Loader2, GripVertical, ArrowRight, RefreshCw, FileSpreadsheet, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import CompanyLogo from '@/components/CompanyLogo';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { exportToSheets } from '@/lib/api';

const COLUMNS: { id: JobStatus; label: string; borderColor: string }[] = [
  { id: 'New', label: 'New', borderColor: 'border-t-accent' },
  { id: 'Old', label: 'Old', borderColor: 'border-t-orange-400' },
  { id: 'Applied', label: 'Applied', borderColor: 'border-t-[hsl(var(--info))]' },
  { id: 'Assessment', label: 'Assessment', borderColor: 'border-t-purple-400' },
  { id: 'Interviewing', label: 'Interviewing', borderColor: 'border-t-[hsl(var(--warning))]' },
  { id: 'Offer', label: 'Offer', borderColor: 'border-t-[hsl(var(--success))]' },
  { id: 'Rejected', label: 'Rejected', borderColor: 'border-t-destructive' },
  { id: 'Ghosted', label: 'Ghosted', borderColor: 'border-t-slate-500' },
];

const priorityDot: Record<string, string> = {
  HIGH: 'bg-[hsl(var(--priority-high))]',
  MEDIUM: 'bg-[hsl(var(--priority-medium))]',
  LOW: 'bg-[hsl(var(--priority-low))]',
  REJECTED: 'bg-[hsl(var(--priority-rejected))]',
};

function ScorePill({ score }: { score: number }) {
  const cls = score >= 8 ? 'score-pill-high' : score >= 6 ? 'score-pill-medium' : 'score-pill-low';
  return (
    <span className={`${cls} rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums`}>
      {score}/10
    </span>
  );
}

interface StatusChange {
  company: string;
  role: string;
  oldStatus: string;
  newStatus: string;
}

interface LastStatusChanges {
  scanned_at: string;
  changes: StatusChange[];
}

interface PendingChange {
  jobId: string;
  company: string;
  role: string;
  oldStatus: string;
  newStatus: string;
  confidence: number;
  reason: string;
}

interface PendingStatusChanges {
  generated_at: string;
  changes: PendingChange[];
}

const statusColor: Record<string, string> = {
  Applied: 'text-[hsl(var(--info))]',
  Assessment: 'text-purple-400',
  Interviewing: 'text-[hsl(var(--warning))]',
  Ghosted: 'text-slate-400',
  Offer: 'text-[hsl(var(--success))]',
  Rejected: 'text-destructive',
  New: 'text-accent',
  Old: 'text-orange-400',
};

export default function Pipeline() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusChanges, setStatusChanges] = useState<LastStatusChanges | null>(null);
  const [pendingChanges, setPendingChanges] = useState<PendingStatusChanges | null>(null);
  const [exportingSheets, setExportingSheets] = useState(false);

  const fetchJobs = async () => {
    const [jobsRes, profileRes] = await Promise.all([
      db.from('jobs').select('*').neq('status', 'Archive').order('score', { ascending: false }),
      db.from('user_profiles').select('last_status_changes, pending_status_changes').single(),
    ]);
    if (jobsRes.data) setJobs(jobsRes.data as unknown as Job[]);
    if ((profileRes.data as any)?.last_status_changes) {
      setStatusChanges((profileRes.data as any).last_status_changes as LastStatusChanges);
    }
    if ((profileRes.data as any)?.pending_status_changes) {
      setPendingChanges((profileRes.data as any).pending_status_changes as PendingStatusChanges);
    }
    setLoading(false);
  };

  useEffect(() => { fetchJobs(); }, []);

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId as JobStatus;
    const jobId = result.draggableId;

    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: newStatus } : j));

    const updateData: Record<string, any> = { status: newStatus };
    if (newStatus === 'Applied') updateData.applied_at = new Date().toISOString();

    const { error } = await db.from('jobs').update(updateData).eq('id', jobId);
    if (error) {
      toast.error('Failed to update status');
      fetchJobs();
    } else {
      toast.success(`Moved to ${newStatus}`);
    }
  };

  const handleApprovePending = async (change: PendingChange) => {
    const updateData: Record<string, any> = { status: change.newStatus };
    if (change.newStatus === 'Applied') updateData.applied_at = new Date().toISOString();

    const { error } = await db.from('jobs').update(updateData).eq('id', change.jobId);
    if (error) {
      toast.error(`Failed to apply ${change.company} → ${change.newStatus}`);
      return;
    }

    // Remove from pending list
    const remaining = (pendingChanges?.changes || []).filter(c => c.jobId !== change.jobId);
    const newPending = remaining.length > 0
      ? { ...pendingChanges!, changes: remaining }
      : null;

    await db.from('user_profiles').update({ pending_status_changes: newPending }).eq('id', (await db.auth.getUser()).data.user!.id);

    setPendingChanges(newPending);
    setJobs(prev => prev.map(j => j.id === change.jobId ? { ...j, status: change.newStatus as JobStatus } : j));
    toast.success(`${change.company}: ${change.oldStatus} → ${change.newStatus}`);
  };

  const handleDismissPending = async (change: PendingChange) => {
    const remaining = (pendingChanges?.changes || []).filter(c => c.jobId !== change.jobId);
    const newPending = remaining.length > 0
      ? { ...pendingChanges!, changes: remaining }
      : null;

    await db.from('user_profiles').update({ pending_status_changes: newPending }).eq('id', (await db.auth.getUser()).data.user!.id);
    setPendingChanges(newPending);
    toast.info(`Dismissed ${change.company} status change`);
  };

  const handleExportSheets = async () => {
    setExportingSheets(true);
    try {
      const result = await exportToSheets();
      toast.success(`Exported ${result.jobCount} jobs to Google Sheets`);
      window.open(result.url, '_blank');
    } catch (err: any) {
      if (err.message === 'REAUTH_REQUIRED') {
        toast.error('Reconnect Gmail in Settings to grant Sheets access');
      } else {
        toast.error(`Export failed: ${err.message}`);
      }
    } finally {
      setExportingSheets(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-5">
      <div className="flex items-center justify-between animate-fade-up">
        <h1 className="text-2xl font-display font-bold">Pipeline</h1>
        <button
          onClick={handleExportSheets}
          disabled={exportingSheets}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border border-[hsl(var(--glass-border)/0.4)] bg-[hsl(var(--card))] hover:bg-[hsl(var(--glass-border)/0.15)] transition-colors disabled:opacity-50"
        >
          {exportingSheets
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <FileSpreadsheet className="h-4 w-4 text-green-500" />}
          Export to Sheets
        </button>
      </div>

      {/* Pending Status Changes — requires user confirmation */}
      {pendingChanges && pendingChanges.changes.length > 0 && (
        <div className="glass-card rounded-xl p-4 space-y-3 animate-fade-up border border-[hsl(var(--warning)/0.4)]">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-[hsl(var(--warning))]" />
            <span className="text-sm font-semibold">Pending Review</span>
            <span className="text-xs text-muted-foreground">— low confidence, confirm before applying</span>
            <span className="text-xs text-muted-foreground ml-auto">
              {pendingChanges.changes.length} change{pendingChanges.changes.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-2">
            {pendingChanges.changes.map((c, i) => (
              <div key={i} className="flex items-start gap-2 text-sm bg-[hsl(var(--warning)/0.05)] rounded-lg p-2.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate max-w-[120px]">{c.company}</span>
                    <span className="text-muted-foreground truncate max-w-[160px]">{c.role}</span>
                    <div className="flex items-center gap-1 ml-auto shrink-0">
                      <span className={`text-xs font-medium ${statusColor[c.oldStatus] || 'text-muted-foreground'}`}>{c.oldStatus}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className={`text-xs font-medium ${statusColor[c.newStatus] || 'text-muted-foreground'}`}>{c.newStatus}</span>
                      <span className="text-[10px] text-muted-foreground ml-1">({Math.round(c.confidence * 100)}%)</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{c.reason}</p>
                </div>
                <div className="flex gap-1 shrink-0 mt-0.5">
                  <button
                    onClick={() => handleApprovePending(c)}
                    className="p-1 rounded hover:bg-[hsl(var(--success)/0.15)] transition-colors"
                    title="Approve"
                  >
                    <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                  </button>
                  <button
                    onClick={() => handleDismissPending(c)}
                    className="p-1 rounded hover:bg-destructive/10 transition-colors"
                    title="Dismiss"
                  >
                    <XCircle className="h-4 w-4 text-destructive" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Status Changes */}
      <div className="glass-card rounded-xl p-4 space-y-3 animate-fade-up border border-[hsl(var(--glass-border)/0.3)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-[hsl(var(--info))]" />
            <span className="text-sm font-semibold">Last Status Scan</span>
            {statusChanges?.scanned_at && (
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(statusChanges.scanned_at), { addSuffix: true })}
              </span>
            )}
          </div>
          {statusChanges && (
            <span className="text-xs text-muted-foreground">
              {statusChanges.changes.length} change{statusChanges.changes.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {!statusChanges && (
          <p className="text-xs text-muted-foreground">Status sync hasn't run yet. Runs automatically every evening.</p>
        )}

        {statusChanges && statusChanges.changes.length === 0 && (
          <p className="text-xs text-muted-foreground">No status changes detected in last scan.</p>
        )}

        {statusChanges && statusChanges.changes.length > 0 && (
          <div className="space-y-2">
            {statusChanges.changes.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="font-medium truncate max-w-[120px]">{c.company}</span>
                <span className="text-muted-foreground truncate max-w-[160px]">{c.role}</span>
                <div className="flex items-center gap-1 ml-auto shrink-0">
                  <span className={`text-xs font-medium ${statusColor[c.oldStatus] || 'text-muted-foreground'}`}>{c.oldStatus}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className={`text-xs font-medium ${statusColor[c.newStatus] || 'text-muted-foreground'}`}>{c.newStatus}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 min-h-[60vh] animate-fade-up" style={{ animationDelay: '100ms' }}>
          {COLUMNS.map((col) => {
            const colJobs = jobs.filter(j => j.status === col.id);
            return (
              <Droppable key={col.id} droppableId={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`glass-card rounded-xl border-t-2 ${col.borderColor} p-3 transition-all duration-200 ${
                      snapshot.isDraggingOver ? 'ring-1 ring-primary/30 bg-[hsl(var(--primary)/0.03)]' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3 px-1">
                      <h3 className="text-sm font-display font-semibold">{col.label}</h3>
                      <span className="text-xs text-muted-foreground tabular-nums bg-[hsl(var(--glass-border)/0.3)] rounded-full px-2 py-0.5">
                        {colJobs.length}
                      </span>
                    </div>
                    <div className="space-y-2 min-h-[100px]">
                      {colJobs.map((job, index) => (
                        <Draggable key={job.id} draggableId={job.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`rounded-lg border border-[hsl(var(--glass-border)/0.3)] bg-[hsl(var(--card))] p-3 space-y-1.5 transition-all duration-200 ${
                                snapshot.isDragging ? 'shadow-xl shadow-primary/10 ring-1 ring-primary/20 scale-[1.02]' : 'hover:shadow-md hover:shadow-black/15 hover:-translate-y-px'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <div {...provided.dragHandleProps} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-grab">
                                  <GripVertical className="h-3.5 w-3.5" />
                                </div>
                                <CompanyLogo name={job.company} domain={(job as any).company_domain} jobLink={job.job_link} size="sm" />
                                <span className="text-sm font-medium truncate" dir="auto">{job.company}</span>
                              </div>
                              <p className="text-xs text-muted-foreground truncate pl-[22px]" dir="auto">{job.role}</p>
                              <div className="flex items-center justify-between pl-[22px]">
                                <span className="text-[11px] text-muted-foreground/70 truncate" dir="auto">{job.location}</span>
                                <ScorePill score={job.score} />
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}
