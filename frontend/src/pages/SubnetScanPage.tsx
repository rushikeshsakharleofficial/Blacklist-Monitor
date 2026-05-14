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

  // Single scan state
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

  // Bulk scan state
  const [bulkCidrs, setBulkCidrs] = useState('');
  const [bulkScanning, setBulkScanning] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkScanResponse | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const bulkPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apiKey = localStorage.getItem(STORAGE_KEY) || '';
  const headers = { 'X-API-Key': apiKey };

  // Resume in-progress scans after page refresh
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

  // ── Single scan ──────────────────────────────────────────────────────────────
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

  // ── Bulk scan ────────────────────────────────────────────────────────────────
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

  return (
    <div>
      <header className="flex justify-between items-center mb-4 border-b border-panel-border pb-2">
        <div>
          <h1 className="text-base font-bold text-foreground uppercase tracking-wide">Subnet Scanner</h1>
          <p className="text-muted text-[11px] mt-0.5">
            Check all IPs in a subnet against 52 DNSBL providers — any size (/0–/32), batched automatically
          </p>
        </div>
        <div className="flex border border-panel-border overflow-hidden" style={{ borderRadius: 2 }}>
          {(['single', 'bulk'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors"
              style={{
                background: mode === m ? '#336699' : 'white',
                color: mode === m ? 'white' : '#555',
                borderRight: m === 'single' ? '1px solid #ddd' : undefined,
              }}>
              {m === 'single' ? 'Single Subnet' : 'Bulk Scan'}
            </button>
          ))}
        </div>
      </header>

      {/* ── Single scan mode ── */}
      {mode === 'single' && (
        <>
          <form onSubmit={handleScan} className="flex gap-2 mb-4">
            <input
              type="text"
              value={cidr}
              onChange={e => setCidr(e.target.value)}
              placeholder="e.g. 10.0.0.0/8, 192.168.1.0/24, 178.27.86.0/28"
              required
              disabled={scanning}
              className="flex-1 px-3 py-2 text-xs border border-panel-border font-mono focus:outline-none focus:border-primary disabled:opacity-60"
              style={{ borderRadius: 2 }}
            />
            <button
              type="submit"
              disabled={scanning || !cidr.trim()}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase text-white border border-[#2a5580] disabled:opacity-60"
              style={{ background: '#336699', borderRadius: 2 }}
            >
              <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
              {scanning ? 'Scanning…' : 'Scan Subnet'}
            </button>
          </form>

          {error && (
            <div className="border border-danger bg-danger-bg text-danger px-4 py-2 mb-4 text-xs">{error}</div>
          )}

          {scanning && (
            <div className="border border-panel-border bg-white px-4 py-4 mb-4">
              <div className="flex justify-between text-[10px] text-muted mb-1.5">
                <span>Checking IPs against 52 DNSBL providers…</span>
                <span className="font-mono font-bold text-foreground">{progress.done} / {progress.total} IPs</span>
              </div>
              <div className="w-full bg-row-alt border border-panel-border overflow-hidden" style={{ height: 18, borderRadius: 2 }}>
                <div
                  className="h-full flex items-center justify-center text-[9px] text-white font-bold transition-all duration-300"
                  style={{ width: `${pct}%`, minWidth: pct > 0 ? 32 : 0, background: '#336699', borderRadius: 2 }}
                >
                  {pct > 8 ? `${pct}%` : ''}
                </div>
              </div>
              {progress.total > 0 && (
                <div className="flex justify-between mt-1.5 text-[10px] text-muted">
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
            return (
              <div className="space-y-3">
                <div className="border border-panel-border">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
                    <span className="text-white text-[11px] font-bold uppercase tracking-wider">
                      {scanning ? 'Live Results' : 'Scan Results'} — {cidrLabel}
                    </span>
                    <div className="flex items-center gap-2">
                      {!scanning && (
                        <>
                          {subnetAdded ? (
                            <span className="text-[10px] font-bold text-success">✓ Subnet monitored</span>
                          ) : (
                            <button onClick={monitorEntireSubnet} disabled={monitoringSubnet}
                              className="text-[10px] font-bold px-2 py-1 text-white border border-[#2a5580] disabled:opacity-60"
                              style={{ background: '#336699', borderRadius: 2 }}>
                              {monitoringSubnet ? '…' : `Monitor Subnet ${cidrLabel}`}
                            </button>
                          )}
                          {listed > 0 && (
                            <button onClick={addAllListed}
                              className="text-[10px] font-bold px-2 py-1 text-white border border-[#c0392b]"
                              style={{ background: '#e74c3c', borderRadius: 2 }}>
                              Add All Listed ({listed})
                            </button>
                          )}
                        </>
                      )}
                      <span className="text-[#8ab4c8] text-[10px]">{displayResults.length} {scanning ? 'found so far' : 'IPs scanned'}</span>
                    </div>
                  </div>
                  {result && (
                    <div className="grid grid-cols-3 divide-x divide-panel-border bg-white">
                      {[
                        { label: 'Total IPs', value: result.total_ips, color: 'text-foreground' },
                        { label: 'Listed', value: result.listed, color: 'text-danger' },
                        { label: 'Clean', value: result.clean, color: 'text-success' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="px-4 py-3 text-center">
                          <div className={`text-xl font-bold ${color}`}>{value}</div>
                          <div className="text-[10px] text-muted uppercase tracking-wide mt-0.5">{label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <style>{`
                  @keyframes zoomIn {
                    from { opacity: 0; transform: scale(0.92) translateY(-6px); }
                    to   { opacity: 1; transform: scale(1) translateY(0); }
                  }
                  .row-zoom-in { animation: zoomIn 0.35s ease-out both; }
                `}</style>

                <div className="border border-panel-border">
                  <div className="px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
                    <span className="text-white text-[11px] font-bold uppercase tracking-wider">
                      {scanning ? `IP Results (live — ${displayResults.length} completed)` : 'IP Results'}
                    </span>
                  </div>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr style={{ background: '#2c3e50', color: 'white' }}>
                        <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-20">Status</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-36">IP Address</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-44">Provider / Org</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166]">Listed On</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-16">Hits</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-28">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayResults.map((r, i) => (
                        <tr key={r.ip}
                          className={`${newIps.has(r.ip) ? 'row-zoom-in' : ''} ${i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}`}>
                          <td className="px-3 py-1.5 border border-panel-border">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 text-white uppercase" style={{ background: r.is_blacklisted ? '#e74c3c' : '#27ae60', borderRadius: 2 }}>
                              {r.is_blacklisted ? 'LISTED' : 'CLEAN'}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 border border-panel-border font-mono font-bold text-foreground">{r.ip}</td>
                          <td className="px-3 py-1.5 border border-panel-border text-[10px] text-muted truncate max-w-[176px]" title={r.org || ''}>{r.org || '—'}</td>
                          <td className="px-3 py-1.5 border border-panel-border">
                            {r.hits.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {r.hits.map(h => (
                                  <span key={h} className="font-mono text-[10px] px-1.5 py-0.5 border border-danger text-danger" style={{ borderRadius: 2, background: '#fce8e6' }}>{h}</span>
                                ))}
                              </div>
                            ) : <span className="text-muted text-[10px] italic">—</span>}
                          </td>
                          <td className="px-3 py-1.5 border border-panel-border text-center font-mono font-bold" style={{ color: r.is_blacklisted ? '#e74c3c' : '#27ae60' }}>
                            {r.hits.length}/{r.total_checked}
                          </td>
                          <td className="px-3 py-1.5 border border-panel-border">
                            {added[r.ip] ? (
                              <span className="text-[10px] font-bold text-success">✓ Added</span>
                            ) : (
                              <button onClick={() => addToMonitor(r.ip)} disabled={adding[r.ip]}
                                className="text-[10px] font-bold px-2 py-1 border border-panel-border bg-white hover:bg-row-alt disabled:opacity-60 uppercase"
                                style={{ borderRadius: 2 }}>
                                {adding[r.ip] ? '…' : '+ Monitor'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* ── Bulk scan mode ── */}
      {mode === 'bulk' && (
        <>
          <form onSubmit={handleBulkScan} className="mb-4">
            <p className="text-muted text-[11px] mb-2">One CIDR subnet per line. Max 100 subnets per batch.</p>
            <textarea
              value={bulkCidrs}
              onChange={e => setBulkCidrs(e.target.value)}
              disabled={bulkScanning}
              placeholder={"77.90.141.0/24\n77.90.142.0/24\n213.209.131.0/24\n..."}
              rows={10}
              className="w-full px-3 py-2 text-xs border border-panel-border font-mono focus:outline-none focus:border-primary disabled:opacity-60 resize-none"
              style={{ borderRadius: 2 }}
            />
            <div className="flex gap-2 mt-2">
              <button
                type="submit"
                disabled={bulkScanning || !bulkCidrs.trim()}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase text-white border border-[#2a5580] disabled:opacity-60"
                style={{ background: '#336699', borderRadius: 2 }}
              >
                <RefreshCw size={12} className={bulkScanning ? 'animate-spin' : ''} />
                {bulkScanning ? 'Scanning…' : 'Scan All Subnets'}
              </button>
              {bulkCidrs.trim() && (
                <span className="text-[11px] text-muted self-center">
                  {bulkCidrs.split('\n').filter(s => s.trim()).length} subnets
                </span>
              )}
            </div>
          </form>

          {bulkError && (
            <div className="border border-danger bg-danger-bg text-danger px-4 py-2 mb-4 text-xs">{bulkError}</div>
          )}

          {bulkResult && (
            <div className="space-y-3">
              {/* Aggregate progress */}
              <div className="border border-panel-border bg-white px-4 py-4">
                <div className="flex justify-between text-[10px] text-muted mb-1.5">
                  <span>{bulkResult.complete ? 'Scan complete' : 'Scanning all subnets…'}</span>
                  <span className="font-mono font-bold text-foreground">{bulkResult.total_done} / {bulkResult.total_ips} IPs</span>
                </div>
                <div className="w-full bg-row-alt border border-panel-border overflow-hidden mb-3" style={{ height: 18, borderRadius: 2 }}>
                  <div
                    className="h-full flex items-center justify-center text-[9px] text-white font-bold transition-all duration-300"
                    style={{ width: `${bulkPct}%`, minWidth: bulkPct > 0 ? 32 : 0, background: bulkResult.complete ? '#27ae60' : '#336699', borderRadius: 2 }}
                  >
                    {bulkPct > 8 ? `${bulkPct}%` : ''}
                  </div>
                </div>
                <div className="grid grid-cols-4 divide-x divide-panel-border">
                  {[
                    { label: 'Subnets', value: bulkResult.subnet_count, color: 'text-foreground' },
                    { label: 'Total IPs', value: bulkResult.total_ips, color: 'text-foreground' },
                    { label: 'Listed', value: bulkResult.total_listed, color: 'text-danger' },
                    { label: 'Clean', value: bulkResult.total_done - bulkResult.total_listed, color: 'text-success' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="px-3 py-2 text-center">
                      <div className={`text-lg font-bold ${color}`}>{value}</div>
                      <div className="text-[10px] text-muted uppercase tracking-wide">{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Per-subnet progress table */}
              <div className="border border-panel-border">
                <div className="px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
                  <span className="text-white text-[11px] font-bold uppercase tracking-wider">Per-Subnet Status</span>
                </div>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr style={{ background: '#2c3e50', color: 'white' }}>
                      <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166]">Subnet</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-24">Progress</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-20">Listed</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-20">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkResult.subnets.map((s, i) => {
                      const pctS = s.total ? Math.round((s.done / s.total) * 100) : 0;
                      return (
                        <tr key={s.cidr} className={i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}>
                          <td className="px-3 py-1.5 border border-panel-border font-mono font-bold text-foreground">{s.cidr}</td>
                          <td className="px-3 py-1.5 border border-panel-border">
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 bg-row-alt border border-panel-border overflow-hidden" style={{ height: 8, borderRadius: 2 }}>
                                <div style={{ width: `${pctS}%`, height: '100%', background: s.complete ? '#27ae60' : '#336699', borderRadius: 2, transition: 'width 0.3s' }} />
                              </div>
                              <span className="text-[10px] text-muted font-mono w-8 text-right">{pctS}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-1.5 border border-panel-border text-center font-mono font-bold" style={{ color: s.listed > 0 ? '#e74c3c' : '#27ae60' }}>
                            {s.listed}
                          </td>
                          <td className="px-3 py-1.5 border border-panel-border">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 text-white uppercase" style={{ background: s.complete ? '#27ae60' : '#336699', borderRadius: 2 }}>
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
                <div className="border border-panel-border">
                  <div className="px-3 py-2 border-b border-panel-border" style={{ background: '#c0392b' }}>
                    <span className="text-white text-[11px] font-bold uppercase tracking-wider">
                      Listed IPs ({bulkResult.total_listed} total)
                    </span>
                  </div>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr style={{ background: '#2c3e50', color: 'white' }}>
                        <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-32">IP</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-32">Subnet</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166]">Listed On</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-16">Hits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkResult.subnets.flatMap(s =>
                        s.results.filter(r => r.is_blacklisted).map(r => ({ ...r, cidr: s.cidr }))
                      ).map((r, i) => (
                        <tr key={`${r.cidr}-${r.ip}`} className={i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}>
                          <td className="px-3 py-1.5 border border-panel-border font-mono font-bold text-danger">{r.ip}</td>
                          <td className="px-3 py-1.5 border border-panel-border font-mono text-[10px] text-muted">{r.cidr}</td>
                          <td className="px-3 py-1.5 border border-panel-border">
                            <div className="flex flex-wrap gap-1">
                              {r.hits.map(h => (
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
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
