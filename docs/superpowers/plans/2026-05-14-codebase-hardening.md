# Codebase Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 9 high/medium priority issues: broken beat schedule, dual schema management, unbounded history growth, plaintext API keys, blocking alert dispatch, blocking subnet scan, small API bugs, org lookup caching, and Docker infrastructure gaps.

**Architecture:** Each task is independently mergeable. Tasks 1–3 are highest priority (broken behavior or silent disk killer). Tasks 4–6 improve security/reliability. Tasks 7–8 improve performance. Task 9 fixes Docker. Tests are included in each task.

**Tech Stack:** FastAPI, Celery 5, SQLAlchemy 2, Alembic, Redis (redis-py), PostgreSQL, Docker Compose, pytest

---

## File Map

| File | Change |
|------|--------|
| `backend/app/worker.py` | Add `beat_schedule` config |
| `backend/app/tasks.py` | Add `prune_old_history_task`, `dispatch_alerts_task`, `scan_subnet_task`; patch `monitor_target_task`, `monitor_all_targets_task` |
| `backend/app/redis_client.py` | **New** — shared Redis client (removes circular import risk) |
| `backend/app/main.py` | Remove `create_all`; remove `_rclient`; remove `threading.Thread` scan; add history limit param; add Pydantic model for bulk-delete; fix `asyncio.get_running_loop()` |
| `backend/app/models.py` | Add `onupdate` to `AppSetting.updated_at` |
| `backend/app/auth.py` | Add `_hash_api_key()`; switch `get_current_user` to look up by `api_key_hash` |
| `backend/alembic/versions/007_hash_api_keys.py` | **New** — add `api_key_hash` indexed column, backfill SHA-256 hashes |
| `backend/app/checker.py` | Add Redis-backed cache to `lookup_org` |
| `backend/Dockerfile` | Prepend `alembic upgrade head &&` to CMD |
| `docker-compose.yml` | Remove api port 8001; fix beat schedule path to named volume |
| `backend/tests/test_main.py` | New tests: history limit, bulk-delete validation |
| `backend/tests/test_tasks.py` | New tests: pruning task, dispatch_alerts_task |

---

## Task 1: Celery Beat Schedule + History Pruning Task

**Files:**
- Modify: `backend/app/worker.py`
- Modify: `backend/app/tasks.py`
- Test: `backend/tests/test_tasks.py`

The beat service currently starts but does nothing — no schedule is defined. The `monitor_all_targets_task` will now run every 30 minutes. A new `prune_old_history_task` will run daily and delete `CheckHistory` records older than 90 days (configurable via env var `HISTORY_RETENTION_DAYS`).

- [ ] **Step 1: Write failing test for prune task**

```python
# backend/tests/test_tasks.py — append this test
import datetime
from app.tasks import prune_old_history_task
from app.models import Target, CheckHistory

def test_prune_old_history_deletes_old_records(db):
    target = Target(address="9.9.9.9", target_type="ip")
    db.add(target)
    db.commit()
    db.refresh(target)

    old_ts = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=100)
    recent_ts = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=10)

    db.add(CheckHistory(target_id=target.id, status=False, details="old", checked_at=old_ts))
    db.add(CheckHistory(target_id=target.id, status=False, details="recent", checked_at=recent_ts))
    db.commit()

    result = prune_old_history_task(days=90)
    assert "1" in result
    remaining = db.query(CheckHistory).filter(CheckHistory.target_id == target.id).all()
    assert len(remaining) == 1
    assert remaining[0].details == "recent"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && .venv/bin/pytest tests/test_tasks.py::test_prune_old_history_deletes_old_records -v
```
Expected: `FAILED` — `cannot import name 'prune_old_history_task'`

- [ ] **Step 3: Add `prune_old_history_task` to tasks.py**

Open `backend/app/tasks.py`. After the `monitor_all_targets_task` function, append:

