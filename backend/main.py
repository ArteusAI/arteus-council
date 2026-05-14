"""FastAPI backend for LLM Council."""

import os
import uuid
import json
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, BackgroundTasks, Depends, FastAPI, HTTPException, Request

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("llm-council")
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any

from . import storage
from . import leads_storage
from .agora_eval_files import resolve_eval_file
from .auth import (
    LeadUser,
    User,
    authenticate_user,
    create_access_token,
    create_leads_token,
    get_client_ip,
    get_current_lead,
    get_current_lead_optional,
    get_current_user,
    get_current_user_optional,
    get_user_council_settings,
    is_ip_allowed,
    set_user_council_settings,
)
from .config import (
    DISABLE_RUSSIAN_LANGUAGE,
    END_CONFERENCE_MODE,
    COUNCIL_MODELS,
    CHAIRMAN_MODEL,
    DEFAULT_PREFERRED_MODELS,
    CORS_ALLOW_ORIGINS,
    BACKEND_ROOT_PATH,
    LEADS_FIXED_IDENTITY_ID,
    LEADS_MODE,
    LEADS_CHAIRMAN_MODEL,
    MODEL_ALIASES,
    PERSONALIZATION_TEMPLATES,
    COUNCIL_IDENTITY_TEMPLATES,
)
from .council import (
    generate_conversation_title,
    run_full_council,
)
from .firecrawl import extract_urls, process_message_links
from . import http_client
from .job_storage import LeadsJobStorage, LocalJobStorage
from .jobs import CouncilJob, JobConflictError, JobNotFoundError, job_manager
from .openrouter import check_api_limits


def _prefixed_path(path: str) -> str:
    """Return a docs/OpenAPI path with the configured prefix."""
    return f"{BACKEND_ROOT_PATH}{path}" if BACKEND_ROOT_PATH else path


