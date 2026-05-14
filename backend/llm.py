"""Unified LLM dispatcher for routing requests to different providers."""

import logging
import os
import asyncio
from typing import List, Dict, Any, Optional
from . import openrouter
from . import gigachat_adapter
from . import yandex_adapter
from . import agora_adapter

logger = logging.getLogger("llm-council.llm")


def _int_env(name: str, default: int) -> int:
    """Read an int env with fallback, logging invalid values."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("Invalid %s=%r, using default %d", name, raw, default)
        return default


_LLM_MAX_INFLIGHT = max(1, _int_env("LLM_MAX_INFLIGHT", 100))
_OPENROUTER_MAX_INFLIGHT = max(1, _int_env("OPENROUTER_MAX_INFLIGHT", _LLM_MAX_INFLIGHT))
_YANDEX_MAX_INFLIGHT = max(1, _int_env("YANDEX_MAX_INFLIGHT", 16))
_AGORA_MAX_INFLIGHT = max(1, _int_env("AGORA_MAX_INFLIGHT", 16))

_llm_semaphore: Optional[asyncio.Semaphore] = None
_provider_semaphores: Dict[str, Optional[asyncio.Semaphore]] = {
    "openrouter": None,
    "yandex": None,
    "agora": None,
}


def _get_global_semaphore() -> asyncio.Semaphore:
    """Lazily create the global semaphore bound to the running event loop."""
    global _llm_semaphore
    if _llm_semaphore is None:
        _llm_semaphore = asyncio.Semaphore(_LLM_MAX_INFLIGHT)
        logger.info("LLM global semaphore initialized (max_inflight=%d)", _LLM_MAX_INFLIGHT)
    return _llm_semaphore


def _get_provider_semaphore(provider: str, limit: int) -> asyncio.Semaphore:
    """Return a provider-specific semaphore, created lazily."""
    sem = _provider_semaphores.get(provider)
    if sem is None:
        sem = asyncio.Semaphore(limit)
        _provider_semaphores[provider] = sem
    return sem


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 180.0,
    temperature: float = 0.8
) -> Optional[Dict[str, Any]]:
    """
    Query a model using the appropriate provider based on the model identifier.

    Args:
        model: Model identifier (e.g., "openai/gpt-4o" or "gigachat/GigaChat-2-Max")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds
        temperature: Model temperature (0.0-1.0)

    Returns:
        Response dict with 'content' and optional 'reasoning_details', or None if failed
    """
    # GigaChat is already serialized inside the adapter when
    # GIGACHAT_PARALLEL_DISABLED is set, so we skip the global gate for it to
    # avoid double-bottlenecking the rest of the council on the GigaChat lock.
    if model.startswith("gigachat/"):
        return await gigachat_adapter.query_model(model, messages, timeout)

    global_sem = _get_global_semaphore()

    if model.startswith("yandex/"):
        provider_sem = _get_provider_semaphore("yandex", _YANDEX_MAX_INFLIGHT)
        async with global_sem, provider_sem:
            return await yandex_adapter.query_model(model, messages, timeout)

    if model.startswith("agora/"):
        provider_sem = _get_provider_semaphore("agora", _AGORA_MAX_INFLIGHT)
        async with global_sem, provider_sem:
            return await agora_adapter.query_model(model, messages, timeout)

    provider_sem = _get_provider_semaphore("openrouter", _OPENROUTER_MAX_INFLIGHT)
    async with global_sem, provider_sem:
        return await openrouter.query_model(model, messages, timeout, temperature)


async def query_models_parallel(
    models: List[str],
    messages: List[Dict[str, str]],
    on_model_complete: Optional[Any] = None
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple models in parallel, using the appropriate provider for each.

    Args:
        models: List of model identifiers
        messages: List of message dicts to send to each model
        on_model_complete: Optional callback function(model, response) called when each model completes

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    async def _query_and_callback(model):
        response = await query_model(model, messages)
        if on_model_complete:
            if asyncio.iscoroutinefunction(on_model_complete):
                await on_model_complete(model, response)
            else:
                on_model_complete(model, response)
        return response

    # Create tasks for all models
    tasks = [_query_and_callback(model) for model in models]

    # Wait for all to complete
    responses = await asyncio.gather(*tasks)

    # Map models to their responses
    return {model: response for model, response in zip(models, responses)}