```python
import os as _os

@celery_app.task
def prune_old_history_task(days: int | None = None):
    """Delete CheckHistory records older than `days` days (default: HISTORY_RETENTION_DAYS env var, fallback 90)."""
    if days is None:
        days = int(_os.getenv("HISTORY_RETENTION_DAYS", "90"))
    db = SessionLocal()
    try:
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
        deleted = (
            db.query(CheckHistory)
            .filter(CheckHistory.checked_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        logger.info("history_pruned", extra={"deleted": deleted, "cutoff": cutoff.isoformat()})
        return f"Pruned {deleted} old check history records"
    finally:
        db.close()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && .venv/bin/pytest tests/test_tasks.py::test_prune_old_history_deletes_old_records -v
```
Expected: `PASSED`

- [ ] **Step 5: Add beat schedule to worker.py**

Replace entire `backend/app/worker.py` with:

```python
import os
from celery import Celery

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
celery_app = Celery('tasks', broker=REDIS_URL, backend=REDIS_URL, include=['app.tasks'])

celery_app.conf.timezone = "UTC"
celery_app.conf.beat_schedule = {
    "monitor-all-targets-every-30-minutes": {
        "task": "app.tasks.monitor_all_targets_task",
        "schedule": 1800.0,
    },
    "prune-old-check-history-daily": {
        "task": "app.tasks.prune_old_history_task",
        "schedule": 86400.0,
    },
}
```

- [ ] **Step 6: Verify beat schedule is loadable**

```bash
cd backend && .venv/bin/celery -A app.worker inspect scheduled 2>&1 | head -5
# Should not error — "Error: No nodes replied" is fine (worker not running)
```

- [ ] **Step 7: Run full test suite to check for regressions**

```bash
cd backend && .venv/bin/pytest tests/ -v --tb=short 2>&1 | tail -20
```
Expected: all previously passing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/worker.py backend/app/tasks.py backend/tests/test_tasks.py
git commit -m "feat: add Celery beat schedule (30-min monitor, daily history prune)"
```

---

## Task 2: Remove Dual Schema Management — Alembic Only

**Files:**
- Modify: `backend/app/main.py` (remove `create_all`)
- Modify: `backend/Dockerfile` (prepend `alembic upgrade head`)

`models.Base.metadata.create_all(bind=database.engine)` at startup bypasses Alembic and can silently diverge from migration history. Remove it; Alembic runs before uvicorn starts.

- [ ] **Step 1: Remove `create_all` from main.py**

In `backend/app/main.py`, find and delete this line (line 27):
```python
models.Base.metadata.create_all(bind=database.engine)
```

- [ ] **Step 2: Update Dockerfile CMD**

In `backend/Dockerfile`, change the last line from:
```dockerfile
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-2}"]
```
to:
```dockerfile
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-2}"]
```

- [ ] **Step 3: Verify app still imports cleanly**

```bash
cd backend && DATABASE_URL=sqlite:///./test.db .venv/bin/python -c "from app.main import app; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Run tests**

```bash
cd backend && .venv/bin/pytest tests/ -v --tb=short 2>&1 | tail -20
```
Expected: all tests pass (tests use their own SQLite DB, not affected by this change).

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/Dockerfile
git commit -m "fix: remove create_all — Alembic is sole schema owner; run upgrade at startup"
```

---

## Task 3: Hash API Keys (SHA-256)

**Files:**
- Create: `backend/alembic/versions/007_hash_api_keys.py`
- Modify: `backend/app/auth.py`
- Modify: `backend/app/models.py`
- Test: `backend/tests/test_main.py`

API keys are stored as plaintext. Add an indexed `api_key_hash` column (SHA-256 of the key). Auth lookups use the hash; the plaintext column remains for display on login. SHA-256 is correct here — bcrypt is for low-entropy passwords; API keys are high-entropy random strings.

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_main.py`:

