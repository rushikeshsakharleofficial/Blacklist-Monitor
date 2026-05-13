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
  const fromBg = from === 'listed' ? '#e74c3c' : from === 'clean' ? '#27ae60' : '#7f8c8d';
  const toBg   = to   === 'listed' ? '#e74c3c' : '#27ae60';
  return (
    <span className="flex items-center gap-1">
      <span className="text-[10px] font-bold px-1.5 py-0.5 text-white uppercase" style={{ background: fromBg, borderRadius: 2 }}>{from}</span>
      <span className="text-muted text-[10px]">→</span>
      <span className="text-[10px] font-bold px-1.5 py-0.5 text-white uppercase" style={{ background: toBg, borderRadius: 2 }}>{to}</span>
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
      <header className="flex justify-between items-center border-b border-panel-border pb-2">
        <div>
          <h1 className="text-base font-bold text-foreground uppercase tracking-wide">Alerts &amp; Notifications</h1>
          <p className="text-muted text-[11px] mt-0.5">Alert history, channel configuration and message templates</p>
        </div>
        <button onClick={load} className="flex items-center gap-1 px-3 py-1.5 text-xs border border-panel-border bg-white hover:bg-row-alt">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </header>

      {/* Channel status cards */}
      <div className="grid grid-cols-2 gap-4">
        {(['slack', 'email'] as const).map(ch => {
          const configured = ch === 'slack' ? channels?.slack.configured : channels?.email.configured;
          const result = testResults[ch];
          return (
            <div key={ch} className="border border-panel-border">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
                <Bell size={13} className="text-[#8ab4c8]" />
                <span className="text-white text-[11px] font-bold uppercase tracking-wider">{ch === 'slack' ? 'Slack' : 'Email'} Alerts</span>
                <span className="ml-auto">{configured ? <CheckCircle size={13} className="text-success" /> : <XCircle size={13} className="text-danger" />}</span>
              </div>
              <div className="bg-white p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold px-2 py-0.5 text-white uppercase"
                    style={{ background: configured ? '#27ae60' : '#7f8c8d', borderRadius: 2 }}>
                    {configured ? 'Configured' : 'Not Configured'}
                  </span>
                  {ch === 'email' && channels?.email.to && (
                    <span className="text-[10px] text-muted font-mono">→ {channels.email.to}</span>
                  )}
                </div>
                <p className="text-[11px] text-muted">
                  {ch === 'slack'
                    ? 'Set SLACK_WEBHOOK_URL environment variable to enable.'
                    : 'Set SMTP_SERVER, SMTP_USER, SMTP_PASSWORD, ALERT_EMAIL_TO to enable.'}
                </p>
                {canConfigure && (
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <button onClick={() => runTest(ch)} disabled={testing[ch] || !configured}
                      className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase text-white border border-[#2a5580] disabled:opacity-40"
                      style={{ background: '#336699', borderRadius: 2 }}>
                      <Send size={11} className={testing[ch] ? 'animate-pulse' : ''} />
                      {testing[ch] ? 'Sending…' : 'Send Test'}
                    </button>
                    {result && (
                      <span className={`text-[11px] font-bold flex items-center gap-1 ${result.ok ? 'text-success' : 'text-danger'}`}>
                        {result.ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
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
        <div className="border border-panel-border">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-panel-border cursor-pointer" style={{ background: '#2c3e50' }}
            onClick={() => setShowCfg(v => !v)}>
            <Settings size={13} className="text-[#8ab4c8]" />
            <span className="text-white text-[11px] font-bold uppercase tracking-wider">Channel Configuration</span>
            <span className="ml-auto text-[#8ab4c8] text-[10px]">{showCfg ? 'Hide ▲' : 'Configure ▼'}</span>
          </div>
          {showCfg && (
            <div className="bg-white p-4 grid grid-cols-2 gap-4">
              {/* Slack */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted mb-2">Slack</p>
                <label className="block text-[10px] font-bold uppercase text-foreground mb-1">Webhook URL</label>
                <input type="password" value={cfgForm.slack_webhook}
                  onChange={e => setCfgForm(f => ({ ...f, slack_webhook: e.target.value }))}
                  placeholder="https://hooks.slack.com/services/…"
                  className="w-full px-2.5 py-1.5 text-xs border border-panel-border font-mono focus:outline-none focus:border-primary"
                  style={{ borderRadius: 2 }} />
                <p className="text-[10px] text-muted mt-1">Leave blank to use SLACK_WEBHOOK_URL env var. Enter new value to override.</p>
              </div>
              {/* Email */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted mb-1">Email / SMTP</p>
                {[
                  { key: 'smtp_server', label: 'SMTP Server', placeholder: 'smtp.gmail.com', type: 'text' },
                  { key: 'smtp_port',   label: 'Port',        placeholder: '587', type: 'text' },
                  { key: 'smtp_user',   label: 'Username',    placeholder: 'you@example.com', type: 'text' },
                  { key: 'smtp_password', label: 'Password',  placeholder: '••••••••', type: 'password' },
                  { key: 'smtp_to',     label: 'Send Alerts To', placeholder: 'alerts@example.com', type: 'text' },
                ].map(({ key, label, placeholder, type }) => (
                  <div key={key}>
                    <label className="block text-[10px] font-bold uppercase text-foreground mb-1">{label}</label>
                    <input type={type} value={(cfgForm as any)[key]}
                      onChange={e => setCfgForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className="w-full px-2.5 py-1.5 text-xs border border-panel-border font-mono focus:outline-none focus:border-primary"
                      style={{ borderRadius: 2 }} />
                  </div>
                ))}
              </div>
              <div className="col-span-2 flex items-center gap-3">
                <button onClick={saveCfg} disabled={cfgSaving}
                  className="flex items-center gap-1 px-4 py-1.5 text-xs font-bold uppercase text-white border border-[#2a5580] disabled:opacity-50"
                  style={{ background: '#336699', borderRadius: 2 }}>
                  <Check size={12} /> {cfgSaving ? 'Saving…' : 'Save Configuration'}
                </button>
                {cfgMsg && (
                  <span className={`text-[11px] font-bold ${cfgMsg.includes('success') ? 'text-success' : 'text-danger'}`}>
                    {cfgMsg}
                  </span>
                )}
                <span className="text-[10px] text-muted ml-auto">DB settings override env vars. Clear a field to revert to env var.</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Template editor */}
      {canConfigure && templates && (
        <div className="border border-panel-border">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
            <Edit2 size={13} className="text-[#8ab4c8]" />
            <span className="text-white text-[11px] font-bold uppercase tracking-wider">Message Templates</span>
            <span className="ml-auto text-[#8ab4c8] text-[10px] font-mono">{templates.variables.join('  ')}</span>
          </div>
          <div className="bg-white divide-y divide-panel-border">
            {Object.entries(TEMPLATE_LABELS).map(([key, label]) => {
              const isEditing = editKey === key;
              const isCustom = templates.templates[key] !== templates.defaults[key];
              return (
                <div key={key}>
                  <div className="flex items-center gap-2 px-3 py-2 bg-row-alt">
                    <span className="text-[11px] font-bold text-foreground flex-1">{label}</span>
                    {isCustom && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-[#f39c12] text-white uppercase" style={{ borderRadius: 2 }}>Custom</span>}
                    {!isEditing && (
                      <div className="flex gap-1">
                        <button onClick={() => { setEditKey(key); setEditValue(templates.templates[key]); }}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase border border-panel-border bg-white hover:bg-row-alt"
                          style={{ borderRadius: 2 }}>
                          <Edit2 size={10} /> Edit
                        </button>
                        {isCustom && (
                          <button onClick={() => resetTpl(key)}
                            className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase border border-panel-border bg-white hover:bg-row-alt text-muted"
                            style={{ borderRadius: 2 }}>
                            <RotateCcw size={10} /> Reset
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="px-3 py-3">
                      <textarea value={editValue} onChange={e => setEditValue(e.target.value)}
                        rows={key.includes('body') ? 14 : 2}
                        className="w-full px-2.5 py-2 text-[11px] font-mono border border-panel-border focus:outline-none focus:border-primary resize-y"
                        style={{ borderRadius: 2 }} />
                      <div className="flex gap-2 mt-2">
                        <button onClick={saveEdit} disabled={saving}
                          className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase text-white border border-[#2a5580] disabled:opacity-50"
                          style={{ background: '#336699', borderRadius: 2 }}>
                          <Check size={11} /> {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditKey(null)}
                          className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase border border-panel-border"
                          style={{ borderRadius: 2 }}>
                          <X size={11} /> Cancel
                        </button>
                        <button onClick={() => setEditValue(templates.defaults[key])}
                          className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase border border-panel-border text-muted"
                          style={{ borderRadius: 2 }}>
                          <RotateCcw size={11} /> Use Default
                        </button>
                      </div>
                    </div>
                  ) : (
                    <pre className="px-3 py-2 text-[10px] font-mono text-muted overflow-hidden" style={{ maxHeight: 56, WebkitLineClamp: 3 }}>
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
      <div className="border border-panel-border">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
          <Bell size={13} className="text-[#8ab4c8]" />
          <span className="text-white text-[11px] font-bold uppercase tracking-wider">Alert History</span>
          <span className="ml-auto text-[#8ab4c8] text-[10px] font-bold">{total} TOTAL</span>
        </div>
        {loading ? (
          <div className="bg-white px-4 py-8 text-center text-muted text-xs">Loading…</div>
        ) : alerts.length === 0 ? (
          <div className="bg-white px-4 py-8 text-center text-muted text-xs">
            No alerts fired yet. Alerts trigger when a monitored asset changes blacklist status.
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ background: '#2c3e50', color: 'white' }}>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166]">Target</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-44">Status Change</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-36">Channels</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase font-bold tracking-wide border border-[#3d5166] w-36">Time</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a, i) => (
                <tr key={a.id} className={i % 2 === 0 ? 'bg-white' : 'bg-row-alt'}>
                  <td className="px-3 py-1.5 border border-panel-border font-mono font-bold text-foreground">{a.target_address}</td>
                  <td className="px-3 py-1.5 border border-panel-border"><StatusChange from={a.from_status} to={a.to_status} /></td>
                  <td className="px-3 py-1.5 border border-panel-border">
                    {a.channels.length > 0
                      ? <div className="flex gap-1">{a.channels.map(ch => (
                          <span key={ch} className="text-[10px] font-bold px-1.5 py-0.5 bg-[#1e3a5f] text-[#8ab4c8] uppercase" style={{ borderRadius: 2 }}>{ch}</span>
                        ))}</div>
                      : <span className="text-[10px] text-muted italic">none</span>}
                  </td>
                  <td className="px-3 py-1.5 border border-panel-border text-[10px] text-muted">{fmt(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[#f0f2f5]">
                <td colSpan={4} className="px-3 py-1.5 border border-panel-border">
                  <div className="flex items-center justify-between">
                    <span className="text-muted text-[11px]">{total} alert{total !== 1 ? 's' : ''} total</span>
                    {totalPages > 1 && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted font-mono">{(page-1)*pageSize+1}–{Math.min(page*pageSize,total)} of {total}</span>
                        <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                          className="p-0.5 border border-panel-border bg-white disabled:opacity-40" style={{ borderRadius: 2 }}><ChevronLeft size={12} /></button>
                        <span className="text-[10px] font-bold">{page}/{totalPages}</span>
                        <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}
                          className="p-0.5 border border-panel-border bg-white disabled:opacity-40" style={{ borderRadius: 2 }}><ChevronRight size={12} /></button>
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
