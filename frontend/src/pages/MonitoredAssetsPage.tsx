import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, Plus, X, RefreshCw } from 'lucide-react';
import AddTargetForm from '../components/AddTargetForm';
import { ErrorDialog } from '../components/Dialog';
import TargetTable, { Target } from '../components/TargetTable';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const LS_BULK_ADD_RESULT = 'bm_bulk_add_result';

const MonitoredAssetsPage: React.FC = () => {
  const [targets, setTargets] = useState<Target[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ added: number; skipped: number; errors: number } | null>(() => {
    try { const s = localStorage.getItem(LS_BULK_ADD_RESULT); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [expandSubnets, setExpandSubnets] = useState(true);

  const fetchTargets = async () => {
    try {
      setIsLoading(true);
      const response = await axios.get(`${API_BASE_URL}/targets/`);
      setTargets(response.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching targets:', err);
      setError('Failed to load monitored assets. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTargets();
  }, []);

  const handleAdd = async (value: string) => {
    try {
      setIsAdding(true);
      await axios.post(`${API_BASE_URL}/targets/`, { value });
      await fetchTargets();
      setShowForm(false);
    } catch (err: any) {
      console.error('Error adding target:', err);
      setErrorMsg(err.response?.data?.detail || 'Failed to add asset');
    } finally {
      setIsAdding(false);
    }
  };

  const handleBulkExpand = async (cidr: string) => {
    const res = await axios.post(`${API_BASE_URL}/targets/subnet-expand`, { cidr });
    await fetchTargets();
    return res.data as { added: number; skipped: number; total: number };
  };

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`${API_BASE_URL}/targets/${id}`);
      await fetchTargets();
    } catch (err) {
      console.error('Error deleting target:', err);
      setErrorMsg('Failed to remove asset');
    }
  };

  const handleBulkDelete = (ids: number[]) => {
    setTargets(prev => prev.filter(t => !ids.includes(t.id)));
  };

  const handleBulkAdd = async () => {
    const values = bulkText.split('\n').map(s => s.trim()).filter(Boolean);
    if (!values.length) return;
    setBulkLoading(true);
    setBulkResult(null);
    try {
      const res = await axios.post(`${API_BASE_URL}/targets/bulk-add`, { values, expand_subnets: expandSubnets });
      const data = res.data;
      const result = { added: data.added, skipped: data.skipped, errors: data.errors };
      setBulkResult(result);
      localStorage.setItem(LS_BULK_ADD_RESULT, JSON.stringify(result));
      if (data.added > 0) fetchTargets();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Bulk add failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const listedCount = targets.filter(t => t.is_blacklisted).length;
  const cleanCount = targets.filter(t => !t.is_blacklisted && t.last_checked).length;
  const pendingCount = targets.filter(t => !t.last_checked).length;

  return (
    <div>
      {errorMsg && <ErrorDialog message={errorMsg} onClose={() => setErrorMsg(null)} />}
      {/* Page Header */}
      <header className="flex justify-between items-center mb-4 border-b border-panel-border pb-2">
        <div>
          <h1 className="text-base font-bold text-foreground uppercase tracking-wide">Monitored Assets</h1>
          <p className="text-muted text-[11px] mt-0.5">
            Manage IP addresses and domains under active blacklist monitoring
            {!isLoading && (
              <span className="ml-2 font-bold text-primary">{targets.length} asset{targets.length !== 1 ? 's' : ''}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchTargets}
            disabled={isLoading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-panel-border bg-white hover:bg-row-alt disabled:opacity-60"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => { setShowBulkModal(true); setBulkResult(null); setBulkText(''); localStorage.removeItem(LS_BULK_ADD_RESULT); }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase text-white border border-[#1a6b3c]"
            style={{ background: '#27ae60', borderRadius: 2 }}
          >
            <Plus size={12} /> Bulk Add
          </button>
          <button
            onClick={() => setShowForm(prev => !prev)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase text-white border border-[#2a5580]"
            style={{ background: showForm ? '#4a4a4a' : '#336699', borderRadius: 2 }}
          >
            {showForm ? <><X size={12} /> Cancel</> : <><Plus size={12} /> Add Asset</>}
          </button>
        </div>
      </header>

      {/* Bulk add last result banner (persists across refresh) */}
      {bulkResult && !showBulkModal && (
        <div className="border border-panel-border px-4 py-2 mb-3 flex items-center gap-4 text-xs" style={{ background: '#1e2a35' }}>
          <span className="text-muted text-[11px] uppercase tracking-wide font-bold">Last Bulk Add:</span>
          <span style={{ color: '#27ae60' }} className="font-bold">Added: {bulkResult.added}</span>
          <span style={{ color: '#f39c12' }} className="font-bold">Skipped: {bulkResult.skipped}</span>
          <span style={{ color: '#e74c3c' }} className="font-bold">Errors: {bulkResult.errors}</span>
          <button onClick={() => { setBulkResult(null); localStorage.removeItem(LS_BULK_ADD_RESULT); }} className="ml-auto text-muted hover:text-white"><X size={12} /></button>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="border border-danger bg-danger-bg text-danger px-4 py-2 mb-4 text-xs flex items-center gap-2">
          <Shield size={14} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Inline Add Form */}
      {showForm && (
        <div className="border border-panel-border mb-4">
          <div className="px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
            <span className="text-white text-[11px] font-bold uppercase tracking-wider">Add New Asset</span>
          </div>
          <div className="bg-white p-3">
            <AddTargetForm onAdd={handleAdd} onBulkExpand={handleBulkExpand} isLoading={isAdding} />
          </div>
        </div>
      )}

      {/* Main Panel */}
      <div className="border border-panel-border">
        <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
          <span className="text-white text-[11px] font-bold uppercase tracking-wider">Asset Inventory</span>
          <div className="flex items-center gap-3 text-[10px]">
            {!isLoading && (
              <>
                <span className="text-[#27ae60] font-bold">{cleanCount} Clean</span>
                <span className="text-[#e74c3c] font-bold">{listedCount} Listed</span>
                <span className="text-[#f39c12] font-bold">{pendingCount} Pending</span>
              </>
            )}
          </div>
        </div>
        <div className="bg-white">
          {isLoading && !error ? (
            <div className="px-4 py-8 text-center text-muted text-xs">
              Loading monitored assets...
            </div>
          ) : (
            !error && <TargetTable targets={targets} onDelete={handleDelete} onBulkDelete={handleBulkDelete} />
          )}
        </div>
      </div>

      {/* Bulk Add Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="border border-panel-border w-full max-w-lg" style={{ background: '#1e2a35' }}>
            <div className="px-4 py-3 border-b border-panel-border flex items-center justify-between" style={{ background: '#2c3e50' }}>
              <span className="text-white text-[11px] font-bold uppercase tracking-wider">Bulk Add Targets</span>
              <button onClick={() => setShowBulkModal(false)} className="text-gray-400 hover:text-white">
                <X size={14} />
              </button>
            </div>
            <div className="p-4">
              <p className="text-[11px] mb-2" style={{ color: '#8fa8c0' }}>One IP, domain, or CIDR subnet per line.</p>
              <textarea
                className="w-full border border-panel-border p-2 text-xs font-mono focus:outline-none focus:border-primary resize-none"
                style={{ background: '#263445', color: '#d0dde8', height: '14rem' }}
                placeholder={"77.90.141.0/24\n77.90.142.0/24\n8.8.8.8\nexample.com"}
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
              />
              <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={expandSubnets}
                  onChange={e => setExpandSubnets(e.target.checked)}
                  className="accent-blue-500"
                />
                <span className="text-[11px]" style={{ color: '#8fa8c0' }}>
                  Expand subnets to individual IPs (e.g. /24 → 254 IPs each monitored separately)
                </span>
              </label>
              {bulkResult && (
                <div className="mt-2 text-xs flex gap-4">
                  <span style={{ color: '#27ae60' }} className="font-bold">Added: {bulkResult.added}</span>
                  <span style={{ color: '#f39c12' }} className="font-bold">Skipped: {bulkResult.skipped}</span>
                  <span style={{ color: '#e74c3c' }} className="font-bold">Errors: {bulkResult.errors}</span>
                </div>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleBulkAdd}
                  disabled={bulkLoading || !bulkText.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase text-white border border-[#2a5580] disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: '#336699', borderRadius: 2 }}
                >
                  <Plus size={12} />
                  {bulkLoading ? 'Adding...' : 'Add All'}
                </button>
                <button
                  onClick={() => setShowBulkModal(false)}
                  className="px-3 py-1.5 text-xs font-bold uppercase border border-panel-border"
                  style={{ background: '#3a4a5a', color: '#a0b4c8', borderRadius: 2 }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonitoredAssetsPage;
