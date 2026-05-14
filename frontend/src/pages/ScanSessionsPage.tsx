import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const STORAGE_KEY = 'api_key';

interface ScanSession {
  id: number;
  session_type: string;
  params: string;
  scan_ref: string | null;
  status: string;
  total_ips: number;
  total_listed: number;
  created_at: string | null;
  completed_at: string | null;
}

interface SessionDetail {
  id: number;
  session_type: string;
  params: Record<string, any>;
  scan_ref: string | null;
  status: string;
  total_ips: number;
  total_listed: number;
  created_at: string | null;
  completed_at: string | null;
  results_available: boolean;
  live_data: any;
}

export default function ScanSessionsPage() {
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, SessionDetail | null>>({});
  const [loadingDetail, setLoadingDetail] = useState<Record<number, boolean>>({});

  const apiKey = localStorage.getItem(STORAGE_KEY) || '';
  const headers = { 'X-API-Key': apiKey };

  const fetchSessions = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/scan/sessions`, { headers });
      setSessions(res.data);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const toggleDetail = async (id: number) => {
    if (id in expanded) {
      setExpanded(prev => { const n = { ...prev }; delete n[id]; return n; });
      return;
    }
    setLoadingDetail(prev => ({ ...prev, [id]: true }));
    try {
      const res = await axios.get(`${API_BASE_URL}/scan/sessions/${id}`, { headers });
      setExpanded(prev => ({ ...prev, [id]: res.data }));
    } catch {}
    finally { setLoadingDetail(prev => ({ ...prev, [id]: false })); }
  };

  const statusColor = (s: string) =>
    s === 'complete' ? '#27ae60' : s === 'failed' ? '#e74c3c' : '#f39c12';

  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  };

  const fmtDuration = (s: ScanSession) => {
    if (!s.created_at || !s.completed_at) return null;
    const ms = new Date(s.completed_at).getTime() - new Date(s.created_at).getTime();
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.round(sec / 60)}m ${sec % 60}s`;
  };

  if (loading) return <div className="text-muted text-xs p-4">Loading sessions...</div>;

  return (
    <div>
      <header className="flex justify-between items-center mb-4 border-b border-panel-border pb-2">
        <div>
          <h1 className="text-base font-bold text-foreground uppercase tracking-wide">Scan Sessions</h1>
          <p className="text-muted text-[11px] mt-0.5">
            History of all subnet scans — results viewable for 1 hour while cached
          </p>
        </div>
        <button onClick={fetchSessions}
          className="flex items-center gap-1 px-3 py-1.5 text-xs border border-panel-border bg-white hover:bg-row-alt">
          <RefreshCw size={12} /> Refresh
        </button>
      </header>

      {sessions.length === 0 && (
        <div className="text-muted text-xs text-center py-12 border border-panel-border">
          No scan sessions yet. Run a subnet scan to create one.
        </div>
      )}

      <div className="space-y-2">
        {sessions.map(sess => {
          const parsedParams = (() => { try { return JSON.parse(sess.params); } catch { return {}; } })();
          const isExpanded = sess.id in expanded;
          const detail = expanded[sess.id];
          const duration = fmtDuration(sess);

          return (
            <div key={sess.id} className="border border-panel-border">
              {/* Card header */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-row-alt"
                onClick={() => toggleDetail(sess.id)}
              >
                {/* Type badge */}
                <span className="text-[10px] font-bold px-2 py-0.5 text-white uppercase"
                  style={{ background: sess.session_type === 'bulk' ? '#6c3483' : '#336699', borderRadius: 2, minWidth: 44, textAlign: 'center' }}>
                  {sess.session_type === 'bulk' ? 'BULK' : 'SINGLE'}
                </span>

                {/* Subnet label */}
                <span className="font-mono text-xs font-bold text-foreground flex-1 truncate">
                  {sess.session_type === 'bulk'
                    ? `${parsedParams.cidrs?.length ?? 0} subnets`
                    : (parsedParams.cidr ?? '—')}
                </span>

                {/* Stats */}
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-muted">{sess.total_ips.toLocaleString()} IPs</span>
                  <span className="font-bold" style={{ color: sess.total_listed > 0 ? '#e74c3c' : '#27ae60' }}>
                    {sess.total_listed} listed
                  </span>
                  {duration && <span className="text-muted">{duration}</span>}
                  <span className="text-[10px] font-bold px-1.5 py-0.5 text-white"
                    style={{ background: statusColor(sess.status), borderRadius: 2 }}>
                    {sess.status.toUpperCase()}
                    {sess.status === 'running' && <span className="ml-1">&#8226;</span>}
                  </span>
                  <span className="text-muted text-[10px]">{fmtDate(sess.created_at)}</span>
                  {loadingDetail[sess.id]
                    ? <RefreshCw size={12} className="animate-spin text-muted" />
                    : isExpanded ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />
                  }
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && detail && (
                <div className="border-t border-panel-border">
                  {/* Bulk: show per-subnet list */}
                  {sess.session_type === 'bulk' && parsedParams.cidrs && (
                    <div className="px-4 py-3">
                      <p className="text-[11px] text-muted mb-2">Subnets in this batch:</p>
                      <div className="flex flex-wrap gap-1">
                        {parsedParams.cidrs.map((c: string) => (
                          <span key={c} className="font-mono text-[10px] px-2 py-0.5 border border-panel-border bg-row-alt">{c}</span>
                        ))}
                      </div>
                      {detail.results_available && detail.live_data?.batch_id && (
                        <p className="text-[11px] text-muted mt-2">
                          Live results: poll <code className="text-[10px] bg-row-alt px-1">/scan/subnets/bulk/{detail.live_data.batch_id}</code>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Single: show IP results table */}
                  {sess.session_type === 'single' && detail.results_available && detail.live_data && (
                    <div>
                      <div className="px-4 py-2 border-b border-panel-border flex gap-6 text-xs" style={{ background: '#f8f9fa' }}>
                        <span><span className="font-bold">{detail.live_data.total}</span> <span className="text-muted">total</span></span>
                        <span><span className="font-bold text-danger">{detail.live_data.results?.filter((r: any) => r.is_blacklisted).length ?? 0}</span> <span className="text-muted">listed</span></span>
                        <span><span className="font-bold text-success">{detail.live_data.results?.filter((r: any) => !r.is_blacklisted).length ?? 0}</span> <span className="text-muted">clean</span></span>
                      </div>
                      {detail.live_data.results?.filter((r: any) => r.is_blacklisted).length > 0 ? (
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr style={{ background: '#2c3e50', color: 'white' }}>
                              <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-32">IP</th>
                              <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166]">Listed On</th>
                              <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-16">Hits</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.live_data.results.filter((r: any) => r.is_blacklisted).map((r: any, i: number) => (
                              <tr key={r.ip} className={i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}>
                                <td className="px-3 py-1.5 border border-panel-border font-mono font-bold text-danger">{r.ip}</td>
                                <td className="px-3 py-1.5 border border-panel-border">
                                  <div className="flex flex-wrap gap-1">
                                    {r.hits.map((h: string) => (
                                      <span key={h} className="font-mono text-[10px] px-1.5 py-0.5 border border-danger text-danger" style={{ borderRadius: 2, background: '#fce8e6' }}>{h}</span>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-3 py-1.5 border border-panel-border text-center font-mono font-bold text-danger">
                                  {r.hits.length}/{r.total_checked}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="px-4 py-3 text-xs text-muted">
                          {detail.results_available ? 'No listed IPs found — all clean.' : 'Results expired from cache (1h TTL).'}
                        </div>
                      )}
                    </div>
                  )}

                  {!detail.results_available && (
                    <div className="px-4 py-3 text-xs text-muted">
                      Results expired from Redis cache (1h TTL). Summary: {sess.total_ips} IPs, {sess.total_listed} listed.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
