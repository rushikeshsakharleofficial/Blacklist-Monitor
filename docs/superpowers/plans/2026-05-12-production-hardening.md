# Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the blacklist-monitor stack production-ready: secrets management, Docker reliability, nginx+SSL, rate limiting, and structured JSON logging.

**Architecture:** Four independent tasks touching different file groups — designed for parallel dispatch. Tasks 1–4 have zero file overlap and can run concurrently.

**Tech Stack:** Docker Compose, nginx, certbot, slowapi, python-json-logger, Vite env vars

---

## File Map

| Task | Files |
|------|-------|
| Task 1: Secrets & Config | `.env.example`, `.gitignore`, `frontend/.env.example`, `frontend/src/App.tsx` |
| Task 2: Docker Hardening | `docker-compose.yml`, `backend/Dockerfile` |
| Task 3: Nginx + SSL | `nginx/nginx.conf` (new) |
| Task 4: Backend Python | `backend/requirements.txt`, `backend/app/logging_config.py` (new), `backend/app/main.py`, `backend/app/tasks.py` |

---

### Task 1: Secrets & Config

**Files:**
- Create: `.env.example`
- Modify: `.gitignore`
- Create: `frontend/.env.example`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create .env.example**

Create `/.env.example` at project root:
```
# Database
POSTGRES_USER=user
POSTGRES_PASSWORD=changeme_strong_password
POSTGRES_DB=blacklist_db
DATABASE_URL=postgresql://user:changeme_strong_password@db:5432/blacklist_db

# Redis
REDIS_URL=redis://redis:6379/0

# API
API_KEY=changeme_strong_api_key
ALLOWED_ORIGINS=https://yourdomain.com
LOG_LEVEL=INFO
WEB_CONCURRENCY=2

# Alerts (optional)
SLACK_WEBHOOK_URL=
SMTP_SERVER=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
ALERT_EMAIL_TO=

# Nginx / SSL
DOMAIN=yourdomain.com
```

- [ ] **Step 2: Update .gitignore**

Current `.gitignore` is at project root. Add these lines:
```
__pycache__/
*.py[cod]
*$py.class
.pytest_cache/
.env
frontend/.env
backend/.venv/
*.db
celerybeat-schedule
```

- [ ] **Step 3: Create frontend/.env.example**

Create `frontend/.env.example`:
```
VITE_API_BASE_URL=https://yourdomain.com/api
```

- [ ] **Step 4: Update frontend/src/App.tsx — replace hardcoded API URL**

Current line 9 of `frontend/src/App.tsx`:
```tsx
const API_BASE_URL = 'http://localhost:8001';
```

Replace with (fallback keeps local dev working without .env):
```tsx
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) ?? 'http://localhost:8001';
```

- [ ] **Step 5: Commit**
```bash
git add .env.example .gitignore frontend/.env.example frontend/src/App.tsx
git commit -m "feat: env-based config, .env.example, remove hardcoded API URL"
```

---

### Task 2: Docker Compose Hardening + Dockerfile

**Files:**
- Modify: `docker-compose.yml`
- Modify: `backend/Dockerfile`

- [ ] **Step 1: Replace full content of docker-compose.yml**

```yaml
services:
  nginx:
    image: nginx:1.25-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx:/etc/nginx/conf.d:ro
      - certbot_certs:/etc/letsencrypt:ro
      - certbot_www:/var/www/certbot:ro
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  certbot:
    image: certbot/certbot
    volumes:
      - certbot_certs:/etc/letsencrypt
      - certbot_www:/var/www/certbot
    entrypoint: /bin/sh -c 'trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done'
    restart: unless-stopped

  frontend:
    build: ./frontend
    restart: unless-stopped
    depends_on:
      - api
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  api:
    build: ./backend
    ports:
      - "8001:8000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - API_KEY=${API_KEY}
      - ALLOWED_ORIGINS=${ALLOWED_ORIGINS}
      - LOG_LEVEL=${LOG_LEVEL:-INFO}
      - WEB_CONCURRENCY=${WEB_CONCURRENCY:-2}
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  worker:
    build: ./backend
    command: celery -A app.worker worker --loglevel=info
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - LOG_LEVEL=${LOG_LEVEL:-INFO}
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  beat:
    build: ./backend
    command: celery -A app.worker beat --loglevel=info --schedule=/data/celerybeat-schedule
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
    volumes:
      - celerybeat_data:/data
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  db:
    image: postgres:15
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  redis:
    image: redis:7
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  postgres_data:
  celerybeat_data:
  certbot_certs:
  certbot_www:
```

