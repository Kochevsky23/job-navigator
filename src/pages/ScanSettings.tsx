import { useEffect, useState } from 'react';
import { db } from '@/lib/supabase-external';
import { runDailyScan } from '@/lib/api';
import { ScanRun } from '@/types/database';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Radar, Mail, Brain, FileText, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';

export default function ScanSettings() {
  const [scanning, setScanning] = useState(false);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchScans = async () => {
    const { data } = await db.from('scan_runs').select('*').order('started_at', { ascending: false }).limit(20);
    if (data) setScans(data as unknown as ScanRun[]);
    setLoading(false);
  };

  useEffect(() => { fetchScans(); }, []);

  const handleScan = async () => {
    setScanning(true);
    try {
      const result = await runDailyScan();
      toast.success(`Scan complete! Found ${result.jobs_found} jobs, added ${result.jobs_added} new.`);
      fetchScans();
    } catch (e: any) {
      toast.error(e.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="container py-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-display font-bold">Scan Settings</h1>

      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            Scan Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
              <Mail className="h-5 w-5 text-primary shrink-0" />
              <div>
                <p className="text-sm font-medium">Gmail Source</p>
                <p className="text-xs text-muted-foreground">Label: "Job Alerts" — Last 24 hours</p>
              </div>
              <Badge variant="outline" className="ml-auto">Active</Badge>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
              <Brain className="h-5 w-5 text-accent shrink-0" />
              <div>
                <p className="text-sm font-medium">AI Analysis</p>
                <p className="text-xs text-muted-foreground">Claude — Extract, score & classify jobs</p>
              </div>
              <Badge variant="outline" className="ml-auto">Active</Badge>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
              <FileText className="h-5 w-5 text-[hsl(var(--success))] shrink-0" />
              <div>
                <p className="text-sm font-medium">CV Tailoring</p>
                <p className="text-xs text-muted-foreground">Auto-generate for jobs with score &gt; 6</p>
              </div>
              <Badge variant="outline" className="ml-auto">Active</Badge>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
              <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Deduplication</p>
                <p className="text-xs text-muted-foreground">Fingerprint: link or company+role+location</p>
              </div>
              <Badge variant="outline" className="ml-auto">Active</Badge>
            </div>
          </div>

          <Button onClick={handleScan} disabled={scanning} className="w-full gap-2" size="lg">
            {scanning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Radar className="h-5 w-5" />}
            {scanning ? 'Running Scan...' : 'Run Manual Scan'}
          </Button>
        </CardContent>
      </Card>

      {/* Scan History */}
      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Scan History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : scans.length === 0 ? (
            <p className="text-muted-foreground text-sm">No scan history yet.</p>
          ) : (
            <div className="rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-[hsl(var(--glass-border)/0.3)]">
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Time</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Status</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Found</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Added</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scans.map((s) => (
                    <TableRow key={s.id} className="border-b border-[hsl(var(--glass-border)/0.2)] hover:bg-[hsl(var(--glass-border)/0.15)] transition-colors">
                      <TableCell className="text-sm">{format(new Date(s.started_at), 'MMM d, HH:mm')}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          s.success
                            ? 'bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]'
                            : 'bg-[hsl(var(--destructive)/0.12)] text-destructive'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${s.success ? 'bg-[hsl(var(--success))]' : 'bg-destructive'}`} />
                          {s.success ? 'Success' : 'Failed'}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">{s.jobs_found}</TableCell>
                      <TableCell className="tabular-nums">{s.jobs_added}</TableCell>
                      <TableCell className="text-xs text-destructive max-w-[200px] truncate">
                        {s.error_text || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-base">Scan Flow</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
            <li>Authenticate with Google OAuth</li>
            <li>Fetch "Job Alerts" emails from last 24h</li>
            <li>Fetch CV from Google Drive</li>
            <li>Send to Claude for analysis & scoring</li>
            <li>Deduplicate & save to database</li>
            <li>Auto-generate tailored CVs for high-scoring jobs</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}