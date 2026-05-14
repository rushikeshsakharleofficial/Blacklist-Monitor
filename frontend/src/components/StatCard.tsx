import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  // variant drives icon/value color; accentColor kept for backward compat but ignored
  variant?: 'default' | 'danger' | 'success' | 'warning';
  accentColor?: string;
  valueColor?: string;
}

const variantStyles: Record<string, { iconColor: string; valueColor: string }> = {
  default: { iconColor: 'var(--accent)', valueColor: 'var(--text-primary)' },
  danger:  { iconColor: 'var(--danger)', valueColor: 'var(--danger)' },
  success: { iconColor: 'var(--success)', valueColor: 'var(--success)' },
  warning: { iconColor: 'var(--warning)', valueColor: 'var(--warning)' },
};

const StatCard: React.FC<StatCardProps> = ({ label, value, icon: Icon, variant = 'default' }) => {
  const styles = variantStyles[variant] ?? variantStyles.default;

  return (
    <div className="bg-surface border border-border-base rounded-xl p-4 flex items-start justify-between">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-text-sec mb-1">{label}</div>
        <div className="text-2xl font-bold font-mono" style={{ color: styles.valueColor }}>{value}</div>
      </div>
      <Icon size={20} style={{ color: styles.iconColor }} className="opacity-60 mt-0.5 shrink-0" />
    </div>
  );
};

export default StatCard;
