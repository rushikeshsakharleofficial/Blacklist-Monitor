import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Trash2, ExternalLink, X, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ConfirmDialog, ErrorDialog } from './Dialog';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

export interface Target {
  id: number;
  address: string;
  target_type: string;
  is_blacklisted: boolean;
  last_checked: string | null;
  created_at: string | null;
  org: string | null;
}

interface Props {
  targets: Target[];
  onDelete: (id: number) => void;
  onBulkDelete?: (ids: number[]) => void;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

function StatusBadge({ target }: { target: Target }) {
  if (!target.last_checked) return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded text-white uppercase tracking-wide" style={{ background: '#f39c12' }}>PENDING</span>
  );
  return target.is_blacklisted
    ? <span className="text-[10px] font-bold px-2 py-0.5 rounded text-white uppercase tracking-wide" style={{ background: '#e74c3c' }}>LISTED</span>
    : <span className="text-[10px] font-bold px-2 py-0.5 rounded text-white uppercase tracking-wide" style={{ background: '#27ae60' }}>CLEAN</span>;
}

const PAGE_SIZES = [20, 50, 100, 200];

const TargetTable: React.FC<Props> = ({ targets, onDelete, onBulkDelete }) => {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const totalPages = Math.max(1, Math.ceil(targets.length / pageSize));
  // Reset to page 1 if targets list changes length significantly
  useEffect(() => { setPage(1); }, [targets.length]);
  const pageTargets = targets.slice((page - 1) * pageSize, page * pageSize);

  const allSelected = pageTargets.length > 0 && pageTargets.every(t => selected.has(t.id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); pageTargets.forEach(t => n.delete(t.id)); return n; });
    } else {
      setSelected(prev => new Set([...prev, ...pageTargets.map(t => t.id)]));
    }
  };

  const toggleOne = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    setConfirmBulk(false);
    setBulkDeleting(true);
    const ids = [...selected];
    try {
      await axios.post(`${API}/targets/bulk-delete`, { ids });
      setSelected(new Set());
      if (onBulkDelete) onBulkDelete(ids);
      else ids.forEach(id => onDelete(id));
    } catch (ex: any) {
      setErrorMsg(ex.response?.data?.detail || 'Bulk delete failed');
    } finally {
      setBulkDeleting(false);
    }
  };

  if (targets.length === 0) {
    return (
      <div className="border border-panel-border bg-white px-4 py-6 text-center text-muted text-sm">
        No assets monitored yet. Add an IP or domain above.
      </div>
    );
  }

  return (
    <>
      {errorMsg && <ErrorDialog message={errorMsg} onClose={() => setErrorMsg(null)} />}
      {confirmBulk && (
        <ConfirmDialog
          danger
          message={`Delete ${selected.size} selected asset${selected.size !== 1 ? 's' : ''}?`}
          detail="They will be permanently removed from monitoring. This cannot be undone."
          confirmLabel={`Delete ${selected.size}`}
          onConfirm={handleBulkDelete}
          onCancel={() => setConfirmBulk(false)}
        />
      )}

      {someSelected && (
        <div className="flex items-center gap-3 px-3 py-2 mb-1 border border-[#2a5580] text-xs"
          style={{ background: '#1e3a5f' }}>
          <span className="text-[#8ab4c8] font-bold">{selected.size} selected</span>
          <button
            onClick={() => setConfirmBulk(true)}
            disabled={bulkDeleting}
            className="flex items-center gap-1 px-3 py-1 text-[11px] font-bold uppercase text-white border border-[#c0392b] disabled:opacity-50"
            style={{ background: '#e74c3c', borderRadius: 2 }}>
            <Trash2 size={11} />
            {bulkDeleting ? 'Deleting…' : `Remove Selected (${selected.size})`}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-[#8ab4c8] hover:text-white text-[11px] underline"
          >
            Clear selection
          </button>
        </div>
      )}

      <table className="w-full text-xs border-collapse border border-panel-border">
        <thead>
          <tr style={{ background: '#2c3e50', color: 'white' }}>
            <th className="px-3 py-2 border border-[#3d5166] w-8">
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                onChange={toggleAll}
                className="cursor-pointer"
              />
            </th>
            <th className="px-3 py-2 text-left uppercase font-bold tracking-wide border border-[#3d5166] w-24">Status</th>
            <th className="px-3 py-2 text-left uppercase font-bold tracking-wide border border-[#3d5166]">IP / Domain</th>
            <th className="px-3 py-2 text-left uppercase font-bold tracking-wide border border-[#3d5166]">Provider / Org</th>
            <th className="px-3 py-2 text-left uppercase font-bold tracking-wide border border-[#3d5166] w-16">Type</th>
            <th className="px-3 py-2 text-left uppercase font-bold tracking-wide border border-[#3d5166] w-28">Last Check</th>
            <th className="px-3 py-2 text-left uppercase font-bold tracking-wide border border-[#3d5166] w-40">Actions</th>
          </tr>
        </thead>
        <tbody>
          {pageTargets.map((t, i) => (
            <tr key={t.id} className={`${selected.has(t.id) ? 'bg-[#eef4fb]' : i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}`}>
              <td className="px-3 py-1.5 border border-panel-border text-center">
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggleOne(t.id)}
                  className="cursor-pointer"
                />
              </td>
              <td className="px-3 py-1.5 border border-panel-border"><StatusBadge target={t} /></td>
              <td className="px-3 py-1.5 border border-panel-border font-mono text-foreground">{t.address}</td>
              <td className="px-3 py-1.5 border border-panel-border text-[10px] text-muted truncate max-w-[180px]" title={t.org || ''}>{t.org || '—'}</td>
              <td className="px-3 py-1.5 border border-panel-border uppercase text-[10px] text-muted font-bold">{t.target_type}</td>
              <td className="px-3 py-1.5 border border-panel-border text-muted">{relativeTime(t.last_checked)}</td>
              <td className="px-3 py-1.5 border border-panel-border">
                {confirmId === t.id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-danger font-bold mr-1">Remove?</span>
                    <button
                      onClick={() => { onDelete(t.id); setConfirmId(null); setSelected(s => { const n = new Set(s); n.delete(t.id); return n; }); }}
                      className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold text-white"
                      style={{ background: '#e74c3c', borderRadius: 2 }}
                    >
                      <Check size={10} /> Yes
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold border border-panel-border bg-white hover:bg-row-alt"
                      style={{ borderRadius: 2 }}
                    >
                      <X size={10} /> No
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {t.is_blacklisted && (
                      <Link to={`/problems/${t.id}`} className="text-primary hover:underline flex items-center gap-1 text-[11px]">
                        <ExternalLink size={11} /> Detail
                      </Link>
                    )}
                    <button
                      onClick={() => setConfirmId(t.id)}
                      className="text-danger hover:text-red-800 flex items-center gap-1 text-[11px]"
                    >
                      <Trash2 size={11} /> Remove
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[#f0f2f5]">
            <td colSpan={7} className="px-3 py-1.5 border border-panel-border">
              <div className="flex items-center justify-between">
                <span className="text-muted text-[11px]">
                  {targets.length} asset{targets.length !== 1 ? 's' : ''} — {targets.filter(t => t.is_blacklisted).length} listed, {targets.filter(t => !t.is_blacklisted && t.last_checked).length} clean
                  {someSelected && <span className="ml-2 font-bold text-foreground">· {selected.size} selected</span>}
                </span>
                {targets.length > PAGE_SIZES[0] && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted">Rows:</span>
                    <select
                      value={pageSize}
                      onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                      className="text-[10px] border border-panel-border px-1 py-0.5 bg-white"
                      style={{ borderRadius: 2 }}>
                      {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <span className="text-[10px] text-muted font-mono">
                      {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, targets.length)} of {targets.length}
                    </span>
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                      className="p-0.5 border border-panel-border bg-white hover:bg-row-alt disabled:opacity-40"
                      style={{ borderRadius: 2 }}>
                      <ChevronLeft size={12} />
                    </button>
                    <span className="text-[10px] font-bold text-foreground">{page}/{totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                      className="p-0.5 border border-panel-border bg-white hover:bg-row-alt disabled:opacity-40"
                      style={{ borderRadius: 2 }}>
                      <ChevronRight size={12} />
                    </button>
                  </div>
                )}
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </>
  );
};

export default TargetTable;
