# BlacklistTrailer — DNSBL Monitoring Platform

A self-hosted IP and domain blacklist monitoring platform. Continuously checks assets against 50+ DNSBL providers, alerts via Slack or email on status changes, and provides a full IAM system for multi-user team access.

## Features

- **Monitoring** — Track IPs and domains against 50+ DNSBL zones (Spamhaus, SpamCop, Barracuda, Blocklist.de, UCEProtect, SpamRats, and more)
- **Subnet scanning** — Ad-hoc CIDR scan (/0–/32) with batched queuing and progress tracking; optionally add entire subnet to daily monitoring
- **Bulk expand** — Import all IPs from a CIDR block into monitored assets in one click
- **Real-time dashboard** — WebSocket-powered auto-refresh, stat cards, per-asset blacklist hit detail
- **Alerts** — Slack webhook and SMTP email on clean↔listed state change
- **IAM user management** — Fine-grained permissions, built-in roles, custom role builder, audit log
- **Rate limiting** — Per-IP slowapi limits on all endpoints
- **JSON structured logging** — Production-ready log format
- **Docker Compose** — One-command deployment with nginx, TLS, Celery, Redis, PostgreSQL

## Architecture

```
Nginx (reverse proxy, TLS termination)
├── Frontend  (React + Vite — static, served by nginx)
└── API       (FastAPI, port 8000)
      ├── PostgreSQL  (targets, users, roles, audit log, check history)
      ├── Redis       (Celery broker + subnet scan state)
      ├── Celery Worker  (DNSBL checks, alert dispatch)
      └── Celery Beat    (30-min check scheduler)
```

## Quick Start

### Prerequisites

- Docker and Docker Compose v2
- A domain name (for production TLS) — or use the included self-signed cert for local dev

### 1. Clone and configure

```bash
git clone <repo-url>
cd blacklist-monitor
cp .env.example .env
# Edit .env — set database credentials, Redis URL, CORS origins
```

### 2. Start (development / local)

```bash
docker compose up -d
```

- Dashboard: **http://localhost:8082** (HTTP) or **https://localhost:8444** (HTTPS, self-signed)
- API direct: http://localhost:8001
- First visit redirects to `/setup` to create the admin account

### 3. Start (production)

```bash
# Edit nginx/nginx.conf — set your domain
docker compose up -d

# Issue TLS certificate (once nginx is healthy):
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d yourdomain.com

docker compose restart nginx
```

## First-Time Setup

On a fresh deployment, the app redirects to `/setup` where you create the first admin account (email, password, display name). This account is automatically assigned the `super_admin` role with all permissions.

After setup, log in at `/login`.

## User Management & IAM

BlacklistTrailer uses a fine-grained IAM system similar to cloud provider IAM.

### Built-in Roles

| Role | Description |
|------|-------------|
| `super_admin` | Full access including role assignment |
| `admin` | Full access except assigning roles to users |
| `security_analyst` | Monitor assets, scans, alerts, audit log; read-only settings |
| `operator` | Add/remove targets, run scans, view alerts and reports |
| `viewer` | Read-only dashboard access |

### Permissions

| Permission | Description |
|------------|-------------|
| `targets:read` | View monitored assets |
| `targets:write` | Add new targets |
| `targets:delete` | Remove targets |
| `targets:recheck` | Trigger manual recheck |
| `targets:bulk` | Bulk subnet expand |
| `scan:run` | Run ad-hoc subnet scans |
| `scan:monitor` | Add scan results to monitoring |
| `alerts:read` | View alert history |
| `alerts:configure` | Configure alert channels |
| `reports:read` | View reports |
| `users:read` | View user list |
| `users:write` | Create and edit users |
| `users:delete` | Deactivate users |
| `users:reset_key` | Reset other users' API keys |
| `users:set_role` | Assign roles to users; create/edit custom roles |
| `settings:read` | View system settings |
| `settings:write` | Modify system settings |
| `audit:read` | View audit log |
| `self:password` | Change own password |
| `self:api_key` | View / regenerate own API key |

### Anti-escalation

Users cannot grant permissions they do not themselves hold. Only `super_admin` (with `users:set_role`) can create or modify roles that include permissions beyond the caller's own set.

### Custom Roles

Admins with `users:set_role` can create custom roles via **Administration → Roles → New Role**, selecting any subset of permissions using the permission grid.

