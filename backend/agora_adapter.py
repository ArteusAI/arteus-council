"""Arteus Agora RAG API client for Council-compatible LLM requests."""

import ast
import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional

import httpx

from .config import (
    AGORA_API_BASE_URL,
    AGORA_API_KEY,
    AGORA_MODEL_ID,
    AGORA_POLL_INTERVAL_SECONDS,
    MODEL_QUERY_TIMEOUT_SECONDS,
)

logger = logging.getLogger("llm-council.agora")

_DETAIL_INSTRUCTION = (
    "AGORA DETAIL INSTRUCTION:\n"
    "Provide the most detailed answer possible while still following all formatting, "
    "ranking, and language instructions above. Cover relevant facts, nuance, "
    "limitations, examples, and practical implications. Do not end with offers "
    "to continue in a later message, such as 'if you want, I can also...' or "
    "'in the next message I can...'. If a follow-up section, table, matrix, "
    "ranking, recommendation, checklist, or deeper breakdown would be useful, "
    "include it now in the current answer instead of offering it for later."
)
_SUCCESS_STATUSES = {"complete", "completed", "done", "final", "finished", "success", "succeeded"}
_ERROR_STATUSES = {
    "cancelled",
    "canceled",
    "error",
    "failed",
    "failure",
    "rejected",
    "stopped",
}
_PIPELINE_CONTEXT_KEYS = (
    "agent/context",
    "agent/context_summaries",
    "agent/chat_sql_context",
    "agent/resource_fetcher",
)


class _DeadlineExceeded(Exception):
    """Raised when the total Agora request budget is exhausted."""


def _headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {AGORA_API_KEY}",
        "Content-Type": "application/json",
    }


def _url(path: str) -> str:
    return f"{AGORA_API_BASE_URL.rstrip('/')}/{path.lstrip('/')}"


