import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutGrid, Shield, Bell, BarChart2, Settings, LogOut, AlertCircle, Network } from 'lucide-react';

interface SidebarProps {
  email: string;
  name: string;
  onLogout: () => void;
}

const menuItems = [
  { icon: LayoutGrid, label: 'Dashboard', to: '/dashboard' },
  { icon: Shield,      label: 'Monitored Assets', to: '/monitored-assets' },
  { icon: AlertCircle, label: 'Problems/Listings', to: '/problems' },
  { icon: Network,     label: 'Subnet Scan', to: '/subnet-scan' },
  { icon: Bell,        label: 'Alerts', to: '/alerts' },
  { icon: BarChart2,   label: 'Reports', to: '/reports' },
  { icon: Settings,    label: 'Settings', to: '/settings' },
];

const Sidebar: React.FC<SidebarProps> = ({ email, name, onLogout }) => (
  <div className="w-[220px] h-full bg-nav-bg flex flex-col border-r border-[#2d4057] shrink-0">
    <div className="px-4 py-3 border-b border-[#2d4057]">
      <div className="flex items-center gap-2">
        <Shield size={16} className="text-[#336699]" />
        <span className="text-white font-bold text-xs tracking-widest uppercase">BlacklistTrailer</span>
      </div>
      <div className="text-[#6a8099] text-[10px] mt-0.5">Blacklist Monitor v1.0</div>
    </div>

    <nav className="flex-1 py-2">
      {menuItems.map(({ icon: Icon, label, to }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-4 py-2 text-xs border-l-2 transition-colors ${
              isActive
                ? 'bg-nav-active border-primary text-white font-semibold'
                : 'border-transparent text-nav-text hover:bg-[#243649] hover:text-white'
            }`
          }
        >
          <Icon size={14} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>

    <div className="border-t border-[#2d4057] p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded bg-[#336699] flex items-center justify-center text-white text-xs font-bold shrink-0">
            {name ? name[0].toUpperCase() : email ? email[0].toUpperCase() : '?'}
          </div>
          <div className="min-w-0">
            <div className="text-nav-text text-[11px] font-medium truncate">{name || email.split('@')[0] || 'User'}</div>
            <div className="text-[#4a6a84] text-[10px]">API Access</div>
          </div>
        </div>
        <button onClick={onLogout} title="Logout" className="text-[#4a6a84] hover:text-red-400 p-1 rounded">
          <LogOut size={13} />
        </button>
      </div>
    </div>
  </div>
);

export default Sidebar;
