import json as _json
import datetime
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from .. import models
from ..auth import get_db, require

router = APIRouter(prefix="/audit", tags=["audit"])


def write_audit(
    db: Session,
    user: models.AdminUser | None,
    action: str,
    resource: str | None = None,
    detail: dict | None = None,
    request: Request | None = None,
):
    ip = None
    if request:
        ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else None)
    db.add(models.AuditLog(
        user_id=user.id if user else None,
        action=action,
        resource=resource,
        detail=_json.dumps(detail) if detail else None,
        ip_address=ip,
    ))
    db.commit()


@router.get("", dependencies=[Depends(require("audit:read"))])
def list_audit(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    total = db.query(models.AuditLog).count()
    entries = (
        db.query(models.AuditLog)
        .order_by(models.AuditLog.created_at.desc())
        .offset(skip)
        .limit(min(limit, 500))
        .all()
    )
    return {
        "total": total,
        "items": [
            {
                "id": e.id,
                "action": e.action,
                "resource": e.resource,
                "detail": _json.loads(e.detail) if e.detail else None,
                "ip_address": e.ip_address,
                "created_at": e.created_at.isoformat() if e.created_at else None,
                "user": {"id": e.user.id, "email": e.user.email, "name": e.user.name} if e.user else None,
            }
            for e in entries
        ],
    }
