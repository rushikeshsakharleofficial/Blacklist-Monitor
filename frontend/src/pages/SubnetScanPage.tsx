import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { RefreshCw } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const STORAGE_KEY = 'api_key';

interface ScanResult {
  ip: string;
  hits: string[];
  is_blacklisted: boolean;
  total_checked: number;
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

export default function SubnetScanPage() {
  const [cidr, setCidr] = useState('');
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [monitoringSubnet, setMonitoringSubnet] = useState(false);
  const [subnetAdded, setSubnetAdded] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current as unknown as ReturnType<typeof setTimeout>); }, []);

  const apiKey = localStorage.getItem(STORAGE_KEY) || '';
  const headers = { 'X-API-Key': apiKey };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    setScanning(true);
    setError(null);
    setResult(null);
    setAdded({});
    setSubnetAdded(false);
    setProgress({ done: 0, total: 0 });

    try {
      const res = await axios.post(`${API_BASE_URL}/scan/subnet`, { cidr }, { headers });
      const { scan_id, total } = res.data;
      setProgress({ done: 0, total });

      // Use recursive setTimeout — schedules next poll only AFTER current response,
      // avoiding the setInterval async race where next tick is queued before clearInterval runs.
      const poll = async () => {
        try {
          const prog = await axios.get(`${API_BASE_URL}/scan/subnet/${scan_id}`, { headers });
          const data: ScanResponse = prog.data;
          setProgress({ done: data.done, total: data.total_ips });
          if (data.complete) {
            pollRef.current = null;
            setScanning(false);
            setResult(data);
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
      else alert(err.response?.data?.detail || 'Failed to add subnet');
    } finally {
      setMonitoringSubnet(false);
    }
  };

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
      </header>

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

      {result && (
        <div className="space-y-3">
          <div className="border border-panel-border">
            <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
              <span className="text-white text-[11px] font-bold uppercase tracking-wider">
                Scan Results — {result.cidr}
              </span>
              <div className="flex items-center gap-2">
                {subnetAdded ? (
                  <span className="text-[10px] font-bold text-success">✓ Subnet monitored</span>
                ) : (
                  <button
                    onClick={monitorEntireSubnet}
                    disabled={monitoringSubnet}
                    className="text-[10px] font-bold px-2 py-1 text-white border border-[#2a5580] disabled:opacity-60"
                    style={{ background: '#336699', borderRadius: 2 }}
                  >
                    {monitoringSubnet ? '…' : `Monitor Subnet ${result.cidr}`}
                  </button>
                )}
                {result.listed > 0 && (
                  <button
                    onClick={addAllListed}
                    className="text-[10px] font-bold px-2 py-1 text-white border border-[#c0392b]"
                    style={{ background: '#e74c3c', borderRadius: 2 }}
                  >
                    Add All Listed ({result.listed})
                  </button>
                )}
                <span className="text-[#8ab4c8] text-[10px]">{result.total_ips} IPs scanned</span>
              </div>
            </div>
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
          </div>

          <div className="border border-panel-border">
            <div className="px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
              <span className="text-white text-[11px] font-bold uppercase tracking-wider">IP Results</span>
            </div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr style={{ background: '#2c3e50', color: 'white' }}>
                  <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-20">Status</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-36">IP Address</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166]">Listed On</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-16">Hits</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-28">Action</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r, i) => (
                  <tr key={r.ip} className={i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}>
                    <td className="px-3 py-1.5 border border-panel-border">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 text-white uppercase" style={{ background: r.is_blacklisted ? '#e74c3c' : '#27ae60', borderRadius: 2 }}>
                        {r.is_blacklisted ? 'LISTED' : 'CLEAN'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 border border-panel-border font-mono font-bold text-foreground">{r.ip}</td>
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
                        <button
                          onClick={() => addToMonitor(r.ip)}
                          disabled={adding[r.ip]}
                          className="text-[10px] font-bold px-2 py-1 border border-panel-border bg-white hover:bg-row-alt disabled:opacity-60 uppercase"
                          style={{ borderRadius: 2 }}
                        >
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
      )}
    </div>
  );
}
