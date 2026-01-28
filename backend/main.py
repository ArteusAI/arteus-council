"""FastAPI backend for LLM Council."""

import os
import uuid
import json
import asyncio
import logging
import time

from fastapi import APIRouter, BackgroundTasks, Depends, FastAPI, HTTPException, Request

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("llm-council")
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any

from . import storage
from . import leads_storage
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
    run_full_council,
    generate_conversation_title,
    stage1_collect_responses,
    stage2_collect_rankings,
    stage3_synthesize_final,
    calculate_aggregate_rankings,
)
from .firecrawl import extract_urls, process_message_links


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


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str
    models: List[str] | None = None
    chairman_model: str | None = None
    language: str | None = None
    base_system_prompt: str | None = None


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


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


class LeadsRegisterResponse(BaseModel):
    """Response from lead registration."""
    access_token: str
    token_type: str = "bearer"
    session_id: str
    email: str | None = None
    telegram: str | None = None


class ConfigResponse(BaseModel):
    """Application configuration response."""
    leads_mode: bool
    fixed_identity_id: str | None = None


@router.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@router.get("/api/config", response_model=ConfigResponse)
async def get_config():
    """Return application configuration including mode information."""
    return ConfigResponse(
        leads_mode=LEADS_MODE,
        fixed_identity_id=LEADS_FIXED_IDENTITY_ID if LEADS_MODE else None,
    )


@router.post("/api/leads/register", response_model=LeadsRegisterResponse)
async def register_lead(request: LeadsRegisterRequest):
    """Register a new lead and return session token (leads mode only)."""
    if not LEADS_MODE:
        raise HTTPException(status_code=400, detail="Leads mode is not enabled")

    if not request.email and not request.telegram:
        raise HTTPException(
            status_code=400,
            detail="At least one of email or telegram is required"
        )

    try:
        lead = await leads_storage.register_lead(request.email, request.telegram)
        session_id = lead["session_id"]
        access_token = create_leads_token(session_id, request.email, request.telegram)

        return LeadsRegisterResponse(
            access_token=access_token,
            session_id=session_id,
            email=request.email,
            telegram=request.telegram,
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
    }


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
    return storage.list_conversations(user.user_id)


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
    conversation = storage.create_conversation(user.user_id, conversation_id)
    return conversation


