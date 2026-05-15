import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, Copy, Check, Download, Mail, Key } from 'lucide-react';
import OTPInput from '../components/OTPInput';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

interface Props {
  mfaToken: string;
  onComplete: (userInfo: Record<string, unknown>) => void;
}

type Step = 'intro' | 'scan' | 'verify' | 'codes';

export default function MFASetupPage({ mfaToken, onComplete }: Props) {
  const [step, setStep] = useState<Step>('intro');
  const [qrImage, setQrImage] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [email, setEmail] = useState('');
  const [useEmailOTP, setUseEmailOTP] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  const STEPS: Step[] = ['intro', 'scan', 'verify', 'codes'];
  const stepIdx = STEPS.indexOf(step);

  const fetchQR = async () => {
    try {
      setLoading(true);
      const res = await axios.post(`${API}/auth/mfa/setup`, null, {
        headers: { 'X-MFA-Token': mfaToken },
      });
      setQrImage(res.data.qr_image);
      setManualKey(res.data.manual_key);
      setEmail(res.data.email);
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to load QR code');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (step === 'scan') fetchQR();
  }, [step]);

  const handleVerify = async () => {
    if (code.length < 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${API}/auth/mfa/verify-setup`, {
        mfa_token: mfaToken,
        code,
        enable_email_otp: useEmailOTP,
      });
      setRecoveryCodes(res.data.recovery_codes || []);
      setStep('codes');
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Invalid code — try again');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const copyAllCodes = () => {
    navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2000);
  };

  const downloadCodes = () => {
    const blob = new Blob([recoveryCodes.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'guardly-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const progressSteps = [
    { key: 'intro', label: 'Intro' },
    { key: 'scan', label: 'Scan' },
    { key: 'verify', label: 'Verify' },
    { key: 'codes', label: 'Backup' },
  ];

  return (
    <div className="min-h-screen bg-app flex items-center justify-center px-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent)' }}>
            <Shield size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold text-text-base">Guardly</span>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-1.5 mb-6">
          {progressSteps.map((s, i) => {
            const done = i < stepIdx;
            const active = i === stepIdx;
            return (
              <React.Fragment key={s.key}>
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    done ? 'bg-success text-white' : active ? 'bg-accent text-white' : 'border border-border-base text-text-muted'
                  }`}>
                    {done ? <Check size={12} /> : i + 1}
                  </div>
                  <span className={`text-[9px] font-medium uppercase tracking-wide ${active ? 'text-accent' : done ? 'text-success' : 'text-text-muted'}`}>
                    {s.label}
                  </span>
                </div>
                {i < progressSteps.length - 1 && (
                  <div className={`flex-1 h-0.5 mb-4 transition-all ${done ? 'bg-success' : 'bg-border-base'}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        <div className="bg-surface border border-border-base rounded-xl shadow-sm overflow-hidden">

          {/* ── Step 1: Intro ── */}
          {step === 'intro' && (
            <div className="p-6">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }}>
                <Shield size={22} className="text-accent" />
              </div>
              <h2 className="text-base font-semibold text-text-base mb-2">Secure your account with 2FA</h2>
              <p className="text-sm text-text-sec mb-5 leading-relaxed">
                Two-factor authentication adds an extra layer of protection. You'll need an authenticator app like <strong className="text-text-base">Google Authenticator</strong>, <strong className="text-text-base">Authy</strong>, or <strong className="text-text-base">1Password</strong>.
              </p>
              <div className="space-y-2.5 mb-6">
                {['Download an authenticator app on your phone', 'Scan the QR code we show you', 'Enter the 6-digit code to confirm', 'Save your recovery codes somewhere safe'].map((t, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-accent/15 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-accent">{i + 1}</span>
                    </div>
                    <span className="text-sm text-text-sec">{t}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setStep('scan')} className="w-full bg-accent hover:bg-accent-hover text-white rounded-lg py-2.5 font-medium text-sm transition-colors">
                Get Started →
              </button>
            </div>
          )}

          {/* ── Step 2: Scan ── */}
          {step === 'scan' && (
            <div className="p-6">
              <h2 className="text-base font-semibold text-text-base mb-1">Scan QR code</h2>
              <p className="text-sm text-text-sec mb-5">Open your authenticator app and scan this code.</p>

              {loading ? (
                <div className="flex items-center justify-center h-48 text-text-muted text-sm">Loading QR…</div>
              ) : (
                <>
                  {/* Minimal Glass QR */}
                  <div className="flex justify-center mb-4">
                    <div style={{
                      background: 'rgba(255,255,255,0.04)',
                      backdropFilter: 'blur(12px)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 20,
                      padding: 16,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                    }}>
                      <div style={{ background: 'white', borderRadius: 12, padding: 12, display: 'inline-block' }}>
                        {qrImage && <img src={qrImage} alt="2FA QR Code" style={{ width: 160, height: 160, display: 'block' }} />}
                      </div>
                    </div>
                  </div>

                  {/* Manual key toggle */}
                  <button onClick={() => setShowManual(m => !m)} className="w-full text-xs text-accent hover:text-accent-hover flex items-center justify-center gap-1.5 mb-3 transition-colors">
                    <Key size={12} />
                    {showManual ? 'Hide' : 'Can\'t scan? Enter key manually'}
                  </button>
                  {showManual && (
                    <div className="bg-subtle border border-border-base rounded-lg p-3 mb-3 font-mono text-xs text-text-base break-all text-center select-all">
                      {manualKey}
                    </div>
                  )}

                  {/* Email OTP toggle */}
                  <label className="flex items-center gap-2 cursor-pointer mb-5 p-3 rounded-lg border border-border-base hover:bg-subtle transition-colors">
                    <input type="checkbox" checked={useEmailOTP} onChange={e => setUseEmailOTP(e.target.checked)} className="w-3.5 h-3.5 rounded accent-accent" />
                    <Mail size={13} className="text-text-sec" />
                    <span className="text-sm text-text-sec">Also allow email OTP as fallback</span>
                  </label>

                  <button onClick={() => setStep('verify')} className="w-full bg-accent hover:bg-accent-hover text-white rounded-lg py-2.5 font-medium text-sm transition-colors">
                    I've scanned it →
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Step 3: Verify ── */}
          {step === 'verify' && (
            <div className="p-6">
              <h2 className="text-base font-semibold text-text-base mb-1">Verify your code</h2>
              <p className="text-sm text-text-sec mb-6">Enter the 6-digit code from your authenticator app to confirm setup.</p>

              <OTPInput value={code} onChange={setCode} onComplete={handleVerify} autoFocus disabled={loading} />

              {error && <p className="text-sm text-danger text-center mt-3">{error}</p>}

              <button
                onClick={handleVerify}
                disabled={code.length < 6 || loading}
                className="w-full bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg py-2.5 font-medium text-sm transition-colors mt-5"
              >
                {loading ? 'Verifying…' : 'Verify & Enable 2FA'}
              </button>
              <button onClick={() => { setStep('scan'); setCode(''); setError(null); }} className="w-full text-xs text-text-muted hover:text-text-sec mt-2 transition-colors">
                ← Back to QR
              </button>
            </div>
          )}

          {/* ── Step 4: Recovery codes ── */}
          {step === 'codes' && (
            <div className="p-6">
              <h2 className="text-base font-semibold text-text-base mb-1">Save your recovery codes</h2>
              <p className="text-xs text-danger font-medium mb-4">⚠ Store these somewhere safe. Each code can only be used once. They're your only way in if you lose your device.</p>

              <div className="bg-subtle border border-border-base rounded-lg p-4 mb-3 grid grid-cols-2 gap-1.5">
                {recoveryCodes.map((c, i) => (
                  <span key={i} className="font-mono text-xs text-text-base text-center py-1 px-2 bg-surface rounded border border-border-base">{c}</span>
                ))}
              </div>

              <div className="flex gap-2 mb-5">
                <button onClick={copyAllCodes} className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-border-base rounded-lg text-xs font-medium text-text-base hover:bg-subtle transition-colors">
                  {copiedCodes ? <><Check size={12} className="text-success" /> Copied</> : <><Copy size={12} /> Copy all</>}
                </button>
                <button onClick={downloadCodes} className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-border-base rounded-lg text-xs font-medium text-text-base hover:bg-subtle transition-colors">
                  <Download size={12} /> Download
                </button>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer mb-5 p-3 rounded-lg border border-border-base hover:bg-subtle transition-colors">
                <input type="checkbox" checked={savedConfirmed} onChange={e => setSavedConfirmed(e.target.checked)} className="w-3.5 h-3.5 mt-0.5 rounded accent-accent" />
                <span className="text-sm text-text-sec">I've saved my recovery codes in a secure place</span>
              </label>

              <button
                onClick={() => onComplete({})}
                disabled={!savedConfirmed}
                className="w-full bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg py-2.5 font-medium text-sm transition-colors"
              >
                <Check size={14} className="inline mr-1.5" />
                Finish Setup
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-text-muted mt-4">Guardly — DNSBL Monitoring Platform</p>
      </div>
    </div>
  );
}
