import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { chatWithAgent } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Send, Loader2, Briefcase, X } from 'lucide-react';
import { toast } from 'sonner';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

const QUICK_ACTIONS = [
  'What should I do next in my job search?',
  'Which of my open applications should I prioritize?',
  'Give me general interview practice — ask me a question.',
  'What skills gaps show up across the jobs I’ve been matched to?',
];

export default function AiAssistant() {
  const [searchParams, setSearchParams] = useSearchParams();
  const jobId = searchParams.get('jobId') || undefined;

  const [jobLabel, setJobLabel] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let query = supabase
        .from('chat_messages')
        .select('role, content, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(50);
      query = jobId ? query.eq('job_id', jobId) : query.is('job_id', null);

      const [{ data: history }, jobResp] = await Promise.all([
        query,
        jobId
          ? supabase.from('jobs').select('company, role').eq('id', jobId).single()
          : Promise.resolve({ data: null } as any),
      ]);

      if (cancelled) return;
      setMessages((history as ChatMessage[]) ?? []);
      setJobLabel(jobResp?.data ? `${jobResp.data.company} — ${jobResp.data.role}` : null);
      setLoadingHistory(false);
    })();

    return () => { cancelled = true; };
  }, [jobId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setSending(true);

    try {
      const { reply } = await chatWithAgent(trimmed, jobId);
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      toast.error(err.message || 'Assistant failed to reply');
    } finally {
      setSending(false);
    }
  };

  const clearJobContext = () => {
    searchParams.delete('jobId');
    setSearchParams(searchParams);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-8rem)]">

        <div className="mb-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            AI Assistant
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ask about your pipeline, get next-step recommendations, or run interview practice.
          </p>
          {jobLabel && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary text-xs px-3 py-1.5">
              <Briefcase className="h-3.5 w-3.5" />
              Discussing: {jobLabel}
              <button onClick={clearJobContext} aria-label="Clear job context" className="hover:opacity-70">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="glass rounded-2xl flex-1 overflow-y-auto p-4 space-y-4">
          {loadingHistory ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading conversation…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4">
              <Sparkles className="h-8 w-8 text-primary/40" />
              <p className="text-sm text-muted-foreground max-w-sm">
                Start a conversation, or try one of these:
              </p>
              <div className="flex flex-col gap-2 w-full max-w-sm">
                {QUICK_ACTIONS.map(q => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="text-left text-sm rounded-xl border border-[hsl(var(--glass-border)/0.3)] px-3.5 py-2.5 hover:bg-[hsl(var(--glass-border)/0.15)] transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-[hsl(var(--glass-border)/0.15)] text-foreground'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))
          )}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-2.5 bg-[hsl(var(--glass-border)/0.15)] text-muted-foreground text-sm flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="mt-4 flex items-end gap-2"
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask the assistant anything about your job search…"
            className="min-h-[48px] max-h-40 resize-none"
            disabled={sending}
          />
          <Button type="submit" disabled={sending || !input.trim()} size="icon" className="h-12 w-12 shrink-0">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
