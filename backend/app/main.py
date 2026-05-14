from __future__ import annotations
import os
import re
import time
import logging
import secrets
import datetime as dt
import ipaddress
import uuid
from contextlib import asynccontextmanager
from typing import Optional
import asyncio
from fastapi import FastAPI, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from . import models, database, tasks, checker
from .logging_config import setup_logging
from .auth import get_db, get_current_user, require, hash_password, verify_password, _user_permissions
from .permissions import BUILTIN_ROLES
from .routers import users as users_router, roles as roles_router, audit as audit_router, alerts as alerts_router
import json

setup_logging()
logger = logging.getLogger(__name__)


def _seed_builtin_roles():
    """Idempotent: create built-in roles at startup and assign super_admin to existing users."""
    db = database.SessionLocal()
    try:
        for role_name, role_def in BUILTIN_ROLES.items():
            role = db.query(models.Role).filter(models.Role.name == role_name).first()
            if not role:
                role = models.Role(name=role_name, description=role_def["description"], is_builtin=True)
                db.add(role)
                db.flush()
                for perm in sorted(role_def["permissions"]):
                    db.add(models.RolePermission(role_id=role.id, permission=perm))
        db.commit()
        super_admin = db.query(models.Role).filter(models.Role.name == "super_admin").first()
        if super_admin:
            db.query(models.AdminUser).filter(models.AdminUser.role_id.is_(None)).update(
                {"role_id": super_admin.id}, synchronize_session=False
            )
            db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _seed_builtin_roles()
    yield


