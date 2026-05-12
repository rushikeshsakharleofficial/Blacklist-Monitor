import os
import re
import time
import logging
from fastapi import FastAPI, Depends, HTTPException, Security, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from . import models, database, tasks
from .logging_config import setup_logging

setup_logging()
logger = logging.getLogger(__name__)

models.Base.metadata.create_all(bind=database.engine)

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Blacklist Monitor API")
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


def verify_api_key(key: str = Security(api_key_header)):
    if not API_KEY or key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return key


class TargetCreate(BaseModel):
    value: str


def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def infer_target_type(value: str) -> str:
    ip_pattern = r"^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$"
    if re.match(ip_pattern, value):
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


@app.post("/targets/", dependencies=[Depends(verify_api_key)])
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


@app.get("/targets/", dependencies=[Depends(verify_api_key)])
@limiter.limit("60/minute")
def list_targets(request: Request, db: Session = Depends(get_db)):
    return db.query(models.Target).all()


@app.delete("/targets/{target_id}", dependencies=[Depends(verify_api_key)])
@limiter.limit("30/minute")
def delete_target(request: Request, target_id: int, db: Session = Depends(get_db)):
    target = db.query(models.Target).filter(models.Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    db.delete(target)
    db.commit()
    return {"message": "Target deleted"}


@app.get("/targets/{target_id}/history", dependencies=[Depends(verify_api_key)])
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
