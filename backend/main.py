"""FastAPI backend for LLM Council."""

import os
import uuid
import json
import asyncio
import logging

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("llm-council")
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

from . import storage
from .agora_eval_files import resolve_eval_file
from .auth import (
    User,
    authenticate_user,
    create_access_token,
    get_client_ip,
    get_current_user,
    get_current_user_optional,
    get_user_council_settings,
    is_ip_allowed,
    set_user_council_settings,
)
from .config import (
    COUNCIL_MODELS,
    CHAIRMAN_MODEL,
    DEFAULT_PREFERRED_MODELS,
    CORS_ALLOW_ORIGINS,
    BACKEND_ROOT_PATH,
    PERSONALIZATION_TEMPLATES,
    COUNCIL_IDENTITY_TEMPLATES,
    MAX_USER_QUESTIONS_PER_CONVERSATION,
)
from .attachments import (
    build_agora_attachment_block,
    build_inline_attachment_block,
    cleanup_attachment_files,
    create_attachment_files,
    normalize_attachments,
    validate_attachments,
)
from .council import (
    apply_conversation_history,
    generate_conversation_title,
    is_agora_model,
    run_full_council,
)
from .firecrawl import process_message_links
from .jobs import JobConflictError, JobNotFoundError, job_manager
from .shared import create_shared_answer, get_shared_answer


def _prefixed_path(path: str) -> str:
    """Return a docs/OpenAPI path with the configured prefix."""
    return f"{BACKEND_ROOT_PATH}{path}" if BACKEND_ROOT_PATH else path


app = FastAPI(
    title="LLM Council API",
    docs_url=_prefixed_path("/docs"),
    redoc_url=_prefixed_path("/redoc"),
    openapi_url=_prefixed_path("/openapi.json"),
)
router = APIRouter()

# Enable CORS for browser clients (configured via .env CORS_ALLOW_ORIGINS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginRequest(BaseModel):
    """Request to login."""

    email: str
    password: str


class LoginResponse(BaseModel):
    """Response from login."""

    access_token: str
    token_type: str = "bearer"
    user: dict


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class AttachmentIn(BaseModel):
    """A file attachment sent with a message."""
    name: str
    content: str


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str = ""
    attachments: List[AttachmentIn] | None = None
    models: List[str] | None = None
    chairman_model: str | None = None
    language: str | None = None
    base_system_prompt: str | None = None
    enable_second_round: bool = False
    continue_last_assistant_round: bool = False
    retry_stage3: bool = False
    attach_only: bool = False


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int
    job_status: str | None = None
    job_stage: str | None = None
    job_progress: float | None = None


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]


class CouncilSettingsRequest(BaseModel):
    """Request to set user's council settings."""
    personal_prompt: str
    template_id: str = "custom"
    base_system_prompt: str = ""
    base_system_prompt_id: str = "custom"


class CouncilSettingsResponse(BaseModel):
    """Response with user's council settings."""
    personal_prompt: str
    template_id: str
    base_system_prompt: str
    base_system_prompt_id: str


@router.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@router.get("/api/agora-eval-files/{token}/{filename}")
async def get_agora_eval_file(token: str, filename: str):
    """Serve temporary anonymized response files for Agora RAG fetching."""
    file_path = resolve_eval_file(token, filename)
    if file_path is None:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        file_path,
        media_type="text/markdown; charset=utf-8",
        filename=filename,
    )


