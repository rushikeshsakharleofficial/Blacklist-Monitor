import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Download, RefreshCw, Shield, AlertTriangle, CheckCircle, Activity } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const STORAGE_KEY = 'api_key';

interface Summary {
  total_targets: number;
  listed_now: number;
  clean_now: number;
  pct_listed: number;
  checks_30d: number;
  avg_checks_per_day: number;
  listing_events_30d: number;
}

interface SubnetRow { subnet: string; listed: number; }
interface DnsblRow { zone: string; hits: number; }
interface DailyRow { day: string; checks: number; listed: number; }
interface EventRow { address: string; from_status: string; to_status: string; channels: string | null; at: string | null; }

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function HBar({ value, max, color = 'var(--accent)', height = 16 }: { value: number; max: number; color?: string; height?: number }) {
  const pct = max ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex-1 bg-subtle border border-border-base overflow-hidden rounded" style={{ height }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s' }} />
    </div>
  );
}

const DNSBL_COLORS = [
  'var(--danger)', '#f97316', 'var(--warning)', '#84cc16', 'var(--accent)',
  '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f59e0b',
];

function DnsblPieChart({ data }: { data: { zone: string; hits: number }[] }) {
  if (!data.length) return <div className="text-text-sec text-sm text-center py-6">No data yet — checks may be running</div>;
  const total = data.reduce((s, d) => s + d.hits, 0);
  const R = 70, cx = 90, cy = 90, stroke = 28;
  let offset = -Math.PI / 2;
  const slices = data.slice(0, 10).map((d, i) => {
    const angle = (d.hits / total) * 2 * Math.PI;
    const x1 = cx + R * Math.cos(offset);
    const y1 = cy + R * Math.sin(offset);
    // For 100% (single item), use two arcs to form a full circle
    const isFull = angle >= 2 * Math.PI - 0.001;
    const x2 = isFull ? cx + R * Math.cos(offset + Math.PI) : cx + R * Math.cos(offset + angle);
    const y2 = isFull ? cy + R * Math.sin(offset + Math.PI) : cy + R * Math.sin(offset + angle);
    const large = angle > Math.PI ? 1 : 0;
    const pathD = isFull
      ? `M ${x1} ${y1} A ${R} ${R} 0 1 1 ${x2} ${y2} A ${R} ${R} 0 1 1 ${x1} ${y1}`
      : `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`;
    const path = { d: pathD, color: DNSBL_COLORS[i % DNSBL_COLORS.length], zone: d.zone, hits: d.hits, pct: Math.round(d.hits / total * 100) };
    offset += angle;
    return path;
  });
  return (
    <div className="flex flex-col sm:flex-row items-start gap-6 p-4">
      <svg width="180" height="180" viewBox="0 0 180 180" className="flex-shrink-0">
        {slices.map((s, i) => (
          <path key={i} d={s.d} fill="none" stroke={s.color} strokeWidth={stroke} strokeLinecap="butt" opacity={0.9}>
            <title>{s.zone}: {s.hits} hits ({s.pct}%)</title>
          </path>
        ))}
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--text-base)">{total}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="10" fill="var(--text-sec)">total hits</text>
      </svg>
      <div className="flex-1 space-y-2 min-w-0">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="font-mono text-text-base truncate flex-1 text-xs">{s.zone}</span>
            <span className="text-xs text-text-muted w-6 text-right">{s.pct}%</span>
            <span className="font-semibold text-danger text-xs w-6 text-right">{s.hits}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DailyChart({ data }: { data: DailyRow[] }) {
  if (!data.length) return <div className="text-text-sec text-sm text-center py-6">No check data yet</div>;
  const maxChecks = Math.max(...data.map(d => d.checks), 1);
  const H = 80;
  const BAR_W = Math.min(40, Math.max(8, Math.floor(680 / data.length) - 4));
  const GAP = Math.max(2, Math.floor(680 / data.length) - BAR_W);
  const W = Math.max(240, data.length * (BAR_W + GAP) + 60);
  const x = (i: number) => 40 + i * (BAR_W + GAP) + (GAP / 2);
  return (
    <svg width="100%" height={H + 20} viewBox={`0 0 ${W} ${H + 20}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      {[0, 0.5, 1].map(f => (
        <line key={f} x1={40} y1={H * (1 - f)} x2={W} y2={H * (1 - f)} stroke="var(--border)" strokeWidth={1} />
      ))}
      {data.map((d, i) => {
        const barH = Math.max(2, (d.checks / maxChecks) * H);
        const listedH = Math.max(0, (d.listed / maxChecks) * H);
        return (
          <g key={d.day}>
            <rect x={x(i)} y={H - barH} width={BAR_W} height={barH} fill="var(--accent)" opacity={0.7} rx={1} />
            {d.listed > 0 && <rect x={x(i)} y={H - listedH} width={BAR_W} height={listedH} fill="var(--danger)" opacity={0.9} rx={1} />}
          </g>
        );
      })}
      {data.filter((_, i) => i % 5 === 0 || i === data.length - 1).map((d) => {
        const i = data.indexOf(d);
        return (
          <text key={d.day} x={x(i) + BAR_W / 2} y={H + 16} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
            {d.day.slice(5)}
          </text>
        );
      })}
    </svg>
  );
}

export default function ReportsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [subnets, setSubnets] = useState<SubnetRow[]>([]);
  const [dnsbls, setDnsbls] = useState<DnsblRow[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const apiKey = localStorage.getItem(STORAGE_KEY) || '';
  const headers = { 'X-API-Key': apiKey };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, sub, dns, day, ev] = await Promise.all([
        axios.get(`${API_BASE_URL}/reports/summary`, { headers }),
        axios.get(`${API_BASE_URL}/reports/subnet-breakdown`, { headers }),
        axios.get(`${API_BASE_URL}/reports/dnsbl-breakdown`, { headers }),
        axios.get(`${API_BASE_URL}/reports/daily-checks`, { headers }),
        axios.get(`${API_BASE_URL}/reports/listing-events`, { headers }),
      ]);
      setSummary(s.data);
      setSubnets(sub.data);
      setDnsbls(dns.data);
      setDaily(day.data);
      setEvents(ev.data);
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const downloadCSV = async () => {
    setDownloading(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/reports/export-csv`, { headers, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = 'blacklisted_ips.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch {}
    finally { setDownloading(false); }
  };

  const maxSubnet = subnets[0]?.listed || 1;

  return (
    <div>
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-base">Reports &amp; Analytics</h1>
          <p className="text-sm text-text-sec mt-0.5">30-day trends, DNSBL breakdown, listing events</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors flex items-center gap-1.5 disabled:opacity-60">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={downloadCSV} disabled={downloading || !summary?.listed_now}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-success text-white hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-60">
            <Download size={14} /> Export Listed IPs CSV
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-bg text-danger px-4 py-3 mb-4 text-sm">{error}</div>
      )}

      {/* KPI Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Total Monitored', value: summary.total_targets.toLocaleString(), icon: Shield, color: 'var(--accent)' },
            { label: 'Listed Now', value: summary.listed_now.toLocaleString(), icon: AlertTriangle, color: 'var(--danger)' },
            { label: 'Clean Now', value: summary.clean_now.toLocaleString(), icon: CheckCircle, color: 'var(--success)' },
            { label: 'Checks (30d)', value: summary.checks_30d.toLocaleString(), icon: Activity, color: 'var(--warning)' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-surface border border-border-base rounded-xl p-4 flex items-start justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-text-sec mb-1">{label}</div>
                <div className="text-2xl font-bold font-mono text-text-base">{value}</div>
              </div>
              <Icon size={20} style={{ color }} className="opacity-60 mt-0.5 shrink-0" />
            </div>
          ))}
        </div>
      )}

      {/* Secondary KPIs */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {[
            { label: '% Listed', value: `${summary.pct_listed}%`, sub: 'of all monitored IPs' },
            { label: 'Avg Checks / Day', value: summary.avg_checks_per_day.toLocaleString(), sub: 'last 30 days' },
            { label: 'Listing Events (30d)', value: summary.listing_events_30d.toLocaleString(), sub: 'clean → listed transitions' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-surface border border-border-base rounded-xl px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-text-sec">{label}</div>
              <div className="text-xl font-bold font-mono text-text-base mt-0.5">{value}</div>
              <div className="text-xs text-text-muted mt-0.5">{sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        {/* Daily checks chart */}
        <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border-base flex items-center justify-between">
            <span className="text-sm font-semibold text-text-base">Daily Check Activity (30d)</span>
            <div className="flex items-center gap-3 text-xs text-text-sec">
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: 'var(--accent)' }}></span> Total checks</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: 'var(--danger)' }}></span> Listed</span>
            </div>
          </div>
          <div className="px-3 pt-2 pb-1">
            {loading ? <div className="text-text-sec text-sm text-center py-4">Loading…</div> : <DailyChart data={daily} />}
          </div>
        </div>

        {/* Top DNSBL zones */}
        <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border-base">
            <span className="text-sm font-semibold text-text-base">Top DNSBL Zones</span>
          </div>
          <div>
            {loading ? <div className="text-text-sec text-sm text-center py-6">Loading…</div>
              : <DnsblPieChart data={dnsbls} />}
          </div>
        </div>
      </div>

      {/* Subnet breakdown */}
      <div className="bg-surface border border-border-base rounded-xl overflow-hidden mb-3">
        <div className="px-4 py-3 border-b border-border-base flex items-center justify-between">
          <span className="text-sm font-semibold text-text-base">Listed IPs by Subnet (/24)</span>
          <span className="text-text-sec text-xs">Top {Math.min(subnets.length, 50)}</span>
        </div>
        <div className="divide-y divide-border-base">
          {loading ? <div className="text-text-sec text-sm text-center py-6">Loading…</div>
            : subnets.length === 0 ? <div className="text-text-sec text-sm text-center py-6">No listed IPs found</div>
            : subnets.slice(0, 25).map((s, i) => (
            <div key={s.subnet} className="flex items-center gap-3 px-4 py-1.5">
              <span className="text-xs font-semibold text-text-sec w-5 text-right">{i + 1}</span>
              <span className="font-mono text-sm font-semibold text-text-base w-36 flex-shrink-0">{s.subnet}</span>
              <HBar value={s.listed} max={maxSubnet} color="var(--accent)" height={14} />
              <span className="font-mono text-sm font-semibold text-text-base w-10 text-right">{s.listed}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Listing events */}
      <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-base">
          <span className="text-sm font-semibold text-text-base">Recent Listing Events</span>
          <span className="text-text-sec text-xs ml-2">last 100 clean → listed transitions</span>
        </div>
        {loading ? <div className="text-text-sec text-sm text-center py-6">Loading…</div>
          : events.length === 0 ? <div className="text-text-sec text-sm text-center py-6">No listing events recorded</div>
          : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-subtle">
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left">IP / Domain</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-20">From</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-20">To</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-24">Notified</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-36">Detected At</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i} className="border-b border-border-base hover:bg-subtle transition-colors">
                  <td className="px-3 py-2.5 font-mono font-semibold text-text-base">{e.address}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-success-bg text-success uppercase">{e.from_status}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-danger-bg text-danger uppercase">{e.to_status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-text-sec text-xs">
                    {e.channels ? (() => { try { return JSON.parse(e.channels).join(', '); } catch { return e.channels; } })() : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-text-sec text-xs">{fmtDate(e.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
