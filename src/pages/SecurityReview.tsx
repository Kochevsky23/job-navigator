import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Shield, ChevronDown, ChevronRight, AlertTriangle, RefreshCw, CheckCircle2, Save } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface Finding {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  area: string;
  issue: string;
  risk: string;
  recommendation: string;
  auto_fix_allowed: false;
  verified: boolean;
}

interface ReviewResult {
  success: boolean;
  checked_at: string;
  checks_performed: {
    static_architectural: number;
    runtime_db: number;
    note: string;
  };
  summary: {
    total_findings: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  findings: Finding[];
}

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-700/20 text-red-300 border-red-700/30',
  HIGH:     'bg-red-500/10 text-red-400 border-red-500/20',
  MEDIUM:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  LOW:      'bg-blue-500/10 text-blue-400 border-blue-500/20',
};

const CATEGORY_STYLES: Record<string, string> = {
  'Supabase RLS':     'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'OAuth':            'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'Logging':          'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  'AI Privacy':       'bg-purple-500/10 text-purple-400 border-purple-500/20',
  'Secrets':          'bg-red-500/10 text-red-400 border-red-500/20',
  'API Security':     'bg-pink-500/10 text-pink-400 border-pink-500/20',
  'Input Validation': 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  'CORS':             'bg-violet-500/10 text-violet-400 border-violet-500/20',
  'Other':            'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

function FindingRow({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr
        className={`border-b border-[hsl(var(--glass-border)/0.2)] transition-colors hover:bg-[hsl(var(--glass-border)/0.1)] ${
          finding.severity === 'CRITICAL' ? 'bg-red-900/5' : ''
        }`}
      >
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{finding.id}</td>
        <td className="px-4 py-3">
          <Badge variant="outline" className={`text-[11px] ${SEVERITY_STYLES[finding.severity]}`}>
            {finding.severity}
          </Badge>
        </td>
        <td className="px-4 py-3">
          <Badge variant="outline" className={`text-[11px] ${CATEGORY_STYLES[finding.category] ?? ''}`}>
            {finding.category}
          </Badge>
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[140px]">
          <span className="line-clamp-1">{finding.area}</span>
        </td>
        <td className="px-4 py-3 text-sm max-w-xs">
          <span className="line-clamp-2">{finding.issue}</span>
        </td>
        <td className="px-4 py-3 text-xs">
          {finding.verified
            ? <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Verified</span>
            : <span className="text-muted-foreground">Architectural</span>}
        </td>
        <td className="px-4 py-3">
          <button
            onClick={() => setOpen(o => !o)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[hsl(var(--glass-border)/0.2)] bg-[hsl(var(--glass-border)/0.05)]">
          <td colSpan={7} className="px-6 py-4">
            <div className="space-y-3 text-xs max-w-3xl">
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-red-400/90">
                <strong>Risk:</strong> {finding.risk}
              </div>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-emerald-400/90">
                <strong>Recommendation:</strong> {finding.recommendation}
              </div>
              <p className="text-muted-foreground text-[11px]">
                auto_fix_allowed: false · {finding.verified ? 'Runtime-verified against live DB' : 'Static architectural finding — manual review required'}
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function SecurityReview() {
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');

  const runReview = useCallback(async (save = false) => {
    if (save) setSaving(true); else setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const { data, error } = await supabase.functions.invoke('security-review', {
        body: { save },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (error) throw new Error(error.message || 'Review failed');
      setResult(data as ReviewResult);
      if (save) toast.success('Review saved to database');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setLoading(false);
      setSaving(false);
    }
  }, []);

  const filtered = result
    ? (severityFilter === 'ALL' ? result.findings : result.findings.filter(f => f.severity === severityFilter))
    : [];

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              Security & Privacy Review
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Read-only analysis of security and privacy risks. No auto-fixes applied.
            </p>
          </div>
          <div className="flex gap-2">
            {result && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => runReview(true)}
                disabled={saving || loading}
                className="gap-2"
              >
                <Save className={`h-4 w-4 ${saving ? 'animate-pulse' : ''}`} />
                {saving ? 'Saving…' : 'Save Results'}
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => runReview(false)}
              disabled={loading || saving}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Running…' : result ? 'Re-run Review' : 'Run Security Review'}
            </Button>
          </div>
        </div>

        {/* Pre-run state */}
        {!result && !loading && (
          <div className="glass rounded-2xl flex flex-col items-center justify-center py-20 gap-4 text-center">
            <Shield className="h-12 w-12 text-primary/40" />
            <div>
              <p className="font-medium">Security & Privacy Review Agent-lite</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                Runs {12} static architectural checks + runtime DB queries against your live data.
                Read-only — no changes made.
              </p>
            </div>
            <Button onClick={() => runReview(false)} className="gap-2">
              <Shield className="h-4 w-4" />
              Run Review
            </Button>
          </div>
        )}

        {loading && (
          <div className="glass rounded-2xl flex items-center justify-center py-16 gap-3 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            Running security checks…
          </div>
        )}

        {result && !loading && (
          <>
            {/* Meta */}
            <p className="text-xs text-muted-foreground">
              Checked at {format(new Date(result.checked_at), 'MMM d, HH:mm:ss')} ·
              {result.checks_performed.static_architectural} static + {result.checks_performed.runtime_db} runtime checks
            </p>

            {/* Summary cards */}
            <div className="flex gap-3 flex-wrap">
              {[
                { label: 'total', value: result.summary.total_findings, color: '' },
                { label: 'critical', value: result.summary.critical, color: result.summary.critical > 0 ? 'text-red-300' : '' },
                { label: 'high', value: result.summary.high, color: result.summary.high > 0 ? 'text-red-400' : '' },
                { label: 'medium', value: result.summary.medium, color: result.summary.medium > 0 ? 'text-yellow-400' : '' },
                { label: 'low', value: result.summary.low, color: 'text-blue-400' },
              ].map(({ label, value, color }) => (
                <button
                  key={label}
                  onClick={() => setSeverityFilter(label === 'total' ? 'ALL' : label.toUpperCase())}
                  className={`glass rounded-xl px-4 py-3 flex items-center gap-2 transition-colors hover:bg-[hsl(var(--glass-border)/0.2)] ${
                    (label === 'total' ? 'ALL' : label.toUpperCase()) === severityFilter ? 'ring-1 ring-primary/40' : ''
                  }`}
                >
                  <span className={`text-2xl font-bold ${color}`}>{value}</span>
                  <span className="text-sm text-muted-foreground">{label}</span>
                </button>
              ))}
            </div>

            {/* Note */}
            <div className="glass rounded-xl px-4 py-3 flex items-start gap-2 text-sm text-muted-foreground border border-yellow-500/20">
              <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
              <span>{result.checks_performed.note}</span>
            </div>

            {/* Findings table */}
            <div className="glass rounded-2xl overflow-hidden">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <CheckCircle2 className="h-8 w-8 opacity-30" />
                  <p>No findings for this filter</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[hsl(var(--glass-border)/0.3)] text-muted-foreground text-xs">
                        <th className="px-4 py-3 text-left font-medium">ID</th>
                        <th className="px-4 py-3 text-left font-medium">Severity</th>
                        <th className="px-4 py-3 text-left font-medium">Category</th>
                        <th className="px-4 py-3 text-left font-medium">Area</th>
                        <th className="px-4 py-3 text-left font-medium">Issue</th>
                        <th className="px-4 py-3 text-left font-medium">Verified</th>
                        <th className="px-4 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(f => <FindingRow key={f.id} finding={f} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground text-center">
              All findings are recommendations only · auto_fix_allowed: false on every item
            </p>
          </>
        )}
      </div>
    </div>
  );
}
