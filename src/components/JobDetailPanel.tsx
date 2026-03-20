import { Job } from '@/types/database';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, FileText, Loader2, Download, CheckCircle2, Send } from 'lucide-react';
import { useState } from 'react';
import { generateCV } from '@/lib/api';
import { db } from '@/lib/supabase-external';
import { toast } from 'sonner';
import CompanyLogo from '@/components/CompanyLogo';

interface Props {
  job: Job | null;
  open: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}

const priorityClass: Record<string, string> = {
  HIGH: 'bg-priority-high priority-high border',
  MEDIUM: 'bg-priority-medium priority-medium border',
  LOW: 'bg-priority-low priority-low border',
  REJECTED: 'bg-priority-rejected priority-rejected border',
};

function CircularScore({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const color = score >= 8 ? 'hsl(155 100% 49%)' : score >= 6 ? 'hsl(38 92% 50%)' : 'hsl(0 72% 51%)';

  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg className="h-24 w-24 -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="hsl(232 18% 20%)" strokeWidth="5" />
        <circle
          cx="40" cy="40" r={radius} fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-display font-bold tabular-nums" style={{ color }}>{score}</span>
        <span className="text-[10px] text-muted-foreground">/10</span>
      </div>
    </div>
  );
}

export default function JobDetailPanel({ job, open, onClose, onUpdate }: Props) {
  const [generating, setGenerating] = useState(false);
  const [marking, setMarking] = useState(false);

  if (!job) return null;

  const handleGenerateCV = async () => {
    setGenerating(true);
    try {
      await generateCV(job.id);
      toast.success('CV generated successfully!');
      onUpdate?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate CV');
    } finally {
      setGenerating(false);
    }
  };

  const handleMarkApplied = async () => {
    setMarking(true);
    try {
      const { error } = await db.from('jobs').update({
        status: 'Applied',
        applied_at: new Date().toISOString(),
      }).eq('id', job.id);
      if (error) throw error;
      toast.success('Marked as applied!');
      onUpdate?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to update');
    } finally {
      setMarking(false);
    }
  };

  const isApplied = job.status === 'Applied' || job.status === 'Interviewing' || job.status === 'Offer';

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg glass border-l border-[hsl(var(--glass-border)/0.4)] overflow-y-auto p-0">
        <div className="p-6 space-y-6">
          <SheetHeader className="space-y-0">
            <div className="flex items-start gap-4">
              <CompanyLogo name={job.company} domain={job.company_domain} jobLink={job.job_link} size="lg" />
              <div className="min-w-0 pt-1">
                <SheetTitle className="font-display text-xl leading-tight">{job.role}</SheetTitle>
                <p className="text-muted-foreground text-sm mt-0.5">{job.company}</p>
              </div>
            </div>
          </SheetHeader>

          <div className="flex items-center gap-4">
            <CircularScore score={job.score} />
            <div className="flex flex-wrap gap-2">
              <Badge className={priorityClass[job.priority]}>{job.priority}</Badge>
              <Badge variant="outline" className="border-[hsl(var(--glass-border)/0.5)]">{job.status}</Badge>
              {job.applied_at && (
                <Badge variant="outline" className="border-[hsl(var(--success)/0.3)] text-[hsl(var(--success))] text-xs">
                  Applied {new Date(job.applied_at).toLocaleDateString()}
                </Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="glass-card rounded-lg p-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Location</span>
              <p className="font-medium mt-0.5" dir="auto">{job.location}</p>
            </div>
            <div className="glass-card rounded-lg p-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Experience</span>
              <p className="font-medium mt-0.5" dir="auto">{job.exp_required || 'N/A'}</p>
            </div>
            <div className="col-span-2 glass-card rounded-lg p-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Reason</span>
              <p className="mt-1 text-sm leading-relaxed" dir="auto">{job.reason}</p>
            </div>
          </div>

          {/* Application tracking */}
          {!isApplied && job.priority !== 'REJECTED' && (
            <button
              onClick={handleMarkApplied}
              disabled={marking}
              className="flex items-center justify-center gap-2 w-full rounded-xl border-2 border-[hsl(var(--success)/0.4)] bg-[hsl(var(--success)/0.06)] px-4 py-3 text-sm font-medium text-[hsl(var(--success))] hover:bg-[hsl(var(--success)/0.12)] transition-colors"
            >
              {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {marking ? 'Updating...' : 'Mark as Applied'}
            </button>
          )}

          {isApplied && (
            <div className="flex items-center gap-2 justify-center py-2 text-sm text-[hsl(var(--success))]">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium">Applied{job.applied_at ? ` on ${new Date(job.applied_at).toLocaleDateString()}` : ''}</span>
            </div>
          )}

          {/* Links */}
          <div className="space-y-2">
            {job.job_link && !job.job_link.includes('linkedin.com') ? (
              <a
                href={job.job_link}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-gradient flex items-center justify-center gap-2 w-full rounded-xl text-sm"
              >
                <ExternalLink className="h-4 w-4" /> View on Company Site
              </a>
            ) : job.linkedin_id ? (
              <a
                href={`https://www.linkedin.com/jobs/view/${job.linkedin_id}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-gradient flex items-center justify-center gap-2 w-full rounded-xl text-sm"
              >
                <ExternalLink className="h-4 w-4" /> View on LinkedIn
              </a>
            ) : null}

            {job.job_link && !job.job_link.includes('linkedin.com') && job.linkedin_id && (
              <a
                href={`https://www.linkedin.com/jobs/view/${job.linkedin_id}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full rounded-xl border border-[hsl(var(--glass-border)/0.5)] bg-transparent px-4 py-3 text-sm font-medium text-accent hover:bg-[hsl(var(--accent)/0.08)] transition-colors"
              >
                <ExternalLink className="h-4 w-4" /> View on LinkedIn
              </a>
            )}
          </div>

          {/* CV */}
          {job.tailored_cv ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-primary">Tailored CV Ready</p>
              </div>
              <div className="max-h-60 overflow-y-auto rounded-xl glass-card p-4 text-xs whitespace-pre-wrap font-mono leading-relaxed" dir="auto">
                {job.tailored_cv}
              </div>
              <button
                onClick={() => {
                  const blob = new Blob([job.tailored_cv!], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `CV_${job.company}_${job.role}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="flex items-center justify-center gap-2 w-full rounded-xl border border-[hsl(var(--glass-border)/0.5)] px-4 py-2.5 text-sm font-medium hover:bg-[hsl(var(--glass-border)/0.2)] transition-colors"
              >
                <Download className="h-4 w-4" /> Download CV
              </button>
            </div>
          ) : job.score > 6 && job.priority !== 'REJECTED' ? (
            <button
              onClick={handleGenerateCV}
              disabled={generating}
              className="btn-gradient flex items-center justify-center gap-2 w-full rounded-xl text-sm"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {generating ? 'Generating CV...' : 'Generate Tailored CV'}
            </button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
