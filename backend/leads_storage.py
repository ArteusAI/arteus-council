"""MongoDB-based storage for leads mode conversations."""

import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional
from urllib.parse import urlparse, urlunparse

from motor.motor_asyncio import AsyncIOMotorClient

from .config import LEADS_MONGODB_DB_NAME, LEADS_MONGODB_URL

logger = logging.getLogger("llm-council.leads-storage")

_mongo_client: Optional[AsyncIOMotorClient] = None

CACHE_SCHEMA_VERSION = 1
CACHE_TTL_DAYS = max(1, int(os.getenv("LEADS_CACHE_TTL_DAYS", "7")))
CACHE_ENABLED = os.getenv("LEADS_CACHE_ENABLED", "true").lower() != "false"
_CACHE_INDEX_READY = False


def get_mongo_client() -> AsyncIOMotorClient:
    """Get or create MongoDB client singleton for leads storage.

    ``tz_aware=True`` ensures BSON Date values come back as timezone-aware
    UTC datetimes so we can safely compare them with ``datetime.now(timezone.utc)``.
    """
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = AsyncIOMotorClient(
            LEADS_MONGODB_URL,
            maxPoolSize=200,
            minPoolSize=10,
            serverSelectionTimeoutMS=10000,
            tz_aware=True,
            tzinfo=timezone.utc,
        )
    return _mongo_client


def get_database():
    """Get the MongoDB database instance for leads."""
    return get_mongo_client()[LEADS_MONGODB_DB_NAME]


async def register_lead(
    email: Optional[str],
    telegram: Optional[str],
    linkedin: Optional[str] = None,
) -> dict:
    """
    Register a new lead and create a session.

    Args:
        email: Optional email address
        telegram: Optional telegram handle
        linkedin: Optional linkedin slug or URL

    Returns:
        Lead document with session_id
    """
    if not email and not telegram and not linkedin:
        raise ValueError("At least one of email, telegram or linkedin is required")

    db = get_database()
    leads = db["leads"]

    session_id = str(uuid.uuid4())
    lead_doc = {
        "session_id": session_id,
        "email": email,
        "telegram": telegram,
        "linkedin": linkedin,
        "created_at": datetime.now(timezone.utc),
    }

    await leads.insert_one(lead_doc)
    logger.info(
        f"Registered lead: session={session_id}, email={email}, "
        f"telegram={telegram}, linkedin={linkedin}"
    )

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
        "lead_linkedin": lead.get("linkedin"),
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
    metadata: dict[str, Any] | None = None,
    rounds: list[dict[str, Any]] | None = None,
    scraped_links: list[dict[str, Any]] | None = None,
):
    """Add an assistant message with all 3 stages to a conversation."""
    db = get_database()
    conversations = db["conversations"]

    message_data: dict[str, Any] = {
        "role": "assistant",
        "stage1": stage1 or [],
        "stage2": stage2 or [],
        "stage3": stage3,
    }

    if metadata is not None:
        message_data["metadata"] = metadata
    if rounds is not None:
        message_data["rounds"] = rounds
    if scraped_links:
        message_data["scrapedLinks"] = scraped_links

    result = await conversations.update_one(
        {"_id": conversation_id, "session_id": session_id},
        {"$push": {"messages": message_data}},
    )

    if result.matched_count == 0:
        raise ValueError(f"Conversation {conversation_id} not found")


async def update_last_assistant_message(
    session_id: str,
    conversation_id: str,
    message: dict[str, Any],
):
    """Replace the latest assistant message in a conversation."""
    db = get_database()
    conversations = db["conversations"]

    doc = await conversations.find_one(
        {"_id": conversation_id, "session_id": session_id},
        {"messages": 1},
    )
    if doc is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    messages = doc.get("messages", [])
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") == "assistant":
            messages[index] = message
            await conversations.update_one(
                {"_id": conversation_id, "session_id": session_id},
                {"$set": {"messages": messages}},
            )
            return

    raise ValueError(f"Conversation {conversation_id} has no assistant message")


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


async def get_lead_council_settings(session_id: str) -> dict[str, Any]:
    """
    Get council settings for a lead user.

    Args:
        session_id: Lead session identifier

    Returns:
        Settings dict with personal_prompt and template_id
    """
    db = get_database()
    leads = db["leads"]

    lead = await leads.find_one({"session_id": session_id})
    if not lead:
        # Return defaults if lead not found
        return {
            "personal_prompt": "",
            "template_id": "default",
        }

    return {
        "personal_prompt": lead.get("personal_prompt", ""),
        "template_id": lead.get("template_id", "default"),
    }