```python
def test_login_returns_api_key_and_auth_works(client):
    """After login, returned key must authenticate subsequent requests."""
    # Setup first user
    client.post("/setup", json={"email": "hash@test.com", "password": "password123"})
    resp = client.post("/auth/login", json={"email": "hash@test.com", "password": "password123"})
    assert resp.status_code == 200
    key = resp.json()["api_key"]
    # Key must work for auth
    r = client.get("/targets/", headers={"X-API-Key": key})
    assert r.status_code == 200
```

- [ ] **Step 2: Run test to verify it passes already (baseline)**

```bash
cd backend && .venv/bin/pytest tests/test_main.py::test_login_returns_api_key_and_auth_works -v
```
Expected: `PASSED` (baseline — verifying this still passes after we change auth).

- [ ] **Step 3: Create migration 007**

Create `backend/alembic/versions/007_hash_api_keys.py`:

```python
"""Add api_key_hash column with SHA-256 hashes of existing keys

Revision ID: 007
Revises: 006
Create Date: 2026-05-14
"""
import hashlib
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '007'
down_revision = '006'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('admin_users', sa.Column('api_key_hash', sa.String(64), nullable=True))
    op.create_index('ix_admin_users_api_key_hash', 'admin_users', ['api_key_hash'], unique=True)

    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, api_key FROM admin_users")).fetchall()
    for row in rows:
        key_hash = hashlib.sha256(row.api_key.encode()).hexdigest()
        conn.execute(
            text("UPDATE admin_users SET api_key_hash = :h WHERE id = :id"),
            {"h": key_hash, "id": row.id},
        )


def downgrade():
    op.drop_index('ix_admin_users_api_key_hash', table_name='admin_users')
    op.drop_column('admin_users', 'api_key_hash')
```

- [ ] **Step 4: Add `api_key_hash` to AdminUser model**

In `backend/app/models.py`, inside `AdminUser`, add after the `api_key` line:

```python
api_key_hash = Column(String(64), nullable=True, unique=True, index=True)
```

- [ ] **Step 5: Add `_hash_api_key` and update `get_current_user` in auth.py**

In `backend/app/auth.py`, after the imports add:

```python
import hashlib

def _hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()
```

Replace the `get_current_user` function body:

```python
def get_current_user(
    key: str = Security(api_key_header),
    db: Session = Depends(get_db),
) -> models.AdminUser:
    key_hash = _hash_api_key(key)
    user = (
        db.query(models.AdminUser)
        .filter(models.AdminUser.api_key_hash == key_hash, models.AdminUser.is_active == True)
        .first()
    )
    if user:
        return user
    # Fallback: plaintext match for rows not yet backfilled (e.g. fresh test DBs)
    user = (
        db.query(models.AdminUser)
        .filter(models.AdminUser.api_key == key, models.AdminUser.is_active == True)
        .first()
    )
    if user and user.api_key_hash is None:
        user.api_key_hash = key_hash
        db.commit()
        return user
    if _ENV_API_KEY and key == _ENV_API_KEY:
        count = db.query(models.AdminUser).count()
        if count == 0:
            raise HTTPException(status_code=400, detail="Complete setup at /setup first")
    raise HTTPException(status_code=401, detail="Invalid or inactive API key")
```

- [ ] **Step 6: Update `setup` endpoint to store hash on creation**

In `backend/app/main.py`, in the `setup` function, find:
```python
admin = models.AdminUser(
    email=email, hashed_password=hashed, api_key=api_key,
```
Replace with:
```python
from .auth import _hash_api_key
admin = models.AdminUser(
    email=email, hashed_password=hashed, api_key=api_key,
    api_key_hash=_hash_api_key(api_key),
```

- [ ] **Step 7: Run tests**

```bash
cd backend && .venv/bin/pytest tests/test_main.py -v --tb=short 2>&1 | tail -30
```
Expected: all tests pass including `test_login_returns_api_key_and_auth_works`.

- [ ] **Step 8: Commit**

```bash
git add backend/alembic/versions/007_hash_api_keys.py backend/app/models.py backend/app/auth.py backend/app/main.py backend/tests/test_main.py
git commit -m "feat: hash API keys with SHA-256 — indexed lookup, plaintext kept for display"
```

