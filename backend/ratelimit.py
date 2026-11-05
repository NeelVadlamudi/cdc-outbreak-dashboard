"""Per-IP rate limits and daily caps for the endpoints that call the model.

Persistence backends (RATE_LIMIT_BACKEND):
- sqlite (default): file at RATE_LIMIT_DB (default data/ratelimits.sqlite) — survives
  restarts on a single Render instance without paid Redis.
- memory: in-process only (tests / local).
- redis: optional when REDIS_URL is set and the redis package is installed.
"""

from __future__ import annotations

import math
import os
import sqlite3
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import HTTPException, Request


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def enabled() -> bool:
    """On unless RATE_LIMITS_ENABLED is false (the nightly eval and local eval runs turn it off)."""
    return os.getenv("RATE_LIMITS_ENABLED", "true").strip().lower() not in ("0", "false", "no")


def client_ip(request: Request) -> str:
    """The caller's IP. Render sits behind Cloudflare, which sets CF-Connecting-IP and overwrites any client value."""
    ip = request.headers.get("cf-connecting-ip") or request.headers.get("true-client-ip")
    if not ip:
        xff = request.headers.get("x-forwarded-for", "")
        ip = xff.split(",")[-1].strip() if xff else ""
    return ip or (request.client.host if request.client else "unknown")


class MemoryStore:
    def __init__(self):
        self._hits: dict[tuple[str, str, int], deque] = defaultdict(deque)
        self._day: dict[str, tuple[str, int]] = {}
        self._lock = threading.Lock()

    def reset(self):
        with self._lock:
            self._hits.clear()
            self._day.clear()

    def hit(self, bucket: str, ip: str, per_minute: int, per_day: int, global_per_day: int,
            now: float | None = None) -> tuple[bool, int, str]:
        now = time.time() if now is None else now
        today = time.strftime("%Y-%m-%d", time.gmtime(now))
        with self._lock:
            windows = ((60, per_minute, "minute"), (86400, per_day, "day"))
            for span, limit, label in windows:
                q = self._hits[(bucket, ip, span)]
                while q and q[0] <= now - span:
                    q.popleft()
                if limit > 0 and len(q) >= limit:
                    return False, max(1, math.ceil(q[0] + span - now)), label
            day, count = self._day.get(bucket, (today, 0))
            if day != today:
                count = 0
            if global_per_day > 0 and count >= global_per_day:
                tomorrow = (math.floor(now / 86400) + 1) * 86400
                return False, max(1, math.ceil(tomorrow - now)), "global"
            for span, _, _ in windows:
                self._hits[(bucket, ip, span)].append(now)
            self._day[bucket] = (today, count + 1)
            return True, 0, ""


class SqliteStore:
    """File-backed counters for a single instance without Redis."""

    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._connect() as con:
            con.executescript(
                """
                CREATE TABLE IF NOT EXISTS hits (
                  bucket TEXT NOT NULL,
                  ip TEXT NOT NULL,
                  span INTEGER NOT NULL,
                  ts REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS hits_idx ON hits(bucket, ip, span, ts);
                CREATE TABLE IF NOT EXISTS day_counts (
                  bucket TEXT PRIMARY KEY,
                  day TEXT NOT NULL,
                  count INTEGER NOT NULL
                );
                """
            )

    def _connect(self):
        return sqlite3.connect(self.path, timeout=5, check_same_thread=False)

    def reset(self):
        with self._lock, self._connect() as con:
            con.execute("DELETE FROM hits")
            con.execute("DELETE FROM day_counts")

    def hit(self, bucket: str, ip: str, per_minute: int, per_day: int, global_per_day: int,
            now: float | None = None) -> tuple[bool, int, str]:
        now = time.time() if now is None else now
        today = time.strftime("%Y-%m-%d", time.gmtime(now))
        with self._lock, self._connect() as con:
            windows = ((60, per_minute, "minute"), (86400, per_day, "day"))
            for span, limit, label in windows:
                con.execute(
                    "DELETE FROM hits WHERE bucket=? AND ip=? AND span=? AND ts<=?",
                    (bucket, ip, span, now - span),
                )
                row = con.execute(
                    "SELECT COUNT(*), MIN(ts) FROM hits WHERE bucket=? AND ip=? AND span=?",
                    (bucket, ip, span),
                ).fetchone()
                count, oldest = row[0], row[1]
                if limit > 0 and count >= limit:
                    return False, max(1, math.ceil((oldest or now) + span - now)), label
            day_row = con.execute(
                "SELECT day, count FROM day_counts WHERE bucket=?", (bucket,)
            ).fetchone()
            day, gcount = (day_row if day_row else (today, 0))
            if day != today:
                gcount = 0
            if global_per_day > 0 and gcount >= global_per_day:
                tomorrow = (math.floor(now / 86400) + 1) * 86400
                return False, max(1, math.ceil(tomorrow - now)), "global"
            for span, _, _ in windows:
                con.execute(
                    "INSERT INTO hits(bucket, ip, span, ts) VALUES (?,?,?,?)",
                    (bucket, ip, span, now),
                )
            con.execute(
                "INSERT INTO day_counts(bucket, day, count) VALUES (?,?,?) "
                "ON CONFLICT(bucket) DO UPDATE SET day=excluded.day, count=excluded.count",
                (bucket, today, gcount + 1),
            )
            return True, 0, ""


