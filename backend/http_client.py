"""Shared async HTTP client singleton with connection pooling.

Reused across OpenRouter, Firecrawl, Yandex and Agora adapters to avoid
per-request TLS handshakes and socket churn under load.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("llm-council.http")


def _int_env(name: str, default: int) -> int:
    """Read an int from env with a fallback."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("Invalid %s=%r, using default %d", name, raw, default)
        return default


_MAX_CONNECTIONS = _int_env("HTTP_MAX_CONNECTIONS", 300)
_MAX_KEEPALIVE = _int_env("HTTP_MAX_KEEPALIVE", 100)
_KEEPALIVE_EXPIRY_SECONDS = _int_env("HTTP_KEEPALIVE_EXPIRY_SECONDS", 60)

_client: Optional[httpx.AsyncClient] = None


def _build_client() -> httpx.AsyncClient:
    """Create a tuned async client with shared connection pool."""
    limits = httpx.Limits(
        max_connections=_MAX_CONNECTIONS,
        max_keepalive_connections=_MAX_KEEPALIVE,
        keepalive_expiry=_KEEPALIVE_EXPIRY_SECONDS,
    )
    timeout = httpx.Timeout(
        connect=10.0,
        read=300.0,
        write=30.0,
        pool=5.0,
    )
    return httpx.AsyncClient(limits=limits, timeout=timeout, follow_redirects=False)


def get_client() -> httpx.AsyncClient:
    """Return the process-wide shared async client.

    Created lazily on first use so that adapters work both inside the FastAPI
    lifespan and from standalone scripts/tests.
    """
    global _client
    if _client is None or _client.is_closed:
        _client = _build_client()
        logger.info(
            "Shared httpx.AsyncClient initialized "
            "(max_connections=%d, max_keepalive=%d)",
            _MAX_CONNECTIONS,
            _MAX_KEEPALIVE,
        )
    return _client


async def startup() -> None:
    """Initialize the shared client at app startup (idempotent)."""
    get_client()


async def shutdown() -> None:
    """Close the shared client gracefully."""
    global _client
    if _client is not None and not _client.is_closed:
        try:
            await _client.aclose()
        finally:
            _client = None
            logger.info("Shared httpx.AsyncClient closed")
