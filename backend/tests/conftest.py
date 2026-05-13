import os
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["API_KEY"] = "test-key"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"

import pytest
from unittest.mock import patch, MagicMock
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

@pytest.fixture(autouse=True)
def mock_celery_delay():
    with patch("app.tasks.monitor_target_task.delay") as mock:
        yield mock


@pytest.fixture(autouse=True)
def reset_limiter():
    """Clear rate limiter counters between tests to prevent test pollution."""
    yield
    try:
        from app.main import limiter
        # slowapi 0.1.x stores limits.MemoryStorage in limiter._storage
        if hasattr(limiter, "_storage") and hasattr(limiter._storage, "_cache"):
            limiter._storage._cache.clear()
    except Exception:
        pass

@pytest.fixture()
def client(db):
    def override_get_db():
        yield db
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
