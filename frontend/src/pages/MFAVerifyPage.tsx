import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Shield, Mail, KeyRound } from 'lucide-react';
import OTPInput from '../components/OTPInput';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';

const MAX_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 30;

interface Props {
  mfaToken: string;
  emailOtpAvailable: boolean;
  onComplete: (userInfo: Record<string, unknown>) => void;
}

type Mode = 'totp' | 'email' | 'recovery';

export default function MFAVerifyPage({ mfaToken, emailOtpAvailable, onComplete }: Props) {
  const [mode, setMode] = useState<Mode>('totp');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittingRef = useRef(false); // prevent double-submit

  // Cooldown countdown — cleanup on every render to prevent stale timer leaks
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (cooldown > 0) {
      timerRef.current = setInterval(() => {
        setCooldown(c => {
          if (c <= 1) { clearInterval(timerRef.current!); timerRef.current = null; return 0; }
          return c - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [cooldown]);

  const handleTooManyAttempts = () => {
    setCooldown(COOLDOWN_SECONDS);
    setAttempts(0);
    setCode('');
    setError(`Too many attempts. Wait ${COOLDOWN_SECONDS}s before trying again.`);
  };

  const handleVerify = async (val?: string) => {
    const c = val || code;
    if (c.length < 6 || cooldown > 0 || loading || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    const newAttempts = attempts + 1;
    setAttempts(newAttempts);
    if (newAttempts > MAX_ATTEMPTS) { handleTooManyAttempts(); setLoading(false); submittingRef.current = false; return; }
    try {
      const res = await axios.post(`${API}/auth/mfa/verify`, { mfa_token: mfaToken, code: c });
      onComplete(res.data);
    } catch (e: any) {
      if (newAttempts >= MAX_ATTEMPTS) { handleTooManyAttempts(); }
      else { setError(e.response?.data?.detail || 'Invalid code'); setCode(''); }
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const handleVerifyEmail = async (val?: string) => {
    const c = val || code;
    // Email OTP: no auto-submit — user must click button explicitly (val is undefined for button click)
    if (val !== undefined) return;
    if (c.length < 6 || cooldown > 0 || loading || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    const newAttempts = attempts + 1;
    setAttempts(newAttempts);
    if (newAttempts > MAX_ATTEMPTS) { handleTooManyAttempts(); setLoading(false); return; }
    try {
      const res = await axios.post(`${API}/auth/mfa/verify-email-otp`, { mfa_token: mfaToken, code: c });
      onComplete(res.data);
    } catch (e: any) {
      if (newAttempts >= MAX_ATTEMPTS) { handleTooManyAttempts(); }
      else { setError(e.response?.data?.detail || 'Invalid code'); setCode(''); }
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const handleSendEmail = async () => {
    setLoading(true);
    setError(null);
    try {
      await axios.post(`${API}/auth/mfa/send-email-otp`, { mfa_token: mfaToken });
      setEmailSent(true);
      setMode('email');
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to send email');
    } finally {
      setLoading(false);
    }
  };

  const handleRecovery = async () => {
    if (!recoveryCode.trim() || cooldown > 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${API}/auth/mfa/use-recovery`, {
        mfa_token: mfaToken,
        code: recoveryCode.replace(/\s/g, '').toUpperCase(),
      });
      onComplete(res.data);
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Invalid recovery code');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setCode('');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-app flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent)' }}>
            <Shield size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold text-text-base">Guardly</span>
        </div>

        <div className="bg-surface border border-border-base rounded-xl p-6 shadow-sm">

          {mode === 'totp' && (
            <>
              <h2 className="text-sm font-semibold text-text-base mb-1">Two-factor authentication</h2>
              <p className="text-xs text-text-sec mb-6">Enter the 6-digit code from your authenticator app.</p>
              <OTPInput value={code} onChange={setCode} onComplete={handleVerify} autoFocus disabled={loading || cooldown > 0} />
              {error && <p className="text-xs text-danger text-center mt-3">{error}</p>}
              {cooldown > 0 && <p className="text-xs text-text-muted text-center mt-2">Try again in {cooldown}s</p>}
              <button
                onClick={() => handleVerify()}
                disabled={code.length < 6 || loading || cooldown > 0}
                className="w-full bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg py-2 font-medium text-sm transition-colors mt-5"
              >
                {loading ? 'Verifying…' : 'Verify'}
              </button>
            </>
          )}

          {mode === 'email' && (
            <>
              <h2 className="text-sm font-semibold text-text-base mb-1">Email verification</h2>
              <p className="text-xs text-text-sec mb-6">
                {emailSent ? 'Check your email for a 6-digit code.' : 'A code will be sent to your email address.'}
              </p>
              <OTPInput value={code} onChange={setCode} onComplete={handleVerifyEmail} autoFocus disabled={loading || cooldown > 0} />
              {error && <p className="text-xs text-danger text-center mt-3">{error}</p>}
              {cooldown > 0 && <p className="text-xs text-text-muted text-center mt-2">Try again in {cooldown}s</p>}
              <button
                onClick={() => handleVerifyEmail()}
                disabled={code.length < 6 || loading || cooldown > 0}
                className="w-full bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg py-2 font-medium text-sm transition-colors mt-5"
              >
                {loading ? 'Verifying…' : 'Verify'}
              </button>
              {!emailSent && (
                <button onClick={handleSendEmail} disabled={loading} className="w-full text-xs text-accent hover:text-accent-hover mt-2 transition-colors flex items-center justify-center gap-1">
                  <Mail size={11} /> Send code to my email
                </button>
              )}
            </>
          )}

          {mode === 'recovery' && (
            <>
              <h2 className="text-sm font-semibold text-text-base mb-1">Recovery code</h2>
              <p className="text-xs text-text-sec mb-4">Enter one of your 8-character recovery codes.</p>
              <input
                type="text"
                value={recoveryCode}
                onChange={e => setRecoveryCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX"
                className="w-full border border-border-base rounded-lg px-3 py-2.5 text-sm font-mono bg-surface text-text-base focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
                autoFocus
              />
              {error && <p className="text-xs text-danger mt-2">{error}</p>}
              <button
                onClick={handleRecovery}
                disabled={!recoveryCode.trim() || loading || cooldown > 0}
                className="w-full bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg py-2 font-medium text-sm transition-colors mt-4"
              >
                {loading ? 'Verifying…' : 'Use Recovery Code'}
              </button>
            </>
          )}

          {/* Mode switcher */}
          <div className="border-t border-border-base mt-5 pt-4 space-y-1.5">
            {mode !== 'totp' && (
              <button onClick={() => switchMode('totp')} className="w-full text-xs text-text-muted hover:text-text-sec flex items-center gap-1.5 transition-colors">
                <KeyRound size={11} /> Use authenticator app instead
              </button>
            )}
            {mode !== 'email' && emailOtpAvailable && (
              <button onClick={handleSendEmail} disabled={loading} className="w-full text-xs text-text-muted hover:text-text-sec flex items-center gap-1.5 transition-colors">
                <Mail size={11} /> Send code to my email
              </button>
            )}
            {mode !== 'recovery' && (
              <button onClick={() => switchMode('recovery')} className="w-full text-xs text-text-muted hover:text-text-sec flex items-center gap-1.5 transition-colors">
                <KeyRound size={11} /> Use a recovery code
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-text-muted mt-4">Guardly — DNSBL Monitoring Platform</p>
      </div>
    </div>
  );
}
