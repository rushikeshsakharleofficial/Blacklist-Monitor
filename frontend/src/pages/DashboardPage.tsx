import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Shield, AlertTriangle, CheckCircle, Clock, Globe, BarChart2, Mail, RefreshCw } from 'lucide-react';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

interface DashStats {
  total: number; listed: number; clean: number; pending: number;
  type_counts: Record<string, number>;
  top_countries: { country: string; count: number }[];
  score_buckets: number[];  // [0-20, 21-40, 41-60, 61-80, 81-100]
  avg_score: number | null;
  auth_stats: { total_domains: number; has_spf: number; has_dkim: number; has_dmarc: number; dmarc_enforced: number };
  recent_events: { address: string; at: string | null }[];
}

// ── Donut chart ─────────────────────────────────────────────────────────────
function DonutChart({ slices }: { slices: { value: number; color: string; label: string }[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!total) return <div className="text-text-muted text-sm text-center py-8">No data</div>;
  const R = 60, cx = 80, cy = 80, stroke = 22;
  let offset = -Math.PI / 2;
  const paths = slices.map(sl => {
    const angle = (sl.value / total) * 2 * Math.PI;
    const x1 = cx + R * Math.cos(offset);
    const y1 = cy + R * Math.sin(offset);
    const x2 = cx + R * Math.cos(offset + angle);
    const y2 = cy + R * Math.sin(offset + angle);
    const large = angle > Math.PI ? 1 : 0;
    const d = `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`;
    const path = { d, color: sl.color, label: sl.label, value: sl.value, angle, offset };
    offset += angle;
    return path;
  });
  return (
    <div className="flex items-center gap-4">
      <svg width="160" height="160" viewBox="0 0 160 160">
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth={stroke} strokeLinecap="butt" opacity={0.9} />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--text-base)">{total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="var(--text-sec)">assets</text>
      </svg>
      <div className="space-y-2">
        {slices.map((sl, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: sl.color }} />
            <span className="text-text-sec">{sl.label}</span>
            <span className="font-semibold text-text-base ml-auto pl-4">{sl.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Score histogram ──────────────────────────────────────────────────────────
function ScoreHistogram({ buckets }: { buckets: number[] }) {
  const labels = ['0–20', '21–40', '41–60', '61–80', '81–100'];
  const colors = ['var(--danger)', '#f97316', 'var(--warning)', '#84cc16', 'var(--success)'];
  const max = Math.max(...buckets, 1);
  const W = 260, H = 80;
  const bw = 36, gap = 12;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 30}`} style={{ display: 'block' }}>
      {buckets.map((v, i) => {
        const bh = Math.max(v ? 4 : 0, (v / max) * H);
        const x = i * (bw + gap) + 8;
        return (
          <g key={i}>
            <rect x={x} y={H - bh} width={bw} height={bh} fill={colors[i]} rx={3} opacity={0.85} />
            {v > 0 && <text x={x + bw / 2} y={H - bh - 4} textAnchor="middle" fontSize={9} fill="var(--text-sec)">{v}</text>}
            <text x={x + bw / 2} y={H + 14} textAnchor="middle" fontSize={8} fill="var(--text-muted)">{labels[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Horizontal bar ───────────────────────────────────────────────────────────
function HBar({ value, max, color = 'var(--accent)' }: { value: number; max: number; color?: string }) {
  const pct = max ? Math.max(value ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="flex-1 h-2 bg-subtle rounded overflow-hidden">
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s' }} />
    </div>
  );
}

// ── Auth coverage bar ────────────────────────────────────────────────────────
function AuthBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total ? Math.round(count / total * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-mono w-12 text-text-sec shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-subtle rounded overflow-hidden">
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.5s' }} />
      </div>
      <span className="text-xs text-text-muted w-10 text-right">{count}/{total}</span>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: any; color?: string }) {
  return (
    <div className="bg-surface border border-border-base rounded-xl p-4 flex items-start gap-3">
      <div className="p-2 rounded-lg" style={{ background: color ? `${color}18` : 'var(--subtle)' }}>
        <Icon size={16} style={{ color: color || 'var(--text-sec)' }} />
      </div>
      <div>
        <div className="text-2xl font-bold text-text-base">{value}</div>
        <div className="text-xs text-text-sec mt-0.5">{label}</div>
      </div>
    </div>
  );
}

function relTime(iso: string | null) {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/reports/dashboard-stats`);
      setStats(data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-sec text-sm">Loading dashboard…</div>
  );
  if (!stats) return (
    <div className="flex items-center justify-center h-64 text-danger text-sm">Failed to load</div>
  );

  const scoreColor = stats.avg_score == null ? 'var(--text-sec)' : stats.avg_score >= 80 ? 'var(--success)' : stats.avg_score >= 50 ? 'var(--warning)' : 'var(--danger)';
  const maxCountry = Math.max(...stats.top_countries.map(c => c.count), 1);
  const typeEntries = Object.entries(stats.type_counts).sort((a, b) => b[1] - a[1]);
  const maxType = Math.max(...typeEntries.map(e => e[1]), 1);
  const typeColors: Record<string, string> = { ip: 'var(--accent)', domain: 'var(--success)', subnet: 'var(--warning)' };

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-base">Dashboard</h1>
          <p className="text-sm text-text-sec mt-0.5">Infrastructure reputation overview</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <StatCard label="Total Assets" value={stats.total} icon={Shield} />
        <StatCard label="Listed" value={stats.listed} icon={AlertTriangle} color={stats.listed > 0 ? 'var(--danger)' : undefined} />
        <StatCard label="Clean" value={stats.clean} icon={CheckCircle} color="var(--success)" />
        <StatCard label="Pending" value={stats.pending} icon={Clock} color="var(--warning)" />
        <StatCard label="Avg Score" value={stats.avg_score != null ? `${stats.avg_score}/100` : '—'} icon={BarChart2} color={scoreColor} />
      </div>

      {/* Row 2: Donut + Score histogram */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Status donut */}
        <div className="bg-surface border border-border-base rounded-xl p-5">
          <h2 className="text-sm font-semibold text-text-base mb-4">Status Distribution</h2>
          <DonutChart slices={[
            { value: stats.listed, color: 'var(--danger)', label: 'Listed' },
            { value: stats.clean, color: 'var(--success)', label: 'Clean' },
            { value: stats.pending, color: 'var(--warning)', label: 'Pending' },
          ]} />
        </div>

        {/* Score histogram */}
        <div className="bg-surface border border-border-base rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-text-base">Score Distribution</h2>
            {stats.avg_score != null && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: `${scoreColor}18`, color: scoreColor }}>
                avg {stats.avg_score}/100
              </span>
            )}
          </div>
          <ScoreHistogram buckets={stats.score_buckets} />
          <div className="flex justify-between text-[9px] text-text-muted mt-1 px-1">
            <span>Poor</span><span>Fair</span><span>Good</span><span>Great</span><span>Excellent</span>
          </div>
        </div>
      </div>

      {/* Row 3: Type breakdown + Countries */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Asset types */}
        <div className="bg-surface border border-border-base rounded-xl p-5">
          <h2 className="text-sm font-semibold text-text-base mb-4">Asset Types</h2>
          <div className="space-y-3">
            {typeEntries.map(([type, count]) => (
              <div key={type} className="flex items-center gap-3">
                <span className="text-xs uppercase font-medium text-text-sec w-14 shrink-0">{type}</span>
                <HBar value={count} max={maxType} color={typeColors[type] || 'var(--accent)'} />
                <span className="text-sm font-semibold text-text-base w-8 text-right">{count}</span>
              </div>
            ))}
            {typeEntries.length === 0 && <p className="text-text-muted text-sm">No assets yet</p>}
          </div>
        </div>

        {/* Top countries */}
        <div className="bg-surface border border-border-base rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Globe size={14} className="text-text-sec" />
            <h2 className="text-sm font-semibold text-text-base">Top Countries (IPs)</h2>
          </div>
          <div className="space-y-3">
            {stats.top_countries.map(({ country, count }) => (
              <div key={country} className="flex items-center gap-3">
                <span className="text-xs font-mono font-medium text-text-sec w-8 shrink-0">{country}</span>
                <HBar value={count} max={maxCountry} />
                <span className="text-sm font-semibold text-text-base w-8 text-right">{count}</span>
              </div>
            ))}
            {stats.top_countries.length === 0 && <p className="text-text-muted text-sm">No geo data yet</p>}
          </div>
        </div>
      </div>

      {/* Row 4: Domain auth coverage + Recent events */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Domain auth */}
        <div className="bg-surface border border-border-base rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Mail size={14} className="text-text-sec" />
            <h2 className="text-sm font-semibold text-text-base">Domain Auth Coverage</h2>
            <span className="ml-auto text-xs text-text-muted">{stats.auth_stats.total_domains} domains</span>
          </div>
          {stats.auth_stats.total_domains === 0 ? (
            <p className="text-text-muted text-sm">No domains monitored</p>
          ) : (
            <div className="space-y-3">
              <AuthBar label="SPF" count={stats.auth_stats.has_spf} total={stats.auth_stats.total_domains} color="var(--accent)" />
              <AuthBar label="DKIM" count={stats.auth_stats.has_dkim} total={stats.auth_stats.total_domains} color="var(--success)" />
              <AuthBar label="DMARC" count={stats.auth_stats.has_dmarc} total={stats.auth_stats.total_domains} color="var(--warning)" />
              <AuthBar label="p=reject" count={stats.auth_stats.dmarc_enforced} total={stats.auth_stats.total_domains} color="var(--danger)" />
            </div>
          )}
        </div>

        {/* Recent listing events */}
        <div className="bg-surface border border-border-base rounded-xl p-5">
          <h2 className="text-sm font-semibold text-text-base mb-4">Recent Listing Events <span className="text-text-muted font-normal">(30d)</span></h2>
          {stats.recent_events.length === 0 ? (
            <p className="text-text-muted text-sm">No listing events — all clean</p>
          ) : (
            <div className="space-y-2">
              {stats.recent_events.map((e, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b border-border-base last:border-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" />
                  <span className="text-sm font-mono text-text-base flex-1 truncate">{e.address}</span>
                  <span className="text-xs text-text-muted shrink-0">{relTime(e.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
