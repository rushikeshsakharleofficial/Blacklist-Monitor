import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Settings, Key, LogOut, Server, Shield, RefreshCw, Check, Copy } from 'lucide-react';
import OTPInput from '../components/OTPInput';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const STORAGE_KEY = 'api_key';

interface LdapConfig {
  is_enabled: boolean;
  host: string;
  port: number;
  tls_mode: 'none' | 'start_tls' | 'ldaps';
  bind_dn: string;
  bind_password: string;
  user_search_base: string;
  user_search_filter: string;
  group_search_base: string;
  group_member_attr: string;
}

interface LdapGroupMapping {
  id: number;
  ldap_group: string;
  role_id: number;
  role_name: string;
}

interface SettingsPageProps {
  onLogout: () => void;
}

interface LdapPanelProps {
  config: LdapConfig;
  onChange: (c: LdapConfig) => void;
  onSave: () => void;
  saving: boolean;
  msg: { type: 'ok' | 'err'; text: string } | null;
  onTest: () => void;
  testing: boolean;
  testResult: { ok: boolean; error: string | null } | null;
  groupMappings: LdapGroupMapping[];
  roles: { id: number; name: string }[];
  newMapping: { ldap_group: string; role_id: number };
  onNewMappingChange: (m: { ldap_group: string; role_id: number }) => void;
  onAddMapping: () => void;
  addingMapping: boolean;
  onDeleteMapping: (id: number) => void;
}

