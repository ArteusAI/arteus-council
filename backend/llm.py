"""Unified LLM dispatcher for routing requests to different providers."""

import logging
import asyncio
from typing import List, Dict, Any, Optional
from . import openrouter
from . import gigachat_adapter
from . import yandex_adapter

logger = logging.getLogger("llm-council.llm")


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 300.0
) -> Optional[Dict[str, Any]]:
    """
    Query a model using the appropriate provider based on the model identifier.

    Args:
        model: Model identifier (e.g., "openai/gpt-4o" or "gigachat/GigaChat-2-Max")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds

    Returns:
        Response dict with 'content' and optional 'reasoning_details', or None if failed
    """
    if model.startswith("gigachat/"):
        return await gigachat_adapter.query_model(model, messages, timeout)
    elif model.startswith("yandex/"):
        return await yandex_adapter.query_model(model, messages, timeout)
    else:
        # Default to OpenRouter for everything else
        return await openrouter.query_model(model, messages, timeout)


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
