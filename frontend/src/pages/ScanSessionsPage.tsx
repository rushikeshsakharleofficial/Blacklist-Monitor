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

  const statusCls = (s: string) =>
    s === 'complete' ? 'bg-success-bg text-success' :
    s === 'failed' ? 'bg-danger-bg text-danger' :
    'bg-warning-bg text-warning';

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

  if (loading) return <div className="text-text-sec text-sm p-4">Loading sessions...</div>;

  const TH_CLS = "text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-3 py-2.5 border-b border-border-base text-left";
  const TD_CLS = "px-3 py-2 text-sm text-text-base border-b border-border-base";

  return (
    <div>
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-base">Scan Sessions</h1>
          <p className="text-sm text-text-sec mt-0.5">
            History of all subnet scans — results viewable for 1 hour while cached
          </p>
        </div>
        <button onClick={fetchSessions}
          className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors flex items-center gap-1.5">
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {sessions.length === 0 && (
        <div className="text-text-sec text-sm text-center py-12 bg-surface border border-border-base rounded-xl">
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
            <div key={sess.id} className="bg-surface border border-border-base rounded-xl overflow-hidden">
              {/* Card header */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-subtle transition-colors"
                onClick={() => toggleDetail(sess.id)}
              >
                {/* Type badge */}
                <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full uppercase ${sess.session_type === 'bulk' ? 'bg-accent-subtle text-accent' : 'bg-subtle text-text-sec'}`}>
                  {sess.session_type === 'bulk' ? 'BULK' : 'SINGLE'}
                </span>

                {/* Subnet label */}
                <span className="font-mono text-sm font-semibold text-text-base flex-1 truncate">
                  {sess.session_type === 'bulk'
                    ? `${parsedParams.cidrs?.length ?? 0} subnets`
                    : (parsedParams.cidr ?? '—')}
                </span>

                {/* Stats */}
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-text-sec">{sess.total_ips.toLocaleString()} IPs</span>
                  <span className={`font-semibold ${sess.total_listed > 0 ? 'text-danger' : 'text-success'}`}>
                    {sess.total_listed} listed
                  </span>
                  {duration && <span className="text-text-sec text-xs">{duration}</span>}
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusCls(sess.status)}`}>
                    {sess.status.toUpperCase()}
                    {sess.status === 'running' && <span className="ml-1">•</span>}
                  </span>
                  <span className="text-text-sec text-xs hidden sm:inline">{fmtDate(sess.created_at)}</span>
                  {loadingDetail[sess.id]
                    ? <RefreshCw size={13} className="animate-spin text-text-sec" />
                    : isExpanded ? <ChevronUp size={15} className="text-text-sec" /> : <ChevronDown size={15} className="text-text-sec" />
                  }
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && detail && (
                <div className="border-t border-border-base">
                  {/* Bulk: show per-subnet list */}
                  {sess.session_type === 'bulk' && parsedParams.cidrs && (
                    <div className="px-4 py-3">
                      <p className="text-sm text-text-sec mb-2">Subnets in this batch:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {parsedParams.cidrs.map((c: string) => (
                          <span key={c} className="font-mono text-xs px-2.5 py-0.5 rounded-md border border-border-base bg-subtle text-text-base">{c}</span>
                        ))}
                      </div>
                      {detail.results_available && detail.live_data?.batch_id && (
                        <p className="text-sm text-text-sec mt-2">
                          Live results: poll <code className="text-xs bg-subtle px-1.5 py-0.5 rounded font-mono text-text-base">/scan/subnets/bulk/{detail.live_data.batch_id}</code>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Single: show IP results table */}
                  {sess.session_type === 'single' && detail.results_available && detail.live_data && (
                    <div>
                      <div className="px-4 py-2.5 border-b border-border-base flex gap-6 text-sm bg-subtle">
                        <span><span className="font-semibold text-text-base">{detail.live_data.total}</span> <span className="text-text-sec">total</span></span>
                        <span><span className="font-semibold text-danger">{detail.live_data.results?.filter((r: any) => r.is_blacklisted).length ?? 0}</span> <span className="text-text-sec">listed</span></span>
                        <span><span className="font-semibold text-success">{detail.live_data.results?.filter((r: any) => !r.is_blacklisted).length ?? 0}</span> <span className="text-text-sec">clean</span></span>
                      </div>
                      {detail.live_data.results?.filter((r: any) => r.is_blacklisted).length > 0 ? (
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr>
                              <th className={`${TH_CLS} w-32`}>IP</th>
                              <th className={TH_CLS}>Listed On</th>
                              <th className={`${TH_CLS} w-16`}>Hits</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.live_data.results.filter((r: any) => r.is_blacklisted).map((r: any) => (
                              <tr key={r.ip} className="hover:bg-subtle transition-colors">
                                <td className={`${TD_CLS} font-mono font-semibold text-danger`}>{r.ip}</td>
                                <td className={TD_CLS}>
                                  <div className="flex flex-wrap gap-1">
                                    {r.hits.map((h: string) => (
                                      <span key={h} className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-danger/30 text-danger bg-danger-bg">{h}</span>
                                    ))}
                                  </div>
                                </td>
                                <td className={`${TD_CLS} text-center font-mono font-semibold text-danger`}>
                                  {r.hits.length}/{r.total_checked}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="px-4 py-3 text-sm text-text-sec">
                          {detail.results_available ? 'No listed IPs found — all clean.' : 'Results expired from cache (1h TTL).'}
                        </div>
                      )}
                    </div>
                  )}

                  {!detail.results_available && (
                    <div className="px-4 py-3 text-sm text-text-sec">
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
