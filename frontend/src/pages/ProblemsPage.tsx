import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { ExternalLink, Wifi, WifiOff, RefreshCw, ShieldAlert, ChevronDown, ChevronRight, Search, X, Download } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const STORAGE_KEY = 'api_key';
const PAGE_SIZES = [20, 50, 100, 200, 500];

interface ListedTarget {
  id: number;
  address: string;
  target_type: string;
  hits: string[];
  total_checked: number;
  last_checked: string | null;
  org?: string | null;
  asn?: string | null;
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
        <span key={h} className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-danger/30 text-danger bg-danger-bg">{h}</span>
      ))}
      {hits.length > 3 && (
        <button onClick={() => setExpanded(e => !e)} className="text-[10px] font-semibold text-danger underline">
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

  const [search, setSearch] = useState('');
  const [groupBySubnet, setGroupBySubnet] = useState(false);
  const [collapsedSubnets, setCollapsedSubnets] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const exportCSV = () => {
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const HEADER = ['IP / Domain', 'Type', 'Blacklisted On (DNSBL Zones)', 'Hit Count', 'Total Checked', 'Last Checked'];

    const subnetMap: Record<string, ListedTarget[]> = {};
    filtered.forEach(t => {
      const parts = t.address.split('.');
      const subnet = parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : 'Other';
      if (!subnetMap[subnet]) subnetMap[subnet] = [];
      subnetMap[subnet].push(t);
    });

    const sortedSubnets = Object.entries(subnetMap).sort((a, b) => a[0].localeCompare(b[0]));

    const lines: string[] = [
      `Listed IPs Export — ${new Date().toLocaleString()}`,
      `Total: ${filtered.length} IPs across ${sortedSubnets.length} subnets`,
      '',
    ];

    sortedSubnets.forEach(([subnet, ips]) => {
      lines.push(`Subnet: ${subnet} (${ips.length} listed)`);
      lines.push(HEADER.map(q).join(','));
      ips
        .sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }))
        .forEach(t => {
          lines.push([
            q(t.address), q(t.target_type), q(t.hits.join('\n')),
            q(t.hits.length), q(t.total_checked), q(t.last_checked ?? ''),
          ].join(','));
        });
      lines.push('');
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `listed_ips_by_subnet_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportHTML = () => {
    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const subnetMap: Record<string, ListedTarget[]> = {};
    filtered.forEach(t => {
      const parts = t.address.split('.');
      const subnet = parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : 'Other';
      if (!subnetMap[subnet]) subnetMap[subnet] = [];
      subnetMap[subnet].push(t);
    });
    const sortedSubnets = Object.entries(subnetMap).sort((a, b) => a[0].localeCompare(b[0]));
    const generated = new Date().toLocaleString();

    const subnetSections = sortedSubnets.map(([subnet, ips]) => {
      const sorted = [...ips].sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }));
      const rows = sorted.map((t, i) => `
        <tr style="background:${i%2===0?'#fff':'#f8f9fa'}">
          <td style="font-family:monospace;font-weight:bold;color:#111128">${esc(t.address)}</td>
          <td style="color:#666;font-size:11px;text-transform:uppercase">${esc(t.target_type)}</td>
          <td>${t.hits.map(h => `<span style="display:inline-block;font-family:monospace;font-size:10px;padding:2px 6px;margin:1px;background:#fff0f3;border:1px solid #e11d48;color:#e11d48;border-radius:4px">${esc(h)}</span>`).join('')}</td>
          <td style="text-align:center;font-weight:bold;color:#e11d48;font-family:monospace">${t.hits.length}/${t.total_checked}</td>
          <td style="color:#888;font-size:11px">${t.last_checked ? new Date(t.last_checked).toLocaleString() : '—'}</td>
        </tr>`).join('');
      return `
      <div style="margin-bottom:24px">
        <div style="background:#111128;color:white;padding:8px 12px;font-weight:bold;font-size:13px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between">
          <span>${esc(subnet)}</span>
          <span style="background:#e11d48;padding:2px 8px;border-radius:10px;font-size:11px">${ips.length} LISTED</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e2e2ea">
          <thead>
            <tr style="background:#1a1a24;color:white">
              <th style="padding:6px 10px;text-align:left;width:120px">IP Address</th>
              <th style="padding:6px 10px;text-align:left;width:60px">Type</th>
              <th style="padding:6px 10px;text-align:left">Blacklisted On (DNSBL Zones)</th>
              <th style="padding:6px 10px;text-align:center;width:60px">Hits</th>
              <th style="padding:6px 10px;text-align:left;width:150px">Last Checked</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Blacklist Report — ${generated}</title>
<style>
  body{font-family:Arial,sans-serif;background:#f7f7f8;margin:0;padding:24px;color:#111128}
  h1{color:#111128;margin:0 0 4px}
  .meta{color:#888;font-size:12px;margin-bottom:20px}
  .summary{display:flex;gap:16px;margin-bottom:20px}
  .stat{background:#fff;border:1px solid #e2e2ea;padding:12px 20px;border-radius:8px;min-width:120px}
  .stat-val{font-size:24px;font-weight:bold;font-family:monospace}
  .stat-label{font-size:10px;text-transform:uppercase;color:#888;margin-top:2px}
  td,th{padding:6px 10px;border:1px solid #e2e2ea}
  @media print{body{background:white;padding:0}}
</style>
</head>
<body>
<h1>Blacklist Monitor — Listed IP Report</h1>
<div class="meta">Generated: ${generated} &nbsp;|&nbsp; Filter: ${filtered.length === targets.length ? 'All listed IPs' : `"${esc(search)}" — ${filtered.length} matched`}</div>
<div class="summary">
  <div class="stat"><div class="stat-val" style="color:#e11d48">${filtered.length}</div><div class="stat-label">Listed IPs</div></div>
  <div class="stat"><div class="stat-val" style="color:#5e6ad2">${sortedSubnets.length}</div><div class="stat-label">Subnets</div></div>
  <div class="stat"><div class="stat-val" style="color:#5e6ad2">${filtered.reduce((a,t)=>a+t.hits.length,0)}</div><div class="stat-label">Total Hits</div></div>
</div>
${subnetSections}
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blacklist_report_${new Date().toISOString().slice(0,10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const forceRecheckAll = async () => {
    setRechecking(true);
    setRecheckMsg(null);
    try {
      const apiKey = localStorage.getItem(STORAGE_KEY) || '';
      await axios.post(`${API_BASE_URL}/targets/recheck-all`, null, { headers: { 'X-API-Key': apiKey } });
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
          if (msg.type === 'problems_update') { setTargets(msg.data); setLastUpdate(new Date()); }
        } catch {}
      };
    };

    connect();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => { setPage(1); }, [search, groupBySubnet, pageSize]);

  const filtered = useMemo(() => {
    if (!search.trim()) return targets;
    const q = search.toLowerCase();
    return targets.filter(t =>
      t.address.toLowerCase().includes(q) || t.hits.some(h => h.toLowerCase().includes(q))
    );
  }, [targets, search]);

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

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

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
    <tr className="bg-subtle">
      <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-28">IP / Domain</th>
      <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-40">Provider / Org</th>
      <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-24">ASN</th>
      <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left">Listed On (DNSBL)</th>
      <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-14">Hits</th>
      <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-20">Last Check</th>
      <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-14">Detail</th>
    </tr>
  );

  const ROW = (t: ListedTarget, i: number) => (
    <tr key={t.id} className="border-b border-border-base hover:bg-subtle transition-colors">
      <td className="px-3 py-2.5 font-mono font-semibold text-text-base text-sm">{t.address}</td>
      <td className="px-3 py-2.5 text-xs text-text-sec max-w-[160px]" title={t.org || ''}>
        <div className="truncate">{t.org || '—'}</div>
      </td>
      <td className="px-3 py-2.5 text-xs font-mono text-text-sec whitespace-nowrap w-24">
        {t.asn || '—'}
      </td>
      <td className="px-3 py-2.5">
        {t.hits.length === 0
          ? <span className="text-text-sec italic text-xs">Pending</span>
          : <HitTags hits={t.hits} />}
      </td>
      <td className="px-3 py-2.5 text-danger font-semibold font-mono text-center text-sm">
        {t.hits.length}/{t.total_checked}
      </td>
      <td className="px-3 py-2.5 text-text-sec text-xs">{relativeTime(t.last_checked)}</td>
      <td className="px-3 py-2.5">
        <Link to={`/problems/${t.id}`} className="flex items-center gap-1 text-accent hover:underline text-xs">
          <ExternalLink size={11} /> View
        </Link>
      </td>
    </tr>
  );

  return (
    <div>
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-base">Listed IPs — Active Problems</h1>
          <p className="text-sm text-text-sec mt-0.5">Real-time DNSBL hit feed via WebSocket</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lastUpdate && <span className="text-text-sec text-xs">Updated {lastUpdate.toLocaleTimeString()}</span>}
          {recheckMsg && (
            <span className="text-xs font-semibold text-warning border border-warning/30 bg-warning-bg px-2 py-1 rounded-md">{recheckMsg}</span>
          )}
          <button onClick={forceRecheckAll} disabled={rechecking}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors disabled:opacity-60 flex items-center gap-1.5">
            <RefreshCw size={14} className={rechecking ? 'animate-spin' : ''} />
            Recheck All
          </button>
          <button onClick={exportCSV} disabled={filtered.length === 0}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-success text-white hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5">
            <Download size={14} />
            Export CSV
          </button>
          <button onClick={exportHTML} disabled={filtered.length === 0}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 flex items-center gap-1.5">
            <Download size={14} />
            Export HTML
          </button>
          <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${connected ? 'text-success border-success/30 bg-success-bg' : 'text-danger border-danger/30 bg-danger-bg'}`}>
            {connected ? <><Wifi size={12} /> Live</> : <><WifiOff size={12} /> Reconnecting{retryCount > 0 ? ` (${retryCount})` : ''}…</>}
          </div>
        </div>
      </header>

      {/* Stats bar */}
      {targets.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-surface border border-border-base rounded-xl px-4 py-3">
            <div className="text-2xl font-bold text-danger">{filtered.length.toLocaleString()}</div>
            <div className="text-xs text-text-sec uppercase tracking-wide mt-0.5">Listed IPs{search ? ' (filtered)' : ''}</div>
          </div>
          <div className="bg-surface border border-border-base rounded-xl px-4 py-3">
            <div className="text-xs font-semibold text-text-base mb-2">Top DNSBL Zones</div>
            <div className="flex flex-wrap gap-1">
              {dnsblCounts.map(([zone, count]) => (
                <span key={zone} className="text-[10px] px-1.5 py-0.5 rounded border border-danger/30 text-danger font-mono bg-danger-bg">
                  {zone} <span className="font-bold">×{count}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-sec" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by IP or DNSBL zone…"
            className="border border-border-base rounded-lg pl-8 pr-8 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-sec hover:text-text-base">
              <X size={13} />
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-text-sec cursor-pointer select-none">
          <input type="checkbox" checked={groupBySubnet} onChange={e => setGroupBySubnet(e.target.checked)} className="accent-accent" />
          Group by /24 subnet
        </label>
        <div className="ml-auto flex items-center gap-1 text-sm text-text-sec">
          Per page:
          {PAGE_SIZES.map(s => (
            <button key={s} onClick={() => setPageSize(s)}
              className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${pageSize === s ? 'bg-accent text-white border-accent' : 'border-border-base text-text-sec hover:bg-subtle'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {targets.length === 0 && (
        <div className="bg-surface border border-border-base rounded-xl px-4 py-12 text-center">
          <ShieldAlert size={28} className="text-success mx-auto mb-3 opacity-60" />
          <p className="text-sm font-semibold text-text-base mb-1">
            {connected ? 'All Clear — No Listed Assets' : 'Connecting…'}
          </p>
          <p className="text-sm text-text-sec">
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
              <div key={subnet} className="bg-surface border border-border-base rounded-xl overflow-hidden">
                <div
                  className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-subtle transition-colors"
                  onClick={() => toggleSubnet(subnet)}
                >
                  {collapsed ? <ChevronRight size={14} className="text-text-sec" /> : <ChevronDown size={14} className="text-text-sec" />}
                  <span className="font-mono text-text-base font-semibold text-sm">{subnet}</span>
                  <span className="ml-2 px-2 py-0.5 text-[11px] font-medium rounded-full bg-danger-bg text-danger">
                    {ips.length} Listed
                  </span>
                  <span className="ml-auto text-text-sec text-xs">
                    {ips.reduce((a, t) => a + t.hits.length, 0)} total hits
                  </span>
                </div>
                {!collapsed && (
                  <table className="w-full text-sm border-collapse">
                    <thead>{TABLE_HEADER}</thead>
                    <tbody>{ips.map((t, i) => ROW(t, i))}</tbody>
                  </table>
                )}
              </div>
            );
          })}
          <div className="text-xs text-text-sec px-1">
            {filtered.length.toLocaleString()} listed IPs across {grouped.length} subnets — {totalHits.toLocaleString()} total hits
          </div>
        </div>
      )}

      {/* FLAT view with pagination */}
      {!groupBySubnet && filtered.length > 0 && (
        <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-base">
            <span className="text-sm font-semibold text-text-base">
              Blacklist Detections
              <span className="ml-2 px-2 py-0.5 text-[11px] font-medium rounded-full bg-danger-bg text-danger">
                {filtered.length.toLocaleString()} Listed
              </span>
            </span>
            <span className="text-text-sec text-xs">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length.toLocaleString()}
            </span>
          </div>

          <table className="w-full text-sm border-collapse">
            <thead>{TABLE_HEADER}</thead>
            <tbody>{paged.map((t, i) => ROW(t, i))}</tbody>
            <tfoot>
              <tr className="bg-subtle">
                <td colSpan={7} className="px-3 py-2 text-text-sec text-xs">
                  {filtered.length.toLocaleString()} listed — {totalHits.toLocaleString()} hits across {targets[0]?.total_checked ?? 0} DNSBL providers
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 px-3 py-3 border-t border-border-base">
              <button onClick={() => setPage(1)} disabled={page === 1}
                className="px-2 py-1 text-xs border border-border-base rounded-md hover:bg-subtle disabled:opacity-40">«</button>
              <button onClick={() => setPage(p => p - 1)} disabled={page === 1}
                className="px-2 py-1 text-xs border border-border-base rounded-md hover:bg-subtle disabled:opacity-40">‹</button>

              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let p: number;
                if (totalPages <= 7) p = i + 1;
                else if (page <= 4) p = i + 1;
                else if (page >= totalPages - 3) p = totalPages - 6 + i;
                else p = page - 3 + i;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`px-2.5 py-1 text-xs font-medium border rounded-md transition-colors ${page === p ? 'bg-accent text-white border-accent' : 'border-border-base hover:bg-subtle text-text-base'}`}>
                    {p}
                  </button>
                );
              })}

              <button onClick={() => setPage(p => p + 1)} disabled={page === totalPages}
                className="px-2 py-1 text-xs border border-border-base rounded-md hover:bg-subtle disabled:opacity-40">›</button>
              <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
                className="px-2 py-1 text-xs border border-border-base rounded-md hover:bg-subtle disabled:opacity-40">»</button>

              <span className="ml-3 text-xs text-text-sec">Page {page} of {totalPages}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
