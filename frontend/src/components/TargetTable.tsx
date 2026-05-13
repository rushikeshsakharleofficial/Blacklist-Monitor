import React from 'react';
import { Trash2, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface Target {
  id: number;
  address: string;
  target_type: string;
  is_blacklisted: boolean;
  last_checked: string | null;
  created_at: string | null;
}

interface Props {
  targets: Target[];
  onDelete: (id: number) => void;
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

const TargetTable: React.FC<Props> = ({ targets, onDelete }) => {
  if (targets.length === 0) {
    return (
      <div className="border border-panel-border bg-white px-4 py-6 text-center text-muted text-sm">
        No assets monitored yet. Add an IP or domain above.
      </div>
    );
  }

  return (
    <table className="w-full text-xs border-collapse border border-panel-border">
      <thead>
        <tr style={{ background: '#2c3e50', color: 'white' }}>
          <th className="px-3 py-2 text-left uppercase font-bold tracking-wide border border-[#3d5166] w-24">Status</th>
          <th className="px-3 py-2 text-left uppercase font-bold tracking-wide border border-[#3d5166]">IP / Domain</th>
          <th className="px-3 py-2 text-left uppercase font-bold tracking-wide border border-[#3d5166] w-16">Type</th>
          <th className="px-3 py-2 text-left uppercase font-bold tracking-wide border border-[#3d5166] w-28">Last Check</th>
          <th className="px-3 py-2 text-left uppercase font-bold tracking-wide border border-[#3d5166] w-28">Actions</th>
        </tr>
      </thead>
      <tbody>
        {targets.map((t, i) => (
          <tr key={t.id} className={i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}>
            <td className="px-3 py-1.5 border border-panel-border"><StatusBadge target={t} /></td>
            <td className="px-3 py-1.5 border border-panel-border font-mono text-foreground">{t.address}</td>
            <td className="px-3 py-1.5 border border-panel-border uppercase text-[10px] text-muted font-bold">{t.target_type}</td>
            <td className="px-3 py-1.5 border border-panel-border text-muted">{relativeTime(t.last_checked)}</td>
            <td className="px-3 py-1.5 border border-panel-border">
              <div className="flex items-center gap-2">
                {t.is_blacklisted && (
                  <Link to={`/problems/${t.id}`} className="text-primary hover:underline flex items-center gap-1 text-[11px]">
                    <ExternalLink size={11} /> Detail
                  </Link>
                )}
                <button
                  onClick={() => onDelete(t.id)}
                  className="text-danger hover:text-red-800 flex items-center gap-1 text-[11px]"
                >
                  <Trash2 size={11} /> Remove
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="bg-[#f0f2f5]">
          <td colSpan={5} className="px-3 py-1.5 border border-panel-border text-muted text-[11px]">
            Showing {targets.length} asset{targets.length !== 1 ? 's' : ''} — {targets.filter(t => t.is_blacklisted).length} listed, {targets.filter(t => !t.is_blacklisted && t.last_checked).length} clean
          </td>
        </tr>
      </tfoot>
    </table>
  );
};

export default TargetTable;
