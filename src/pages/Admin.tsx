import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, ShieldAlert, RefreshCw, Users, Activity, Bug } from 'lucide-react';
import { format } from 'date-fns';

interface DebugLogRow {
  id: string;
  debug_id: string;
  created_at: string;
  severity: string;
  module: string;
  message: string;
  user_id: string | null;
}

interface ScanRunRow {
  id: string;
  started_at: string | null;
  success: boolean | null;
  jobs_found: number | null;
  jobs_added: number | null;
  error_text: string | null;
  user_id: string | null;
}

interface UserSummary {
  id: string;
  full_name: string | null;
  email: string | null;
  jobCount: number;
  lastScanAt: string | null;
}

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  warning: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
  critical: 'bg-red-700/20 text-red-300 border-red-700/30',
};

export default function Admin() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<DebugLogRow[]>([]);
  const [runs, setRuns] = useState<ScanRunRow[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setChecking(false); return; }
      const { data } = await supabase.from('user_profiles').select('is_admin').eq('id', user.id).single();
      setIsAdmin(!!(data as any)?.is_admin);
      setChecking(false);
    })();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void loadData();
  }, [isAdmin]);

  const loadData = async () => {
    setLoading(true);
    const [{ data: logData }, { data: runData }, { data: profileData }] = await Promise.all([
      supabase.from('debug_logs').select('id, debug_id, created_at, severity, module, message, user_id')
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('scan_runs').select('id, started_at, success, jobs_found, jobs_added, error_text, user_id')
        .order('started_at', { ascending: false }).limit(100),
      supabase.from('user_profiles').select('id, full_name, email'),
    ]);
    const { data: jobRows } = await supabase.from('jobs').select('user_id');

    const jobCounts: Record<string, number> = {};
    for (const j of jobRows ?? []) {
      if (j.user_id) jobCounts[j.user_id] = (jobCounts[j.user_id] ?? 0) + 1;
    }
    const lastScan: Record<string, string> = {};
    for (const r of runData ?? []) {
      if (r.user_id && r.started_at && !lastScan[r.user_id]) lastScan[r.user_id] = r.started_at;
    }

    setUsers(
      (profileData ?? []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        jobCount: jobCounts[p.id] ?? 0,
        lastScanAt: lastScan[p.id] ?? null,
      }))
    );
    setLogs((logData as DebugLogRow[]) ?? []);
    setRuns((runData as ScanRunRow[]) ?? []);
    setLoading(false);
  };

  if (checking) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
      <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Checking access…
    </div>;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3 text-center px-6">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-bold">Not authorized</h1>
        <p className="text-sm text-muted-foreground max-w-sm">This page is only available to the system administrator.</p>
      </div>
    );
  }

  const errorCount = logs.filter(l => l.severity === 'error' || l.severity === 'critical').length;
  const failedRuns = runs.filter(r => r.success === false).length;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              Admin Console
            </h1>
            <p className="text-sm text-muted-foreground mt-1">System-wide health across all users</p>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 text-sm rounded-xl border border-[hsl(var(--glass-border)/0.4)] px-3.5 py-2 hover:bg-[hsl(var(--glass-border)/0.15)] transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="glass rounded-xl px-4 py-3">
            <p className="text-2xl font-bold">{users.length}</p>
            <p className="text-xs text-muted-foreground">users</p>
          </div>
          <div className="glass rounded-xl px-4 py-3">
            <p className="text-2xl font-bold">{users.reduce((s, u) => s + u.jobCount, 0)}</p>
            <p className="text-xs text-muted-foreground">jobs (all users)</p>
          </div>
          <div className="glass rounded-xl px-4 py-3">
            <p className={`text-2xl font-bold ${failedRuns > 0 ? 'text-red-400' : ''}`}>{failedRuns}</p>
            <p className="text-xs text-muted-foreground">failed scan runs (last 100)</p>
          </div>
          <div className="glass rounded-xl px-4 py-3">
            <p className={`text-2xl font-bold ${errorCount > 0 ? 'text-red-400' : ''}`}>{errorCount}</p>
            <p className="text-xs text-muted-foreground">errors / critical logs</p>
          </div>
        </div>

        {/* Per-user summary */}
        <div className="glass rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[hsl(var(--glass-border)/0.3)] flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-primary" /> Users
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--glass-border)/0.3)] text-muted-foreground text-xs">
                  <th className="px-4 py-2 text-left font-medium">User</th>
                  <th className="px-4 py-2 text-left font-medium">Jobs</th>
                  <th className="px-4 py-2 text-left font-medium">Last scan</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-[hsl(var(--glass-border)/0.15)]">
                    <td className="px-4 py-2.5">{u.full_name || u.email || u.id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5">{u.jobCount}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {u.lastScanAt ? format(new Date(u.lastScanAt), 'MM/dd HH:mm') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Scan runs */}
        <div className="glass rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[hsl(var(--glass-border)/0.3)] flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4 text-primary" /> Recent scan runs
          </div>
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--glass-border)/0.3)] text-muted-foreground text-xs">
                  <th className="px-4 py-2 text-left font-medium">Started</th>
                  <th className="px-4 py-2 text-left font-medium">User</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Found / Added</th>
                  <th className="px-4 py-2 text-left font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className="border-b border-[hsl(var(--glass-border)/0.15)]">
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {r.started_at ? format(new Date(r.started_at), 'MM/dd HH:mm:ss') : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{users.find(u => u.id === r.user_id)?.full_name || r.user_id?.slice(0, 8) || '—'}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={r.success === false ? 'bg-red-500/10 text-red-400 border-red-500/20 text-[11px]' : 'bg-green-500/10 text-green-400 border-green-500/20 text-[11px]'}>
                        {r.success === false ? 'failed' : 'ok'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">{r.jobs_found ?? 0} / {r.jobs_added ?? 0}</td>
                    <td className="px-4 py-2.5 text-xs text-red-400/80 max-w-xs truncate">{r.error_text || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Debug logs */}
        <div className="glass rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[hsl(var(--glass-border)/0.3)] flex items-center gap-2 text-sm font-semibold">
            <Bug className="h-4 w-4 text-primary" /> Recent debug logs (all users)
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--glass-border)/0.3)] text-muted-foreground text-xs">
                  <th className="px-4 py-2 text-left font-medium">Time</th>
                  <th className="px-4 py-2 text-left font-medium">Severity</th>
                  <th className="px-4 py-2 text-left font-medium">Module</th>
                  <th className="px-4 py-2 text-left font-medium">User</th>
                  <th className="px-4 py-2 text-left font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} className="border-b border-[hsl(var(--glass-border)/0.15)]">
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {format(new Date(l.created_at), 'MM/dd HH:mm:ss')}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[11px] ${SEVERITY_STYLES[l.severity] ?? ''}`}>{l.severity}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs">{l.module}</td>
                    <td className="px-4 py-2.5 text-xs">{users.find(u => u.id === l.user_id)?.full_name || l.user_id?.slice(0, 8) || '—'}</td>
                    <td className="px-4 py-2.5 text-xs max-w-md truncate">{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
