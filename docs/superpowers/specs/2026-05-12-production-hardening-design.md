# Production Hardening Design

**Date:** 2026-05-12
**Status:** Approved
**Target:** Single VPS / bare metal, Docker Compose

---

## Goal

Make the blacklist-monitor stack production-ready across four areas: secrets & config, reliability, security, and observability.

---

## Section 1: Secrets & Config

**Problem:** Credentials hardcoded in `docker-compose.yml` (DB password, API key). Frontend has hardcoded `http://localhost:8001`. No `.env.example`.

**Changes:**
- Add `.env.example` listing all required variables with placeholder values
- Add `.env` to `.gitignore`
- `docker-compose.yml`: replace all hardcoded values with `${VAR}` references
- `frontend/src/App.tsx`: replace `const API_BASE_URL = 'http://localhost:8001'` with `const API_BASE_URL = import.meta.env.VITE_API_BASE_URL`
- `frontend/.env.example`: `VITE_API_BASE_URL=https://yourdomain.com/api`
- `frontend/vite.config.ts`: no changes needed (Vite reads `.env` automatically)

**Variables in `.env.example`:**
```
# Database
POSTGRES_USER=user
POSTGRES_PASSWORD=changeme_strong_password
POSTGRES_DB=blacklist_db
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}

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

---

## Section 2: Reliability

**Changes:**

**`docker-compose.yml`:**
- All services: `restart: unless-stopped`
- `db`: add named volume `postgres_data:/var/lib/postgresql/data`
- `beat`: add named volume `celerybeat_data:/app` (persists `celerybeat-schedule` file)
- `db` healthcheck: `pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}` every 10s, 5 retries
- `redis` healthcheck: `redis-cli ping` every 10s, 5 retries
- `api` healthcheck: `curl -f http://localhost:8000/health` every 30s, 3 retries, 10s start_period
- `worker` and `beat`: `depends_on: db: condition: service_healthy, redis: condition: service_healthy`
- Add top-level `volumes:` block: `postgres_data:` and `celerybeat_data:`

**`backend/Dockerfile`:**
- Add non-root user: `RUN adduser --disabled-password appuser && chown -R appuser /app`
- Switch to `USER appuser` before CMD
- Change CMD to `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-2}`

---

## Section 3: Security

**Rate limiting (`slowapi`):**
- Add `slowapi` and `limits` to `requirements.txt`
- `backend/app/main.py`: add `Limiter` from slowapi, attach to app
- `POST /targets/`: `@limiter.limit("5/minute")`
- `GET /targets/`: `@limiter.limit("60/minute")`
- `GET /targets/{id}/history`: `@limiter.limit("60/minute")`
- 429 handler registered on app

**Nginx + Certbot:**
- Add `nginx/` directory with `nginx.conf`
- `nginx.conf`: upstream `api` → `api:8000`, serves frontend static on `/`, proxies `/api/` → `api:8000/`, HTTP→HTTPS redirect, SSL cert paths, security headers:
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `Referrer-Policy: no-referrer`
- `docker-compose.yml`: add `nginx` service (ports 80:80 and 443:443, volumes: `./nginx:/etc/nginx/conf.d`, `certbot_certs:/etc/letsencrypt`, `certbot_www:/var/www/certbot`)
- Add `certbot` service: `certbot/dns` image, `certonly --webroot` command, volume `certbot_certs` and `certbot_www`
- Frontend service: remove port exposure (nginx handles it), keep internal only

---

## Section 4: Observability

**Structured logging:**
- Add `python-json-logger` to `requirements.txt`
- Create `backend/app/logging_config.py`: configure root logger with `JsonFormatter`, log level from `LOG_LEVEL` env var
- `backend/app/main.py`:
  - Call `setup_logging()` at startup
  - Add `@app.middleware("http")` that logs `method`, `path`, `status_code`, `duration_ms` as structured JSON
- `backend/app/tasks.py`: add `logger = logging.getLogger(__name__)`, log task start and result

**Docker log rotation:**
- All services in `docker-compose.yml`: add logging driver:
  ```yaml
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"
  ```

---

## Files Changed

| File | Change |
|------|--------|
| `.env.example` | New — all vars with placeholders |
| `.gitignore` | Add `.env`, `frontend/.env` |
| `docker-compose.yml` | Env vars, restart, healthchecks, volumes, logging, nginx, certbot |
| `nginx/nginx.conf` | New — reverse proxy + SSL + security headers |
| `backend/Dockerfile` | Non-root user, WEB_CONCURRENCY |
| `backend/requirements.txt` | Add slowapi, limits, python-json-logger |
| `backend/app/main.py` | Rate limiting, request logging middleware |
| `backend/app/logging_config.py` | New — JSON logging setup |
| `backend/app/tasks.py` | Structured log calls |
| `frontend/src/App.tsx` | VITE_API_BASE_URL env var |
| `frontend/.env.example` | New — VITE_API_BASE_URL placeholder |
