import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from .. import models
from ..auth import get_db, require
from ..alerts import channels_status, test_slack, test_email, TEMPLATE_KEYS, _CFG_PREFIX, _CFG_KEYS

router = APIRouter(prefix="/alerts", tags=["alerts"])


class TemplateUpdate(BaseModel):
    templates: dict[str, str]


class ChannelConfig(BaseModel):
    slack_webhook: Optional[str] = None
    smtp_server: Optional[str] = None
    smtp_port: Optional[str] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_to: Optional[str] = None


@router.get("", dependencies=[Depends(require("alerts:read"))])
def list_alerts(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    total = db.query(models.AlertLog).count()
    rows = (
        db.query(models.AlertLog)
        .order_by(models.AlertLog.created_at.desc())
        .offset(skip)
        .limit(min(limit, 500))
        .all()
    )
    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "target_address": r.target_address,
                "from_status": r.from_status,
                "to_status": r.to_status,
                "channels": json.loads(r.channels) if r.channels else [],
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@router.get("/channels", dependencies=[Depends(require("alerts:read"))])
def get_channels(db: Session = Depends(get_db)):
    return channels_status(db)


@router.get("/config", dependencies=[Depends(require("alerts:configure"))])
def get_channel_config(db: Session = Depends(get_db)):
    """Return current DB-stored config (passwords masked)."""
    rows = {
        r.key.removeprefix(_CFG_PREFIX): r.value
        for r in db.query(models.AppSetting).filter(models.AppSetting.key.like(f"{_CFG_PREFIX}%")).all()
    }
    result = {}
    for k in _CFG_KEYS:
        val = rows.get(k, "")
        # Mask passwords
        if k in ("slack_webhook", "smtp_password") and val:
            result[k] = "••••••••"
            result[f"{k}_set"] = True
        else:
            result[k] = val
            result[f"{k}_set"] = bool(val)
    return result


@router.put("/config", dependencies=[Depends(require("alerts:configure"))])
def update_channel_config(body: ChannelConfig, db: Session = Depends(get_db)):
    updates = body.model_dump(exclude_none=True)
    for key, value in updates.items():
        if key not in _CFG_KEYS:
            continue
        # Skip masked placeholder values
        if value == "••••••••":
            continue
        db_key = f"{_CFG_PREFIX}{key}"
        setting = db.query(models.AppSetting).filter(models.AppSetting.key == db_key).first()
        if value == "":
            # Empty string = clear the override (fall back to env)
            if setting:
                db.delete(setting)
        else:
            if setting:
                setting.value = value
            else:
                db.add(models.AppSetting(key=db_key, value=value))
    db.commit()
    return {"updated": list(updates.keys())}


@router.post("/test/slack", dependencies=[Depends(require("alerts:configure"))])
def send_test_slack(db: Session = Depends(get_db)):
    return test_slack(db)


@router.post("/test/email", dependencies=[Depends(require("alerts:configure"))])
def send_test_email(db: Session = Depends(get_db)):
    return test_email(db)


@router.get("/templates", dependencies=[Depends(require("alerts:read"))])
def get_templates(db: Session = Depends(get_db)):
    overrides = {
        r.key.removeprefix("alert_tpl_"): r.value
        for r in db.query(models.AppSetting).filter(models.AppSetting.key.like("alert_tpl_%")).all()
    }
    return {
        "templates": {k: overrides.get(k, v) for k, v in TEMPLATE_KEYS.items()},
        "defaults": TEMPLATE_KEYS,
        "variables": ["{address}", "{from_status}", "{to_status}", "{from_status_upper}", "{to_status_upper}", "{timestamp}", "{emoji}"],
    }


@router.put("/templates", dependencies=[Depends(require("alerts:configure"))])
def update_templates(body: TemplateUpdate, db: Session = Depends(get_db)):
    invalid = [k for k in body.templates if k not in TEMPLATE_KEYS]
    if invalid:
        raise HTTPException(422, f"Unknown template keys: {invalid}")
    for key, value in body.templates.items():
        setting = db.query(models.AppSetting).filter(models.AppSetting.key == f"alert_tpl_{key}").first()
        if setting:
            setting.value = value
        else:
            db.add(models.AppSetting(key=f"alert_tpl_{key}", value=value))
    db.commit()
    return {"updated": list(body.templates.keys())}


@router.delete("/templates/{key}", dependencies=[Depends(require("alerts:configure"))])
def reset_template(key: str, db: Session = Depends(get_db)):
    if key not in TEMPLATE_KEYS:
        raise HTTPException(404, "Template key not found")
    db.query(models.AppSetting).filter(models.AppSetting.key == f"alert_tpl_{key}").delete()
    db.commit()
    return {"reset": key, "value": TEMPLATE_KEYS[key]}
