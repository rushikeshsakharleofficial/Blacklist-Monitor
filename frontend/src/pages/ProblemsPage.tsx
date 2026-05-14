import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { ExternalLink, Wifi, WifiOff, RefreshCw, ShieldAlert, ChevronDown, ChevronRight, Search, X } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const STORAGE_KEY = 'api_key';
const PAGE_SIZES = [50, 100, 200, 500];

interface ListedTarget {
  id: number;
  address: string;
  target_type: string;
  hits: string[];
  total_checked: number;
  last_checked: string | null;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function subnetOf(address: string): string {
  const parts = address.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  return address;
}

function HitTags({ hits }: { hits: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? hits : hits.slice(0, 3);
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {shown.map(h => (
        <span key={h} className="font-mono text-[10px] px-1.5 py-0.5 border border-danger text-danger" style={{ borderRadius: 2, background: '#fce8e6' }}>{h}</span>
      ))}
      {hits.length > 3 && (
        <button onClick={() => setExpanded(e => !e)} className="text-[10px] font-bold text-danger underline">
          {expanded ? 'less' : `+${hits.length - 3} more`}
        </button>
      )}
    </div>
  );
}

export default function ProblemsPage() {
  const [targets, setTargets] = useState<ListedTarget[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [rechecking, setRechecking] = useState(false);
  const [recheckMsg, setRecheckMsg] = useState<string | null>(null);

  // View options
  const [search, setSearch] = useState('');
  const [groupBySubnet, setGroupBySubnet] = useState(false);
  const [collapsedSubnets, setCollapsedSubnets] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const forceRecheckAll = async () => {
    setRechecking(true);
    setRecheckMsg(null);
    try {
      const apiKey = localStorage.getItem(STORAGE_KEY) || '';
      await axios.post(`${API_BASE_URL}/targets/recheck-all`, null, {
        headers: { 'X-API-Key': apiKey },
      });
      setRecheckMsg('Recheck queued — results update within ~60 s');
    } catch {
      setRecheckMsg('Failed to queue recheck');
    } finally {
      setRechecking(false);
      setTimeout(() => setRecheckMsg(null), 5000);
    }
  };

  useEffect(() => {
    const apiKey = localStorage.getItem('api_key') || '';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/api/ws/problems?key=${encodeURIComponent(apiKey)}`;

    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => { setConnected(true); setRetryCount(0); };
      ws.onclose = () => {
        setConnected(false);
        retryRef.current = setTimeout(() => { setRetryCount(c => c + 1); connect(); }, 5000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'problems_update') {
            setTargets(msg.data);
            setLastUpdate(new Date());
          }
        } catch {}
      };
    };

    connect();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, []);

  // Reset page when search changes
  useEffect(() => { setPage(1); }, [search, groupBySubnet, pageSize]);

  const filtered = useMemo(() => {
    if (!search.trim()) return targets;
    const q = search.toLowerCase();
    return targets.filter(t =>
      t.address.toLowerCase().includes(q) ||
      t.hits.some(h => h.toLowerCase().includes(q))
    );
  }, [targets, search]);

  // Stats
  const dnsblCounts = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(t => t.hits.forEach(h => { map[h] = (map[h] || 0) + 1; }));
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [filtered]);

  const totalHits = useMemo(() => filtered.reduce((a, t) => a + t.hits.length, 0), [filtered]);

  const toggleSubnet = (subnet: string) => {
    setCollapsedSubnets(prev => {
      const next = new Set(prev);
      next.has(subnet) ? next.delete(subnet) : next.add(subnet);
      return next;
    });
  };

  // Flat view — paginated
  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Group view
  const grouped = useMemo(() => {
    if (!groupBySubnet) return null;
    const map: Record<string, ListedTarget[]> = {};
    filtered.forEach(t => {
      const s = subnetOf(t.address);
      if (!map[s]) map[s] = [];
      map[s].push(t);
    });
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  }, [filtered, groupBySubnet]);

  const TABLE_HEADER = (
    <tr style={{ background: '#2c3e50', color: 'white' }}>
      <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-28">IP / Domain</th>
      <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166]">Listed On (DNSBL)</th>
      <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-14">Hits</th>
      <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-20">Last Check</th>
      <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-14">Detail</th>
    </tr>
  );

  const ROW = (t: ListedTarget, i: number) => (
    <tr key={t.id} className={i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}>
      <td className="px-3 py-1.5 border border-panel-border font-mono font-bold text-foreground text-[11px]">{t.address}</td>
      <td className="px-3 py-1.5 border border-panel-border">
        {t.hits.length === 0
          ? <span className="text-muted italic text-[10px]">Pending</span>
          : <HitTags hits={t.hits} />}
      </td>
      <td className="px-3 py-1.5 border border-panel-border text-danger font-bold font-mono text-center text-[11px]">
        {t.hits.length}/{t.total_checked}
      </td>
      <td className="px-3 py-1.5 border border-panel-border text-muted text-[10px]">{relativeTime(t.last_checked)}</td>
      <td className="px-3 py-1.5 border border-panel-border">
        <Link to={`/problems/${t.id}`} className="flex items-center gap-1 text-primary hover:underline text-[11px]">
          <ExternalLink size={10} /> View
        </Link>
      </td>
    </tr>
  );

  return (
    <div>
      {/* Header */}
      <header className="flex justify-between items-center mb-3 border-b border-panel-border pb-2">
        <div>
          <h1 className="text-base font-bold text-foreground uppercase tracking-wide">
            Listed IPs — Active Problems
          </h1>
          <p className="text-muted text-[11px] mt-0.5">Real-time DNSBL hit feed via WebSocket</p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdate && <span className="text-muted text-[10px]">Updated {lastUpdate.toLocaleTimeString()}</span>}
          {recheckMsg && (
            <span className="text-[10px] font-bold text-warning border border-warning px-2 py-1" style={{ borderRadius: 2 }}>{recheckMsg}</span>
          )}
          <button onClick={forceRecheckAll} disabled={rechecking}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold border border-panel-border bg-white hover:bg-row-alt disabled:opacity-60 uppercase tracking-wide"
            style={{ borderRadius: 2 }}>
            <RefreshCw size={11} className={rechecking ? 'animate-spin' : ''} />
            Recheck All
          </button>
          <div className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 border ${connected ? 'text-success border-success bg-success-bg' : 'text-danger border-danger bg-danger-bg'}`} style={{ borderRadius: 2 }}>
            {connected ? <><Wifi size={11} /> Live</> : <><WifiOff size={11} /> Reconnecting{retryCount > 0 ? ` (${retryCount})` : ''}…</>}
          </div>
        </div>
      </header>

      {/* Stats bar */}
      {targets.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="border border-panel-border px-4 py-3 bg-white">
            <div className="text-xl font-bold text-danger">{filtered.length.toLocaleString()}</div>
            <div className="text-[10px] text-muted uppercase tracking-wide">Listed IPs{search ? ' (filtered)' : ''}</div>
          </div>
          <div className="border border-panel-border px-4 py-3 bg-white">
            <div className="text-[11px] font-bold text-foreground mb-1">Top DNSBL Zones</div>
            <div className="flex flex-wrap gap-1">
              {dnsblCounts.map(([zone, count]) => (
                <span key={zone} className="text-[10px] px-1.5 py-0.5 border border-danger text-danger font-mono" style={{ borderRadius: 2, background: '#fce8e6' }}>
                  {zone} <span className="font-bold">×{count}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by IP or DNSBL zone…"
            className="w-full pl-7 pr-7 py-1.5 text-xs border border-panel-border focus:outline-none focus:border-primary"
            style={{ borderRadius: 2 }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground">
              <X size={11} />
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer select-none">
          <input type="checkbox" checked={groupBySubnet} onChange={e => setGroupBySubnet(e.target.checked)} className="accent-blue-500" />
          Group by /24 subnet
        </label>
        <div className="ml-auto flex items-center gap-1 text-[11px] text-muted">
          Per page:
          {PAGE_SIZES.map(s => (
            <button key={s} onClick={() => setPageSize(s)}
              className="px-2 py-0.5 border font-bold"
              style={{ borderRadius: 2, background: pageSize === s ? '#336699' : 'white', color: pageSize === s ? 'white' : '#555', borderColor: pageSize === s ? '#336699' : '#ddd' }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {targets.length === 0 && (
        <div className="border border-panel-border bg-white px-4 py-10 text-center">
          <ShieldAlert size={28} className="text-success mx-auto mb-2 opacity-60" />
          <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-1">
            {connected ? 'All Clear — No Listed Assets' : 'Connecting…'}
          </p>
          <p className="text-xs text-muted">
            {connected ? 'None of your monitored IPs are currently blacklisted.' : 'Establishing WebSocket connection…'}
          </p>
        </div>
      )}

      {/* GROUP BY SUBNET view */}
      {groupBySubnet && grouped && grouped.length > 0 && (
        <div className="space-y-2">
          {grouped.map(([subnet, ips]) => {
            const collapsed = collapsedSubnets.has(subnet);
            return (
              <div key={subnet} className="border border-panel-border">
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                  style={{ background: '#2c3e50' }}
                  onClick={() => toggleSubnet(subnet)}
                >
                  {collapsed ? <ChevronRight size={14} className="text-white" /> : <ChevronDown size={14} className="text-white" />}
                  <span className="font-mono text-white font-bold text-[12px]">{subnet}</span>
                  <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: '#e74c3c', borderRadius: 2 }}>
                    {ips.length} LISTED
                  </span>
                  <span className="ml-auto text-[#8ab4c8] text-[10px]">
                    {ips.reduce((a, t) => a + t.hits.length, 0)} total hits
                  </span>
                </div>
                {!collapsed && (
                  <table className="w-full text-xs border-collapse">
                    <thead>{TABLE_HEADER}</thead>
                    <tbody>{ips.map((t, i) => ROW(t, i))}</tbody>
                  </table>
                )}
              </div>
            );
          })}
          <div className="text-[11px] text-muted px-1">
            {filtered.length.toLocaleString()} listed IPs across {grouped.length} subnets — {totalHits.toLocaleString()} total hits
          </div>
        </div>
      )}

      {/* FLAT view with pagination */}
      {!groupBySubnet && filtered.length > 0 && (
        <div className="border border-panel-border">
          <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
            <span className="text-white text-[11px] font-bold uppercase tracking-wider">
              Blacklist Detections
              <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: '#e74c3c', borderRadius: 2 }}>
                {filtered.length.toLocaleString()} LISTED
              </span>
            </span>
            <span className="text-[#8ab4c8] text-[10px]">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length.toLocaleString()}
            </span>
          </div>

          <table className="w-full text-xs border-collapse">
            <thead>{TABLE_HEADER}</thead>
            <tbody>{paged.map((t, i) => ROW(t, i))}</tbody>
            <tfoot>
              <tr className="bg-[#f0f2f5]">
                <td colSpan={5} className="px-3 py-1.5 border border-panel-border text-muted text-[11px]">
                  {filtered.length.toLocaleString()} listed — {totalHits.toLocaleString()} hits across {targets[0]?.total_checked ?? 0} DNSBL providers
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 px-3 py-2 border-t border-panel-border bg-white">
              <button onClick={() => setPage(1)} disabled={page === 1}
                className="px-2 py-1 text-[11px] border border-panel-border disabled:opacity-40" style={{ borderRadius: 2 }}>«</button>
              <button onClick={() => setPage(p => p - 1)} disabled={page === 1}
                className="px-2 py-1 text-[11px] border border-panel-border disabled:opacity-40" style={{ borderRadius: 2 }}>‹</button>

              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let p: number;
                if (totalPages <= 7) p = i + 1;
                else if (page <= 4) p = i + 1;
                else if (page >= totalPages - 3) p = totalPages - 6 + i;
                else p = page - 3 + i;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className="px-2.5 py-1 text-[11px] border font-bold"
                    style={{ borderRadius: 2, background: page === p ? '#336699' : 'white', color: page === p ? 'white' : '#555', borderColor: page === p ? '#336699' : '#ddd' }}>
                    {p}
                  </button>
                );
              })}

              <button onClick={() => setPage(p => p + 1)} disabled={page === totalPages}
                className="px-2 py-1 text-[11px] border border-panel-border disabled:opacity-40" style={{ borderRadius: 2 }}>›</button>
              <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
                className="px-2 py-1 text-[11px] border border-panel-border disabled:opacity-40" style={{ borderRadius: 2 }}>»</button>

              <span className="ml-3 text-[10px] text-muted">Page {page} of {totalPages}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
