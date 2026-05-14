import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Bell, RefreshCw, CheckCircle, XCircle, Send, RotateCcw, ChevronLeft, ChevronRight, Edit2, X, Check, Settings } from 'lucide-react';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

interface ChannelStatus {
  slack: { configured: boolean };
  email: { configured: boolean; to: string | null; server: string | null };
}
interface AlertItem {
  id: number; target_address: string; from_status: string; to_status: string;
  channels: string[]; created_at: string | null;
}
interface Templates {
  templates: Record<string, string>;
  defaults: Record<string, string>;
  variables: string[];
}

const TEMPLATE_LABELS: Record<string, string> = {
  slack_listed:          'Slack — IP Listed (JSON Block Kit)',
  slack_clean:           'Slack — IP Clean (JSON Block Kit)',
  email_subject_listed:  'Email Subject — IP Listed',
  email_subject_clean:   'Email Subject — IP Clean',
  email_body_listed:     'Email Body — IP Listed (HTML)',
  email_body_clean:      'Email Body — IP Clean (HTML)',
};

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function StatusChange({ from, to }: { from: string; to: string }) {
  const fromCls = from === 'listed' ? 'bg-danger-bg text-danger' : from === 'clean' ? 'bg-success-bg text-success' : 'bg-subtle text-text-sec';
  const toCls   = to === 'listed' ? 'bg-danger-bg text-danger' : 'bg-success-bg text-success';
  return (
    <span className="flex items-center gap-1">
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase ${fromCls}`}>{from}</span>
      <span className="text-text-muted text-xs">→</span>
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase ${toCls}`}>{to}</span>
    </span>
  );
}

interface CfgForm {
  slack_webhook: string;
  smtp_server: string; smtp_port: string; smtp_user: string;
  smtp_password: string; smtp_to: string;
}

