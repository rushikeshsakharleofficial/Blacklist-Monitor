import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Shield, ShieldAlert, Activity, RefreshCw } from 'lucide-react';
import Sidebar from './components/Sidebar';
import { ErrorDialog } from './components/Dialog';
import StatCard from './components/StatCard';
import TargetTable, { Target } from './components/TargetTable';
import AddTargetForm from './components/AddTargetForm';
import MonitoredAssetsPage from './pages/MonitoredAssetsPage';
import AlertsPage from './pages/AlertsPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import TargetDetailPage from './pages/TargetDetailPage';
import ProblemsPage from './pages/ProblemsPage';
import SetupPage from './pages/SetupPage';
import SubnetScanPage from './pages/SubnetScanPage';
import UsersPage from './pages/UsersPage';
import RolesPage from './pages/RolesPage';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const STORAGE_KEY = 'api_key';
const EMAIL_KEY = 'user_email';
const NAME_KEY = 'user_name';
const EXPIRY_KEY = 'session_expiry';
const PERMS_KEY = 'permissions';

function Dashboard({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchTargets = async () => {
    try {
      setIsLoading(true);
      const response = await axios.get(`${apiBaseUrl}/targets/`);
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
    fetchTargets();
    const interval = setInterval(fetchTargets, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleAddTarget = async (value: string) => {
    try {
      setIsAdding(true);
      await axios.post(`${apiBaseUrl}/targets/`, { value });
      await fetchTargets();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to add target');
    } finally {
      setIsAdding(false);
    }
  };

  const handleBulkExpand = async (cidr: string) => {
    const res = await axios.post(`${apiBaseUrl}/targets/subnet-expand`, { cidr });
    await fetchTargets();
    return res.data as { added: number; skipped: number; total: number };
  };

  const handleBulkDeleteTargets = (ids: number[]) => {
    setTargets(prev => prev.filter(t => !ids.includes(t.id)));
  };

  const handleDeleteTarget = async (id: number) => {
    try {
      await axios.delete(`${apiBaseUrl}/targets/${id}`);
      setTargets(targets.filter(t => t.id !== id));
    } catch {
      setErrorMsg('Failed to delete target');
    }
  };

  const blacklistedCount = targets.filter(t => t.is_blacklisted).length;
  const secureCount = targets.filter(t => !t.is_blacklisted && t.last_checked).length;

  return (
    <>
      {errorMsg && <ErrorDialog message={errorMsg} onClose={() => setErrorMsg(null)} />}
      <header className="flex justify-between items-center mb-4 border-b border-panel-border pb-2">
        <div>
          <h1 className="text-base font-bold text-foreground uppercase tracking-wide">Security Overview</h1>
          <p className="text-muted text-[11px] mt-0.5">Real-time DNSBL blacklist monitoring</p>
        </div>
        <button onClick={fetchTargets} className="flex items-center gap-1 px-3 py-1.5 text-xs border border-panel-border bg-white hover:bg-row-alt">
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {error && (
        <div className="border border-danger bg-danger-bg text-danger px-4 py-2 mb-4 text-xs flex items-center gap-2">
          <ShieldAlert size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Total Monitored" value={targets.length} icon={Shield} accentColor="#336699" />
        <StatCard label="Blacklisted" value={blacklistedCount} icon={ShieldAlert} accentColor="#e74c3c" valueColor={blacklistedCount > 0 ? '#e74c3c' : undefined} />
        <StatCard label="Clean" value={secureCount} icon={Activity} accentColor="#27ae60" valueColor={secureCount > 0 ? '#27ae60' : undefined} />
        <StatCard label="Safety Index" value={targets.length > 0 ? `${Math.round((secureCount / targets.length) * 100)}%` : '100%'} icon={Activity} accentColor="#f39c12" />
      </div>

      <section>
        <div className="border border-panel-border">
          <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
            <span className="text-white text-[11px] font-bold uppercase tracking-wider">Asset Management</span>
            <span className="text-[#8ab4c8] text-[10px]">Auto-sync every 30s</span>
          </div>
          <div className="bg-white p-3">
            <div className="mb-3">
              <AddTargetForm onAdd={handleAddTarget} onBulkExpand={handleBulkExpand} isLoading={isAdding} />
            </div>
            <TargetTable targets={targets} onDelete={handleDeleteTarget} onBulkDelete={handleBulkDeleteTargets} />
          </div>
        </div>
      </section>
    </>
  );
}

function App() {
  // Check session expiry before reading stored credentials
  const expiry = localStorage.getItem(EXPIRY_KEY);
  const isExpired = expiry ? Date.now() > parseInt(expiry) : false;
  if (isExpired) {
    [STORAGE_KEY, EMAIL_KEY, NAME_KEY, EXPIRY_KEY, PERMS_KEY].forEach(k => localStorage.removeItem(k));
  }
  const storedKey = isExpired ? '' : (localStorage.getItem(STORAGE_KEY) ?? '');
  const storedEmail = isExpired ? '' : (localStorage.getItem(EMAIL_KEY) ?? '');
  const storedName = isExpired ? '' : (localStorage.getItem(NAME_KEY) ?? '');
  // Set synchronously so child components can use it on first render/fetch
  if (storedKey) axios.defaults.headers.common['X-API-Key'] = storedKey;
  const [isLoggedIn, setIsLoggedIn] = useState(storedKey !== '');
  const [loginForm, setLoginForm] = useState({ email: '', password: '', rememberMe: true });
  const [loginError, setLoginError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Check setup status on load; redirect to /setup if not configured
  useEffect(() => {
    axios.get(`${API_BASE_URL}/setup-status`).then(res => {
      if (res.data.needs_setup) navigate('/setup', { replace: true });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401) {
          [STORAGE_KEY, EMAIL_KEY, NAME_KEY, EXPIRY_KEY, PERMS_KEY, 'user_role'].forEach(k => localStorage.removeItem(k));
          delete axios.defaults.headers.common['X-API-Key'];
          setIsLoggedIn(false);
        }
        return Promise.reject(err);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_BASE_URL}/auth/login`, {
        email: loginForm.email,
        password: loginForm.password,
      });
      const { api_key, email, name, permissions, role } = res.data;
      axios.defaults.headers.common['X-API-Key'] = api_key;
      localStorage.setItem(STORAGE_KEY, api_key);
      localStorage.setItem(EMAIL_KEY, email);
      localStorage.setItem(NAME_KEY, name || '');
      localStorage.setItem(PERMS_KEY, JSON.stringify(permissions ?? []));
      localStorage.setItem('user_role', role || '');
      if (loginForm.rememberMe) {
        localStorage.setItem(EXPIRY_KEY, String(Date.now() + 90 * 24 * 60 * 60 * 1000));
      } else {
        localStorage.removeItem(EXPIRY_KEY); // clears on next load if no expiry = session only
      }
      setLoginError(null);
      setIsLoggedIn(true);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setLoginError(err.response?.data?.detail || 'Invalid email or password.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(NAME_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    localStorage.removeItem(PERMS_KEY);
    localStorage.removeItem('user_role');
    delete axios.defaults.headers.common['X-API-Key'];
    setIsLoggedIn(false);
    navigate('/login', { replace: true });
  };

  const loginPage = (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-[360px]">
        <div className="border border-panel-border" style={{ borderRadius: 4 }}>
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-panel-border" style={{ background: '#1e2d3d' }}>
            <Shield size={14} className="text-[#336699]" />
            <span className="text-white text-xs font-bold uppercase tracking-widest">Blacklist Monitor</span>
          </div>
          <div className="bg-white p-5">
            <p className="text-[11px] text-muted mb-4">Monitoring Console — Authentication Required</p>
            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-foreground mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={loginForm.email}
                  onChange={e => setLoginForm({...loginForm, email: e.target.value})}
                  placeholder="admin@company.com"
                  className="w-full px-2.5 py-1.5 text-xs border border-panel-border font-mono focus:outline-none focus:border-primary"
                  style={{ borderRadius: 2 }}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-foreground mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={loginForm.password}
                  onChange={e => setLoginForm({...loginForm, password: e.target.value})}
                  placeholder="Your password"
                  className="w-full px-2.5 py-1.5 text-xs border border-panel-border font-mono focus:outline-none focus:border-primary"
                  style={{ borderRadius: 2 }}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="rememberMe"
                  checked={loginForm.rememberMe}
                  onChange={e => setLoginForm({ ...loginForm, rememberMe: e.target.checked })}
                  className="w-3 h-3 border border-panel-border"
                />
                <label htmlFor="rememberMe" className="text-[10px] text-muted uppercase tracking-wide cursor-pointer select-none">
                  Remember me for 90 days
                </label>
              </div>
              {loginError && <p className="text-danger text-[11px]">{loginError}</p>}
              <button
                type="submit"
                className="w-full py-2 text-xs font-bold uppercase text-white border border-[#2a5580]"
                style={{ background: '#336699', borderRadius: 2 }}
              >
                Login to Console
              </button>
            </form>
          </div>
        </div>
        <p className="text-center text-[10px] text-muted mt-3">Blacklist Monitor v1.0 — DNSBL Monitoring Platform</p>
      </div>
    </div>
  );

  if (!isLoggedIn) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={loginPage} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground font-sans">
      <div className="shrink-0 h-full overflow-y-auto">
        <Sidebar email={storedEmail} name={storedName} onLogout={handleLogout}
          permissions={JSON.parse(localStorage.getItem(PERMS_KEY) || '[]')} />
      </div>
      <main className="flex-1 p-4 overflow-y-auto h-full">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard apiBaseUrl={API_BASE_URL} />} />
          <Route path="/monitored-assets" element={<MonitoredAssetsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage onLogout={handleLogout} />} />
          <Route path="/problems/:targetId" element={<TargetDetailPage />} />
          <Route path="/problems" element={<ProblemsPage />} />
          <Route path="/subnet-scan" element={<SubnetScanPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/roles" element={<RolesPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