@router.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str, user: User = Depends(get_current_user)):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(user.user_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, user: User = Depends(get_current_user)):
    """Delete a specific conversation."""
    deleted = storage.delete_conversation(user.user_id, conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": True}


@router.delete("/api/conversations")
async def delete_all_conversations(user: User = Depends(get_current_user)):
    """Delete all conversations for the current session."""
    count = storage.delete_all_conversations(user.user_id)
    return {"deleted_count": count}


@router.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest, user: User = Depends(get_current_user)):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    if request.models is not None and len(request.models) == 0:
        raise HTTPException(status_code=400, detail="At least one model must be selected.")

    # Check if conversation exists
    conversation = storage.get_conversation(user.user_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Get user's council settings
    council_settings = await get_user_council_settings(user.user_id)
    personal_prompt = council_settings.get("personal_prompt", "")
    
    # Use request base_system_prompt if provided, otherwise use user's saved one, otherwise None (which will fallback to default)
    base_system_prompt = request.base_system_prompt or council_settings.get("base_system_prompt")

    # Add user message
    storage.add_user_message(user.user_id, conversation_id, request.content)

    # Process links in message
    enriched_content, link_metadata, scrape_status = await process_message_links(request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(user.user_id, conversation_id, title)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        enriched_content,
        models=request.models,
        chairman_model=request.chairman_model,
        language=request.language,
        personal_prompt=personal_prompt,
        base_system_prompt=base_system_prompt,
    )

    # Add assistant message with all stages
    storage.add_assistant_message(
        user.user_id,
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result
    )

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


@router.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest, user: User = Depends(get_current_user)):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events as each stage completes.
    """
    if request.models is not None and len(request.models) == 0:
        raise HTTPException(status_code=400, detail="At least one model must be selected.")

    # Capture user_id for use in the generator
    user_id = user.user_id

    # Check if conversation exists
    conversation = storage.get_conversation(user_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Get user's council settings (before entering generator)
    council_settings = await get_user_council_settings(user_id)
    personal_prompt = council_settings.get("personal_prompt", "")
    base_system_prompt_to_use = request.base_system_prompt or council_settings.get("base_system_prompt")

    def sse_json(data: dict) -> str:
        """Serialize data to JSON for SSE, ensuring proper escaping."""
        return json.dumps(data, ensure_ascii=False, separators=(',', ':'))

    # Heartbeat interval to keep connection alive (proxy timeout is usually 60s)
    HEARTBEAT_INTERVAL = 15.0

    async def event_generator():
        request_start = time.time()
        logger.info(f"[{conversation_id[:8]}] Stream started, models={request.models}, content_len={len(request.content)}")
        
        # Track all running tasks for cleanup on cancellation
        running_tasks = []
        
        try:
            models_to_use = request.models or None
            chairman_to_use = request.chairman_model or None

            # Add user message
            storage.add_user_message(user_id, conversation_id, request.content)

            # Process links in message
            urls = extract_urls(request.content)
            enriched_content = request.content
            link_metadata = []
            
            if urls:
                logger.info(f"[{conversation_id[:8]}] Scraping {len(urls)} URLs...")
                yield f"data: {sse_json({'type': 'scraping_start', 'data': {'urls': urls}})}\n\n"
                
                try:
                    # Scraping with timeout to avoid blocking indefinitely
                    scraping_task = asyncio.create_task(process_message_links(request.content))
                    running_tasks.append(scraping_task)
                    while not scraping_task.done():
                        try:
                            await asyncio.wait_for(asyncio.shield(scraping_task), timeout=HEARTBEAT_INTERVAL)
                        except asyncio.TimeoutError:
                            yield f": heartbeat\n\n"
                    
                    enriched_content, link_metadata, scrape_status = scraping_task.result()
                    logger.info(f"[{conversation_id[:8]}] Scraping complete: {len(link_metadata)} links processed")
                    yield f"data: {sse_json({'type': 'scraping_complete', 'data': {'links': link_metadata}})}\n\n"
                except Exception as e:
                    logger.error(f"[{conversation_id[:8]}] Scraping error: {e}")
                    yield f"data: {sse_json({'type': 'scraping_error', 'message': str(e)})}\n\n"

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(request.content))
                running_tasks.append(title_task)

            # Stage 1: Collect responses
            stage1_start = time.time()
            logger.info(f"[{conversation_id[:8]}] Stage 1 starting...")
            
            # Track completed models using a simple list
            completed_stage1_models = []
            
            def stage1_callback(model, response):
                completed_stage1_models.append(model)

            yield f"data: {sse_json({'type': 'stage1_start', 'data': {'models': models_to_use or COUNCIL_MODELS}})}\n\n"
            
            stage1_task = asyncio.create_task(stage1_collect_responses(
                enriched_content,
                models=models_to_use,
                language=request.language,
                base_system_prompt=base_system_prompt_to_use,
                on_model_complete=stage1_callback
            ))
            running_tasks.append(stage1_task)
            
            last_reported_count = 0
            while not stage1_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(stage1_task), timeout=HEARTBEAT_INTERVAL)
                except asyncio.TimeoutError:
                    # Send updates for any newly completed models
                    while last_reported_count < len(completed_stage1_models):
                        model = completed_stage1_models[last_reported_count]
                        yield f"data: {sse_json({'type': 'stage1_model_complete', 'data': {'model': model}})}\n\n"
                        last_reported_count += 1
                    yield f": heartbeat\n\n"
            
            # Send any remaining model completions
            while last_reported_count < len(completed_stage1_models):
                model = completed_stage1_models[last_reported_count]
                yield f"data: {sse_json({'type': 'stage1_model_complete', 'data': {'model': model}})}\n\n"
                last_reported_count += 1

            stage1_results = stage1_task.result()
            
            stage1_duration = time.time() - stage1_start
            logger.info(f"[{conversation_id[:8]}] Stage 1 complete in {stage1_duration:.1f}s, {len(stage1_results)} responses")
            yield f"data: {sse_json({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2: Collect rankings
            stage2_start = time.time()
            logger.info(f"[{conversation_id[:8]}] Stage 2 starting...")
            
            completed_stage2_models = []
            
            def stage2_callback(model, response):
                completed_stage2_models.append(model)

            yield f"data: {sse_json({'type': 'stage2_start', 'data': {'models': models_to_use or COUNCIL_MODELS}})}\n\n"
            
            stage2_task = asyncio.create_task(stage2_collect_rankings(
                enriched_content,
                stage1_results,
                models=models_to_use,
                language=request.language,
                base_system_prompt=base_system_prompt_to_use,
                on_model_complete=stage2_callback
            ))
            running_tasks.append(stage2_task)
            
            last_reported_count = 0
            while not stage2_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(stage2_task), timeout=HEARTBEAT_INTERVAL)
                except asyncio.TimeoutError:
                    while last_reported_count < len(completed_stage2_models):
                        model = completed_stage2_models[last_reported_count]
                        yield f"data: {sse_json({'type': 'stage2_model_complete', 'data': {'model': model}})}\n\n"
                        last_reported_count += 1
                    yield f": heartbeat\n\n"

            while last_reported_count < len(completed_stage2_models):
                model = completed_stage2_models[last_reported_count]
                yield f"data: {sse_json({'type': 'stage2_model_complete', 'data': {'model': model}})}\n\n"
                last_reported_count += 1

            stage2_results, label_to_model = stage2_task.result()
            
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            stage2_duration = time.time() - stage2_start
            logger.info(f"[{conversation_id[:8]}] Stage 2 complete in {stage2_duration:.1f}s, {len(stage2_results)} rankings")
            yield f"data: {sse_json({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3: Synthesize final answer
            stage3_start = time.time()
            logger.info(f"[{conversation_id[:8]}] Stage 3 starting...")
            yield f"data: {sse_json({'type': 'stage3_start'})}\n\n"
            
            stage3_task = asyncio.create_task(stage3_synthesize_final(
                enriched_content,
                stage1_results,
                stage2_results,
                chairman_model=chairman_to_use,
                language=request.language,
                personal_prompt=personal_prompt,
                base_system_prompt=base_system_prompt_to_use,
            ))
            running_tasks.append(stage3_task)
            while not stage3_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(stage3_task), timeout=HEARTBEAT_INTERVAL)
                except asyncio.TimeoutError:
                    yield f": heartbeat\n\n"
            stage3_result = stage3_task.result()
            
            stage3_duration = time.time() - stage3_start
            logger.info(f"[{conversation_id[:8]}] Stage 3 complete in {stage3_duration:.1f}s")
            yield f"data: {sse_json({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                while not title_task.done():
                    try:
                        await asyncio.wait_for(asyncio.shield(title_task), timeout=HEARTBEAT_INTERVAL)
                    except asyncio.TimeoutError:
                        yield f": heartbeat\n\n"
                title = title_task.result()
                storage.update_conversation_title(user_id, conversation_id, title)
                yield f"data: {sse_json({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Save complete assistant message
            storage.add_assistant_message(
                user_id,
                conversation_id,
                stage1_results,
                stage2_results,
                stage3_result
            )

            total_duration = time.time() - request_start
            logger.info(f"[{conversation_id[:8]}] Stream complete, total={total_duration:.1f}s")
            yield f"data: {sse_json({'type': 'complete'})}\n\n"

        except asyncio.CancelledError:
            elapsed = time.time() - request_start
            logger.warning(f"[{conversation_id[:8]}] Stream CANCELLED after {elapsed:.1f}s (client disconnected)")
            
            # Save partial results if any stages completed
            partial_stage1 = []
            partial_stage2 = []
            partial_stage3 = None
            
            # Check which tasks completed
            for task in running_tasks:
                if task.done() and not task.cancelled():
                    try:
                        # Try to identify which task this is and get its result
                        if 'stage1_task' in locals() and task is stage1_task:
                            partial_stage1 = task.result()
                        elif 'stage2_task' in locals() and task is stage2_task:
                            partial_stage2, _ = task.result()
                        elif 'stage3_task' in locals() and task is stage3_task:
                            partial_stage3 = task.result()
                    except Exception as e:
                        logger.error(f"Error getting partial result: {e}")
            
            # Save partial results if we have at least stage1 or stage3
            if partial_stage1 or partial_stage3:
                logger.info(f"[{conversation_id[:8]}] Saving partial results: stage1={len(partial_stage1)}, stage2={len(partial_stage2)}, stage3={bool(partial_stage3)}")
                storage.add_assistant_message(
                    user_id,
                    conversation_id,
                    partial_stage1,
                    partial_stage2,
                    partial_stage3 or {"model": "system", "response": "Processing was interrupted. Please refresh to retry."}
                )
            
            # Cancel all running tasks
            for task in running_tasks:
                if not task.done():
                    task.cancel()
            # Wait for tasks to be cancelled
            if running_tasks:
                await asyncio.gather(*running_tasks, return_exceptions=True)
            raise
        except Exception as e:
            elapsed = time.time() - request_start
            logger.error(f"[{conversation_id[:8]}] Stream ERROR after {elapsed:.1f}s: {type(e).__name__}: {e}")
            yield f"data: {sse_json({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering for SSE
        }
    )


# ============================================================================
# Leads Mode Conversation Endpoints
# ============================================================================

@router.get("/api/leads/conversations", response_model=List[ConversationMetadata])
async def list_leads_conversations(lead: LeadUser = Depends(get_current_lead)):
    """List all conversations for a lead (leads mode only)."""
    return await leads_storage.list_conversations(lead.session_id)


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


@router.delete("/api/leads/conversations/{conversation_id}")
async def delete_leads_conversation(
    conversation_id: str,
    lead: LeadUser = Depends(get_current_lead),
):
    """Delete a specific conversation for a lead (leads mode only)."""
    deleted = await leads_storage.delete_conversation(lead.session_id, conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": True}


@router.delete("/api/leads/conversations")
async def delete_all_leads_conversations(lead: LeadUser = Depends(get_current_lead)):
    """Delete all conversations for a lead (leads mode only)."""
    count = await leads_storage.delete_all_conversations(lead.session_id)
    return {"deleted_count": count}


@router.post("/api/leads/conversations/{conversation_id}/message/stream")
async def send_leads_message_stream(
    conversation_id: str,
    request: SendMessageRequest,
    lead: LeadUser = Depends(get_current_lead),
):
    """Send a message and stream the council process for a lead (leads mode only)."""
    if request.models is not None and len(request.models) == 0:
        raise HTTPException(status_code=400, detail="At least one model must be selected.")

    session_id = lead.session_id

    # Check if conversation exists
    conversation = await leads_storage.get_conversation(session_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    is_first_message = len(conversation["messages"]) == 0

    # In leads mode, use the fixed identity prompt
    fixed_identity = COUNCIL_IDENTITY_TEMPLATES.get(LEADS_FIXED_IDENTITY_ID, {})
    base_system_prompt_to_use = fixed_identity.get("prompt", "")
    personal_prompt = ""  # No personalization in leads mode

    def sse_json(data: dict) -> str:
        return json.dumps(data, ensure_ascii=False, separators=(',', ':'))

    HEARTBEAT_INTERVAL = 15.0

    async def event_generator():
        request_start = time.time()
        logger.info(f"[LEADS:{conversation_id[:8]}] Stream started, models={request.models}")

        running_tasks = []

        try:
            models_to_use = request.models or None
            chairman_to_use = request.chairman_model or None

            # Add user message
            await leads_storage.add_user_message(session_id, conversation_id, request.content)

            # Process links in message
            urls = extract_urls(request.content)
            enriched_content = request.content
            link_metadata = []

            if urls:
                logger.info(f"[LEADS:{conversation_id[:8]}] Scraping {len(urls)} URLs...")
                yield f"data: {sse_json({'type': 'scraping_start', 'data': {'urls': urls}})}\n\n"

                try:
                    scraping_task = asyncio.create_task(process_message_links(request.content))
                    running_tasks.append(scraping_task)
                    while not scraping_task.done():
                        try:
                            await asyncio.wait_for(asyncio.shield(scraping_task), timeout=HEARTBEAT_INTERVAL)
                        except asyncio.TimeoutError:
                            yield f": heartbeat\n\n"

                    enriched_content, link_metadata, scrape_status = scraping_task.result()
                    yield f"data: {sse_json({'type': 'scraping_complete', 'data': {'links': link_metadata}})}\n\n"
                except Exception as e:
                    logger.error(f"[LEADS:{conversation_id[:8]}] Scraping error: {e}")
                    yield f"data: {sse_json({'type': 'scraping_error', 'message': str(e)})}\n\n"

            # Start title generation in parallel
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(request.content))
                running_tasks.append(title_task)

            # Stage 1
            completed_stage1_models = []
            def stage1_callback(model, response):
                completed_stage1_models.append(model)

            yield f"data: {sse_json({'type': 'stage1_start', 'data': {'models': models_to_use or COUNCIL_MODELS}})}\n\n"

            stage1_task = asyncio.create_task(stage1_collect_responses(
                enriched_content,
                models=models_to_use,
                language=request.language,
                base_system_prompt=base_system_prompt_to_use,
                on_model_complete=stage1_callback
            ))
            running_tasks.append(stage1_task)

            last_reported_count = 0
            while not stage1_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(stage1_task), timeout=HEARTBEAT_INTERVAL)
                except asyncio.TimeoutError:
                    while last_reported_count < len(completed_stage1_models):
                        model = completed_stage1_models[last_reported_count]
                        yield f"data: {sse_json({'type': 'stage1_model_complete', 'data': {'model': model}})}\n\n"
                        last_reported_count += 1
                    yield f": heartbeat\n\n"

            while last_reported_count < len(completed_stage1_models):
                model = completed_stage1_models[last_reported_count]
                yield f"data: {sse_json({'type': 'stage1_model_complete', 'data': {'model': model}})}\n\n"
                last_reported_count += 1

            stage1_results = stage1_task.result()
            yield f"data: {sse_json({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2
            completed_stage2_models = []
            def stage2_callback(model, response):
                completed_stage2_models.append(model)

            yield f"data: {sse_json({'type': 'stage2_start', 'data': {'models': models_to_use or COUNCIL_MODELS}})}\n\n"

            stage2_task = asyncio.create_task(stage2_collect_rankings(
                enriched_content,
                stage1_results,
                models=models_to_use,
                language=request.language,
                base_system_prompt=base_system_prompt_to_use,
                on_model_complete=stage2_callback
            ))
            running_tasks.append(stage2_task)

            last_reported_count = 0
            while not stage2_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(stage2_task), timeout=HEARTBEAT_INTERVAL)
                except asyncio.TimeoutError:
                    while last_reported_count < len(completed_stage2_models):
                        model = completed_stage2_models[last_reported_count]
                        yield f"data: {sse_json({'type': 'stage2_model_complete', 'data': {'model': model}})}\n\n"
                        last_reported_count += 1
                    yield f": heartbeat\n\n"

            while last_reported_count < len(completed_stage2_models):
                model = completed_stage2_models[last_reported_count]
                yield f"data: {sse_json({'type': 'stage2_model_complete', 'data': {'model': model}})}\n\n"
                last_reported_count += 1

            stage2_results, label_to_model = stage2_task.result()
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            yield f"data: {sse_json({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3
            yield f"data: {sse_json({'type': 'stage3_start'})}\n\n"

            stage3_task = asyncio.create_task(stage3_synthesize_final(
                enriched_content,
                stage1_results,
                stage2_results,
                chairman_model=chairman_to_use,
                language=request.language,
                personal_prompt=personal_prompt,
                base_system_prompt=base_system_prompt_to_use,
            ))
            running_tasks.append(stage3_task)
            while not stage3_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(stage3_task), timeout=HEARTBEAT_INTERVAL)
                except asyncio.TimeoutError:
                    yield f": heartbeat\n\n"
            stage3_result = stage3_task.result()
            yield f"data: {sse_json({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation
            if title_task:
                while not title_task.done():
                    try:
                        await asyncio.wait_for(asyncio.shield(title_task), timeout=HEARTBEAT_INTERVAL)
                    except asyncio.TimeoutError:
                        yield f": heartbeat\n\n"
                title = title_task.result()
                await leads_storage.update_conversation_title(session_id, conversation_id, title)
                yield f"data: {sse_json({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Save assistant message
            logger.info(f"[LEADS:{conversation_id[:8]}] Saving: stage1={len(stage1_results)} items, stage2={len(stage2_results)} items, stage3={bool(stage3_result)}")
            await leads_storage.add_assistant_message(
                session_id,
                conversation_id,
                stage1_results,
                stage2_results,
                stage3_result,
                scraped_links=link_metadata if link_metadata else None,
            )

            total_duration = time.time() - request_start
            logger.info(f"[LEADS:{conversation_id[:8]}] Stream complete, total={total_duration:.1f}s")
            yield f"data: {sse_json({'type': 'complete'})}\n\n"

        except asyncio.CancelledError:
            elapsed = time.time() - request_start
            logger.warning(f"[LEADS:{conversation_id[:8]}] Stream CANCELLED after {elapsed:.1f}s")
            
            # Save partial results if any stages completed
            partial_stage1 = []
            partial_stage2 = []
            partial_stage3 = None
            
            # Check which tasks completed
            for task in running_tasks:
                if task.done() and not task.cancelled():
                    try:
                        if 'stage1_task' in locals() and task is stage1_task:
                            partial_stage1 = task.result()
                        elif 'stage2_task' in locals() and task is stage2_task:
                            partial_stage2, _ = task.result()
                        elif 'stage3_task' in locals() and task is stage3_task:
                            partial_stage3 = task.result()
                    except Exception as e:
                        logger.error(f"Error getting partial result: {e}")
            
            # Save partial results if we have at least stage1 or stage3
            if partial_stage1 or partial_stage3:
                logger.info(f"[LEADS:{conversation_id[:8]}] Saving partial results: stage1={len(partial_stage1)}, stage2={len(partial_stage2)}, stage3={bool(partial_stage3)}")
                await leads_storage.add_assistant_message(
                    session_id,
                    conversation_id,
                    partial_stage1,
                    partial_stage2,
                    partial_stage3 or {"model": "system", "response": "Processing was interrupted. Please refresh to retry."},
                    scraped_links=link_metadata if link_metadata else None,
                )
            
            for task in running_tasks:
                if not task.done():
                    task.cancel()
            if running_tasks:
                await asyncio.gather(*running_tasks, return_exceptions=True)
            raise
        except Exception as e:
            elapsed = time.time() - request_start
            logger.error(f"[LEADS:{conversation_id[:8]}] Stream ERROR after {elapsed:.1f}s: {e}")
            yield f"data: {sse_json({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


API_PREFIX = BACKEND_ROOT_PATH or ""
app.include_router(router, prefix=API_PREFIX)


if __name__ == "__main__":
    import uvicorn

    # Allow overriding the listening port via BACKEND_PORT for local runs
    backend_port = int(os.getenv("BACKEND_PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=backend_port)