### Audit Log

All write actions (create/update/delete user, role change, password reset, API key reset, target add/delete) are recorded in the audit log with actor, action, resource, IP address, and timestamp.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_USER` | Yes | — | PostgreSQL username |
| `POSTGRES_PASSWORD` | Yes | — | PostgreSQL password |
| `POSTGRES_DB` | Yes | — | Database name |
| `DATABASE_URL` | Yes | — | Full PostgreSQL DSN (`postgresql://user:pass@db:5432/dbname`) |
| `REDIS_URL` | Yes | — | Redis connection URL (`redis://redis:6379/0`) |
| `API_KEY` | No | — | Legacy env-var key (pre-setup only — unused after first user created) |
| `ALLOWED_ORIGINS` | Yes | — | Comma-separated CORS origins (e.g. `https://yourdomain.com`) |
| `LOG_LEVEL` | No | `INFO` | `DEBUG` / `INFO` / `WARNING` / `ERROR` |
| `WEB_CONCURRENCY` | No | `2` | Uvicorn worker processes |
| `SLACK_WEBHOOK_URL` | No | — | Slack incoming webhook URL for blacklist alerts |
| `SMTP_SERVER` | No | — | SMTP hostname |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASSWORD` | No | — | SMTP password |
| `ALERT_EMAIL_TO` | No | — | Recipient address for email alerts |
| `DOMAIN` | No | `localhost` | Domain name (used by nginx and certbot) |
| `HTTP_PORT` | No | `80` | External HTTP port |
| `HTTPS_PORT` | No | `443` | External HTTPS port |
| `ENABLE_DOCS` | No | `false` | Set `true` to expose `/docs` and `/redoc` (dev only) |

## API Reference

All endpoints (except `/health`, `/setup-status`, `/setup`) require `X-API-Key` header obtained from login.

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (no auth) |
| `GET` | `/setup-status` | Returns `{needs_setup: bool}` |
| `POST` | `/setup` | Create first admin user (one-time) |
| `POST` | `/auth/login` | Login → returns `api_key`, `email`, `name`, `role`, `permissions[]` |

### Targets

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/targets/` | `targets:read` | List all monitored assets |
| `POST` | `/targets/` | `targets:write` | Add IP or domain |
| `DELETE` | `/targets/{id}` | `targets:delete` | Remove asset |
| `POST` | `/targets/recheck-all` | `targets:recheck` | Force immediate recheck of all assets |
| `POST` | `/targets/subnet-expand` | `targets:bulk` | Bulk-import all IPs from a CIDR block |
| `GET` | `/targets/{id}/history` | `targets:read` | Check history for asset |
| `GET` | `/targets/{id}/blacklist-hits` | `targets:read` | Current blacklist hits detail |

### Subnet Scan

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `POST` | `/scan/subnet` | `scan:run` | Start async CIDR scan |
| `GET` | `/scan/subnet/{scan_id}` | `scan:run` | Poll scan progress and results |

### Users

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/users/me` | any | Current user profile + permissions |
| `PUT` | `/users/me/password` | `self:password` | Change own password |
| `POST` | `/users/me/regenerate-key` | `self:api_key` | Regenerate own API key |
| `GET` | `/users` | `users:read` | List all users |
| `POST` | `/users` | `users:write` | Create user |
| `GET` | `/users/{id}` | `users:read` | Get user |
| `PUT` | `/users/{id}` | `users:write` | Update user (name, email, active status) |
| `PUT` | `/users/{id}/role` | `users:set_role` | Assign role to user |
| `DELETE` | `/users/{id}` | `users:delete` | Deactivate user |
| `POST` | `/users/{id}/reset-api-key` | `users:reset_key` | Reset another user's API key |

### Roles

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/roles` | `users:read` | List roles with permission groups metadata |
| `GET` | `/roles/{id}` | `users:read` | Get role |
| `POST` | `/roles` | `users:set_role` | Create custom role |
| `PUT` | `/roles/{id}` | `users:set_role` | Update custom role |
| `DELETE` | `/roles/{id}` | `users:set_role` | Delete custom role (must have 0 users) |

