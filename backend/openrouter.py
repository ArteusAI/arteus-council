"""OpenRouter API client for making LLM requests."""

import httpx
import time
import logging
from typing import List, Dict, Any, Optional
from .config import (
    MODEL_QUERY_TIMEOUT_SECONDS,
    OPENROUTER_API_KEY,
    OPENROUTER_API_URL,
    OPENROUTER_REASONING_EFFORT,
)

logger = logging.getLogger("llm-council.openrouter")


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = MODEL_QUERY_TIMEOUT_SECONDS,
    reasoning_effort: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Query a single model via OpenRouter API with maximum reasoning effort.

    Args:
        model: OpenRouter model identifier (e.g., "openai/gpt-4o")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds
        reasoning_effort: Override for the reasoning effort level
            ("max", "xhigh", "high", "medium", "low", "minimal", "none").
            Defaults to OPENROUTER_REASONING_EFFORT from config.

    Returns:
        Response dict with 'content' and optional 'reasoning_details', or None if failed
    """
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "temperature": 0.8,
        "messages": messages,
        "reasoning": {
            "effort": reasoning_effort or OPENROUTER_REASONING_EFFORT
        }
    }

    start_time = time.time()
    short_model = model.split('/')[-1] if '/' in model else model
    
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                OPENROUTER_API_URL,
                headers=headers,
                json=payload
            )
            response.raise_for_status()

            data = response.json()
            choices = data.get('choices', [])
            if not choices:
                logger.error(f"[{short_model}] No choices in response: {data}")
                return None

            message = choices[0]['message']

            duration = time.time() - start_time
            content = message.get('content') or ''
            # Extract reasoning - OpenRouter can return it in different fields
            reasoning = message.get('reasoning') or message.get('reasoning_content') or message.get('reasoning_details') or ''

            # Extract token usage and cost from OpenRouter response
            raw_usage = data.get('usage') or {}
            completion_details = raw_usage.get('completion_tokens_details') or {}
            usage = {
                'prompt_tokens': raw_usage.get('prompt_tokens', 0),
                'completion_tokens': raw_usage.get('completion_tokens', 0),
                'total_tokens': raw_usage.get('total_tokens', 0),
                'reasoning_tokens': completion_details.get('reasoning_tokens', 0),
                'cost': raw_usage.get('cost') or 0.0,
            }

            logger.info(
                f"[{short_model}] OK in {duration:.1f}s, "
                f"response_len={len(content)}, reasoning_len={len(reasoning)}, "
                f"tokens={usage['total_tokens']}, cost=${usage['cost']:.6f}"
            )

            return {
                'content': content,
                'reasoning_details': reasoning,
                'usage': usage,
            }

    except httpx.TimeoutException:
        duration = time.time() - start_time
        logger.error(f"[{short_model}] TIMEOUT after {duration:.1f}s")
        return None
    except Exception as e:
        duration = time.time() - start_time
        logger.error(f"[{short_model}] ERROR after {duration:.1f}s: {type(e).__name__}: {e}")
        return None


async def query_models_parallel(
    models: List[str],
    messages: List[Dict[str, str]],
    on_model_complete: Optional[Any] = None
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple models in parallel.

    Args:
        models: List of OpenRouter model identifiers
        messages: List of message dicts to send to each model
        on_model_complete: Optional callback function(model, response) called when each model completes

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    import asyncio

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
