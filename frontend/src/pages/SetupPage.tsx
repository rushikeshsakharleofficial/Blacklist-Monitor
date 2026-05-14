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
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', api_key: generateKey() });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
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
        name: form.name,
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
    <div className="min-h-screen bg-app flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent)' }}>
            <Shield size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold text-text-base">Guardly</span>
        </div>

        <div className="bg-surface border border-border-base rounded-xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-text-base mb-1">First Time Setup</h2>
          <p className="text-xs text-text-sec mb-5">Create your admin account to get started.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">Full Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="John Doe"
                className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">Admin Email</label>
              <input
                type="email" required
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="admin@yourcompany.com"
                className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full font-mono transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">Password</label>
              <input
                type="password" required minLength={8}
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder="Min. 8 characters"
                className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">Confirm Password</label>
              <input
                type="password" required
                value={form.confirm}
                onChange={e => setForm({ ...form, confirm: e.target.value })}
                placeholder="Repeat password"
                className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">API Key</label>
              <div className="flex gap-2">
                <input
                  type="text" required
                  value={form.api_key}
                  onChange={e => setForm({ ...form, api_key: e.target.value })}
                  className="flex-1 border border-border-base rounded-lg px-3 py-2 text-xs bg-surface text-text-base font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, api_key: generateKey() })}
                  className="px-2.5 py-2 text-xs border border-border-base rounded-lg bg-subtle hover:bg-hover-bg transition-colors flex items-center gap-1 text-text-sec"
                  title="Regenerate"
                >
                  <RefreshCw size={12} />
                </button>
              </div>
              <p className="text-xs text-text-muted mt-1">Save this key — it's used for API access.</p>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-accent-hover text-white rounded-lg py-2 font-medium text-sm transition-colors disabled:opacity-60"
            >
              {loading ? 'Creating Admin…' : 'Complete Setup'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-text-muted mt-4">Guardly — DNSBL Monitoring Platform</p>
      </div>
    </div>
  );
}
