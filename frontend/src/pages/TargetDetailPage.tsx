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

  const TH_CLS = "text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-3 py-2.5 border-b border-border-base text-left";
  const TD_CLS = "px-3 py-2.5 text-sm border-b border-border-base";

  return (
    <div>
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link to="/problems" className="text-text-sec hover:text-accent flex items-center gap-1 text-sm transition-colors">
            <ArrowLeft size={14} /> Back to Problems
          </Link>
          <div className="border-l border-border-base pl-3">
            <h1 className="text-lg font-semibold text-text-base">Asset Detail</h1>
            {target && <p className="text-sm text-text-sec mt-0.5 font-mono">{target.address}</p>}
          </div>
        </div>
        <button
          onClick={fetchData}
          disabled={isLoading}
          className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors flex items-center gap-1.5 disabled:opacity-60"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-bg text-danger px-4 py-3 mb-4 text-sm">{error}</div>
      )}

      {isLoading ? (
        <div className="bg-surface border border-border-base rounded-xl px-4 py-10 text-center text-text-sec text-sm">
          Loading asset details…
        </div>
      ) : target ? (
        <div className="space-y-4">
          {/* Asset Summary */}
          <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-base">
              <span className="text-sm font-semibold text-text-base">Asset Summary</span>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors">
                  Check Now
                </button>
                <button className="px-3 py-1.5 text-sm font-medium rounded-lg bg-danger text-white hover:opacity-90 transition-opacity">
                  Remove Asset
                </button>
              </div>
            </div>
            <table className="w-full text-sm border-collapse">
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
                ].map(({ label, value, mono, badge }) => (
                  <tr key={label} className="border-b border-border-base hover:bg-subtle transition-colors">
                    <td className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-sec w-36 bg-subtle">{label}</td>
                    <td className="px-3 py-2.5">
                      {badge ? (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase ${
                          badge === 'LISTED' ? 'bg-danger-bg text-danger' :
                          badge === 'CLEAN' ? 'bg-success-bg text-success' :
                          'bg-subtle text-text-sec'
                        }`}>
                          {badge}
                        </span>
                      ) : (
                        <span className={`text-sm text-text-base ${mono ? 'font-mono' : ''}`}>{value}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Blacklist Detections */}
          {hits && hits.hits.length > 0 && (
            <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border-base">
                <span className="text-sm font-semibold text-text-base">Blacklist Detections</span>
                <span className="text-xs font-semibold text-danger">{hits.hits.length} found</span>
              </div>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className={TH_CLS}>DNSBL Provider / Zone</th>
                    <th className={`${TH_CLS} w-20`}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {hits.hits.map((zone) => (
                    <tr key={zone} className="border-b border-border-base hover:bg-subtle transition-colors">
                      <td className={`${TD_CLS} font-mono text-text-base`}>{zone}</td>
                      <td className={TD_CLS}>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-danger-bg text-danger uppercase">
                          Listed
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
            <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border-base">
                <span className="text-sm font-semibold text-text-base">
                  Checked Providers — {hits.total_checked - hits.hits.length} Clean
                </span>
                <span className="text-xs font-semibold text-success">{hits.total_checked} total checked</span>
              </div>
              <div className="p-4">
                <p className="text-sm text-text-sec mb-1">
                  {hits.total_checked - hits.hits.length} of {hits.total_checked} DNSBL providers returned no listing for this asset.
                </p>
                <div className="text-sm text-text-muted font-mono">
                  {hits.checked_at && `Last full scan: ${relativeTime(hits.checked_at)}`}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-surface border border-border-base rounded-xl px-4 py-10 text-center text-text-sec text-sm">
          Asset not found.
        </div>
      )}
    </div>
  );
}