---

## Task 4: Async Alert Dispatch (Non-Blocking Celery Task)

**Files:**
- Modify: `backend/app/tasks.py`
- Test: `backend/tests/test_tasks.py`

`send_alerts()` is called synchronously inside `monitor_target_task`, blocking the Celery worker slot for the duration of Slack/SMTP calls. Move it to a dedicated `dispatch_alerts_task` with its own retry budget.

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_tasks.py`:

```python
from unittest.mock import patch, MagicMock
from app.tasks import dispatch_alerts_task

def test_dispatch_alerts_task_calls_send_alerts(db):
    with patch("app.tasks.send_alerts") as mock_send:
        mock_send.return_value = ["slack"]
        result = dispatch_alerts_task("1.2.3.4", True, False)
        mock_send.assert_called_once_with("1.2.3.4", True, False, db=None)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && .venv/bin/pytest tests/test_tasks.py::test_dispatch_alerts_task_calls_send_alerts -v
```
Expected: `FAILED` — `cannot import name 'dispatch_alerts_task'`

- [ ] **Step 3: Add `dispatch_alerts_task` to tasks.py**

In `backend/app/tasks.py`, append after `prune_old_history_task`:

```python
@celery_app.task(bind=True, max_retries=3, default_retry_delay=30,
                 soft_time_limit=60, time_limit=90)
def dispatch_alerts_task(self, target_address: str, to_status: bool, from_status):
    try:
        send_alerts(target_address, to_status, from_status, db=None)
    except Exception as exc:
        raise self.retry(exc=exc, countdown=30)
```

- [ ] **Step 4: Replace direct `send_alerts` call in `monitor_target_task`**

In `backend/app/tasks.py`, inside `monitor_target_task`, find:
```python
        if is_listed != previous_state or target.last_checked is None:
            send_alerts(target.address, is_listed, previous_state if target.last_checked else None, db=db)
```
Replace with:
```python
        if is_listed != previous_state or target.last_checked is None:
            dispatch_alerts_task.delay(
                target.address,
                is_listed,
                previous_state if target.last_checked else None,
            )
```

Note: also remove `from .alerts import send_alerts` from the import only if it's no longer used elsewhere. It IS still used by `dispatch_alerts_task`, so keep the import.

- [ ] **Step 5: Run tests**

```bash
cd backend && .venv/bin/pytest tests/test_tasks.py -v --tb=short 2>&1 | tail -20
```
Expected: all tasks tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/tasks.py backend/tests/test_tasks.py
git commit -m "feat: dispatch alerts as separate Celery task — non-blocking, retriable"
```

---

## Task 5: Subnet Scan via Celery (Remove `threading.Thread`)

**Files:**
- Create: `backend/app/redis_client.py`
- Modify: `backend/app/tasks.py`
- Modify: `backend/app/main.py`

`scan_subnet_start` spawns a daemon `threading.Thread` inside a uvicorn worker — no backpressure, no cancellation, no Celery retry. Extract to a Celery task. The Redis progress pattern is preserved.

A shared `redis_client.py` module is required to avoid circular imports between `main.py` and `tasks.py`.

- [ ] **Step 1: Create `redis_client.py`**

Create `backend/app/redis_client.py`:

```python
import os
import redis

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
rclient = redis.Redis.from_url(REDIS_URL, decode_responses=True)
```

- [ ] **Step 2: Add `scan_subnet_task` to tasks.py**

In `backend/app/tasks.py`, add to the top-level imports:
```python
import ipaddress as _ipaddress
```
(remove the inner `import ipaddress as _ipaddress` inside `monitor_target_task`)

Then append the new task:

