"""Storage adapters used by background council jobs.

Both the local file-based storage (for authenticated users) and the
Mongo-based leads storage expose conversation/message operations under
slightly different signatures (sync vs async, partial keyword arguments).
The job runner needs a single async-friendly facade so it can persist
state at the end of a long-running task regardless of who owns the
conversation.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Protocol, Tuple

from . import leads_storage, storage


class JobStorage(Protocol):
    """Minimal async storage interface required by ``CouncilJob``."""

    scope: str

    async def get_conversation(
        self,
        owner_id: str,
        conversation_id: str,
    ) -> Optional[Dict[str, Any]]: ...

    async def add_user_message(
        self,
        owner_id: str,
        conversation_id: str,
        content: str,
    ) -> None: ...

    async def add_assistant_message(
        self,
        owner_id: str,
        conversation_id: str,
        stage1: List[Dict[str, Any]],
        stage2: List[Dict[str, Any]],
        stage3: Dict[str, Any],
        *,
        metadata: Optional[Dict[str, Any]] = None,
        rounds: Optional[List[Dict[str, Any]]] = None,
        scraped_links: Optional[List[Dict[str, Any]]] = None,
    ) -> None: ...

    async def update_last_assistant_message(
        self,
        owner_id: str,
        conversation_id: str,
        message: Dict[str, Any],
    ) -> None: ...

    async def update_conversation_title(
        self,
        owner_id: str,
        conversation_id: str,
        title: str,
    ) -> None: ...


_LOCAL_STORAGE_LOCKS: Dict[Tuple[str, str], asyncio.Lock] = {}
_LOCAL_STORAGE_LOCKS_GUARD: Optional[asyncio.Lock] = None


def _get_locks_guard() -> asyncio.Lock:
    """Lazily create the guard lock bound to the running event loop."""
    global _LOCAL_STORAGE_LOCKS_GUARD
    if _LOCAL_STORAGE_LOCKS_GUARD is None:
        _LOCAL_STORAGE_LOCKS_GUARD = asyncio.Lock()
    return _LOCAL_STORAGE_LOCKS_GUARD


async def _get_conversation_lock(owner_id: str, conversation_id: str) -> asyncio.Lock:
    """Return a per-(owner, conversation) lock to serialize JSON writes."""
    key = (owner_id, conversation_id)
    async with _get_locks_guard():
        lock = _LOCAL_STORAGE_LOCKS.get(key)
        if lock is None:
            lock = asyncio.Lock()
            _LOCAL_STORAGE_LOCKS[key] = lock
        return lock


class LocalJobStorage:
    """Adapter over the synchronous file-based ``storage`` module.

    File I/O is offloaded to a thread pool via ``asyncio.to_thread`` to keep
    the event loop responsive, and write operations are guarded by a
    per-conversation ``asyncio.Lock`` to prevent in-process read-modify-write
    races (e.g. user with multiple browser tabs).
    """

    scope = "user"

    async def get_conversation(
        self,
        owner_id: str,
        conversation_id: str,
    ) -> Optional[Dict[str, Any]]:
        return await asyncio.to_thread(
            storage.get_conversation, owner_id, conversation_id
        )

    async def add_user_message(
        self,
        owner_id: str,
        conversation_id: str,
        content: str,
    ) -> None:
        lock = await _get_conversation_lock(owner_id, conversation_id)
        async with lock:
            await asyncio.to_thread(
                storage.add_user_message, owner_id, conversation_id, content
            )

    async def add_assistant_message(
        self,
        owner_id: str,
        conversation_id: str,
        stage1: List[Dict[str, Any]],
        stage2: List[Dict[str, Any]],
        stage3: Dict[str, Any],
        *,
        metadata: Optional[Dict[str, Any]] = None,
        rounds: Optional[List[Dict[str, Any]]] = None,
        scraped_links: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        lock = await _get_conversation_lock(owner_id, conversation_id)
        async with lock:
            await asyncio.to_thread(
                storage.add_assistant_message,
                owner_id,
                conversation_id,
                stage1,
                stage2,
                stage3,
                metadata=metadata,
                rounds=rounds,
                scraped_links=scraped_links,
            )

    async def update_last_assistant_message(
        self,
        owner_id: str,
        conversation_id: str,
        message: Dict[str, Any],
    ) -> None:
        lock = await _get_conversation_lock(owner_id, conversation_id)
        async with lock:
            await asyncio.to_thread(
                storage.update_last_assistant_message,
                owner_id,
                conversation_id,
                message,
            )

    async def update_conversation_title(
        self,
        owner_id: str,
        conversation_id: str,
        title: str,
    ) -> None:
        lock = await _get_conversation_lock(owner_id, conversation_id)
        async with lock:
            await asyncio.to_thread(
                storage.update_conversation_title,
                owner_id,
                conversation_id,
                title,
            )


class LeadsJobStorage:
    """Adapter over the asynchronous Mongo-backed ``leads_storage`` module."""

    scope = "lead"

    async def get_conversation(
        self,
        owner_id: str,
        conversation_id: str,
    ) -> Optional[Dict[str, Any]]:
        return await leads_storage.get_conversation(owner_id, conversation_id)

    async def add_user_message(
        self,
        owner_id: str,
        conversation_id: str,
        content: str,
    ) -> None:
        await leads_storage.add_user_message(owner_id, conversation_id, content)

    async def add_assistant_message(
        self,
        owner_id: str,
        conversation_id: str,
        stage1: List[Dict[str, Any]],
        stage2: List[Dict[str, Any]],
        stage3: Dict[str, Any],
        *,
        metadata: Optional[Dict[str, Any]] = None,
        rounds: Optional[List[Dict[str, Any]]] = None,
        scraped_links: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        await leads_storage.add_assistant_message(
            owner_id,
            conversation_id,
            stage1,
            stage2,
            stage3,
            metadata=metadata,
            rounds=rounds,
            scraped_links=scraped_links,
        )

    async def update_last_assistant_message(
        self,
        owner_id: str,
        conversation_id: str,
        message: Dict[str, Any],
    ) -> None:
        await leads_storage.update_last_assistant_message(
            owner_id, conversation_id, message
        )

    async def update_conversation_title(
        self,
        owner_id: str,
        conversation_id: str,
        title: str,
    ) -> None:
        await leads_storage.update_conversation_title(
            owner_id, conversation_id, title
        )


local_job_storage: JobStorage = LocalJobStorage()
leads_job_storage: JobStorage = LeadsJobStorage()
