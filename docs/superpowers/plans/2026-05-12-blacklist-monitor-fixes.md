# Blacklist Monitor Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 gaps in the blacklist monitor: missing dependency, CORS bug, domain DNSBL support, periodic scheduling, history API endpoint, and API key authentication.

**Architecture:** All backend changes are in the existing FastAPI/Celery/SQLAlchemy stack. Domain checking resolves IPs then reuses existing DNSBL logic. Celery beat drives periodic re-checks. API key auth uses FastAPI's `APIKeyHeader` security utility. Frontend stores the API key in `localStorage` and attaches it as `X-API-Key` on every axios request.

**Tech Stack:** Python 3 (FastAPI, Celery, SQLAlchemy, SQLite for tests), React + TypeScript + axios

---

### Task 1: Dependencies & CORS Config

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/main.py`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add missing dependencies to requirements.txt**

Replace the full content of `backend/requirements.txt`:
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
```

- [ ] **Step 2: Fix CORS to read from env var**

Replace the CORS block in `backend/app/main.py` (lines 13–19):
```python
_origins_env = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8080")
origins = [o.strip() for o in _origins_env.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- [ ] **Step 3: Add env vars to docker-compose.yml api service**

Add `API_KEY` and `ALLOWED_ORIGINS` to the `api` service environment block in `docker-compose.yml`:
```yaml
services:
  frontend:
    build: ./frontend
    ports:
      - "8080:80"
    depends_on:
      - api
  api:
    build: ./backend
    ports:
      - "8001:8000"
    environment:
      - DATABASE_URL=postgresql://user:password@db:5432/blacklist_db
      - REDIS_URL=redis://redis:6379/0
      - API_KEY=changeme
      - ALLOWED_ORIGINS=http://localhost:8080,http://localhost:3000
    depends_on:
      - db
      - redis
  worker:
    build: ./backend
    command: celery -A app.worker worker --loglevel=info
    environment:
      - DATABASE_URL=postgresql://user:password@db:5432/blacklist_db
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - redis
      - db
  db:
    image: postgres:15
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=blacklist_db
  redis:
    image: redis:7
```
(Beat service is added in Task 4.)

- [ ] **Step 4: Commit**
```bash
git add backend/requirements.txt backend/app/main.py docker-compose.yml
git commit -m "fix: add missing requests dep, env-var CORS origins, docker env vars"
```

---

### Task 2: Domain Checking in checker.py

**Files:**
- Modify: `backend/app/checker.py`
- Modify: `backend/tests/test_checker.py`

- [ ] **Step 1: Write failing tests for check_target**

Replace the full content of `backend/tests/test_checker.py`:
```python
import socket
from unittest.mock import patch
from app.checker import check_dnsbl, check_target

def test_check_dnsbl_clean():
    assert check_dnsbl("127.0.0.1") == False

def test_check_target_ip_delegates_to_check_dnsbl():
    with patch("app.checker.check_dnsbl", return_value=False) as mock:
        result = check_target("1.2.3.4", "ip")
        assert result == False
        mock.assert_called_once_with("1.2.3.4")

def test_check_target_domain_resolves_and_checks_each_ip():
    with patch("app.checker.socket.gethostbyname_ex") as mock_resolve:
        mock_resolve.return_value = ("example.com", [], ["1.2.3.4", "5.6.7.8"])
        with patch("app.checker.check_dnsbl", return_value=False) as mock_dnsbl:
            result = check_target("example.com", "domain")
            assert result == False
            assert mock_dnsbl.call_count == 2

def test_check_target_domain_listed_if_any_ip_listed():
    with patch("app.checker.socket.gethostbyname_ex") as mock_resolve:
        mock_resolve.return_value = ("spam.example.com", [], ["1.2.3.4"])
        with patch("app.checker.check_dnsbl", return_value=True):
            assert check_target("spam.example.com", "domain") == True

def test_check_target_domain_resolution_failure_returns_false():
    with patch("app.checker.socket.gethostbyname_ex", side_effect=socket.gaierror):
        assert check_target("nonexistent.invalid", "domain") == False
