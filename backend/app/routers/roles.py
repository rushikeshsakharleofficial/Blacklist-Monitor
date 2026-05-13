from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from .. import models
from ..auth import get_db, require, get_current_user
from ..permissions import ALL_PERMISSIONS, SELF_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LABELS
from .audit import write_audit

router = APIRouter(prefix="/roles", tags=["roles"])


class RoleCreate(BaseModel):
    name: str
    description: str = ""
    permissions: list[str]


class RoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    permissions: list[str] | None = None


def _role_response(role: models.Role) -> dict:
    return {
        "id": role.id,
        "name": role.name,
        "description": role.description,
        "is_builtin": role.is_builtin,
        "permissions": [rp.permission for rp in role.permissions],
        "user_count": len(role.users),
        "created_at": role.created_at.isoformat() if role.created_at else None,
    }


@router.get("")
def list_roles(
    _: models.AdminUser = Depends(require("users:read")),
    db: Session = Depends(get_db),
):
    roles = db.query(models.Role).order_by(models.Role.is_builtin.desc(), models.Role.name).all()
    return {
        "roles": [_role_response(r) for r in roles],
        "all_permissions": ALL_PERMISSIONS,
        "permission_groups": PERMISSION_GROUPS,
        "permission_labels": PERMISSION_LABELS,
    }


@router.get("/{role_id}")
def get_role(
    role_id: int,
    _: models.AdminUser = Depends(require("users:read")),
    db: Session = Depends(get_db),
):
    role = db.query(models.Role).filter(models.Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")
    return _role_response(role)


@router.post("")
def create_role(
    request: Request,
    body: RoleCreate,
    caller: models.AdminUser = Depends(require("users:set_role")),
    db: Session = Depends(get_db),
):
    name = body.name.strip().lower().replace(" ", "_")
    if not name:
        raise HTTPException(422, "Role name required")
    if db.query(models.Role).filter(models.Role.name == name).first():
        raise HTTPException(400, f"Role '{name}' already exists")

    # Anti-escalation: cannot grant permissions caller doesn't hold
    caller_perms = {rp.permission for rp in caller.role.permissions} | SELF_PERMISSIONS if caller.role else SELF_PERMISSIONS
    requested = set(body.permissions)
    invalid = requested - set(ALL_PERMISSIONS)
    if invalid:
        raise HTTPException(422, f"Unknown permissions: {invalid}")
    escalation = requested - caller_perms
    if escalation:
        raise HTTPException(403, f"Cannot grant permissions you don't hold: {escalation}")
    if not requested:
        raise HTTPException(422, "At least one permission required")

    role = models.Role(name=name, description=body.description, is_builtin=False)
    db.add(role)
    db.flush()
    for perm in requested:
        db.add(models.RolePermission(role_id=role.id, permission=perm))
    db.commit()
    db.refresh(role)
    write_audit(db, caller, "role.create", resource=name, detail={"permissions": list(requested)}, request=request)
    return _role_response(role)


@router.put("/{role_id}")
def update_role(
    role_id: int,
    request: Request,
    body: RoleUpdate,
    caller: models.AdminUser = Depends(require("users:set_role")),
    db: Session = Depends(get_db),
):
    role = db.query(models.Role).filter(models.Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")
    if role.is_builtin:
        raise HTTPException(400, "Built-in roles cannot be modified")

    if body.name is not None:
        new_name = body.name.strip().lower().replace(" ", "_")
        existing = db.query(models.Role).filter(models.Role.name == new_name, models.Role.id != role_id).first()
        if existing:
            raise HTTPException(400, f"Role '{new_name}' already exists")
        role.name = new_name
    if body.description is not None:
        role.description = body.description
    if body.permissions is not None:
        caller_perms = {rp.permission for rp in caller.role.permissions} | SELF_PERMISSIONS if caller.role else SELF_PERMISSIONS
        requested = set(body.permissions)
        invalid = requested - set(ALL_PERMISSIONS)
        if invalid:
            raise HTTPException(422, f"Unknown permissions: {invalid}")
        escalation = requested - caller_perms
        if escalation:
            raise HTTPException(403, f"Cannot grant permissions you don't hold: {escalation}")
        if not requested:
            raise HTTPException(422, "At least one permission required")
        db.query(models.RolePermission).filter(models.RolePermission.role_id == role_id).delete()
        for perm in requested:
            db.add(models.RolePermission(role_id=role_id, permission=perm))

    db.commit()
    db.refresh(role)
    write_audit(db, caller, "role.update", resource=role.name, request=request)
    return _role_response(role)


@router.delete("/{role_id}")
def delete_role(
    role_id: int,
    request: Request,
    caller: models.AdminUser = Depends(require("users:set_role")),
    db: Session = Depends(get_db),
):
    role = db.query(models.Role).filter(models.Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")
    if role.is_builtin:
        raise HTTPException(400, "Built-in roles cannot be deleted")
    if role.users:
        raise HTTPException(400, f"Cannot delete role with {len(role.users)} assigned user(s). Reassign first.")
    name = role.name
    db.delete(role)
    db.commit()
    write_audit(db, caller, "role.delete", resource=name, request=request)
    return {"message": f"Role '{name}' deleted"}
