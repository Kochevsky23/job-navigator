import { Job } from '@/types/database';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { generateCV } from '@/lib/api';
import { toast } from 'sonner';

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

export default function JobDetailPanel({ job, open, onClose, onUpdate }: Props) {
  const [generating, setGenerating] = useState(false);

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

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg bg-card border-border overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-xl">{job.role}</SheetTitle>
          <p className="text-muted-foreground">{job.company}</p>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge className={priorityClass[job.priority]}>{job.priority}</Badge>
            <Badge variant="outline">{job.status}</Badge>
            <Badge variant="secondary">Score: {job.score}/10</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Location</span>
              <p dir="auto">{job.location}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Experience</span>
              <p dir="auto">{job.exp_required || 'N/A'}</p>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Reason</span>
              <p dir="auto">{job.reason}</p>
            </div>
          </div>

          {job.job_link && !job.job_link.includes('linkedin.com') ? (
            <a
              href={job.job_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-full rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <ExternalLink className="h-4 w-4 mr-2" /> View on Company Site
            </a>
          ) : job.linkedin_id ? (
            <a
              href={`https://www.linkedin.com/jobs/view/${job.linkedin_id}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-full rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <ExternalLink className="h-4 w-4 mr-2" /> View on LinkedIn
            </a>
          ) : null}

          {job.job_link && !job.job_link.includes('linkedin.com') && job.linkedin_id && (
            <a
              href={`https://www.linkedin.com/jobs/view/${job.linkedin_id}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-full rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <ExternalLink className="h-4 w-4 mr-2" /> View on LinkedIn
            </a>
          )}

          {job.tailored_cv ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-primary flex items-center gap-1">
                <FileText className="h-4 w-4" /> Tailored CV Ready
              </p>
              <div className="max-h-60 overflow-y-auto rounded-lg bg-secondary p-3 text-xs whitespace-pre-wrap font-mono" dir="auto">
                {job.tailored_cv}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const blob = new Blob([job.tailored_cv!], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `CV_${job.company}_${job.role}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download CV
              </Button>
            </div>
          ) : job.score > 6 && job.priority !== 'REJECTED' ? (
            <Button onClick={handleGenerateCV} disabled={generating} className="w-full">
              {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
              {generating ? 'Generating CV...' : 'Generate Tailored CV'}
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
