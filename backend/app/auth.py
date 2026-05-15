from __future__ import annotations
import hashlib
import bcrypt
from fastapi import Depends, HTTPException, Request, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session
from . import models, database
from .permissions import SELF_PERMISSIONS

SESSION_COOKIE = "session_key"


def _hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


# auto_error=False so missing header falls through to cookie check
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def _user_permissions(user: models.AdminUser) -> set[str]:
    perms = set()
    if user.role:
        perms = {rp.permission for rp in user.role.permissions}
    return perms | SELF_PERMISSIONS


def _resolve_user_by_key(raw_key: str, db: Session) -> models.AdminUser | None:
    if not raw_key:
        return None
    key_hash = _hash_api_key(raw_key)
    return (
        db.query(models.AdminUser)
        .filter(models.AdminUser.api_key_hash == key_hash, models.AdminUser.is_active == True)
        .first()
    )


def get_current_user(
    request: Request,
    header_key: str | None = Security(api_key_header),
    db: Session = Depends(get_db),
) -> models.AdminUser:
    # X-API-Key header takes priority (external API clients); fall back to httpOnly cookie
    raw_key = header_key or request.cookies.get(SESSION_COOKIE, "")
    user = _resolve_user_by_key(raw_key, db)
    if user:
        return user
    raise HTTPException(status_code=401, detail="Invalid or inactive API key")


def require(permission: str):
    def dependency(user: models.AdminUser = Depends(get_current_user)) -> models.AdminUser:
        if permission not in _user_permissions(user):
            raise HTTPException(status_code=403, detail=f"Forbidden — requires: {permission}")
        return user
    return dependency


def get_current_user_optional(
    request: Request,
    header_key: str | None = Security(api_key_header),
    db: Session = Depends(get_db),
) -> models.AdminUser | None:
    raw_key = header_key or request.cookies.get(SESSION_COOKIE, "")
    return _resolve_user_by_key(raw_key, db)
