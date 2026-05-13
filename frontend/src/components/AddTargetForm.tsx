import React, { useState } from 'react';
import { Plus } from 'lucide-react';

interface Props {
  onAdd: (value: string) => void;
  isLoading: boolean;
}

function validate(value: string): string | null {
  const ip = /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
  if (ip) {
    const parts = value.split('.').map(Number);
    if (!parts.every(p => p >= 0 && p <= 255)) return 'Invalid IP octet range (0-255)';
    return null;
  }
  const domain = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(value);
  if (domain) return null;
  return 'Enter a valid IP address or domain name';
}

const AddTargetForm: React.FC<Props> = ({ onAdd, isLoading }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate(value.trim().toLowerCase());
    if (err) { setError(err); return; }
    setError(null);
    onAdd(value.trim().toLowerCase());
    setValue('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-start gap-2 mb-0">
      <div className="flex-1">
        <input
          value={value}
          onChange={e => { setValue(e.target.value); setError(null); }}
          placeholder="Enter IP address or domain (e.g. 8.8.8.8 or example.com)"
          className="w-full px-3 py-1.5 text-xs border border-panel-border bg-white font-mono focus:outline-none focus:border-primary"
          style={{ borderRadius: 2 }}
        />
        {error && <div className="text-danger text-[11px] mt-0.5">{error}</div>}
      </div>
      <button
        type="submit"
        disabled={isLoading || !value.trim()}
        className="flex items-center gap-1 px-4 py-1.5 text-xs font-bold uppercase text-white border border-[#2a5580] disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: '#336699', borderRadius: 2 }}
      >
        <Plus size={12} />
        {isLoading ? 'Adding...' : 'Add to Monitor'}
      </button>
    </form>
  );
};

export default AddTargetForm;