```python
@celery_app.task(bind=True, soft_time_limit=600, time_limit=700)
def scan_subnet_task(self, scan_id: str, cidr: str):
    """DNSBL-check all IPs in subnet; write incremental progress to Redis."""
    from .redis_client import rclient
    from .checker import check_dnsbl, lookup_org, COMMON_DNSBLS
    from concurrent.futures import ThreadPoolExecutor, as_completed as asc
    import json

    net = _ipaddress.ip_network(cidr, strict=False)
    ips = [str(ip) for ip in net.hosts()] or [str(net.network_address)]
    total = len(ips)
    TTL = 3600
    workers = min(total, 32)
    subnet_org = lookup_org(str(net.network_address))

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(check_dnsbl, ip): ip for ip in ips}
        try:
            for future in asc(futures, timeout=max(300, total * 2)):
                ip = futures[future]
                try:
                    hits = future.result()
                except Exception:
                    hits = []
                rclient.rpush(f"scan:{scan_id}:results", json.dumps({
                    "ip": ip, "hits": hits, "is_blacklisted": bool(hits),
                    "total_checked": len(COMMON_DNSBLS),
                    "org": subnet_org,
                }))
                rclient.expire(f"scan:{scan_id}:results", TTL)
                rclient.incr(f"scan:{scan_id}:done")
        except Exception:
            pass

    rclient.setex(f"scan:{scan_id}:info", TTL, json.dumps({"cidr": cidr, "total": total, "complete": True}))
```

- [ ] **Step 3: Update `main.py` — replace `threading.Thread` scan with Celery dispatch**

In `backend/app/main.py`:

**a)** Remove the module-level Redis client block:
```python
_REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
import redis as _redis_lib
_rclient = _redis_lib.Redis.from_url(_REDIS_URL, decode_responses=True)
```
Replace with:
```python
from .redis_client import rclient as _rclient
```

**b)** Remove the `threading` import from the top (it will no longer be needed).

**c)** Replace the entire body of `scan_subnet_start` with:

```python
@app.post("/scan/subnet", dependencies=[Depends(require("scan:run"))])
@limiter.limit("5/minute")
def scan_subnet_start(request: Request, body: SubnetScanRequest):
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

    tasks.scan_subnet_task.delay(scan_id, str(net))
    return {"scan_id": scan_id, "cidr": str(net), "total": total}
```

- [ ] **Step 4: Verify import chain**

```bash
cd backend && DATABASE_URL=sqlite:///./test.db .venv/bin/python -c "from app.main import app; print('OK')"
```
Expected: `OK`

- [ ] **Step 5: Run tests**

```bash
cd backend && .venv/bin/pytest tests/ -v --tb=short 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/redis_client.py backend/app/tasks.py backend/app/main.py
git commit -m "refactor: move subnet scan from threading.Thread to Celery task; extract shared Redis client"
```

---

## Task 6: Batch `monitor_all_targets_task` with `yield_per`

**Files:**
- Modify: `backend/app/tasks.py`

`db.query(Target).all()` loads all targets into memory. With many targets this exhausts RAM. Use `yield_per(100)` to stream in batches.

- [ ] **Step 1: Replace `.all()` with `.yield_per(100)` in `monitor_all_targets_task`**

In `backend/app/tasks.py`, replace the `monitor_all_targets_task` function body:

```python
@celery_app.task
def monitor_all_targets_task():
    db = SessionLocal()
    try:
        count = 0
        for target in db.query(Target).yield_per(100):
            monitor_target_task.delay(target.id)
            count += 1
        logger.info("batch_queued", extra={"count": count})
        return f"Queued {count} targets"
    finally:
        db.close()
```

- [ ] **Step 2: Run tests**

```bash
cd backend && .venv/bin/pytest tests/ -v --tb=short 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/app/tasks.py
git commit -m "perf: batch monitor_all_targets_task with yield_per(100) — avoids full table load"
```

---