def _remaining_timeout(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise _DeadlineExceeded
    return remaining


def _content_to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def _has_cyrillic(text: str) -> bool:
    return any("\u0400" <= char <= "\u04ff" for char in text)


def _promote_section_heading(text: str) -> str:
    lines = text.strip().splitlines()
    if len(lines) < 3 or lines[1].strip():
        return text.strip()

    first_line = lines[0].strip()
    number, separator, title = first_line.partition(". ")
    if number.isdigit() and separator and title:
        lines[0] = f"## {first_line}"
        return "\n".join(lines).strip()

    return text.strip()


def _format_structured_section(section: Any) -> Optional[str]:
    if isinstance(section, str):
        text = section.strip()
        return _promote_section_heading(text) if text else None

    if not isinstance(section, dict):
        text = _content_to_text(section).strip()
        return text or None

    section_type = str(section.get("type") or "").strip().lower()
    title = str(section.get("title") or section.get("heading") or "").strip()
    text = str(
        section.get("markdown")
        or section.get("text")
        or section.get("content")
        or ""
    ).strip()

    if section_type in {"heading", "title"} and text:
        return f"## {text}"

    parts: List[str] = []
    if title:
        parts.append(f"## {title}")
    if text:
        parts.append(_promote_section_heading(text))

    items = section.get("items")
    if isinstance(items, list) and items:
        list_lines = [f"- {_content_to_text(item).strip()}" for item in items if _content_to_text(item).strip()]
        if list_lines:
            parts.append("\n".join(list_lines))

    return "\n\n".join(parts).strip() or None


def _format_source_ref(source: Any) -> Optional[str]:
    if not isinstance(source, dict):
        text = _content_to_text(source).strip()
        return text or None

    source_type = str(source.get("source_type") or "source").strip()
    context_doc_num = source.get("context_doc_num")
    context_summary_num = source.get("context_summary_num")
    message_id = source.get("message_id")

    if source_type == "document" and context_doc_num is not None:
        return f"document {context_doc_num}"

    bits: List[str] = []
    if context_doc_num is not None:
        bits.append(f"document {context_doc_num}")
    if context_summary_num is not None:
        bits.append(f"summary {context_summary_num}")
    if message_id is not None:
        bits.append(f"message {message_id}")

    return f"{source_type} {', '.join(bits)}".strip()


def _format_structured_explanations(explanations: Any, body_text: str) -> Optional[str]:
    if not isinstance(explanations, list) or not explanations:
        return None

    explanation_text = "\n".join(_content_to_text(item) for item in explanations)
    is_russian = _has_cyrillic(f"{body_text}\n{explanation_text}")
    heading = "## Источники и пояснения" if is_russian else "## Sources and Notes"
    sources_label = "Источники" if is_russian else "Sources"

    lines = [heading]
    for index, item in enumerate(explanations, start=1):
        if isinstance(item, dict):
            explanation = str(item.get("explanation") or "").strip()
            if explanation:
                lines.append(f"{index}. {explanation}")

            source_refs = []
            sources = item.get("sources")
            if isinstance(sources, list):
                source_refs = [ref for ref in (_format_source_ref(source) for source in sources) if ref]
            if source_refs:
                source_text = f"*{sources_label}: {'; '.join(source_refs)}.*"
                if explanation:
                    lines.append(f"   {source_text}")
                else:
                    lines.append(f"{index}. {source_text}")
        else:
            text = _content_to_text(item).strip()
            if text:
                lines.append(f"{index}. {text}")

    return "\n".join(lines).strip() if len(lines) > 1 else None


def _structured_output_to_markdown(output: Any) -> Optional[str]:
    if not isinstance(output, dict):
        return None

    sections = output.get("sections")
    if not isinstance(sections, list):
        return None

    parts = [part for part in (_format_structured_section(section) for section in sections) if part]
    body_text = "\n\n".join(parts).strip()
    explanations = _format_structured_explanations(output.get("explanations"), body_text)
    if explanations:
        parts.append(f"---\n\n{explanations}")

    return "\n\n".join(parts).strip() or None


def _parse_structured_output_text(text: str) -> Optional[Any]:
    stripped = text.strip()
    if not stripped or stripped[0] not in "{[":
        return None
    if "sections" not in stripped and "response_kind" not in stripped and "explanations" not in stripped:
        return None

    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    try:
        return ast.literal_eval(stripped)
    except (SyntaxError, ValueError):
        return None


def _append_detail_instruction(prompt: str) -> str:
    return f"{prompt.rstrip()}\n\n{_DETAIL_INSTRUCTION}"


def _extract_prompt_and_context(messages: List[Dict[str, str]]) -> tuple[str, str]:
    last_user_index = None
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") == "user":
            last_user_index = index
            break

    if last_user_index is None:
        if not messages:
            return "", ""
        prompt = _content_to_text(messages[-1].get("content"))
        previous_messages = messages[:-1]
    else:
        prompt = _content_to_text(messages[last_user_index].get("content"))
        previous_messages = messages[:last_user_index]

    return prompt, _format_conversation_context(previous_messages)


def _format_conversation_context(messages: List[Dict[str, str]]) -> str:
    lines = []
    for message in messages:
        content = _content_to_text(message.get("content")).strip()
        if not content:
            continue
        role = (message.get("role") or "message").upper()
        lines.append(f"{role}: {content}")
    return "\n\n".join(lines)


def _user_vars() -> Dict[str, Any]:
    return {
        "source": "llm-council",
        "from_council": True,
        "council_model_id": AGORA_MODEL_ID,
    }


def _status(data: Dict[str, Any]) -> str:
    return str(data.get("status") or "").strip().lower()


def _is_error_result(data: Dict[str, Any]) -> bool:
    return bool(data.get("stopped")) or _status(data) in _ERROR_STATUSES


def _extract_output(data: Dict[str, Any]) -> Optional[str]:
    if "output_text" not in data or data["output_text"] is None:
        return None

    output = data["output_text"]
    structured_markdown = _structured_output_to_markdown(output)
    if structured_markdown:
        return structured_markdown

    if isinstance(output, str):
        structured_output = _parse_structured_output_text(output)
        structured_markdown = _structured_output_to_markdown(structured_output)
        if structured_markdown:
            return structured_markdown
        return output if output.strip() else None

    if isinstance(output, (dict, list)):
        return json.dumps(output, ensure_ascii=False)

    return str(output)


def _context_value_to_text(value: Any) -> Optional[str]:
    if value is None:
        return None

    if isinstance(value, str):
        value_text = value.strip()
        return value_text or None

    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)

    return str(value)


def _extract_rag_context(data: Dict[str, Any]) -> Optional[str]:
    parts: List[str] = []

    context_text = _context_value_to_text(data.get("context"))
    if context_text:
        parts.append(context_text)

    pipeline = data.get("pipeline")
    if isinstance(pipeline, dict):
        outputs = pipeline.get("outputs")
        if isinstance(outputs, list):
            for output in outputs:
                if not isinstance(output, dict):
                    continue
                for key in _PIPELINE_CONTEXT_KEYS:
                    value_text = _context_value_to_text(output.get(key))
                    if value_text:
                        parts.append(f"{key}:\n{value_text}")

    if not parts:
        return None

    return "\n\n".join(parts)


