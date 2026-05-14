import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Shield, ShieldAlert, Activity, RefreshCw, Menu } from 'lucide-react';
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
import ScanSessionsPage from './pages/ScanSessionsPage';

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
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-base">Security Overview</h1>
          <p className="text-sm text-text-sec mt-0.5">Real-time DNSBL blacklist monitoring</p>
        </div>
        <button
          onClick={fetchTargets}
          className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors flex items-center gap-1.5"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-bg text-danger px-4 py-3 text-sm flex items-center gap-2 mb-6">
          <ShieldAlert size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Monitored" value={targets.length} icon={Shield} />
        <StatCard label="Blacklisted" value={blacklistedCount} icon={ShieldAlert} variant={blacklistedCount > 0 ? 'danger' : undefined} />
        <StatCard label="Clean" value={secureCount} icon={Activity} variant={secureCount > 0 ? 'success' : undefined} />
        <StatCard label="Safety Index" value={targets.length > 0 ? `${Math.round((secureCount / targets.length) * 100)}%` : '100%'} icon={Activity} variant="warning" />
      </div>

      <section className="bg-surface border border-border-base rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-base flex items-center justify-between">
          <span className="text-sm font-semibold text-text-base">Asset Management</span>
          <span className="text-xs text-text-sec">Auto-sync every 30s</span>
        </div>
        <div className="p-4">
          <div className="mb-4">
            <AddTargetForm onAdd={handleAddTarget} onBulkExpand={handleBulkExpand} isLoading={isAdding} />
          </div>
          <TargetTable targets={targets} onDelete={handleDeleteTarget} onBulkDelete={handleBulkDeleteTargets} />
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

  // Dark mode state
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Apply/remove dark class
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

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
        localStorage.removeItem(EXPIRY_KEY);
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
    <div className="min-h-screen bg-app flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent)' }}>
            <Shield size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold text-text-base">Guardly</span>
        </div>

        <div className="bg-surface border border-border-base rounded-xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-text-base mb-1">Sign in to your account</h2>
          <p className="text-xs text-text-sec mb-5">Enter your credentials to continue</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">
                Email Address
              </label>
              <input
                type="email"
                required
                value={loginForm.email}
                onChange={e => setLoginForm({ ...loginForm, email: e.target.value })}
                placeholder="you@company.com"
                className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">
                Password
              </label>
              <input
                type="password"
                required
                value={loginForm.password}
                onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                placeholder="Your password"
                className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="rememberMe"
                checked={loginForm.rememberMe}
                onChange={e => setLoginForm({ ...loginForm, rememberMe: e.target.checked })}
                className="w-3.5 h-3.5 rounded border-border-base accent-accent"
              />
              <label htmlFor="rememberMe" className="text-xs text-text-sec cursor-pointer select-none">
                Remember me for 90 days
              </label>
            </div>
            {loginError && (
              <p className="text-sm text-danger">{loginError}</p>
            )}
            <button
              type="submit"
              className="w-full bg-accent hover:bg-accent-hover text-white rounded-lg py-2 font-medium text-sm transition-colors"
            >
              Sign in
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-text-muted mt-4">Guardly — DNSBL Monitoring Platform</p>
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
    <div className="flex h-screen overflow-hidden bg-app text-text-base">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="sidebar-overlay md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-40 transition-transform duration-200
        md:relative md:translate-x-0 md:flex md:shrink-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar
          email={storedEmail}
          name={storedName}
          onLogout={handleLogout}
          permissions={JSON.parse(localStorage.getItem(PERMS_KEY) || '[]')}
          darkMode={darkMode}
          onToggleDark={() => setDarkMode(d => !d)}
          isMobileOpen={sidebarOpen}
          onMobileClose={() => setSidebarOpen(false)}
        />
      </div>

      <main className="flex-1 overflow-y-auto min-h-0">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border-base bg-surface sticky top-0 z-30">
          <button onClick={() => setSidebarOpen(true)} className="text-text-sec hover:text-text-base">
            <Menu size={20} />
          </button>
          <span className="font-semibold text-sm text-text-base">Guardly</span>
        </div>

        <div className="p-4 md:p-6">
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
            <Route path="/scan-sessions" element={<ScanSessionsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/roles" element={<RolesPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default App;
