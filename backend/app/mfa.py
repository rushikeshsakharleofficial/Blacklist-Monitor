from __future__ import annotations
import os
import io
import json
import secrets
import hashlib
import logging
import datetime
import base64
from typing import Optional

import pyotp
import qrcode
import qrcode.image.svg
import bcrypt
from cryptography.fernet import Fernet
from PIL import Image

logger = logging.getLogger(__name__)

_RAW_KEY = os.getenv("MFA_ENCRYPTION_KEY", "")
_fernet: Optional[Fernet] = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        if not _RAW_KEY:
            raise RuntimeError("MFA_ENCRYPTION_KEY env var not set")
        try:
            key_bytes = _RAW_KEY.encode() if isinstance(_RAW_KEY, str) else _RAW_KEY
            _fernet = Fernet(key_bytes)
            # Validate key is functional
            _fernet.encrypt(b"test")
        except Exception as e:
            raise RuntimeError(f"MFA_ENCRYPTION_KEY is invalid Fernet key: {e}")
    return _fernet


# ── TOTP secret management ────────────────────────────────────────────────────

def generate_totp_secret() -> str:
    return pyotp.random_base32()


def encrypt_secret(secret: str) -> str:
    return _get_fernet().encrypt(secret.encode()).decode()


def decrypt_secret(enc: str) -> str:
    return _get_fernet().decrypt(enc.encode()).decode()


def verify_totp(secret: str, code: str, valid_window: int = 1) -> bool:
    totp = pyotp.TOTP(secret)
    return totp.verify(code.strip(), valid_window=valid_window)


def get_totp_uri(secret: str, email: str, issuer: str = "Guardly") -> str:
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name=issuer)


# ── QR code generation (Minimal Glass style) ─────────────────────────────────

def generate_qr_base64(uri: str) -> str:
    """Generate QR as base64 PNG. Minimal Glass style: white modules on white bg,
    accent-colored corner finders applied via SVG overlay approach."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(uri)
    qr.make(fit=True)

    # Generate plain white-on-white PNG first
    img = qr.make_image(fill_color="#1e1b4b", back_color="white")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()


# ── Recovery codes ────────────────────────────────────────────────────────────

def generate_recovery_codes(count: int = 8) -> list[str]:
    """Generate readable recovery codes: XXXX-XXXX-XXXX format."""
    codes = []
    for _ in range(count):
        parts = [secrets.token_hex(2).upper() for _ in range(3)]
        codes.append("-".join(parts))
    return codes


def hash_recovery_codes(codes: list[str]) -> str:
    """Hash each code with bcrypt, return JSON string for DB storage."""
    hashed = []
    for code in codes:
        h = bcrypt.hashpw(_normalize_recovery_code(code).encode(), bcrypt.gensalt()).decode()
        hashed.append(h)
    return json.dumps(hashed)


def _normalize_recovery_code(code: str) -> str:
    return code.replace("-", "").replace(" ", "").upper()


def verify_and_consume_recovery_code(
    stored_json: str, code: str
) -> tuple[bool, str]:
    """Verify recovery code and mark it used (replaced with empty string).
    Returns (matched, updated_json). Caller must save updated_json to DB."""
    normalized = _normalize_recovery_code(code)
    hashes: list[str] = json.loads(stored_json)
    for i, h in enumerate(hashes):
        if h and bcrypt.checkpw(normalized.encode(), h.encode()):
            hashes[i] = ""  # mark used
            return True, json.dumps(hashes)
    return False, stored_json


def count_remaining_recovery_codes(stored_json: Optional[str]) -> int:
    if not stored_json:
        return 0
    return sum(1 for h in json.loads(stored_json) if h)


# ── Email OTP ─────────────────────────────────────────────────────────────────

def generate_email_otp() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def hash_email_otp(otp: str) -> str:
    return hashlib.sha256(otp.encode()).hexdigest()


def verify_email_otp(otp: str, stored_hash: str) -> bool:
    import hmac as _hmac
    return _hmac.compare_digest(hashlib.sha256(otp.strip().encode()).hexdigest(), stored_hash)


# ── MFA Redis keys ────────────────────────────────────────────────────────────

MFA_TOKEN_TTL = 300          # 5 min — intermediate auth token
EMAIL_OTP_TTL = 600          # 10 min
ANTI_REPLAY_TTL = 90         # 90s covers 30s TOTP window ±1

def mfa_token_key(token: str) -> str:
    return f"mfa_token:{token}"

def mfa_pending_key(user_id: int) -> str:
    return f"mfa_pending:{user_id}"

def email_otp_key(user_id: int) -> str:
    return f"email_otp:{user_id}"

def anti_replay_key(user_id: int, code: str) -> str:
    return f"mfa_used:{user_id}:{code}"

def email_otp_rate_key(user_id: int) -> str:
    return f"email_otp_rate:{user_id}"