class RedisStore:
    """Optional Redis when REDIS_URL is set and the redis package is installed."""

    def __init__(self, url: str):
        import redis  # optional

        self.r = redis.Redis.from_url(url, decode_responses=True)
        self._lock = threading.Lock()

    def reset(self):
        pass

    def hit(self, bucket: str, ip: str, per_minute: int, per_day: int, global_per_day: int,
            now: float | None = None) -> tuple[bool, int, str]:
        now = time.time() if now is None else now
        today = time.strftime("%Y-%m-%d", time.gmtime(now))
        with self._lock:
            for span, limit, label, key in (
                (60, per_minute, "minute", f"rl:{bucket}:{ip}:m"),
                (86400, per_day, "day", f"rl:{bucket}:{ip}:d"),
            ):
                if limit <= 0:
                    continue
                pipe = self.r.pipeline()
                pipe.zremrangebyscore(key, 0, now - span)
                pipe.zcard(key)
                pipe.zrange(key, 0, 0, withscores=True)
                _, count, oldest = pipe.execute()
                if count >= limit:
                    oldest_ts = oldest[0][1] if oldest else now
                    return False, max(1, math.ceil(oldest_ts + span - now)), label
            gkey = f"rl:{bucket}:global:{today}"
            gcount = int(self.r.get(gkey) or 0)
            if global_per_day > 0 and gcount >= global_per_day:
                tomorrow = (math.floor(now / 86400) + 1) * 86400
                return False, max(1, math.ceil(tomorrow - now)), "global"
            for span, _limit, _label, key in (
                (60, per_minute, "minute", f"rl:{bucket}:{ip}:m"),
                (86400, per_day, "day", f"rl:{bucket}:{ip}:d"),
            ):
                self.r.zadd(key, {f"{now}": now})
                self.r.expire(key, span + 1)
            self.r.incr(gkey)
            self.r.expire(gkey, 86400 + 60)
            return True, 0, ""


def build_store(backend: str | None = None):
    backend = (backend or os.getenv("RATE_LIMIT_BACKEND") or "sqlite").strip().lower()
    if backend == "memory":
        return MemoryStore()
    if backend == "redis":
        url = os.getenv("REDIS_URL", "").strip()
        if not url:
            raise RuntimeError("RATE_LIMIT_BACKEND=redis requires REDIS_URL")
        try:
            return RedisStore(url)
        except ImportError as e:
            raise RuntimeError("redis package not installed; use RATE_LIMIT_BACKEND=sqlite") from e
    path = os.getenv("RATE_LIMIT_DB", str(Path("data") / "ratelimits.sqlite"))
    return SqliteStore(path)


class Limiter:
    def __init__(self, store=None):
        self.store = store if store is not None else build_store()

    def reset(self):
        self.store.reset()

    def hit(self, bucket: str, ip: str, per_minute: int, per_day: int, global_per_day: int,
            now: float | None = None) -> tuple[bool, int, str]:
        return self.store.hit(bucket, ip, per_minute, per_day, global_per_day, now=now)


# Default for import-time: memory under pytest, otherwise sqlite (or RATE_LIMIT_BACKEND).
_default_backend = "memory" if os.getenv("PYTEST_CURRENT_TEST") or os.getenv("RATE_LIMIT_BACKEND") == "memory" else None
limiter = Limiter(build_store(_default_backend or os.getenv("RATE_LIMIT_BACKEND") or "sqlite"))

LIMITS = {
    "ask": (_int("RATE_ASK_PER_MIN", 6), _int("RATE_ASK_PER_DAY", 60), _int("RATE_ASK_GLOBAL_PER_DAY", 800)),
    "brief": (_int("RATE_BRIEF_PER_MIN", 10), _int("RATE_BRIEF_PER_DAY", 100), _int("RATE_BRIEF_GLOBAL_PER_DAY", 1000)),
    # Monte Carlo is CPU-bound; keep public demo abuse bounded.
    "sim": (_int("RATE_SIM_PER_MIN", 4), _int("RATE_SIM_PER_DAY", 40), _int("RATE_SIM_GLOBAL_PER_DAY", 400)),
}

MESSAGES = {
    "minute": "Too many requests from this address. Try again in {s} s.",
    "day": "This address has reached today's limit for the demo. Try again tomorrow.",
    "global": "The demo has reached its daily limit. Try again tomorrow.",
}


def limited(bucket: str):
    """FastAPI dependency: 429 with Retry-After when the caller is over the limit for this bucket."""
    def dep(request: Request):
        ip = client_ip(request)
        if not enabled():
            return
        ok, retry, reason = limiter.hit(bucket, ip, *LIMITS[bucket])
        if not ok:
            raise HTTPException(429, MESSAGES[reason].format(s=retry), headers={"Retry-After": str(retry)})
    return dep