## Task 7: Small API Fixes Bundle

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/app/models.py`
- Test: `backend/tests/test_main.py`

Four small fixes in one commit:
1. `asyncio.get_event_loop()` → `asyncio.get_running_loop()` (deprecated since Python 3.10)
2. `AppSetting.updated_at` missing `onupdate`
3. `/targets/{id}/history` needs a `limit` query param
4. `bulk_delete_targets` body should be a Pydantic model, not raw `dict`

- [ ] **Step 1: Write failing test for history limit**

Append to `backend/tests/test_main.py`:

```python
def test_get_history_respects_limit(client, db):
    target = Target(address="7.7.7.7", target_type="ip")
    db.add(target)
    db.commit()
    db.refresh(target)
    for i in range(5):
        db.add(CheckHistory(target_id=target.id, status=False, details=f"record-{i}"))
    db.commit()

    resp = client.get(f"/targets/{target.id}/history?limit=3", headers=HEADERS)
    assert resp.status_code == 200
    assert len(resp.json()) == 3
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && .venv/bin/pytest tests/test_main.py::test_get_history_respects_limit -v
```
Expected: `FAILED` — returns 5 records, not 3.

- [ ] **Step 3: Fix `get_target_history` in main.py**

Find the `get_target_history` function. Change its signature and query:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && .venv/bin/pytest tests/test_main.py::test_get_history_respects_limit -v
```
Expected: `PASSED`

- [ ] **Step 5: Add Pydantic model for bulk-delete and fix the endpoint**

In `backend/app/main.py`, add after the existing Pydantic models (e.g., after `BlacklistHitsResponse`):

```python
class BulkDeleteRequest(BaseModel):
    ids: list[int]
```

Replace the `bulk_delete_targets` function signature:

```python
@app.post("/targets/bulk-delete", dependencies=[Depends(require("targets:delete"))])
@limiter.limit("10/minute")
def bulk_delete_targets(request: Request, body: BulkDeleteRequest, db: Session = Depends(get_db)):
    if not body.ids:
        raise HTTPException(status_code=422, detail="ids array required")
    db.query(models.CheckHistory).filter(models.CheckHistory.target_id.in_(body.ids)).delete(synchronize_session=False)
    deleted = db.query(models.Target).filter(models.Target.id.in_(body.ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}
```

- [ ] **Step 6: Fix `asyncio.get_event_loop()` in the WebSocket handler**

In `backend/app/main.py`, inside the `problems_websocket` function, find:
```python
            data = await asyncio.get_event_loop().run_in_executor(None, get_listed_payload)
```
Replace with:
```python
            data = await asyncio.get_running_loop().run_in_executor(None, get_listed_payload)
```

- [ ] **Step 7: Fix `AppSetting.updated_at` in models.py**

In `backend/app/models.py`, find the `AppSetting` class. Change:
```python
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
```
to:
```python
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

- [ ] **Step 8: Run all tests**

```bash
cd backend && .venv/bin/pytest tests/ -v --tb=short 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add backend/app/main.py backend/app/models.py backend/tests/test_main.py
git commit -m "fix: history limit param, bulk-delete Pydantic model, asyncio.get_running_loop(), AppSetting onupdate"
```

---

## Task 8: Redis Cache for `lookup_org`

**Files:**
- Modify: `backend/app/checker.py`

`lookup_org` makes RDAP + DNS calls on every new target. Org data changes rarely. Cache results in Redis with 24-hour TTL. Empty string sentinel handles "no org found" to avoid repeated misses.

- [ ] **Step 1: Update `lookup_org` in checker.py**

Find `lookup_org`. Wrap it with Redis cache:

```python
_ORG_CACHE_TTL = 86400  # 24 hours

