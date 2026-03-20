import { useEffect, useState } from 'react';
import { db } from '@/lib/supabase-external';
import { runDailyScan } from '@/lib/api';
import { Job, ScanRun } from '@/types/database';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Briefcase, AlertTriangle, FileText, Clock, Loader2, Radar } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Welcome back, Dor 👋</p>
        </div>
        <Button onClick={handleScan} disabled={scanning} size="lg" className="gap-2">
          {scanning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Radar className="h-5 w-5" />}
          {scanning ? 'Scanning...' : 'Run Daily Scan'}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Jobs Today</CardTitle>
            <Briefcase className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-display font-bold">{todayJobs.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">High Priority</CardTitle>
            <AlertTriangle className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-display font-bold priority-high">{highPriority}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">CVs Generated</CardTitle>
            <FileText className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-display font-bold">{cvsGenerated}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Last Scan</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {lastScan ? (
              <div>
                <p className="text-sm font-medium">
                  {format(new Date(lastScan.started_at), 'MMM d, HH:mm')}
                </p>
                <Badge variant={lastScan.success ? 'default' : 'destructive'} className="mt-1 text-xs">
                  {lastScan.success ? 'Success' : 'Failed'}
                </Badge>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No scans yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="font-display">Recent Scans</CardTitle>
        </CardHeader>
        <CardContent>
          {scans.length === 0 ? (
            <p className="text-muted-foreground text-sm">No scan history yet. Run your first scan!</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Jobs Found</TableHead>
                  <TableHead>Jobs Added</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm">{format(new Date(s.started_at), 'MMM d, HH:mm')}</TableCell>
                    <TableCell>
                      <Badge variant={s.success ? 'default' : 'destructive'} className="text-xs">
                        {s.success ? '✓ Success' : '✗ Failed'}
                      </Badge>
                    </TableCell>
                    <TableCell>{s.jobs_found}</TableCell>
                    <TableCell>{s.jobs_added}</TableCell>
                    <TableCell className="text-xs text-destructive max-w-[200px] truncate">
                      {s.error_text || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
