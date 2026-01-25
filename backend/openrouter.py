"""OpenRouter API client for making LLM requests."""

import httpx
import time
import logging
from typing import List, Dict, Any, Optional
from .config import OPENROUTER_API_KEY, OPENROUTER_API_URL

logger = logging.getLogger("llm-council.openrouter")


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 300.0
) -> Optional[Dict[str, Any]]:
    """
    Query a single model via OpenRouter API with high reasoning effort.

    Args:
        model: OpenRouter model identifier (e.g., "openai/gpt-4o")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds

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
            "effort": "high"
        },
        "include_reasoning": True
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
            
            logger.info(f"[{short_model}] OK in {duration:.1f}s, response_len={len(content)}, reasoning_len={len(reasoning)}")

            return {
                'content': content,
                'reasoning_details': reasoning
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