```

- [ ] **Step 2: Run tests to verify they fail**
```bash
cd /home/rushikesh.sakharle/Projects/blacklist-monitor/backend
DATABASE_URL=sqlite:///./test.db pytest tests/test_checker.py -v
```
Expected: `check_target` tests FAIL with `ImportError` or `AttributeError`.

- [ ] **Step 3: Implement check_target in checker.py**

Replace the full content of `backend/app/checker.py`:
```python
import socket

COMMON_DNSBLS = ["zen.spamhaus.org", "bl.spamcop.net"]

def check_dnsbl(ip: str) -> bool:
    try:
        reversed_ip = ".".join(reversed(ip.split(".")))
    except Exception:
        return False
    for dnsbl in COMMON_DNSBLS:
        try:
            socket.gethostbyname(f"{reversed_ip}.{dnsbl}")
            return True
        except socket.gaierror:
            continue
        except Exception:
            continue
    return False

def check_target(address: str, target_type: str) -> bool:
    if target_type == "ip":
        return check_dnsbl(address)
    try:
        _, _, ips = socket.gethostbyname_ex(address)
    except socket.gaierror:
        return False
    return any(check_dnsbl(ip) for ip in ips)
```

- [ ] **Step 4: Run tests to verify they pass**
```bash
cd /home/rushikesh.sakharle/Projects/blacklist-monitor/backend
DATABASE_URL=sqlite:///./test.db pytest tests/test_checker.py -v
```
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/app/checker.py backend/tests/test_checker.py
git commit -m "feat: add check_target with domain IP resolution for DNSBL"
```

---

### Task 3: Update tasks.py to use check_target + add monitor_all_targets_task

**Files:**
- Modify: `backend/app/tasks.py`

- [ ] **Step 1: Replace full content of backend/app/tasks.py**
```python
from .worker import celery_app
from .checker import check_target
from .database import SessionLocal
from .models import Target, CheckHistory
from .alerts import send_slack_alert, send_email_alert
import datetime

@celery_app.task
def monitor_target_task(target_id: int):
    db = SessionLocal()
    try:
        target = db.query(Target).filter(Target.id == target_id).first()
        if not target:
            return "Target not found"

        is_listed = check_target(target.address, target.target_type)

        target.is_blacklisted = is_listed
        target.last_checked = datetime.datetime.utcnow()

        if is_listed:
            send_slack_alert(target.address, is_listed)
            send_email_alert(target.address, is_listed)

        history = CheckHistory(
            target_id=target.id,
            status=is_listed,
            details=f"Checked via DNSBL on {datetime.datetime.utcnow()}"
        )
        db.add(history)
        db.commit()
        return f"Checked {target.address}: {'Listed' if is_listed else 'Clean'}"
    finally:
        db.close()

@celery_app.task
def monitor_all_targets_task():
    db = SessionLocal()
    try:
        targets = db.query(Target).all()
        for target in targets:
            monitor_target_task.delay(target.id)
        return f"Queued {len(targets)} targets"
    finally:
        db.close()
```

- [ ] **Step 2: Commit**
```bash
git add backend/app/tasks.py
git commit -m "feat: use check_target in task, add monitor_all_targets_task"
```

---

### Task 4: Celery Beat Scheduling

**Files:**
- Modify: `backend/app/worker.py`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add beat_schedule to worker.py**

Replace the full content of `backend/app/worker.py`:
```python
import os
from celery import Celery

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
celery_app = Celery('tasks', broker=REDIS_URL, backend=REDIS_URL)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    beat_schedule={
        'monitor-all-targets-every-30-minutes': {
            'task': 'app.tasks.monitor_all_targets_task',
            'schedule': 1800.0,
        },
    },
)
```

- [ ] **Step 2: Add beat service to docker-compose.yml**

Add the `beat` service block to `docker-compose.yml` (after the `worker` service):
```yaml
  beat:
    build: ./backend
    command: celery -A app.worker beat --loglevel=info
    environment:
      - DATABASE_URL=postgresql://user:password@db:5432/blacklist_db
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - redis
      - db
```

