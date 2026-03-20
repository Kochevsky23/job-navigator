import { useEffect, useState } from 'react';
import { db } from '@/lib/supabase-external';
import { Job, JobStatus } from '@/types/database';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const COLUMNS: { id: JobStatus; label: string; color: string }[] = [
  { id: 'New', label: 'New', color: 'bg-primary/10 border-primary/30' },
  { id: 'Applied', label: 'Applied', color: 'bg-accent/10 border-accent/30' },
  { id: 'Interviewing', label: 'Interviewing', color: 'bg-warning/10 border-warning/30' },
  { id: 'Offer', label: 'Offer', color: 'bg-success/10 border-success/30' },
  { id: 'Rejected', label: 'Rejected', color: 'bg-destructive/10 border-destructive/30' },
];

const priorityDot: Record<string, string> = {
  HIGH: 'bg-[hsl(var(--priority-high))]',
  MEDIUM: 'bg-[hsl(var(--priority-medium))]',
  LOW: 'bg-[hsl(var(--priority-low))]',
  REJECTED: 'bg-[hsl(var(--priority-rejected))]',
};

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
    <div className="container py-6 space-y-4">
      <h1 className="text-2xl font-display font-bold">Pipeline</h1>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 min-h-[60vh]">
          {COLUMNS.map((col) => {
            const colJobs = jobs.filter(j => j.status === col.id);
            return (
              <Droppable key={col.id} droppableId={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`rounded-lg border p-3 transition-colors ${col.color} ${
                      snapshot.isDraggingOver ? 'ring-2 ring-primary/40' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-display font-semibold">{col.label}</h3>
                      <Badge variant="secondary" className="text-xs">{colJobs.length}</Badge>
                    </div>
                    <div className="space-y-2 min-h-[100px]">
                      {colJobs.map((job, index) => (
                        <Draggable key={job.id} draggableId={job.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`rounded-md border border-border bg-card p-3 space-y-1 transition-shadow ${
                                snapshot.isDragging ? 'shadow-lg shadow-primary/20 ring-1 ring-primary/30' : ''
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`h-2 w-2 rounded-full ${priorityDot[job.priority]}`} />
                                <span className="text-sm font-medium truncate" dir="auto">{job.company}</span>
                              </div>
                              <p className="text-xs text-muted-foreground truncate" dir="auto">{job.role}</p>
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">{job.location}</span>
                                <span className={`text-xs font-bold ${
                                  job.score >= 7 ? 'priority-high' : job.score >= 4 ? 'priority-medium' : 'priority-low'
                                }`}>
                                  {job.score}/10
                                </span>
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