limiter = Limiter(key_func=get_remote_address)
_docs_enabled = os.getenv("ENABLE_DOCS", "false").lower() == "true"
app = FastAPI(
    title="Blacklist Monitor API",
    lifespan=lifespan,
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

app.include_router(users_router.router)
app.include_router(roles_router.router)
app.include_router(audit_router.router)
app.include_router(alerts_router.router)


class SetupRequest(BaseModel):
    email: str
    password: str
    api_key: str = ""
    name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class SubnetScanRequest(BaseModel):
    cidr: str


class TargetCreate(BaseModel):
    value: str


class TargetResponse(BaseModel):
    id: int
    address: str
    target_type: str
    is_blacklisted: bool
    last_checked: Optional[dt.datetime] = None
    created_at: Optional[dt.datetime] = None
    org: Optional[str] = None

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


class BulkDeleteRequest(BaseModel):
    ids: list[int]


class BulkAddRequest(BaseModel):
    values: list[str]
    expand_subnets: bool = False  # if True, expand CIDRs into individual IPs


def infer_target_type(value: str) -> str:
    if "/" in value:
        try:
            ipaddress.ip_network(value, strict=False)
            return "subnet"
        except ValueError:
            pass
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
    hashed = hash_password(body.password)
    super_admin_role = db.query(models.Role).filter(models.Role.name == "super_admin").first()
    from .auth import _hash_api_key
    admin = models.AdminUser(
        email=email, hashed_password=hashed, api_key=api_key,
        api_key_hash=_hash_api_key(api_key),
        name=body.name.strip() or None,
        role_id=super_admin_role.id if super_admin_role else None,
        is_active=True,
    )
    db.add(admin)
    db.commit()
    logger.info("admin_created", extra={"email": email})
    return {"message": "Setup complete", "api_key": api_key}


@app.post("/auth/login")
@limiter.limit("10/minute")
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)):
    admin = db.query(models.AdminUser).filter(
        models.AdminUser.email == body.email.strip().lower(),
        models.AdminUser.is_active == True,
    ).first()
    if not admin or not verify_password(body.password, admin.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    admin.last_login = dt.datetime.now(dt.timezone.utc)
    db.commit()
    perms = _user_permissions(admin)
    logger.info("admin_login", extra={"email": admin.email})
    return {
        "api_key": admin.api_key,
        "email": admin.email,
        "name": admin.name or "",
        "role": admin.role.name if admin.role else None,
        "permissions": sorted(perms),
    }


@app.get("/dnsbl-providers", dependencies=[Depends(require("settings:read"))])
def list_dnsbl_providers():
    return {"providers": checker.COMMON_DNSBLS, "total": len(checker.COMMON_DNSBLS)}


from .redis_client import rclient as _rclient


@app.post("/targets/subnet-expand", dependencies=[Depends(require("targets:bulk"))])
@limiter.limit("5/minute")
def subnet_expand(request: Request, body: SubnetScanRequest, db: Session = Depends(get_db)):
    """Expand a CIDR subnet into individual IP targets and bulk-add to monitoring."""
    try:
        net = ipaddress.ip_network(body.cidr.strip(), strict=False)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid CIDR notation")
    if net.version != 4:
        raise HTTPException(status_code=422, detail="Only IPv4 subnets supported")
    if net.prefixlen < 16:
        raise HTTPException(status_code=422, detail=f"Too large — maximum /16 (65,534 IPs). Got /{net.prefixlen}")
    if net.is_private or net.is_loopback or net.is_link_local or net.is_reserved:
        raise HTTPException(status_code=422, detail=f"{net} is a private/reserved subnet and cannot be monitored on public DNSBLs")
    ips = [str(ip) for ip in net.hosts()] or [str(net.network_address)]
    existing = {
        r[0] for r in db.query(models.Target.address).filter(models.Target.address.in_(ips)).all()
    }
    new_ips = [ip for ip in ips if ip not in existing]
    if new_ips:
        from .checker import lookup_org
        subnet_org = lookup_org(str(net.network_address))
        db.bulk_save_objects([
            models.Target(address=ip, target_type="ip", is_blacklisted=False, org=subnet_org)
            for ip in new_ips
        ], return_defaults=True)
        db.commit()
        # Queue DNSBL checks for newly added targets
        added = db.query(models.Target).filter(models.Target.address.in_(new_ips)).all()
        for t in added:
            tasks.monitor_target_task.delay(t.id)
    return {"cidr": str(net), "total": len(ips), "added": len(new_ips), "skipped": len(existing)}


@app.post("/scan/subnet", dependencies=[Depends(require("scan:run"))])
@limiter.limit("5/minute")
def scan_subnet_start(request: Request, body: SubnetScanRequest, db: Session = Depends(get_db)):
    """Start async subnet scan via Celery. Poll GET /scan/subnet/{scan_id} for progress."""
    try:
        net = ipaddress.ip_network(body.cidr.strip(), strict=False)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid CIDR notation (e.g. 192.168.1.0/28)")
    if net.version != 4:
        raise HTTPException(status_code=422, detail="Only IPv4 subnets supported")

    ips = [str(ip) for ip in net.hosts()] or [str(net.network_address)]
    total = len(ips)
    scan_id = str(uuid.uuid4())
    TTL = 3600

    _rclient.setex(f"scan:{scan_id}:info", TTL, json.dumps({"cidr": str(net), "total": total, "complete": False}))
    _rclient.setex(f"scan:{scan_id}:done", TTL, 0)

    sess = models.ScanSession(
        session_type="single",
        params=json.dumps({"cidr": str(net)}),
        scan_ref=scan_id,
        total_ips=total,
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)

    tasks.scan_subnet_task.delay(scan_id, str(net), sess.id)
    return {"scan_id": scan_id, "session_id": sess.id, "cidr": str(net), "total": total}


@app.get("/scan/subnet/{scan_id}", dependencies=[Depends(require("scan:run"))])
def scan_subnet_progress(request: Request, scan_id: str):
    """Poll for subnet scan progress."""
    info_raw = _rclient.get(f"scan:{scan_id}:info")
    if not info_raw:
        raise HTTPException(status_code=404, detail="Scan not found or expired")
    info = json.loads(info_raw)
    done = int(_rclient.get(f"scan:{scan_id}:done") or 0)
    results = [json.loads(r) for r in _rclient.lrange(f"scan:{scan_id}:results", 0, -1)]
    results.sort(key=lambda x: [int(p) for p in x["ip"].split(".")])
    listed = sum(1 for r in results if r["is_blacklisted"])
    return {
        "scan_id": scan_id,
        "cidr": info["cidr"],
        "total_ips": info["total"],
        "done": done,
        "complete": info["complete"],
        "results": results,
        "listed": listed,
        "clean": len(results) - listed,
    }


class BulkScanRequest(BaseModel):
    cidrs: list[str]


@app.post("/scan/subnets/bulk", dependencies=[Depends(require("scan:run"))])
@limiter.limit("3/minute")
def bulk_scan_start(request: Request, body: BulkScanRequest, db: Session = Depends(get_db)):
    """Start async DNSBL scans for multiple subnets. Returns batch_id to poll progress."""
    if not body.cidrs:
        raise HTTPException(status_code=422, detail="cidrs array required")
    if len(body.cidrs) > 100:
        raise HTTPException(status_code=422, detail="Max 100 subnets per batch")

    TTL = 7200
    batch_id = str(uuid.uuid4())
    scans = []
    total_all = 0

    for raw_cidr in body.cidrs:
        try:
            net = ipaddress.ip_network(raw_cidr.strip(), strict=False)
        except ValueError:
            continue
        if net.version != 4:
            continue
        ips = [str(ip) for ip in net.hosts()] or [str(net.network_address)]
        total = len(ips)
        total_all += total
        scan_id = str(uuid.uuid4())
        _rclient.setex(f"scan:{scan_id}:info", TTL, json.dumps({"cidr": str(net), "total": total, "complete": False}))
        _rclient.setex(f"scan:{scan_id}:done", TTL, 0)
        tasks.scan_subnet_task.delay(scan_id, str(net))
        scans.append({"cidr": str(net), "scan_id": scan_id, "total": total})

    _rclient.setex(f"batch:{batch_id}:scans", TTL, json.dumps(scans))

    sess = models.ScanSession(
        session_type="bulk",
        params=json.dumps({"cidrs": [s["cidr"] for s in scans]}),
        scan_ref=batch_id,
        total_ips=total_all,
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)

    return {"batch_id": batch_id, "session_id": sess.id, "subnet_count": len(scans), "scans": scans}


@app.get("/scan/subnets/bulk/{batch_id}", dependencies=[Depends(require("scan:run"))])
def bulk_scan_progress(request: Request, batch_id: str):
    """Poll aggregate progress for a bulk subnet scan batch."""
    raw = _rclient.get(f"batch:{batch_id}:scans")
    if not raw:
        raise HTTPException(status_code=404, detail="Batch not found or expired")
    scans = json.loads(raw)

    subnets = []
    total_ips = 0
    total_done = 0
    total_listed = 0
    all_complete = True

    for s in scans:
        scan_id = s["scan_id"]
        info_raw = _rclient.get(f"scan:{scan_id}:info")
        if not info_raw:
            subnets.append({"cidr": s["cidr"], "scan_id": scan_id, "total": s["total"], "done": s["total"], "listed": 0, "complete": True, "results": []})
            total_ips += s["total"]
            total_done += s["total"]
            continue
        info = json.loads(info_raw)
        done = int(_rclient.get(f"scan:{scan_id}:done") or 0)
        results = [json.loads(r) for r in _rclient.lrange(f"scan:{scan_id}:results", 0, -1)]
        listed = sum(1 for r in results if r["is_blacklisted"])
        complete = info.get("complete", False)
        if not complete:
            all_complete = False
        subnets.append({
            "cidr": s["cidr"],
            "scan_id": scan_id,
            "total": info["total"],
            "done": done,
            "listed": listed,
            "complete": complete,
            "results": results,
        })
        total_ips += info["total"]
        total_done += done
        total_listed += listed

    return {
        "batch_id": batch_id,
        "subnet_count": len(scans),
        "total_ips": total_ips,
        "total_done": total_done,
        "total_listed": total_listed,
        "complete": all_complete,
        "subnets": subnets,
    }


class ScanSessionResponse(BaseModel):
    id: int
    session_type: str
    params: str
    scan_ref: Optional[str] = None
    status: str
    total_ips: int
    total_listed: int
    created_at: Optional[dt.datetime] = None
    completed_at: Optional[dt.datetime] = None
    model_config = {"from_attributes": True}


@app.get("/scan/sessions", dependencies=[Depends(require("scan:run"))], response_model=list[ScanSessionResponse])
def list_scan_sessions(db: Session = Depends(get_db)):
    return (
        db.query(models.ScanSession)
        .order_by(models.ScanSession.created_at.desc())
        .limit(200)
        .all()
    )


@app.get("/scan/sessions/{session_id}", dependencies=[Depends(require("scan:run"))])
def get_scan_session(session_id: int, db: Session = Depends(get_db)):
    sess = db.query(models.ScanSession).filter(models.ScanSession.id == session_id).first()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    result = {
        "id": sess.id,
        "session_type": sess.session_type,
        "params": json.loads(sess.params),
        "scan_ref": sess.scan_ref,
        "status": sess.status,
        "total_ips": sess.total_ips,
        "total_listed": sess.total_listed,
        "created_at": sess.created_at.isoformat() if sess.created_at else None,
        "completed_at": sess.completed_at.isoformat() if sess.completed_at else None,
        "results_available": False,
        "live_data": None,
    }
    if sess.scan_ref and sess.status == "running":
        if sess.session_type == "single":
            info_raw = _rclient.get(f"scan:{sess.scan_ref}:info")
            if info_raw:
                info = json.loads(info_raw)
                done = int(_rclient.get(f"scan:{sess.scan_ref}:done") or 0)
                results = [json.loads(r) for r in _rclient.lrange(f"scan:{sess.scan_ref}:results", 0, -1)]
                result["results_available"] = True
                result["live_data"] = {"done": done, "total": info["total"], "complete": info["complete"], "results": results}
        elif sess.session_type == "bulk":
            batch_raw = _rclient.get(f"batch:{sess.scan_ref}:scans")
            if batch_raw:
                result["results_available"] = True
                result["live_data"] = {"batch_id": sess.scan_ref}
    elif sess.scan_ref and sess.status == "complete":
        if sess.session_type == "single":
            info_raw = _rclient.get(f"scan:{sess.scan_ref}:info")
            if info_raw:
                results = [json.loads(r) for r in _rclient.lrange(f"scan:{sess.scan_ref}:results", 0, -1)]
                result["results_available"] = True
                result["live_data"] = {"done": sess.total_ips, "total": sess.total_ips, "complete": True, "results": results}
    return result


@app.patch("/scan/sessions/{session_id}", dependencies=[Depends(require("scan:run"))])
def update_scan_session(session_id: int, body: dict, db: Session = Depends(get_db)):
    sess = db.query(models.ScanSession).filter(models.ScanSession.id == session_id).first()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    if "status" in body:
        sess.status = body["status"]
    if "total_listed" in body:
        sess.total_listed = body["total_listed"]
    if body.get("status") in ("complete", "failed"):
        sess.completed_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return {"ok": True}


@app.post("/targets/", dependencies=[Depends(require("targets:write"))], response_model=TargetResponse)
@limiter.limit("5/minute")
def add_target(request: Request, target: TargetCreate, db: Session = Depends(get_db)):
    address = target.value.strip().lower()
    db_target = db.query(models.Target).filter(models.Target.address == address).first()
    if db_target:
        raise HTTPException(status_code=400, detail="Target already exists")
    target_type = infer_target_type(address)
    # Reject private / reserved IPs — they cannot appear on public DNSBLs
    if target_type == "ip":
        try:
            addr = ipaddress.ip_address(address)
            if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_unspecified:
                raise HTTPException(status_code=422, detail=f"{address} is a private/reserved IP and cannot be monitored on public DNSBLs")
        except HTTPException:
            raise
        except Exception:
            pass
    if target_type == "subnet":
        try:
            net = ipaddress.ip_network(address, strict=False)
            if net.version != 4:
                raise HTTPException(status_code=422, detail="Only IPv4 subnets supported")
            if net.is_private or net.is_loopback or net.is_link_local or net.is_reserved:
                raise HTTPException(status_code=422, detail=f"{net} is a private/reserved subnet and cannot be monitored on public DNSBLs")
            address = str(net)  # normalise to canonical form
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=422, detail="Invalid subnet CIDR")
    from .checker import lookup_org_for_target
    org = lookup_org_for_target(address, target_type)
    new_target = models.Target(address=address, target_type=target_type, org=org)
    db.add(new_target)
    db.commit()
    db.refresh(new_target)
    tasks.monitor_target_task.delay(new_target.id)
    return new_target


