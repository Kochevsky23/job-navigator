import { NavLink } from 'react-router-dom';
import { Compass, LayoutDashboard, Table2, KanbanSquare, Settings } from 'lucide-react';

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/jobs', label: 'Jobs', icon: Table2 },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 glass border-b-0 border-t-0 border-x-0 border-b border-[hsl(var(--glass-border)/0.3)]">
      <div className="container flex h-14 items-center gap-6">
        <NavLink to="/dashboard" className="flex items-center gap-2.5 font-display text-lg font-bold group">
          <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center shadow-md">
            <Compass className="h-4.5 w-4.5 text-background" />
          </div>
          <span className="gradient-text">Job Compass</span>
        </NavLink>
        <div className="flex items-center gap-1 ml-auto">
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
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}