@router.post("/api/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Authenticate user and return JWT token."""
    try:
        user = await authenticate_user(request.email, request.password)
    except Exception as e:
        logger.error(f"Authentication error: {e}")
        raise HTTPException(status_code=500, detail="Authentication service error")

    if user is None:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Get user_id, fallback to string representation of MongoDB _id
    user_id = user.get("user_id")
    if not user_id:
        user_id = str(user.get("_id", ""))

    token_data = {
        "user_id": user_id,
        "username": user.get("username", ""),
        "email": user.get("email", ""),
        "roles": user.get("roles", []),
    }
    access_token = create_access_token(token_data)

    return LoginResponse(
        access_token=access_token,
        user={
            "user_id": token_data["user_id"],
            "username": token_data["username"],
            "email": token_data["email"],
            "roles": token_data["roles"],
        },
    )


@router.get("/api/auth/me")
async def get_me(
    request: Request,
    user: User | None = Depends(get_current_user_optional),
):
    """Get current authenticated user or check if IP is bypassed."""
    client_ip = get_client_ip(request)
    ip_bypassed = is_ip_allowed(client_ip)

    if user is None:
        return {
            "authenticated": False,
            "ip_bypassed": ip_bypassed,
            "user": None,
        }

    return {
        "authenticated": True,
        "ip_bypassed": user.is_bypassed,
        "user": {
            "user_id": user.user_id,
            "username": user.username,
            "email": user.email,
            "roles": user.roles,
        },
    }


@router.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations(user: User = Depends(get_current_user)):
    """List all conversations (metadata only)."""
    return job_manager.apply_statuses(
        user.user_id,
        storage.list_conversations(user.user_id),
    )


@router.get("/api/models")
async def list_models():
    """Return available council and chairman models."""
    return {
        "council_models": COUNCIL_MODELS,
        "chairman_model": CHAIRMAN_MODEL,
        "default_preferred_models": DEFAULT_PREFERRED_MODELS,
    }


@router.get("/api/personalization-templates")
async def get_personalization_templates():
    """Return available personalization prompt templates."""
    return {"templates": list(PERSONALIZATION_TEMPLATES.values())}


@router.get("/api/council-identity-templates")
async def get_council_identity_templates():
    """Return available council identity templates."""
    return {"templates": list(COUNCIL_IDENTITY_TEMPLATES.values())}


@router.get("/api/user/council-settings", response_model=CouncilSettingsResponse)
async def get_council_settings(user: User = Depends(get_current_user)):
    """Get user's council settings."""
    settings = await get_user_council_settings(user.user_id)
    return CouncilSettingsResponse(
        personal_prompt=settings["personal_prompt"],
        template_id=settings["template_id"],
        base_system_prompt=settings["base_system_prompt"],
        base_system_prompt_id=settings["base_system_prompt_id"],
    )


@router.post("/api/user/council-settings", response_model=CouncilSettingsResponse)
async def update_council_settings(
    request: CouncilSettingsRequest,
    user: User = Depends(get_current_user),
):
    """Update user's council settings."""
    settings = await set_user_council_settings(
        user.user_id,
        request.personal_prompt,
        request.template_id,
        request.base_system_prompt,
        request.base_system_prompt_id,
    )
    return CouncilSettingsResponse(
        personal_prompt=settings["personal_prompt"],
        template_id=settings["template_id"],
        base_system_prompt=settings["base_system_prompt"],
        base_system_prompt_id=settings["base_system_prompt_id"],
    )


@router.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest, user: User = Depends(get_current_user)):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(user.user_id, conversation_id)
    return conversation