def _format_lead_contact(
    email: str | None,
    telegram: str | None,
    linkedin: str | None,
) -> str:
    """Build a short contact summary like 'email=a@b.com telegram=- linkedin=foo'."""
    return (
        f"email={email or '-'} telegram={telegram or '-'} linkedin={linkedin or '-'}"
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage shared resources (httpx pool) for the app lifetime."""
    await http_client.startup()
    try:
        yield
    finally:
        await http_client.shutdown()


app = FastAPI(
    title="LLM Council API",
    docs_url=_prefixed_path("/docs"),
    redoc_url=_prefixed_path("/redoc"),
    openapi_url=_prefixed_path("/openapi.json"),
    lifespan=lifespan,
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


@app.middleware("http")
async def END_CONFERENCE_MODE_middleware(request: Request, call_next):
    """Block most requests when conference mode is enabled."""
    if END_CONFERENCE_MODE:
        allowed_paths = ["/api/config", "/", "/docs", "/redoc", "/openapi.json"]
        path = request.url.path
        # Check if path is allowed (with or without root path prefix)
        is_allowed = any(
            path == p or path == f"{BACKEND_ROOT_PATH}{p}"
            for p in allowed_paths
        )
        if not is_allowed:
            logger.info(f"Conference mode: blocked request to {path}")
            return JSONResponse(
                status_code=503,
                content={"detail": "Service temporarily unavailable - conference mode"}
            )
    return await call_next(request)


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


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str = ""
    models: List[str] | None = None
    chairman_model: str | None = None
    language: str | None = None
    base_system_prompt: str | None = None
    enable_second_round: bool = False
    continue_last_assistant_round: bool = False
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


class LeadsRegisterRequest(BaseModel):
    """Request to register as a lead."""
    email: str | None = None
    telegram: str | None = None
    linkedin: str | None = None


class LeadsRegisterResponse(BaseModel):
    """Response from lead registration."""
    access_token: str
    token_type: str = "bearer"
    session_id: str
    email: str | None = None
    telegram: str | None = None
    linkedin: str | None = None


class ConfigResponse(BaseModel):
    """Application configuration response."""
    leads_mode: bool
    fixed_identity_id: str | None = None
    END_CONFERENCE_MODE: bool = False
    conference_mode_reason: str | None = None
    disable_russian_language: bool = False


@router.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@router.get("/api/config", response_model=ConfigResponse)
async def get_config():
    """Return application configuration including mode information."""
    # Check OpenRouter API limits
    limits = await check_api_limits()
    
    # Activate conference mode if limits are exhausted OR if manually enabled
    conference_active = END_CONFERENCE_MODE or limits['exhausted']
    
    # Determine the reason for conference mode
    reason = None
    if conference_active:
        if limits['exhausted']:
            reason = 'api_limits_exhausted'
            logger.warning(f"Conference mode activated: API limits exhausted (remaining: {limits['limit_remaining']})")
        elif END_CONFERENCE_MODE:
            reason = 'manual'
    
    return ConfigResponse(
        leads_mode=LEADS_MODE,
        fixed_identity_id=LEADS_FIXED_IDENTITY_ID if LEADS_MODE else None,
        END_CONFERENCE_MODE=conference_active,
        conference_mode_reason=reason,
        disable_russian_language=DISABLE_RUSSIAN_LANGUAGE,
    )


@router.post("/api/leads/register", response_model=LeadsRegisterResponse)
async def register_lead(request: LeadsRegisterRequest):
    """Register a new lead and return session token (leads mode only)."""
    if not LEADS_MODE:
        raise HTTPException(status_code=400, detail="Leads mode is not enabled")

    if not request.email and not request.telegram and not request.linkedin:
        raise HTTPException(
            status_code=400,
            detail="At least one of email, telegram or linkedin is required"
        )

    try:
        lead = await leads_storage.register_lead(
            request.email, request.telegram, request.linkedin
        )
        session_id = lead["session_id"]
        access_token = create_leads_token(
            session_id, request.email, request.telegram, request.linkedin
        )

        logger.info(
            "LEAD LOGIN session=%s %s",
            session_id,
            _format_lead_contact(request.email, request.telegram, request.linkedin),
        )

        return LeadsRegisterResponse(
            access_token=access_token,
            session_id=session_id,
            email=request.email,
            telegram=request.telegram,
            linkedin=request.linkedin,
        )
    except Exception as e:
        logger.error(f"Lead registration error: {e}")
        raise HTTPException(status_code=500, detail="Registration failed")


@router.get("/api/leads/me")
async def get_lead_me(lead: LeadUser = Depends(get_current_lead)):
    """Get current lead user information (leads mode only)."""
    return {
        "authenticated": True,
        "session_id": lead.session_id,
        "email": lead.email,
        "telegram": lead.telegram,
        "linkedin": lead.linkedin,
    }


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
        await asyncio.to_thread(storage.list_conversations, user.user_id),
    )


@router.get("/api/models")
async def list_models():
    """Return available council and chairman models with display aliases."""
    return {
        "council_models": COUNCIL_MODELS,
        "chairman_model": LEADS_CHAIRMAN_MODEL if LEADS_MODE else CHAIRMAN_MODEL,
        "default_preferred_models": DEFAULT_PREFERRED_MODELS,
        "model_aliases": MODEL_ALIASES,
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
    conversation = await asyncio.to_thread(
        storage.create_conversation, user.user_id, conversation_id
    )
    return conversation


@router.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str, user: User = Depends(get_current_user)):
    """Get a specific conversation with all its messages."""
    conversation = await asyncio.to_thread(
        storage.get_conversation, user.user_id, conversation_id
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.get("/api/conversations/{conversation_id}/job")
async def get_conversation_job(conversation_id: str, user: User = Depends(get_current_user)):
    """Get the in-memory background job status for a conversation."""
    conversation = await asyncio.to_thread(
        storage.get_conversation, user.user_id, conversation_id
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return job_manager.snapshot(user.user_id, conversation_id)


@router.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, user: User = Depends(get_current_user)):
    """Delete a specific conversation."""
    await job_manager.cancel_conversation(user.user_id, conversation_id)
    deleted = await asyncio.to_thread(
        storage.delete_conversation, user.user_id, conversation_id
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": True}


@router.delete("/api/conversations")
async def delete_all_conversations(user: User = Depends(get_current_user)):
    """Delete all conversations for the current session."""
    await job_manager.cancel_all_for_user(user.user_id)
    count = await asyncio.to_thread(
        storage.delete_all_conversations, user.user_id
    )
    return {"deleted_count": count}


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
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="Message content is required.")

    conversation = await asyncio.to_thread(
        storage.get_conversation, user.user_id, conversation_id
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    is_first_message = len(conversation["messages"]) == 0

    council_settings = await get_user_council_settings(user.user_id)
    personal_prompt = council_settings.get("personal_prompt", "")
    base_system_prompt = request.base_system_prompt or council_settings.get("base_system_prompt")

    await asyncio.to_thread(
        storage.add_user_message, user.user_id, conversation_id, request.content
    )

    # Title generation runs concurrently with link scraping + the council
    # itself to avoid serializing two LLM calls.
    title_task: asyncio.Task | None = None
    if is_first_message:
        title_task = asyncio.create_task(generate_conversation_title(request.content))

    enriched_content, link_metadata, scrape_status = await process_message_links(request.content)

    stage1_results, stage2_results, stage3_result, metadata, rounds = await run_full_council(
        enriched_content,
        models=request.models,
        chairman_model=request.chairman_model,
        language=request.language,
        personal_prompt=personal_prompt,
        base_system_prompt=base_system_prompt,
        enable_second_round=request.enable_second_round,
    )

    if title_task is not None:
        try:
            title = await title_task
            await asyncio.to_thread(
                storage.update_conversation_title, user.user_id, conversation_id, title
            )
        except Exception as exc:
            logger.warning("Failed to generate/save conversation title: %s", exc)

    await asyncio.to_thread(
        storage.add_assistant_message,
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


@router.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest, user: User = Depends(get_current_user)):
    """
    Start or attach to a background council job and stream its events.
    """
    if request.models is not None and len(request.models) == 0:
        raise HTTPException(status_code=400, detail="At least one model must be selected.")

    user_id = user.user_id
    conversation = await asyncio.to_thread(
        storage.get_conversation, user_id, conversation_id
    )
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
            storage=LocalJobStorage(),
            attach_only=request.attach_only,
        )
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (JobConflictError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _stream_council_job(job)


def _sse_json(data: dict) -> str:
    """Serialize data to JSON for SSE, ensuring proper escaping."""
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def _stream_council_job(job: CouncilJob) -> StreamingResponse:
    """Wrap a ``CouncilJob`` event stream in an SSE ``StreamingResponse``.

    The generator only reads from the job's subscriber queue, so dropping the
    client connection unsubscribes us but never cancels the underlying task.
    """

    async def event_generator():
        queue = job.subscribe()
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    continue

                yield f"data: {_sse_json(event)}\n\n"
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


# ============================================================================
# Leads Mode Conversation Endpoints
# ============================================================================

@router.get("/api/leads/conversations", response_model=List[ConversationMetadata])
async def list_leads_conversations(lead: LeadUser = Depends(get_current_lead)):
    """List all conversations for a lead (leads mode only)."""
    conversations = await leads_storage.list_conversations(lead.session_id)
    return job_manager.apply_statuses(lead.session_id, conversations)


@router.post("/api/leads/conversations", response_model=Conversation)
async def create_leads_conversation(
    request: CreateConversationRequest,
    lead: LeadUser = Depends(get_current_lead),
):
    """Create a new conversation for a lead (leads mode only)."""
    conversation_id = str(uuid.uuid4())
    conversation = await leads_storage.create_conversation(lead.session_id, conversation_id)
    return conversation


@router.get("/api/leads/conversations/{conversation_id}", response_model=Conversation)
async def get_leads_conversation(
    conversation_id: str,
    lead: LeadUser = Depends(get_current_lead),
):
    """Get a specific conversation for a lead (leads mode only)."""
    conversation = await leads_storage.get_conversation(lead.session_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.get("/api/leads/conversations/{conversation_id}/job")
async def get_leads_conversation_job(
    conversation_id: str,
    lead: LeadUser = Depends(get_current_lead),
):
    """Get the in-memory background job status for a lead conversation."""
    conversation = await leads_storage.get_conversation(lead.session_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return job_manager.snapshot(lead.session_id, conversation_id)


@router.delete("/api/leads/conversations/{conversation_id}")
async def delete_leads_conversation(
    conversation_id: str,
    lead: LeadUser = Depends(get_current_lead),
):
    """Delete a specific conversation for a lead (leads mode only)."""
    await job_manager.cancel_conversation(lead.session_id, conversation_id)
    deleted = await leads_storage.delete_conversation(lead.session_id, conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": True}


@router.delete("/api/leads/conversations")
async def delete_all_leads_conversations(lead: LeadUser = Depends(get_current_lead)):
    """Delete all conversations for a lead (leads mode only)."""
    await job_manager.cancel_all_for_user(lead.session_id)
    count = await leads_storage.delete_all_conversations(lead.session_id)
    return {"deleted_count": count}


@router.get("/api/leads/council-settings", response_model=CouncilSettingsResponse)
async def get_leads_council_settings(lead: LeadUser = Depends(get_current_lead)):
    """Get council settings for a lead user."""
    settings = await leads_storage.get_lead_council_settings(lead.session_id)
    return CouncilSettingsResponse(
        personal_prompt=settings["personal_prompt"],
        template_id=settings["template_id"],
        base_system_prompt="",  # Leads use fixed identity, no base prompt customization
        base_system_prompt_id="",
    )


@router.post("/api/leads/council-settings", response_model=CouncilSettingsResponse)
async def update_leads_council_settings(
    request: CouncilSettingsRequest,
    lead: LeadUser = Depends(get_current_lead),
):
    """Update council settings for a lead user."""
    await leads_storage.set_lead_council_settings(
        lead.session_id,
        request.personal_prompt,
        request.template_id,
    )
    return CouncilSettingsResponse(
        personal_prompt=request.personal_prompt,
        template_id=request.template_id,
        base_system_prompt="",
        base_system_prompt_id="",
    )


@router.post("/api/leads/conversations/{conversation_id}/message/stream")
async def send_leads_message_stream(
    conversation_id: str,
    request: SendMessageRequest,
    lead: LeadUser = Depends(get_current_lead),
):
    """Start or attach to a background council job for a lead and stream events."""
    if request.models is not None and len(request.models) == 0:
        raise HTTPException(status_code=400, detail="At least one model must be selected.")

    session_id = lead.session_id

    conversation = await leads_storage.get_conversation(session_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    fixed_identity = COUNCIL_IDENTITY_TEMPLATES.get(LEADS_FIXED_IDENTITY_ID, {})
    base_system_prompt_to_use = fixed_identity.get("prompt", "")

    lead_settings = await leads_storage.get_lead_council_settings(session_id)
    personal_prompt = lead_settings.get("personal_prompt", "")

    # Leads flow does not expose multi-round deliberation or continuation;
    # strip those flags before handing the payload to the job runner.
    request_payload = request.model_dump()
    request_payload["enable_second_round"] = False
    request_payload["continue_last_assistant_round"] = False

    if not request.attach_only:
        content_preview = (request.content or "").strip().replace("\n", " ")
        if len(content_preview) > 200:
            content_preview = content_preview[:200] + "..."
        urls = extract_urls(request.content or "")
        logger.info(
            "LEAD REQUEST session=%s %s conv=%s urls=%s content=%r",
            session_id,
            _format_lead_contact(lead.email, lead.telegram, lead.linkedin),
            conversation_id,
            urls or "-",
            content_preview,
        )

    try:
        job = await job_manager.start_or_attach(
            user_id=session_id,
            conversation_id=conversation_id,
            request_payload=request_payload,
            personal_prompt=personal_prompt,
            base_system_prompt=base_system_prompt_to_use,
            is_first_message=len(conversation["messages"]) == 0,
            conversation=conversation,
            storage=LeadsJobStorage(),
            attach_only=request.attach_only,
        )
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (JobConflictError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _stream_council_job(job)


API_PREFIX = BACKEND_ROOT_PATH or ""
app.include_router(router, prefix=API_PREFIX)


if __name__ == "__main__":
    import uvicorn

    # Allow overriding the listening port via BACKEND_PORT for local runs
    backend_port = int(os.getenv("BACKEND_PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=backend_port)