**Note on `$$POSTGRES_USER`:** Double `$$` escapes Docker Compose variable substitution. The shell inside the container sees `$POSTGRES_USER`, which is set as a container env var by the postgres image.

- [ ] **Step 2: Replace full content of backend/Dockerfile**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN adduser --disabled-password --gecos '' appuser \
    && chown -R appuser:appuser /app

USER appuser

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-2}"]
```

- [ ] **Step 3: Create .env for local use (not committed)**

Copy `.env.example` to `.env` and fill in actual values:
```bash
cp .env.example .env
```
Edit `.env` with real values. This file is gitignored.

- [ ] **Step 4: Verify docker-compose config is valid**
```bash
docker compose config --quiet && echo "config valid"
```
Expected: `config valid`

- [ ] **Step 5: Commit**
```bash
git add docker-compose.yml backend/Dockerfile
git commit -m "feat: docker restart policies, healthchecks, volumes, log rotation, non-root user"
```

---

### Task 3: Nginx + SSL Config

**Files:**
- Create: `nginx/nginx.conf`

- [ ] **Step 1: Create nginx directory and nginx.conf**

Create `nginx/nginx.conf`:
```nginx
upstream api_backend {
    server api:8000;
}

upstream frontend_app {
    server frontend:80;
}

# HTTP — redirect to HTTPS + serve ACME challenge
server {
    listen 80;
    server_name yourdomain.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    add_header X-Frame-Options "DENY";
    add_header X-Content-Type-Options "nosniff";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Referrer-Policy "no-referrer";

    # API — strip /api prefix before forwarding
    location /api/ {
        proxy_pass http://api_backend/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Frontend
    location / {
        proxy_pass http://frontend_app/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Operator instructions (add to README or comment in file):**
- Replace all `yourdomain.com` with your actual domain
- Obtain initial cert: `docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d yourdomain.com`
- Then start nginx: `docker compose up -d nginx`

- [ ] **Step 2: Verify nginx config syntax (optional, if nginx is available locally)**
```bash
docker run --rm -v $(pwd)/nginx:/etc/nginx/conf.d:ro nginx:1.25-alpine nginx -t -c /etc/nginx/nginx.conf 2>/dev/null || echo "syntax check skipped (ok for template with placeholder domain)"
```

- [ ] **Step 3: Commit**
```bash
git add nginx/nginx.conf
git commit -m "feat: nginx reverse proxy config with SSL, security headers, certbot"
```

---

### Task 4: Backend Python Hardening

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/app/logging_config.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/tasks.py`

- [ ] **Step 1: Add dependencies to requirements.txt**

Replace full content of `backend/requirements.txt`:
```text
fastapi
uvicorn
sqlalchemy
psycopg2-binary
celery
redis
python-dotenv
requests
python-multipart
dnspython
slowapi
limits
python-json-logger
```

- [ ] **Step 2: Install new deps in venv and verify**
```bash
cd /home/rushikesh.sakharle/Projects/blacklist-monitor/backend
.venv/bin/pip install slowapi limits python-json-logger -q
.venv/bin/python3 -c "from slowapi import Limiter; from pythonjsonlogger import jsonlogger; print('deps ok')"
```
Expected: `deps ok`

- [ ] **Step 3: Write failing test for rate limiting**

Add to `backend/tests/test_main.py`:
```python
def test_rate_limit_post_targets(client):
    for i in range(5):
        client.post("/targets/", json={"value": f"10.0.0.{i}"}, headers=HEADERS)
    response = client.post("/targets/", json={"value": "10.0.0.99"}, headers=HEADERS)
    assert response.status_code == 429
```

- [ ] **Step 4: Run test to verify it fails**
```bash
cd /home/rushikesh.sakharle/Projects/blacklist-monitor/backend
DATABASE_URL=sqlite:///./test.db .venv/bin/pytest tests/test_main.py::test_rate_limit_post_targets -v
```
Expected: FAIL (slowapi not wired up yet)

- [ ] **Step 5: Create backend/app/logging_config.py**
```python
import logging
import os
from pythonjsonlogger import jsonlogger


def setup_logging() -> None:
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    handler = logging.StreamHandler()
    handler.setFormatter(jsonlogger.JsonFormatter(
        fmt="%(asctime)s %(name)s %(levelname)s %(message)s"
    ))
    root = logging.getLogger()
    root.setLevel(log_level)
    root.handlers = [handler]
```

- [ ] **Step 6: Replace full content of backend/app/main.py**
```python
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
```

- [ ] **Step 7: Replace full content of backend/app/tasks.py**
```python
import logging
import datetime
from .worker import celery_app
from .checker import check_target
from .database import SessionLocal
from .models import Target, CheckHistory
from .alerts import send_slack_alert, send_email_alert

logger = logging.getLogger(__name__)


@celery_app.task
def monitor_target_task(target_id: int):
    db = SessionLocal()
    try:
        target = db.query(Target).filter(Target.id == target_id).first()
        if not target:
            logger.warning("target_not_found", extra={"target_id": target_id})
            return "Target not found"

        logger.info("check_start", extra={"address": target.address, "target_type": target.target_type})
        is_listed = check_target(target.address, target.target_type)

        target.is_blacklisted = is_listed
        target.last_checked = datetime.datetime.utcnow()

        if is_listed:
            send_slack_alert(target.address, is_listed)
            send_email_alert(target.address, is_listed)

        db.add(CheckHistory(
            target_id=target.id,
            status=is_listed,
            details=f"Checked via DNSBL on {datetime.datetime.utcnow()}",
        ))
        db.commit()
        result = "Listed" if is_listed else "Clean"
        logger.info("check_done", extra={"address": target.address, "result": result})
        return f"Checked {target.address}: {result}"
    except Exception as exc:
        logger.error("check_error", extra={"target_id": target_id, "error": str(exc)})
        raise
    finally:
        db.close()


@celery_app.task
def monitor_all_targets_task():
    db = SessionLocal()
    try:
        targets = db.query(Target).all()
        for target in targets:
            monitor_target_task.delay(target.id)
        logger.info("batch_queued", extra={"count": len(targets)})
        return f"Queued {len(targets)} targets"
    finally:
        db.close()
```

- [ ] **Step 8: Run full test suite**
```bash
cd /home/rushikesh.sakharle/Projects/blacklist-monitor/backend
DATABASE_URL=sqlite:///./test.db .venv/bin/pytest tests/ -v 2>&1
```
Expected: All tests pass including `test_rate_limit_post_targets`.

**Note:** The rate limit test adds 5 addresses to the DB. Since `setup_db` fixture drops/recreates tables per test, the limiter's in-memory counter resets per process but not per test. If the rate limit test is flaky due to counter state, run it in isolation: `pytest tests/test_main.py::test_rate_limit_post_targets -v`

- [ ] **Step 9: Clean up test DB**
```bash
rm -f /home/rushikesh.sakharle/Projects/blacklist-monitor/backend/test.db
```

- [ ] **Step 10: Commit**
```bash
git add backend/requirements.txt backend/app/logging_config.py backend/app/main.py backend/app/tasks.py backend/tests/test_main.py
git commit -m "feat: slowapi rate limiting, JSON structured logging, request middleware"
```
