"""In-memory background jobs for council message generation."""

from __future__ import annotations

import asyncio
import copy
import logging
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from .config import COUNCIL_MODELS
from .council import (
    build_label_to_model,
    build_round_metadata,
    build_round_payload,
    calculate_second_round_status,
    generate_conversation_title,
    get_peer_ranking_models,
    select_second_round_finalists,
    stage1_collect_responses,
    stage1_collect_revised_responses,
    stage2_collect_rankings,
    stage3_synthesize_final,
)
from .firecrawl import extract_urls, process_message_links
from .job_storage import JobStorage, LocalJobStorage

logger = logging.getLogger("llm-council.jobs")


TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


class JobNotFoundError(Exception):
    """Raised when a client tries to attach to a missing job."""


class JobConflictError(Exception):
    """Raised when a new job cannot be started."""


def build_enriched_content_from_saved_links(
    content: str,
    scraped_links: List[Dict[str, Any]] | None,
) -> str:
    """Rebuild the enriched prompt from persisted scraped link metadata."""
    enriched_parts = [content]
    for link in scraped_links or []:
        markdown = link.get("markdown")
        url = link.get("url")
        if link.get("success") and markdown and url:
            truncated = markdown[:50000] if len(markdown) > 50000 else markdown
            enriched_parts.append(
                f'\n\n<link_content url="{url}">\n{truncated}\n</link_content>'
            )
    return "".join(enriched_parts)


def get_continuation_context(conversation: Dict[str, Any]) -> Dict[str, Any]:
    """Load the saved round-1 data needed to continue with the next round."""
    messages = conversation.get("messages") or []
    if not messages or messages[-1].get("role") != "assistant":
        raise ValueError("Next round can only start from the latest assistant result.")

    assistant_message = messages[-1]
    assistant_metadata = assistant_message.get("metadata") or {}
    if assistant_metadata.get("second_round_enabled"):
        raise ValueError("The latest assistant result already includes the next round.")

    user_message = None
    for index in range(len(messages) - 2, -1, -1):
        if messages[index].get("role") == "user":
            user_message = messages[index]
            break

    if user_message is None or not user_message.get("content"):
        raise ValueError("Could not find the original user question for the next round.")

    stage1_results = assistant_message.get("stage1") or []
    stage2_results = assistant_message.get("stage2") or []
    if len(stage1_results) < 2 or not stage2_results:
        raise ValueError(
            "The latest assistant result does not have enough round-1 data to continue."
        )

    rounds = assistant_message.get("rounds") or []
    round1_payload = next(
        (round_payload for round_payload in rounds if round_payload.get("round") == 1),
        None,
    )
    round1_metadata = (round1_payload or {}).get("metadata") or assistant_metadata
    if not round1_metadata.get("label_to_model") or "aggregate_rankings" not in round1_metadata:
        label_to_model = build_label_to_model(stage1_results)
        round1_metadata = build_round_metadata(stage2_results, label_to_model)
    else:
        round1_metadata = {
            "label_to_model": round1_metadata["label_to_model"],
            "aggregate_rankings": round1_metadata["aggregate_rankings"],
        }

    persisted_rounds = rounds or [
        build_round_payload(1, stage1_results, stage2_results, round1_metadata)
    ]
    scraped_links = assistant_message.get("scrapedLinks") or []

    return {
        "user_content": user_message["content"],
        "user_message": user_message,
        "assistant_message": assistant_message,
        "stage1_results": stage1_results,
        "stage2_results": stage2_results,
        "round1_metadata": round1_metadata,
        "rounds": persisted_rounds,
        "scraped_links": scraped_links,
        "enriched_content": build_enriched_content_from_saved_links(
            user_message["content"],
            scraped_links,
        ),
    }


