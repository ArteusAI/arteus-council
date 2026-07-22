"""JSON-based storage for shared answer snapshots."""

import json
import os
import secrets
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from .config import COUNCIL_PUBLIC_BASE_URL

SHARED_DIR = os.path.join("data", "shared")


def _ensure_dir() -> None:
    Path(SHARED_DIR).mkdir(parents=True, exist_ok=True)


def _shared_path(token: str) -> str:
    return os.path.join(SHARED_DIR, f"{token}.json")


def _build_share_url(token: str) -> str:
    base = (COUNCIL_PUBLIC_BASE_URL or "").strip().rstrip("/")
    if not base:
        base = "https://api.arteus.us/council"
    return f"{base}/share/{token}"


def create_shared_answer(
    user_id: str,
    conversation: Dict[str, Any],
    message_index: int,
    requires_login: bool,
    author: str = "",
) -> Dict[str, Any]:
    """
    Create a shared snapshot of a specific assistant message.

    Returns:
        Dict with token, share_url, and the snapshot data.
    """
    _ensure_dir()

    messages = conversation.get("messages") or []
    if message_index < 0 or message_index >= len(messages):
        raise ValueError("Message index out of range")

    assistant_msg = messages[message_index]
    if assistant_msg.get("role") != "assistant":
        raise ValueError("Selected message is not an assistant message")

    stage3 = assistant_msg.get("stage3")
    if not stage3 or not stage3.get("response"):
        raise ValueError("This message has no final answer to share")

    # Find the user question (last user message before this assistant message)
    question = ""
    for i in range(message_index - 1, -1, -1):
        if messages[i].get("role") == "user":
            question = messages[i].get("content") or ""
            break

    metadata = assistant_msg.get("metadata") or {}
    aggregate_rankings = metadata.get("aggregate_rankings") or []
    label_to_model = metadata.get("label_to_model") or {}

    token = secrets.token_urlsafe(8)
    snapshot = {
        "token": token,
        "title": conversation.get("title") or "Arteus Council",
        "question": question,
        "stage3": {
            "model": stage3.get("model") or "",
            "response": stage3.get("response") or "",
        },
        "aggregate_rankings": aggregate_rankings,
        "label_to_model": label_to_model,
        "created_at": datetime.utcnow().isoformat(),
        "requires_login": requires_login,
        "author": author,
    }

    with open(_shared_path(token), "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)

    return {
        "token": token,
        "share_url": _build_share_url(token),
    }


def get_shared_answer(token: str) -> Optional[Dict[str, Any]]:
    """Load a shared answer snapshot by token, or None if not found."""
    path = _shared_path(token)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
