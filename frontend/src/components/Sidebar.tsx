import React from 'react';
import { LayoutDashboard, Shield, Settings, AlertTriangle, BarChart2 } from 'lucide-react';

const Sidebar = () => {
  const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', active: true },
    { icon: Shield, label: 'Monitored Assets', active: false },
    { icon: AlertTriangle, label: 'Alerts', active: false },
    { icon: BarChart2, label: 'Reports', active: false },
    { icon: Settings, label: 'Settings', active: false },
  ];

  return (
    <div className="w-64 h-screen bg-muted border-r border-border flex flex-col">
      <div className="p-8 flex items-center gap-3">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white shadow-lg shadow-primary/20">
          <Shield size={24} />
        </div>
        <span className="text-xl font-bold tracking-tight text-foreground">Guardly</span>
      </div>
      
      <nav className="flex-1 px-4 py-4 space-y-1">
        {menuItems.map((item, index) => (
          <button
            key={index}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
              item.active 
                ? 'bg-white text-primary shadow-soft font-semibold' 
                : 'text-muted-foreground hover:bg-white/50 hover:text-foreground'
            }`}
          >
            <item.icon size={20} />
            <span className="text-sm">{item.label}</span>
          </button>
        ))}
      </nav>
      
      <div className="p-6 border-t border-border mt-auto">
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-primary font-bold shadow-inner">
            JD
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">John Doe</span>
            <span className="text-xs text-muted-foreground">Premium Plan</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
