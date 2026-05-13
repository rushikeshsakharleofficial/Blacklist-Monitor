import os
import bcrypt
from fastapi import Depends, HTTPException, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session
from . import models, database
from .permissions import SELF_PERMISSIONS

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=True)

_ENV_API_KEY = os.getenv("API_KEY", "")


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


def get_current_user(
    key: str = Security(api_key_header),
    db: Session = Depends(get_db),
) -> models.AdminUser:
    user = (
        db.query(models.AdminUser)
        .filter(models.AdminUser.api_key == key, models.AdminUser.is_active == True)
        .first()
    )
    if user:
        return user
    # Env-var fallback — only valid if no users are set up yet (pre-setup)
    if _ENV_API_KEY and key == _ENV_API_KEY:
        count = db.query(models.AdminUser).count()
        if count == 0:
            raise HTTPException(status_code=400, detail="Complete setup at /setup first")
    raise HTTPException(status_code=401, detail="Invalid or inactive API key")


def require(permission: str):
    """Returns a callable dependency that enforces a specific IAM permission.
    Usage: dependencies=[Depends(require("targets:write"))]
    """
    def dependency(user: models.AdminUser = Depends(get_current_user)) -> models.AdminUser:
        if permission not in _user_permissions(user):
            raise HTTPException(status_code=403, detail=f"Forbidden — requires: {permission}")
        return user
    return dependency


def get_current_user_optional(
    key: str = Security(api_key_header),
    db: Session = Depends(get_db),
) -> models.AdminUser | None:
    """Like get_current_user but returns None instead of raising on invalid key."""
    try:
        return get_current_user(key, db)
    except HTTPException:
        return None
