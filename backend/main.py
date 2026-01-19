"""FastAPI backend for LLM Council."""

import os
import uuid
import json
import asyncio
import logging
import time

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request

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
from .auth import (
    User,
    authenticate_user,
    create_access_token,
    get_client_ip,
    get_current_user,
    get_current_user_optional,
    is_ip_allowed,
)
from .config import (
    COUNCIL_MODELS,
    CHAIRMAN_MODEL,
    DEFAULT_PREFERRED_MODELS,
    CORS_ALLOW_ORIGINS,
    BACKEND_ROOT_PATH,
)
from .council import (
    run_full_council,
    generate_conversation_title,
    stage1_collect_responses,
    stage2_collect_rankings,
    stage3_synthesize_final,
    calculate_aggregate_rankings,
)


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


@router.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


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
    """Return available council and chairman models."""
    return {
        "council_models": COUNCIL_MODELS,
        "chairman_model": CHAIRMAN_MODEL,
        "default_preferred_models": DEFAULT_PREFERRED_MODELS,
    }


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

    # Add user message
    storage.add_user_message(user.user_id, conversation_id, request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(user.user_id, conversation_id, title)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content,
        models=request.models,
        chairman_model=request.chairman_model,
        language=request.language,
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

    def sse_json(data: dict) -> str:
        """Serialize data to JSON for SSE, ensuring proper escaping."""
        return json.dumps(data, ensure_ascii=False, separators=(',', ':'))

    # Heartbeat interval to keep connection alive (proxy timeout is usually 60s)
    HEARTBEAT_INTERVAL = 15.0

    async def event_generator():
        request_start = time.time()
        logger.info(f"[{conversation_id[:8]}] Stream started, models={request.models}, content_len={len(request.content)}")
        
        try:
            models_to_use = request.models or None
            chairman_to_use = request.chairman_model or None

            # Add user message
            storage.add_user_message(user_id, conversation_id, request.content)

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(request.content))

            # Stage 1: Collect responses
            stage1_start = time.time()
            logger.info(f"[{conversation_id[:8]}] Stage 1 starting...")
            yield f"data: {sse_json({'type': 'stage1_start'})}\n\n"
            
            stage1_task = asyncio.create_task(stage1_collect_responses(
                request.content,
                models=models_to_use,
                language=request.language,
            ))
            while not stage1_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(stage1_task), timeout=HEARTBEAT_INTERVAL)
                except asyncio.TimeoutError:
                    yield f": heartbeat\n\n"
            stage1_results = stage1_task.result()
            
            stage1_duration = time.time() - stage1_start
            logger.info(f"[{conversation_id[:8]}] Stage 1 complete in {stage1_duration:.1f}s, {len(stage1_results)} responses")
            yield f"data: {sse_json({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2: Collect rankings
            stage2_start = time.time()
            logger.info(f"[{conversation_id[:8]}] Stage 2 starting...")
            yield f"data: {sse_json({'type': 'stage2_start'})}\n\n"
            
            stage2_task = asyncio.create_task(stage2_collect_rankings(
                request.content,
                stage1_results,
                models=models_to_use,
                language=request.language,
            ))
            while not stage2_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(stage2_task), timeout=HEARTBEAT_INTERVAL)
                except asyncio.TimeoutError:
                    yield f": heartbeat\n\n"
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
                request.content,
                stage1_results,
                stage2_results,
                chairman_model=chairman_to_use,
                language=request.language,
            ))
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


API_PREFIX = BACKEND_ROOT_PATH or ""
app.include_router(router, prefix=API_PREFIX)


if __name__ == "__main__":
    import uvicorn

    # Allow overriding the listening port via BACKEND_PORT for local runs
    backend_port = int(os.getenv("BACKEND_PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=backend_port)