Full `docker-compose.yml` after this change:
```yaml
services:
  frontend:
    build: ./frontend
    ports:
      - "8080:80"
    depends_on:
      - api
  api:
    build: ./backend
    ports:
      - "8001:8000"
    environment:
      - DATABASE_URL=postgresql://user:password@db:5432/blacklist_db
      - REDIS_URL=redis://redis:6379/0
      - API_KEY=changeme
      - ALLOWED_ORIGINS=http://localhost:8080,http://localhost:3000
    depends_on:
      - db
      - redis
  worker:
    build: ./backend
    command: celery -A app.worker worker --loglevel=info
    environment:
      - DATABASE_URL=postgresql://user:password@db:5432/blacklist_db
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - redis
      - db
  beat:
    build: ./backend
    command: celery -A app.worker beat --loglevel=info
    environment:
      - DATABASE_URL=postgresql://user:password@db:5432/blacklist_db
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - redis
      - db
  db:
    image: postgres:15
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=blacklist_db
  redis:
    image: redis:7
```

- [ ] **Step 3: Commit**
```bash
git add backend/app/worker.py docker-compose.yml
git commit -m "feat: add celery beat schedule, 30-min periodic monitoring"
```

---

### Task 5: History Endpoint + API Key Auth (Backend)

**Files:**
- Modify: `backend/app/main.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_main.py`

- [ ] **Step 1: Create test conftest for SQLite + API key override**

Create `backend/tests/conftest.py`:
```python
import os
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["API_KEY"] = "test-key"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app import models
from app.main import app, get_db

engine = create_engine(
    "sqlite:///./test.db",
    connect_args={"check_same_thread": False},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(autouse=True)
def setup_db():
    models.Base.metadata.create_all(bind=engine)
    yield
    models.Base.metadata.drop_all(bind=engine)

@pytest.fixture()
def db(setup_db):
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()

@pytest.fixture()
def client(db):
    def override_get_db():
        yield db
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
```

- [ ] **Step 2: Write failing tests for auth and history**

Create `backend/tests/test_main.py`:
```python
from app.models import Target, CheckHistory
import datetime

HEADERS = {"X-API-Key": "test-key"}

def test_health_requires_no_auth(client):
    assert client.get("/health").status_code == 200

def test_list_targets_requires_auth(client):
    assert client.get("/targets/").status_code == 403

def test_list_targets_wrong_key_returns_401(client):
    assert client.get("/targets/", headers={"X-API-Key": "bad"}).status_code == 401

def test_list_targets_valid_key_returns_200(client):
    assert client.get("/targets/", headers=HEADERS).status_code == 200

def test_get_history_target_not_found(client):
    assert client.get("/targets/999/history", headers=HEADERS).status_code == 404

def test_get_history_returns_records_newest_first(client, db):
    target = Target(address="1.2.3.4", target_type="ip", is_blacklisted=False)
    db.add(target)
    db.commit()
    db.refresh(target)

    t1 = datetime.datetime(2026, 1, 1, 10, 0, 0)
    t2 = datetime.datetime(2026, 1, 1, 11, 0, 0)
    db.add(CheckHistory(target_id=target.id, status=False, details="first", checked_at=t1))
    db.add(CheckHistory(target_id=target.id, status=True, details="second", checked_at=t2))
    db.commit()

    response = client.get(f"/targets/{target.id}/history", headers=HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    assert data[0]["details"] == "second"
    assert data[1]["details"] == "first"
```

- [ ] **Step 3: Run tests to verify they fail**
```bash
cd /home/rushikesh.sakharle/Projects/blacklist-monitor/backend
pytest tests/test_main.py -v
```
Expected: failures related to missing auth dependency and missing history route.

