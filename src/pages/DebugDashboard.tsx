import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, ChevronDown, ChevronRight, Bug, AlertTriangle, Info, Zap } from 'lucide-react';
import { format } from 'date-fns';

interface DebugLog {
  id: string;
  debug_id: string;
  created_at: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  module: string;
  message: string;
  file_name: string | null;
  function_name: string | null;
  stack_trace: string | null;
  suggested_fix: string | null;
  raw_details: Record<string, unknown> | null;
}

const SEVERITY_STYLES: Record<string, string> = {
  info:     'bg-blue-500/10 text-blue-400 border-blue-500/20',
  warning:  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  error:    'bg-red-500/10 text-red-400 border-red-500/20',
  critical: 'bg-red-700/20 text-red-300 border-red-700/30',
};

const MODULE_STYLES: Record<string, string> = {
  frontend:      'bg-violet-500/10 text-violet-400 border-violet-500/20',
  supabase:      'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  edge_function: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  gmail:         'bg-orange-500/10 text-orange-400 border-orange-500/20',
  claude_api:    'bg-purple-500/10 text-purple-400 border-purple-500/20',
  database:      'bg-teal-500/10 text-teal-400 border-teal-500/20',
};

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'critical') return <Zap className="h-3.5 w-3.5" />;
  if (severity === 'error')    return <Bug className="h-3.5 w-3.5" />;
  if (severity === 'warning')  return <AlertTriangle className="h-3.5 w-3.5" />;
  return <Info className="h-3.5 w-3.5" />;
}

function ExpandableRow({ log }: { log: DebugLog }) {
  const [open, setOpen] = useState(false);
  const hasDetails = log.stack_trace || log.raw_details || log.suggested_fix || log.file_name || log.function_name;

  return (
    <>
      <tr
        className={`border-b border-[hsl(var(--glass-border)/0.2)] transition-colors hover:bg-[hsl(var(--glass-border)/0.1)] ${
          log.severity === 'critical' ? 'bg-red-900/5' : ''
        }`}
      >
        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {format(new Date(log.created_at), 'MM/dd HH:mm:ss')}
        </td>
        <td className="px-4 py-3">
          <Badge variant="outline" className={`text-[11px] gap-1 ${SEVERITY_STYLES[log.severity]}`}>
            <SeverityIcon severity={log.severity} />
            {log.severity}
          </Badge>
        </td>
        <td className="px-4 py-3">
          <Badge variant="outline" className={`text-[11px] ${MODULE_STYLES[log.module] ?? ''}`}>
            {log.module}
          </Badge>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
          {log.debug_id}
        </td>
        <td className="px-4 py-3 text-sm max-w-xs">
          <span className="line-clamp-2">{log.message}</span>
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px]">
          {log.suggested_fix && (
            <span className="text-yellow-400/80 line-clamp-2">{log.suggested_fix}</span>
          )}
        </td>
        <td className="px-4 py-3">
          {hasDetails && (
            <button
              onClick={() => setOpen(o => !o)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label={open ? 'Collapse details' : 'Expand details'}
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </td>
      </tr>
      {open && hasDetails && (
        <tr className="border-b border-[hsl(var(--glass-border)/0.2)] bg-[hsl(var(--glass-border)/0.05)]">
          <td colSpan={7} className="px-6 py-4">
            <div className="space-y-3 text-xs">
              {(log.file_name || log.function_name) && (
                <div className="flex gap-4 text-muted-foreground">
                  {log.file_name && <span>📄 {log.file_name}</span>}
                  {log.function_name && <span>⚙️ {log.function_name}()</span>}
                </div>
              )}
              {log.suggested_fix && (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-yellow-400">
                  💡 <strong>Suggested fix:</strong> {log.suggested_fix}
                </div>
              )}
              {log.raw_details && (
                <div>
                  <p className="text-muted-foreground mb-1 font-medium">Raw details:</p>
                  <pre className="rounded-lg bg-black/30 p-3 overflow-x-auto text-green-400/80 text-[11px] leading-relaxed max-h-48 overflow-y-auto">
                    {JSON.stringify(log.raw_details, null, 2)}
                  </pre>
                </div>
              )}
              {log.stack_trace && (
                <div>
                  <p className="text-muted-foreground mb-1 font-medium">Stack trace:</p>
                  <pre className="rounded-lg bg-black/30 p-3 overflow-x-auto text-red-400/70 text-[11px] leading-relaxed max-h-48 overflow-y-auto">
                    {log.stack_trace}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function DebugDashboard() {
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('debug_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (severityFilter !== 'all') query = query.eq('severity', severityFilter);
    if (moduleFilter !== 'all')   query = query.eq('module', moduleFilter);

    const { data } = await query;
    setLogs((data as DebugLog[]) ?? []);
    setLoading(false);
  }, [severityFilter, moduleFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const errorCount    = logs.filter(l => l.severity === 'error' || l.severity === 'critical').length;
  const warningCount  = logs.filter(l => l.severity === 'warning').length;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bug className="h-6 w-6 text-primary" />
              Debug Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Recent errors, warnings, and events across all modules
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchLogs}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Summary badges */}
        <div className="flex gap-3 flex-wrap">
          <div className="glass rounded-xl px-4 py-3 flex items-center gap-2">
            <span className="text-2xl font-bold">{logs.length}</span>
            <span className="text-sm text-muted-foreground">total logs</span>
          </div>
          <div className="glass rounded-xl px-4 py-3 flex items-center gap-2">
            <span className={`text-2xl font-bold ${errorCount > 0 ? 'text-red-400' : ''}`}>{errorCount}</span>
            <span className="text-sm text-muted-foreground">errors / critical</span>
          </div>
          <div className="glass rounded-xl px-4 py-3 flex items-center gap-2">
            <span className={`text-2xl font-bold ${warningCount > 0 ? 'text-yellow-400' : ''}`}>{warningCount}</span>
            <span className="text-sm text-muted-foreground">warnings</span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>

          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Module" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modules</SelectItem>
              <SelectItem value="frontend">Frontend</SelectItem>
              <SelectItem value="supabase">Supabase</SelectItem>
              <SelectItem value="edge_function">Edge Function</SelectItem>
              <SelectItem value="gmail">Gmail</SelectItem>
              <SelectItem value="claude_api">Claude API</SelectItem>
              <SelectItem value="database">Database</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Log table */}
        <div className="glass rounded-2xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />
              Loading logs…
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Bug className="h-8 w-8 opacity-30" />
              <p>No debug logs found</p>
              <p className="text-xs">Errors will appear here as they occur</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--glass-border)/0.3)] text-muted-foreground text-xs">
                    <th className="px-4 py-3 text-left font-medium">Timestamp</th>
                    <th className="px-4 py-3 text-left font-medium">Severity</th>
                    <th className="px-4 py-3 text-left font-medium">Module</th>
                    <th className="px-4 py-3 text-left font-medium">Debug ID</th>
                    <th className="px-4 py-3 text-left font-medium">Message</th>
                    <th className="px-4 py-3 text-left font-medium">Suggested Fix</th>
                    <th className="px-4 py-3 text-left font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => <ExpandableRow key={log.id} log={log} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Showing up to 200 most recent logs · Use Debug IDs to trace issues across frontend and edge functions
        </p>
      </div>
    </div>
  );
}
