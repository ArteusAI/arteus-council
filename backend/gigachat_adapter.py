"""GigaChat API client for making LLM requests."""

import logging
import time
import asyncio
from typing import List, Dict, Any, Optional
from gigachat import GigaChat
from gigachat.models import Chat, Messages

from .config import GIGACHAT_CREDENTIALS, GIGACHAT_SCOPE, GIGACHAT_VERIFY_SSL, GIGACHAT_PARALLEL_DISABLED

logger = logging.getLogger("llm-council.gigachat")

# Global lock for serializing GigaChat requests if enabled
_gigachat_lock = asyncio.Lock()


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 300.0
) -> Optional[Dict[str, Any]]:
    """
    Query a GigaChat model with the given messages.

    Args:
        model: GigaChat model identifier (e.g., "GigaChat-2-Max")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds

    Returns:
        Response dict with 'content', or None if failed
    """
    if not GIGACHAT_CREDENTIALS:
        logger.error("GIGACHAT_CREDENTIALS not found in environment variables")
        return None

    # Strip provider prefix if present
    actual_model = model.split('/')[-1] if '/' in model else model
    
    start_time = time.time()
    
    # Use lock if parallel calls are disabled
    if GIGACHAT_PARALLEL_DISABLED:
        async with _gigachat_lock:
            return await _execute_query(actual_model, messages, timeout, start_time)
    else:
        return await _execute_query(actual_model, messages, timeout, start_time)


async def _execute_query(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float,
    start_time: float
) -> Optional[Dict[str, Any]]:
    """Internal helper to execute the GigaChat query."""
    try:
        # GigaChat SDK uses a context manager for async calls
        async with GigaChat(
            credentials=GIGACHAT_CREDENTIALS,
            scope=GIGACHAT_SCOPE,
            verify_ssl_certs=GIGACHAT_VERIFY_SSL,
            timeout=timeout
        ) as giga:
            # Prepare messages for GigaChat SDK
            gigachat_messages = [
                Messages(role=m['role'], content=m['content'])
                for m in messages
            ]
            
            payload = Chat(
                model=model,
                messages=gigachat_messages,
                temperature=0.8,
                max_tokens=4096
            )
            
            response = await giga.achat(payload)
            
            if not response or not response.choices:
                logger.error(f"[{model}] No choices in GigaChat response")
                return None
                
            content = response.choices[0].message.content
            duration = time.time() - start_time
            
            logger.info(f"[{model}] OK in {duration:.1f}s, response_len={len(content)}")
            
            return {
                'content': content,
                'reasoning_details': "" # GigaChat doesn't currently provide reasoning details in the same way
            }

    except Exception as e:
        duration = time.time() - start_time
        logger.error(f"[{model}] ERROR after {duration:.1f}s: {type(e).__name__}: {e}")
        return None
