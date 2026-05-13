import os
import re
import time
import logging
import secrets
import datetime as dt
from typing import Optional
import asyncio
import bcrypt
from fastapi import FastAPI, Depends, HTTPException, Security, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from . import models, database, tasks, checker
from .logging_config import setup_logging
import json

setup_logging()
logger = logging.getLogger(__name__)

models.Base.metadata.create_all(bind=database.engine)


def _hash_pw(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_pw(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


limiter = Limiter(key_func=get_remote_address)
_docs_enabled = os.getenv("ENABLE_DOCS", "false").lower() == "true"
app = FastAPI(
    title="Blacklist Monitor API",
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_origins_env = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8080")
origins = [o.strip() for o in _origins_env.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = os.getenv("API_KEY", "")
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=True)


class SetupRequest(BaseModel):
    email: str
    password: str
    api_key: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class TargetCreate(BaseModel):
    value: str


class TargetResponse(BaseModel):
    id: int
    address: str
    target_type: str
    is_blacklisted: bool
    last_checked: Optional[dt.datetime] = None
    created_at: Optional[dt.datetime] = None

    model_config = {"from_attributes": True}


class CheckHistoryResponse(BaseModel):
    id: int
    target_id: int
    status: bool
    details: Optional[str] = None
    checked_at: Optional[dt.datetime] = None

    model_config = {"from_attributes": True}


class BlacklistHitsResponse(BaseModel):
    target_id: int
    address: str
    is_blacklisted: bool
    hits: list[str]
    total_checked: int
    checked_at: Optional[dt.datetime] = None


def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def verify_api_key(key: str = Security(api_key_header), db: Session = Depends(get_db)):
    admin = db.query(models.AdminUser).filter(models.AdminUser.api_key == key).first()
    if admin:
        return key
    # Fallback to env var for backward compatibility / pre-setup
    if API_KEY and key == API_KEY:
        return key
    raise HTTPException(status_code=401, detail="Invalid API key")


def infer_target_type(value: str) -> str:
    ip_pattern = r"^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$"
    if re.match(ip_pattern, value):
        parts = value.split(".")
        if all(0 <= int(p) <= 255 for p in parts):
            return "ip"
    return "domain"


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    logger.info("request", extra={
        "method": request.method,
        "path": request.url.path,
        "status_code": response.status_code,
        "duration_ms": round((time.time() - start) * 1000),
    })
    return response


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/setup-status")
def setup_status(db: Session = Depends(get_db)):
    has_admin = db.query(models.AdminUser).first() is not None
    return {"needs_setup": not has_admin}


@app.post("/setup")
@limiter.limit("5/minute")
def setup(request: Request, body: SetupRequest, db: Session = Depends(get_db)):
    if db.query(models.AdminUser).first():
        raise HTTPException(status_code=400, detail="Already configured. Use login.")
    email = body.email.strip().lower()
    if not email or not body.password:
        raise HTTPException(status_code=422, detail="Email and password required")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    api_key = body.api_key.strip() or secrets.token_urlsafe(32)
    hashed = _hash_pw(body.password)
    admin = models.AdminUser(email=email, hashed_password=hashed, api_key=api_key)
    db.add(admin)
    db.commit()
    logger.info("admin_created", extra={"email": email})
    return {"message": "Setup complete", "api_key": api_key}


@app.post("/auth/login")
@limiter.limit("10/minute")
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)):
    admin = db.query(models.AdminUser).filter(
        models.AdminUser.email == body.email.strip().lower()
    ).first()
    if not admin or not _verify_pw(body.password, admin.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    logger.info("admin_login", extra={"email": admin.email})
    return {"api_key": admin.api_key, "email": admin.email}


@app.get("/dnsbl-providers", dependencies=[Depends(verify_api_key)])
def list_dnsbl_providers():
    return {"providers": checker.COMMON_DNSBLS, "total": len(checker.COMMON_DNSBLS)}


@app.post("/targets/", dependencies=[Depends(verify_api_key)], response_model=TargetResponse)
@limiter.limit("5/minute")
def add_target(request: Request, target: TargetCreate, db: Session = Depends(get_db)):
    address = target.value.strip().lower()
    db_target = db.query(models.Target).filter(models.Target.address == address).first()
    if db_target:
        raise HTTPException(status_code=400, detail="Target already exists")
    target_type = infer_target_type(address)
    new_target = models.Target(address=address, target_type=target_type)
    db.add(new_target)
    db.commit()
    db.refresh(new_target)
    tasks.monitor_target_task.delay(new_target.id)
    return new_target


@app.get("/targets/", dependencies=[Depends(verify_api_key)], response_model=list[TargetResponse])
@limiter.limit("60/minute")
def list_targets(request: Request, db: Session = Depends(get_db), skip: int = 0, limit: int = 100):
    return db.query(models.Target).offset(skip).limit(min(limit, 1000)).all()


@app.get("/targets/{target_id}", dependencies=[Depends(verify_api_key)], response_model=TargetResponse)
@limiter.limit("60/minute")
def get_target(request: Request, target_id: int, db: Session = Depends(get_db)):
    target = db.query(models.Target).filter(models.Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    return target


@app.post("/targets/recheck-all", dependencies=[Depends(verify_api_key)])
@limiter.limit("5/minute")
def recheck_all(request: Request):
    tasks.monitor_all_targets_task.delay()
    return {"message": "Recheck queued for all targets"}


@app.delete("/targets/{target_id}", dependencies=[Depends(verify_api_key)])
@limiter.limit("30/minute")
def delete_target(request: Request, target_id: int, db: Session = Depends(get_db)):
    target = db.query(models.Target).filter(models.Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    db.delete(target)
    db.commit()
    return {"message": "Target deleted"}


@app.get("/targets/{target_id}/history", dependencies=[Depends(verify_api_key)], response_model=list[CheckHistoryResponse])
@limiter.limit("60/minute")
def get_target_history(request: Request, target_id: int, db: Session = Depends(get_db)):
    target = db.query(models.Target).filter(models.Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    return (
        db.query(models.CheckHistory)
        .filter(models.CheckHistory.target_id == target_id)
        .order_by(models.CheckHistory.checked_at.desc())
        .all()
    )


@app.get("/targets/{target_id}/blacklist-hits", dependencies=[Depends(verify_api_key)], response_model=BlacklistHitsResponse)
@limiter.limit("60/minute")
def get_blacklist_hits(request: Request, target_id: int, db: Session = Depends(get_db)):
    """Returns which DNSBL providers the target is currently listed on."""
    target = db.query(models.Target).filter(models.Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")

    latest = (
        db.query(models.CheckHistory)
        .filter(models.CheckHistory.target_id == target_id)
        .order_by(models.CheckHistory.checked_at.desc())
        .first()
    )

    hits: list[str] = []
    total_checked = len(checker.COMMON_DNSBLS)
    checked_at = None

    if latest and latest.details:
        try:
            data = json.loads(latest.details)
            hits = data.get("hits", [])
            total_checked = data.get("total_checked", total_checked)
        except (json.JSONDecodeError, TypeError):
            pass
        checked_at = latest.checked_at

    return BlacklistHitsResponse(
        target_id=target.id,
        address=target.address,
        is_blacklisted=target.is_blacklisted,
        hits=hits,
        total_checked=total_checked,
        checked_at=checked_at,
    )


@app.websocket("/ws/problems")
async def problems_websocket(websocket: WebSocket):
    """Real-time feed of listed IPs/domains with their DNSBL hit details.
    Auth: pass ?key=<api_key> as query param (WebSocket headers not reliably supported).
    """
    api_key_param = websocket.query_params.get("key", "")
    if not API_KEY or api_key_param != API_KEY:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    logger.info("ws_problems_connected", extra={"client": str(websocket.client)})

    def get_listed_payload() -> list[dict]:
        db = database.SessionLocal()
        try:
            listed = (
                db.query(models.Target)
                .filter(models.Target.is_blacklisted == True)
                .order_by(models.Target.last_checked.desc())
                .all()
            )
            payload = []
            for t in listed:
                latest = (
                    db.query(models.CheckHistory)
                    .filter(models.CheckHistory.target_id == t.id)
                    .order_by(models.CheckHistory.checked_at.desc())
                    .first()
                )
                hits: list[str] = []
                total = len(checker.COMMON_DNSBLS)
                if latest and latest.details:
                    try:
                        d = json.loads(latest.details)
                        hits = d.get("hits", [])
                        total = d.get("total_checked", total)
                    except Exception:
                        pass
                payload.append({
                    "id": t.id,
                    "address": t.address,
                    "target_type": t.target_type,
                    "hits": hits,
                    "total_checked": total,
                    "last_checked": t.last_checked.isoformat() if t.last_checked else None,
                })
            return payload
        finally:
            db.close()

    try:
        while True:
            data = await asyncio.get_event_loop().run_in_executor(None, get_listed_payload)
            await websocket.send_json({"type": "problems_update", "data": data, "count": len(data)})
            await asyncio.sleep(10)
    except WebSocketDisconnect:
        logger.info("ws_problems_disconnected")
    except Exception as exc:
        logger.error("ws_problems_error", extra={"error": str(exc)})
