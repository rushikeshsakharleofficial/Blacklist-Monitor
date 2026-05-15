from __future__ import annotations
import json
import secrets
import datetime
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from .. import models
from ..auth import get_db, get_current_user, require, SESSION_COOKIE, _hash_api_key
from ..limiter import limiter
from ..redis_client import rclient
from ..alerts import _cfg, _send_email
from .audit import write_audit
from .. import mfa as _mfa

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/mfa", tags=["mfa"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class VerifySetupRequest(BaseModel):
    mfa_token: str
    code: str
    enable_email_otp: bool = False

class VerifyRequest(BaseModel):
    mfa_token: str
    code: str

class SendEmailOTPRequest(BaseModel):
    mfa_token: str

class UseRecoveryRequest(BaseModel):
    mfa_token: str
    code: str

class RegenerateRecoveryRequest(BaseModel):
    code: str  # current TOTP to authorize regen


# ── Helpers ───────────────────────────────────────────────────────────────────

def _resolve_mfa_token(token: str, db: Session) -> models.AdminUser:
    """Look up mfa_token in Redis → return AdminUser. Raise 401 if invalid/expired."""
    key = _mfa.mfa_token_key(token)
    raw = rclient.get(key)
    if not raw:
        raise HTTPException(status_code=401, detail="MFA session expired or invalid")
    user_id = int(raw)
    user = db.query(models.AdminUser).filter(
        models.AdminUser.id == user_id,
        models.AdminUser.is_active == True,
    ).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def _consume_mfa_token(token: str):
    rclient.delete(_mfa.mfa_token_key(token))


def _check_anti_replay(user_id: int, code: str):
    key = _mfa.anti_replay_key(user_id, code)
    if rclient.get(key):
        raise HTTPException(status_code=429, detail="Code already used — wait for next TOTP window")
    rclient.setex(key, _mfa.ANTI_REPLAY_TTL, "1")


def _set_session_cookie(response: Response, user: models.AdminUser):
    response.set_cookie(
        key=SESSION_COOKIE,
        value=user.api_key,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )


def _build_user_payload(user: models.AdminUser, db: Session) -> dict:
    from ..auth import _user_permissions
    perms = _user_permissions(user)
    return {
        "email": user.email,
        "name": user.name or "",
        "role": user.role.name if user.role else None,
        "permissions": sorted(perms),
    }


# ── Setup: generate TOTP secret + QR ─────────────────────────────────────────

@router.post("/setup")
@limiter.limit("10/minute")
def mfa_setup(request: Request, db: Session = Depends(get_db)):
    """Generate TOTP secret for enrollment. Requires valid mfa_token."""
    token = request.headers.get("X-MFA-Token")
    if not token:
        raise HTTPException(status_code=400, detail="mfa_token required (X-MFA-Token header)")
    user = _resolve_mfa_token(token, db)

    secret = _mfa.generate_totp_secret()
    uri = _mfa.get_totp_uri(secret, user.email)
    qr_b64 = _mfa.generate_qr_base64(uri)

    # Store encrypted secret temporarily until verify-setup confirms it
    pending_key = _mfa.mfa_pending_key(user.id)
    rclient.setex(pending_key, 600, _mfa.encrypt_secret(secret))

    return {
        "qr_image": f"data:image/png;base64,{qr_b64}",
        "manual_key": secret,
        "email": user.email,
    }


# ── Setup: verify first TOTP code → enable 2FA ───────────────────────────────

@router.post("/verify-setup")
@limiter.limit("5/minute")
def mfa_verify_setup(request: Request, body: VerifySetupRequest, response: Response, db: Session = Depends(get_db)):
    user = _resolve_mfa_token(body.mfa_token, db)

    pending_key = _mfa.mfa_pending_key(user.id)
    enc = rclient.get(pending_key)
    if not enc:
        raise HTTPException(status_code=400, detail="Setup session expired — restart enrollment")

    secret = _mfa.decrypt_secret(enc if isinstance(enc, str) else enc.decode())
    if not _mfa.verify_totp(secret, body.code):
        raise HTTPException(status_code=400, detail="Invalid code — try again")

    _check_anti_replay(user.id, body.code)

    # Persist
    raw_codes = _mfa.generate_recovery_codes(8)
    user.totp_secret_enc = _mfa.encrypt_secret(secret)
    user.totp_enabled = True
    user.email_otp_enabled = body.enable_email_otp
    user.mfa_enrolled_at = datetime.datetime.now(datetime.timezone.utc)
    user.mfa_recovery_codes = _mfa.hash_recovery_codes(raw_codes)
    db.commit()

    rclient.delete(pending_key)
    _consume_mfa_token(body.mfa_token)
    _set_session_cookie(response, user)

    write_audit(db, user, "mfa.enrolled", resource=user.email, request=request)
    logger.info("mfa_enrolled", extra={"user": user.email})

    return {
        **_build_user_payload(user, db),
        "recovery_codes": raw_codes,
    }


