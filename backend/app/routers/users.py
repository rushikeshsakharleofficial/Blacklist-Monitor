import secrets
import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from .. import models
from ..auth import get_db, require, get_current_user, hash_password, verify_password, _user_permissions
from ..permissions import SELF_PERMISSIONS
from .audit import write_audit

router = APIRouter(prefix="/users", tags=["users"])


class UserCreate(BaseModel):
    email: str
    name: str = ""
    password: str
    role_id: int


class UserUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    is_active: bool | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


def _user_response(user: models.AdminUser) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name or "",
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "role": {
            "id": user.role.id,
            "name": user.role.name,
            "is_builtin": user.role.is_builtin,
        } if user.role else None,
        "permissions": list(_user_permissions(user)),
    }


# ── Self endpoints (any authenticated user) ──────────────────────────────────

@router.get("/me")
def get_me(user: models.AdminUser = Depends(get_current_user)):
    return _user_response(user)


@router.put("/me/password")
def change_own_password(
    request: Request,
    body: PasswordChange,
    user: models.AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if len(body.new_password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(401, "Current password incorrect")
    user.hashed_password = hash_password(body.new_password)
    db.commit()
    write_audit(db, user, "user.password_change", resource=user.email, request=request)
    return {"message": "Password updated"}


@router.post("/me/regenerate-key")
def regenerate_own_key(
    request: Request,
    user: models.AdminUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    new_key = secrets.token_urlsafe(32)
    user.api_key = new_key
    db.commit()
    write_audit(db, user, "user.regenerate_key", resource=user.email, request=request)
    return {"api_key": new_key}


# ── Admin user management ─────────────────────────────────────────────────────

@router.get("")
def list_users(
    _: models.AdminUser = Depends(require("users:read")),
    db: Session = Depends(get_db),
):
    users = db.query(models.AdminUser).order_by(models.AdminUser.created_at).all()
    return {"users": [_user_response(u) for u in users]}


@router.post("")
def create_user(
    request: Request,
    body: UserCreate,
    caller: models.AdminUser = Depends(require("users:write")),
    db: Session = Depends(get_db),
):
    email = body.email.strip().lower()
    if db.query(models.AdminUser).filter(models.AdminUser.email == email).first():
        raise HTTPException(400, "Email already in use")
    if len(body.password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    role = db.query(models.Role).filter(models.Role.id == body.role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")
    # Anti-escalation: cannot assign a role with more perms than caller
    if not caller.role:
        raise HTTPException(403, "You have no role assigned")
    caller_perms = _user_permissions(caller)
    target_perms = {rp.permission for rp in role.permissions}
    escalation = target_perms - caller_perms - SELF_PERMISSIONS
    if escalation and "users:set_role" not in caller_perms:
        raise HTTPException(403, f"Cannot assign permissions you don't hold: {escalation}")

    new_user = models.AdminUser(
        email=email,
        name=body.name.strip() or None,
        hashed_password=hash_password(body.password),
        api_key=secrets.token_urlsafe(32),
        role_id=role.id,
        is_active=True,
        created_by=caller.id,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    write_audit(db, caller, "user.create", resource=email, detail={"role": role.name}, request=request)
    return _user_response(new_user)


@router.get("/{user_id}")
def get_user(
    user_id: int,
    _: models.AdminUser = Depends(require("users:read")),
    db: Session = Depends(get_db),
):
    user = db.query(models.AdminUser).filter(models.AdminUser.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    return _user_response(user)


@router.put("/{user_id}")
def update_user(
    user_id: int,
    request: Request,
    body: UserUpdate,
    caller: models.AdminUser = Depends(require("users:write")),
    db: Session = Depends(get_db),
):
    user = db.query(models.AdminUser).filter(models.AdminUser.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if body.name is not None:
        user.name = body.name.strip() or None
    if body.email is not None:
        email = body.email.strip().lower()
        existing = db.query(models.AdminUser).filter(
            models.AdminUser.email == email, models.AdminUser.id != user_id
        ).first()
        if existing:
            raise HTTPException(400, "Email already in use")
        user.email = email
    if body.is_active is not None:
        if user.id == caller.id and not body.is_active:
            raise HTTPException(400, "Cannot deactivate yourself")
        user.is_active = body.is_active
    db.commit()
    write_audit(db, caller, "user.update", resource=user.email, request=request)
    return _user_response(user)


@router.put("/{user_id}/role")
def set_user_role(
    user_id: int,
    request: Request,
    body: dict,
    caller: models.AdminUser = Depends(require("users:set_role")),
    db: Session = Depends(get_db),
):
    user = db.query(models.AdminUser).filter(models.AdminUser.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if user.id == caller.id:
        raise HTTPException(400, "Cannot change your own role")
    role_id = body.get("role_id")
    if not role_id:
        raise HTTPException(422, "role_id required")
    role = db.query(models.Role).filter(models.Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")
    old_role = user.role.name if user.role else "none"
    user.role_id = role.id
    db.commit()
    write_audit(db, caller, "user.set_role", resource=user.email,
                detail={"from": old_role, "to": role.name}, request=request)
    return _user_response(user)


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    request: Request,
    caller: models.AdminUser = Depends(require("users:delete")),
    db: Session = Depends(get_db),
):
    user = db.query(models.AdminUser).filter(models.AdminUser.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if user.id == caller.id:
        raise HTTPException(400, "Cannot delete yourself")
    email = user.email
    user.is_active = False
    db.commit()
    write_audit(db, caller, "user.deactivate", resource=email, request=request)
    return {"message": f"User '{email}' deactivated"}


@router.post("/{user_id}/reset-api-key")
def reset_user_api_key(
    user_id: int,
    request: Request,
    caller: models.AdminUser = Depends(require("users:reset_key")),
    db: Session = Depends(get_db),
):
    user = db.query(models.AdminUser).filter(models.AdminUser.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    new_key = secrets.token_urlsafe(32)
    user.api_key = new_key
    db.commit()
    write_audit(db, caller, "user.reset_key", resource=user.email, request=request)
    return {"api_key": new_key, "email": user.email}