@app.post("/targets/bulk-add", dependencies=[Depends(require("targets:write"))], response_model=dict)
@limiter.limit("5/minute")
def bulk_add_targets(request: Request, body: BulkAddRequest, db: Session = Depends(get_db)):
    """Bulk add multiple targets (IPs, domains, subnets).
    If expand_subnets=True, CIDRs are expanded to individual IPs instead of added as a subnet target."""
    from .checker import lookup_org_for_target, lookup_org

    added = []
    skipped = []
    errors = []

    def _add_one(value: str, target_type: str):
        existing = db.query(models.Target).filter(models.Target.address == value).first()
        if existing:
            skipped.append({"value": value, "reason": "already exists"})
            return
        org = lookup_org_for_target(value, target_type)
        new_target = models.Target(address=value, target_type=target_type, org=org)
        db.add(new_target)
        db.commit()
        db.refresh(new_target)
        tasks.monitor_target_task.delay(new_target.id)
        added.append({"value": value, "id": new_target.id, "type": target_type})

    for raw in body.values:
        value = raw.strip().lower()
        if not value:
            continue
        try:
            target_type = infer_target_type(value)

            if target_type == "ip":
                addr = ipaddress.ip_address(value)
                if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_unspecified:
                    errors.append({"value": value, "reason": "private/reserved IP"})
                    continue
                _add_one(value, "ip")

            elif target_type == "subnet":
                try:
                    net = ipaddress.ip_network(value, strict=False)
                except ValueError:
                    errors.append({"value": value, "reason": "invalid CIDR"})
                    continue
                if net.version != 4:
                    errors.append({"value": value, "reason": "only IPv4 subnets supported"})
                    continue
                if net.is_private or net.is_loopback or net.is_link_local or net.is_reserved:
                    errors.append({"value": value, "reason": "private/reserved subnet"})
                    continue

                if body.expand_subnets:
                    # Expand CIDR to individual IPs
                    subnet_org = lookup_org(str(net.network_address))
                    ips = [str(ip) for ip in net.hosts()] or [str(net.network_address)]
                    existing_set = {
                        r[0] for r in db.query(models.Target.address).filter(models.Target.address.in_(ips)).all()
                    }
                    new_ips = [ip for ip in ips if ip not in existing_set]
                    if existing_set:
                        skipped.append({"value": value, "reason": f"{len(existing_set)} IPs already exist"})
                    db.bulk_save_objects([
                        models.Target(address=ip, target_type="ip", is_blacklisted=False, org=subnet_org)
                        for ip in new_ips
                    ], return_defaults=True)
                    db.commit()
                    inserted = db.query(models.Target).filter(models.Target.address.in_(new_ips)).all()
                    for t in inserted:
                        tasks.monitor_target_task.delay(t.id)
                        added.append({"value": t.address, "id": t.id, "type": "ip"})
                else:
                    _add_one(str(net), "subnet")

            else:
                _add_one(value, "domain")

        except Exception as e:
            db.rollback()
            errors.append({"value": value, "reason": str(e)})

    return {
        "added": len(added),
        "skipped": len(skipped),
        "errors": len(errors),
        "added_items": added,
        "skipped_items": skipped,
        "error_items": errors,
    }