- [ ] **Step 4: Replace full content of backend/app/main.py**
```python
import os
import re
from fastapi import FastAPI, Depends, HTTPException, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session
from pydantic import BaseModel
from . import models, database, tasks

models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="Blacklist Monitor API")

_origins_env = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8080")
origins = [o.strip() for o in _origins_env.split(",")]
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

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/targets/", dependencies=[Depends(verify_api_key)])
def add_target(target: TargetCreate, db: Session = Depends(get_db)):
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
def list_targets(db: Session = Depends(get_db)):
    return db.query(models.Target).all()

@app.delete("/targets/{target_id}", dependencies=[Depends(verify_api_key)])
def delete_target(target_id: int, db: Session = Depends(get_db)):
    target = db.query(models.Target).filter(models.Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    db.delete(target)
    db.commit()
    return {"message": "Target deleted"}

@app.get("/targets/{target_id}/history", dependencies=[Depends(verify_api_key)])
def get_target_history(target_id: int, db: Session = Depends(get_db)):
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

- [ ] **Step 5: Run tests to verify they pass**
```bash
cd /home/rushikesh.sakharle/Projects/blacklist-monitor/backend
pytest tests/test_main.py -v
```
Expected: all 6 tests PASS.

- [ ] **Step 6: Commit**
```bash
git add backend/app/main.py backend/tests/conftest.py backend/tests/test_main.py
git commit -m "feat: API key auth on all routes, GET /targets/{id}/history endpoint"
```

---

### Task 6: Frontend API Key Auth

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Replace full content of frontend/src/App.tsx**
```tsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, ShieldAlert, Activity, RefreshCw } from 'lucide-react';
import Sidebar from './components/Sidebar';
import StatCard from './components/StatCard';
import TargetTable, { Target } from './components/TargetTable';
import AddTargetForm from './components/AddTargetForm';

const API_BASE_URL = 'http://localhost:8001';
const STORAGE_KEY = 'api_key';