### Audit Log

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/audit` | `audit:read` | List audit log entries (paginated) |

**Rate limits:** POST 5/min · GET 60/min · DELETE 30/min (per IP)

Enable API docs (dev only): set `ENABLE_DOCS=true` → visit `/docs`

## DNSBL Zones

Checks run concurrently against 50+ zones including:

- **Spamhaus** — zen.spamhaus.org
- **SpamCop** — bl.spamcop.net
- **Barracuda** — b.barracudacentral.org
- **Blocklist.de** — bl.blocklist.de
- **UCEProtect** — dnsbl-1/2/3.uceprotect.net
- **SpamRats** — dyna, noptr, spam.spamrats.com
- **SpamEatingMonkey** — bl + backscatter
- **MailSpike** — bl.mailspike.net, z.mailspike.net
- **DroneBL**, **PSBL**, **NordSpam**, **0spam**, **Nether**, and 30+ more

To add zones, edit `COMMON_DNSBLS` in `backend/app/checker.py`.

## Docker Services

| Service | Purpose |
|---------|---------|
| `nginx` | Reverse proxy, TLS termination, static frontend |
| `certbot` | Let's Encrypt certificate auto-renewal |
| `frontend` | React + Vite build (copied into nginx) |
| `api` | FastAPI application server (2 uvicorn workers) |
| `worker` | Celery task executor (DNSBL checks, alerts) |
| `beat` | Celery periodic scheduler (30-min check cycle) |
| `db` | PostgreSQL 15 |
| `redis` | Celery broker + subnet scan progress state |

## Schema Migrations

The initial schema is created by SQLAlchemy `create_all` on first startup. Subsequent schema changes use Alembic:

```bash
# Apply all pending migrations
docker compose exec api alembic upgrade head

# Check current revision
docker compose exec api alembic current
```

On a fresh database, Alembic is stamped at `head` automatically after `create_all`. On an existing database that pre-dates Alembic, stamp first:

```bash
docker compose exec api alembic stamp 003
```

## Development

### Backend (without Docker)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export DATABASE_URL=postgresql://user:password@localhost:5432/blacklist_db
export REDIS_URL=redis://localhost:6379/0
export ALLOWED_ORIGINS=http://localhost:5173

uvicorn app.main:app --reload --port 8000     # API
celery -A app.worker worker --loglevel=info   # Worker (separate terminal)
celery -A app.worker beat   --loglevel=info   # Beat   (separate terminal)
```

### Frontend (without Docker)

```bash
cd frontend
npm install
echo "VITE_API_BASE_URL=http://localhost:8000" > .env
npm run dev   # http://localhost:5173
```

### Tests

```bash
cd backend
pip install pytest
pytest tests/ -v
```

## Production Security Checklist

- [ ] Strong `POSTGRES_PASSWORD` (min 32 chars: `openssl rand -hex 32`)
- [ ] Strong initial admin password (min 12 chars, mixed)
- [ ] `ALLOWED_ORIGINS` set to exact production domain only
- [ ] Let's Encrypt TLS via certbot (not self-signed)
- [ ] Port 8001 (API) NOT exposed publicly — route through nginx only
- [ ] `ENABLE_DOCS=false` (default)
- [ ] `API_KEY` env var removed after first user is set up via `/setup`
- [ ] Rotate user API keys periodically via **Users → Reset API Key**
- [ ] Review audit log regularly (**Administration → Audit Log**)

## Troubleshooting

**Redirected to `/setup` even though users exist**  
→ Database was wiped or `admin_users` table is empty. Run setup again.

**Dashboard shows "Failed to connect"**  
→ `docker compose logs api` — check for startup errors  
→ Verify `VITE_API_BASE_URL` points to correct API host

**Login returns 401**  
→ Use email + password (not API key) at `/login`  
→ Check user is `is_active=true`

**Alerts not sending**  
→ Set `SLACK_WEBHOOK_URL` or SMTP vars in `.env` (worker service reads them)  
→ `docker compose logs worker`

**Rate limit errors (429)**  
→ POST limit is 5/min per IP — wait 60s and retry

**Subnet scan stuck at 0%**  
→ Check Redis is healthy: `docker compose ps redis`  
→ Check worker logs: `docker compose logs worker`

**nginx unhealthy**  
→ Usually API not yet ready. Wait ~30s and re-check: `docker compose ps`  
→ Force reload: `docker compose exec nginx nginx -s reload`

**Alembic migration errors**  
→ If tables already exist (created by `create_all`): `docker compose exec api alembic stamp head`  
→ Then: `docker compose exec api alembic upgrade head`
