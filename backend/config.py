"""Application settings read from environment variables."""

import logging
import os


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


# Path to the DuckDB file.
DB_PATH = os.getenv(
    "CDC_DB_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "cdc_surveillance.duckdb"),
)

# Agent model setting: "gemini-flash-lite" or "ollama-local".
AGENT_MODEL = os.getenv("AGENT_MODEL", "gemini-flash-lite")
GEMINI_MODEL_ID = os.getenv("GEMINI_MODEL_ID", "gemini-flash-lite-latest")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
OLLAMA_AGENT_MODEL = os.getenv("OLLAMA_AGENT_MODEL", "qwen2.5:7b")

# Data older than this many days is flagged as stale by the agent.
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


def configure_logging() -> None:
    logging.basicConfig(
        level=LOG_LEVEL,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
