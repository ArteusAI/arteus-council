"""YandexGPT API client for making LLM requests."""

import logging
import time
import httpx
from typing import List, Dict, Any, Optional
from .config import YANDEX_API_KEY, YANDEX_FOLDER_ID

logger = logging.getLogger("llm-council.yandex")


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 300.0
) -> Optional[Dict[str, Any]]:
    """
    Query a YandexGPT model with the given messages.

    Args:
        model: Yandex model identifier (e.g., "yandex/aliceai-llm")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds

    Returns:
        Response dict with 'content', or None if failed
    """
    if not YANDEX_API_KEY or not YANDEX_FOLDER_ID:
        logger.error("YANDEX_API_KEY or YANDEX_FOLDER_ID not found in environment variables")
        return None

    # Strip provider prefix if present
    actual_model = model.split('/')[-1] if '/' in model else model
    
    # Yandex uses modelUri format: cls://<folder_id>/<model_name>/latest
    # For foundation models it's often gpt://<folder_id>/yandexgpt/latest
    # Given the user's input "aliceai-llm", we use that name
    model_uri = f"gpt://{YANDEX_FOLDER_ID}/{actual_model}/latest"
    
    url = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
    headers = {
        "Authorization": f"Api-Key {YANDEX_API_KEY}",
        "Content-Type": "application/json"
    }
    
    # Yandex messages use 'text' field instead of 'content'
    yandex_messages = [
        {"role": m["role"], "text": m["content"]}
        for m in messages
    ]
    
    payload = {
        "modelUri": model_uri,
        "completionOptions": {
            "stream": False,
            "temperature": 0.8,
            "maxTokens": 4096
        },
        "messages": yandex_messages
    }
    
    start_time = time.time()
    
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            
            data = response.json()
            # YandexGPT response structure: result -> alternatives -> [0] -> message -> text
            result = data.get("result", {})
            alternatives = result.get("alternatives", [])
            
            if not alternatives:
                logger.error(f"[{actual_model}] No alternatives in Yandex response: {data}")
                return None
                
            content = alternatives[0].get("message", {}).get("text", "")
            duration = time.time() - start_time
            
            logger.info(f"[{actual_model}] OK in {duration:.1f}s, response_len={len(content)}")
            
            return {
                "content": content,
                "reasoning_details": ""
            }

    except Exception as e:
        duration = time.time() - start_time
        logger.error(f"[{actual_model}] ERROR after {duration:.1f}s: {type(e).__name__}: {e}")
        return None
