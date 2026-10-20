"""Application settings read from environment variables."""

import contextvars
import json
import logging
import os
from datetime import datetime, timezone


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


# Path to the DuckDB file.
DB_PATH = os.getenv(
    "CDC_DB_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "cdc_surveillance.duckdb"),
)

# Agent model setting: "gemini-flash-lite" or "ollama-local".
AGENT_MODEL = os.getenv("AGENT_MODEL", "gemini-flash-lite")
GEMINI_MODEL_ID = os.getenv("GEMINI_MODEL_ID", "gemini-3.5-flash-lite")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
OLLAMA_AGENT_MODEL = os.getenv("OLLAMA_AGENT_MODEL", "qwen2.5:7b")

# Set to "false" to serve a fixed database (e.g. the eval snapshot) without refreshing it.
INGEST_ON_STARTUP = os.getenv("INGEST_ON_STARTUP", "true").lower() != "false"

# Data older than this many days is flagged as stale by the agent.
BACKTEST_PATH = os.getenv(
    "BACKTEST_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "evals", "results", "backtest.json"),
)
STALE_AFTER_DAYS = int(os.getenv("STALE_AFTER_DAYS", "14"))

# Origins allowed to call the API from a browser (comma-separated).
ALLOWED_ORIGINS = _split_csv(os.getenv("ALLOWED_ORIGINS", "http://localhost:5173"))

# Key required in the X-API-Key header for the model training endpoints.
# When unset, the training endpoints are disabled.
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "")

# Ollama model used by the chat endpoint.
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral")

# Log level name, e.g. DEBUG, INFO, WARNING.
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()


LOG_FORMAT = os.getenv("LOG_FORMAT", "json").lower()  # "json" (one object per line) or "text"

# Set per request by the middleware in backend/main.py; included in every JSON log line.
request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)

_STD_ATTRS = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    """One JSON object per line: ts, level, logger, msg, request_id, plus any `extra=` fields."""

    def format(self, record: logging.LogRecord) -> str:
        out = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        rid = request_id_var.get()
        if rid:
            out["request_id"] = rid
        for k, v in record.__dict__.items():
            if k not in _STD_ATTRS and not k.startswith("_"):
                out[k] = v
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    if LOG_FORMAT == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(LOG_LEVEL)

# Serve /docs, /redoc and /openapi.json. render.yaml sets this to false for the public API.
ENABLE_API_DOCS = os.getenv("ENABLE_API_DOCS", "true").strip().lower() in ("1", "true", "yes")
