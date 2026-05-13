import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, Plus, X, RefreshCw } from 'lucide-react';
import AddTargetForm from '../components/AddTargetForm';
import { ErrorDialog } from '../components/Dialog';
import TargetTable, { Target } from '../components/TargetTable';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

const MonitoredAssetsPage: React.FC = () => {
  const [targets, setTargets] = useState<Target[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
            onClick={() => setShowForm(prev => !prev)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase text-white border border-[#2a5580]"
            style={{ background: showForm ? '#4a4a4a' : '#336699', borderRadius: 2 }}
          >
            {showForm ? <><X size={12} /> Cancel</> : <><Plus size={12} /> Add Asset</>}
          </button>
        </div>
      </header>

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
    </div>
  );
};

export default MonitoredAssetsPage;
