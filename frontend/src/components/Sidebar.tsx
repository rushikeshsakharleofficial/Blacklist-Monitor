import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutGrid, Shield, Bell, BarChart2, Settings, LogOut, AlertCircle, Network, Users, ShieldCheck, History, Moon, Sun, X } from 'lucide-react';

interface SidebarProps {
  email: string;
  name: string;
  onLogout: () => void;
  permissions?: string[];
  darkMode: boolean;
  onToggleDark: () => void;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

const baseMenuItems = [
  { icon: LayoutGrid, label: 'Dashboard', to: '/dashboard' },
  { icon: Shield,      label: 'Monitored Assets', to: '/monitored-assets' },
  { icon: AlertCircle, label: 'Problems/Listings', to: '/problems' },
  { icon: Network,     label: 'Subnet Scan', to: '/subnet-scan' },
  { icon: History,     label: 'Scan Sessions', to: '/scan-sessions' },
  { icon: Bell,        label: 'Alerts', to: '/alerts' },
  { icon: BarChart2,   label: 'Reports', to: '/reports' },
  { icon: Settings,    label: 'Settings', to: '/settings' },
];

const adminMenuItems = [
  { icon: Users,       label: 'Users', to: '/users', perm: 'users:read' },
  { icon: ShieldCheck, label: 'Roles', to: '/roles', perm: 'users:read' },
];

const Sidebar: React.FC<SidebarProps> = ({
  email, name, onLogout, permissions = [],
  darkMode, onToggleDark, onMobileClose,
}) => {
  const adminItems = adminMenuItems.filter(item => permissions.includes(item.perm));
  const initial = name ? name[0].toUpperCase() : email ? email[0].toUpperCase() : '?';
  const displayName = name || email.split('@')[0] || 'User';

  return (
    <div
      className="w-[232px] h-full flex flex-col shrink-0"
      style={{ background: 'var(--sidebar-bg)', borderRight: '1px solid var(--sidebar-border)' }}
    >
      {/* Logo + dark mode toggle */}
      <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
            <Shield size={14} className="text-white" />
          </div>
          <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Guardly</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleDark}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'var(--sidebar-text)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--sidebar-hover-bg)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {darkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          {onMobileClose && (
            <button
              onClick={onMobileClose}
              className="p-1.5 rounded-md md:hidden transition-colors"
              style={{ color: 'var(--sidebar-text)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--sidebar-hover-bg)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 overflow-y-auto px-2">
        {baseMenuItems.map(({ icon: Icon, label, to }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onMobileClose}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors mb-0.5 ${
                isActive ? 'font-semibold' : 'font-normal'
              }`
            }
            style={({ isActive }) => ({
              background: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
              color: isActive ? 'var(--sidebar-active-text)' : 'var(--sidebar-text)',
            })}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              if (!el.classList.contains('font-semibold')) {
                el.style.background = 'var(--sidebar-hover-bg)';
              }
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              if (!el.classList.contains('font-semibold')) {
                el.style.background = 'transparent';
              }
            }}
          >
            <Icon size={16} />
            <span>{label}</span>
          </NavLink>
        ))}

        {adminItems.length > 0 && (
          <>
            <div className="px-3 pt-4 pb-1.5">
              <span
                className="text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'var(--text-muted)' }}
              >
                Administration
              </span>
            </div>
            {adminItems.map(({ icon: Icon, label, to }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onMobileClose}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors mb-0.5 ${
                    isActive ? 'font-semibold' : 'font-normal'
                  }`
                }
                style={({ isActive }) => ({
                  background: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
                  color: isActive ? 'var(--sidebar-active-text)' : 'var(--sidebar-text)',
                })}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  if (!el.classList.contains('font-semibold')) {
                    el.style.background = 'var(--sidebar-hover-bg)';
                  }
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  if (!el.classList.contains('font-semibold')) {
                    el.style.background = 'transparent';
                  }
                }}
              >
                <Icon size={16} />
                <span>{label}</span>
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User area */}
      <div className="px-3 py-3" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
            style={{ background: 'var(--accent)' }}
          >
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {displayName}
            </div>
            <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
              {email}
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Logout"
            className="p-1.5 rounded-md transition-colors shrink-0"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'var(--sidebar-hover-bg)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
