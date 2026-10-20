"""Per-IP rate limits and daily caps for the endpoints that call the model.

In-memory and per process: the Render free plan runs one instance, and a restart resets the counts,
which is fine for a demo. Limits come from env vars so tests and local runs can change them.
"""

import contextvars
import math
import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

client_ip_var: contextvars.ContextVar[str] = contextvars.ContextVar("client_ip", default="unknown")


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


class Limiter:
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
        """Record one call. Returns (allowed, retry_after_s, reason)."""
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


limiter = Limiter()

# bucket: (per IP per minute, per IP per day, all callers per day)
LIMITS = {
    "ask": (_int("RATE_ASK_PER_MIN", 6), _int("RATE_ASK_PER_DAY", 60), _int("RATE_ASK_GLOBAL_PER_DAY", 800)),
    "mirage": (_int("RATE_MIRAGE_PER_MIN", 4), _int("RATE_MIRAGE_PER_DAY", 30), _int("RATE_MIRAGE_GLOBAL_PER_DAY", 300)),
    "brief": (_int("RATE_BRIEF_PER_MIN", 10), _int("RATE_BRIEF_PER_DAY", 100), _int("RATE_BRIEF_GLOBAL_PER_DAY", 1000)),
    "proposal": (_int("RATE_PROPOSAL_PER_MIN", 3), _int("RATE_PROPOSAL_PER_DAY", 10), _int("RATE_PROPOSAL_GLOBAL_PER_DAY", 50)),
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
        client_ip_var.set(ip)
        if not enabled():
            return
        ok, retry, reason = limiter.hit(bucket, ip, *LIMITS[bucket])
        if not ok:
            raise HTTPException(429, MESSAGES[reason].format(s=retry), headers={"Retry-After": str(retry)})
    return dep


def allow_proposal() -> tuple[bool, str]:
    """Separate cap on Mirage proposal rows, keyed on the IP of the request that runs the audit."""
    if not enabled():
        return True, ""
    ok, retry, reason = limiter.hit("proposal", client_ip_var.get(), *LIMITS["proposal"])
    return ok, ("" if ok else MESSAGES[reason].format(s=retry))
