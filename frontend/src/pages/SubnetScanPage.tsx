import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { RefreshCw } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const STORAGE_KEY = 'api_key';
const LS_SINGLE_SCAN = 'bm_scan_single';
const LS_BULK_SCAN   = 'bm_scan_bulk';

interface ScanResult {
  ip: string;
  hits: string[];
  is_blacklisted: boolean;
  total_checked: number;
  org: string | null;
  asn?: string | null;
  country_code?: string | null;
  country_name?: string | null;
  city?: string | null;
  isp?: string | null;
  is_hosting?: boolean | null;
}

interface ScanResponse {
  cidr: string;
  total_ips: number;
  listed: number;
  clean: number;
  done: number;
  complete: boolean;
  results: ScanResult[];
}

interface SubnetProgress {
  cidr: string;
  scan_id: string;
  total: number;
  done: number;
  listed: number;
  complete: boolean;
  results: ScanResult[];
}

interface BulkScanResponse {
  batch_id: string;
  subnet_count: number;
  total_ips: number;
  total_done: number;
  total_listed: number;
  complete: boolean;
  subnets: SubnetProgress[];
}

export default function SubnetScanPage() {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');

  const [cidr, setCidr] = useState('');
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [liveResults, setLiveResults] = useState<ScanResult[]>([]);
  const [newIps, setNewIps] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const seenIpsRef = useRef<Set<string>>(new Set());
  const [monitoringSubnet, setMonitoringSubnet] = useState(false);
  const [subnetAdded, setSubnetAdded] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [bulkCidrs, setBulkCidrs] = useState('');
  const [bulkScanning, setBulkScanning] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkScanResponse | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const bulkPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [scanFilter, setScanFilter] = useState<'all' | 'listed' | 'clean'>('all');
  const [scanPage, setScanPage] = useState(1);
  const SCAN_PAGE_SIZES = [20, 50, 100, 200];
  const [scanPageSize, setScanPageSize] = useState(20);
  React.useEffect(() => { setScanPage(1); }, [scanFilter, scanPageSize]);

  const apiKey = localStorage.getItem(STORAGE_KEY) || '';
  const headers = { 'X-API-Key': apiKey };

  useEffect(() => {
    const singleSaved = localStorage.getItem(LS_SINGLE_SCAN);
    const bulkSaved   = localStorage.getItem(LS_BULK_SCAN);

    if (singleSaved) {
      try {
        const { scan_id, cidr: savedCidr, total } = JSON.parse(singleSaved);
        setMode('single');
        setCidr(savedCidr);
        setScanning(true);
        setProgress({ done: 0, total });
        resumeSinglePoll(scan_id);
      } catch { localStorage.removeItem(LS_SINGLE_SCAN); }
    } else if (bulkSaved) {
      try {
        const { batch_id } = JSON.parse(bulkSaved);
        setMode('bulk');
        setBulkScanning(true);
        resumeBulkPoll(batch_id);
      } catch { localStorage.removeItem(LS_BULK_SCAN); }
    }

    return () => {
      if (pollRef.current) clearTimeout(pollRef.current as unknown as ReturnType<typeof setTimeout>);
      if (bulkPollRef.current) clearTimeout(bulkPollRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resumeSinglePoll = (scan_id: string) => {
    const poll = async () => {
      try {
        const prog = await axios.get(`${API_BASE_URL}/scan/subnet/${scan_id}`, { headers });
        const data: ScanResponse = prog.data;
        setProgress({ done: data.done, total: data.total_ips });
        setLiveResults(data.results);
        if (data.complete) {
          pollRef.current = null;
          setScanning(false);
          setResult(data);
          localStorage.removeItem(LS_SINGLE_SCAN);
          return;
        }
        pollRef.current = setTimeout(poll, 800) as unknown as ReturnType<typeof setInterval>;
      } catch {
        pollRef.current = null;
        setScanning(false);
        setError('Could not reconnect to scan. It may have expired.');
        localStorage.removeItem(LS_SINGLE_SCAN);
      }
    };
    pollRef.current = setTimeout(poll, 500) as unknown as ReturnType<typeof setInterval>;
  };

  const resumeBulkPoll = (batch_id: string) => {
    const poll = async () => {
      try {
        const prog = await axios.get(`${API_BASE_URL}/scan/subnets/bulk/${batch_id}`, { headers });
        const data: BulkScanResponse = prog.data;
        setBulkResult(data);
        if (data.complete) {
          bulkPollRef.current = null;
          setBulkScanning(false);
          localStorage.removeItem(LS_BULK_SCAN);
          return;
        }
        bulkPollRef.current = setTimeout(poll, 1000);
      } catch {
        bulkPollRef.current = null;
        setBulkScanning(false);
        setBulkError('Could not reconnect to bulk scan. It may have expired.');
        localStorage.removeItem(LS_BULK_SCAN);
      }
    };
    bulkPollRef.current = setTimeout(poll, 500);
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    setScanning(true);
    setError(null);
    setResult(null);
    setLiveResults([]);
    setNewIps(new Set());
    seenIpsRef.current = new Set();
    setAdded({});
    setSubnetAdded(false);
    setProgress({ done: 0, total: 0 });

    try {
      const res = await axios.post(`${API_BASE_URL}/scan/subnet`, { cidr }, { headers });
      const { scan_id, total } = res.data;
      setProgress({ done: 0, total });
      localStorage.setItem(LS_SINGLE_SCAN, JSON.stringify({ scan_id, cidr, total }));

      const poll = async () => {
        try {
          const prog = await axios.get(`${API_BASE_URL}/scan/subnet/${scan_id}`, { headers });
          const data: ScanResponse = prog.data;
          setProgress({ done: data.done, total: data.total_ips });
          const incoming = data.results.filter(r => !seenIpsRef.current.has(r.ip));
          if (incoming.length > 0) {
            incoming.forEach(r => seenIpsRef.current.add(r.ip));
            const freshIps = new Set(incoming.map(r => r.ip));
            setNewIps(prev => new Set([...prev, ...freshIps]));
            setLiveResults(prev => [...incoming, ...prev]);
            setTimeout(() => setNewIps(prev => {
              const next = new Set(prev);
              freshIps.forEach(ip => next.delete(ip));
              return next;
            }), 600);
          }
          if (data.complete) {
            pollRef.current = null;
            setScanning(false);
            setResult(data);
            localStorage.removeItem(LS_SINGLE_SCAN);
            return;
          }
          pollRef.current = setTimeout(poll, 400) as unknown as ReturnType<typeof setInterval>;
        } catch {
          pollRef.current = null;
          setScanning(false);
          setError('Lost connection during scan.');
        }
      };
      pollRef.current = setTimeout(poll, 400) as unknown as ReturnType<typeof setInterval>;
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Scan failed. Check CIDR and try again.');
      setScanning(false);
    }
  };

  const addToMonitor = async (ip: string) => {
    setAdding(a => ({ ...a, [ip]: true }));
    try {
      await axios.post(`${API_BASE_URL}/targets/`, { value: ip }, { headers });
      setAdded(a => ({ ...a, [ip]: true }));
    } catch (err: any) {
      if (err.response?.data?.detail?.includes('already exists')) setAdded(a => ({ ...a, [ip]: true }));
    } finally {
      setAdding(a => ({ ...a, [ip]: false }));
    }
  };

  const addAllListed = async () => {
    if (!result) return;
    for (const r of result.results.filter(r => r.is_blacklisted && !added[r.ip])) {
      await addToMonitor(r.ip);
    }
  };

  const monitorEntireSubnet = async () => {
    if (!result) return;
    setMonitoringSubnet(true);
    try {
      await axios.post(`${API_BASE_URL}/targets/`, { value: result.cidr }, { headers });
      setSubnetAdded(true);
    } catch (err: any) {
      if (err.response?.data?.detail?.includes('already exists')) setSubnetAdded(true);
      else setError(err.response?.data?.detail || 'Failed to add subnet');
    } finally {
      setMonitoringSubnet(false);
    }
  };

  const handleBulkScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bulkPollRef.current) { clearTimeout(bulkPollRef.current); bulkPollRef.current = null; }
    const cidrs = bulkCidrs.split('\n').map(s => s.trim()).filter(Boolean);
    if (!cidrs.length) return;

    setBulkScanning(true);
    setBulkError(null);
    setBulkResult(null);

    try {
      const res = await axios.post(`${API_BASE_URL}/scan/subnets/bulk`, { cidrs }, { headers });
      const { batch_id } = res.data;
      localStorage.setItem(LS_BULK_SCAN, JSON.stringify({ batch_id }));

      const poll = async () => {
        try {
          const prog = await axios.get(`${API_BASE_URL}/scan/subnets/bulk/${batch_id}`, { headers });
          const data: BulkScanResponse = prog.data;
          setBulkResult(data);
          if (data.complete) {
            bulkPollRef.current = null;
            setBulkScanning(false);
            localStorage.removeItem(LS_BULK_SCAN);
            return;
          }
          bulkPollRef.current = setTimeout(poll, 1000);
        } catch {
          bulkPollRef.current = null;
          setBulkScanning(false);
          setBulkError('Lost connection during bulk scan.');
          localStorage.removeItem(LS_BULK_SCAN);
        }
      };
      bulkPollRef.current = setTimeout(poll, 800);
    } catch (err: any) {
      setBulkError(err.response?.data?.detail || 'Bulk scan failed.');
      setBulkScanning(false);
    }
  };

  const bulkPct = bulkResult && bulkResult.total_ips
    ? Math.round((bulkResult.total_done / bulkResult.total_ips) * 100)
    : 0;

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  const TH_CLS = "text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-3 py-2.5 border-b border-border-base text-left";
  const TD_CLS = "px-3 py-2.5 text-sm text-text-base border-b border-border-base";

  return (
    <div>
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-base">Subnet Scanner</h1>
          <p className="text-sm text-text-sec mt-0.5">
            Check all IPs in a subnet against 52 DNSBL providers — any size (/0–/32), batched automatically
          </p>
        </div>
        <div className="flex border border-border-base rounded-lg overflow-hidden">
          {(['single', 'bulk'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${mode === m ? 'bg-accent text-white' : 'text-text-sec hover:bg-subtle'}`}>
              {m === 'single' ? 'Single Subnet' : 'Bulk Scan'}
            </button>
          ))}
        </div>
      </header>

      {/* Single scan mode */}
      {mode === 'single' && (
        <>
          <form onSubmit={handleScan} className="flex gap-2 mb-4">
            <input
              type="text"
              value={cidr}
              onChange={e => setCidr(e.target.value)}
              placeholder="e.g. 178.27.86.0/28"
              required
              disabled={scanning}
              className="flex-1 border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent disabled:opacity-60 transition-colors"
            />
            <button
              type="submit"
              disabled={scanning || !cidr.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-60"
            >
              <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
              {scanning ? 'Scanning…' : 'Scan Subnet'}
            </button>
          </form>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger-bg text-danger px-4 py-3 mb-4 text-sm">{error}</div>
          )}

          {scanning && (
            <div className="bg-surface border border-border-base rounded-xl px-4 py-4 mb-4">
              <div className="flex justify-between text-xs text-text-sec mb-2">
                <span>Checking IPs against 52 DNSBL providers…</span>
                <span className="font-mono font-semibold text-text-base">{progress.done} / {progress.total} IPs</span>
              </div>
              <div className="w-full bg-subtle border border-border-base overflow-hidden rounded-lg" style={{ height: 18 }}>
                <div
                  className="h-full flex items-center justify-center text-[10px] text-white font-semibold transition-all duration-300 rounded-lg"
                  style={{ width: `${pct}%`, minWidth: pct > 0 ? 32 : 0, background: 'var(--accent)' }}
                >
                  {pct > 8 ? `${pct}%` : ''}
                </div>
              </div>
              {progress.total > 0 && (
                <div className="flex justify-between mt-1.5 text-xs text-text-muted">
                  <span>0</span>
                  <span>{progress.total} IPs</span>
                </div>
              )}
            </div>
          )}

          {(liveResults.length > 0 || result) && (() => {
            const displayResults = result ? result.results : liveResults;
            const listed = displayResults.filter(r => r.is_blacklisted).length;
            const cidrLabel = result?.cidr ?? cidr;
            const filtered = displayResults.filter(r =>
              scanFilter === 'all' ? true : scanFilter === 'listed' ? r.is_blacklisted : !r.is_blacklisted
            );
            const totalPages = Math.ceil(filtered.length / scanPageSize);
            const paged = filtered.slice((scanPage - 1) * scanPageSize, scanPage * scanPageSize);
            return (
              <div className="space-y-3">
                <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border-base">
                    <span className="text-sm font-semibold text-text-base">
                      {scanning ? 'Live Results' : 'Scan Results'} — {cidrLabel}
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {!scanning && (
                        <>
                          {subnetAdded ? (
                            <span className="text-xs font-semibold text-success">✓ Subnet monitored</span>
                          ) : (
                            <button onClick={monitorEntireSubnet} disabled={monitoringSubnet}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-60">
                              {monitoringSubnet ? '…' : `Monitor Subnet ${cidrLabel}`}
                            </button>
                          )}
                          {listed > 0 && (
                            <button onClick={addAllListed}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-danger text-white hover:opacity-90 transition-opacity">
                              Add All Listed ({listed})
                            </button>
                          )}
                        </>
                      )}
                      <span className="text-text-sec text-xs">{displayResults.length} {scanning ? 'found so far' : 'IPs scanned'}</span>
                    </div>
                  </div>
                  {result && (
                    <div className="grid grid-cols-3 divide-x divide-border-base">
                      {[
                        { label: 'Total IPs', value: result.total_ips, cls: 'text-text-base' },
                        { label: 'Listed', value: result.listed, cls: 'text-danger' },
                        { label: 'Clean', value: result.clean, cls: 'text-success' },
                      ].map(({ label, value, cls }) => (
                        <div key={label} className="px-4 py-3 text-center">
                          <div className={`text-xl font-bold ${cls}`}>{value}</div>
                          <div className="text-xs text-text-sec uppercase tracking-wide mt-0.5">{label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <style>{`
                  @keyframes rowFeedIn {
                    0%   { opacity: 0; transform: translateX(18px); }
                    35%  { opacity: 1; transform: translateX(-2px); }
                    60%  { transform: translateX(1px); }
                    100% { opacity: 1; transform: translateX(0); }
                  }
                  @keyframes flashDanger {
                    0%,20% { background-color: var(--danger-bg); }
                    100%   { background-color: transparent; }
                  }
                  @keyframes flashSuccess {
                    0%,20% { background-color: var(--success-bg); }
                    100%   { background-color: transparent; }
                  }
                  @keyframes badgePop {
                    0%   { transform: scale(0.6); opacity: 0; }
                    65%  { transform: scale(1.15); opacity: 1; }
                    100% { transform: scale(1); }
                  }
                  .row-feed-listed {
                    animation: rowFeedIn 0.28s cubic-bezier(0.22,1,0.36,1) both,
                               flashDanger 1.1s ease-out both;
                  }
                  .row-feed-clean {
                    animation: rowFeedIn 0.28s cubic-bezier(0.22,1,0.36,1) both,
                               flashSuccess 0.9s ease-out both;
                  }
                  .badge-pop { animation: badgePop 0.32s cubic-bezier(0.34,1.56,0.64,1) both; }
                `}</style>

                <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-border-base flex items-center justify-between flex-wrap gap-2">
                    <span className="text-sm font-semibold text-text-base">
                      {scanning ? `IP Results (live — ${displayResults.length} completed)` : 'IP Results'}
                    </span>
                    <div className="flex items-center gap-3">
                      {/* Filter buttons */}
                      <div className="flex rounded-lg border border-border-base overflow-hidden text-xs font-medium">
                        {(['all', 'listed', 'clean'] as const).map(f => (
                          <button
                            key={f}
                            onClick={() => setScanFilter(f)}
                            className={`px-3 py-1.5 capitalize transition-colors ${
                              scanFilter === f
                                ? f === 'listed' ? 'bg-danger text-white' : f === 'clean' ? 'bg-success text-white' : 'bg-accent text-white'
                                : 'text-text-sec hover:bg-subtle'
                            }`}
                          >
                            {f === 'all' ? `All (${displayResults.length})` : f === 'listed' ? `Listed (${displayResults.filter(r => r.is_blacklisted).length})` : `Clean (${displayResults.filter(r => !r.is_blacklisted).length})`}
                          </button>
                        ))}
                      </div>
                      {/* Page size */}
                      <div className="flex items-center gap-1.5 text-xs text-text-sec">
                        <span>Per page:</span>
                        {SCAN_PAGE_SIZES.map(s => (
                          <button key={s} onClick={() => setScanPageSize(s)}
                            className={`px-2 py-0.5 rounded border text-xs font-medium transition-colors ${scanPageSize === s ? 'bg-accent text-white border-accent' : 'border-border-base text-text-sec hover:bg-subtle'}`}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className={`${TH_CLS} w-20`}>Status</th>
                        <th className={`${TH_CLS} w-36`}>IP Address</th>
                        <th className={`${TH_CLS} w-44`}>Provider / Org</th>
                        <th className={`${TH_CLS} w-24`}>ASN</th>
                        <th className={`${TH_CLS} w-20`}>Country</th>
                        <th className={`${TH_CLS} w-16`}>Score</th>
                        <th className={TH_CLS}>Listed On</th>
                        <th className={`${TH_CLS} w-16`}>Hits</th>
                        <th className={`${TH_CLS} w-28`}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.map((r) => (
                        <tr key={r.ip} className={`${newIps.has(r.ip) ? (r.is_blacklisted ? 'row-feed-listed' : 'row-feed-clean') : ''} hover:bg-subtle transition-colors`}>
                          <td className={TD_CLS}>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.is_blacklisted ? 'bg-danger-bg text-danger' : 'bg-success-bg text-success'} ${newIps.has(r.ip) ? 'badge-pop' : ''}`}>
                              {r.is_blacklisted ? 'Listed' : 'Clean'}
                            </span>
                          </td>
                          <td className={`${TD_CLS} font-mono font-semibold`}>{r.ip}</td>
                          <td className={`${TD_CLS} text-xs text-text-sec max-w-[176px]`} title={r.org || ''}>
                            <div className="truncate">{r.org || '—'}</div>
                          </td>
                          <td className={`${TD_CLS} text-xs font-mono text-text-sec whitespace-nowrap w-24`}>
                            {r.asn || '—'}
                          </td>
                          <td className={`${TD_CLS} text-xs text-text-sec whitespace-nowrap w-20`}>
                            {r.country_code ? (
                              <span title={r.country_name || ''}>{r.country_code}</span>
                            ) : '—'}
                            {r.is_hosting && <span className="ml-1.5 text-[9px] font-bold bg-subtle border border-border-base text-text-muted px-1 py-0.5 rounded uppercase">DC</span>}
                          </td>
                          <td className={TD_CLS}>
                            {(() => {
                              const h = r.hits.length;
                              const base = h === 0 ? 80 : h === 1 ? 50 : h === 2 ? 35 : Math.max(10, 60 - h * 15);
                              const s = Math.max(0, Math.min(100, base - 5 - (r.is_hosting ? 5 : 0)));
                              return (
                                <span className={`text-[11px] font-semibold ${s >= 80 ? 'text-success' : s >= 50 ? 'text-warning' : 'text-danger'}`}>
                                  {s}/100
                                </span>
                              );
                            })()}
                          </td>
                          <td className={TD_CLS}>
                            {r.hits.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {r.hits.map(h => (
                                  <span key={h} className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-danger/30 text-danger bg-danger-bg">{h}</span>
                                ))}
                              </div>
                            ) : <span className="text-text-sec text-xs italic">—</span>}
                          </td>
                          <td className={`${TD_CLS} text-center font-mono font-semibold ${r.is_blacklisted ? 'text-danger' : 'text-success'}`}>
                            {r.hits.length}/{r.total_checked}
                          </td>
                          <td className={TD_CLS}>
                            {added[r.ip] ? (
                              <span className="text-xs font-semibold text-success">✓ Added</span>
                            ) : (
                              <button onClick={() => addToMonitor(r.ip)} disabled={adding[r.ip]}
                                className="px-2.5 py-1 text-xs font-medium rounded-md border border-border-base hover:bg-subtle transition-colors disabled:opacity-60">
                                {adding[r.ip] ? '…' : '+ Monitor'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {totalPages > 1 && (
                    <div className="px-4 py-2.5 border-t border-border-base bg-subtle flex items-center justify-between text-xs text-text-sec">
                      <span>{filtered.length} IPs {scanFilter !== 'all' ? `(filtered from ${displayResults.length})` : ''}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setScanPage(p => Math.max(1, p - 1))} disabled={scanPage === 1}
                          className="px-2 py-1 rounded border border-border-base hover:bg-surface disabled:opacity-40 transition-colors">‹</button>
                        <span className="px-2">{scanPage} / {totalPages}</span>
                        <button onClick={() => setScanPage(p => Math.min(totalPages, p + 1))} disabled={scanPage === totalPages}
                          className="px-2 py-1 rounded border border-border-base hover:bg-surface disabled:opacity-40 transition-colors">›</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* Bulk scan mode */}
      {mode === 'bulk' && (
        <>
          <form onSubmit={handleBulkScan} className="mb-4">
            <p className="text-sm text-text-sec mb-2">One CIDR subnet per line. Max 100 subnets per batch.</p>
            <textarea
              value={bulkCidrs}
              onChange={e => setBulkCidrs(e.target.value)}
              disabled={bulkScanning}
              placeholder={"77.90.141.0/24\n77.90.142.0/24\n213.209.131.0/24\n..."}
              rows={10}
              className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full disabled:opacity-60 resize-none transition-colors"
            />
            <div className="flex gap-2 mt-2">
              <button
                type="submit"
                disabled={bulkScanning || !bulkCidrs.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-60"
              >
                <RefreshCw size={14} className={bulkScanning ? 'animate-spin' : ''} />
                {bulkScanning ? 'Scanning…' : 'Scan All Subnets'}
              </button>
              {bulkCidrs.trim() && (
                <span className="text-sm text-text-sec self-center">
                  {bulkCidrs.split('\n').filter(s => s.trim()).length} subnets
                </span>
              )}
            </div>
          </form>

          {bulkError && (
            <div className="rounded-lg border border-danger/30 bg-danger-bg text-danger px-4 py-3 mb-4 text-sm">{bulkError}</div>
          )}

          {bulkResult && (
            <div className="space-y-3">
              {/* Aggregate progress */}
              <div className="bg-surface border border-border-base rounded-xl px-4 py-4">
                <div className="flex justify-between text-xs text-text-sec mb-2">
                  <span>{bulkResult.complete ? 'Scan complete' : 'Scanning all subnets…'}</span>
                  <span className="font-mono font-semibold text-text-base">{bulkResult.total_done} / {bulkResult.total_ips} IPs</span>
                </div>
                <div className="w-full bg-subtle border border-border-base overflow-hidden rounded-lg mb-3" style={{ height: 18 }}>
                  <div
                    className="h-full flex items-center justify-center text-[10px] text-white font-semibold transition-all duration-300 rounded-lg"
                    style={{ width: `${bulkPct}%`, minWidth: bulkPct > 0 ? 32 : 0, background: bulkResult.complete ? 'var(--success)' : 'var(--accent)' }}
                  >
                    {bulkPct > 8 ? `${bulkPct}%` : ''}
                  </div>
                </div>
                <div className="grid grid-cols-4 divide-x divide-border-base">
                  {[
                    { label: 'Subnets', value: bulkResult.subnet_count, cls: 'text-text-base' },
                    { label: 'Total IPs', value: bulkResult.total_ips, cls: 'text-text-base' },
                    { label: 'Listed', value: bulkResult.total_listed, cls: 'text-danger' },
                    { label: 'Clean', value: bulkResult.total_done - bulkResult.total_listed, cls: 'text-success' },
                  ].map(({ label, value, cls }) => (
                    <div key={label} className="px-3 py-2 text-center">
                      <div className={`text-lg font-bold ${cls}`}>{value}</div>
                      <div className="text-xs text-text-sec uppercase tracking-wide">{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Per-subnet progress table */}
              <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border-base">
                  <span className="text-sm font-semibold text-text-base">Per-Subnet Status</span>
                </div>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      <th className={TH_CLS}>Subnet</th>
                      <th className={`${TH_CLS} w-24`}>Progress</th>
                      <th className={`${TH_CLS} w-20`}>Listed</th>
                      <th className={`${TH_CLS} w-20`}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkResult.subnets.map((s) => {
                      const pctS = s.total ? Math.round((s.done / s.total) * 100) : 0;
                      return (
                        <tr key={s.cidr} className="border-b border-border-base hover:bg-subtle transition-colors">
                          <td className={`${TD_CLS} font-mono font-semibold`}>{s.cidr}</td>
                          <td className={TD_CLS}>
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 bg-subtle border border-border-base overflow-hidden rounded" style={{ height: 8 }}>
                                <div style={{ width: `${pctS}%`, height: '100%', background: s.complete ? 'var(--success)' : 'var(--accent)', transition: 'width 0.3s' }} />
                              </div>
                              <span className="text-xs text-text-sec font-mono w-8 text-right">{pctS}%</span>
                            </div>
                          </td>
                          <td className={`${TD_CLS} text-center font-mono font-semibold ${s.listed > 0 ? 'text-danger' : 'text-success'}`}>
                            {s.listed}
                          </td>
                          <td className={TD_CLS}>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.complete ? 'bg-success-bg text-success' : 'bg-accent-subtle text-accent'}`}>
                              {s.complete ? 'Done' : 'Scanning'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Listed IPs across all subnets */}
              {bulkResult.subnets.some(s => s.results.some(r => r.is_blacklisted)) && (
                <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-danger/30 bg-danger-bg">
                    <span className="text-sm font-semibold text-danger">
                      Listed IPs ({bulkResult.total_listed} total)
                    </span>
                  </div>
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className={`${TH_CLS} w-32`}>IP</th>
                        <th className={`${TH_CLS} w-32`}>Subnet</th>
                        <th className={TH_CLS}>Listed On</th>
                        <th className={`${TH_CLS} w-16`}>Hits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkResult.subnets.flatMap(s =>
                        s.results.filter(r => r.is_blacklisted).map(r => ({ ...r, cidr: s.cidr }))
                      ).map((r, i) => (
                        <tr key={`${r.cidr}-${r.ip}`} className="border-b border-border-base hover:bg-subtle transition-colors">
                          <td className={`${TD_CLS} font-mono font-semibold text-danger`}>{r.ip}</td>
                          <td className={`${TD_CLS} font-mono text-xs text-text-sec`}>{r.cidr}</td>
                          <td className={TD_CLS}>
                            <div className="flex flex-wrap gap-1">
                              {r.hits.map(h => (
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
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
