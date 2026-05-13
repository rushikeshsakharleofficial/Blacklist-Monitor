import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const STORAGE_KEY = 'api_key';

interface TargetDetail {
  id: number;
  address: string;
  target_type: string;
  is_blacklisted: boolean;
  last_checked: string | null;
  created_at: string | null;
}

interface BlacklistHits {
  target_id: number;
  address: string;
  is_blacklisted: boolean;
  hits: string[];
  total_checked: number;
  checked_at: string | null;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

export default function TargetDetailPage() {
  const { targetId } = useParams<{ targetId: string }>();
  const [target, setTarget] = useState<TargetDetail | null>(null);
  const [hits, setHits] = useState<BlacklistHits | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiKey = localStorage.getItem(STORAGE_KEY) || '';

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const headers = { 'X-API-Key': apiKey };
      const [targetRes, hitsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/targets/${targetId}`, { headers }),
        axios.get(`${API_BASE_URL}/targets/${targetId}/blacklist-hits`, { headers }),
      ]);
      setTarget(targetRes.data);
      setHits(hitsRes.data);
      setError(null);
    } catch {
      setError('Failed to load target details.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { if (targetId) fetchData(); }, [targetId]);

  const cleanZones = hits
    ? hits.hits.length > 0
      ? Array.from({ length: hits.total_checked }, (_, i) => `zone-${i}`).filter((_, i) => !hits.hits[i])
      : []
    : [];

  return (
    <div>
      <header className="flex justify-between items-center mb-4 border-b border-panel-border pb-2">
        <div className="flex items-center gap-3">
          <Link to="/problems" className="text-muted hover:text-primary flex items-center gap-1 text-xs">
            <ArrowLeft size={12} /> Back to Problems
          </Link>
          <div className="border-l border-panel-border pl-3">
            <h1 className="text-base font-bold text-foreground uppercase tracking-wide">Asset Detail</h1>
            {target && <p className="text-muted text-[11px] mt-0.5 font-mono">{target.address}</p>}
          </div>
        </div>
        <button
          onClick={fetchData}
          disabled={isLoading}
          className="flex items-center gap-1 px-3 py-1.5 text-xs border border-panel-border bg-white hover:bg-row-alt disabled:opacity-60"
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {error && (
        <div className="border border-danger bg-danger-bg text-danger px-4 py-2 mb-4 text-xs">{error}</div>
      )}

      {isLoading ? (
        <div className="border border-panel-border bg-white px-4 py-8 text-center text-muted text-xs">
          Loading asset details…
        </div>
      ) : target ? (
        <div className="space-y-4">
          {/* Asset Summary */}
          <div className="border border-panel-border">
            <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
              <span className="text-white text-[11px] font-bold uppercase tracking-wider">Asset Summary</span>
              <div className="flex gap-2">
                <button className="text-[10px] font-bold px-3 py-1 text-white border border-[#2a5580]" style={{ background: '#336699', borderRadius: 2 }}>
                  Check Now
                </button>
                <button className="text-[10px] font-bold px-3 py-1 text-white border border-[#c0392b]" style={{ background: '#e74c3c', borderRadius: 2 }}>
                  Remove Asset
                </button>
              </div>
            </div>
            <div className="bg-white">
              <table className="w-full text-xs border-collapse">
                <tbody>
                  {[
                    { label: 'IP / Domain', value: target.address, mono: true },
                    { label: 'Type', value: target.target_type.toUpperCase() },
                    {
                      label: 'Status',
                      badge: target.is_blacklisted ? 'LISTED' : target.last_checked ? 'CLEAN' : 'PENDING',
                    },
                    {
                      label: 'DNSBL Hits',
                      value: hits ? `${hits.hits.length} of ${hits.total_checked} providers` : '—',
                    },
                    { label: 'Last Checked', value: relativeTime(target.last_checked) },
                  ].map(({ label, value, mono, badge }, i) => (
                    <tr key={label} className={i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}>
                      <td className="px-3 py-2 border border-panel-border text-[10px] font-bold uppercase text-muted w-36">{label}</td>
                      <td className="px-3 py-2 border border-panel-border">
                        {badge ? (
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 text-white uppercase"
                            style={{ background: badge === 'LISTED' ? '#e74c3c' : badge === 'CLEAN' ? '#27ae60' : '#f39c12', borderRadius: 2 }}
                          >
                            {badge}
                          </span>
                        ) : (
                          <span className={mono ? 'font-mono text-foreground' : 'text-foreground'}>{value}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Blacklist Detections */}
          {hits && hits.hits.length > 0 && (
            <div className="border border-panel-border">
              <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
                <span className="text-white text-[11px] font-bold uppercase tracking-wider">
                  Blacklist Detections
                </span>
                <span className="text-[#e74c3c] text-[10px] font-bold">{hits.hits.length} FOUND</span>
              </div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr style={{ background: '#2c3e50', color: 'white' }}>
                    <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166]">DNSBL Provider / Zone</th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-20">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {hits.hits.map((zone, i) => (
                    <tr key={zone} className={i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}>
                      <td className="px-3 py-1.5 border border-panel-border font-mono text-foreground">{zone}</td>
                      <td className="px-3 py-1.5 border border-panel-border">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 text-white uppercase" style={{ background: '#e74c3c', borderRadius: 2 }}>
                          LISTED
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Clean Providers Summary */}
          {hits && hits.total_checked > hits.hits.length && (
            <div className="border border-panel-border">
              <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
                <span className="text-white text-[11px] font-bold uppercase tracking-wider">
                  Checked Providers — {hits.total_checked - hits.hits.length} Clean
                </span>
                <span className="text-success text-[10px] font-bold">{hits.total_checked} total checked</span>
              </div>
              <div className="bg-white p-3">
                <p className="text-[10px] text-muted mb-2">
                  {hits.total_checked - hits.hits.length} of {hits.total_checked} DNSBL providers returned no listing for this asset:
                </p>
                <div className="text-[10px] text-muted font-mono">
                  {hits.checked_at && `Last full scan: ${relativeTime(hits.checked_at)}`}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="border border-panel-border bg-white px-4 py-8 text-center text-muted text-xs">
          Asset not found.
        </div>
      )}
    </div>
  );
}
