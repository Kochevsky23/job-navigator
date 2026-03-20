import { useState } from 'react';
import { runDailyScan } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Radar, Mail, Brain, FileText, Clock } from 'lucide-react';
import { toast } from 'sonner';

export default function ScanSettings() {
  const [scanning, setScanning] = useState(false);

  const handleScan = async () => {
    setScanning(true);
    try {
      const result = await runDailyScan();
      toast.success(`Scan complete! Found ${result.jobs_found} jobs, added ${result.jobs_added} new.`);
    } catch (e: any) {
      toast.error(e.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="container py-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-display font-bold">Scan Settings</h1>

      <Card className="bg-card border-border">
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
              <FileText className="h-5 w-5 text-success shrink-0" />
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

      <Card className="bg-card border-border">
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
