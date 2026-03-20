import { useEffect, useState, useMemo } from 'react';
import { db } from '@/lib/supabase-external';
import { Job, Priority, JobStatus } from '@/types/database';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Loader2, FileText } from 'lucide-react';
import JobDetailPanel from '@/components/JobDetailPanel';

const priorityClass: Record<string, string> = {
  HIGH: 'bg-priority-high priority-high border',
  MEDIUM: 'bg-priority-medium priority-medium border',
  LOW: 'bg-priority-low priority-low border',
  REJECTED: 'bg-priority-rejected priority-rejected border',
};

export default function Jobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [minScore, setMinScore] = useState(0);

  const fetchJobs = async () => {
    const { data } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    if (data) setJobs(data as unknown as Job[]);
    setLoading(false);
  };

  useEffect(() => { fetchJobs(); }, []);

  const filtered = useMemo(() => {
    return jobs.filter(j => {
      if (priorityFilter !== 'ALL' && j.priority !== priorityFilter) return false;
      if (statusFilter !== 'ALL' && j.status !== statusFilter) return false;
      if (j.score < minScore) return false;
      return true;
    });
  }, [jobs, priorityFilter, statusFilter, minScore]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-4">
      <h1 className="text-2xl font-display font-bold">Jobs</h1>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[140px] bg-card border-border">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Priorities</SelectItem>
            <SelectItem value="HIGH">HIGH</SelectItem>
            <SelectItem value="MEDIUM">MEDIUM</SelectItem>
            <SelectItem value="LOW">LOW</SelectItem>
            <SelectItem value="REJECTED">REJECTED</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px] bg-card border-border">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="New">New</SelectItem>
            <SelectItem value="Applied">Applied</SelectItem>
            <SelectItem value="Interviewing">Interviewing</SelectItem>
            <SelectItem value="Rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Score ≥ {minScore}</span>
          <Slider
            value={[minScore]}
            onValueChange={([v]) => setMinScore(v)}
            min={0}
            max={10}
            step={1}
            className="w-32"
          />
        </div>

        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} jobs</span>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/50">
              <TableHead>Company</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden md:table-cell">Location</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead className="hidden lg:table-cell">Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>CV</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No jobs found matching filters
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((job) => (
                <TableRow
                  key={job.id}
                  className="cursor-pointer hover:bg-secondary/50 transition-colors"
                  onClick={() => setSelectedJob(job)}
                >
                  <TableCell className="font-medium" dir="auto">{job.company}</TableCell>
                  <TableCell dir="auto">{job.role}</TableCell>
                  <TableCell className="hidden md:table-cell" dir="auto">{job.location}</TableCell>
                  <TableCell>
                    <span className={`font-bold ${job.score >= 7 ? 'priority-high' : job.score >= 4 ? 'priority-medium' : 'priority-low'}`}>
                      {job.score}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={`${priorityClass[job.priority]} text-xs`}>{job.priority}</Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground max-w-[200px] truncate" dir="auto">
                    {job.reason}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{job.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {job.tailored_cv ? (
                      <FileText className="h-4 w-4 text-primary" />
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <JobDetailPanel
        job={selectedJob}
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        onUpdate={() => {
          fetchJobs();
          setSelectedJob(null);
        }}
      />
    </div>
  );
}