# ── Verify TOTP during login ──────────────────────────────────────────────────

@router.post("/verify")
@limiter.limit("5/15minute")
def mfa_verify(request: Request, body: VerifyRequest, response: Response, db: Session = Depends(get_db)):
    user = _resolve_mfa_token(body.mfa_token, db)

    if not user.totp_enabled or not user.totp_secret_enc:
        raise HTTPException(status_code=400, detail="2FA not enrolled")

    # Anti-replay before verify — prevents leaking that code was correct
    _check_anti_replay(user.id, body.code)

    secret = _mfa.decrypt_secret(user.totp_secret_enc)
    if not _mfa.verify_totp(secret, body.code):
        write_audit(db, user, "mfa.verify_failed", resource=user.email, request=request)
        raise HTTPException(status_code=401, detail="Invalid code")

    # Consume token before setting cookie — prevents replay if cookie-set fails
    _consume_mfa_token(body.mfa_token)
    _set_session_cookie(response, user)

    write_audit(db, user, "mfa.verify_ok", resource=user.email, request=request)
    return _build_user_payload(user, db)


# ── Send email OTP ────────────────────────────────────────────────────────────

@router.post("/send-email-otp")
@limiter.limit("3/hour")
def send_email_otp(request: Request, body: SendEmailOTPRequest, db: Session = Depends(get_db)):
    user = _resolve_mfa_token(body.mfa_token, db)

    # Atomic rate check: INCR then check — prevents race condition
    rate_key = _mfa.email_otp_rate_key(user.id)
    pipe = rclient.pipeline()
    pipe.incr(rate_key)
    pipe.expire(rate_key, 3600)
    results = pipe.execute()
    new_count = results[0]
    if new_count > 3:
        raise HTTPException(status_code=429, detail="Too many email OTP requests — try again in an hour")

    otp = _mfa.generate_email_otp()
    otp_hash = _mfa.hash_email_otp(otp)
    rclient.setex(_mfa.email_otp_key(user.id), _mfa.EMAIL_OTP_TTL, otp_hash)

    cfg = _cfg(db)
    if cfg.get("smtp_server"):
        html = f"""
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto">
          <h2 style="color:#1e1b4b">Your Guardly login code</h2>
          <p style="color:#6b7280">Enter this code to complete sign-in:</p>
          <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#6366f1;
               background:#f5f3ff;border-radius:12px;padding:16px 24px;display:inline-block;
               margin:16px 0">{otp}</div>
          <p style="color:#9ca3af;font-size:12px">Expires in 10 minutes. Never share this code.</p>
        </div>"""
        _send_email(
            subject="Your Guardly 2FA code",
            html_body=html,
            c={"smtp_server": cfg["smtp_server"], "smtp_port": cfg["smtp_port"],
               "smtp_user": cfg["smtp_user"], "smtp_password": cfg["smtp_password"],
               "smtp_to": user.email},
        )

    logger.info("email_otp_sent", extra={"user": user.email})
    return {"sent": True, "email": user.email}


# ── Verify email OTP during login ─────────────────────────────────────────────

@router.post("/verify-email-otp")
@limiter.limit("5/15minute")
def verify_email_otp(request: Request, body: VerifyRequest, response: Response, db: Session = Depends(get_db)):
    user = _resolve_mfa_token(body.mfa_token, db)

    stored = rclient.get(_mfa.email_otp_key(user.id))
    if not stored:
        raise HTTPException(status_code=400, detail="No email OTP found or it has expired")

    stored_hash = stored if isinstance(stored, str) else stored.decode()
    if not _mfa.verify_email_otp(body.code, stored_hash):
        write_audit(db, user, "mfa.email_otp_failed", resource=user.email, request=request)
        raise HTTPException(status_code=401, detail="Invalid or expired code")

    rclient.delete(_mfa.email_otp_key(user.id))
    _consume_mfa_token(body.mfa_token)
    _set_session_cookie(response, user)

    write_audit(db, user, "mfa.email_otp_ok", resource=user.email, request=request)
    return _build_user_payload(user, db)