@router.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str, user: User = Depends(get_current_user)):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(user.user_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.get("/api/conversations/{conversation_id}/job")
async def get_conversation_job(conversation_id: str, user: User = Depends(get_current_user)):
    """Get the in-memory background job status for a conversation."""
    conversation = storage.get_conversation(user.user_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return job_manager.snapshot(user.user_id, conversation_id)


@router.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, user: User = Depends(get_current_user)):
    """Delete a specific conversation."""
    await job_manager.cancel_conversation(user.user_id, conversation_id)
    deleted = storage.delete_conversation(user.user_id, conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": True}


@router.delete("/api/conversations")
async def delete_all_conversations(user: User = Depends(get_current_user)):
    """Delete all conversations for the current session."""
    await job_manager.cancel_all_for_user(user.user_id)
    count = storage.delete_all_conversations(user.user_id)
    return {"deleted_count": count}


class ShareRequest(BaseModel):
    """Request to share an answer."""
    message_index: int = 0
    requires_login: bool = False


@router.post("/api/conversations/{conversation_id}/share")
async def share_answer(
    conversation_id: str,
    request: ShareRequest,
    user: User = Depends(get_current_user),
):
    """Create a shareable snapshot of a conversation's final answer."""
    conversation = storage.get_conversation(user.user_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = conversation.get("messages") or []
    # Find the last assistant message with a stage3 response.
    index = request.message_index
    if index < 0:
        index = len(messages) - 1
    if index < 0 or index >= len(messages):
        raise HTTPException(status_code=400, detail="No message to share")

    try:
        result = create_shared_answer(
            user_id=user.user_id,
            conversation=conversation,
            message_index=index,
            requires_login=request.requires_login,
            author=user.username or user.email or "",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return result


@router.get("/api/shared/{token}")
async def get_shared(
    token: str,
    user: Optional[User] = Depends(get_current_user_optional),
):
    """Public endpoint to fetch a shared answer snapshot."""
    snapshot = get_shared_answer(token)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Shared answer not found")

    if snapshot.get("requires_login") and not user:
        raise HTTPException(status_code=401, detail="Login required to view this answer")

    return snapshot


def _validated_attachments(request: "SendMessageRequest") -> List[dict]:
    """Normalize and validate request attachments, raising HTTP 400 on failure."""
    attachments = normalize_attachments([
        {"name": item.name, "content": item.content}
        for item in (request.attachments or [])
    ])
    try:
        validate_attachments(attachments)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return attachments


@router.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest, user: User = Depends(get_current_user)):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    if request.continue_last_assistant_round:
        raise HTTPException(
            status_code=400,
            detail="Next round continuation is only supported via the streaming endpoint.",
        )

    if request.models is not None and len(request.models) == 0:
        raise HTTPException(status_code=400, detail="At least one model must be selected.")
    attachments = _validated_attachments(request)
    if not request.content.strip() and not attachments:
        raise HTTPException(status_code=400, detail="Message content is required.")

    # Check if conversation exists
    conversation = storage.get_conversation(user.user_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if storage.count_user_messages(conversation) >= MAX_USER_QUESTIONS_PER_CONVERSATION:
        raise HTTPException(
            status_code=400,
            detail=(
                f"This conversation is limited to "
                f"{MAX_USER_QUESTIONS_PER_CONVERSATION} questions. "
                "Start a new conversation to continue."
            ),
        )

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Get user's council settings
    council_settings = await get_user_council_settings(user.user_id)
    personal_prompt = council_settings.get("personal_prompt", "")

    # Use request base_system_prompt if provided, otherwise use user's saved one, otherwise None (which will fallback to default)
    base_system_prompt = request.base_system_prompt or council_settings.get("base_system_prompt")

    # Add user message
    storage.add_user_message(user.user_id, conversation_id, request.content, attachments=attachments)

    # Process links in message
    enriched_content, link_metadata, scrape_status = await process_message_links(request.content)

    # Build attachment-aware query variants: inline blocks for standard
    # models, hosted file URLs for Agora (fetched as proper attachments)
    standard_query = enriched_content + build_inline_attachment_block(attachments)
    agora_query = standard_query
    attachment_token = None
    attachment_tmp_dir = None
    models_for_query = request.models or COUNCIL_MODELS
    if attachments and any(is_agora_model(model) for model in models_for_query):
        attachment_token, attachment_tmp_dir, file_urls = create_attachment_files(attachments)
        agora_query = enriched_content + build_agora_attachment_block(file_urls)

    # Prior completed turns (user + stage3) — snapshot before this user message.
    standard_query = apply_conversation_history(standard_query, conversation)
    agora_query = apply_conversation_history(agora_query, conversation)

    try:
        # If this is the first message, generate a title
        if is_first_message:
            title = await generate_conversation_title(request.content)
            storage.update_conversation_title(user.user_id, conversation_id, title)

        # Run the 3-stage council process
        stage1_results, stage2_results, stage3_result, metadata, rounds = await run_full_council(
            standard_query,
            models=request.models,
            chairman_model=request.chairman_model,
            language=request.language,
            personal_prompt=personal_prompt,
            base_system_prompt=base_system_prompt,
            enable_second_round=request.enable_second_round,
            agora_user_query=agora_query,
        )

        # Add assistant message with all stages
        storage.add_assistant_message(
            user.user_id,
            conversation_id,
            stage1_results,
            stage2_results,
            stage3_result,
            metadata=metadata,
            rounds=rounds,
            scraped_links=link_metadata,
        )

        # Return the complete response with metadata
        return {
            "stage1": stage1_results,
            "stage2": stage2_results,
            "stage3": stage3_result,
            "metadata": metadata,
            "rounds": rounds,
        }
    finally:
        cleanup_attachment_files(attachment_token, attachment_tmp_dir)


@router.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest, user: User = Depends(get_current_user)):
    """
    Start or attach to a background council job and stream its events.
    """
    if request.models is not None and len(request.models) == 0:
        raise HTTPException(status_code=400, detail="At least one model must be selected.")
    _validated_attachments(request)

    user_id = user.user_id
    conversation = storage.get_conversation(user_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    council_settings = await get_user_council_settings(user_id)
    personal_prompt = council_settings.get("personal_prompt", "")
    base_system_prompt_to_use = request.base_system_prompt or council_settings.get("base_system_prompt")
    request_payload = request.model_dump()

    try:
        job = await job_manager.start_or_attach(
            user_id=user_id,
            conversation_id=conversation_id,
            request_payload=request_payload,
            personal_prompt=personal_prompt,
            base_system_prompt=base_system_prompt_to_use,
            is_first_message=len(conversation["messages"]) == 0,
            conversation=conversation,
            attach_only=request.attach_only,
        )
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (JobConflictError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    def sse_json(data: dict) -> str:
        """Serialize data to JSON for SSE, ensuring proper escaping."""
        return json.dumps(data, ensure_ascii=False, separators=(",", ":"))

    async def event_generator():
        queue = job.subscribe()
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    continue

                yield f"data: {sse_json(event)}\n\n"
                if event.get("type") in {"complete", "error"} and not job.active:
                    break
        finally:
            job.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


API_PREFIX = BACKEND_ROOT_PATH or ""
app.include_router(router, prefix=API_PREFIX)


if __name__ == "__main__":
    import uvicorn

    # Allow overriding the listening port via BACKEND_PORT for local runs
    backend_port = int(os.getenv("BACKEND_PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=backend_port)
