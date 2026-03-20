import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Compass, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function Signup() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    // Create profile
    if (data.user) {
      await supabase.from('user_profiles').insert({
        id: data.user.id,
        email,
        full_name: fullName,
      });
    }

    toast.success('Account created!');
    navigate('/onboarding');
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8 animate-fade-up">
        <div className="text-center">
          <div className="h-14 w-14 rounded-2xl gradient-primary flex items-center justify-center shadow-lg mx-auto mb-4">
            <Compass className="h-7 w-7 text-background" />
          </div>
          <h1 className="text-2xl font-display font-bold">Create your account</h1>
          <p className="text-sm text-muted-foreground mt-1">Start tracking jobs tailored to your CV</p>
        </div>

        <form onSubmit={handleSignup} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="name">Full Name</label>
            <input
              id="name"
              type="text"
              required
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="w-full rounded-xl glass-card border border-[hsl(var(--glass-border)/0.4)] bg-transparent px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              placeholder="Dor Kochevsky"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-xl glass-card border border-[hsl(var(--glass-border)/0.4)] bg-transparent px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-xl glass-card border border-[hsl(var(--glass-border)/0.4)] bg-transparent px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn-gradient w-full flex items-center justify-center gap-2 text-sm"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="text-accent hover:underline font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
