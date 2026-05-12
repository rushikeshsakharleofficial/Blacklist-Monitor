import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, ShieldAlert, Activity, RefreshCw } from 'lucide-react';
import Sidebar from './components/Sidebar';
import StatCard from './components/StatCard';
import TargetTable, { Target } from './components/TargetTable';
import AddTargetForm from './components/AddTargetForm';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const STORAGE_KEY = 'api_key';

function App() {
  const storedKey = localStorage.getItem(STORAGE_KEY) ?? '';
  const [targets, setTargets] = useState<Target[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(storedKey !== '');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (storedKey) {
      axios.defaults.headers.common['X-API-Key'] = storedKey;
    }
  }, []);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401) {
          localStorage.removeItem(STORAGE_KEY);
          delete axios.defaults.headers.common['X-API-Key'];
          setIsLoggedIn(false);
        }
        return Promise.reject(err);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  const fetchTargets = async () => {
    try {
      setIsLoading(true);
      const response = await axios.get(`${API_BASE_URL}/targets/`);
      setTargets(response.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching targets:', err);
      setError('Failed to connect to the monitoring service. Please ensure the backend is running.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      fetchTargets();
      const interval = setInterval(fetchTargets, 30000);
      return () => clearInterval(interval);
    }
  }, [isLoggedIn]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = loginForm.password;
    axios.defaults.headers.common['X-API-Key'] = key;
    try {
      await axios.get(`${API_BASE_URL}/targets/`);
      localStorage.setItem(STORAGE_KEY, key);
      setLoginError(null);
      setIsLoggedIn(true);
    } catch (err: any) {
      delete axios.defaults.headers.common['X-API-Key'];
      setLoginError('Invalid API key. Check your configuration.');
    }
  };

  const handleAddTarget = async (value: string) => {
    try {
      setIsAdding(true);
      await axios.post(`${API_BASE_URL}/targets/`, { value });
      await fetchTargets();
    } catch (err: any) {
      console.error('Error adding target:', err);
      alert(err.response?.data?.detail || 'Failed to add target');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteTarget = async (id: number) => {
    if (!window.confirm('Are you sure you want to remove this asset from monitoring?')) return;
    try {
      await axios.delete(`${API_BASE_URL}/targets/${id}`);
      setTargets(targets.filter(t => t.id !== id));
    } catch (err) {
      console.error('Error deleting target:', err);
      alert('Failed to delete target');
    }
  };

  const blacklistedCount = targets.filter(t => t.is_blacklisted).length;
  const secureCount = targets.length - blacklistedCount;

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl shadow-slate-200/60 border border-slate-100 overflow-hidden">
          <div className="p-8 pb-0 flex flex-col items-center">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center text-white shadow-xl shadow-primary/30 mb-6">
              <Shield size={36} />
            </div>
            <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Welcome back</h1>
            <p className="text-slate-500 mt-2 font-medium">Log in to your Guardly account</p>
          </div>

          <form onSubmit={handleLogin} className="p-8 space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 ml-1">Work Email</label>
              <input
                type="email"
                required
                value={loginForm.email}
                onChange={e => setLoginForm({...loginForm, email: e.target.value})}
                placeholder="name@company.com"
                className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-xl focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 ml-1">API Key</label>
              <input
                type="password"
                required
                value={loginForm.password}
                onChange={e => setLoginForm({...loginForm, password: e.target.value})}
                placeholder="••••••••"
                className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-xl focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium"
              />
            </div>

            {loginError && (
              <p className="text-sm text-rose-600 font-medium">{loginError}</p>
            )}

            <button
              type="submit"
              className="w-full py-4 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/30 hover:bg-primary/90 transition-all active:scale-[0.98]"
            >
              CONTINUE TO DASHBOARD
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex bg-background min-h-screen text-foreground font-sans">
      <Sidebar />

      <main className="flex-1 p-10 overflow-y-auto">
        <header className="flex justify-between items-start mb-12">
          <div>
            <div className="flex items-center gap-2 text-primary font-bold text-xs tracking-widest uppercase mb-1">
              <Activity size={14} />
              System Status: Optimal
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">Security Overview</h1>
            <p className="text-slate-500 mt-2 font-medium text-lg">Real-time blacklist monitoring and threat detection.</p>
          </div>

          <button
            onClick={fetchTargets}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-white border border-slate-200 shadow-soft hover:shadow-md hover:bg-slate-50 transition-all active:scale-95"
          >
            <RefreshCw size={18} className={`${isLoading ? 'animate-spin' : ''} text-primary`} />
            <span className="text-sm font-bold text-slate-700 uppercase tracking-tight">Refresh Monitor</span>
          </button>
        </header>

        {error && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 px-6 py-4 rounded-2xl mb-10 flex items-center gap-4 shadow-soft">
            <div className="bg-rose-600 text-white p-2 rounded-lg">
              <ShieldAlert size={20} />
            </div>
            <div>
              <p className="font-bold text-sm uppercase tracking-tight">System Connection Error</p>
              <p className="text-sm font-medium opacity-80">{error}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          <StatCard
            label="Monitored Assets"
            value={targets.length}
            icon={Shield}
            trend="Active Monitoring"
            trendType="neutral"
          />
          <StatCard
            label="Blacklist Hits"
            value={blacklistedCount}
            icon={ShieldAlert}
            trend={blacklistedCount > 0 ? "Urgent Action" : "Threat Free"}
            trendType={blacklistedCount > 0 ? "negative" : "positive"}
          />
          <StatCard
            label="Safety Index"
            value={targets.length > 0 ? `${Math.round((secureCount / targets.length) * 100)}%` : '100%'}
            icon={Activity}
            trend={targets.length > 0 ? "Calculated Live" : "Stable"}
            trendType="positive"
          />
        </div>

        <section className="max-w-6xl">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Asset Management</h2>
              <p className="text-slate-400 text-sm font-medium mt-1">Add or remove endpoints from the monitoring queue.</p>
            </div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] bg-slate-100 px-3 py-1.5 rounded-lg">
              Auto-sync: Every 30s
            </div>
          </div>

          <AddTargetForm onAdd={handleAddTarget} isLoading={isAdding} />
          <TargetTable targets={targets} onDelete={handleDeleteTarget} />
        </section>
      </main>
    </div>
  );
}

export default App;
