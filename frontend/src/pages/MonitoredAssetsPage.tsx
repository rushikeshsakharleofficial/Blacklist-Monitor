import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, Plus, X, RefreshCw, Trash2 } from 'lucide-react';
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
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState('');
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);

  const isAdmin = localStorage.getItem('user_role') === 'super_admin';
  const apiKey = localStorage.getItem('api_key') || '';

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

  useEffect(() => { fetchTargets(); }, []);

  const handleAdd = async (value: string) => {
    try {
      setIsAdding(true);
      await axios.post(`${API_BASE_URL}/targets/`, { value });
      await fetchTargets();
      setShowForm(false);
    } catch (err: any) {
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
    } catch {
      setErrorMsg('Failed to remove asset');
    }
  };

  const handleDeleteAll = async () => {
    if (deleteAllConfirm !== 'DELETE') return;
    setDeleteAllLoading(true);
    try {
      await axios.delete(`${API_BASE_URL}/targets/all`, { headers: { 'X-API-Key': apiKey } });
      setTargets([]);
      setShowDeleteAllModal(false);
      setDeleteAllConfirm('');
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to delete all targets');
      setShowDeleteAllModal(false);
    } finally {
      setDeleteAllLoading(false);
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

      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-base">Monitored Assets</h1>
          <p className="text-sm text-text-sec mt-0.5">
            Manage IP addresses and domains under active blacklist monitoring
            {!isLoading && (
              <span className="ml-2 font-semibold text-accent">{targets.length} asset{targets.length !== 1 ? 's' : ''}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={fetchTargets}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors flex items-center gap-1.5 disabled:opacity-60"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => { setShowBulkModal(true); setBulkResult(null); setBulkText(''); localStorage.removeItem(LS_BULK_ADD_RESULT); }}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-success text-white hover:opacity-90 transition-opacity flex items-center gap-1.5"
          >
            <Plus size={14} /> Bulk Add
          </button>
          <button
            onClick={() => setShowForm(prev => !prev)}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors flex items-center gap-1.5"
          >
            {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add Asset</>}
          </button>
          {isAdmin && (
            <button
              onClick={() => { setShowDeleteAllModal(true); setDeleteAllConfirm(''); }}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-danger text-white hover:opacity-90 transition-opacity flex items-center gap-1.5"
            >
              <Trash2 size={14} /> Delete All
            </button>
          )}
        </div>
      </header>

      {/* Bulk add last result banner */}
      {bulkResult && !showBulkModal && (
        <div className="rounded-lg border border-border-base bg-subtle px-4 py-3 mb-4 flex items-center gap-4 text-sm">
          <span className="text-text-sec text-xs font-semibold uppercase tracking-wide">Last Bulk Add:</span>
          <span className="font-semibold text-success">Added: {bulkResult.added}</span>
          <span className="font-semibold text-warning">Skipped: {bulkResult.skipped}</span>
          <span className="font-semibold text-danger">Errors: {bulkResult.errors}</span>
          <button onClick={() => { setBulkResult(null); localStorage.removeItem(LS_BULK_ADD_RESULT); }} className="ml-auto text-text-sec hover:text-text-base">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-bg text-danger px-4 py-3 mb-4 text-sm flex items-center gap-2">
          <Shield size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Inline Add Form */}
      {showForm && (
        <div className="bg-surface border border-border-base rounded-xl overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-border-base">
            <span className="text-sm font-semibold text-text-base">Add New Asset</span>
          </div>
          <div className="p-4">
            <AddTargetForm onAdd={handleAdd} onBulkExpand={handleBulkExpand} isLoading={isAdding} />
          </div>
        </div>
      )}

      {/* Main Panel */}
      <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-base">
          <span className="text-sm font-semibold text-text-base">Asset Inventory</span>
          <div className="flex items-center gap-3 text-xs">
            {!isLoading && (
              <>
                <span className="font-semibold text-success">{cleanCount} Clean</span>
                <span className="font-semibold text-danger">{listedCount} Listed</span>
                <span className="font-semibold text-warning">{pendingCount} Pending</span>
              </>
            )}
          </div>
        </div>
        <div>
          {isLoading && !error ? (
            <div className="px-4 py-10 text-center text-text-sec text-sm">
              Loading monitored assets...
            </div>
          ) : (
            !error && <TargetTable targets={targets} onDelete={handleDelete} onBulkDelete={handleBulkDelete} />
          )}
        </div>
      </div>

      {/* Bulk Add Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border-base rounded-xl w-full max-w-lg mx-4 shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border-base flex items-center justify-between">
              <span className="text-sm font-semibold text-text-base">Bulk Add Targets</span>
              <button onClick={() => setShowBulkModal(false)} className="text-text-sec hover:text-text-base">
                <X size={16} />
              </button>
            </div>
            <div className="p-5">
              <p className="text-sm text-text-sec mb-3">One IP, domain, or CIDR subnet per line.</p>
              <textarea
                className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full resize-none"
                style={{ height: '14rem' }}
                placeholder={"77.90.141.0/24\n77.90.142.0/24\n8.8.8.8\nexample.com"}
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
              />
              <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={expandSubnets}
                  onChange={e => setExpandSubnets(e.target.checked)}
                  className="accent-accent"
                />
                <span className="text-sm text-text-sec">
                  Expand subnets to individual IPs (e.g. /24 → 254 IPs each monitored separately)
                </span>
              </label>
              {bulkResult && (
                <div className="mt-3 text-sm flex gap-4">
                  <span className="font-semibold text-success">Added: {bulkResult.added}</span>
                  <span className="font-semibold text-warning">Skipped: {bulkResult.skipped}</span>
                  <span className="font-semibold text-danger">Errors: {bulkResult.errors}</span>
                </div>
              )}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleBulkAdd}
                  disabled={bulkLoading || !bulkText.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus size={14} />
                  {bulkLoading ? 'Adding...' : 'Add All'}
                </button>
                <button
                  onClick={() => setShowBulkModal(false)}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Confirmation Modal */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border-base rounded-xl w-full max-w-md mx-4 shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-danger/30 bg-danger-bg flex items-center gap-2">
              <Trash2 size={16} className="text-danger" />
              <span className="font-semibold text-sm text-danger">Delete ALL Targets — Irreversible</span>
            </div>
            <div className="p-5">
              <p className="text-sm font-semibold text-danger mb-1">
                This will permanently delete ALL {targets.length.toLocaleString()} monitored IPs and their full check history.
              </p>
              <p className="text-sm text-text-sec mb-4">
                This action cannot be undone. Celery tasks already queued will still run but results will be lost.
              </p>
              <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">
                Type <span className="font-mono bg-subtle px-1 py-0.5 rounded text-text-base">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={deleteAllConfirm}
                onChange={e => setDeleteAllConfirm(e.target.value)}
                placeholder="DELETE"
                autoFocus
                className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-danger/30 focus:border-danger w-full mb-4 font-mono transition-colors"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleDeleteAll}
                  disabled={deleteAllConfirm !== 'DELETE' || deleteAllLoading}
                  className="flex-1 py-2 text-sm font-medium rounded-lg bg-danger text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  {deleteAllLoading ? 'Deleting…' : 'Delete Everything'}
                </button>
                <button
                  onClick={() => setShowDeleteAllModal(false)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors"
                >
                  Cancel
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
