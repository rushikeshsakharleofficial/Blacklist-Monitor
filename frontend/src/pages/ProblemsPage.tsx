import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { ExternalLink, Wifi, WifiOff, RefreshCw, ShieldAlert } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const STORAGE_KEY = 'api_key';

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
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

export default function ProblemsPage() {
  const [targets, setTargets] = useState<ListedTarget[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [rechecking, setRechecking] = useState(false);
  const [recheckMsg, setRecheckMsg] = useState<string | null>(null);
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

  const totalHits = targets.reduce((acc, t) => acc + t.hits.length, 0);

  return (
    <div>
      <header className="flex justify-between items-center mb-4 border-b border-panel-border pb-2">
        <div>
          <h1 className="text-base font-bold text-foreground uppercase tracking-wide">
            Listed IPs — Active Problems
          </h1>
          <p className="text-muted text-[11px] mt-0.5">
            Real-time DNSBL hit feed via WebSocket — shows only blacklisted assets
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-muted text-[10px]">Updated {lastUpdate.toLocaleTimeString()}</span>
          )}
          {recheckMsg && (
            <span className="text-[10px] font-bold text-warning border border-warning px-2 py-1" style={{ borderRadius: 2 }}>
              {recheckMsg}
            </span>
          )}
          <button
            onClick={forceRecheckAll}
            disabled={rechecking}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold border border-panel-border bg-white hover:bg-row-alt disabled:opacity-60 uppercase tracking-wide"
            style={{ borderRadius: 2 }}
          >
            <RefreshCw size={11} className={rechecking ? 'animate-spin' : ''} />
            Recheck All
          </button>
          <div
            className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 border ${
              connected ? 'text-success border-success bg-success-bg' : 'text-danger border-danger bg-danger-bg'
            }`}
            style={{ borderRadius: 2 }}
          >
            {connected
              ? <><Wifi size={11} /> Live</>
              : <><WifiOff size={11} /> Reconnecting{retryCount > 0 ? ` (${retryCount})` : ''}…</>
            }
          </div>
        </div>
      </header>

      <div className="border border-panel-border">
        <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
          <span className="text-white text-[11px] font-bold uppercase tracking-wider">
            Blacklist Detections
            {targets.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold text-white rounded" style={{ background: '#e74c3c' }}>
                {targets.length} LISTED
              </span>
            )}
          </span>
          <span className="text-[#8ab4c8] text-[10px] flex items-center gap-1">
            <RefreshCw size={10} className={connected ? 'animate-spin' : ''} />
            Auto-refresh every 10s via WebSocket
          </span>
        </div>

        {targets.length === 0 ? (
          <div className="bg-white px-4 py-10 text-center">
            <ShieldAlert size={28} className="text-success mx-auto mb-2 opacity-60" />
            <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-1">
              {connected ? 'All Clear — No Listed Assets' : 'Connecting…'}
            </p>
            <p className="text-xs text-muted">
              {connected
                ? 'None of your monitored IPs or domains are currently blacklisted.'
                : 'Establishing WebSocket connection to monitor…'}
            </p>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ background: '#2c3e50', color: 'white' }}>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-20">Status</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166]">IP / Domain</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-14">Type</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166]">Listed On (DNSBL Providers)</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-16">Hits</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-24">Last Check</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-16">Detail</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t, i) => (
                <tr key={t.id} className={i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}>
                  <td className="px-3 py-1.5 border border-panel-border">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 text-white uppercase" style={{ background: '#e74c3c', borderRadius: 2 }}>
                      LISTED
                    </span>
                  </td>
                  <td className="px-3 py-1.5 border border-panel-border font-mono font-bold text-foreground">
                    {t.address}
                  </td>
                  <td className="px-3 py-1.5 border border-panel-border text-muted uppercase text-[10px] font-bold">
                    {t.target_type}
                  </td>
                  <td className="px-3 py-1.5 border border-panel-border">
                    {t.hits.length === 0 ? (
                      <span className="text-muted italic text-[10px]">Pending next check cycle</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {t.hits.map(h => (
                          <span
                            key={h}
                            className="font-mono text-[10px] px-1.5 py-0.5 border border-danger text-danger"
                            style={{ borderRadius: 2, background: '#fce8e6' }}
                          >
                            {h}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 border border-panel-border text-danger font-bold font-mono text-center">
                    {t.hits.length}/{t.total_checked}
                  </td>
                  <td className="px-3 py-1.5 border border-panel-border text-muted">
                    {relativeTime(t.last_checked)}
                  </td>
                  <td className="px-3 py-1.5 border border-panel-border">
                    <Link to={`/problems/${t.id}`} className="flex items-center gap-1 text-primary hover:underline text-[11px]">
                      <ExternalLink size={10} /> View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[#f0f2f5]">
                <td colSpan={7} className="px-3 py-1.5 border border-panel-border text-muted text-[11px]">
                  {targets.length} listed asset{targets.length !== 1 ? 's' : ''} —{' '}
                  {totalHits} total hits across {targets[0]?.total_checked ?? 0} DNSBL providers checked
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
