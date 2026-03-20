import { useEffect, useState } from 'react';
import { db } from '@/lib/supabase-external';
import { Job, JobStatus } from '@/types/database';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Badge } from '@/components/ui/badge';
import { Loader2, GripVertical } from 'lucide-react';
import CompanyLogo from '@/components/CompanyLogo';
import { toast } from 'sonner';

const COLUMNS: { id: JobStatus; label: string; borderColor: string }[] = [
  { id: 'New', label: 'New', borderColor: 'border-t-accent' },
  { id: 'Applied', label: 'Applied', borderColor: 'border-t-[hsl(var(--info))]' },
  { id: 'Interviewing', label: 'Interviewing', borderColor: 'border-t-[hsl(var(--warning))]' },
  { id: 'Offer', label: 'Offer', borderColor: 'border-t-[hsl(var(--success))]' },
  { id: 'Rejected', label: 'Rejected', borderColor: 'border-t-destructive' },
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

export default function Pipeline() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    const { data } = await db.from('jobs').select('*').order('score', { ascending: false });
    if (data) setJobs(data as unknown as Job[]);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-5">
      <h1 className="text-2xl font-display font-bold animate-fade-up">Pipeline</h1>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 min-h-[60vh] animate-fade-up" style={{ animationDelay: '100ms' }}>
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