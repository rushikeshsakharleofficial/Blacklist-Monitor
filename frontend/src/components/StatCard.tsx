import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  accentColor?: string;
  valueColor?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon: Icon, accentColor = '#336699', valueColor }) => (
  <div className="bg-white border border-panel-border" style={{ borderLeft: `4px solid ${accentColor}` }}>
    <div className="px-4 py-3 flex items-center justify-between">
      <div>
        <div className="text-[10px] uppercase font-bold tracking-wider text-muted">{label}</div>
        <div className="text-2xl font-bold mt-1 font-mono" style={{ color: valueColor || '#2c3e50' }}>{value}</div>
      </div>
      <Icon size={24} style={{ color: accentColor }} className="opacity-30" />
    </div>
  </div>
);

export default StatCard;