function LdapSettingsPanel({
  config, onChange, onSave, saving, msg, onTest, testing, testResult,
  groupMappings, roles, newMapping, onNewMappingChange, onAddMapping,
  addingMapping, onDeleteMapping,
}: LdapPanelProps) {
  const inputCls = 'border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full font-mono';
  const labelCls = 'text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block';

  const field = (label: string, key: keyof LdapConfig, type = 'text', placeholder = '') => (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type={type}
        value={config[key] as string | number}
        onChange={e => onChange({ ...config, [key]: type === 'number' ? Number(e.target.value) : e.target.value })}
        placeholder={placeholder}
        className={inputCls}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="bg-surface border border-border-base rounded-xl p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-semibold text-text-base">LDAP / Active Directory</h2>
            <p className="text-xs text-text-sec mt-0.5">Allow users to sign in with corporate credentials</p>
          </div>
          <button
            onClick={() => onChange({ ...config, is_enabled: !config.is_enabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.is_enabled ? 'bg-accent' : 'bg-border-strong'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.is_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('LDAP Host', 'host', 'text', 'ldap.company.com')}
          {field('Port', 'port', 'number', '389')}
          <div>
            <label className={labelCls}>TLS Mode</label>
            <select
              value={config.tls_mode}
              onChange={e => onChange({ ...config, tls_mode: e.target.value as LdapConfig['tls_mode'] })}
              className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full"
            >
              <option value="none">None (plaintext)</option>
              <option value="start_tls">STARTTLS</option>
              <option value="ldaps">LDAPS (port 636)</option>
            </select>
          </div>
          {field('Bind DN', 'bind_dn', 'text', 'cn=svc-guardly,ou=service,dc=company,dc=com')}
          {field('Bind Password', 'bind_password', 'password', '••••••••')}
          {field('User Search Base', 'user_search_base', 'text', 'ou=users,dc=company,dc=com')}
          {field('User Search Filter', 'user_search_filter', 'text', '(mail={email})')}
          {field('Group Search Base', 'group_search_base', 'text', 'ou=groups,dc=company,dc=com')}
          {field('Group Member Attribute', 'group_member_attr', 'text', 'memberOf')}
        </div>

        <div className="flex items-center gap-3 mt-5 flex-wrap">
          <button
            onClick={onTest}
            disabled={testing || !config.host}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors disabled:opacity-50"
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Configuration'}
          </button>
          {testResult && (
            <span className={`text-sm font-medium ${testResult.ok ? 'text-success' : 'text-danger'}`}>
              {testResult.ok ? '✓ Connection successful' : `✗ ${testResult.error}`}
            </span>
          )}
          {msg && (
            <span className={`text-sm font-medium ${msg.type === 'ok' ? 'text-success' : 'text-danger'}`}>
              {msg.text}
            </span>
          )}
        </div>
      </div>

      <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border-base bg-subtle flex items-center justify-between">
          <span className="text-sm font-semibold text-text-base">Group → Role Mappings</span>
          <span className="text-xs text-text-sec">{groupMappings.length} mapping{groupMappings.length !== 1 ? 's' : ''}</span>
        </div>

        {groupMappings.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-4 py-2.5 border-b border-border-base text-left">LDAP Group DN / CN</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-4 py-2.5 border-b border-border-base text-left w-36">Guardly Role</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec bg-subtle px-4 py-2.5 border-b border-border-base w-20"></th>
              </tr>
            </thead>
            <tbody>
              {groupMappings.map(m => (
                <tr key={m.id} className="border-b border-border-base hover:bg-subtle transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-text-base break-all">{m.ldap_group}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent-subtle text-accent">{m.role_name}</span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => onDeleteMapping(m.id)} className="text-danger hover:opacity-70 text-xs font-medium transition-opacity">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="px-5 py-4 flex items-end gap-3 flex-wrap border-t border-border-base">
          <div className="flex-1 min-w-[240px]">
            <label className={labelCls}>LDAP Group</label>
            <input
              type="text"
              value={newMapping.ldap_group}
              onChange={e => onNewMappingChange({ ...newMapping, ldap_group: e.target.value })}
              placeholder="CN=Guardly-Admins,OU=Groups,DC=company,DC=com"
              className={inputCls}
            />
          </div>
          <div className="w-44">
            <label className={labelCls}>Map to Role</label>
            <select
              value={newMapping.role_id}
              onChange={e => onNewMappingChange({ ...newMapping, role_id: Number(e.target.value) })}
              className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full"
            >
              <option value={0}>Select role…</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <button
            onClick={onAddMapping}
            disabled={addingMapping || !newMapping.ldap_group || !newMapping.role_id}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {addingMapping ? 'Adding…' : '+ Add Mapping'}
          </button>
        </div>
      </div>

      <div className="bg-subtle border border-border-base rounded-xl px-5 py-4 space-y-1.5">
        <p className="font-semibold text-text-base text-xs uppercase tracking-wide">How LDAP login works</p>
        <ul className="list-disc list-inside space-y-1 text-xs text-text-sec">
          <li>When enabled, login attempts LDAP bind first, then falls back to local password.</li>
          <li>On first successful LDAP login, a local account is auto-created with the mapped role.</li>
          <li>Role updates in group mappings apply on next login.</li>
          <li>LDAP users cannot reset their password via Guardly — manage in your directory.</li>
          <li>The <code className="bg-surface px-1 rounded font-mono">super_admin</code> account always uses local auth as a break-glass fallback.</li>
        </ul>
      </div>
    </div>
  );
}

export default function SettingsPage({ onLogout }: SettingsPageProps) {
  const [providers, setProviders] = useState<string[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);

  const [activeTab, setActiveTab] = useState<'general' | 'ldap' | 'security'>('general');

  // 2FA state
  const [mfaStatus, setMfaStatus] = useState<{ enrolled: boolean; email_otp_enabled: boolean; recovery_codes_remaining: number } | null>(null);
  const [regenCode, setRegenCode] = useState('');
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenCodes, setRegenCodes] = useState<string[]>([]);
  const [regenErr, setRegenErr] = useState<string | null>(null);
  const [copiedRegen, setCopiedRegen] = useState(false);

  useEffect(() => {
    if (activeTab === 'security') {
      axios.get(`${API_BASE_URL}/auth/mfa/status`).then(r => setMfaStatus(r.data)).catch(() => {});
    }
  }, [activeTab]);

  const handleRegenCodes = async () => {
    if (regenCode.length < 6) return;
    setRegenLoading(true); setRegenErr(null);
    try {
      const r = await axios.post(`${API_BASE_URL}/auth/mfa/regenerate-recovery`, { code: regenCode });
      setRegenCodes(r.data.recovery_codes || []);
      setRegenCode('');
      setMfaStatus(s => s ? { ...s, recovery_codes_remaining: 8 } : s);
    } catch (e: any) {
      setRegenErr(e.response?.data?.detail || 'Failed to regenerate');
    } finally { setRegenLoading(false); }
  };
  const [ldapConfig, setLdapConfig] = useState<LdapConfig>({
    is_enabled: false, host: '', port: 389, tls_mode: 'none',
    bind_dn: '', bind_password: '', user_search_base: '',
    user_search_filter: '(mail={email})', group_search_base: '', group_member_attr: 'memberOf',
  });
  const [ldapSaving, setLdapSaving] = useState(false);
  const [ldapMsg, setLdapMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [ldapTesting, setLdapTesting] = useState(false);
  const [ldapTestResult, setLdapTestResult] = useState<{ ok: boolean; error: string | null } | null>(null);
  const [groupMappings, setGroupMappings] = useState<LdapGroupMapping[]>([]);
  const [roles, setRoles] = useState<{ id: number; name: string }[]>([]);
  const [newMapping, setNewMapping] = useState({ ldap_group: '', role_id: 0 });
  const [addingMapping, setAddingMapping] = useState(false);
  const apiKey = localStorage.getItem('api_key') || '';
  const headers = { 'X-API-Key': apiKey };

  useEffect(() => {
    const apiKey = localStorage.getItem(STORAGE_KEY) || '';
    axios
      .get(`${API_BASE_URL}/dnsbl-providers`, { headers: { 'X-API-Key': apiKey } })
      .then(res => setProviders(res.data.providers ?? []))
      .catch(() => setProviders([]))
      .finally(() => setLoadingProviders(false));
  }, []);

  useEffect(() => {
    axios.get(`${API_BASE_URL}/ldap/config`, { headers }).then(r => setLdapConfig(r.data)).catch(() => {});
    axios.get(`${API_BASE_URL}/ldap/group-mappings`, { headers }).then(r => setGroupMappings(r.data)).catch(() => {});
    axios.get(`${API_BASE_URL}/roles`, { headers })
      .then(r => setRoles((r.data as any[]).map((role: any) => ({ id: role.id, name: role.name }))))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLdapSave = async () => {
    setLdapSaving(true); setLdapMsg(null);
    try {
      await axios.put(`${API_BASE_URL}/ldap/config`, ldapConfig, { headers });
      setLdapMsg({ type: 'ok', text: 'LDAP configuration saved.' });
    } catch (e: any) {
      setLdapMsg({ type: 'err', text: e.response?.data?.detail || 'Save failed' });
    } finally { setLdapSaving(false); }
  };

  const handleLdapTest = async () => {
    setLdapTesting(true); setLdapTestResult(null);
    try {
      const r = await axios.post(`${API_BASE_URL}/ldap/test-connection`, ldapConfig, { headers });
      setLdapTestResult(r.data);
    } catch (e: any) {
      setLdapTestResult({ ok: false, error: e.response?.data?.detail || 'Request failed' });
    } finally { setLdapTesting(false); }
  };

  const handleAddMapping = async () => {
    if (!newMapping.ldap_group || !newMapping.role_id) return;
    setAddingMapping(true);
    try {
      const r = await axios.post(`${API_BASE_URL}/ldap/group-mappings`, newMapping, { headers });
      setGroupMappings(prev => [...prev, r.data]);
      setNewMapping({ ldap_group: '', role_id: 0 });
    } catch (e: any) {
      setLdapMsg({ type: 'err', text: e.response?.data?.detail || 'Failed to add mapping' });
    } finally { setAddingMapping(false); }
  };

  const handleDeleteMapping = async (id: number) => {
    await axios.delete(`${API_BASE_URL}/ldap/group-mappings/${id}`, { headers });
    setGroupMappings(prev => prev.filter(m => m.id !== id));
  };

  return (
    <div>
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-base">Settings</h1>
          <p className="text-sm text-text-sec mt-0.5">Application configuration and account management</p>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-border-base">
        {([['general', 'General'], ['security', 'Security'], ['ldap', 'LDAP / AD']] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-accent text-accent'
                : 'border-transparent text-text-sec hover:text-text-base'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'general' && (
        <div>
          <div className="max-w-2xl space-y-4">
            {/* API Authentication */}
            <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border-base">
                <Key size={15} className="text-accent" />
                <span className="text-sm font-semibold text-text-base">API Authentication</span>
              </div>
              <div className="p-4">
                <p className="text-sm font-medium text-text-base mb-1">X-API-Key header authentication</p>
                <p className="text-sm text-text-sec">
                  API key is stored locally in your browser. Set a strong key via the{' '}
                  <code className="bg-subtle border border-border-base px-1.5 py-0.5 rounded font-mono text-xs text-text-base">API_KEY</code>{' '}
                  environment variable on the backend.
                </p>
              </div>
            </div>

            {/* DNSBL Providers */}
            <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border-base">
                <div className="flex items-center gap-2">
                  <Server size={15} className="text-accent" />
                  <span className="text-sm font-semibold text-text-base">DNSBL Providers</span>
                </div>
                {!loadingProviders && (
                  <span className="text-xs font-semibold text-text-sec">{providers.length} Active</span>
                )}
              </div>
              <div>
                {loadingProviders ? (
                  <div className="px-4 py-8 text-center text-text-sec text-sm">Loading providers…</div>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-subtle">
                        <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-10">#</th>
                        <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left">Provider Zone</th>
                        <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-24">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {providers.map((dnsbl, i) => (
                        <tr key={dnsbl} className="border-b border-border-base hover:bg-subtle transition-colors">
                          <td className="px-3 py-2.5 text-text-sec text-xs">{i + 1}</td>
                          <td className="px-3 py-2.5 font-mono text-text-base text-sm">{dnsbl}</td>
                          <td className="px-3 py-2.5">
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-success-bg text-success uppercase">
                              Active
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Session */}
            <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border-base">
                <LogOut size={15} className="text-accent" />
                <span className="text-sm font-semibold text-text-base">Session</span>
              </div>
              <div className="p-4">
                <p className="text-sm text-text-sec mb-4">Manage your current monitoring console session.</p>
                <button
                  onClick={onLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-danger text-white hover:opacity-90 transition-opacity"
                >
                  <LogOut size={14} />
                  Sign Out
                </button>
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border-base">
                <Settings size={15} className="text-accent" />
                <span className="text-sm font-semibold text-text-base">Advanced Settings</span>
              </div>
              <div className="p-8 text-center">
                <Settings size={28} className="text-text-muted mx-auto mb-3 opacity-40" />
                <p className="text-sm font-semibold text-text-base mb-1">Planned Feature</p>
                <p className="text-sm text-text-sec max-w-md mx-auto">
                  Custom DNSBL providers, check intervals, and notification preferences coming in a future release.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'security' && (
        <div className="space-y-5">
          {/* 2FA Status */}
          <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border-base">
              <Shield size={15} className="text-accent" />
              <span className="text-sm font-semibold text-text-base">Two-Factor Authentication</span>
              {mfaStatus?.enrolled && (
                <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-success-bg text-success uppercase tracking-wide">Active</span>
              )}
            </div>
            <div className="p-5">
              {!mfaStatus ? (
                <p className="text-sm text-text-muted">Loading…</p>
              ) : mfaStatus.enrolled ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-subtle rounded-lg p-3">
                      <div className="text-xs text-text-muted mb-1">Recovery codes left</div>
                      <div className={`text-lg font-bold ${mfaStatus.recovery_codes_remaining <= 2 ? 'text-danger' : 'text-text-base'}`}>
                        {mfaStatus.recovery_codes_remaining} / 8
                      </div>
                    </div>
                    <div className="bg-subtle rounded-lg p-3">
                      <div className="text-xs text-text-muted mb-1">Email OTP fallback</div>
                      <div className="text-sm font-medium text-text-base">{mfaStatus.email_otp_enabled ? 'Enabled' : 'Disabled'}</div>
                    </div>
                  </div>

                  {mfaStatus.recovery_codes_remaining <= 2 && (
                    <p className="text-xs text-danger font-medium">⚠ Low recovery codes — regenerate soon.</p>
                  )}

                  {/* Regenerate recovery codes */}
                  {regenCodes.length === 0 ? (
                    <div>
                      <p className="text-xs text-text-sec mb-3">Enter your current authenticator code to generate new recovery codes. This invalidates all existing ones.</p>
                      <OTPInput value={regenCode} onChange={setRegenCode} onComplete={handleRegenCodes} disabled={regenLoading} />
                      {regenErr && <p className="text-xs text-danger text-center mt-2">{regenErr}</p>}
                      <button onClick={handleRegenCodes} disabled={regenCode.length < 6 || regenLoading}
                        className="w-full mt-3 flex items-center justify-center gap-1.5 py-2 border border-border-base rounded-lg text-xs font-medium text-text-base hover:bg-subtle disabled:opacity-40 transition-colors">
                        <RefreshCw size={12} /> Regenerate Recovery Codes
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-success font-medium mb-2">✓ New recovery codes generated. Save them now.</p>
                      <div className="bg-subtle border border-border-base rounded-lg p-3 grid grid-cols-2 gap-1 mb-2">
                        {regenCodes.map((c, i) => (
                          <span key={i} className="font-mono text-xs text-text-base text-center py-1 px-2 bg-surface rounded border border-border-base">{c}</span>
                        ))}
                      </div>
                      <button onClick={() => { navigator.clipboard.writeText(regenCodes.join('\n')); setCopiedRegen(true); setTimeout(() => setCopiedRegen(false), 2000); }}
                        className="w-full flex items-center justify-center gap-1.5 py-2 border border-border-base rounded-lg text-xs font-medium hover:bg-subtle transition-colors">
                        {copiedRegen ? <><Check size={11} className="text-success" /> Copied</> : <><Copy size={11} /> Copy all</>}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-4">
                  <Shield size={28} className="text-text-muted mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-semibold text-text-base mb-1">2FA not enrolled</p>
                  <p className="text-sm text-text-sec">Sign out and sign back in to complete enrollment.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'ldap' && (
        <LdapSettingsPanel
          config={ldapConfig}
          onChange={setLdapConfig}
          onSave={handleLdapSave}
          saving={ldapSaving}
          msg={ldapMsg}
          onTest={handleLdapTest}
          testing={ldapTesting}
          testResult={ldapTestResult}
          groupMappings={groupMappings}
          roles={roles}
          newMapping={newMapping}
          onNewMappingChange={setNewMapping}
          onAddMapping={handleAddMapping}
          addingMapping={addingMapping}
          onDeleteMapping={handleDeleteMapping}
        />
      )}
    </div>
  );
}
