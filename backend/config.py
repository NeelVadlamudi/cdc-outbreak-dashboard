"""Application settings read from environment variables."""

import logging
import os


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


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