async def set_lead_council_settings(
    session_id: str, personal_prompt: str, template_id: str
):
    """
    Set council settings for a lead user.

    Args:
        session_id: Lead session identifier
        personal_prompt: Custom personalization prompt
        template_id: Selected template identifier
    """
    db = get_database()
    leads = db["leads"]

    await leads.update_one(
        {"session_id": session_id},
        {
            "$set": {
                "personal_prompt": personal_prompt,
                "template_id": template_id,
            }
        },
    )


# ---------------------------------------------------------------------------
# Council result cache (leads mode)
# ---------------------------------------------------------------------------


def normalize_url(url: str) -> str:
    """Normalize a URL for stable cache keys.

    Lowercases scheme/host, drops trailing slashes, drops fragment and
    default ports. Query string is kept as-is because it usually carries
    meaningful filters.
    """
    parsed = urlparse(url.strip())
    scheme = (parsed.scheme or "https").lower()
    netloc = (parsed.hostname or "").lower()
    if parsed.port and not (
        (scheme == "http" and parsed.port == 80)
        or (scheme == "https" and parsed.port == 443)
    ):
        netloc = f"{netloc}:{parsed.port}"
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    return urlunparse((scheme, netloc, path, "", parsed.query, ""))


def build_cache_key(
    *,
    url: str,
    identity_id: str,
    language: Optional[str],
    models: Iterable[str],
    chairman_model: Optional[str],
    personal_prompt: str,
    enable_second_round: bool,
) -> str:
    """Build a stable sha256 cache key for the given council request."""
    payload = {
        "schema": CACHE_SCHEMA_VERSION,
        "url": normalize_url(url),
        "identity": identity_id or "",
        "language": (language or "").lower(),
        "models": sorted(models),
        "chairman": chairman_model or "",
        "personal_prompt_sha": hashlib.sha256(
            (personal_prompt or "").encode("utf-8")
        ).hexdigest(),
        "second_round": bool(enable_second_round),
    }
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


async def ensure_cache_indexes() -> None:
    """Create TTL index on council_cache. Idempotent and safe to call repeatedly."""
    global _CACHE_INDEX_READY
    if _CACHE_INDEX_READY:
        return
    try:
        db = get_database()
        await db["council_cache"].create_index(
            "expires_at",
            expireAfterSeconds=0,
            name="council_cache_ttl",
        )
        _CACHE_INDEX_READY = True
        logger.info("council_cache TTL index ensured")
    except Exception as exc:
        logger.warning("Failed to ensure council_cache TTL index: %s", exc)


async def get_cached_result(cache_key: str) -> Optional[dict[str, Any]]:
    """Return a cached council payload if it exists and is not expired."""
    if not CACHE_ENABLED:
        return None
    try:
        await ensure_cache_indexes()
        db = get_database()
        doc = await db["council_cache"].find_one({"_id": cache_key})
        if doc is None:
            logger.info("council_cache MISS key=%s (no doc)", cache_key[:12])
            return None
        expires_at = doc.get("expires_at")
        if isinstance(expires_at, datetime):
            # Defensive: older docs may be naive, treat them as UTC.
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at <= datetime.now(timezone.utc):
                logger.info("council_cache MISS key=%s (expired)", cache_key[:12])
                return None
        logger.info(
            "council_cache HIT key=%s url=%s",
            cache_key[:12],
            doc.get("url"),
        )
        return doc.get("payload")
    except Exception as exc:
        logger.warning("council_cache read failed for key=%s: %s", cache_key[:12], exc)
        return None


async def save_cached_result(
    cache_key: str,
    url: str,
    payload: dict[str, Any],
) -> None:
    """Upsert a council payload into the cache with TTL ``CACHE_TTL_DAYS``."""
    if not CACHE_ENABLED:
        return
    try:
        await ensure_cache_indexes()
        db = get_database()
        now = datetime.now(timezone.utc)
        await db["council_cache"].update_one(
            {"_id": cache_key},
            {
                "$set": {
                    "url": url,
                    "payload": payload,
                    "created_at": now,
                    "expires_at": now + timedelta(days=CACHE_TTL_DAYS),
                    "schema_version": CACHE_SCHEMA_VERSION,
                }
            },
            upsert=True,
        )
        logger.info("council_cache wrote key=%s url=%s", cache_key[:12], url)
    except Exception as exc:
        logger.warning("council_cache write failed for key=%s: %s", cache_key[:12], exc)
