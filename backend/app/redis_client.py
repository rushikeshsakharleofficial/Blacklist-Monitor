from __future__ import annotations
import os
import redis

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
rclient = redis.Redis.from_url(REDIS_URL, decode_responses=True)
