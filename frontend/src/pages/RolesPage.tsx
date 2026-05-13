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
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">{label}</div>
          <div className="flex flex-wrap gap-1.5">
            {perms.map(p => {
              const checked = selected.has(p);
              return (
                <button key={p} type="button" disabled={disabled}
                  onClick={() => toggle(p)}
                  className={`px-2 py-1 text-[10px] font-bold uppercase border transition-colors ${
                    checked
                      ? 'bg-[#1e3a5f] text-[#8ab4c8] border-[#2a5580]'
                      : 'bg-white text-muted border-panel-border hover:border-[#336699]'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                  style={{ borderRadius: 2 }}>
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
    <div className="border border-panel-border mb-4">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
        <Plus size={13} className="text-[#8ab4c8]" />
        <span className="text-white text-[11px] font-bold uppercase tracking-wider">
          {initial ? `Edit Role: ${initial.name}` : 'Create New Role'}
        </span>
      </div>
      <form onSubmit={submit} className="bg-white p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-foreground mb-1">Role Name</label>
            <input required value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. read_only_analyst"
              className="w-full px-2.5 py-1.5 text-xs border border-panel-border font-mono focus:outline-none focus:border-primary"
              style={{ borderRadius: 2 }} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-foreground mb-1">Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-panel-border focus:outline-none focus:border-primary"
              style={{ borderRadius: 2 }} />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-foreground mb-2">Permissions</label>
          <PermissionGrid allPerms={allPerms} permLabels={permLabels} permGroups={permGroups}
            selected={selected} onChange={setSelected} />
        </div>
        {err && <div className="text-danger text-xs">{err}</div>}
        <div className="flex gap-2">
          <button type="submit" disabled={loading}
            className="flex items-center gap-1 px-4 py-1.5 text-xs font-bold uppercase text-white border border-[#2a5580] disabled:opacity-50"
            style={{ background: '#336699', borderRadius: 2 }}>
            <Check size={12} /> {loading ? 'Saving…' : 'Save Role'}
          </button>
          <button type="button" onClick={onCancel}
            className="flex items-center gap-1 px-4 py-1.5 text-xs font-bold uppercase border border-panel-border text-foreground"
            style={{ borderRadius: 2 }}>
            <X size={12} /> Cancel
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

  const deleteRole = async (role: Role) => {
    setConfirmDelete(role);
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

      <header className="flex justify-between items-center mb-4 border-b border-panel-border pb-2">
        <div>
          <h1 className="text-base font-bold text-foreground uppercase tracking-wide">Role Management</h1>
          <p className="text-muted text-[11px] mt-0.5">Define permission sets for user access control</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-panel-border bg-white hover:bg-row-alt">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          {canManage && (
            <button onClick={() => { setShowCreate(v => !v); setEditRole(null); }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase text-white border border-[#2a5580]"
              style={{ background: '#336699', borderRadius: 2 }}>
              <Plus size={12} />
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

      <div className="border border-panel-border">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
          <ShieldCheck size={13} className="text-[#8ab4c8]" />
          <span className="text-white text-[11px] font-bold uppercase tracking-wider">All Roles</span>
          <span className="ml-auto text-[#8ab4c8] text-[10px] font-bold">{roles.length} DEFINED</span>
        </div>
        {loading ? (
          <div className="bg-white px-4 py-8 text-center text-muted text-xs">Loading…</div>
        ) : (
          <div>
            {roles.map(role => (
              <div key={role.id} className="border-t border-panel-border">
                <div
                  className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-row-alt cursor-pointer"
                  onClick={() => setExpandedId(expandedId === role.id ? null : role.id)}>
                  <ShieldCheck size={13} className="text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-foreground uppercase">{role.name}</span>
                      {role.is_builtin && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 bg-[#f39c12] text-white uppercase tracking-wide" style={{ borderRadius: 2 }}>Built-in</span>
                      )}
                    </div>
                    {role.description && <div className="text-[10px] text-muted mt-0.5">{role.description}</div>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-muted">{role.permissions.length} perms · {role.user_count} users</span>
                    {canManage && !role.is_builtin && (
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => { setEditRole(role); setShowCreate(false); }}
                          className="p-1 text-muted hover:text-foreground border border-panel-border bg-white"
                          title="Edit role" style={{ borderRadius: 2 }}>
                          <Edit2 size={11} />
                        </button>
                        <button onClick={() => deleteRole(role)}
                          disabled={role.user_count > 0}
                          className="p-1 text-muted hover:text-danger border border-panel-border bg-white disabled:opacity-30"
                          title={role.user_count > 0 ? 'Reassign users first' : 'Delete role'}
                          style={{ borderRadius: 2 }}>
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {expandedId === role.id && (
                  <div className="px-4 py-3 bg-row-alt border-t border-panel-border">
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
