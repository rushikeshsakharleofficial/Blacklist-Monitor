import React from 'react';
import { BarChart2, TrendingUp, Calendar } from 'lucide-react';

export default function ReportsPage() {
  return (
    <div>
      <header className="flex justify-between items-center mb-4 border-b border-panel-border pb-2">
        <div>
          <h1 className="text-base font-bold text-foreground uppercase tracking-wide">Reports &amp; Analytics</h1>
          <p className="text-muted text-[11px] mt-0.5">Historical trends and blacklist audit reports</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {[
          { label: 'Total Checks (30d)', value: '—', icon: BarChart2, accent: '#336699' },
          { label: 'Avg. Checks / Day', value: '—', icon: TrendingUp, accent: '#27ae60' },
          { label: 'Last Report', value: '—', icon: Calendar, accent: '#f39c12' },
        ].map(({ label, value, icon: Icon, accent }) => (
          <div key={label} className="bg-white border border-panel-border" style={{ borderLeft: `4px solid ${accent}` }}>
            <div className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase font-bold tracking-wider text-muted">{label}</div>
                <div className="text-2xl font-bold mt-1 font-mono text-foreground">{value}</div>
              </div>
              <Icon size={24} style={{ color: accent }} className="opacity-30" />
            </div>
          </div>
        ))}
      </div>

      <div className="border border-panel-border">
        <div className="px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
          <span className="text-white text-[11px] font-bold uppercase tracking-wider">Reporting Engine</span>
        </div>
        <div className="bg-white p-8 text-center">
          <BarChart2 size={28} className="text-muted mx-auto mb-3 opacity-40" />
          <p className="text-xs font-bold text-foreground mb-1 uppercase tracking-wide">Planned Feature</p>
          <p className="text-xs text-muted max-w-md mx-auto">
            Exportable PDF/CSV reports, historical trend charts, and scheduled report delivery will be available in a future release.
          </p>
        </div>
      </div>
    </div>
  );
}
