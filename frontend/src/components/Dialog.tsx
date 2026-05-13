import React, { useEffect } from 'react';
import { AlertTriangle, Info, Copy, Check } from 'lucide-react';

interface ConfirmDialogProps {
  message: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, detail, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onCancel}>
      <div className="w-[380px] border border-panel-border shadow-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-panel-border"
          style={{ background: danger ? '#c0392b' : '#2c3e50' }}>
          <AlertTriangle size={13} className="text-white" />
          <span className="text-white text-[11px] font-bold uppercase tracking-wider">Confirm Action</span>
        </div>
        <div className="bg-white p-4">
          <p className="text-xs font-medium text-foreground mb-1">{message}</p>
          {detail && <p className="text-[11px] text-muted">{detail}</p>}
          <div className="flex gap-2 mt-4">
            <button onClick={onConfirm} autoFocus
              className="px-4 py-1.5 text-xs font-bold uppercase text-white border disabled:opacity-50"
              style={{ background: danger ? '#e74c3c' : '#336699', borderColor: danger ? '#c0392b' : '#2a5580', borderRadius: 2 }}>
              {confirmLabel}
            </button>
            <button onClick={onCancel}
              className="px-4 py-1.5 text-xs font-bold uppercase border border-panel-border text-foreground"
              style={{ borderRadius: 2 }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface InfoDialogProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}

export function InfoDialog({ title, children, onClose }: InfoDialogProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}>
      <div className="w-[420px] border border-panel-border shadow-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
          <Info size={13} className="text-[#8ab4c8]" />
          <span className="text-white text-[11px] font-bold uppercase tracking-wider">{title}</span>
        </div>
        <div className="bg-white p-4">
          {children}
          <button onClick={onClose} autoFocus
            className="mt-4 px-4 py-1.5 text-xs font-bold uppercase text-white border border-[#2a5580]"
            style={{ background: '#336699', borderRadius: 2 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface ApiKeyDialogProps {
  email: string;
  apiKey: string;
  onClose: () => void;
}

export function ApiKeyDialog({ email, apiKey, onClose }: ApiKeyDialogProps) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <InfoDialog title="New API Key Generated" onClose={onClose}>
      <p className="text-[11px] text-muted mb-3">
        New API key for <span className="font-bold text-foreground">{email}</span>. Copy it now — it won't be shown again.
      </p>
      <div className="flex items-center gap-2 p-2 bg-row-alt border border-panel-border">
        <code className="flex-1 text-[11px] font-mono text-foreground break-all">{apiKey}</code>
        <button onClick={copy}
          className="shrink-0 p-1.5 border border-panel-border bg-white hover:bg-row-alt"
          title="Copy" style={{ borderRadius: 2 }}>
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} className="text-muted" />}
        </button>
      </div>
    </InfoDialog>
  );
}

interface ErrorDialogProps {
  message: string;
  onClose: () => void;
}

export function ErrorDialog({ message, onClose }: ErrorDialogProps) {
  return (
    <InfoDialog title="Error" onClose={onClose}>
      <p className="text-xs text-danger">{message}</p>
    </InfoDialog>
  );
}
