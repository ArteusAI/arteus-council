"""Configuration for the LLM Council."""

import os
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()


def _parse_csv_env(value: str | None) -> list[str]:
    """Parse a comma-separated env var into a clean list."""
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _normalize_root_path(value: str | None) -> str:
    """Normalize a path prefix such as /council for mounting under subpaths."""
    if not value:
        return ""

    candidate = value.strip()
    if not candidate:
        return ""

    if candidate.startswith(("http://", "https://")):
        parsed = urlparse(candidate)
        candidate = parsed.path or ""

    if not candidate:
        return ""

    if not candidate.startswith("/"):
        candidate = f"/{candidate}"

    candidate = candidate.rstrip("/")
    return "" if candidate == "/" else candidate


# OpenRouter API key
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Council members - list of OpenRouter model identifiers
COUNCIL_MODELS = [
    "openai/gpt-5.1",
    "google/gemini-3-pro-preview",
    "anthropic/claude-opus-4.5",
    "qwen/qwen3-max",
    "x-ai/grok-4",
    "moonshotai/kimi-k2-thinking",
    "deepseek/deepseek-v3.2-speciale",
    "mistralai/mistral-large-2512"
]

# Chairman model - synthesizes final response
CHAIRMAN_MODEL = "google/gemini-3-pro-preview"

# Default preferred models to preselect in the UI
DEFAULT_PREFERRED_MODELS = [
    "openai/gpt-5.1",
    "anthropic/claude-opus-4.5",
    "google/gemini-3-pro-preview"
]

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Allowed browser origins for CORS. Set CORS_ALLOW_ORIGINS in .env as a comma-separated list.
DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://arteus.us",
    "https://api.arteus.us",
]
CORS_ALLOW_ORIGINS = _parse_csv_env(os.getenv("CORS_ALLOW_ORIGINS")) or DEFAULT_CORS_ORIGINS

# Data directory for conversation storage
DATA_DIR = "data/conversations"

# Optional path prefix when serving behind a subpath (e.g. /council)
BACKEND_ROOT_PATH = _normalize_root_path(
    os.getenv("BACKEND_ROOT_PATH")
    or os.getenv("COUNCIL_BASE_PATH")
    or os.getenv("BASE_PATH")
    or os.getenv("BASE_URL")
)

# MongoDB configuration
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://167.235.102.202:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "arteus_ares")

# JWT configuration
JWT_SECRET = os.getenv("JWT_SECRET", "secret")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))

# IP-based authentication bypass
ALLOWED_IPS = _parse_csv_env(os.getenv("ALLOWED_IPS", "45.77.54.76"))
ALLOWED_NETWORKS = _parse_csv_env(os.getenv("ALLOWED_NETWORKS", ""))
