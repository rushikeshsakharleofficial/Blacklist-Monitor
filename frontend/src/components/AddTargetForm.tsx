import React, { useState, useMemo } from 'react';
import { Plus, Layers } from 'lucide-react';

interface Props {
  onAdd: (value: string) => void;
  onBulkExpand?: (cidr: string) => Promise<{ added: number; skipped: number; total: number }>;
  isLoading: boolean;
}

function parseCIDR(v: string): { valid: boolean; count: number } {
  const m = v.match(/^(\d{1,3}\.){3}\d{1,3}\/(\d{1,2})$/);
  if (!m) return { valid: false, count: 0 };
  const prefix = parseInt(v.split('/')[1]);
  if (prefix < 0 || prefix > 32) return { valid: false, count: 0 };
  const parts = v.split('/')[0].split('.').map(Number);
  if (!parts.every(p => p >= 0 && p <= 255)) return { valid: false, count: 0 };
  const count = prefix >= 31 ? Math.pow(2, 32 - prefix) : Math.max(Math.pow(2, 32 - prefix) - 2, 1);
  return { valid: true, count };
}

const PRIVATE_RANGES = [
  { prefix: [10], mask: 1 },           // 10.0.0.0/8
  { prefix: [172, 16], mask: 2 },      // 172.16–31.0.0/12 (approx)
  { prefix: [192, 168], mask: 2 },     // 192.168.0.0/16
  { prefix: [127], mask: 1 },          // loopback
  { prefix: [169, 254], mask: 2 },     // link-local
  { prefix: [0], mask: 1 },            // 0.0.0.0/8
  { prefix: [100, 64], mask: 2 },      // CGNAT 100.64/10
];

function isPrivateIp(value: string): boolean {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4) return false;
  for (const r of PRIVATE_RANGES) {
    if (r.prefix.every((p, i) => parts[i] === p)) {
      // extra check for 172.16-31 range
      if (r.prefix[0] === 172 && (parts[1] < 16 || parts[1] > 31)) continue;
      return true;
    }
  }
  return false;
}

function validate(value: string): string | null {
  if (value.includes('/')) {
    const { valid } = parseCIDR(value);
    if (!valid) return 'Invalid CIDR (e.g. 192.168.1.0/24)';
    const host = value.split('/')[0];
    if (isPrivateIp(host)) return 'Private/reserved subnets cannot be monitored on public DNSBLs';
    return null;
  }
  const ip = /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
  if (ip) {
    const parts = value.split('.').map(Number);
    if (!parts.every(p => p >= 0 && p <= 255)) return 'Invalid IP octet (0–255)';
    if (isPrivateIp(value)) return 'Private/reserved IPs cannot be monitored on public DNSBLs';
    return null;
  }
  const domain = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(value);
  if (domain) return null;
  return 'Enter a valid IP, domain, or CIDR (e.g. 192.168.1.0/24)';
}

const AddTargetForm: React.FC<Props> = ({ onAdd, onBulkExpand, isLoading }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [expandResult, setExpandResult] = useState<string | null>(null);

  const trimmed = value.trim().toLowerCase();
  const isCIDR = trimmed.includes('/');
  const cidrInfo = useMemo(() => isCIDR ? parseCIDR(trimmed) : { valid: false, count: 0 }, [trimmed, isCIDR]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate(trimmed);
    if (err) { setError(err); return; }
    setError(null);
    setExpandResult(null);
    onAdd(trimmed);
    setValue('');
  };

  const handleBulkExpand = async () => {
    if (!onBulkExpand) return;
    const err = validate(trimmed);
    if (err) { setError(err); return; }
    setError(null);
    setExpandResult(null);
    setExpanding(true);
    try {
      const r = await onBulkExpand(trimmed);
      setExpandResult(`Added ${r.added} IPs${r.skipped ? `, ${r.skipped} already monitored` : ''}`);
      setValue('');
    } catch (e: any) {
      setError(e.message || 'Bulk expand failed');
    } finally {
      setExpanding(false);
    }
  };

  return (
    <div className="mb-0">
      <form onSubmit={handleSubmit} className="flex items-start gap-2">
        <div className="flex-1">
          <input
            value={value}
            onChange={e => { setValue(e.target.value); setError(null); setExpandResult(null); }}
            placeholder="IP, domain, or subnet CIDR (e.g. 192.168.1.0/24)"
            className="w-full px-3 py-1.5 text-xs border border-panel-border bg-white font-mono focus:outline-none focus:border-primary"
            style={{ borderRadius: 2 }}
          />
          {error && <div className="text-danger text-[11px] mt-0.5">{error}</div>}
          {expandResult && <div className="text-success text-[11px] mt-0.5 font-bold">✓ {expandResult}</div>}
        </div>

        {isCIDR && cidrInfo.valid ? (
          <div className="flex gap-1 shrink-0">
            <button
              type="submit"
              disabled={isLoading || !trimmed}
              title="Add subnet as a single monitored entity"
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase text-white border border-[#2a5580] disabled:opacity-50"
              style={{ background: '#336699', borderRadius: 2 }}
            >
              <Plus size={12} />
              {isLoading ? 'Adding…' : 'Monitor Subnet'}
            </button>
            <button
              type="button"
              onClick={handleBulkExpand}
              disabled={expanding || isLoading || cidrInfo.count > 65534}
              title={cidrInfo.count > 65534 ? 'Too many IPs — max /16' : `Expand and add all ${cidrInfo.count} IPs individually`}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase text-white border border-[#1a6b3c] disabled:opacity-50"
              style={{ background: expanding ? '#1a6b3c' : '#27ae60', borderRadius: 2 }}
            >
              <Layers size={12} className={expanding ? 'animate-spin' : ''} />
              {expanding ? 'Adding…' : `Expand ${cidrInfo.count.toLocaleString()} IPs`}
            </button>
          </div>
        ) : (
          <button
            type="submit"
            disabled={isLoading || !trimmed}
            className="flex items-center gap-1 px-4 py-1.5 text-xs font-bold uppercase text-white border border-[#2a5580] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            style={{ background: '#336699', borderRadius: 2 }}
          >
            <Plus size={12} />
            {isLoading ? 'Adding…' : '+ Add to Monitor'}
          </button>
        )}
      </form>
    </div>
  );
};

export default AddTargetForm;
