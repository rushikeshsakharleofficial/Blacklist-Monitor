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
  asn?: string | null;
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
    <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-subtle text-text-sec">Pending</span>
  );
  return target.is_blacklisted
    ? <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-danger-bg text-danger">Listed</span>
    : <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-success-bg text-success">Clean</span>;
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
      <div className="px-4 py-8 text-center text-text-sec text-sm">
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
        <div className="flex items-center gap-3 px-3 py-2 mb-3 rounded-lg border border-border-base bg-subtle">
          <span className="text-sm font-semibold text-text-base">{selected.size} selected</span>
          <button
            onClick={() => setConfirmBulk(true)}
            disabled={bulkDeleting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-danger text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Trash2 size={13} />
            {bulkDeleting ? 'Deleting…' : `Remove Selected (${selected.size})`}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm text-text-sec hover:text-text-base"
          >
            Clear selection
          </button>
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-3 py-2.5 border-b border-border-base w-8 text-center">
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                onChange={toggleAll}
                className="cursor-pointer accent-accent"
              />
            </th>
            <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-3 py-2.5 border-b border-border-base text-left w-24">Status</th>
            <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-3 py-2.5 border-b border-border-base text-left">IP / Domain</th>
            <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-3 py-2.5 border-b border-border-base text-left">Provider / Org / ASN</th>
            <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-3 py-2.5 border-b border-border-base text-left w-16">Type</th>
            <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-3 py-2.5 border-b border-border-base text-left w-28">Last Check</th>
            <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-3 py-2.5 border-b border-border-base text-left w-44">Actions</th>
          </tr>
        </thead>
        <tbody>
          {pageTargets.map((t) => (
            <tr
              key={t.id}
              className="border-b border-border-base hover:bg-subtle transition-colors"
              style={selected.has(t.id) ? { background: 'var(--accent-subtle)' } : undefined}
            >
              <td className="px-3 py-2.5 text-center">
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggleOne(t.id)}
                  className="cursor-pointer accent-accent"
                />
              </td>
              <td className="px-3 py-2.5"><StatusBadge target={t} /></td>
              <td className="px-3 py-2.5 font-mono text-text-base text-sm">{t.address}</td>
              <td className="px-3 py-2.5 text-xs text-text-sec max-w-[200px]" title={t.org || ''}>
                <div className="truncate">{t.org || '—'}</div>
                {t.asn && <div className="text-[10px] text-text-muted font-mono mt-0.5">{t.asn}</div>}
              </td>
              <td className="px-3 py-2.5 uppercase text-xs text-text-sec font-medium">{t.target_type}</td>
              <td className="px-3 py-2.5 text-sm text-text-sec">{relativeTime(t.last_checked)}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                {confirmId === t.id ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-danger font-medium mr-1">Remove?</span>
                    <button
                      onClick={() => { onDelete(t.id); setConfirmId(null); setSelected(s => { const n = new Set(s); n.delete(t.id); return n; }); }}
                      className="flex items-center gap-0.5 px-2 py-1 text-xs font-medium rounded bg-danger text-white"
                    >
                      <Check size={11} /> Yes
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="flex items-center gap-0.5 px-2 py-1 text-xs font-medium rounded border border-border-base hover:bg-subtle text-text-base"
                    >
                      <X size={11} /> No
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {t.is_blacklisted && (
                      <Link to={`/problems/${t.id}`} className="text-accent hover:underline flex items-center gap-1 text-xs">
                        <ExternalLink size={12} /> Detail
                      </Link>
                    )}
                    <button
                      onClick={() => setConfirmId(t.id)}
                      className="text-danger hover:opacity-70 flex items-center gap-1 text-xs"
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-subtle">
            <td colSpan={7} className="px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-text-sec text-xs">
                  {targets.length} asset{targets.length !== 1 ? 's' : ''} — {targets.filter(t => t.is_blacklisted).length} listed, {targets.filter(t => !t.is_blacklisted && t.last_checked).length} clean
                  {someSelected && <span className="ml-2 font-semibold text-text-base">· {selected.size} selected</span>}
                </span>
                {targets.length > PAGE_SIZES[0] && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-sec">Rows:</span>
                    <select
                      value={pageSize}
                      onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                      className="text-xs border border-border-base px-1 py-0.5 rounded bg-surface text-text-base"
                    >
                      {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <span className="text-xs text-text-sec font-mono">
                      {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, targets.length)} of {targets.length}
                    </span>
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                      className="p-0.5 border border-border-base rounded bg-surface hover:bg-subtle disabled:opacity-40">
                      <ChevronLeft size={13} />
                    </button>
                    <span className="text-xs font-semibold text-text-base">{page}/{totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                      className="p-0.5 border border-border-base rounded bg-surface hover:bg-subtle disabled:opacity-40">
                      <ChevronRight size={13} />
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
