import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Shield, RefreshCw } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

function generateKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 40 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function SetupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', confirm: '', api_key: generateKey() });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Redirect to login if already set up
    axios.get(`${API_BASE_URL}/setup-status`).then(res => {
      if (!res.data.needs_setup) navigate('/login', { replace: true });
    }).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) { setError('Passwords do not match'); return; }
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    setError(null);
    try {
      await axios.post(`${API_BASE_URL}/setup`, {
        email: form.email,
        password: form.password,
        api_key: form.api_key,
      });
      navigate('/login', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Setup failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-[400px]">
        <div className="border border-panel-border" style={{ borderRadius: 4 }}>
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-panel-border" style={{ background: '#1e2d3d' }}>
            <Shield size={14} className="text-[#336699]" />
            <span className="text-white text-xs font-bold uppercase tracking-widest">Blacklist Monitor — First Time Setup</span>
          </div>
          <div className="bg-white p-5">
            <p className="text-[11px] text-muted mb-4">Create your admin account to get started.</p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-foreground mb-1">Admin Email</label>
                <input
                  type="email" required
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="admin@yourcompany.com"
                  className="w-full px-2.5 py-1.5 text-xs border border-panel-border font-mono focus:outline-none focus:border-primary"
                  style={{ borderRadius: 2 }}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-foreground mb-1">Password</label>
                <input
                  type="password" required minLength={8}
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="Min. 8 characters"
                  className="w-full px-2.5 py-1.5 text-xs border border-panel-border focus:outline-none focus:border-primary"
                  style={{ borderRadius: 2 }}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-foreground mb-1">Confirm Password</label>
                <input
                  type="password" required
                  value={form.confirm}
                  onChange={e => setForm({ ...form, confirm: e.target.value })}
                  placeholder="Repeat password"
                  className="w-full px-2.5 py-1.5 text-xs border border-panel-border focus:outline-none focus:border-primary"
                  style={{ borderRadius: 2 }}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-foreground mb-1">API Key</label>
                <div className="flex gap-1">
                  <input
                    type="text" required
                    value={form.api_key}
                    onChange={e => setForm({ ...form, api_key: e.target.value })}
                    className="flex-1 px-2.5 py-1.5 text-[10px] border border-panel-border font-mono focus:outline-none focus:border-primary"
                    style={{ borderRadius: 2 }}
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, api_key: generateKey() })}
                    className="px-2.5 py-1.5 text-[10px] border border-panel-border bg-row-alt hover:bg-background flex items-center gap-1"
                    style={{ borderRadius: 2 }}
                    title="Regenerate"
                  >
                    <RefreshCw size={10} />
                  </button>
                </div>
                <p className="text-[10px] text-muted mt-1">Save this key — it's used for API access.</p>
              </div>
              {error && <p className="text-danger text-[11px]">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 text-xs font-bold uppercase text-white border border-[#2a5580] disabled:opacity-60"
                style={{ background: '#336699', borderRadius: 2 }}
              >
                {loading ? 'Creating Admin…' : 'Complete Setup'}
              </button>
            </form>
          </div>
        </div>
        <p className="text-center text-[10px] text-muted mt-3">Blacklist Monitor v1.0 — DNSBL Monitoring Platform</p>
      </div>
    </div>
  );
}
