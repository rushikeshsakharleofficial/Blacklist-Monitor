import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { ShieldCheck, Plus, RefreshCw, Trash2, Edit2, X, Check } from 'lucide-react';
import { ConfirmDialog, ErrorDialog } from '../components/Dialog';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

interface Role {
  id: number; name: string; description: string; is_builtin: boolean;
  permissions: string[]; user_count: number;
}
type PermGroup = { label: string; permissions: string[] }[];

function PermissionGrid({
  allPerms, permLabels, permGroups, selected, onChange, disabled,
}: {
  allPerms: string[]; permLabels: Record<string, string>; permGroups: PermGroup;
  selected: Set<string>; onChange: (s: Set<string>) => void; disabled?: boolean;
}) {
  const toggle = (p: string) => {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p); else next.add(p);
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {permGroups.map(({ label, permissions: perms }) => (
        <div key={label}>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1.5">{label}</div>
          <div className="flex flex-wrap gap-1.5">
            {perms.map(p => {
              const checked = selected.has(p);
              return (
                <button key={p} type="button" disabled={disabled}
                  onClick={() => toggle(p)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                    checked
                      ? 'bg-accent-subtle text-accent border-accent/30'
                      : 'bg-surface text-text-sec border-border-base hover:border-accent/50'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}>
                  {permLabels[p] ?? p}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

interface RoleFormProps {
  allPerms: string[]; permLabels: Record<string, string>; permGroups: PermGroup;
  initial?: Role;
  onSave: (name: string, description: string, perms: string[]) => Promise<void>;
  onCancel: () => void;
}

function RoleForm({ allPerms, permLabels, permGroups, initial, onSave, onCancel }: RoleFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [desc, setDesc] = useState(initial?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(initial?.permissions ?? []));
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.size === 0) { setErr('Select at least one permission'); return; }
    setLoading(true); setErr(null);
    try { await onSave(name, desc, [...selected]); }
    catch (ex: any) { setErr(ex.response?.data?.detail || String(ex)); }
    finally { setLoading(false); }
  };

  return (
    <div className="bg-surface border border-border-base rounded-xl overflow-hidden mb-4">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-base">
        <Plus size={15} className="text-accent" />
        <span className="text-sm font-semibold text-text-base">
          {initial ? `Edit Role: ${initial.name}` : 'Create New Role'}
        </span>
      </div>
      <form onSubmit={submit} className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">Role Name</label>
            <input required value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. read_only_analyst"
              className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors" />
          </div>
          <div>
            <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)}
              className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors" />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-2 block">Permissions</label>
          <PermissionGrid allPerms={allPerms} permLabels={permLabels} permGroups={permGroups}
            selected={selected} onChange={setSelected} />
        </div>
        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex gap-2">
          <button type="submit" disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50">
            <Check size={14} /> {loading ? 'Saving…' : 'Save Role'}
          </button>
          <button type="button" onClick={onCancel}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors">
            <X size={14} /> Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [allPerms, setAllPerms] = useState<string[]>([]);
  const [permLabels, setPermLabels] = useState<Record<string, string>>({});
  const [permGroups, setPermGroups] = useState<PermGroup>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Role | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const myPermsRaw = localStorage.getItem('permissions') || '[]';
  const myPermissions: string[] = JSON.parse(myPermsRaw);
  const canManage = myPermissions.includes('users:set_role');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/roles`);
      setRoles(res.data.roles);
      setAllPerms(res.data.all_permissions);
      setPermLabels(res.data.permission_labels ?? {});
      setPermGroups(res.data.permission_groups ?? []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createRole = async (name: string, desc: string, perms: string[]) => {
    await axios.post(`${API}/roles`, { name, description: desc, permissions: perms });
    setShowCreate(false);
    load();
  };

  const updateRole = async (name: string, desc: string, perms: string[]) => {
    if (!editRole) return;
    await axios.put(`${API}/roles/${editRole.id}`, { name, description: desc, permissions: perms });
    setEditRole(null);
    load();
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const role = confirmDelete;
    setConfirmDelete(null);
    try {
      await axios.delete(`${API}/roles/${role.id}`);
      load();
    } catch (ex: any) { setErrorMsg(ex.response?.data?.detail || 'Failed to delete role'); }
  };

  return (
    <div>
      {confirmDelete && (
        <ConfirmDialog
          danger
          message={`Delete role '${confirmDelete.name}'?`}
          detail="This cannot be undone. All permissions in this role will be permanently removed."
          confirmLabel="Delete Role"
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {errorMsg && <ErrorDialog message={errorMsg} onClose={() => setErrorMsg(null)} />}

      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-base">Role Management</h1>
          <p className="text-sm text-text-sec mt-0.5">Define permission sets for user access control</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          {canManage && (
            <button onClick={() => { setShowCreate(v => !v); setEditRole(null); }}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors flex items-center gap-1.5">
              <Plus size={14} />
              New Role
            </button>
          )}
        </div>
      </header>

      {showCreate && canManage && (
        <RoleForm allPerms={allPerms} permLabels={permLabels} permGroups={permGroups}
          onSave={createRole} onCancel={() => setShowCreate(false)} />
      )}
      {editRole && canManage && (
        <RoleForm allPerms={allPerms} permLabels={permLabels} permGroups={permGroups}
          initial={editRole} onSave={updateRole} onCancel={() => setEditRole(null)} />
      )}

      <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-base">
          <ShieldCheck size={15} className="text-accent" />
          <span className="text-sm font-semibold text-text-base">All Roles</span>
          <span className="ml-auto text-text-sec text-xs font-semibold">{roles.length} defined</span>
        </div>
        {loading ? (
          <div className="px-4 py-10 text-center text-text-sec text-sm">Loading…</div>
        ) : (
          <div>
            {roles.map(role => (
              <div key={role.id} className="border-t border-border-base">
                <div
                  className="flex items-center gap-3 px-4 py-3 hover:bg-subtle cursor-pointer transition-colors"
                  onClick={() => setExpandedId(expandedId === role.id ? null : role.id)}>
                  <ShieldCheck size={15} className="text-text-sec shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text-base">{role.name}</span>
                      {role.is_builtin && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-warning-bg text-warning rounded uppercase">Built-in</span>
                      )}
                    </div>
                    {role.description && <div className="text-xs text-text-sec mt-0.5">{role.description}</div>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-text-sec">{role.permissions.length} perms · {role.user_count} users</span>
                    {canManage && !role.is_builtin && (
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => { setEditRole(role); setShowCreate(false); }}
                          className="p-1.5 text-text-sec hover:text-text-base border border-border-base rounded-md bg-surface hover:bg-subtle transition-colors"
                          title="Edit role">
                          <Edit2 size={12} />
                        </button>
                        <button onClick={() => setConfirmDelete(role)}
                          disabled={role.user_count > 0}
                          className="p-1.5 text-text-sec hover:text-danger border border-border-base rounded-md bg-surface hover:bg-subtle disabled:opacity-30 transition-colors"
                          title={role.user_count > 0 ? 'Reassign users first' : 'Delete role'}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {expandedId === role.id && (
                  <div className="px-4 py-4 bg-subtle border-t border-border-base">
                    <PermissionGrid allPerms={allPerms} permLabels={permLabels} permGroups={permGroups}
                      selected={new Set(role.permissions)} onChange={() => {}} disabled />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