function App() {
  const storedKey = localStorage.getItem(STORAGE_KEY) ?? '';
  const [targets, setTargets] = useState<Target[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(storedKey !== '');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (storedKey) {
      axios.defaults.headers.common['X-API-Key'] = storedKey;
    }
  }, []);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401) {
          localStorage.removeItem(STORAGE_KEY);
          delete axios.defaults.headers.common['X-API-Key'];
          setIsLoggedIn(false);
        }
        return Promise.reject(err);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  const fetchTargets = async () => {
    try {
      setIsLoading(true);
      const response = await axios.get(`${API_BASE_URL}/targets/`);
      setTargets(response.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching targets:', err);
      setError('Failed to connect to the monitoring service. Please ensure the backend is running.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      fetchTargets();
      const interval = setInterval(fetchTargets, 30000);
      return () => clearInterval(interval);
    }
  }, [isLoggedIn]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = loginForm.password;
    axios.defaults.headers.common['X-API-Key'] = key;
    try {
      await axios.get(`${API_BASE_URL}/targets/`);
      localStorage.setItem(STORAGE_KEY, key);
      setLoginError(null);
      setIsLoggedIn(true);
    } catch (err: any) {
      delete axios.defaults.headers.common['X-API-Key'];
      setLoginError('Invalid API key. Check your configuration.');
    }
  };

  const handleAddTarget = async (value: string) => {
    try {
      setIsAdding(true);
      await axios.post(`${API_BASE_URL}/targets/`, { value });
      await fetchTargets();
    } catch (err: any) {
      console.error('Error adding target:', err);
      alert(err.response?.data?.detail || 'Failed to add target');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteTarget = async (id: number) => {
    if (!window.confirm('Are you sure you want to remove this asset from monitoring?')) return;
    try {
      await axios.delete(`${API_BASE_URL}/targets/${id}`);
      setTargets(targets.filter(t => t.id !== id));
    } catch (err) {
      console.error('Error deleting target:', err);
      alert('Failed to delete target');
    }
  };

  const blacklistedCount = targets.filter(t => t.is_blacklisted).length;
  const secureCount = targets.length - blacklistedCount;

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl shadow-slate-200/60 border border-slate-100 overflow-hidden">
          <div className="p-8 pb-0 flex flex-col items-center">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center text-white shadow-xl shadow-primary/30 mb-6">
              <Shield size={36} />
            </div>
            <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Welcome back</h1>
            <p className="text-slate-500 mt-2 font-medium">Log in to your Guardly account</p>
          </div>

          <form onSubmit={handleLogin} className="p-8 space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 ml-1">Work Email</label>
              <input
                type="email"
                required
                value={loginForm.email}
                onChange={e => setLoginForm({...loginForm, email: e.target.value})}
                placeholder="name@company.com"
                className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-xl focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 ml-1">API Key</label>
              <input
                type="password"
                required
                value={loginForm.password}
                onChange={e => setLoginForm({...loginForm, password: e.target.value})}
                placeholder="••••••••"
                className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-xl focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all font-medium"
              />
            </div>

            {loginError && (
              <p className="text-sm text-rose-600 font-medium">{loginError}</p>
            )}

            <button
              type="submit"
              className="w-full py-4 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/30 hover:bg-primary/90 transition-all active:scale-[0.98]"
            >
              CONTINUE TO DASHBOARD
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex bg-background min-h-screen text-foreground font-sans">
      <Sidebar />

      <main className="flex-1 p-10 overflow-y-auto">
        <header className="flex justify-between items-start mb-12">
          <div>
            <div className="flex items-center gap-2 text-primary font-bold text-xs tracking-widest uppercase mb-1">
              <Activity size={14} />
              System Status: Optimal
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">Security Overview</h1>
            <p className="text-slate-500 mt-2 font-medium text-lg">Real-time blacklist monitoring and threat detection.</p>
          </div>

          <button
            onClick={fetchTargets}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-white border border-slate-200 shadow-soft hover:shadow-md hover:bg-slate-50 transition-all active:scale-95"
          >
            <RefreshCw size={18} className={`${isLoading ? 'animate-spin' : ''} text-primary`} />
            <span className="text-sm font-bold text-slate-700 uppercase tracking-tight">Refresh Monitor</span>
          </button>
        </header>

        {error && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 px-6 py-4 rounded-2xl mb-10 flex items-center gap-4 shadow-soft">
            <div className="bg-rose-600 text-white p-2 rounded-lg">
              <ShieldAlert size={20} />
            </div>
            <div>
              <p className="font-bold text-sm uppercase tracking-tight">System Connection Error</p>
              <p className="text-sm font-medium opacity-80">{error}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          <StatCard
            label="Monitored Assets"
            value={targets.length}
            icon={Shield}
            trend="Active Monitoring"
            trendType="neutral"
          />
          <StatCard
            label="Blacklist Hits"
            value={blacklistedCount}
            icon={ShieldAlert}
            trend={blacklistedCount > 0 ? "Urgent Action" : "Threat Free"}
            trendType={blacklistedCount > 0 ? "negative" : "positive"}
          />
          <StatCard
            label="Safety Index"
            value={targets.length > 0 ? `${Math.round((secureCount / targets.length) * 100)}%` : '100%'}
            icon={Activity}
            trend={targets.length > 0 ? "Calculated Live" : "Stable"}
            trendType="positive"
          />
        </div>

        <section className="max-w-6xl">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Asset Management</h2>
              <p className="text-slate-400 text-sm font-medium mt-1">Add or remove endpoints from the monitoring queue.</p>
            </div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] bg-slate-100 px-3 py-1.5 rounded-lg">
              Auto-sync: Every 30s
            </div>
          </div>

          <AddTargetForm onAdd={handleAddTarget} isLoading={isAdding} />
          <TargetTable targets={targets} onDelete={handleDeleteTarget} />
        </section>
      </main>
    </div>
  );
}

export default App;
```

- [ ] **Step 2: Commit**
```bash
git add frontend/src/App.tsx
git commit -m "feat: real API key login, localStorage persistence, 401 redirect"
```

---

### Task 7: Run All Tests

- [ ] **Step 1: Run full backend test suite**
```bash
cd /home/rushikesh.sakharle/Projects/blacklist-monitor/backend
DATABASE_URL=sqlite:///./test.db pytest tests/ -v
```
Expected output: all tests pass, no failures.
```
tests/test_checker.py::test_check_dnsbl_clean PASSED
tests/test_checker.py::test_check_target_ip_delegates_to_check_dnsbl PASSED
tests/test_checker.py::test_check_target_domain_resolves_and_checks_each_ip PASSED
tests/test_checker.py::test_check_target_domain_listed_if_any_ip_listed PASSED
tests/test_checker.py::test_check_target_domain_resolution_failure_returns_false PASSED
tests/test_main.py::test_health_requires_no_auth PASSED
tests/test_main.py::test_list_targets_requires_auth PASSED
tests/test_main.py::test_list_targets_wrong_key_returns_401 PASSED
tests/test_main.py::test_list_targets_valid_key_returns_200 PASSED
tests/test_main.py::test_get_history_target_not_found PASSED
tests/test_main.py::test_get_history_returns_records_newest_first PASSED
```

- [ ] **Step 2: Clean up test DB**
```bash
rm -f /home/rushikesh.sakharle/Projects/blacklist-monitor/backend/test.db
```
