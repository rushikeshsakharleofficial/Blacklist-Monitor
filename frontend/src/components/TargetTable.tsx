import React from 'react';
import { ShieldCheck, ShieldAlert, Clock, Trash2, ExternalLink } from 'lucide-react';

export interface Target {
  id: number;
  address: string;
  is_blacklisted: boolean;
  last_checked: string | null;
  check_results: any;
  target_type: string;
}

interface TargetTableProps {
  targets: Target[];
  onDelete: (id: number) => void;
}

const TargetTable: React.FC<TargetTableProps> = ({ targets, onDelete }) => {
  const getRelativeTime = (dateStr: string | null): string => {
    if (!dateStr) {
      return 'Pending...';
    }

    const now = new Date();
    const date = new Date(dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z');
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) {
      return 'just now';
    }

    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes} min ago`;
    }

    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return `${hours} hr ago`;
    }

    return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  };

  return (
    <div className="bg-white border border-border rounded-2xl shadow-soft overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="px-8 py-5 text-xs font-bold text-muted-foreground uppercase tracking-widest">Asset</th>
              <th className="px-8 py-5 text-xs font-bold text-muted-foreground uppercase tracking-widest">Status</th>
              <th className="px-8 py-5 text-xs font-bold text-muted-foreground uppercase tracking-widest">Last Check</th>
              <th className="px-8 py-5 text-xs font-bold text-muted-foreground uppercase tracking-widest text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {targets.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-8 py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <ShieldCheck size={48} className="text-slate-200" />
                    <p className="text-slate-500 font-medium">No monitored assets yet</p>
                    <p className="text-slate-400 text-sm">Add an IP or domain to start monitoring</p>
                  </div>
                </td>
              </tr>
            ) : (
              targets.map((target) => (
                <tr key={target.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-5 whitespace-nowrap">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-primary group-hover:text-white transition-all duration-300">
                        <ExternalLink size={16} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700">{target.address}</span>
                        {target.target_type.toUpperCase() === 'IP' ? (
                          <span className="text-[10px] font-bold bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-md">IP</span>
                        ) : (
                          <span className="text-[10px] font-bold bg-purple-50 text-purple-500 px-1.5 py-0.5 rounded-md">DOMAIN</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {target.last_checked === null ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-500">
                          <Clock size={14} />
                          PENDING
                        </span>
                      ) : target.is_blacklisted ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-100 text-orange-600">
                          <ShieldAlert size={14} />
                          LISTED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-600">
                          <ShieldCheck size={14} />
                          CLEAN
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-8 py-5 whitespace-nowrap text-sm text-slate-500 font-medium">
                    <div className="flex items-center gap-2">
                      <Clock size={16} className="text-slate-400" />
                      {getRelativeTime(target.last_checked)}
                    </div>
                  </td>
                  <td className="px-8 py-5 whitespace-nowrap text-right">
                    <button
                      onClick={() => onDelete(target.id)}
                      className="p-2.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TargetTable;
