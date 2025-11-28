"""FastAPI backend for LLM Council."""

import os
import uuid
import json
import asyncio

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any

from . import storage
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


def require_session_id(x_session_id: str | None = Header(default=None, alias="X-Session-Id")) -> str:
    """Ensure a session id header is present to isolate user data."""
    if not x_session_id:
        raise HTTPException(status_code=400, detail="X-Session-Id header is required")
    return x_session_id


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


@router.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations(session_id: str = Depends(require_session_id)):
    """List all conversations (metadata only)."""
    return storage.list_conversations(session_id)


@router.get("/api/models")
async def list_models():
    """Return available council and chairman models."""
    return {
        "council_models": COUNCIL_MODELS,
        "chairman_model": CHAIRMAN_MODEL,
        "default_preferred_models": DEFAULT_PREFERRED_MODELS,
    }


@router.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest, session_id: str = Depends(require_session_id)):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(session_id, conversation_id)
    return conversation


@router.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str, session_id: str = Depends(require_session_id)):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(session_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest, session_id: str = Depends(require_session_id)):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    if request.models is not None and len(request.models) == 0:
        raise HTTPException(status_code=400, detail="At least one model must be selected.")

    # Check if conversation exists
    conversation = storage.get_conversation(session_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Add user message
    storage.add_user_message(session_id, conversation_id, request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(session_id, conversation_id, title)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content,
        models=request.models,
        chairman_model=request.chairman_model,
        language=request.language,
    )

    # Add assistant message with all stages
    storage.add_assistant_message(
        session_id,
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
async def send_message_stream(conversation_id: str, request: SendMessageRequest, session_id: str = Depends(require_session_id)):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events as each stage completes.
    """
    if request.models is not None and len(request.models) == 0:
        raise HTTPException(status_code=400, detail="At least one model must be selected.")

    # Check if conversation exists
    conversation = storage.get_conversation(session_id, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    def sse_json(data: dict) -> str:
        """Serialize data to JSON for SSE, ensuring proper escaping."""
        return json.dumps(data, ensure_ascii=False, separators=(',', ':'))

    async def event_generator():
        try:
            models_to_use = request.models or None
            chairman_to_use = request.chairman_model or None

            # Add user message
            storage.add_user_message(session_id, conversation_id, request.content)

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(request.content))

            # Stage 1: Collect responses
            yield f"data: {sse_json({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(
                request.content,
                models=models_to_use,
                language=request.language,
            )
            yield f"data: {sse_json({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2: Collect rankings
            yield f"data: {sse_json({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(
                request.content,
                stage1_results,
                models=models_to_use,
                language=request.language,
            )
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            yield f"data: {sse_json({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3: Synthesize final answer
            yield f"data: {sse_json({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(
                request.content,
                stage1_results,
                stage2_results,
                chairman_model=chairman_to_use,
                language=request.language,
            )
            yield f"data: {sse_json({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(session_id, conversation_id, title)
                yield f"data: {sse_json({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Save complete assistant message
            storage.add_assistant_message(
                session_id,
                conversation_id,
                stage1_results,
                stage2_results,
                stage3_result
            )

            # Send completion event
            yield f"data: {sse_json({'type': 'complete'})}\n\n"

        except Exception as e:
            # Send error event
            yield f"data: {sse_json({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


API_PREFIX = BACKEND_ROOT_PATH or ""
app.include_router(router, prefix=API_PREFIX)


if __name__ == "__main__":
    import uvicorn

    # Allow overriding the listening port via BACKEND_PORT for local runs
    backend_port = int(os.getenv("BACKEND_PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=backend_port)
