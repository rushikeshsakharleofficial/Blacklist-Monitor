import React, { useEffect } from 'react';
import { AlertTriangle, Info, Copy, Check, X } from 'lucide-react';

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-surface border border-border-base rounded-xl w-full max-w-md mx-4 shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border-base">
          <AlertTriangle size={16} className={danger ? 'text-danger' : 'text-accent'} />
          <span className="font-semibold text-sm text-text-base">Confirm Action</span>
          <button onClick={onCancel} className="ml-auto text-text-sec hover:text-text-base">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">
          <p className="text-sm font-medium text-text-base mb-1">{message}</p>
          {detail && <p className="text-sm text-text-sec">{detail}</p>}
          <div className="flex gap-2 mt-5">
            <button onClick={onConfirm} autoFocus
              className={`px-4 py-2 text-sm font-medium rounded-lg text-white transition-opacity ${danger ? 'bg-danger hover:opacity-90' : 'bg-accent hover:bg-accent-hover'}`}>
              {confirmLabel}
            </button>
            <button onClick={onCancel}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-border-base text-text-base hover:bg-subtle transition-colors">
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border-base rounded-xl w-full max-w-md mx-4 shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border-base">
          <Info size={16} className="text-accent" />
          <span className="font-semibold text-sm text-text-base">{title}</span>
          <button onClick={onClose} className="ml-auto text-text-sec hover:text-text-base">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">
          {children}
          <button onClick={onClose} autoFocus
            className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors">
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
  const [confirmed, setConfirmed] = React.useState(false);
  const copy = () => { navigator.clipboard.writeText(apiKey); setCopied(true); };
  const handleClose = () => { if (confirmed) onClose(); };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && confirmed) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [confirmed, onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={handleClose}>
      <div className="bg-surface border border-border-base rounded-xl w-full max-w-md mx-4 shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border-base">
          <Info size={16} className="text-accent" />
          <span className="font-semibold text-sm text-text-base">New API Key Generated</span>
          {confirmed && (
            <button onClick={onClose} className="ml-auto text-text-sec hover:text-text-base"><X size={16} /></button>
          )}
        </div>
        <div className="p-5">
          <p className="text-sm text-text-sec mb-1">
            New API key for <span className="font-semibold text-text-base">{email}</span>.
          </p>
          <p className="text-xs text-danger font-medium mb-3">
            ⚠ Copy it now — it will never be shown again. Treat it like a password; never share it.
          </p>
          <div className="flex items-center gap-2 p-3 bg-subtle border border-border-base rounded-lg mb-4">
            <code className="flex-1 text-xs font-mono text-text-base break-all">{apiKey}</code>
            <button onClick={copy}
              className="shrink-0 p-1.5 border border-border-base rounded-md bg-surface hover:bg-subtle transition-colors"
              title="Copy to clipboard">
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} className="text-text-sec" />}
            </button>
          </div>
          {!confirmed ? (
            <button onClick={() => setConfirmed(true)} autoFocus
              className="w-full py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors">
              I've copied and saved my API key
            </button>
          ) : (
            <button onClick={onClose}
              className="w-full py-2 rounded-lg text-sm font-medium border border-border-base bg-surface hover:bg-subtle transition-colors text-text-base flex items-center justify-center gap-1.5">
              <Check size={14} className="text-success" /> Done — close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface ErrorDialogProps {
  message: string;
  onClose: () => void;
}

export function ErrorDialog({ message, onClose }: ErrorDialogProps) {
  return (
    <InfoDialog title="Error" onClose={onClose}>
      <p className="text-sm text-danger font-medium">{message}</p>
    </InfoDialog>
  );
}
