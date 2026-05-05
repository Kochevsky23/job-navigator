import { Job } from '@/types/database';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, FileText, Loader2, Download, CheckCircle2, Send, StickyNote, Save, BookOpen, Building2, Sparkles, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { generateCV, generateCoverLetter, generateInterviewPrep, generateCompanyResearch } from '@/lib/api';
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
  const glowColor = score >= 8 ? 'hsl(155 100% 49% / 0.2)' : score >= 6 ? 'hsl(38 92% 50% / 0.2)' : 'hsl(0 72% 51% / 0.2)';

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
          style={{ filter: `drop-shadow(0 0 6px ${glowColor})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-display font-bold tabular-nums" style={{ color }}>{score}</span>
        <span className="text-[10px] text-muted-foreground">/10</span>
      </div>
    </div>
  );
}

function CollapsibleSection({
  icon: Icon,
  title,
  content,
  generating,
  hasContent,
  onGenerate,
  accentColor = 'primary',
  extraActions,
}: {
  icon: React.ElementType;
  title: string;
  content: string | null | undefined;
  generating: boolean;
  hasContent: boolean;
  onGenerate: () => void;
  accentColor?: 'primary' | 'accent' | 'warning';
  extraActions?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  const colorMap = {
    primary: { text: 'text-primary', border: 'border-primary/30', bg: 'bg-primary/5', hover: 'hover:bg-primary/10', btnBorder: 'border-primary/40' },
    accent: { text: 'text-accent', border: 'border-accent/30', bg: 'bg-accent/5', hover: 'hover:bg-accent/10', btnBorder: 'border-accent/40' },
    warning: { text: 'text-[hsl(var(--warning))]', border: 'border-[hsl(var(--warning)/0.3)]', bg: 'bg-[hsl(var(--warning)/0.05)]', hover: 'hover:bg-[hsl(var(--warning)/0.10)]', btnBorder: 'border-[hsl(var(--warning)/0.4)]' },
  };
  const c = colorMap[accentColor];

  return (
    <div className={`glass-card rounded-xl border ${c.border} overflow-hidden`}>
      <div className="flex items-center justify-between p-3 gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${c.text} shrink-0`} />
          <span className={`text-sm font-semibold ${c.text}`}>{title}</span>
          {hasContent && (
            <span className="text-[10px] font-medium bg-primary/15 text-primary px-1.5 py-0.5 rounded-full">Ready</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {hasContent && extraActions}
          {hasContent && (
            <button
              onClick={() => setExpanded(!expanded)}
              className={`flex items-center gap-1 text-xs ${c.text} ${c.hover} px-2 py-1 rounded-lg transition-colors`}
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {expanded ? 'Hide' : 'View'}
            </button>
          )}
          <button
            onClick={onGenerate}
            disabled={generating}
            className={`flex items-center gap-1.5 text-xs font-medium border ${c.btnBorder} ${c.bg} ${c.text} ${c.hover} px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50`}
          >
            {generating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : hasContent ? (
              <RefreshCw className="h-3 w-3" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {generating ? 'Generating...' : hasContent ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </div>
      {expanded && content && (
        <div className={`border-t ${c.border} p-3`}>
          <div className="max-h-64 overflow-y-auto text-xs whitespace-pre-wrap leading-relaxed text-foreground/90 font-mono" dir="auto">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}

export default function JobDetailPanel({ job, open, onClose, onUpdate }: Props) {
  const [generating, setGenerating] = useState(false);
  const [generatingCoverLetter, setGeneratingCoverLetter] = useState(false);
  const [generatingInterviewPrep, setGeneratingInterviewPrep] = useState(false);
  const [generatingCompanyResearch, setGeneratingCompanyResearch] = useState(false);
  const [marking, setMarking] = useState(false);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [userScore, setUserScore] = useState<number | null>(null);
  const [localJob, setLocalJob] = useState<Job | null>(null);

  const [prevJobId, setPrevJobId] = useState<string | null>(null);
  if (job && job.id !== prevJobId) {
    setPrevJobId(job.id);
    setNotes(job.notes || '');
    setUserScore(job.user_score ?? null);
    setLocalJob(job);
  }

  if (!job) return null;
  const displayJob = localJob || job;

  const refreshLocalJob = async () => {
    const { data } = await db.from('jobs').select('*').eq('id', job.id).single();
    if (data) setLocalJob(data as unknown as Job);
  };

  const handleRateJob = async (rating: number) => {
    const newScore = userScore === rating ? null : rating;
    setUserScore(newScore);
    try {
      await db.from('jobs').update({ user_score: newScore }).eq('id', job!.id);
      onUpdate?.();
    } catch {
      toast.error('Failed to save rating');
      setUserScore(job!.user_score ?? null);
    }
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      const { error } = await db.from('jobs').update({ notes: notes || null }).eq('id', job.id);
      if (error) throw error;
      toast.success('Notes saved!');
      onUpdate?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleGenerateCV = async () => {
    setGenerating(true);
    try {
      await generateCV(job.id);
      toast.success('CV generated!');
      await refreshLocalJob();
      onUpdate?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate CV');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateCoverLetter = async () => {
    setGeneratingCoverLetter(true);
    try {
      await generateCoverLetter(job.id);
      toast.success('Cover letter generated!');
      await refreshLocalJob();
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate cover letter');
    } finally {
      setGeneratingCoverLetter(false);
    }
  };

  const handleGenerateInterviewPrep = async () => {
    setGeneratingInterviewPrep(true);
    try {
      await generateInterviewPrep(job.id);
      toast.success('Interview prep generated!');
      await refreshLocalJob();
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate interview prep');
    } finally {
      setGeneratingInterviewPrep(false);
    }
  };

  const handleGenerateCompanyResearch = async () => {
    setGeneratingCompanyResearch(true);
    try {
      await generateCompanyResearch(job.id);
      toast.success('Company research ready!');
      await refreshLocalJob();
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate company research');
    } finally {
      setGeneratingCompanyResearch(false);
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
        <div className="p-6 space-y-5">
          <SheetHeader className="space-y-0">
            <div className="flex items-start gap-4">
              <CompanyLogo name={job.company} domain={job.company_domain} jobLink={job.job_link} size="lg" />
              <div className="min-w-0 pt-1">
                <SheetTitle className="font-display text-xl leading-tight">{job.role}</SheetTitle>
                <p className="text-muted-foreground text-sm mt-0.5">{job.company}</p>
              </div>
            </div>
          </SheetHeader>

          {/* Score + Meta */}
          <div className="flex items-center gap-4">
            <CircularScore score={job.score} />
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Badge className={priorityClass[job.priority]}>{job.priority}</Badge>
                <Badge variant="outline" className="border-[hsl(var(--glass-border)/0.5)]">{job.status}</Badge>
                {job.applied_at && (
                  <Badge variant="outline" className="border-[hsl(var(--success)/0.3)] text-[hsl(var(--success))] text-xs">
                    Applied {new Date(job.applied_at).toLocaleDateString()}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground mr-1">Your fit:</span>
                {[1, 2, 3, 4, 5].map(star => (
                  <button
                    key={star}
                    onClick={() => handleRateJob(star)}
                    className={`text-lg leading-none transition-colors ${
                      userScore !== null && star <= userScore
                        ? 'text-yellow-400'
                        : 'text-muted-foreground/30 hover:text-yellow-400/60'
                    }`}
                    title={`Rate ${star}/5`}
                  >
                    ★
                  </button>
                ))}
                {userScore !== null && (
                  <span className="text-xs text-muted-foreground ml-1">{userScore}/5</span>
                )}
              </div>
            </div>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="glass-card rounded-lg p-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Location</span>
              <p className="font-medium mt-0.5" dir="auto">{job.location}</p>
            </div>
            <div className="glass-card rounded-lg p-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Experience</span>
              <p className="font-medium mt-0.5" dir="auto">{job.exp_required || 'N/A'}</p>
            </div>
            <div className="col-span-2 glass-card rounded-lg p-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">AI Reason</span>
              <p className="mt-1 text-sm leading-relaxed" dir="auto">{job.reason}</p>
            </div>
          </div>

          {/* Apply */}
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

          {/* AI Tools */}
          {job.priority !== 'REJECTED' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">AI Tools</span>
              </div>

              {/* Tailored CV */}
              {(displayJob.tailored_cv || job.score > 6) && (
                <CollapsibleSection
                  icon={FileText}
                  title="Tailored CV"
                  content={displayJob.tailored_cv}
                  generating={generating}
                  hasContent={!!displayJob.tailored_cv}
                  onGenerate={handleGenerateCV}
                  accentColor="primary"
                  extraActions={
                    <button
                      onClick={() => {
                        const w = window.open('', '_blank');
                        if (!w) return;
                        const lines = displayJob.tailored_cv!.split('\n');
                        const html = lines.map(line => {
                          const escaped = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                          if (!escaped.trim()) return '<br/>';
                          if (/^[A-Z][A-Z\s]{3,}$/.test(escaped.trim())) return `<h2>${escaped}</h2>`;
                          if (escaped.trim().startsWith('•') || escaped.trim().startsWith('-')) return `<li>${escaped.replace(/^[•\-]\s*/,'')}</li>`;
                          return `<p>${escaped}</p>`;
                        }).join('');
                        w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>CV – ${job.company}</title><style>
                          body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 32px;color:#111;font-size:13px;line-height:1.6}
                          h1{font-size:22px;margin:0 0 4px}h2{font-size:12px;letter-spacing:.12em;text-transform:uppercase;border-bottom:1px solid #aaa;margin:18px 0 6px;padding-bottom:3px}
                          p{margin:2px 0}li{margin:1px 0 1px 16px}br{display:block;margin:4px 0}
                          @media print{body{margin:0;padding:24px}}
                        </style></head><body>${html}<script>window.onload=()=>{window.print();}</script></body></html>`);
                        w.document.close();
                      }}
                      className="flex items-center gap-1 text-xs text-primary hover:bg-primary/10 px-2 py-1 rounded-lg transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" /> PDF
                    </button>
                  }
                />
              )}

              <CollapsibleSection
                icon={BookOpen}
                title="Cover Letter"
                content={displayJob.cover_letter}
                generating={generatingCoverLetter}
                hasContent={!!displayJob.cover_letter}
                onGenerate={handleGenerateCoverLetter}
                accentColor="accent"
              />

              <CollapsibleSection
                icon={StickyNote}
                title="Interview Prep"
                content={displayJob.interview_prep}
                generating={generatingInterviewPrep}
                hasContent={!!displayJob.interview_prep}
                onGenerate={handleGenerateInterviewPrep}
                accentColor="primary"
              />

              <CollapsibleSection
                icon={Building2}
                title="Company Research"
                content={displayJob.company_research}
                generating={generatingCompanyResearch}
                hasContent={!!displayJob.company_research}
                onGenerate={handleGenerateCompanyResearch}
                accentColor="warning"
              />
            </div>
          )}

          {/* Notes */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <StickyNote className="h-4 w-4 text-muted-foreground" />
              Notes
            </div>
            <div className="glass-card rounded-xl p-3 space-y-3">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Prep questions, contacts, key points..."
                rows={3}
                className="w-full rounded-lg border border-[hsl(var(--glass-border)/0.4)] bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="flex items-center justify-center gap-2 w-full rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/10 transition-colors"
              >
                {savingNotes ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {savingNotes ? 'Saving...' : 'Save Notes'}
              </button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