async def _create_session(
    client: httpx.AsyncClient,
    headers: Dict[str, str],
    conversation_context: str,
    user_vars: Dict[str, Any],
    deadline: float,
) -> Optional[str]:
    payload = {
        "user_id": "llm-council",
        "bot_id": "agora",
        "conversation_context": conversation_context,
        "user_vars": user_vars,
    }

    response = await client.post(
        _url("sessions"),
        headers=headers,
        json=payload,
        timeout=_remaining_timeout(deadline),
    )
    response.raise_for_status()

    data = response.json()
    session_id = data.get("session_id")
    if not session_id:
        logger.error("[agora/rag] Missing session_id in Agora session response: %s", data)
        return None

    return session_id


async def _start_prediction(
    client: httpx.AsyncClient,
    headers: Dict[str, str],
    prompt: str,
    session_id: str,
    user_vars: Dict[str, Any],
    deadline: float,
) -> Optional[Dict[str, Any]]:
    payload = {
        "input_text": _append_detail_instruction(prompt),
        "session_id": session_id,
        "user_vars": user_vars,
        "wait": False,
    }

    response = await client.post(
        _url("predict"),
        headers=headers,
        json=payload,
        timeout=_remaining_timeout(deadline),
    )
    response.raise_for_status()

    data = response.json()
    if not data.get("request_id"):
        logger.error("[agora/rag] Missing request_id in Agora predict response: %s", data)
        return None

    return data


async def _poll_prediction(
    client: httpx.AsyncClient,
    headers: Dict[str, str],
    request_id: str,
    deadline: float,
) -> Optional[Dict[str, Any]]:
    while True:
        try:
            remaining = _remaining_timeout(deadline)
        except _DeadlineExceeded:
            logger.error("[agora/rag] TIMEOUT while waiting for request_id=%s", request_id)
            return None

        response = await client.get(
            _url(f"predict/{request_id}"),
            headers=headers,
            params={"include_context": True},
            timeout=remaining,
        )
        response.raise_for_status()

        data = response.json()
        if _is_error_result(data):
            logger.error("[agora/rag] Prediction failed for request_id=%s: %s", request_id, data)
            return None

        if _extract_output(data) is not None:
            return data

        if _status(data) in _SUCCESS_STATUSES:
            logger.error("[agora/rag] Prediction completed without output for request_id=%s: %s", request_id, data)
            return None

        sleep_for = min(AGORA_POLL_INTERVAL_SECONDS, max(deadline - time.monotonic(), 0.0))
        await asyncio.sleep(sleep_for)


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = MODEL_QUERY_TIMEOUT_SECONDS,
) -> Optional[Dict[str, Any]]:
    """
    Query Arteus Agora RAG using the Council provider contract.

    Args:
        model: Agora model identifier, currently "agora/rag"
        messages: List of message dicts with 'role' and 'content'
        timeout: Total request timeout in seconds

    Returns:
        Response dict with 'content' and 'reasoning_details', or None if failed
    """
    if not AGORA_API_KEY:
        logger.error("AGORA_API_KEY not found in environment variables")
        return None

    prompt, conversation_context = _extract_prompt_and_context(messages)
    if not prompt.strip():
        logger.error("[%s] No user prompt found for Agora request", model)
        return None

    user_vars = _user_vars()
    headers = _headers()
    start_time = time.time()
    deadline = time.monotonic() + timeout

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            session_id = await _create_session(
                client,
                headers,
                conversation_context,
                user_vars,
                deadline,
            )
            if not session_id:
                return None

            prediction = await _start_prediction(
                client,
                headers,
                prompt,
                session_id,
                user_vars,
                deadline,
            )
            if not prediction:
                return None

            if _is_error_result(prediction):
                logger.error("[%s] Prediction failed: %s", model, prediction)
                return None

            output = _extract_output(prediction)
            if output is None:
                prediction = await _poll_prediction(
                    client,
                    headers,
                    prediction["request_id"],
                    deadline,
                )
                if not prediction:
                    return None
                output = _extract_output(prediction)

            if output is None:
                logger.error("[%s] Agora response did not contain useful output: %s", model, prediction)
                return None

            duration = time.time() - start_time
            logger.info("[%s] OK in %.1fs, response_len=%s", model, duration, len(output))

            result = {
                "content": output,
                "reasoning_details": "",
            }
            rag_context = _extract_rag_context(prediction)
            if rag_context:
                result["rag_context"] = rag_context
            return result

    except _DeadlineExceeded:
        duration = time.time() - start_time
        logger.error("[%s] TIMEOUT after %.1fs", model, duration)
        return None
    except httpx.TimeoutException:
        duration = time.time() - start_time
        logger.error("[%s] TIMEOUT after %.1fs", model, duration)
        return None
    except Exception as e:
        duration = time.time() - start_time
        logger.error("[%s] ERROR after %.1fs: %s: %s", model, duration, type(e).__name__, e)
        return None
