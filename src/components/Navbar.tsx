import { NavLink, useNavigate } from 'react-router-dom';
import { Compass, LayoutDashboard, Table2, KanbanSquare, Settings, LogOut, Menu, X, User, Sun, Moon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from '@/components/ui/dropdown-menu';

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/jobs', label: 'Jobs', icon: Table2 },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Navbar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [initials, setInitials] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (user) {
      supabase.from('user_profiles').select('avatar_url, full_name').eq('id', user.id).single()
        .then(({ data }) => {
          if (data) {
            setAvatarUrl((data as any).avatar_url || '');
            const name = (data as any).full_name || '';
            setInitials(name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase());
          }
        });
    }
  }, [user]);

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return (
    <nav className="sticky top-0 z-50 glass border-b-0 border-t-0 border-x-0 border-b border-[hsl(var(--glass-border)/0.3)]">
      <div className="container flex h-14 items-center gap-4">
        <NavLink to="/dashboard" className="flex items-center gap-2.5 font-display text-lg font-bold group">
          <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center shadow-md">
            <Compass className="h-4.5 w-4.5 text-background" />
          </div>
          <span className="gradient-text hidden sm:inline">Job Compass</span>
        </NavLink>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1 ml-auto">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-[hsl(var(--primary)/0.12)] text-primary glow-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--glass-border)/0.3)]'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
          <div className="ml-2 pl-2 border-l border-[hsl(var(--glass-border)/0.3)] flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-full transition-opacity hover:opacity-80 active:scale-95 outline-none">
                  <Avatar className="h-8 w-8 cursor-pointer">
                    {avatarUrl && <AvatarImage src={avatarUrl} alt="Profile" />}
                    <AvatarFallback className="text-[10px] font-semibold bg-primary/10 text-primary">
                      {initials || <User className="h-3.5 w-3.5" />}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => navigate('/settings')} className="cursor-pointer gap-2">
                  <Settings className="h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleTheme} className="cursor-pointer gap-2">
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer gap-2 text-destructive focus:text-destructive">
                  <LogOut className="h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden ml-auto p-2 rounded-lg hover:bg-[hsl(var(--glass-border)/0.3)] transition-colors"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden glass border-t border-[hsl(var(--glass-border)/0.3)] px-4 py-3 space-y-1 animate-fade-up">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-[hsl(var(--primary)/0.12)] text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--glass-border)/0.3)]'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
          <button
            onClick={() => { setMobileOpen(false); toggleTheme(); }}
            className="flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--glass-border)/0.3)] transition-all duration-200 w-full"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </button>
          <button
            onClick={() => { setMobileOpen(false); handleLogout(); }}
            className="flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200 w-full"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}
