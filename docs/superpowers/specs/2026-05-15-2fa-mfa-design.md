# 2FA / MFA Design Spec
Date: 2026-05-15

## Summary
TOTP-based two-factor authentication, globally mandatory for all users, with optional email OTP fallback and recovery codes.

## Decisions
- **Enforcement**: Global mandatory — all users must enroll on first post-feature login
- **Methods**: TOTP primary (RFC 6238); email OTP optional fallback
- **Recovery**: 8 single-use bcrypt-hashed codes + admin can reset 2FA for any user
- **QR style**: Minimal Glass — white QR card inside frosted-glass dark container, accent corner finders
- **Enrollment UI**: 4-step wizard — Intro → Scan QR → Verify → Save Codes
- **Code input**: 6 individual digit boxes, auto-advance, auto-submit on 6th digit
- **Intermediate auth**: Temporary mfa_token in Redis (Approach A)

## Data Model

New columns on `admin_users` (migration `014_mfa.py`):
```sql
totp_secret_enc      TEXT        -- Fernet-encrypted TOTP secret (null = not enrolled)
totp_enabled         BOOLEAN     DEFAULT false
email_otp_enabled    BOOLEAN     DEFAULT false
mfa_enrolled_at      TIMESTAMP   nullable
mfa_recovery_codes   TEXT        -- JSON array of bcrypt-hashed codes
```

New env var: `MFA_ENCRYPTION_KEY` — Fernet symmetric key for TOTP secret encryption at rest.

## New Files
```
backend/app/mfa.py                        -- TOTP gen/verify, QR PNG gen, email OTP, recovery codes
backend/app/routers/mfa.py                -- all /auth/mfa/* endpoints
backend/alembic/versions/014_mfa.py       -- DB migration
frontend/src/pages/MFASetupPage.tsx       -- 4-step enrollment wizard
frontend/src/pages/MFAVerifyPage.tsx      -- login step 2 (verify TOTP/email/recovery)
frontend/src/components/OTPInput.tsx      -- 6-box digit input component
```

## New Dependencies
```
# requirements.txt
pyotp>=2.9.0
qrcode[pil]>=7.4
cryptography>=42.0
```

## Auth Flow
```
POST /auth/login (password OK, enrolled)
  → Redis: mfa_token → user_id  (5 min TTL, single-use)
  → Response: {mfa_required: true, mfa_token: "..."}
  → Frontend: redirect /mfa/verify

POST /auth/login (password OK, NOT enrolled)
  → Response: {setup_required: true, mfa_token: "..."}
  → Frontend: redirect /mfa/setup

POST /auth/mfa/verify (mfa_token + TOTP code)
  → validate token exists in Redis
  → anti-replay check Redis mfa_used:{uid}:{code} (90s TTL)
  → pyotp.TOTP.verify() ±1 window
  → delete mfa_token from Redis
  → set session_key httpOnly cookie
  → Response: user info

POST /auth/mfa/send-email-otp (mfa_token)
  → generate 6-digit code, bcrypt hash → Redis email_otp:{uid} (10 min TTL)
  → send via SMTP
  → rate: 3/hour per uid

POST /auth/mfa/use-recovery (mfa_token + code)
  → normalize code (strip spaces/dashes)
  → bcrypt verify against stored codes
  → atomic: mark code used
  → set session cookie
```

## API Endpoints
```
POST   /auth/mfa/setup               -- generate secret, return QR base64 + manual key
POST   /auth/mfa/verify-setup        -- verify first code → enable 2FA → return 8 recovery codes
POST   /auth/mfa/verify              -- verify code during login → set session cookie
POST   /auth/mfa/send-email-otp      -- send email OTP (rate: 3/hour)
POST   /auth/mfa/use-recovery        -- redeem recovery code → session cookie
GET    /auth/mfa/status              -- {enrolled, method, recovery_codes_remaining}
POST   /auth/mfa/regenerate-recovery -- generate new 8 codes (invalidates old, requires TOTP verify)
DELETE /auth/mfa/{user_id}           -- admin: disable 2FA for user (requires users:write)
```

## Security Hardening

### Backend
- TOTP secret Fernet-encrypted at rest; never returned to client
- Anti-replay: Redis `mfa_used:{uid}:{code}` 90s TTL covers 30s window ±1
- Rate limits: `/auth/mfa/verify` 5/15min; send-email-otp 3/hour
- Recovery codes: bcrypt-hashed, single-use, atomic mark-used
- mfa_token: Redis 5-min TTL, deleted on first use
- Email OTP: Redis bcrypt hash, 10-min TTL
- Audit log all MFA events (setup, verify ok/fail, recovery use, admin disable)
- Timing-safe comparison via pyotp internals

### Frontend
- OTPInput: digits-only filter, no localStorage persistence
- mfa_token stored only in React state (never localStorage/sessionStorage)
- Auto-submit on 6th digit
- Recovery input: normalize (strip spaces/dashes) before submit
- After 5 consecutive failures: show cooldown UI, disable submit for 30s
- Axios interceptor: 401 on any call clears state → login redirect

## Enrollment Wizard Steps
1. **Intro** — shield icon, explain 2FA, CTA "Get Started"
2. **Scan** — Minimal Glass QR + manual key option + "Use email instead" toggle
3. **Verify** — OTPInput 6-box, must pass before proceeding
4. **Save Codes** — 8 recovery codes, copy-all + download buttons, "I've saved these" checkbox required to finish

## QR Visual Spec (Minimal Glass)
- Outer container: `rgba(255,255,255,0.04)` frosted glass, `border: 1px solid rgba(255,255,255,0.1)`, `border-radius: 20px`
- Inner QR card: white background, `border-radius: 12px`, `padding: 12px`
- QR corner finders: `stroke: #6366f1` (accent), rounded (`rx="6"`)
- QR data modules: `fill: #1e1b4b` (dark indigo on white)
- QR generated server-side via `qrcode[pil]`, returned as base64 PNG data URI
