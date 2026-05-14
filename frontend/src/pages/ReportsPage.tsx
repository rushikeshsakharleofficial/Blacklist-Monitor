import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { BarChart2, Download, RefreshCw, TrendingUp, Shield, AlertTriangle, CheckCircle, Activity } from 'lucide-react';

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

// Pure-SVG horizontal bar
function HBar({ value, max, color = '#336699', height = 16 }: { value: number; max: number; color?: string; height?: number }) {
  const pct = max ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex-1 bg-row-alt border border-panel-border overflow-hidden" style={{ height, borderRadius: 2 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s' }} />
    </div>
  );
}

// SVG vertical bar chart (30-day daily)
function DailyChart({ data }: { data: DailyRow[] }) {
  if (!data.length) return <div className="text-muted text-xs text-center py-6">No check data yet</div>;
  const maxChecks = Math.max(...data.map(d => d.checks), 1);
  const W = 720, H = 100, BAR_W = Math.max(4, Math.floor((W - 40) / data.length) - 2);
  const x = (i: number) => 40 + i * ((W - 40) / data.length) + (((W - 40) / data.length) - BAR_W) / 2;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 24}`} style={{ display: 'block' }}>
      {/* Y gridlines */}
      {[0, 0.5, 1].map(f => (
        <line key={f} x1={40} y1={H * (1 - f)} x2={W} y2={H * (1 - f)} stroke="#eee" strokeWidth={1} />
      ))}
      {/* Bars */}
      {data.map((d, i) => {
        const barH = Math.max(2, (d.checks / maxChecks) * H);
        const listedH = Math.max(0, (d.listed / maxChecks) * H);
        return (
          <g key={d.day}>
            <rect x={x(i)} y={H - barH} width={BAR_W} height={barH} fill="#336699" opacity={0.7} rx={1} />
            {d.listed > 0 && <rect x={x(i)} y={H - listedH} width={BAR_W} height={listedH} fill="#e74c3c" opacity={0.9} rx={1} />}
          </g>
        );
      })}
      {/* X axis date labels (every 5 days) */}
      {data.filter((_, i) => i % 5 === 0 || i === data.length - 1).map((d) => {
        const i = data.indexOf(d);
        return (
          <text key={d.day} x={x(i) + BAR_W / 2} y={H + 16} textAnchor="middle" fontSize={9} fill="#888">
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
      const res = await axios.get(`${API_BASE_URL}/reports/export-csv`, {
        headers, responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = 'blacklisted_ips.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch {}
    finally { setDownloading(false); }
  };

  const maxSubnet = subnets[0]?.listed || 1;
  const maxDnsbl = dnsbls[0]?.hits || 1;

  return (
    <div>
      <header className="flex justify-between items-center mb-4 border-b border-panel-border pb-2">
        <div>
          <h1 className="text-base font-bold text-foreground uppercase tracking-wide">Reports & Analytics</h1>
          <p className="text-muted text-[11px] mt-0.5">30-day trends, DNSBL breakdown, listing events</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-panel-border bg-white hover:bg-row-alt disabled:opacity-60"
            style={{ borderRadius: 2 }}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={downloadCSV} disabled={downloading || !summary?.listed_now}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white border border-[#1a6b3c] disabled:opacity-60"
            style={{ background: '#27ae60', borderRadius: 2 }}>
            <Download size={12} /> Export Listed IPs CSV
          </button>
        </div>
      </header>

      {error && <div className="border border-danger bg-danger-bg text-danger px-4 py-2 mb-4 text-xs">{error}</div>}

      {/* KPI Cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { label: 'Total Monitored', value: summary.total_targets.toLocaleString(), icon: Shield, color: '#336699' },
            { label: 'Listed Now', value: summary.listed_now.toLocaleString(), icon: AlertTriangle, color: '#e74c3c' },
            { label: 'Clean Now', value: summary.clean_now.toLocaleString(), icon: CheckCircle, color: '#27ae60' },
            { label: 'Checks (30d)', value: summary.checks_30d.toLocaleString(), icon: Activity, color: '#f39c12' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white border border-panel-border" style={{ borderLeft: `4px solid ${color}` }}>
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase font-bold tracking-wider text-muted">{label}</div>
                  <div className="text-2xl font-bold mt-0.5 font-mono text-foreground">{value}</div>
                </div>
                <Icon size={22} style={{ color }} className="opacity-30" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Secondary KPIs */}
      {summary && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: '% Listed', value: `${summary.pct_listed}%`, sub: 'of all monitored IPs' },
            { label: 'Avg Checks / Day', value: summary.avg_checks_per_day.toLocaleString(), sub: 'last 30 days' },
            { label: 'Listing Events (30d)', value: summary.listing_events_30d.toLocaleString(), sub: 'clean → listed transitions' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-white border border-panel-border px-4 py-3">
              <div className="text-[10px] uppercase font-bold tracking-wider text-muted">{label}</div>
              <div className="text-xl font-bold font-mono text-foreground mt-0.5">{value}</div>
              <div className="text-[10px] text-muted mt-0.5">{sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Daily checks chart */}
        <div className="border border-panel-border">
          <div className="px-3 py-2 border-b border-panel-border flex items-center justify-between" style={{ background: '#2c3e50' }}>
            <span className="text-white text-[11px] font-bold uppercase tracking-wider">Daily Check Activity (30d)</span>
            <div className="flex items-center gap-3 text-[10px] text-[#8ab4c8]">
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#336699' }}></span> Total checks</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#e74c3c' }}></span> Listed</span>
            </div>
          </div>
          <div className="bg-white px-3 py-3">
            {loading ? <div className="text-muted text-xs text-center py-6">Loading…</div> : <DailyChart data={daily} />}
          </div>
        </div>

        {/* Top DNSBL zones */}
        <div className="border border-panel-border">
          <div className="px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
            <span className="text-white text-[11px] font-bold uppercase tracking-wider">Top DNSBL Zones</span>
          </div>
          <div className="bg-white divide-y divide-panel-border">
            {loading ? <div className="text-muted text-xs text-center py-6">Loading…</div>
              : dnsbls.length === 0 ? <div className="text-muted text-xs text-center py-6">No data yet — checks may be running</div>
              : dnsbls.map((d, i) => (
              <div key={d.zone} className="flex items-center gap-3 px-3 py-2">
                <span className="text-[11px] font-bold text-muted w-5 text-right">{i + 1}</span>
                <span className="font-mono text-[11px] text-foreground w-48 truncate flex-shrink-0">{d.zone}</span>
                <HBar value={d.hits} max={maxDnsbl} color="#e74c3c" />
                <span className="font-mono text-[11px] font-bold text-danger w-12 text-right">{d.hits.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Subnet breakdown */}
      <div className="border border-panel-border mb-3">
        <div className="px-3 py-2 border-b border-panel-border flex items-center justify-between" style={{ background: '#2c3e50' }}>
          <span className="text-white text-[11px] font-bold uppercase tracking-wider">Listed IPs by Subnet (/24)</span>
          <span className="text-[#8ab4c8] text-[10px]">Top {Math.min(subnets.length, 50)}</span>
        </div>
        <div className="bg-white divide-y divide-panel-border">
          {loading ? <div className="text-muted text-xs text-center py-6">Loading…</div>
            : subnets.length === 0 ? <div className="text-muted text-xs text-center py-6">No listed IPs found</div>
            : subnets.slice(0, 25).map((s, i) => (
            <div key={s.subnet} className="flex items-center gap-3 px-3 py-1.5">
              <span className="text-[11px] font-bold text-muted w-5 text-right">{i + 1}</span>
              <span className="font-mono text-[11px] font-bold text-foreground w-36 flex-shrink-0">{s.subnet}</span>
              <HBar value={s.listed} max={maxSubnet} color="#336699" height={14} />
              <span className="font-mono text-[11px] font-bold text-foreground w-10 text-right">{s.listed}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Listing events */}
      <div className="border border-panel-border">
        <div className="px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
          <span className="text-white text-[11px] font-bold uppercase tracking-wider">Recent Listing Events</span>
          <span className="text-[#8ab4c8] text-[10px] ml-2">last 100 clean → listed transitions</span>
        </div>
        {loading ? <div className="text-muted text-xs text-center py-6">Loading…</div>
          : events.length === 0 ? <div className="bg-white text-muted text-xs text-center py-6">No listing events recorded</div>
          : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ background: '#2c3e50', color: 'white' }}>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166]">IP / Domain</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-20">From</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-20">To</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-24">Notified</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-36">Detected At</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}>
                  <td className="px-3 py-1.5 border border-panel-border font-mono font-bold text-foreground">{e.address}</td>
                  <td className="px-3 py-1.5 border border-panel-border">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 text-white uppercase" style={{ background: '#27ae60', borderRadius: 2 }}>{e.from_status}</span>
                  </td>
                  <td className="px-3 py-1.5 border border-panel-border">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 text-white uppercase" style={{ background: '#e74c3c', borderRadius: 2 }}>{e.to_status}</span>
                  </td>
                  <td className="px-3 py-1.5 border border-panel-border text-muted text-[10px]">
                    {e.channels ? (() => { try { return JSON.parse(e.channels).join(', '); } catch { return e.channels; } })() : '—'}
                  </td>
                  <td className="px-3 py-1.5 border border-panel-border text-muted text-[10px]">{fmtDate(e.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
