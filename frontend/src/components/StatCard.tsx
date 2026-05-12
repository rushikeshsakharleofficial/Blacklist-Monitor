import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendType?: 'positive' | 'negative' | 'neutral';
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon: Icon, trend, trendType = 'neutral' }) => {
  const trendColors = {
    positive: 'bg-emerald-50 text-emerald-600',
    negative: 'bg-rose-50 text-rose-600',
    neutral: 'bg-slate-50 text-slate-600',
  };

  return (
    <div className="bg-white border border-border rounded-2xl p-6 shadow-soft hover:shadow-lg transition-shadow duration-300">
      <div className="flex items-center justify-between mb-4">
        <div className="p-3 bg-orange-50 rounded-xl text-primary">
          <Icon size={22} />
        </div>
        {trend && (
          <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-lg font-bold ${trendColors[trendType]}`}>
            {trend}
          </span>
        )}
      </div>
      <div>
        <h3 className="text-3xl font-bold tracking-tight text-foreground">{value}</h3>
        <p className="text-sm font-medium text-muted-foreground mt-1">{label}</p>
      </div>
    </div>
  );
};

export default StatCard;