def lookup_org(ip: str) -> str | None:
    """Return registered owner/org for an IPv4 address. Results cached in Redis for 24h."""
    try:
        addr = ipaddress.ip_address(ip)
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            return None
    except Exception:
        return None

    cache_key = f"org:{ip}"
    try:
        from .redis_client import rclient
        cached = rclient.get(cache_key)
        if cached is not None:
            return cached or None  # empty string sentinel → None
    except Exception:
        pass

    result: str | None = None
    try:
        from ipwhois import IPWhois
        rdap = IPWhois(ip).lookup_rdap(depth=0, retry_count=1)
        remarks = rdap.get("network", {}).get("remarks") or []
        for rem in remarks:
            if rem.get("title") == "description" and rem.get("description"):
                first_line = rem["description"].split("\n")[0].strip()
                if first_line and len(first_line) > 2:
                    result = first_line[:100]
                    break
        if not result:
            asn_desc = rdap.get("asn_description", "") or ""
            if asn_desc:
                if " - " in asn_desc:
                    asn_desc = asn_desc.split(" - ", 1)[1]
                if "," in asn_desc:
                    asn_desc = asn_desc.rsplit(",", 1)[0].strip()
                if asn_desc and len(asn_desc) > 2:
                    result = asn_desc[:100]
    except Exception:
        pass

    if not result:
        result = _cymru_asn_name(ip)

    try:
        from .redis_client import rclient
        rclient.setex(cache_key, _ORG_CACHE_TTL, result or "")
    except Exception:
        pass

    return result
```

- [ ] **Step 2: Verify import works**

```bash
cd backend && DATABASE_URL=sqlite:///./test.db .venv/bin/python -c "from app.checker import lookup_org; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Run tests**

```bash
cd backend && .venv/bin/pytest tests/ -v --tb=short 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/app/checker.py
git commit -m "perf: cache lookup_org results in Redis (24h TTL) — avoids repeated RDAP/DNS calls"
```

---

## Task 9: Docker Infrastructure Fixes

**Files:**
- Modify: `docker-compose.yml`

Three fixes:
1. Remove `api` service port 8001 — nginx proxies it; direct exposure bypasses TLS and nginx rate-limiting
2. Fix `beat` schedule file path from `/tmp` (lost on container restart) to a named volume
3. Add `celerybeat_data` named volume

- [ ] **Step 1: Edit `docker-compose.yml`**

**a)** In the `api` service, remove:
```yaml
    ports:
      - "8001:8000"
```

**b)** In the `beat` service, change:
```yaml
    command: celery -A app.worker beat --loglevel=info --schedule=/tmp/celerybeat-schedule
```
to:
```yaml
    command: celery -A app.worker beat --loglevel=info --schedule=/data/celerybeat-schedule
    volumes:
      - celerybeat_data:/data
```

**c)** In the `volumes:` section at the bottom, add:
```yaml
  celerybeat_data:
```

- [ ] **Step 2: Verify compose config parses**

```bash
docker compose config --quiet 2>&1 | head -5
```
Expected: no errors (empty output is fine).

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "fix: remove api direct port exposure; persist celery beat schedule in named volume"
```

---

## Self-Review

**Spec coverage:**

| Improvement | Task |
|-------------|------|
| Broken beat schedule | Task 1 |
| History pruning | Task 1 |
| Remove `create_all` | Task 2 |
| API key hashing | Task 3 |
| send_alerts async | Task 4 |
| Subnet scan → Celery | Task 5 |
| `monitor_all_targets` batching | Task 6 |
| asyncio deprecation | Task 7 |
| AppSetting `onupdate` | Task 7 |
| History limit param | Task 7 |
| bulk-delete Pydantic | Task 7 |
| org caching | Task 8 |
| Docker port exposure | Task 9 |
| Beat schedule path | Task 9 |

**Omitted (lower priority, requires deeper discussion):**
- WebSocket key in query param — architectural tradeoff, no clean solution without breaking WS browser clients
- DNS `_check_one` caching — checks run at most every 30 min; TTL-aware lru_cache adds complexity for marginal gain
- Test coverage expansion — significant but each task adds tests for its own behavior; broader coverage can be a separate task

**Placeholder scan:** None found — all steps include actual code.

**Type consistency:** `dispatch_alerts_task` signature `(target_address: str, to_status: bool, from_status)` — `from_status` is `bool | None` at call site. Celery serializes this as JSON; `None` serializes correctly. No issue.
