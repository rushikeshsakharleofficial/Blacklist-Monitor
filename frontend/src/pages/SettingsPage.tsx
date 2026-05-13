import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Settings, Key, LogOut, Server } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const STORAGE_KEY = 'api_key';

interface SettingsPageProps {
  onLogout: () => void;
}

export default function SettingsPage({ onLogout }: SettingsPageProps) {
  const [providers, setProviders] = useState<string[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);

  useEffect(() => {
    const apiKey = localStorage.getItem(STORAGE_KEY) || '';
    axios
      .get(`${API_BASE_URL}/dnsbl-providers`, { headers: { 'X-API-Key': apiKey } })
      .then(res => setProviders(res.data.providers ?? []))
      .catch(() => setProviders([]))
      .finally(() => setLoadingProviders(false));
  }, []);

  return (
    <div>
      <header className="flex justify-between items-center mb-4 border-b border-panel-border pb-2">
        <div>
          <h1 className="text-base font-bold text-foreground uppercase tracking-wide">Settings</h1>
          <p className="text-muted text-[11px] mt-0.5">Application configuration and account management</p>
        </div>
      </header>

      <div className="max-w-2xl space-y-4">
        {/* API Authentication */}
        <div className="border border-panel-border">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
            <Key size={13} className="text-[#8ab4c8]" />
            <span className="text-white text-[11px] font-bold uppercase tracking-wider">API Authentication</span>
          </div>
          <div className="bg-white p-4">
            <p className="text-xs font-bold text-foreground mb-1">X-API-Key header authentication</p>
            <p className="text-xs text-muted">
              API key is stored locally in your browser. Set a strong key via the{' '}
              <code className="bg-row-alt border border-panel-border px-1 font-mono text-[11px]">API_KEY</code>{' '}
              environment variable on the backend.
            </p>
          </div>
        </div>

        {/* DNSBL Providers */}
        <div className="border border-panel-border">
          <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
            <div className="flex items-center gap-2">
              <Server size={13} className="text-[#8ab4c8]" />
              <span className="text-white text-[11px] font-bold uppercase tracking-wider">DNSBL Providers</span>
            </div>
            {!loadingProviders && (
              <span className="text-[#8ab4c8] text-[10px] font-bold">{providers.length} ACTIVE</span>
            )}
          </div>
          <div className="bg-white">
            {loadingProviders ? (
              <div className="px-4 py-6 text-center text-muted text-xs">Loading providers…</div>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-row-alt border-b border-panel-border">
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted w-10">#</th>
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted">Provider Zone</th>
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted w-24">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((dnsbl, i) => (
                    <tr key={dnsbl} className={i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}>
                      <td className="px-3 py-1.5 border-t border-panel-border text-muted text-[10px]">{i + 1}</td>
                      <td className="px-3 py-1.5 border-t border-panel-border font-mono text-foreground">{dnsbl}</td>
                      <td className="px-3 py-1.5 border-t border-panel-border">
                        <span className="text-[10px] font-bold px-2 py-0.5 text-white uppercase tracking-wide" style={{ background: '#27ae60', borderRadius: 2 }}>
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Session */}
        <div className="border border-panel-border">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
            <LogOut size={13} className="text-[#8ab4c8]" />
            <span className="text-white text-[11px] font-bold uppercase tracking-wider">Session</span>
          </div>
          <div className="bg-white p-4">
            <p className="text-xs text-muted mb-3">Manage your current monitoring console session.</p>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold uppercase text-white border border-[#c0392b]"
              style={{ background: '#e74c3c', borderRadius: 2 }}
            >
              <LogOut size={12} />
              Sign Out
            </button>
          </div>
        </div>

        {/* Advanced Settings */}
        <div className="border border-panel-border">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
            <Settings size={13} className="text-[#8ab4c8]" />
            <span className="text-white text-[11px] font-bold uppercase tracking-wider">Advanced Settings</span>
          </div>
          <div className="bg-white p-8 text-center">
            <Settings size={28} className="text-muted mx-auto mb-3 opacity-40" />
            <p className="text-xs font-bold text-foreground mb-1 uppercase tracking-wide">Planned Feature</p>
            <p className="text-xs text-muted max-w-md mx-auto">
              Custom DNSBL providers, check intervals, and notification preferences coming in a future release.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
