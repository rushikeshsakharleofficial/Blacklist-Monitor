# Blacklist Monitor

A self-hosted IP and domain blacklist monitoring service. Continuously checks assets against DNSBL providers (Spamhaus, SpamCop) and alerts via Slack or email when status changes.

## Features

- Add IPs or domains to monitor
- Checks against zen.spamhaus.org and bl.spamcop.net
- Celery workers run checks every 30 minutes
- Slack and email alerts on status change (clean ↔ listed)
- React dashboard with real-time refresh
- API key authentication
- Rate limiting on all endpoints
- JSON structured logging
- Docker Compose deployment

## Architecture

```
Nginx (reverse proxy, TLS)
├── Frontend (React + Vite, port 80)
└── API (FastAPI, port 8000)
      ├── PostgreSQL (database)
      ├── Redis (task queue)
      ├── Celery Worker (DNSBL checks)
      └── Celery Beat (30-min scheduler)
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- A domain name (for production TLS) or use self-signed cert for local dev

### 1. Clone and configure

```bash
git clone <repo-url>
cd blacklist-monitor
cp .env.example .env
```

Edit `.env` with your settings (see [Environment Variables](#environment-variables)).

### 2. Start (development)

```bash
# Uses self-signed TLS cert on port 8444
docker compose up -d
```

Dashboard: https://localhost:8444  
API: http://localhost:8001

### 3. Start (production)

```bash
# Copy nginx prod config
cp nginx/nginx.prod.conf.example nginx/nginx.conf
# Edit DOMAIN in .env, then:
docker compose up -d
# Issue TLS certificate (once nginx is up):
docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d yourdomain.com
docker compose restart nginx
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_USER` | Yes | — | PostgreSQL username |
| `POSTGRES_PASSWORD` | Yes | — | PostgreSQL password (use strong secret) |
| `POSTGRES_DB` | Yes | — | Database name |
| `DATABASE_URL` | Yes | — | Full PostgreSQL DSN |
| `REDIS_URL` | Yes | — | Redis connection URL |
| `API_KEY` | Yes | — | API key for dashboard login (use strong secret) |
| `ALLOWED_ORIGINS` | Yes | — | Comma-separated CORS origins |
| `LOG_LEVEL` | No | `INFO` | Logging level (DEBUG/INFO/WARNING/ERROR) |
| `WEB_CONCURRENCY` | No | `2` | Uvicorn worker processes |
| `SLACK_WEBHOOK_URL` | No | — | Slack incoming webhook URL for alerts |
| `SMTP_SERVER` | No | — | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASSWORD` | No | — | SMTP password |
| `ALERT_EMAIL_TO` | No | — | Recipient email for alerts |
| `DOMAIN` | Yes | `localhost` | Domain name (for nginx and certbot) |
| `HTTP_PORT` | No | `80` | External HTTP port |
| `HTTPS_PORT` | No | `443` | External HTTPS port |
| `ENABLE_DOCS` | No | `false` | Set `true` to expose `/docs` and `/redoc` |

## Development

### Backend (without Docker)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Set env vars
export DATABASE_URL=postgresql://user:password@localhost:5432/blacklist_db
export API_KEY=dev-key
export REDIS_URL=redis://localhost:6379/0

# Run API
uvicorn app.main:app --reload --port 8000

# Run worker (separate terminal)
celery -A app.worker worker --loglevel=info

# Run beat (separate terminal)
celery -A app.worker beat --loglevel=info
```

### Frontend (without Docker)

```bash
cd frontend
npm install
# Copy and edit the frontend env
cp .env.example .env
npm run dev
```

Dev server: http://localhost:3000

### Running Tests

```bash
cd backend
pip install pytest
pytest tests/ -v
```

## API Reference

All endpoints (except `/health`) require `X-API-Key` header.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (no auth) |
| `GET` | `/targets/?skip=0&limit=100` | List monitored assets |
| `POST` | `/targets/` | Add asset (IP or domain) |
| `DELETE` | `/targets/{id}` | Remove asset |
| `GET` | `/targets/{id}/history` | Check history for asset |

**Rate limits:** POST 5/min, GET 60/min, DELETE 30/min

Enable API docs (dev only): set `ENABLE_DOCS=true` and visit `/docs`.

## Production Deployment

### Security checklist

- [ ] Set strong `POSTGRES_PASSWORD` (not `password`)
- [ ] Set strong `API_KEY` (min 32 random chars: `openssl rand -hex 32`)
- [ ] Set `ALLOWED_ORIGINS` to your exact domain
- [ ] Use Let's Encrypt TLS via certbot (see nginx/nginx.prod.conf.example)
- [ ] Do not expose port 8001 (API) publicly — route through nginx
- [ ] Set `ENABLE_DOCS=false` (default) in production
- [ ] Rotate API key periodically

### Schema migrations

The app uses SQLAlchemy `create_all` on startup for initial schema creation. For production schema changes, use the included Alembic setup:

```bash
cd backend
alembic upgrade head
```

## Docker Services

| Service | Purpose |
|---------|---------|
| `nginx` | Reverse proxy, TLS termination |
| `certbot` | Let's Encrypt cert auto-renewal |
| `frontend` | React dashboard (served by nginx) |
| `api` | FastAPI backend |
| `worker` | Celery task executor |
| `beat` | Celery periodic scheduler |
| `db` | PostgreSQL |
| `redis` | Message broker and result backend |

## Troubleshooting

**Dashboard shows "Failed to connect"**  
→ Check the API is running: `docker compose logs api`  
→ Verify `VITE_API_BASE_URL` in `frontend/.env`  

**Alerts not sending**  
→ Verify `SLACK_WEBHOOK_URL` is set in `.env` (worker service picks it up)  
→ Check worker logs: `docker compose logs worker`  

**Rate limit errors (429)**  
→ POST limit is 5/min. Wait 1 minute and retry.  

**Database connection failed**  
→ Ensure `DATABASE_URL` is set in `.env`  
→ `docker compose logs db` to check PostgreSQL health  

**TLS certificate issues (production)**  
→ Ensure port 80 is publicly accessible for ACME challenge  
→ Run: `docker compose run --rm certbot certonly --webroot -w /var/www/certbot -d yourdomain.com`  

## Security Notes

- API key is stored in browser `localStorage`. Keep it strong and rotate regularly.
- The self-signed TLS cert (`nginx/self-signed.crt`) is for local development only. Never use it in production.
- SMTP credentials are passed as environment variables — do not commit `.env` to git.
- Rate limiting is enforced per-IP via slowapi. For additional protection, consider Fail2ban or Cloudflare in front of nginx.

## Known Limitations

- Only two DNSBL providers (Spamhaus, SpamCop). More can be added in `backend/app/checker.py`.
- No pagination on check history endpoint.
- API key is a single shared secret. No multi-user support.
- Alerts fire on state change only (not on every check).
