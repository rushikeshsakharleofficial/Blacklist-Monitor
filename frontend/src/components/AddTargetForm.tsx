import React, { useState } from 'react';
import { Plus, Search, Shield } from 'lucide-react';

interface AddTargetFormProps {
  onAdd: (value: string) => void;
  isLoading: boolean;
}

const AddTargetForm: React.FC<AddTargetFormProps> = ({ onAdd, isLoading }) => {
  const [value, setValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const validate = (input: string): string | null => {
    const trimmed = input.trim();

    if (!trimmed) {
      return null;
    }

    // IP validation: 4 octets separated by dots, each 0-255
    const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = trimmed.match(ipRegex);

    if (ipMatch) {
      const [, octet1, octet2, octet3, octet4] = ipMatch;
      const octets = [octet1, octet2, octet3, octet4].map(Number);

      if (octets.every(octet => octet >= 0 && octet <= 255)) {
        return null; // Valid IP
      }
      return 'Invalid IP address. Each octet must be 0-255.';
    }

    // Domain validation: at least one dot, labels contain only letters/digits/hyphens,
    // labels don't start/end with hyphen, TLD at least 2 chars
    const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

    if (domainRegex.test(trimmed)) {
      return null; // Valid domain
    }

    // If it doesn't match IP or domain pattern, it's invalid
    return 'Please enter a valid IP address (e.g., 192.168.1.1) or domain (e.g., example.com).';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const error = validate(value);

    if (error) {
      setValidationError(error);
      return;
    }

    if (value.trim()) {
      onAdd(value.trim());
      setValue('');
      setValidationError(null);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    setValidationError(null);
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-border shadow-soft mb-8">
      <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
            <Search size={20} />
          </div>
          <input
            type="text"
            value={value}
            onChange={handleInputChange}
            placeholder="Search IP, Domain or URL..."
            className="block w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-slate-400 font-medium"
            disabled={isLoading}
          />
          {validationError && (
            <p className="text-xs text-rose-600 mt-2 font-medium">
              {validationError}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={isLoading || !value.trim() || validationError !== null}
          className="flex items-center justify-center gap-2 px-8 py-3.5 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary/25 whitespace-nowrap"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Plus size={20} />
          )}
          {isLoading ? 'SECURELY ADDING...' : 'MONITOR ASSET'}
        </button>
      </form>
      <p className="text-[11px] text-slate-400 mt-3 font-medium flex items-center gap-1">
        <Shield size={12} />
        Assets are checked against major DNSBL blacklists every 30 minutes.
      </p>
    </div>
  );
};

export default AddTargetForm;
