import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Users, Plus, RefreshCw, Key, UserX, UserCheck, ChevronDown } from 'lucide-react';
import { ConfirmDialog, ApiKeyDialog, ErrorDialog } from '../components/Dialog';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

interface Role { id: number; name: string; is_builtin: boolean; }
interface User {
  id: number; email: string; name: string; is_active: boolean;
  created_at: string | null; last_login: string | null;
  role: Role | null; permissions: string[];
}

function badge(text: string, color: string) {
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 text-white uppercase tracking-wide"
      style={{ background: color, borderRadius: 2 }}>{text}</span>
  );
}

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

interface CreateUserFormProps {
  roles: Role[];
  onCreated: () => void;
  onCancel: () => void;
}

function CreateUserForm({ roles, onCreated, onCancel }: CreateUserFormProps) {
  const [form, setForm] = useState({ email: '', name: '', password: '', role_id: roles[0]?.id ?? 0 });
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setErr(null);
    try {
      await axios.post(`${API}/users`, { ...form, role_id: Number(form.role_id) });
      onCreated();
    } catch (ex: any) {
      setErr(ex.response?.data?.detail || 'Failed to create user');
    } finally { setLoading(false); }
  };

  return (
    <div className="border border-panel-border mb-4">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
        <Plus size={13} className="text-[#8ab4c8]" />
        <span className="text-white text-[11px] font-bold uppercase tracking-wider">Create New User</span>
      </div>
      <form onSubmit={submit} className="bg-white p-4 grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-foreground mb-1">Email</label>
          <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
            className="w-full px-2.5 py-1.5 text-xs border border-panel-border font-mono focus:outline-none focus:border-primary" style={{ borderRadius: 2 }} />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-foreground mb-1">Full Name</label>
          <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-2.5 py-1.5 text-xs border border-panel-border font-mono focus:outline-none focus:border-primary" style={{ borderRadius: 2 }} />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-foreground mb-1">Password (min 8 chars)</label>
          <input required type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
            className="w-full px-2.5 py-1.5 text-xs border border-panel-border font-mono focus:outline-none focus:border-primary" style={{ borderRadius: 2 }} />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-foreground mb-1">Role</label>
          <select value={form.role_id} onChange={e => setForm({ ...form, role_id: Number(e.target.value) })}
            className="w-full px-2.5 py-1.5 text-xs border border-panel-border focus:outline-none" style={{ borderRadius: 2 }}>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        {err && <div className="col-span-2 text-danger text-xs">{err}</div>}
        <div className="col-span-2 flex gap-2">
          <button type="submit" disabled={loading}
            className="px-4 py-1.5 text-xs font-bold uppercase text-white border border-[#2a5580] disabled:opacity-50"
            style={{ background: '#336699', borderRadius: 2 }}>
            {loading ? 'Creating…' : 'Create User'}
          </button>
          <button type="button" onClick={onCancel}
            className="px-4 py-1.5 text-xs font-bold uppercase border border-panel-border text-foreground"
            style={{ borderRadius: 2 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

interface DialogState {
  type: 'confirm-deactivate' | 'confirm-reset-key' | 'show-key' | 'error';
  user?: User;
  apiKey?: string;
  message?: string;
}

interface UserRowProps {
  user: User;
  roles: Role[];
  currentUserId: number;
  myPermissions: string[];
  onRefresh: () => void;
  onDialog: (d: DialogState) => void;
}

function UserRow({ user, roles, currentUserId, myPermissions, onRefresh, onDialog }: UserRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [roleChanging, setRoleChanging] = useState(false);
  const canWrite = myPermissions.includes('users:write');
  const canSetRole = myPermissions.includes('users:set_role');
  const canResetKey = myPermissions.includes('users:reset_key');
  const isSelf = user.id === currentUserId;

  const changeRole = async (roleId: number) => {
    setRoleChanging(true);
    try {
      await axios.put(`${API}/users/${user.id}/role`, { role_id: roleId });
      onRefresh();
    } catch (ex: any) {
      onDialog({ type: 'error', message: ex.response?.data?.detail || 'Failed to change role' });
    } finally { setRoleChanging(false); }
  };

  return (
    <tr className="border-t border-panel-border hover:bg-row-alt">
      <td className="px-3 py-2">
        <div className="text-xs font-medium text-foreground">{user.name || '—'}</div>
        <div className="text-[10px] font-mono text-muted">{user.email}</div>
      </td>
      <td className="px-3 py-2">
        {user.role
          ? <span className="text-[10px] font-bold px-2 py-0.5 bg-[#1e3a5f] text-[#8ab4c8] uppercase tracking-wide" style={{ borderRadius: 2 }}>{user.role.name}</span>
          : <span className="text-muted text-xs">—</span>}
      </td>
      <td className="px-3 py-2">
        {user.is_active ? badge('Active', '#27ae60') : badge('Inactive', '#7f8c8d')}
      </td>
      <td className="px-3 py-2 text-[10px] text-muted">{fmt(user.last_login)}</td>
      <td className="px-3 py-2 text-[10px] text-muted">{fmt(user.created_at)}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5 relative">
          {canSetRole && !isSelf && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="flex items-center gap-1 px-2 py-1 text-[10px] border border-panel-border bg-white hover:bg-row-alt uppercase font-bold"
                style={{ borderRadius: 2 }}>
                Role <ChevronDown size={10} />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-0.5 border border-panel-border bg-white shadow-sm min-w-[140px]">
                    {roles.map(r => (
                      <button key={r.id} disabled={roleChanging}
                        onClick={() => { changeRole(r.id); setMenuOpen(false); }}
                        className={`block w-full text-left px-3 py-1.5 text-[10px] uppercase font-bold hover:bg-row-alt disabled:opacity-50 ${user.role?.id === r.id ? 'text-primary' : ''}`}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {canWrite && !isSelf && (
            <button onClick={() => onDialog({ type: 'confirm-deactivate', user })}
              className="p-1 text-muted hover:text-foreground border border-panel-border bg-white"
              title={user.is_active ? 'Deactivate' : 'Reactivate'}
              style={{ borderRadius: 2 }}>
              {user.is_active ? <UserX size={12} /> : <UserCheck size={12} />}
            </button>
          )}
          {canResetKey && (
            <button onClick={() => onDialog({ type: 'confirm-reset-key', user })}
              className="p-1 text-muted hover:text-foreground border border-panel-border bg-white"
              title="Reset API Key"
              style={{ borderRadius: 2 }}>
              <Key size={12} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const myPermsRaw = localStorage.getItem('permissions') || '[]';
  const myPermissions: string[] = JSON.parse(myPermsRaw);
  const myEmail = localStorage.getItem('user_email') || '';
  const canWrite = myPermissions.includes('users:write');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, rRes] = await Promise.all([
        axios.get(`${API}/users`),
        axios.get(`${API}/roles`),
      ]);
      setUsers(uRes.data.users);
      setRoles(rRes.data.roles);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const currentUser = users.find(u => u.email === myEmail);
  const currentUserId = currentUser?.id ?? -1;

  const handleConfirmDeactivate = async () => {
    const user = dialog?.user;
    if (!user) return;
    setDialog(null);
    try {
      await axios.put(`${API}/users/${user.id}`, { is_active: !user.is_active });
      load();
    } catch (ex: any) {
      setDialog({ type: 'error', message: ex.response?.data?.detail || 'Failed' });
    }
  };

  const handleConfirmResetKey = async () => {
    const user = dialog?.user;
    if (!user) return;
    setDialog(null);
    try {
      const res = await axios.post(`${API}/users/${user.id}/reset-api-key`);
      setDialog({ type: 'show-key', user, apiKey: res.data.api_key });
    } catch (ex: any) {
      setDialog({ type: 'error', message: ex.response?.data?.detail || 'Failed' });
    }
  };

  return (
    <div>
      {dialog?.type === 'confirm-deactivate' && dialog.user && (
        <ConfirmDialog
          danger
          message={`${dialog.user.is_active ? 'Deactivate' : 'Reactivate'} user ${dialog.user.email}?`}
          detail={dialog.user.is_active ? 'They will lose console access immediately.' : 'They will regain access with their existing credentials.'}
          confirmLabel={dialog.user.is_active ? 'Deactivate' : 'Reactivate'}
          onConfirm={handleConfirmDeactivate}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'confirm-reset-key' && dialog.user && (
        <ConfirmDialog
          message={`Reset API key for ${dialog.user.email}?`}
          detail="Their current API key will stop working immediately. You will receive the new key to share with them."
          confirmLabel="Reset Key"
          onConfirm={handleConfirmResetKey}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'show-key' && dialog.user && dialog.apiKey && (
        <ApiKeyDialog
          email={dialog.user.email}
          apiKey={dialog.apiKey}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'error' && (
        <ErrorDialog message={dialog.message || 'An error occurred'} onClose={() => setDialog(null)} />
      )}

      <header className="flex justify-between items-center mb-4 border-b border-panel-border pb-2">
        <div>
          <h1 className="text-base font-bold text-foreground uppercase tracking-wide">User Management</h1>
          <p className="text-muted text-[11px] mt-0.5">Manage console access and permissions</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-panel-border bg-white hover:bg-row-alt">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          {canWrite && (
            <button onClick={() => setShowCreate(v => !v)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase text-white border border-[#2a5580]"
              style={{ background: '#336699', borderRadius: 2 }}>
              <Plus size={12} />
              New User
            </button>
          )}
        </div>
      </header>

      {showCreate && canWrite && (
        <CreateUserForm roles={roles} onCreated={() => { setShowCreate(false); load(); }} onCancel={() => setShowCreate(false)} />
      )}

      <div className="border border-panel-border">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
          <Users size={13} className="text-[#8ab4c8]" />
          <span className="text-white text-[11px] font-bold uppercase tracking-wider">All Users</span>
          <span className="ml-auto text-[#8ab4c8] text-[10px] font-bold">{users.length} TOTAL</span>
        </div>
        {loading ? (
          <div className="bg-white px-4 py-8 text-center text-muted text-xs">Loading…</div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-row-alt border-b border-panel-border">
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted">User</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted">Role</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted">Status</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted">Last Login</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted">Created</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <UserRow key={u.id} user={u} roles={roles} currentUserId={currentUserId}
                  myPermissions={myPermissions} onRefresh={load} onDialog={setDialog} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
