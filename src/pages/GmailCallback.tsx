import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function GmailCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const code = params.get('code');
        if (!code) throw new Error('Missing OAuth code');

        const stateUserId = params.get('state');
        const userId = stateUserId || user?.id;
        if (!userId) throw new Error('Unable to identify user — please log in and try again');

        const redirectUri = `${window.location.origin}/onboarding/gmail-callback`;

        const { data, error: fnError } = await supabase.functions.invoke('gmail-oauth', {
          body: { code, redirect_uri: redirectUri, user_id: userId },
        });

        if (fnError) {
          let msg = fnError.message || 'Failed to connect Gmail';
          try {
            const body = await (fnError as any).context?.json?.();
            msg = body?.error || body?.message || msg;
          } catch { /* ignore */ }
          throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        }
        if (data?.error) throw new Error(data.error);

        toast.success('Gmail connected successfully!');
        const returnTo = sessionStorage.getItem('gmail_return_to') || '/onboarding?gmail=connected';
        sessionStorage.removeItem('gmail_return_to');
        navigate(returnTo, { replace: true });
      } catch (e: any) {
        const msg = e?.message || 'Failed to connect Gmail';
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [navigate, params]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md glass-card rounded-2xl p-6 text-center space-y-3">
          <p className="text-sm font-semibold text-destructive">Gmail connection failed</p>
          <p className="text-xs text-muted-foreground" dir="auto">{error}</p>
          <button
            onClick={() => navigate('/onboarding', { replace: true })}
            className="rounded-xl border border-[hsl(var(--glass-border)/0.5)] px-4 py-3 text-sm font-medium hover:bg-[hsl(var(--glass-border)/0.2)] transition-colors"
          >
            Back to Onboarding
          </button>
        </div>
      </div>
    );
  }

  return null;
}
