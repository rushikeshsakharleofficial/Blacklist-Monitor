import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Users, Plus, RefreshCw, Key, UserX, UserCheck, ChevronDown, ShieldOff } from 'lucide-react';
import { ConfirmDialog, ApiKeyDialog, ErrorDialog } from '../components/Dialog';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

interface Role { id: number; name: string; is_builtin: boolean; }
interface User {
  id: number; email: string; name: string; is_active: boolean;
  created_at: string | null; last_login: string | null;
  role: Role | null; permissions: string[];
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
    <div className="bg-surface border border-border-base rounded-xl overflow-hidden mb-4">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-base">
        <Plus size={15} className="text-accent" />
        <span className="text-sm font-semibold text-text-base">Create New User</span>
      </div>
      <form onSubmit={submit} className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">Email</label>
          <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
            className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors" />
        </div>
        <div>
          <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">Full Name</label>
          <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors" />
        </div>
        <div>
          <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">Password (min 8 chars)</label>
          <input required type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
            className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors" />
        </div>
        <div>
          <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">Role</label>
          <select value={form.role_id} onChange={e => setForm({ ...form, role_id: Number(e.target.value) })}
            className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors">
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        {err && <div className="col-span-2 text-danger text-sm">{err}</div>}
        <div className="col-span-2 flex gap-2">
          <button type="submit" disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50">
            {loading ? 'Creating…' : 'Create User'}
          </button>
          <button type="button" onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

interface DialogState {
  type: 'confirm-deactivate' | 'confirm-reset-key' | 'confirm-reset-2fa' | 'show-key' | 'error';
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
    <tr className="border-b border-border-base hover:bg-subtle transition-colors">
      <td className="px-3 py-2.5">
        <div className="text-sm font-medium text-text-base">{user.name || '—'}</div>
        <div className="text-xs font-mono text-text-sec">{user.email}</div>
      </td>
      <td className="px-3 py-2.5">
        {user.role
          ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-accent-subtle text-accent uppercase">{user.role.name}</span>
          : <span className="text-text-sec text-sm">—</span>}
      </td>
      <td className="px-3 py-2.5">
        {user.is_active
          ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-success-bg text-success uppercase">Active</span>
          : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-subtle text-text-sec uppercase">Inactive</span>}
      </td>
      <td className="px-3 py-2.5 text-xs text-text-sec">{fmt(user.last_login)}</td>
      <td className="px-3 py-2.5 text-xs text-text-sec">{fmt(user.created_at)}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 relative">
          {canSetRole && !isSelf && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-border-base bg-surface hover:bg-subtle transition-colors">
                Role <ChevronDown size={11} />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-1 border border-border-base bg-surface rounded-lg shadow-lg min-w-[140px] overflow-hidden">
                    {roles.map(r => (
                      <button key={r.id} disabled={roleChanging}
                        onClick={() => { changeRole(r.id); setMenuOpen(false); }}
                        className={`block w-full text-left px-3 py-2 text-xs font-medium hover:bg-subtle disabled:opacity-50 transition-colors ${user.role?.id === r.id ? 'text-accent' : 'text-text-base'}`}>
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
              className="p-1.5 text-text-sec hover:text-text-base border border-border-base rounded-md bg-surface hover:bg-subtle transition-colors"
              title={user.is_active ? 'Deactivate' : 'Reactivate'}>
              {user.is_active ? <UserX size={13} /> : <UserCheck size={13} />}
            </button>
          )}
          {canResetKey && (
            <button onClick={() => onDialog({ type: 'confirm-reset-key', user })}
              className="p-1.5 text-text-sec hover:text-text-base border border-border-base rounded-md bg-surface hover:bg-subtle transition-colors"
              title="Reset API Key">
              <Key size={13} />
            </button>
          )}
          {canWrite && !isSelf && (
            <button onClick={() => onDialog({ type: 'confirm-reset-2fa', user })}
              className="p-1.5 text-text-sec hover:text-danger border border-border-base rounded-md bg-surface hover:bg-subtle transition-colors"
              title="Reset 2FA">
              <ShieldOff size={13} />
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

  const handleConfirmReset2FA = async () => {
    const user = dialog?.user;
    if (!user) return;
    setDialog(null);
    try {
      await axios.delete(`${API}/auth/mfa/${user.id}`);
      load();
    } catch (ex: any) {
      setDialog({ type: 'error', message: ex.response?.data?.detail || 'Failed to reset 2FA' });
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
      {dialog?.type === 'confirm-reset-2fa' && dialog.user && (
        <ConfirmDialog
          danger
          message={`Reset 2FA for ${dialog.user.email}?`}
          detail="This disables two-factor authentication for this user. They will be forced to re-enroll on next login."
          confirmLabel="Reset 2FA"
          onConfirm={handleConfirmReset2FA}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'show-key' && dialog.user && dialog.apiKey && (
        <ApiKeyDialog email={dialog.user.email} apiKey={dialog.apiKey} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'error' && (
        <ErrorDialog message={dialog.message || 'An error occurred'} onClose={() => setDialog(null)} />
      )}

      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-base">User Management</h1>
          <p className="text-sm text-text-sec mt-0.5">Manage console access and permissions</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          {canWrite && (
            <button onClick={() => setShowCreate(v => !v)}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors flex items-center gap-1.5">
              <Plus size={14} />
              New User
            </button>
          )}
        </div>
      </header>

      {showCreate && canWrite && (
        <CreateUserForm roles={roles} onCreated={() => { setShowCreate(false); load(); }} onCancel={() => setShowCreate(false)} />
      )}

      <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-base">
          <Users size={15} className="text-accent" />
          <span className="text-sm font-semibold text-text-base">All Users</span>
          <span className="ml-auto text-text-sec text-xs font-semibold">{users.length} total</span>
        </div>
        {loading ? (
          <div className="px-4 py-10 text-center text-text-sec text-sm">Loading…</div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-subtle">
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left">User</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left">Role</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left">Status</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left">Last Login</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left">Created</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left">Actions</th>
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
