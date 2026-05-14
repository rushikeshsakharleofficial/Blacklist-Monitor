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

function isPrivateIp(v: string): boolean {
  const p = v.split('.').map(Number);
  if (p.length !== 4 || !p.every(n => n >= 0 && n <= 255)) return false;
  return (
    p[0] === 10 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    p[0] === 127 ||
    (p[0] === 169 && p[1] === 254) ||
    p[0] === 0 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
  );
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
            placeholder="IP, domain, or subnet CIDR (e.g. 8.8.8.0/24)"
            className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full font-mono transition-colors"
          />
          {error && <div className="text-danger text-xs mt-1">{error}</div>}
          {expandResult && <div className="text-success text-xs mt-1 font-medium">✓ {expandResult}</div>}
        </div>

        {isCIDR && cidrInfo.valid ? (
          <div className="flex gap-1.5 shrink-0">
            <button
              type="submit"
              disabled={isLoading || !trimmed}
              title="Add subnet as a single monitored entity"
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              <Plus size={14} />
              {isLoading ? 'Adding…' : 'Monitor Subnet'}
            </button>
            <button
              type="button"
              onClick={handleBulkExpand}
              disabled={expanding || isLoading || cidrInfo.count > 65534}
              title={cidrInfo.count > 65534 ? 'Too many IPs — max /16' : `Expand and add all ${cidrInfo.count} IPs individually`}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-success text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Layers size={14} className={expanding ? 'animate-spin' : ''} />
              {expanding ? 'Adding…' : `Expand ${cidrInfo.count.toLocaleString()} IPs`}
            </button>
          </div>
        ) : (
          <button
            type="submit"
            disabled={isLoading || !trimmed}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <Plus size={14} />
            {isLoading ? 'Adding…' : 'Add to Monitor'}
          </button>
        )}
      </form>
    </div>
  );
};

export default AddTargetForm;