export default function AlertsPage() {
  const [channels, setChannels]       = useState<ChannelStatus | null>(null);
  const [alerts, setAlerts]           = useState<AlertItem[]>([]);
  const [total, setTotal]             = useState(0);
  const [templates, setTemplates]     = useState<Templates | null>(null);
  const [loading, setLoading]         = useState(true);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error: string | null } | null>>({});
  const [testing, setTesting]         = useState<Record<string, boolean>>({});
  const [editKey, setEditKey]         = useState<string | null>(null);
  const [editValue, setEditValue]     = useState('');
  const [saving, setSaving]           = useState(false);
  const [page, setPage]               = useState(1);
  const [showCfg, setShowCfg]         = useState(false);
  const [cfgForm, setCfgForm]         = useState<CfgForm>({ slack_webhook: '', smtp_server: '', smtp_port: '587', smtp_user: '', smtp_password: '', smtp_to: '' });
  const [cfgSaving, setCfgSaving]     = useState(false);
  const [cfgMsg, setCfgMsg]           = useState<string | null>(null);
  const pageSize = 50;

  const myPermissions: string[] = JSON.parse(localStorage.getItem('permissions') || '[]');
  const canConfigure = myPermissions.includes('alerts:configure');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [chRes, alRes, tplRes, cfgRes] = await Promise.all([
        axios.get(`${API}/alerts/channels`),
        axios.get(`${API}/alerts?skip=${(page - 1) * pageSize}&limit=${pageSize}`),
        canConfigure ? axios.get(`${API}/alerts/templates`) : Promise.resolve(null),
        canConfigure ? axios.get(`${API}/alerts/config`) : Promise.resolve(null),
      ]);
      setChannels(chRes.data);
      setAlerts(alRes.data.items);
      setTotal(alRes.data.total);
      if (tplRes) setTemplates(tplRes.data);
      if (cfgRes) {
        const d = cfgRes.data;
        setCfgForm({
          slack_webhook: d.slack_webhook_set ? '••••••••' : '',
          smtp_server: d.smtp_server || '',
          smtp_port: d.smtp_port || '587',
          smtp_user: d.smtp_user || '',
          smtp_password: d.smtp_password_set ? '••••••••' : '',
          smtp_to: d.smtp_to || '',
        });
      }
    } catch {}
    setLoading(false);
  }, [page, canConfigure]);

  useEffect(() => { load(); }, [load]);

  const runTest = async (ch: 'slack' | 'email') => {
    setTesting(t => ({ ...t, [ch]: true }));
    setTestResults(r => ({ ...r, [ch]: null }));
    try {
      const res = await axios.post(`${API}/alerts/test/${ch}`);
      setTestResults(r => ({ ...r, [ch]: res.data }));
    } catch (ex: any) {
      setTestResults(r => ({ ...r, [ch]: { ok: false, error: ex.response?.data?.detail || 'Request failed' } }));
    }
    setTesting(t => ({ ...t, [ch]: false }));
  };

  const saveCfg = async () => {
    setCfgSaving(true); setCfgMsg(null);
    try {
      await axios.put(`${API}/alerts/config`, cfgForm);
      setCfgMsg('Saved successfully');
      await load();
    } catch (ex: any) {
      setCfgMsg(ex.response?.data?.detail || 'Save failed');
    }
    setCfgSaving(false);
  };

  const saveEdit = async () => {
    if (!editKey) return;
    setSaving(true);
    try {
      await axios.put(`${API}/alerts/templates`, { templates: { [editKey]: editValue } });
      await load(); setEditKey(null);
    } catch {}
    setSaving(false);
  };

  const resetTpl = async (key: string) => {
    await axios.delete(`${API}/alerts/templates/${key}`);
    await load();
    if (editKey === key) setEditKey(null);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-base">Alerts &amp; Notifications</h1>
          <p className="text-sm text-text-sec mt-0.5">Alert history, channel configuration and message templates</p>
        </div>
        <button onClick={load}
          className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors flex items-center gap-1.5">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </header>

      {/* Channel status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(['slack', 'email'] as const).map(ch => {
          const configured = ch === 'slack' ? channels?.slack.configured : channels?.email.configured;
          const result = testResults[ch];
          return (
            <div key={ch} className="bg-surface border border-border-base rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border-base">
                <Bell size={15} className="text-accent" />
                <span className="text-sm font-semibold text-text-base">{ch === 'slack' ? 'Slack' : 'Email'} Alerts</span>
                <span className="ml-auto">{configured ? <CheckCircle size={15} className="text-success" /> : <XCircle size={15} className="text-danger" />}</span>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full uppercase ${configured ? 'bg-success-bg text-success' : 'bg-subtle text-text-sec'}`}>
                    {configured ? 'Configured' : 'Not Configured'}
                  </span>
                  {ch === 'email' && channels?.email.to && (
                    <span className="text-xs text-text-sec font-mono">→ {channels.email.to}</span>
                  )}
                </div>
                <p className="text-sm text-text-sec">
                  {ch === 'slack'
                    ? 'Set SLACK_WEBHOOK_URL environment variable to enable.'
                    : 'Set SMTP_SERVER, SMTP_USER, SMTP_PASSWORD, ALERT_EMAIL_TO to enable.'}
                </p>
                {canConfigure && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => runTest(ch)} disabled={testing[ch] || !configured}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-40">
                      <Send size={13} className={testing[ch] ? 'animate-pulse' : ''} />
                      {testing[ch] ? 'Sending…' : 'Send Test'}
                    </button>
                    {result && (
                      <span className={`text-sm font-medium flex items-center gap-1 ${result.ok ? 'text-success' : 'text-danger'}`}>
                        {result.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
                        {result.ok ? 'Sent successfully' : result.error}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Channel config panel */}
      {canConfigure && (
        <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-base cursor-pointer hover:bg-subtle transition-colors"
            onClick={() => setShowCfg(v => !v)}>
            <Settings size={15} className="text-accent" />
            <span className="text-sm font-semibold text-text-base">Channel Configuration</span>
            <span className="ml-auto text-text-sec text-xs">{showCfg ? 'Hide ▲' : 'Configure ▼'}</span>
          </div>
          {showCfg && (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Slack */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-text-sec mb-3">Slack</p>
                <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">Webhook URL</label>
                <input type="password" value={cfgForm.slack_webhook}
                  onChange={e => setCfgForm(f => ({ ...f, slack_webhook: e.target.value }))}
                  placeholder="https://hooks.slack.com/services/…"
                  className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors" />
                <p className="text-xs text-text-muted mt-1">Leave blank to use SLACK_WEBHOOK_URL env var.</p>
              </div>
              {/* Email */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-text-sec">Email / SMTP</p>
                {[
                  { key: 'smtp_server', label: 'SMTP Server', placeholder: 'smtp.gmail.com', type: 'text' },
                  { key: 'smtp_port',   label: 'Port',        placeholder: '587', type: 'text' },
                  { key: 'smtp_user',   label: 'Username',    placeholder: 'you@example.com', type: 'text' },
                  { key: 'smtp_password', label: 'Password',  placeholder: '••••••••', type: 'password' },
                  { key: 'smtp_to',     label: 'Send Alerts To', placeholder: 'alerts@example.com', type: 'text' },
                ].map(({ key, label, placeholder, type }) => (
                  <div key={key}>
                    <label className="text-xs font-semibold text-text-sec uppercase tracking-wide mb-1.5 block">{label}</label>
                    <input type={type} value={(cfgForm as any)[key]}
                      onChange={e => setCfgForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className="border border-border-base rounded-lg px-3 py-2 text-sm bg-surface text-text-base font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full transition-colors" />
                  </div>
                ))}
              </div>
              <div className="col-span-2 flex items-center gap-3">
                <button onClick={saveCfg} disabled={cfgSaving}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50">
                  <Check size={14} /> {cfgSaving ? 'Saving…' : 'Save Configuration'}
                </button>
                {cfgMsg && (
                  <span className={`text-sm font-medium ${cfgMsg.includes('success') ? 'text-success' : 'text-danger'}`}>
                    {cfgMsg}
                  </span>
                )}
                <span className="text-xs text-text-muted ml-auto">DB settings override env vars. Clear a field to revert to env var.</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Template editor */}
      {canConfigure && templates && (
        <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-base">
            <Edit2 size={15} className="text-accent" />
            <span className="text-sm font-semibold text-text-base">Message Templates</span>
            <span className="ml-auto text-text-muted text-xs font-mono">{templates.variables.join('  ')}</span>
          </div>
          <div className="divide-y divide-border-base">
            {Object.entries(TEMPLATE_LABELS).map(([key, label]) => {
              const isEditing = editKey === key;
              const isCustom = templates.templates[key] !== templates.defaults[key];
              return (
                <div key={key}>
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-subtle">
                    <span className="text-sm font-medium text-text-base flex-1">{label}</span>
                    {isCustom && <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-warning-bg text-warning rounded uppercase">Custom</span>}
                    {!isEditing && (
                      <div className="flex gap-1">
                        <button onClick={() => { setEditKey(key); setEditValue(templates.templates[key]); }}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-border-base bg-surface hover:bg-subtle transition-colors text-text-base">
                          <Edit2 size={11} /> Edit
                        </button>
                        {isCustom && (
                          <button onClick={() => resetTpl(key)}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-border-base bg-surface hover:bg-subtle transition-colors text-text-sec">
                            <RotateCcw size={11} /> Reset
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="px-4 py-3">
                      <textarea value={editValue} onChange={e => setEditValue(e.target.value)}
                        rows={key.includes('body') ? 14 : 2}
                        className="border border-border-base rounded-lg px-3 py-2 text-xs font-mono bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-full resize-y transition-colors" />
                      <div className="flex gap-2 mt-2">
                        <button onClick={saveEdit} disabled={saving}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50">
                          <Check size={13} /> {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditKey(null)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors">
                          <X size={13} /> Cancel
                        </button>
                        <button onClick={() => setEditValue(templates.defaults[key])}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-border-base text-text-sec hover:bg-subtle transition-colors">
                          <RotateCcw size={13} /> Use Default
                        </button>
                      </div>
                    </div>
                  ) : (
                    <pre className="px-4 py-2 text-[10px] font-mono text-text-sec overflow-hidden" style={{ maxHeight: 56, WebkitLineClamp: 3 }}>
                      {templates.templates[key].slice(0, 240)}{templates.templates[key].length > 240 ? '…' : ''}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Alert history */}
      <div className="bg-surface border border-border-base rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-base">
          <Bell size={15} className="text-accent" />
          <span className="text-sm font-semibold text-text-base">Alert History</span>
          <span className="ml-auto text-text-sec text-xs font-semibold">{total} total</span>
        </div>
        {loading ? (
          <div className="px-4 py-10 text-center text-text-sec text-sm">Loading…</div>
        ) : alerts.length === 0 ? (
          <div className="px-4 py-10 text-center text-text-sec text-sm">
            No alerts fired yet. Alerts trigger when a monitored asset changes blacklist status.
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-subtle">
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left">Target</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-44">Status Change</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-36">Channels</th>
                <th className="text-[11px] font-semibold uppercase tracking-wide text-text-sec px-3 py-2.5 border-b border-border-base text-left w-36">Time</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className="border-b border-border-base hover:bg-subtle transition-colors">
                  <td className="px-3 py-2.5 font-mono font-semibold text-text-base text-sm">{a.target_address}</td>
                  <td className="px-3 py-2.5"><StatusChange from={a.from_status} to={a.to_status} /></td>
                  <td className="px-3 py-2.5">
                    {a.channels.length > 0
                      ? <div className="flex gap-1">{a.channels.map(ch => (
                          <span key={ch} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent-subtle text-accent uppercase">{ch}</span>
                        ))}</div>
                      : <span className="text-xs text-text-muted italic">none</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-text-sec">{fmt(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-subtle">
                <td colSpan={4} className="px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-text-sec text-xs">{total} alert{total !== 1 ? 's' : ''} total</span>
                    {totalPages > 1 && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-sec font-mono">{(page-1)*pageSize+1}–{Math.min(page*pageSize,total)} of {total}</span>
                        <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                          className="p-0.5 border border-border-base rounded bg-surface hover:bg-subtle disabled:opacity-40"><ChevronLeft size={13} /></button>
                        <span className="text-xs font-semibold text-text-base">{page}/{totalPages}</span>
                        <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}
                          className="p-0.5 border border-border-base rounded bg-surface hover:bg-subtle disabled:opacity-40"><ChevronRight size={13} /></button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
