# Blacklist Monitor — Bug Fixes & Feature Completions

**Date:** 2026-05-12
**Status:** Approved

## Goal

Fix 6 identified gaps in the blacklist monitor: two functional bugs, domain DNSBL support, periodic scheduling, history API endpoint, and API key authentication.

---

## Section 1: Trivial Backend Fixes

**`requirements.txt`** — add `requests` (used by `alerts.py` for Slack webhooks, currently missing).

**CORS** — `main.py` reads `ALLOWED_ORIGINS` env var (comma-separated), defaults to `http://localhost:3000,http://localhost:8080`. Removes the hardcoded single-origin bug where docker frontend (port 8080) was blocked.

**`docker-compose.yml`** — add env vars `API_KEY` and `ALLOWED_ORIGINS` to `api` service.

---

## Section 2: Domain Checking

**Problem:** `checker.py` only handles IPs via DNSBL reverse lookup. Domains are accepted as targets but always return clean.

**Fix:** Add `check_target(address: str, target_type: str) -> bool` to `checker.py`:
- `target_type == "ip"`: call existing `check_dnsbl(address)` directly.
- `target_type == "domain"`: call `socket.gethostbyname_ex(address)` to resolve all IPs, run `check_dnsbl` on each. Returns `True` if any resolved IP is listed.
- `tasks.py` switches from `check_dnsbl(target.address)` to `check_target(target.address, target.target_type)`.

---

## Section 3: Periodic Scheduling (Celery Beat)

**Problem:** Tasks only fire on target creation. No periodic re-checking.

**Fix:**
- New task `monitor_all_targets_task` in `tasks.py`: queries all `Target` rows, dispatches `monitor_target_task.delay(t.id)` for each.
- `worker.py` adds `beat_schedule` to `celery_app.conf`: runs `monitor_all_targets_task` every 30 minutes.
- `docker-compose.yml` adds `beat` service: `celery -A app.worker beat --loglevel=info`, depends on `redis` and `db`.

---

## Section 4: History Endpoint + API Key Auth

### History

New route: `GET /targets/{id}/history`
- Returns list of `CheckHistory` records: `{id, status, details, checked_at}`, ordered `checked_at` descending.
- Returns 404 if target not found.

### API Key Auth

**Backend:**
- Add `python-multipart` to `requirements.txt` (FastAPI security dependency).
- `main.py` uses `fastapi.security.APIKeyHeader(name="X-API-Key")`.
- All routes except `GET /health` require the header value to match `API_KEY` env var. Return 401 if missing or wrong.

**Frontend:**
- Login form: email field ignored (cosmetic), password field = API key.
- On login: validate key by calling `GET /health` with `X-API-Key` header (health is unprotected, so try a protected endpoint instead — `GET /targets/`). If 200, store key in `localStorage` and set `axios.defaults.headers.common['X-API-Key']`.
- On app load: if key in `localStorage`, restore it and mark logged in.
- On 401 response: clear stored key, redirect to login.

---

## Files Changed

| File | Change |
|------|--------|
| `backend/requirements.txt` | Add `requests`, `python-multipart` |
| `backend/app/checker.py` | Add `check_target()` with domain resolution |
| `backend/app/tasks.py` | Use `check_target()`, add `monitor_all_targets_task` |
| `backend/app/worker.py` | Add `beat_schedule` (30-min periodic) |
| `backend/app/main.py` | Env-var CORS, API key auth, history endpoint |
| `docker-compose.yml` | Add `beat` service, `API_KEY` + `ALLOWED_ORIGINS` env vars |
| `frontend/src/App.tsx` | Real API key login, axios header, localStorage, 401 handling |
