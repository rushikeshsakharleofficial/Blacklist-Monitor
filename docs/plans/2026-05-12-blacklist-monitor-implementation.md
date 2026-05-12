# Blacklist Monitor Implementation Plan

> **For Gemini:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a professional monitoring dashboard for IP and Domain blacklisting with real-time alerting.

**Architecture:** A FastAPI backend handles requests and schedules checks. Celery with Redis processes async monitoring tasks (DNSBL + APIs). PostgreSQL stores the state, and a React frontend (Tailwind) provides the UI.

**Tech Stack:** Python (FastAPI, Celery, SQLAlchemy/PostgreSQL), Redis, React (Vite, Tailwind CSS), Stitch API for UI components.

---

### Task 1: Project Scaffolding (Backend)

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/app/main.py`
- Create: `backend/Dockerfile`
- Create: `docker-compose.yml`

**Step 1: Define Backend Requirements**
Content:
```text
fastapi
uvicorn
sqlalchemy
psycopg2-binary
celery
redis
python-dotenv
```

**Step 2: Create Basic FastAPI Entry Point**
Content:
```python
from fastapi import FastAPI

app = FastAPI(title="Blacklist Monitor API")

@app.get("/health")
def health_check():
    return {"status": "ok"}
```

**Step 3: Setup Docker Compose**
Content for `docker-compose.yml`:
```yaml
services:
  api:
    build: ./backend
    ports:
      - "8000:8000"
    depends_on:
      - db
      - redis
  worker:
    build: ./backend
    command: celery -A app.worker worker --loglevel=info
    depends_on:
      - redis
      - db
  db:
    image: postgres:15
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: blacklist_db
  redis:
    image: redis:7
```

**Step 4: Commit**
```bash
git add .
git commit -m "chore: initial project scaffolding"
```

---

### Task 2: Monitoring Engine (DNSBL Checker)

**Files:**
- Create: `backend/app/checker.py`
- Test: `backend/tests/test_checker.py`

**Step 1: Write failing test for DNSBL check**
```python
import pytest
from app.checker import check_dnsbl

def test_check_dnsbl_clean():
    # 127.0.0.2 is typically listed on test lists, 127.0.0.1 is clean
    assert check_dnsbl("127.0.0.1") == False
```

**Step 2: Run test to verify it fails**
Run: `pytest backend/tests/test_checker.py`

**Step 3: Implement DNSBL check logic**
```python
import socket

COMMON_DNSBLS = ["zen.spamhaus.org", "bl.spamcop.net"]

def check_dnsbl(ip: str):
    reversed_ip = ".".join(reversed(ip.split(".")))
    for dnsbl in COMMON_DNSBLS:
        try:
            socket.gethostbyname(f"{reversed_ip}.{dnsbl}")
            return True
        except socket.gaierror:
            continue
    return False
```

**Step 4: Verify test passes**
Run: `pytest backend/tests/test_checker.py`

**Step 5: Commit**
```bash
git add backend/app/checker.py backend/tests/test_checker.py
git commit -m "feat: add DNSBL checker logic"
```

---

### Task 3: Database Models & Celery Integration

**Files:**
- Create: `backend/app/models.py`
- Create: `backend/app/worker.py`

**Step 1: Define SQLAlchemy Models**
```python
from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.ext.declarative import declarative_base
import datetime

Base = declarative_base()

class Target(Base):
    __tablename__ = "targets"
    id = Column(Integer, primary_key=True)
    address = Column(String, unique=True) # IP or Domain
    is_blacklisted = Column(Boolean, default=False)
    last_checked = Column(DateTime, default=datetime.datetime.utcnow)
```

**Step 2: Create Celery Worker Task**
```python
from celery import Celery
from .checker import check_dnsbl

celery_app = Celery('tasks', broker='redis://redis:6379/0')

@celery_app.task
def monitor_target_task(target_id: int, address: str):
    is_listed = check_dnsbl(address)
    # Update DB logic here (skipped for brevity in task list)
    return is_listed
```

**Step 3: Commit**
```bash
git add backend/app/models.py backend/app/worker.py
git commit -m "feat: setup database models and celery worker"
```

---

### Task 4: Frontend Implementation (React)

**Files:**
- Create: `frontend/src/App.tsx` (Use Stitch HTML as reference)

**Step 1: Scaffold React Project**
Run: `npm create vite@latest frontend -- --template react-ts`

**Step 2: Port Stitch UI to React Components**
(Porting the generated HTML/CSS from `a7dda067382e42c6b08c1bfdaa6361ee`)

**Step 3: Commit**
```bash
git add frontend/
git commit -m "feat: initial frontend implementation"
```
