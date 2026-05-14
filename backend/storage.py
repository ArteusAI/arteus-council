"""JSON-based storage for conversations."""

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from pathlib import Path
from .config import DATA_DIR


def sanitize_session_id(session_id: str) -> str:
    """Sanitize the session id for filesystem safety."""
    return re.sub(r'[^a-zA-Z0-9_-]', '_', session_id)


def ensure_session_dir(session_id: str):
    """Ensure the session-specific data directory exists."""
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)
    Path(get_session_dir(session_id)).mkdir(parents=True, exist_ok=True)


def get_session_dir(session_id: str) -> str:
    """Get the directory for a specific session."""
    return os.path.join(DATA_DIR, sanitize_session_id(session_id))


def get_conversation_path(session_id: str, conversation_id: str) -> str:
    """Get the file path for a conversation within a session."""
    return os.path.join(get_session_dir(session_id), f"{conversation_id}.json")


def create_conversation(session_id: str, conversation_id: str) -> Dict[str, Any]:
    """
    Create a new conversation.

    Args:
        session_id: Browser session identifier
        conversation_id: Unique identifier for the conversation

    Returns:
        New conversation dict
    """
    ensure_session_dir(session_id)

    conversation = {
        "id": conversation_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "title": "New Conversation",
        "messages": []
    }

    save_conversation(session_id, conversation)
    return conversation


def get_conversation(session_id: str, conversation_id: str) -> Optional[Dict[str, Any]]:
    """
    Load a conversation from storage.

    Args:
        session_id: Browser session identifier
        conversation_id: Unique identifier for the conversation

    Returns:
        Conversation dict or None if not found
    """
    path = get_conversation_path(session_id, conversation_id)

    if not os.path.exists(path):
        return None

    with open(path, 'r') as f:
        return json.load(f)


def save_conversation(session_id: str, conversation: Dict[str, Any]):
    """
    Save a conversation atomically using a tmp file + os.replace.

    Avoids partial writes if the process is killed mid-write and prevents
    readers from observing a half-written JSON.
    """
    ensure_session_dir(session_id)

    final_path = get_conversation_path(session_id, conversation['id'])
    session_dir = get_session_dir(session_id)

    # Write to a tmp file in the same directory so os.replace is atomic on the
    # same filesystem.
    fd, tmp_path = tempfile.mkstemp(
        prefix=f".{conversation['id']}.",
        suffix=".tmp",
        dir=session_dir,
    )
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(conversation, f, indent=2)
        os.replace(tmp_path, final_path)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise


def list_conversations(session_id: str) -> List[Dict[str, Any]]:
    """
    List all conversations (metadata only).

    Args:
        session_id: Browser session identifier

    Returns:
        List of conversation metadata dicts
    """
    ensure_session_dir(session_id)

    conversations = []
    for filename in os.listdir(get_session_dir(session_id)):
        if filename.endswith('.json'):
            path = os.path.join(get_session_dir(session_id), filename)
            with open(path, 'r') as f:
                data = json.load(f)
                # Return metadata only
                conversations.append({
                    "id": data["id"],
                    "created_at": data["created_at"],
                    "title": data.get("title", "New Conversation"),
                    "message_count": len(data["messages"])
                })

    # Sort by creation time, newest first
    conversations.sort(key=lambda x: x["created_at"], reverse=True)

    return conversations


def add_user_message(session_id: str, conversation_id: str, content: str):
    """
    Add a user message to a conversation.

    Args:
        session_id: Browser session identifier
        conversation_id: Conversation identifier
        content: User message content
    """
    conversation = get_conversation(session_id, conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "user",
        "content": content
    })

    save_conversation(session_id, conversation)


def add_assistant_message(
    session_id: str,
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: List[Dict[str, Any]],
    stage3: Dict[str, Any],
    metadata: Optional[Dict[str, Any]] = None,
    rounds: Optional[List[Dict[str, Any]]] = None,
    scraped_links: Optional[List[Dict[str, Any]]] = None,
):
    """
    Add an assistant message with all 3 stages to a conversation.

    Args:
        session_id: Browser session identifier
        conversation_id: Conversation identifier
        stage1: List of individual model responses
        stage2: List of model rankings
        stage3: Final synthesized response
        metadata: Optional response metadata
        rounds: Optional multi-round deliberation payload
        scraped_links: Optional persisted scraped link metadata
    """
    conversation = get_conversation(session_id, conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message = {
        "role": "assistant",
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3,
    }
    if metadata is not None:
        message["metadata"] = metadata
    if rounds is not None:
        message["rounds"] = rounds
    if scraped_links is not None:
        message["scrapedLinks"] = scraped_links

    conversation["messages"].append(message)

    save_conversation(session_id, conversation)


def update_last_assistant_message(
    session_id: str,
    conversation_id: str,
    message: Dict[str, Any],
):
    """
    Replace the latest assistant message in a conversation.

    Args:
        session_id: Browser session identifier
        conversation_id: Conversation identifier
        message: Full assistant message payload to persist
    """
    conversation = get_conversation(session_id, conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    for index in range(len(conversation["messages"]) - 1, -1, -1):
        if conversation["messages"][index].get("role") == "assistant":
            conversation["messages"][index] = message
            save_conversation(session_id, conversation)
            return

    raise ValueError(f"Conversation {conversation_id} has no assistant message")


def update_conversation_title(session_id: str, conversation_id: str, title: str):
    """
    Update the title of a conversation.

    Args:
        session_id: Browser session identifier
        conversation_id: Conversation identifier
        title: New title for the conversation
    """
    conversation = get_conversation(session_id, conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["title"] = title
    save_conversation(session_id, conversation)


def delete_conversation(session_id: str, conversation_id: str) -> bool:
    """
    Delete a conversation.

    Args:
        session_id: Browser session identifier
        conversation_id: Conversation identifier

    Returns:
        True if deleted, False if not found
    """
    path = get_conversation_path(session_id, conversation_id)
    if not os.path.exists(path):
        return False
    os.remove(path)
    return True


def delete_all_conversations(session_id: str) -> int:
    """
    Delete all conversations for a session.

    Args:
        session_id: Browser session identifier

    Returns:
        Number of deleted conversations
    """
    session_dir = get_session_dir(session_id)
    if not os.path.exists(session_dir):
        return 0

    count = 0
    for filename in os.listdir(session_dir):
        if filename.endswith('.json'):
            os.remove(os.path.join(session_dir, filename))
            count += 1
    return count