def build_runtime_assistant_message(enable_second_round: bool) -> Dict[str, Any]:
    """Create the partial assistant message shape used by the frontend."""
    return {
        "role": "assistant",
        "stage1": None,
        "stage2": None,
        "stage3": None,
        "metadata": {
            "second_round_enabled": enable_second_round,
            "second_round_status": "skipped",
            "round2_finalists": [],
            "round2": None,
        },
        "rounds": [],
        "scrapedLinks": None,
        "loading": {
            "scraping": False,
            "stage1": False,
            "stage2": False,
            "round2Stage1": False,
            "round2Stage2": False,
            "stage3": False,
        },
        "progress": {
            "stage1": {"completed": [], "total": []},
            "stage2": {"completed": [], "total": []},
            "round2Stage1": {"completed": [], "total": []},
            "round2Stage2": {"completed": [], "total": []},
        },
    }


def ensure_runtime_assistant_message(message: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure a persisted assistant message has runtime-only fields."""
    runtime = build_runtime_assistant_message(False)
    message.setdefault("metadata", {})
    message["metadata"] = {**runtime["metadata"], **message["metadata"]}
    message.setdefault("loading", {})
    message["loading"] = {**runtime["loading"], **message["loading"]}
    message.setdefault("progress", {})
    message["progress"] = {
        key: {**runtime["progress"][key], **message["progress"].get(key, {})}
        for key in runtime["progress"]
    }
    message.setdefault("rounds", [])
    message.setdefault("scrapedLinks", None)
    return message


class CouncilJob:
    """A single background council generation job."""

    def __init__(
        self,
        *,
        user_id: str,
        conversation_id: str,
        request_payload: Dict[str, Any],
        personal_prompt: str,
        base_system_prompt: str | None,
        is_first_message: bool,
        conversation: Dict[str, Any],
        storage: JobStorage,
    ):
        self.user_id = user_id
        self.conversation_id = conversation_id
        self.request_payload = request_payload
        self.personal_prompt = personal_prompt
        self.base_system_prompt = base_system_prompt
        self.is_first_message = is_first_message
        self.storage = storage
        self.status = "queued"
        self.stage = "queued"
        self.error: str | None = None
        self.started_at = datetime.utcnow().isoformat()
        self.updated_at = self.started_at
        self.completed_at: str | None = None
        self.task: asyncio.Task | None = None
        self.subscribers: set[asyncio.Queue] = set()
        self.terminal_event: Dict[str, Any] | None = None
        self.user_message: Dict[str, Any] | None = None
        self.assistant_message = build_runtime_assistant_message(
            bool(request_payload.get("enable_second_round"))
        )

        if request_payload.get("continue_last_assistant_round"):
            context = get_continuation_context(conversation)
            self.user_message = copy.deepcopy(context["user_message"])
            self.assistant_message = ensure_runtime_assistant_message(
                copy.deepcopy(context["assistant_message"])
            )
            self.assistant_message["stage3"] = None
            self.assistant_message["metadata"] = {
                **self.assistant_message.get("metadata", {}),
                "second_round_enabled": False,
                "second_round_status": "skipped",
                "round2_finalists": [],
                "round2": None,
            }
            self.assistant_message["rounds"] = [
                round_payload
                for round_payload in self.assistant_message.get("rounds", [])
                if round_payload.get("round") == 1
            ]
            self.assistant_message["loading"]["round2Stage1"] = True
            self.assistant_message["progress"]["round2Stage1"] = {
                "completed": [],
                "total": [],
            }

    @property
    def active(self) -> bool:
        return self.status not in TERMINAL_STATUSES

    def progress_percent(self) -> float:
        """Return a coarse UI progress percentage for the current job state."""
        if self.status == "queued":
            return 1
        if self.status in TERMINAL_STATUSES:
            return 100 if self.status == "completed" else 0

        message = self.assistant_message or {}
        loading = message.get("loading") or {}
        progress = message.get("progress") or {}
        metadata = message.get("metadata") or {}
        rounds = message.get("rounds") or []
        second_round_enabled = bool(metadata.get("second_round_enabled"))
        round2 = next(
            (round_payload for round_payload in rounds if round_payload.get("round") == 2),
            None,
        )

        if message.get("stage3") is not None and not loading.get("stage3"):
            return 100
        if loading.get("stage3"):
            return 95 if second_round_enabled else 92

        if (round2 or {}).get("stage2"):
            return 90
        if loading.get("round2Stage2"):
            round_progress = progress.get("round2Stage2") or {}
            completed = len(round_progress.get("completed") or [])
            total = max(1, len(round_progress.get("total") or []))
            return 75 + (completed / total) * 15

        if (round2 or {}).get("stage1"):
            return 75
        if loading.get("round2Stage1"):
            round_progress = progress.get("round2Stage1") or {}
            completed = len(round_progress.get("completed") or [])
            total = max(1, len(round_progress.get("total") or []))
            return 55 + (completed / total) * 20

        if message.get("stage2") is not None:
            return 55 if second_round_enabled else 85
        if loading.get("stage2"):
            stage_progress = progress.get("stage2") or {}
            completed = len(stage_progress.get("completed") or [])
            total = max(1, len(stage_progress.get("total") or []))
            start = 35 if second_round_enabled else 65
            end = 55 if second_round_enabled else 85
            return start + (completed / total) * (end - start)

        if message.get("stage1") is not None:
            return 35 if second_round_enabled else 60
        if loading.get("stage1"):
            stage_progress = progress.get("stage1") or {}
            completed = len(stage_progress.get("completed") or [])
            total = max(1, len(stage_progress.get("total") or []))
            start = 15 if message.get("scrapedLinks") is not None else 10
            end = 35 if second_round_enabled else 60
            return start + (completed / total) * (end - start)

        if message.get("scrapedLinks") is not None:
            return 15
        if loading.get("scraping"):
            return 8

        return 3

    def snapshot_data(self) -> Dict[str, Any]:
        """Return a serializable snapshot for polling and reconnects."""
        return {
            "active": self.active,
            "status": self.status,
            "stage": self.stage,
            "progress": round(self.progress_percent(), 1),
            "error": self.error,
            "started_at": self.started_at,
            "updated_at": self.updated_at,
            "completed_at": self.completed_at,
            "conversation_id": self.conversation_id,
            "user_message": copy.deepcopy(self.user_message),
            "assistant_message": copy.deepcopy(self.assistant_message),
        }

    def snapshot_event(self) -> Dict[str, Any]:
        return {"type": "job_snapshot", "data": self.snapshot_data()}

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        self.subscribers.add(queue)
        queue.put_nowait(self.snapshot_event())
        if self.terminal_event is not None:
            queue.put_nowait(copy.deepcopy(self.terminal_event))
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self.subscribers.discard(queue)

    def publish(self, event: Dict[str, Any], *, include_snapshot: bool = True) -> None:
        self.updated_at = datetime.utcnow().isoformat()
        events = [copy.deepcopy(event)]
        if include_snapshot and event.get("type") != "job_snapshot":
            events.append(self.snapshot_event())
        for queue in list(self.subscribers):
            for queued_event in events:
                try:
                    queue.put_nowait(copy.deepcopy(queued_event))
                except asyncio.QueueFull:
                    logger.warning(
                        "[%s] Dropping SSE event for slow subscriber",
                        self.conversation_id[:8],
                    )

    def _set_stage(self, stage: str) -> None:
        self.stage = stage
        self.updated_at = datetime.utcnow().isoformat()

    def _mark_completed(self, event: Dict[str, Any]) -> None:
        self.status = "completed"
        self.stage = "completed"
        self.completed_at = datetime.utcnow().isoformat()
        self.terminal_event = copy.deepcopy(event)
        self.publish(event)

    def _mark_failed(self, message: str) -> None:
        self.status = "failed"
        self.stage = "failed"
        self.error = message
        self.completed_at = datetime.utcnow().isoformat()
        event = {"type": "error", "message": message}
        self.terminal_event = event
        self.publish(event)

    def _mark_cancelled(self) -> None:
        self.status = "cancelled"
        self.stage = "cancelled"
        self.error = "Job cancelled"
        self.completed_at = datetime.utcnow().isoformat()
        event = {"type": "error", "message": self.error}
        self.terminal_event = event
        self.publish(event)

    async def cancel(self) -> None:
        if self.task and not self.task.done():
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        elif self.active:
            self._mark_cancelled()

    async def run(self) -> None:
        request_start = time.time()
        self.status = "running"
        self._set_stage("running")
        self.publish(self.snapshot_event(), include_snapshot=False)
        logger.info(
            "[%s] Job started, models=%s, content_len=%s",
            self.conversation_id[:8],
            self.request_payload.get("models"),
            len(self.request_payload.get("content") or ""),
        )

        try:
            await self._run_workflow()
        except asyncio.CancelledError:
            elapsed = time.time() - request_start
            logger.warning(
                "[%s] Job cancelled after %.1fs",
                self.conversation_id[:8],
                elapsed,
            )
            if self.active:
                self._mark_cancelled()
            raise
        except Exception as exc:
            elapsed = time.time() - request_start
            logger.exception(
                "[%s] Job failed after %.1fs: %s",
                self.conversation_id[:8],
                elapsed,
                exc,
            )
            self._mark_failed(str(exc))

    async def _run_workflow(self) -> None:
        request = self.request_payload
        models_to_use = request.get("models") or None
        chairman_to_use = request.get("chairman_model") or None
        language = request.get("language")
        should_continue = bool(request.get("continue_last_assistant_round"))
        should_run_next_round = bool(request.get("enable_second_round")) or should_continue
        title_task: asyncio.Task | None = None

        if should_continue:
            conversation = await self.storage.get_conversation(
                self.user_id, self.conversation_id
            )
            if conversation is None:
                raise ValueError("Conversation not found")
            continuation_context = get_continuation_context(conversation)
            enriched_content = continuation_context["enriched_content"]
            link_metadata = continuation_context["scraped_links"]
            stage1_results = continuation_context["stage1_results"]
            stage2_results = continuation_context["stage2_results"]
            round1_metadata = continuation_context["round1_metadata"]
            rounds = list(continuation_context["rounds"])
            logger.info(
                "[%s] Continuing next round from saved assistant result",
                self.conversation_id[:8],
            )
        else:
            content = request.get("content") or ""
            self.user_message = {"role": "user", "content": content}
            await self.storage.add_user_message(
                self.user_id, self.conversation_id, content
            )

            urls = extract_urls(content)
            enriched_content = content
            link_metadata = []

            if urls:
                self._set_stage("scraping")
                self.assistant_message["loading"]["scraping"] = True
                self.publish({"type": "scraping_start", "data": {"urls": urls}})
                try:
                    enriched_content, link_metadata, _ = await process_message_links(content)
                    self.assistant_message["loading"]["scraping"] = False
                    self.assistant_message["scrapedLinks"] = link_metadata
                    self.publish(
                        {
                            "type": "scraping_complete",
                            "data": {"links": link_metadata},
                        }
                    )
                except Exception as exc:
                    logger.error("[%s] Scraping error: %s", self.conversation_id[:8], exc)
                    self.assistant_message["loading"]["scraping"] = False
                    self.publish({"type": "scraping_error", "message": str(exc)})

            if self.is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(content))

            self._set_stage("stage1")
            completed_stage1_models: List[str] = []
            stage1_models = models_to_use or COUNCIL_MODELS
            self.assistant_message["loading"]["stage1"] = True
            self.assistant_message["progress"]["stage1"] = {
                "completed": [],
                "total": stage1_models,
            }
            self.publish({"type": "stage1_start", "data": {"models": stage1_models}})

            def stage1_callback(model: str, _response: Any) -> None:
                if model not in completed_stage1_models:
                    completed_stage1_models.append(model)
                    self.assistant_message["progress"]["stage1"]["completed"] = list(
                        completed_stage1_models
                    )
                    self.publish(
                        {"type": "stage1_model_complete", "data": {"model": model}}
                    )

            stage1_results = await stage1_collect_responses(
                enriched_content,
                models=models_to_use,
                language=language,
                base_system_prompt=self.base_system_prompt,
                on_model_complete=stage1_callback,
            )
            self.assistant_message["stage1"] = stage1_results
            self.assistant_message["loading"]["stage1"] = False
            self.publish({"type": "stage1_complete", "data": stage1_results})

            self._set_stage("stage2")
            completed_stage2_models: List[str] = []
            stage2_models = get_peer_ranking_models(models_to_use)
            self.assistant_message["loading"]["stage2"] = True
            self.assistant_message["progress"]["stage2"] = {
                "completed": [],
                "total": stage2_models,
            }
            self.publish({"type": "stage2_start", "data": {"models": stage2_models}})

            def stage2_callback(model: str, _response: Any) -> None:
                if model not in completed_stage2_models:
                    completed_stage2_models.append(model)
                    self.assistant_message["progress"]["stage2"]["completed"] = list(
                        completed_stage2_models
                    )
                    self.publish(
                        {"type": "stage2_model_complete", "data": {"model": model}}
                    )

            stage2_results, label_to_model = await stage2_collect_rankings(
                enriched_content,
                stage1_results,
                models=stage2_models,
                language=language,
                base_system_prompt=self.base_system_prompt,
                on_model_complete=stage2_callback,
            )
            round1_metadata = build_round_metadata(stage2_results, label_to_model)
            rounds = [build_round_payload(1, stage1_results, stage2_results, round1_metadata)]
            self.assistant_message["stage2"] = stage2_results
            self.assistant_message["metadata"] = {
                **round1_metadata,
                "second_round_enabled": bool(request.get("enable_second_round")),
            }
            self.assistant_message["rounds"] = rounds
            self.assistant_message["loading"]["stage2"] = False
            self.publish(
                {
                    "type": "stage2_complete",
                    "data": stage2_results,
                    "metadata": self.assistant_message["metadata"],
                }
            )

        round2_stage1_results: List[Dict[str, Any]] = []
        round2_stage2_results: List[Dict[str, Any]] = []
        round2_metadata = None
        finalists: List[str] = []
        second_round_status = "skipped"

        if should_run_next_round:
            finalists = select_second_round_finalists(
                stage1_results,
                round1_metadata["aggregate_rankings"],
            )
            if len(finalists) >= 2:
                try:
                    self._set_stage("round2_stage1")
                    completed_round2_stage1_models: List[str] = []
                    self.assistant_message["loading"]["round2Stage1"] = True
                    self.assistant_message["progress"]["round2Stage1"] = {
                        "completed": [],
                        "total": finalists,
                    }
                    self.assistant_message["metadata"] = {
                        **(self.assistant_message.get("metadata") or {}),
                        "second_round_enabled": True,
                        "round2_finalists": finalists,
                    }
                    self.publish(
                        {
                            "type": "round2_stage1_start",
                            "data": {"models": finalists, "finalists": finalists},
                        }
                    )

                    def round2_stage1_callback(model: str, _response: Any) -> None:
                        if model not in completed_round2_stage1_models:
                            completed_round2_stage1_models.append(model)
                            self.assistant_message["progress"]["round2Stage1"][
                                "completed"
                            ] = list(completed_round2_stage1_models)
                            self.publish(
                                {
                                    "type": "round2_stage1_model_complete",
                                    "data": {"model": model},
                                }
                            )

                    round2_stage1_results = await stage1_collect_revised_responses(
                        enriched_content,
                        stage1_results,
                        stage2_results,
                        finalists,
                        round1_metadata["aggregate_rankings"],
                        language=language,
                        base_system_prompt=self.base_system_prompt,
                        on_model_complete=round2_stage1_callback,
                    )
                    self.assistant_message["loading"]["round2Stage1"] = False
                    round1_payload = self.assistant_message.get("rounds", rounds)[0]
                    self.assistant_message["rounds"] = [
                        round1_payload,
                        {
                            "round": 2,
                            "stage1": round2_stage1_results,
                            "stage2": [],
                            "metadata": None,
                        },
                    ]
                    self.publish(
                        {
                            "type": "round2_stage1_complete",
                            "data": round2_stage1_results,
                            "metadata": {"finalists": finalists},
                        }
                    )

                    if round2_stage1_results:
                        round2_ranking_models = get_peer_ranking_models([
                            item["model"] for item in round2_stage1_results
                        ])
                        round2_label_to_model = build_label_to_model(round2_stage1_results)
                        if round2_ranking_models:
                            self._set_stage("round2_stage2")
                            completed_round2_stage2_models: List[str] = []
                            self.assistant_message["loading"]["round2Stage2"] = True
                            self.assistant_message["progress"]["round2Stage2"] = {
                                "completed": [],
                                "total": round2_ranking_models,
                            }
                            self.publish(
                                {
                                    "type": "round2_stage2_start",
                                    "data": {
                                        "models": round2_ranking_models,
                                        "finalists": finalists,
                                    },
                                }
                            )

                            def round2_stage2_callback(model: str, _response: Any) -> None:
                                if model not in completed_round2_stage2_models:
                                    completed_round2_stage2_models.append(model)
                                    self.assistant_message["progress"]["round2Stage2"][
                                        "completed"
                                    ] = list(completed_round2_stage2_models)
                                    self.publish(
                                        {
                                            "type": "round2_stage2_model_complete",
                                            "data": {"model": model},
                                        }
                                    )

                            round2_stage2_results, round2_label_to_model = await stage2_collect_rankings(
                                enriched_content,
                                round2_stage1_results,
                                models=round2_ranking_models,
                                language=language,
                                base_system_prompt=self.base_system_prompt,
                                on_model_complete=round2_stage2_callback,
                            )

                        round2_metadata = build_round_metadata(
                            round2_stage2_results,
                            round2_label_to_model,
                        )
                        rounds.append(
                            build_round_payload(
                                2,
                                round2_stage1_results,
                                round2_stage2_results,
                                round2_metadata,
                            )
                        )
                        second_round_status = calculate_second_round_status(
                            finalists,
                            round2_stage1_results,
                            round2_stage2_results,
                        )
                        self.assistant_message["loading"]["round2Stage2"] = False
                        self.assistant_message["rounds"] = rounds
                        self.assistant_message["metadata"] = {
                            **(self.assistant_message.get("metadata") or {}),
                            "second_round_enabled": True,
                            "second_round_status": second_round_status,
                            "round2_finalists": finalists,
                            "round2": round2_metadata,
                        }
                        if len(round2_stage1_results) >= 2:
                            self.publish(
                                {
                                    "type": "round2_stage2_complete",
                                    "data": round2_stage2_results,
                                    "metadata": round2_metadata,
                                }
                            )
                    else:
                        second_round_status = "failed"
                except Exception:
                    logger.exception(
                        "[%s] Round 2 failed unexpectedly",
                        self.conversation_id[:8],
                    )
                    second_round_status = "failed"

        self._set_stage("stage3")
        self.assistant_message["loading"]["round2Stage1"] = False
        self.assistant_message["loading"]["round2Stage2"] = False
        self.assistant_message["loading"]["stage3"] = True
        self.publish({"type": "stage3_start"})

        stage3_result = await stage3_synthesize_final(
            enriched_content,
            stage1_results,
            stage2_results,
            chairman_model=chairman_to_use,
            language=language,
            personal_prompt=self.personal_prompt,
            base_system_prompt=self.base_system_prompt,
            round2_stage1_results=round2_stage1_results,
            round2_stage2_results=round2_stage2_results,
            round2_finalists=finalists,
        )

        metadata = {
            "label_to_model": round1_metadata["label_to_model"],
            "aggregate_rankings": round1_metadata["aggregate_rankings"],
            "second_round_enabled": should_run_next_round,
            "second_round_status": second_round_status,
            "round2_finalists": finalists,
            "round2": round2_metadata,
        }
        self.assistant_message["stage3"] = stage3_result
        self.assistant_message["metadata"] = metadata
        self.assistant_message["rounds"] = rounds
        self.assistant_message["loading"]["stage3"] = False
        self.publish(
            {
                "type": "stage3_complete",
                "data": stage3_result,
                "metadata": metadata,
                "rounds": rounds,
            }
        )

        if title_task:
            title = await title_task
            await self.storage.update_conversation_title(
                self.user_id, self.conversation_id, title
            )
            self.publish({"type": "title_complete", "data": {"title": title}})

        saved_message = {
            "role": "assistant",
            "stage1": stage1_results,
            "stage2": stage2_results,
            "stage3": stage3_result,
            "metadata": metadata,
            "rounds": rounds,
            "scrapedLinks": link_metadata,
        }
        if should_continue:
            await self.storage.update_last_assistant_message(
                self.user_id,
                self.conversation_id,
                saved_message,
            )
        else:
            await self.storage.add_assistant_message(
                self.user_id,
                self.conversation_id,
                stage1_results,
                stage2_results,
                stage3_result,
                metadata=metadata,
                rounds=rounds,
                scraped_links=link_metadata,
            )

        logger.info("[%s] Job complete", self.conversation_id[:8])
        self._mark_completed({"type": "complete", "metadata": metadata, "rounds": rounds})


class CouncilJobManager:
    """Small in-memory registry for background council jobs."""

    def __init__(self):
        self._jobs: Dict[Tuple[str, str], CouncilJob] = {}
        self._lock = asyncio.Lock()

    def get(self, user_id: str, conversation_id: str) -> CouncilJob | None:
        return self._jobs.get((user_id, conversation_id))

    async def start_or_attach(
        self,
        *,
        user_id: str,
        conversation_id: str,
        request_payload: Dict[str, Any],
        personal_prompt: str,
        base_system_prompt: str | None,
        is_first_message: bool,
        conversation: Dict[str, Any],
        storage: JobStorage | None = None,
        attach_only: bool = False,
    ) -> CouncilJob:
        async with self._lock:
            key = (user_id, conversation_id)
            existing = self._jobs.get(key)
            if existing and existing.active:
                return existing
            if attach_only:
                if existing:
                    return existing
                raise JobNotFoundError("No active job for this conversation")
            if not request_payload.get("continue_last_assistant_round") and not (
                request_payload.get("content") or ""
            ).strip():
                raise JobConflictError("Message content is required")

            job = CouncilJob(
                user_id=user_id,
                conversation_id=conversation_id,
                request_payload=request_payload,
                personal_prompt=personal_prompt,
                base_system_prompt=base_system_prompt,
                is_first_message=is_first_message,
                conversation=conversation,
                storage=storage or LocalJobStorage(),
            )
            self._jobs[key] = job
            job.task = asyncio.create_task(job.run())
            return job

    def snapshot(self, user_id: str, conversation_id: str) -> Dict[str, Any]:
        job = self.get(user_id, conversation_id)
        if not job:
            return {
                "active": False,
                "status": "idle",
                "stage": "idle",
                "error": None,
                "conversation_id": conversation_id,
                "user_message": None,
                "assistant_message": None,
            }
        return job.snapshot_data()

    def apply_statuses(
        self,
        user_id: str,
        conversations: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        result = []
        for conversation in conversations:
            item = dict(conversation)
            job = self.get(user_id, item["id"])
            item["job_status"] = job.status if job and job.active else None
            item["job_stage"] = job.stage if job and job.active else None
            item["job_progress"] = round(job.progress_percent(), 1) if job and job.active else None
            result.append(item)
        return result

    async def cancel_conversation(self, user_id: str, conversation_id: str) -> None:
        key = (user_id, conversation_id)
        job = self._jobs.get(key)
        if job:
            await job.cancel()
            self._jobs.pop(key, None)

    async def cancel_all_for_user(self, user_id: str) -> None:
        keys = [key for key in self._jobs if key[0] == user_id]
        for _, conversation_id in keys:
            await self.cancel_conversation(user_id, conversation_id)


job_manager = CouncilJobManager()