# ── Use recovery code ─────────────────────────────────────────────────────────

@router.post("/use-recovery")
@limiter.limit("5/hour")
def use_recovery_code(request: Request, body: UseRecoveryRequest, response: Response, db: Session = Depends(get_db)):
    user = _resolve_mfa_token(body.mfa_token, db)

    if not user.mfa_recovery_codes:
        raise HTTPException(status_code=400, detail="No recovery codes on file")

    # Atomic optimistic-lock update to prevent concurrent consumption of same code
    from sqlalchemy import text as _text
    old_codes = user.mfa_recovery_codes
    matched, updated_json = _mfa.verify_and_consume_recovery_code(old_codes, body.code)
    if not matched:
        write_audit(db, user, "mfa.recovery_failed", resource=user.email, request=request)
        raise HTTPException(status_code=401, detail="Invalid recovery code")

    # Atomic update: only succeeds if codes haven't changed since we read them
    result = db.execute(
        _text("UPDATE admin_users SET mfa_recovery_codes = :new WHERE id = :uid AND mfa_recovery_codes = :old"),
        {"new": updated_json, "uid": user.id, "old": old_codes},
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=409, detail="Recovery code was just used — try again")

    _consume_mfa_token(body.mfa_token)
    _set_session_cookie(response, user)

    remaining = _mfa.count_remaining_recovery_codes(updated_json)
    write_audit(db, user, "mfa.recovery_used", resource=user.email,
                detail={"remaining": remaining}, request=request)
    logger.warning("mfa_recovery_used", extra={"user": user.email, "remaining": remaining})

    return {**_build_user_payload(user, db), "recovery_codes_remaining": remaining}


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
def mfa_status(user: models.AdminUser = Depends(get_current_user)):
    return {
        "enrolled": user.totp_enabled,
        "email_otp_enabled": user.email_otp_enabled,
        "enrolled_at": user.mfa_enrolled_at.isoformat() if user.mfa_enrolled_at else None,
        "recovery_codes_remaining": _mfa.count_remaining_recovery_codes(user.mfa_recovery_codes),
    }


# ── Regenerate recovery codes (requires current TOTP) ─────────────────────────

@router.post("/regenerate-recovery")
@limiter.limit("3/hour")
def regenerate_recovery(request: Request, body: RegenerateRecoveryRequest,
                        user: models.AdminUser = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    if not user.totp_enabled or not user.totp_secret_enc:
        raise HTTPException(status_code=400, detail="2FA not enrolled")

    # Anti-replay before verify — prevents code-validity leak
    _check_anti_replay(user.id, body.code)

    secret = _mfa.decrypt_secret(user.totp_secret_enc)
    if not _mfa.verify_totp(secret, body.code):
        raise HTTPException(status_code=401, detail="Invalid TOTP code")

    raw_codes = _mfa.generate_recovery_codes(8)
    user.mfa_recovery_codes = _mfa.hash_recovery_codes(raw_codes)
    db.commit()

    write_audit(db, user, "mfa.recovery_regenerated", resource=user.email, request=request)
    return {"recovery_codes": raw_codes}


# ── Admin: disable 2FA for user ───────────────────────────────────────────────

@router.delete("/{user_id}")
def admin_disable_mfa(user_id: int, request: Request,
                      caller: models.AdminUser = Depends(require("users:write")),
                      db: Session = Depends(get_db)):
    target = db.query(models.AdminUser).filter(models.AdminUser.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    target.totp_secret_enc = None
    target.totp_enabled = False
    target.email_otp_enabled = False
    target.mfa_enrolled_at = None
    target.mfa_recovery_codes = None
    db.commit()

    write_audit(db, caller, "mfa.admin_disabled", resource=target.email, request=request)
    logger.warning("mfa_admin_disabled", extra={"by": caller.email, "target": target.email})
    return {"ok": True, "message": f"2FA disabled for {target.email}"}
