import os
import re
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is required")

try:
    engine = create_engine(DATABASE_URL)
except Exception as exc:
    safe_url = re.sub(r"://([^:@]+):([^@]+)@", r"://\1:***@", DATABASE_URL)
    raise RuntimeError(f"Failed to create DB engine: {safe_url}") from exc
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
