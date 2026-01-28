"""MongoDB-based storage for leads mode conversations."""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from motor.motor_asyncio import AsyncIOMotorClient

from .config import LEADS_MONGODB_DB_NAME, LEADS_MONGODB_URL

logger = logging.getLogger("llm-council.leads-storage")

_mongo_client: Optional[AsyncIOMotorClient] = None


def get_mongo_client() -> AsyncIOMotorClient:
    """Get or create MongoDB client singleton for leads storage."""
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = AsyncIOMotorClient(LEADS_MONGODB_URL)
    return _mongo_client


def get_database():
    """Get the MongoDB database instance for leads."""
    return get_mongo_client()[LEADS_MONGODB_DB_NAME]


async def register_lead(email: Optional[str], telegram: Optional[str]) -> dict:
    """
    Register a new lead and create a session.

    Args:
        email: Optional email address
        telegram: Optional telegram handle

    Returns:
        Lead document with session_id
    """
    if not email and not telegram:
        raise ValueError("At least one of email or telegram is required")

    db = get_database()
    leads = db["leads"]

    session_id = str(uuid.uuid4())
    lead_doc = {
        "session_id": session_id,
        "email": email,
        "telegram": telegram,
        "created_at": datetime.now(timezone.utc),
    }

    await leads.insert_one(lead_doc)
    logger.info(f"Registered lead: session={session_id}, email={email}, telegram={telegram}")

    return lead_doc


async def get_lead(session_id: str) -> Optional[dict]:
    """
    Get lead information by session ID.

    Args:
        session_id: Lead session identifier

    Returns:
        Lead document or None if not found
    """
    db = get_database()
    leads = db["leads"]

    lead = await leads.find_one({"session_id": session_id})
    return lead


async def create_conversation(session_id: str, conversation_id: str) -> dict[str, Any]:
    """
    Create a new conversation for a lead.

    Args:
        session_id: Lead session identifier
        conversation_id: Unique identifier for the conversation

    Returns:
        New conversation dict
    """
    db = get_database()
    conversations = db["conversations"]

    lead = await get_lead(session_id)
    if lead is None:
        raise ValueError(f"Lead session {session_id} not found")

    conversation = {
        "_id": conversation_id,
        "id": conversation_id,
        "session_id": session_id,
        "lead_email": lead.get("email"),
        "lead_telegram": lead.get("telegram"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "title": "New Conversation",
        "messages": [],
    }

    await conversations.insert_one(conversation)
    logger.info(f"Created conversation {conversation_id} for lead {session_id}")

    return {
        "id": conversation_id,
        "created_at": conversation["created_at"],
        "title": conversation["title"],
        "messages": [],
    }


async def get_conversation(session_id: str, conversation_id: str) -> Optional[dict[str, Any]]:
    """
    Load a non-deleted conversation from storage.

    Args:
        session_id: Lead session identifier
        conversation_id: Unique identifier for the conversation

    Returns:
        Conversation dict or None if not found or deleted
    """
    db = get_database()
    conversations = db["conversations"]

    doc = await conversations.find_one({
        "_id": conversation_id,
        "session_id": session_id,
        "deleted_at": {"$exists": False},
    })

    if doc is None:
        return None

    return {
        "id": doc["id"],
        "created_at": doc["created_at"],
        "title": doc.get("title", "New Conversation"),
        "messages": doc.get("messages", []),
    }


async def save_conversation(session_id: str, conversation: dict[str, Any]):
    """
    Save a conversation to storage.

    Args:
        session_id: Lead session identifier
        conversation: Conversation dict to save
    """
    db = get_database()
    conversations = db["conversations"]

    await conversations.update_one(
        {"_id": conversation["id"], "session_id": session_id},
        {"$set": {
            "title": conversation.get("title", "New Conversation"),
            "messages": conversation.get("messages", []),
        }},
    )


async def list_conversations(session_id: str) -> list[dict[str, Any]]:
    """
    List all non-deleted conversations for a lead (metadata only).

    Args:
        session_id: Lead session identifier

    Returns:
        List of conversation metadata dicts
    """
    db = get_database()
    conversations = db["conversations"]

    cursor = conversations.find(
        {"session_id": session_id, "deleted_at": {"$exists": False}},
        {"_id": 1, "id": 1, "created_at": 1, "title": 1, "messages": 1},
    ).sort("created_at", -1)

    result = []
    async for doc in cursor:
        result.append({
            "id": doc["id"],
            "created_at": doc["created_at"],
            "title": doc.get("title", "New Conversation"),
            "message_count": len(doc.get("messages", [])),
        })

    return result


async def add_user_message(session_id: str, conversation_id: str, content: str):
    """
    Add a user message to a conversation.

    Args:
        session_id: Lead session identifier
        conversation_id: Conversation identifier
        content: User message content
    """
    db = get_database()
    conversations = db["conversations"]

    result = await conversations.update_one(
        {"_id": conversation_id, "session_id": session_id},
        {"$push": {"messages": {"role": "user", "content": content}}},
    )

    if result.matched_count == 0:
        raise ValueError(f"Conversation {conversation_id} not found")


async def add_assistant_message(
    session_id: str,
    conversation_id: str,
    stage1: list[dict[str, Any]],
    stage2: list[dict[str, Any]],
    stage3: dict[str, Any],
    scraped_links: list[dict[str, Any]] | None = None,
):
    """
    Add an assistant message with all 3 stages to a conversation.

    Args:
        session_id: Lead session identifier
        conversation_id: Conversation identifier
        stage1: List of individual model responses
        stage2: List of model rankings
        stage3: Final synthesized response
        scraped_links: Optional list of scraped link metadata
    """
    db = get_database()
    conversations = db["conversations"]

    message_data = {
        "role": "assistant",
        "stage1": stage1 or [],
        "stage2": stage2 or [],
        "stage3": stage3,
    }
    
    if scraped_links:
        message_data["scrapedLinks"] = scraped_links

    result = await conversations.update_one(
        {"_id": conversation_id, "session_id": session_id},
        {"$push": {"messages": message_data}},
    )

    if result.matched_count == 0:
        raise ValueError(f"Conversation {conversation_id} not found")


async def update_conversation_title(session_id: str, conversation_id: str, title: str):
    """
    Update the title of a conversation.

    Args:
        session_id: Lead session identifier
        conversation_id: Conversation identifier
        title: New title for the conversation
    """
    db = get_database()
    conversations = db["conversations"]

    result = await conversations.update_one(
        {"_id": conversation_id, "session_id": session_id},
        {"$set": {"title": title}},
    )

    if result.matched_count == 0:
        raise ValueError(f"Conversation {conversation_id} not found")


async def delete_conversation(session_id: str, conversation_id: str) -> bool:
    """
    Soft delete a conversation by marking it with deleted_at timestamp.

    Args:
        session_id: Lead session identifier
        conversation_id: Conversation identifier

    Returns:
        True if marked as deleted, False if not found
    """
    db = get_database()
    conversations = db["conversations"]

    result = await conversations.update_one(
        {
            "_id": conversation_id,
            "session_id": session_id,
            "deleted_at": {"$exists": False},
        },
        {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}},
    )

    return result.matched_count > 0


async def delete_all_conversations(session_id: str) -> int:
    """
    Soft delete all conversations for a lead.

    Args:
        session_id: Lead session identifier

    Returns:
        Number of conversations marked as deleted
    """
    db = get_database()
    conversations = db["conversations"]

    result = await conversations.update_many(
        {"session_id": session_id, "deleted_at": {"$exists": False}},
        {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}},
    )
    return result.modified_count