@app.get("/targets/", dependencies=[Depends(require("targets:read"))], response_model=list[TargetResponse])
@limiter.limit("60/minute")
def list_targets(request: Request, db: Session = Depends(get_db), skip: int = 0):
    return db.query(models.Target).offset(skip).all()


@app.get("/targets/{target_id}", dependencies=[Depends(require("targets:write"))], response_model=TargetResponse)
@limiter.limit("60/minute")
def get_target(request: Request, target_id: int, db: Session = Depends(get_db)):
    target = db.query(models.Target).filter(models.Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    return target


@app.post("/targets/recheck-all", dependencies=[Depends(require("targets:recheck"))])
@limiter.limit("5/minute")
def recheck_all(request: Request):
    tasks.monitor_all_targets_task.delay()
    return {"message": "Recheck queued for all targets"}


@app.post("/targets/bulk-delete", dependencies=[Depends(require("targets:delete"))])
@limiter.limit("10/minute")
def bulk_delete_targets(request: Request, body: BulkDeleteRequest, db: Session = Depends(get_db)):
    if not body.ids:
        raise HTTPException(status_code=422, detail="ids array required")
    db.query(models.CheckHistory).filter(models.CheckHistory.target_id.in_(body.ids)).delete(synchronize_session=False)
    deleted = db.query(models.Target).filter(models.Target.id.in_(body.ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}


@app.delete("/targets/{target_id}", dependencies=[Depends(require("targets:delete"))])
@limiter.limit("30/minute")
def delete_target(request: Request, target_id: int, db: Session = Depends(get_db)):
    target = db.query(models.Target).filter(models.Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    db.query(models.CheckHistory).filter(models.CheckHistory.target_id == target_id).delete(synchronize_session=False)
    db.delete(target)
    db.commit()
    return {"message": "Target deleted"}


@app.get("/targets/{target_id}/history", dependencies=[Depends(require("targets:read"))], response_model=list[CheckHistoryResponse])
@limiter.limit("60/minute")
def get_target_history(request: Request, target_id: int, db: Session = Depends(get_db), limit: int = 100):
    target = db.query(models.Target).filter(models.Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    return (
        db.query(models.CheckHistory)
        .filter(models.CheckHistory.target_id == target_id)
        .order_by(models.CheckHistory.checked_at.desc())
        .limit(min(limit, 500))
        .all()
    )


@app.get("/targets/{target_id}/blacklist-hits", dependencies=[Depends(require("targets:read"))], response_model=BlacklistHitsResponse)
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
            raw_hits = data.get("hits", [])
            # Subnet format: hits = [{"ip": ..., "zones": [...]}]
            if raw_hits and isinstance(raw_hits[0], dict):
                hits = [f"{h['ip']}: {', '.join(h['zones'])}" for h in raw_hits]
            else:
                hits = raw_hits
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
    db = database.SessionLocal()
    try:
        user = db.query(models.AdminUser).filter(
            models.AdminUser.api_key == api_key_param,
            models.AdminUser.is_active == True,
        ).first()
        from .auth import _user_permissions as _up
        valid = user is not None and "targets:read" in _up(user)
    finally:
        db.close()
    if not valid:
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
                        raw = d.get("hits", [])
                        if raw and isinstance(raw[0], dict):
                            hits = [f"{h['ip']}: {', '.join(h['zones'])}" for h in raw]
                        else:
                            hits = raw
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
            data = await asyncio.get_running_loop().run_in_executor(None, get_listed_payload)
            await websocket.send_json({"type": "problems_update", "data": data, "count": len(data)})
            await asyncio.sleep(10)
    except WebSocketDisconnect:
        logger.info("ws_problems_disconnected")
    except Exception as exc:
        logger.error("ws_problems_error", extra={"error": str(exc)})
